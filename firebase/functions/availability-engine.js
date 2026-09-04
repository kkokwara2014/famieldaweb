/**
 * Professional availability engine — caregivers and health practitioners.
 *
 * Rule: a professional may serve multiple families, but must never hold
 * two simultaneous engagements. Occupancy is compared as UTC instants in
 * a Firestore transaction on the professional's lock document so concurrent
 * booking attempts cannot both succeed.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const USERS = "users";
const VISITS = "scheduleVisits";
const AVAILABILITY = "caregiverAvailability";
const LOCKS = "caregiverScheduleLocks";

const STATUS = {
  REQUESTED: "requested",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CHECKED_IN: "checked_in",
  CHECKED_OUT: "checked_out",
  CANCELLED: "cancelled",
};

const OCCUPYING = [STATUS.ACCEPTED, STATUS.CHECKED_IN];
const DEFAULT_TIME_ZONE = "America/New_York";
const MIN_MINUTES = 30;
const MIN_EXTENSION = 15;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function db() {
  return getFirestore();
}

function occupies(visit) {
  return OCCUPYING.includes(visit?.status);
}

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function lockId(key) {
  return String(key || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
}

function professionalKey(visit) {
  const userId = String(visit?.caregiverUserId || "").trim();
  if (userId) return userId;
  return String(visit?.caregiverEmail || "").trim().toLowerCase() || "unknown";
}

function professionalLockKeys(visit) {
  const keys = [];
  const userId = String(visit?.caregiverUserId || "").trim();
  const email = String(visit?.caregiverEmail || "").trim().toLowerCase();
  if (userId) keys.push(userId);
  if (email && email !== userId) keys.push(email);
  return keys.length ? keys : ["unknown"];
}

function isValidTimeZone(value) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: String(value || "") });
    return true;
  } catch {
    return false;
  }
}

function resolveTimeZone(value) {
  const candidate = String(value || "").trim();
  if (candidate && isValidTimeZone(candidate)) return candidate;
  return DEFAULT_TIME_ZONE;
}

function toMinutes(hhmm) {
  const [hours, minutes] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return null;
  const mins = Number.isFinite(minutes) ? minutes : 0;
  if (mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

function fromMinutes(total) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Number(total) || 0));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function tzOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - utcMs;
}

function zonedTimeToUtc(dateYmd, hhmm, timeZone) {
  const [year, month, day] = String(dateYmd || "").split("-").map(Number);
  const start = toMinutes(hhmm);
  if (!year || !month || !day || start == null) return null;
  const hours = Math.floor(start / 60);
  const minutes = start % 60;
  const guess = Date.UTC(year, month - 1, day, hours, minutes, 0);
  const zone = resolveTimeZone(timeZone);
  const offset1 = tzOffsetMs(guess, zone);
  const instant = guess - offset1;
  const offset2 = tzOffsetMs(instant, zone);
  return guess - offset2;
}

function windowInstants(date, startTime, endTime, timeZone) {
  const startsAt = zonedTimeToUtc(date, startTime, timeZone);
  const endsAt = zonedTimeToUtc(date, endTime, timeZone);
  if (startsAt == null || endsAt == null) return null;
  return { startsAt, endsAt, timeZone: resolveTimeZone(timeZone) };
}

function instantsOverlap(aStart, aEnd, bStart, bEnd) {
  return Number(aStart) < Number(bEnd) && Number(bStart) < Number(aEnd);
}

function slotInstants(slot, fallbackZone) {
  if (Number.isFinite(slot?.startsAt) && Number.isFinite(slot?.endsAt)) {
    return { startsAt: Number(slot.startsAt), endsAt: Number(slot.endsAt) };
  }
  const zone = slot?.timeZone || fallbackZone;
  const startTime = slot?.startTime || (slot?.startMin != null ? fromMinutes(slot.startMin) : "");
  const endTime = slot?.endTime || (slot?.endMin != null ? fromMinutes(slot.endMin) : "");
  if (slot?.date && startTime && endTime) {
    return windowInstants(slot.date, startTime, endTime, zone);
  }
  return null;
}

function civilDateInZone(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function timeZoneAbbr(timeZone, at = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    timeZoneName: "short",
  }).formatToParts(new Date(at));
  return parts.find((part) => part.type === "timeZoneName")?.value || resolveTimeZone(timeZone);
}

function professionalNoun(kind, { plural = false } = {}) {
  if (kind === "practitioner") return plural ? "Clinicians" : "clinician";
  return plural ? "Caregivers" : "caregiver";
}

function overlapMessage(conflict, name = "", kind = "caregiver") {
  const whoName = name || (kind === "practitioner" ? "This clinician" : "This caregiver");
  const rule = `${professionalNoun(kind, { plural: true })} cannot hold overlapping schedules between families.`;
  const who = conflict?.seniorName ? ` with ${conflict.seniorName}` : "";
  const zone = conflict?.timeZone ? ` ${timeZoneAbbr(conflict.timeZone, conflict.startsAt)}` : "";
  const when = conflict?.date && conflict?.startTime && conflict?.endTime
    ? ` on ${conflict.date} · ${conflict.startTime}–${conflict.endTime}${zone}`
    : "";
  return `${whoName} is already scheduled${who}${when}. ${rule}`;
}

function overlapError(conflict, visit) {
  return new HttpsError(
    "failed-precondition",
    overlapMessage(conflict, visit.caregiverName, visit.professionalKind),
  );
}

function requireInstants(visit) {
  const instants = windowInstants(visit.date, visit.startTime, visit.endTime, visit.timeZone);
  if (!instants) {
    throw new HttpsError("invalid-argument", "Choose a date, start, and end in a valid time zone.");
  }
  if (instants.endsAt <= instants.startsAt) {
    throw new HttpsError("invalid-argument", "The visit must end after it starts.");
  }
  const minutes = (instants.endsAt - instants.startsAt) / 60_000;
  if (minutes < MIN_MINUTES) {
    throw new HttpsError("invalid-argument", "A visit needs at least 30 minutes.");
  }
  return instants;
}

function assertValidWindow({ date, startTime, endTime }) {
  if (!String(date || "").match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new HttpsError("invalid-argument", "Choose a visit date.");
  }
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start == null || end == null) {
    throw new HttpsError("invalid-argument", "Choose a start and end time.");
  }
  if (end <= start) {
    throw new HttpsError("invalid-argument", "The visit must end after it starts, on the same day.");
  }
  if (end - start < MIN_MINUTES) {
    throw new HttpsError("invalid-argument", "A visit needs at least 30 minutes.");
  }
}

function slotFromVisit(visit) {
  const instants = windowInstants(visit.date, visit.startTime, visit.endTime, visit.timeZone) || {};
  return {
    visitId: visit.id,
    seniorId: visit.seniorId || "",
    seniorName: visit.seniorName || "",
    familyId: visit.familyId || "",
    date: visit.date,
    startTime: visit.startTime,
    endTime: visit.endTime,
    startMin: toMinutes(visit.startTime),
    endMin: toMinutes(visit.endTime),
    startsAt: instants.startsAt,
    endsAt: instants.endsAt,
    timeZone: resolveTimeZone(visit.timeZone),
    status: visit.status,
  };
}

function pruneSlots(slots, now = Date.now()) {
  return (slots || []).filter((slot) => {
    const instants = slotInstants(slot);
    if (!instants) return false;
    return instants.endsAt >= now - STALE_AFTER_MS;
  });
}

function mergeSlots(lists) {
  const seen = new Set();
  const merged = [];
  for (const slot of lists) {
    if (!slot?.visitId || seen.has(slot.visitId)) continue;
    seen.add(slot.visitId);
    merged.push(slot);
  }
  return merged;
}

function nextSlots(slots, visit) {
  const without = (slots || []).filter((slot) => slot.visitId !== visit.id);
  if (!occupies(visit)) return without;
  return [...without, slotFromVisit(visit)];
}

function findConflict(slots, visitId, instants, timeZone) {
  return (slots || []).find((slot) => {
    if (slot.visitId === visitId) return false;
    const other = slotInstants(slot, timeZone);
    if (!other) return false;
    return instantsOverlap(other.startsAt, other.endsAt, instants.startsAt, instants.endsAt);
  }) ?? null;
}

function omitUndefined(value) {
  if (Array.isArray(value)) return value.map(omitUndefined);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  if (typeof value.toDate === "function") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    next[key] = omitUndefined(item);
  }
  return next;
}

function visitPayload(visit, id, instants) {
  return omitUndefined({
    ...visit,
    id,
    startsAt: instants.startsAt,
    endsAt: instants.endsAt,
    timeZone: instants.timeZone,
    updatedAt: visit.updatedAt || new Date(),
  });
}

async function occupyingVisitsFor(visit) {
  const found = [];
  if (visit.caregiverUserId) {
    const snap = await db().collection(VISITS).where("caregiverUserId", "==", visit.caregiverUserId).get();
    found.push(...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  const email = String(visit.caregiverEmail || "").trim().toLowerCase();
  if (email) {
    const snap = await db().collection(VISITS).where("caregiverEmail", "==", email).get();
    found.push(...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  const seen = new Set();
  return found.filter((item) => {
    if (seen.has(item.id) || !occupies(item)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Atomically write a visit and update the professional occupancy lock.
 * Concurrent accepts/changes of overlapping instants: first commit wins.
 */
async function commitEngagement(visit, { ignoreVisitId } = {}) {
  const instants = visit.date && visit.startTime && visit.endTime
    ? requireInstants({ ...visit, startsAt: undefined, endsAt: undefined })
    : { startsAt: null, endsAt: null, timeZone: resolveTimeZone(visit.timeZone) };

  const known = await occupyingVisitsFor(visit);
  const knownSlots = known
    .filter((item) => item.id !== visit.id && item.id !== ignoreVisitId)
    .map(slotFromVisit);

  const keys = professionalLockKeys(visit);
  const visitRef = visit.id ? db().doc(`${VISITS}/${visit.id}`) : db().collection(VISITS).doc();
  const lockRefs = keys.map((key) => db().doc(`${LOCKS}/${lockId(key)}`));

  await db().runTransaction(async (tx) => {
    const snaps = [];
    for (const ref of lockRefs) {
      snaps.push(await tx.get(ref));
    }

    const fromLocks = snaps.flatMap((snap) => (snap.exists ? snap.data().slots || [] : []));
    const slots = pruneSlots(mergeSlots([...fromLocks, ...knownSlots]));
    const conflict = occupies(visit)
      ? findConflict(slots, visitRef.id, instants, instants.timeZone)
      : null;
    if (conflict) throw overlapError(conflict, visit);

    const record = visitPayload({ ...visit, id: visitRef.id }, visitRef.id, instants);
    tx.set(visitRef, record, { merge: true });
    const next = nextSlots(slots, record);
    keys.forEach((key, index) => {
      tx.set(lockRefs[index], {
        professionalKey: key,
        professionalKind: visit.professionalKind || "caregiver",
        timeZone: instants.timeZone,
        slots: next,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  });

  return { ...visit, id: visitRef.id, startsAt: instants.startsAt, endsAt: instants.endsAt, timeZone: instants.timeZone };
}

async function loadAvailability(caregiverUserId, caregiverEmail) {
  const found = [];
  if (caregiverUserId) {
    const snap = await db().collection(AVAILABILITY).where("caregiverUserId", "==", caregiverUserId).get();
    found.push(...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  const email = String(caregiverEmail || "").trim().toLowerCase();
  if (email && !caregiverUserId) {
    const snap = await db().collection(AVAILABILITY).where("caregiverEmail", "==", email).get();
    found.push(...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  const seen = new Set();
  return found.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return item.active !== false;
  });
}

function weekdayFromIso(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

function windowCovered(window, windows = []) {
  const start = toMinutes(window.startTime);
  const end = toMinutes(window.endTime);
  if (start == null || end == null) return false;
  return windows.some((item) => {
    const from = toMinutes(item.startTime);
    const to = toMinutes(item.endTime);
    if (from == null || to == null) return false;
    return from <= start && to >= end;
  });
}

function windowBlocked(window, blocks = []) {
  const instants = windowInstants(window.date, window.startTime, window.endTime, window.timeZone);
  if (!instants) return false;
  return blocks.some((block) => {
    if (String(block.date) !== String(window.date)) return false;
    const other = windowInstants(block.date, block.startTime, block.endTime, block.timeZone || window.timeZone);
    if (!other) return false;
    return instantsOverlap(instants.startsAt, instants.endsAt, other.startsAt, other.endsAt);
  });
}

function assertFitsAvailability(candidate, windows) {
  const weeklyAll = windows.filter((item) => item.kind === "weekly");
  const weekday = weekdayFromIso(candidate.date);
  const weekly = weeklyAll.filter((item) => Number(item.weekday) === weekday);
  const blocks = windows.filter((item) => item.kind === "block" && item.date === candidate.date);
  const name = candidate.caregiverName || (candidate.professionalKind === "practitioner" ? "This clinician" : "This caregiver");

  if (windowBlocked(candidate, blocks)) {
    throw new HttpsError("failed-precondition", `${name} marked that time as unavailable.`);
  }
  if (weeklyAll.length && !windowCovered(candidate, weekly)) {
    throw new HttpsError(
      "failed-precondition",
      `${name} is not available then. Families can only book inside published hours.`,
    );
  }
}

async function previewConflict(candidate) {
  try {
    assertValidWindow(candidate);
    const instants = requireInstants(candidate);
    const windows = await loadAvailability(candidate.caregiverUserId, candidate.caregiverEmail);
    assertFitsAvailability({ ...candidate, timeZone: instants.timeZone }, windows);

    const known = await occupyingVisitsFor(candidate);
    const keys = professionalLockKeys(candidate);
    const lockSnaps = await Promise.all(keys.map((key) => db().doc(`${LOCKS}/${lockId(key)}`).get()));
    const slots = pruneSlots(mergeSlots([
      ...lockSnaps.flatMap((snap) => (snap.exists ? snap.data().slots || [] : [])),
      ...known.map(slotFromVisit),
    ]));
    const conflict = findConflict(slots, candidate.visitId || candidate.id, instants, instants.timeZone);
    if (conflict) {
      return {
        ok: false,
        overlap: true,
        conflict,
        message: overlapMessage(conflict, candidate.caregiverName, candidate.professionalKind),
      };
    }
    return { ok: true, conflict: null, message: "", overlap: false, startsAt: instants.startsAt, endsAt: instants.endsAt, timeZone: instants.timeZone };
  } catch (error) {
    if (error instanceof HttpsError) {
      return { ok: false, overlap: false, conflict: null, message: error.message };
    }
    throw error;
  }
}

async function saveAvailability({ uid, email, name, kind, timeZone, weekly, block }) {
  const zone = resolveTimeZone(timeZone);
  if (timeZone && !isValidTimeZone(timeZone)) {
    throw new HttpsError("invalid-argument", "Choose a valid time zone.");
  }

  const existing = await db().collection(AVAILABILITY).where("caregiverUserId", "==", uid).get();
  const batch = db().batch();
  const kept = [];

  if (Array.isArray(weekly)) {
    for (const day of weekly) {
      if (!day?.enabled) continue;
      const start = toMinutes(day.startTime);
      const end = toMinutes(day.endTime);
      if (start == null || end == null) {
        throw new HttpsError("invalid-argument", "Set a start and end for each available day.");
      }
      if (end <= start) {
        throw new HttpsError("invalid-argument", "Availability must end after it starts.");
      }
      const ref = day.id
        ? db().doc(`${AVAILABILITY}/${day.id}`)
        : db().collection(AVAILABILITY).doc();
      batch.set(ref, {
        professionalKind: kind,
        caregiverUserId: uid,
        caregiverEmail: email,
        caregiverName: name || "",
        kind: "weekly",
        weekday: Number(day.weekday),
        startTime: day.startTime,
        endTime: day.endTime,
        timeZone: zone,
        active: true,
        updatedAt: new Date(),
      }, { merge: true });
      kept.push(ref.id);
    }
    existing.docs.forEach((doc) => {
      if (!kept.includes(doc.id) && doc.data().kind === "weekly") batch.delete(doc.ref);
    });
  }

  if (block?.date && block.startTime && block.endTime) {
    assertValidWindow(block);
    const ref = db().collection(AVAILABILITY).doc();
    batch.set(ref, {
      professionalKind: kind,
      caregiverUserId: uid,
      caregiverEmail: email,
      caregiverName: name || "",
      kind: "block",
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      notes: block.notes || "Time off",
      timeZone: zone,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    kept.push(ref.id);
  }

  batch.set(db().doc(`${USERS}/${uid}`), { timeZone: zone, updatedAt: new Date() }, { merge: true });
  await batch.commit();
  return { ok: true, count: kept.length, timeZone: zone };
}

function extendEndTime(endTime, minutes) {
  const start = toMinutes(endTime);
  if (start == null) return null;
  const next = start + Number(minutes || 0);
  if (next >= 24 * 60) return null;
  return fromMinutes(next);
}

async function resolveProfessionalTimeZone(userId, email, fallback) {
  if (userId) {
    const snap = await db().doc(`${USERS}/${userId}`).get();
    if (snap.exists && snap.data().timeZone) return resolveTimeZone(snap.data().timeZone);
  }
  const windows = await loadAvailability(userId, email);
  const fromWindow = windows.find((item) => item.timeZone)?.timeZone;
  return resolveTimeZone(fromWindow || fallback);
}

module.exports = {
  STATUS,
  OCCUPYING,
  DEFAULT_TIME_ZONE,
  MIN_EXTENSION,
  occupies,
  emailsEqual,
  lockId,
  professionalKey,
  resolveTimeZone,
  isValidTimeZone,
  toMinutes,
  fromMinutes,
  windowInstants,
  instantsOverlap,
  civilDateInZone,
  timeZoneAbbr,
  overlapMessage,
  assertValidWindow,
  requireInstants,
  slotFromVisit,
  commitEngagement,
  loadAvailability,
  assertFitsAvailability,
  previewConflict,
  saveAvailability,
  extendEndTime,
  resolveProfessionalTimeZone,
  weekdayFromIso,
  occupyingVisitsFor,
};
