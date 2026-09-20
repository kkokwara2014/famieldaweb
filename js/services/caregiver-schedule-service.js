import {
  AUTH,
  ACTIVITY_TYPES,
  AVAILABILITY,
  CARE_HISTORY_KINDS,
  CIRCLE_KINDS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  NOTIFICATION_TYPES,
  ROLES,
  VISIT_STATUS,
} from "../config/constants.js";
import { hasPermission } from "../config/care-circle.js";
import { AVAILABILITY_KIND, PROFESSIONAL_KIND, ScheduleOverlapError } from "../config/scheduling.js";
import { createAvailabilityWindow } from "../models/availability.js";
import { createScheduleEvent } from "../models/schedule-event.js";
import { createScheduleVisit, createVisitNote, createVisitReport } from "../models/schedule-visit.js";
import { mockAvailability, mockVisits } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { familyCaregiversCol, scheduleVisitsCol, visitReportsCol } from "../core/firestore-paths.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { callCloudFunction } from "../core/functions.js";
import { getSession, setSession } from "../auth/session.js";
import { listCareCircle, updateOwnPresence } from "./care-circle-service.js";
import { getSeniorById, getSeniorForUser } from "./senior-service.js";
import { postActivity } from "./activity-service.js";
import { notifyQuietly } from "./notification-service.js";
import { assertProfessionalEligible, withVerificationStatus } from "./verification-service.js";
import { PRODUCT_EVENTS, trackProductEvent } from "./analytics-service.js";
import { weekDays, weekdayLabel } from "../scheduling/calendar.js";
import {
  addMinutesToTime,
  durationMinutes,
  formatRange,
  toMinutes,
  weekdayFromIso,
} from "../scheduling/time.js";
import {
  assertValidWindow,
  caregiverKey,
  findOccupyingConflict,
  lockDocId,
  occupiesCaregiver,
  overlapMessage,
  sameCaregiver,
  slotFromVisit,
  windowBlocked,
  windowCoveredByAvailability,
  visitsOverlap,
} from "../scheduling/overlap.js";
import { civilDateInZone, resolveTimeZone, windowInstants } from "../scheduling/timezone.js";

const AVAIL_KEY = "caregiverAvailability";
const VISITS_KEY = "scheduleVisits";
const LOCKS_KEY = "caregiverScheduleLocks";

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function logVisitActivity(visit, extra = {}, session = getSession()) {
  try {
    await postActivity({
      type: extra.type || ACTIVITY_TYPES.SCHEDULE,
      kind: extra.kind,
      title: extra.title,
      body: extra.body,
      seniorId: visit.seniorId,
      actor: extra.actor || session?.displayName || visit.caregiverName,
      actorId: extra.actorId || session?.id || visit.caregiverUserId,
      source: "visit",
      sourceId: extra.sourceId,
      relatedId: visit.id,
      occurredAt: extra.occurredAt,
    }, session);
  } catch {
    // History is helpful, not required to save the visit.
  }
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return null;
}

// Mobile stores `startAt`/`endAt` (Timestamp); canonical web fields are
// `startsAt`/`endsAt` (epoch ms). Derive the legacy `date`/`startTime`/`endTime`
// strings from the instants when only the epoch form is present.
function civilParts(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${hour}:${map.minute}` };
}

const LEGACY_VISIT_STATUS = {
  pending: VISIT_STATUS.REQUESTED,
  scheduled: VISIT_STATUS.ACCEPTED,
  inProgress: VISIT_STATUS.CHECKED_IN,
  in_progress: VISIT_STATUS.CHECKED_IN,
  completed: VISIT_STATUS.CHECKED_OUT,
};

function legacyVisitStatus(data) {
  if (data.status) return LEGACY_VISIT_STATUS[data.status] ?? data.status;
  return undefined;
}

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function isProfessionalSession(session) {
  return session?.role === ROLES.CAREGIVER || session?.role === ROLES.HEALTH_PRACTITIONER;
}

function professionalKindFor(session, fallback = PROFESSIONAL_KIND.CAREGIVER) {
  if (session?.role === ROLES.HEALTH_PRACTITIONER) return PROFESSIONAL_KIND.PRACTITIONER;
  if (session?.role === ROLES.CAREGIVER) return PROFESSIONAL_KIND.CAREGIVER;
  return fallback;
}

function kindOf(record) {
  return record?.professionalKind === PROFESSIONAL_KIND.PRACTITIONER
    ? PROFESSIONAL_KIND.PRACTITIONER
    : PROFESSIONAL_KIND.CAREGIVER;
}

function displayNameOf(record) {
  if (record?.caregiverName) return record.caregiverName;
  return kindOf(record) === PROFESSIONAL_KIND.PRACTITIONER ? "This clinician" : "This caregiver";
}

function visitFrom(data) {
  const startsAt = toMillis(data.startsAt) ?? toMillis(data.startAt);
  const endsAt = toMillis(data.endsAt) ?? toMillis(data.endAt);
  const fromStart = startsAt != null && (!data.date || !data.startTime)
    ? civilParts(startsAt, data.timeZone)
    : null;
  const fromEnd = endsAt != null && !data.endTime
    ? civilParts(endsAt, data.timeZone)
    : null;
  const professionalKind = data.professionalKind
    || (data.professionalRole === "healthPractitioner"
      ? PROFESSIONAL_KIND.PRACTITIONER
      : PROFESSIONAL_KIND.CAREGIVER);
  return createScheduleVisit({
    ...data,
    status: legacyVisitStatus(data),
    date: data.date || fromStart?.date || "",
    startTime: data.startTime || fromStart?.time || "",
    endTime: data.endTime || fromEnd?.time || "",
    caregiverName: data.caregiverName || data.caregiverDisplayName || "",
    caregiverMemberId: data.caregiverMemberId || data.caregiverId || "",
    caregiverUserId: data.caregiverUserId
      || (data.professionalRole && data.professionalRole !== "healthPractitioner"
        ? data.professionalId
        : null),
    professionalKind,
    title: data.title
      || (professionalKind === PROFESSIONAL_KIND.PRACTITIONER ? "Appointment" : "Care visit"),
    startsAt,
    endsAt,
    requestedAt: toIso(data.requestedAt),
    respondedAt: toIso(data.respondedAt),
    checkedInAt: toIso(data.checkedInAt),
    checkedOutAt: toIso(data.checkedOutAt),
    modifiedAt: toIso(data.modifiedAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    notes: Array.isArray(data.notes)
      ? data.notes.map((item) => createVisitNote({ ...item, createdAt: toIso(item.createdAt) }))
      : [],
    report: data.report
      ? createVisitReport({ ...data.report, submittedAt: toIso(data.report.submittedAt) })
      : null,
  });
}

function availabilityFrom(data) {
  return createAvailabilityWindow({
    ...data,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  });
}

const VISIT_LOCATION_FALLBACK = { latitude: 0, longitude: 0 };
const VISIT_LOCATION_TIMEOUT_MS = 5000;

function visitLocation() {
  return new Promise((resolve) => {
    const fallback = { ...VISIT_LOCATION_FALLBACK };
    if (
      typeof navigator === "undefined"
      || !navigator.geolocation
      || typeof navigator.geolocation.getCurrentPosition !== "function"
    ) {
      resolve(fallback);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), VISIT_LOCATION_TIMEOUT_MS);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timer);
          const latitude = Number(position?.coords?.latitude);
          const longitude = Number(position?.coords?.longitude);
          finish(Number.isFinite(latitude) && Number.isFinite(longitude)
            ? { latitude, longitude }
            : fallback);
        },
        () => {
          clearTimeout(timer);
          finish(fallback);
        },
        {
          enableHighAccuracy: false,
          timeout: VISIT_LOCATION_TIMEOUT_MS,
          maximumAge: 60000,
        },
      );
    } catch {
      clearTimeout(timer);
      finish(fallback);
    }
  });
}

function moodFromCondition(condition) {
  if (condition === "fair") return "tired";
  if (condition === "concerning") return "unwell";
  return "good";
}

function conditionFromMood(mood) {
  if (mood === "unwell") return "concerning";
  if (mood === "tired") return "fair";
  return "good";
}

function reportFromDoc(data = {}) {
  const incident = data.incidentType && data.incidentType !== "noIncident" ? data.incidentType : "";
  return createVisitReport({
    summary: data.summary || data.notes || "",
    mood: data.mood || moodFromCondition(data.generalCondition),
    meals: data.meals || "",
    mobility: data.mobility || "",
    concerns: data.concerns || incident,
    followUp: data.followUp || "",
    submittedAt: toIso(data.submittedAt || data.createdAt),
    submittedBy: data.submittedBy || data.caregiverDisplayName || "",
    submittedById: data.submittedById || data.createdBy || "",
  });
}

function reportFromInput(visit, input = {}, session) {
  return createVisitReport({
    summary: String(input.summary || "").trim(),
    mood: input.mood || "typical",
    meals: String(input.meals || "").trim(),
    mobility: String(input.mobility || "").trim(),
    concerns: String(input.concerns || "").trim(),
    followUp: String(input.followUp || "").trim(),
    submittedAt: nowIso(),
    submittedBy: session?.displayName || "",
    submittedById: session?.id || "",
  });
}

async function readReportsForSenior(seniorId) {
  if (!seniorId || !usesLiveAuth()) return new Map();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDocs(sdk.query(
    visitReportsCol(seniorId),
    sdk.limit(QUERY_LIMITS.SCHEDULE),
  ));
  const byShift = new Map();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const report = reportFromDoc(data);
    const key = data.shiftId || doc.id;
    const existing = byShift.get(key);
    if (!existing || String(report.submittedAt || "").localeCompare(String(existing.submittedAt || "")) >= 0) {
      byShift.set(key, report);
    }
  }
  return byShift;
}

async function attachReports(visits) {
  if (!usesLiveAuth() || !visits.length) return visits;
  const seniorIds = [...new Set(visits.map((visit) => visit.seniorId).filter(Boolean))];
  const maps = await Promise.all(seniorIds.map((seniorId) => readReportsForSenior(seniorId)));
  const bySenior = new Map(seniorIds.map((seniorId, index) => [seniorId, maps[index]]));
  return visits.map((visit) => {
    const report = bySenior.get(visit.seniorId)?.get(visit.id);
    return report ? { ...visit, report } : visit;
  });
}

async function readShiftRaw(seniorId, shiftId) {
  if (!seniorId || !shiftId || !usesLiveAuth()) return null;
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(scheduleVisitsCol(seniorId), shiftId));
  return snap.exists() ? snap.data() : null;
}

async function readShiftByPath(seniorId, shiftId) {
  const raw = await readShiftRaw(seniorId, shiftId);
  if (!raw) throw new Error("That visit could not be found.");
  const visit = visitFrom({ id: shiftId, ...raw });
  const reports = await readReportsForSenior(seniorId);
  const report = reports.get(shiftId);
  return report ? { ...visit, report } : visit;
}

async function writeShiftFields(seniorId, shiftId, fields) {
  const sdk = getFirestoreSdk();
  await sdk.updateDoc(sdk.doc(scheduleVisitsCol(seniorId), shiftId), fields);
}

async function resolveFamilyCaregiverId(familyId, member) {
  if (!familyId || !member) return null;
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (member.userId) constraints.push(sdk.where("userId", "==", member.userId));
  else if (member.email) constraints.push(sdk.where("email", "==", String(member.email).trim().toLowerCase()));
  else return null;
  const snap = await sdk.getDocs(sdk.query(
    familyCaregiversCol(familyId),
    ...constraints,
    sdk.limit(1),
  ));
  return snap.docs[0]?.id || null;
}

async function shiftAssignmentForMember(member, familyId) {
  const role = member.kind === CIRCLE_KINDS.PRACTITIONER ? "healthPractitioner" : "caregiver";
  if (role === "healthPractitioner") {
    return {
      caregiverId: null,
      professionalId: member.userId || member.id || null,
      professionalRole: role,
      professionalDisplayName: member.name || null,
    };
  }
  const rosterId = await resolveFamilyCaregiverId(familyId, member);
  return {
    caregiverId: rosterId || member.id || null,
    professionalId: member.userId || null,
    professionalRole: role,
    professionalDisplayName: member.name || null,
  };
}

async function writeVisitReport(visit, input = {}, session, { note = false } = {}) {
  const sdk = getFirestoreSdk();
  const ref = sdk.doc(visitReportsCol(visit.seniorId));
  const summary = String(input.summary || "").trim();
  const noteBody = String(input.body || input.note || "").trim();
  const mood = input.mood || "typical";
  const concerns = String(input.concerns || "").trim();
  const caregiverDisplayName = visit.caregiverName || session?.displayName || "";
  const data = {
    familyId: visit.familyId,
    seniorId: visit.seniorId,
    shiftId: visit.id,
    generalCondition: conditionFromMood(mood),
    incidentType: concerns ? "other" : "noIncident",
    activities: concerns ? ["observation"] : [],
    notes: summary || noteBody,
    attachments: [],
    summary,
    mood,
    meals: String(input.meals || "").trim(),
    mobility: String(input.mobility || "").trim(),
    concerns,
    followUp: String(input.followUp || "").trim(),
    isNote: Boolean(note),
    submittedBy: session?.displayName || "",
    submittedById: session?.id || "",
    createdBy: session?.id || "",
    createdAt: sdk.serverTimestamp(),
    updatedAt: sdk.serverTimestamp(),
  };
  if (visit.seniorName) data.seniorName = visit.seniorName;
  if (visit.caregiverMemberId) data.caregiverId = visit.caregiverMemberId;
  if (caregiverDisplayName) data.caregiverDisplayName = caregiverDisplayName;
  if (visit.caregiverUserId) data.professionalId = visit.caregiverUserId;
  await sdk.setDoc(ref, data);
  return { id: ref.id, ...data };
}

function toDoc(record) {
  const { id: _id, ...rest } = record;
  return rest;
}

function seedMap(key, records) {
  const map = storage.get(key, null) ?? {};
  let changed = false;
  for (const record of records) {
    if (!map[record.id]) {
      map[record.id] = record;
      changed = true;
    }
  }
  if (changed) storage.set(key, map);
  return map;
}

function seedLocal() {
  seedMap(AVAIL_KEY, mockAvailability);
  seedMap(VISITS_KEY, mockVisits);
}

function readLocalMap(key) {
  seedLocal();
  return storage.get(key, {}) ?? {};
}

function writeLocalRecord(key, record) {
  const map = readLocalMap(key);
  map[record.id] = record;
  storage.set(key, map);
  return record;
}

function deleteLocalRecord(key, id) {
  const map = readLocalMap(key);
  delete map[id];
  storage.set(key, map);
}

function localVisits() {
  return Object.values(readLocalMap(VISITS_KEY)).map((item) => visitFrom(item));
}

function localAvailability() {
  return Object.values(readLocalMap(AVAIL_KEY)).map((item) => availabilityFrom(item));
}

async function collectionDocs(collectionRef, constraints = [], options = {}) {
  const sdk = getFirestoreSdk();
  const limit = options.limit ?? QUERY_LIMITS.SCHEDULE;
  const query = sdk.query(collectionRef, ...constraints, sdk.limit(limit));
  const snap = await sdk.getDocs(query);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function collectionGroupDocs(constraints = [], options = {}) {
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const limit = options.limit ?? QUERY_LIMITS.SCHEDULE;
  const query = sdk.query(
    sdk.collectionGroup(db, "scheduleVisits"),
    ...constraints,
    sdk.limit(limit),
  );
  const snap = await sdk.getDocs(query);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function availabilityCol() {
  return getFirestoreSdk().collection(getFirebaseDb(), AUTH.AVAILABILITY_COLLECTION);
}

async function readVisitById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) {
    return localVisits().find((item) => item.id === id) ?? null;
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDocs(sdk.query(
    sdk.collectionGroup(db, "scheduleVisits"),
    sdk.where(sdk.documentId(), "==", id),
    sdk.limit(1),
  ));
  const doc = snap.docs[0];
  if (!doc) return null;
  const visit = visitFrom({ id: doc.id, ...doc.data() });
  const reports = await readReportsForSenior(visit.seniorId);
  const report = reports.get(visit.id);
  return report ? { ...visit, report } : visit;
}

async function readAvailabilityById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) {
    return localAvailability().find((item) => item.id === id) ?? null;
  }
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(availabilityCol(), id));
  if (!snap.exists()) return null;
  return availabilityFrom({ id: snap.id, ...snap.data() });
}

function matchesCaregiver(item, session) {
  if (!session) return false;
  if (item.caregiverUserId && item.caregiverUserId === session.id) return true;
  return emailsEqual(item.caregiverEmail, session.email);
}

function matchesCaregiverRef(item, ref) {
  return sameCaregiver(item, {
    caregiverUserId: ref.caregiverUserId,
    caregiverEmail: ref.caregiverEmail,
  });
}

async function readVisits({ seniorId, session, caregiver } = {}) {
  if (!usesLiveAuth()) {
    return localVisits().filter((item) => {
      if (seniorId && item.seniorId !== seniorId) return false;
      if (caregiver && !matchesCaregiverRef(item, caregiver)) return false;
      if (!seniorId && !caregiver && session) {
        if (isProfessionalSession(session)) return matchesCaregiver(item, session);
        return item.seniorId === session.seniorId;
      }
      return true;
    });
  }

  const sdk = getFirestoreSdk();
  const docs = [];
  if (seniorId) {
    docs.push(...await collectionDocs(scheduleVisitsCol(seniorId)));
  } else if (caregiver?.caregiverUserId) {
    docs.push(...await collectionGroupDocs([
      sdk.where("caregiverUserId", "==", caregiver.caregiverUserId),
    ]));
  } else if (caregiver?.caregiverEmail) {
    docs.push(...await collectionGroupDocs([
      sdk.where("caregiverEmail", "==", String(caregiver.caregiverEmail).trim().toLowerCase()),
    ]));
  } else if (isProfessionalSession(session)) {
    if (session.id) {
      docs.push(...await collectionGroupDocs([
        sdk.where("caregiverUserId", "==", session.id),
      ]));
    }
    if (session.email) {
      docs.push(...await collectionGroupDocs([
        sdk.where("caregiverEmail", "==", String(session.email).trim().toLowerCase()),
      ]));
    }
  }

  const seen = new Set();
  return docs
    .map((item) => visitFrom(item))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

async function readAvailability({ session, caregiver } = {}) {
  if (!usesLiveAuth()) {
    return localAvailability().filter((item) => {
      if (caregiver) return matchesCaregiverRef(item, caregiver);
      if (session) return matchesCaregiver(item, session);
      return true;
    });
  }

  const sdk = getFirestoreSdk();
  const docs = [];
  const userId = caregiver?.caregiverUserId || (isProfessionalSession(session) ? session.id : "");
  const email = caregiver?.caregiverEmail || session?.email;
  if (userId) {
    docs.push(...await collectionDocs(availabilityCol(), [
      sdk.where("caregiverUserId", "==", userId),
    ]));
  }
  if (email && !userId) {
    docs.push(...await collectionDocs(availabilityCol(), [
      sdk.where("caregiverEmail", "==", String(email).trim().toLowerCase()),
    ]));
  }

  const seen = new Set();
  return docs
    .map((item) => availabilityFrom(item))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

async function saveVisitRecord(visit) {
  const record = visitFrom({ ...visit, updatedAt: nowIso() });
  if (!usesLiveAuth()) return visitFrom(writeLocalRecord(VISITS_KEY, record));

  const sdk = getFirestoreSdk();
  const collection = scheduleVisitsCol(record.seniorId);
  const ref = record.id
    ? sdk.doc(collection, record.id)
    : sdk.doc(collection);
  const payload = toDoc({ ...record, id: ref.id });
  const data = {
    ...payload,
    updatedAt: sdk.serverTimestamp(),
  };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return visitFrom({ ...record, id: ref.id });
}

async function saveAvailabilityRecord(window) {
  const record = availabilityFrom({ ...window, updatedAt: nowIso() });
  if (!usesLiveAuth()) return availabilityFrom(writeLocalRecord(AVAIL_KEY, record));

  const sdk = getFirestoreSdk();
  const collection = availabilityCol();
  const ref = record.id
    ? sdk.doc(collection, record.id)
    : sdk.doc(collection);
  const payload = toDoc({ ...record, id: ref.id });
  const data = {
    ...payload,
    updatedAt: sdk.serverTimestamp(),
  };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return availabilityFrom({ ...record, id: ref.id });
}

async function occupyingForCaregiver(candidate, ignoreVisitId) {
  const visits = await readVisits({
    caregiver: {
      caregiverUserId: candidate.caregiverUserId,
      caregiverEmail: candidate.caregiverEmail,
    },
  });
  return visits.filter((visit) => occupiesCaregiver(visit) && visit.id !== ignoreVisitId);
}

function readLocalLock(key) {
  const map = storage.get(LOCKS_KEY, {}) ?? {};
  return map[lockDocId(key)] ?? { id: lockDocId(key), slots: [] };
}

function writeLocalLock(key, slots) {
  const map = storage.get(LOCKS_KEY, {}) ?? {};
  map[lockDocId(key)] = { id: lockDocId(key), slots, updatedAt: nowIso() };
  storage.set(LOCKS_KEY, map);
}

function nextSlots(slots, visit) {
  const without = (slots || []).filter((slot) => slot.visitId !== visit.id);
  if (!occupiesCaregiver(visit)) return without;
  return [...without, slotFromVisit(visit)];
}

async function commitVisit(visit, { ignoreVisitId } = {}) {
  const instants = windowInstants(visit.date, visit.startTime, visit.endTime, visit.timeZone);
  const next = instants ? { ...visit, ...instants } : visit;
  const occupying = await occupyingForCaregiver(next, ignoreVisitId || next.id);
  const conflict = findOccupyingConflict(next, occupying, { ignoreVisitId: ignoreVisitId || next.id });
  if (occupiesCaregiver(next) && conflict) {
    throw new ScheduleOverlapError(overlapMessage(conflict, displayNameOf(next), kindOf(next)), conflict);
  }

  const key = caregiverKey(next);
  const lock = readLocalLock(key);
  const lockedConflict = (lock.slots || []).find((slot) => (
    slot.visitId !== next.id
    && visitsOverlap(slot, next)
  ));
  if (occupiesCaregiver(next) && lockedConflict) {
    throw new ScheduleOverlapError(overlapMessage(lockedConflict, displayNameOf(next), kindOf(next)), lockedConflict);
  }

  const saved = visitFrom(writeLocalRecord(VISITS_KEY, next));
  writeLocalLock(key, nextSlots(lock.slots, saved));
  return saved;
}

function assertCanRequest(session, senior, circle) {
  if (!session) throw new Error("Sign in to request a visit.");
  if (session.role === ROLES.CAREGIVER) {
    throw new Error("Families request visits. You can accept or decline them here.");
  }
  if (session.role === ROLES.HEALTH_PRACTITIONER) {
    throw new Error("Families request appointments. You can accept or decline them here.");
  }
  if (!senior) throw new Error("Create a senior profile before requesting a visit.");
  if (session.role === ROLES.ADMIN || senior.ownerId === session.id) return;
  const actor = circle.find((member) => (
    member.userId === session.id || emailsEqual(member.email, session.email)
  ));
  if (!hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_SCHEDULE)) {
    throw new Error("You need permission to change this household’s schedule.");
  }
}

function assertAssignedCaregiver(visit, session) {
  if (!matchesCaregiver(visit, session)) {
    throw new Error("That visit is not assigned to you.");
  }
}

function activeCaregivers(circle) {
  return circle.filter((member) => (
    member.kind === CIRCLE_KINDS.CAREGIVER && member.status === CIRCLE_STATUS.ACTIVE
  ));
}

function findCaregiverMember(circle, idOrEmail) {
  return findProfessionalMember(circle, idOrEmail, CIRCLE_KINDS.CAREGIVER);
}

function activePractitioners(circle) {
  return circle.filter((member) => (
    member.kind === CIRCLE_KINDS.PRACTITIONER && member.status === CIRCLE_STATUS.ACTIVE
  ));
}

function activeProfessionals(circle, kind) {
  if (kind === CIRCLE_KINDS.PRACTITIONER) return activePractitioners(circle);
  if (kind === CIRCLE_KINDS.CAREGIVER) return activeCaregivers(circle);
  return [...activeCaregivers(circle), ...activePractitioners(circle)];
}

function findProfessionalMember(circle, idOrEmail, kind) {
  const needle = String(idOrEmail || "").trim().toLowerCase();
  return activeProfessionals(circle, kind).find((member) => (
    member.id === idOrEmail
    || member.userId === idOrEmail
    || emailsEqual(member.email, needle)
  )) ?? null;
}

async function assertFitsAvailability(candidate) {
  const windows = (await readAvailability({ caregiver: candidate }))
    .filter((item) => item.active);
  const zone = resolveTimeZone(candidate.timeZone || windows.find((item) => item.timeZone)?.timeZone);
  const window = { ...candidate, timeZone: zone };
  const allWeekly = windows.filter((item) => item.kind === AVAILABILITY_KIND.WEEKLY);
  const weekly = allWeekly.filter((item) => item.weekday === weekdayFromIso(window.date));
  const blocks = windows.filter((item) => item.kind === AVAILABILITY_KIND.BLOCK && item.date === window.date);

  if (windowBlocked(window, blocks)) {
    throw new Error(`${displayNameOf(window)} marked that time as unavailable.`);
  }
  if (allWeekly.length && !windowCoveredByAvailability(window, weekly)) {
    throw new Error(`${displayNameOf(window)} is not available ${weekdayLabel(weekdayFromIso(window.date), { long: true })} ${formatRange(window.startTime, window.endTime)}.`);
  }
}

async function assertNoOverlap(candidate, { ignoreVisitId } = {}) {
  const occupying = await occupyingForCaregiver(candidate, ignoreVisitId);
  const conflict = findOccupyingConflict(candidate, occupying, { ignoreVisitId });
  if (conflict) {
    throw new ScheduleOverlapError(overlapMessage(conflict, displayNameOf(candidate), kindOf(candidate)), conflict);
  }
}

async function syncPresence(visit, availability) {
  try {
    const occupying = (await occupyingForCaregiver(visit))
      .filter((item) => item.status === VISIT_STATUS.CHECKED_IN && item.id !== visit.id);
    const nextVisit = occupying[0] || (availability === AVAILABILITY.ON_DUTY ? visit : null);
    await updateOwnPresence(visit.seniorId, {
      availability: occupying.length ? AVAILABILITY.ON_DUTY : availability,
      lastSeenAt: nowIso(),
      nextVisit: nextVisit
        ? `${weekdayLabel(weekdayFromIso(nextVisit.date))} · ${formatRange(nextVisit.startTime, nextVisit.endTime)}`
        : "",
    });
  } catch {
    // Presence is secondary to the visit record.
  }
}

export function visitToEvent(visit) {
  const completed = visit.status === VISIT_STATUS.CHECKED_OUT;
  return createScheduleEvent({
    id: visit.id,
    title: visit.title,
    weekday: weekdayFromIso(visit.date),
    time: visit.startTime,
    type: kindOf(visit) === PROFESSIONAL_KIND.PRACTITIONER ? "appointment" : "care",
    assignee: visit.caregiverName,
    status: completed ? "completed" : "scheduled",
    notes: visit.notes.at(-1)?.body || "",
    date: visit.date,
    endTime: visit.endTime,
    visitId: visit.id,
    visitStatus: visit.status,
    seniorId: visit.seniorId,
    seniorName: visit.seniorName,
  });
}

export async function listVisits(filter = {}, session = getSession()) {
  const seniorId = filter.seniorId || (isProfessionalSession(session) ? "" : session?.seniorId);
  const visits = await readVisits({
    seniorId,
    session,
    caregiver: filter.caregiver,
  });
  return (await attachReports(visits)).sort(bySoonest);
}

export async function listVisitsForWeek(now = new Date(), session = getSession()) {
  const days = new Set(weekDays(now).map((day) => day.date));
  const visits = await listVisits({}, session);
  return visits.filter((visit) => days.has(visit.date) && visit.status !== VISIT_STATUS.DECLINED && visit.status !== VISIT_STATUS.CANCELLED);
}

export async function listAvailability(filter = {}, session = getSession()) {
  return readAvailability({
    session,
    caregiver: filter.caregiver,
  });
}

export async function previewScheduleConflict(input, session = getSession()) {
  if (usesLiveAuth()) {
    const senior = input.seniorId
      ? { id: input.seniorId, familyId: input.familyId }
      : await getSeniorForUser(session);
    const familyId = input.familyId || senior?.familyId || senior?.ownerId || null;
    const seniorId = input.seniorId || senior?.id || null;
    const window = windowInstants(input.date, input.startTime, input.endTime, input.timeZone);
    if (familyId && seniorId && window) {
      const result = await callCloudFunction("checkProfessionalAvailability", {
        familyId,
        seniorId,
        caregiverId: input.caregiverMemberId || input.caregiverId || null,
        professionalId: input.caregiverUserId || null,
        professionalRole: input.professionalKind === PROFESSIONAL_KIND.PRACTITIONER
          ? "healthPractitioner"
          : "caregiver",
        startAtMs: window.startsAt,
        endAtMs: window.endsAt,
        excludeScheduleId: input.visitId || null,
      });
      const available = result?.available !== false;
      return {
        ok: available,
        conflict: available ? null : { message: result?.message || "" },
        message: result?.message || (available ? "" : "That time is not available."),
        overlap: !available,
      };
    }
    return { ok: true, conflict: null, message: "" };
  }
  const draft = normalizeVisitInput(input, session);
  try {
    assertValidWindow(draft);
    await assertFitsAvailability(draft);
    await assertNoOverlap(draft, { ignoreVisitId: input.visitId });
    return { ok: true, conflict: null, message: "" };
  } catch (error) {
    return {
      ok: false,
      conflict: error.conflict ?? null,
      message: error.message || "That time is not available.",
      overlap: error instanceof ScheduleOverlapError,
    };
  }
}

export async function requestScheduleVisit(input, session = getSession()) {
  if (usesLiveAuth()) {
    const senior = input.seniorId
      ? await getSeniorById(input.seniorId)
      : await getSeniorForUser(session);
    if (!senior) throw new Error("Create a senior profile before requesting a visit.");
    const circle = await listCareCircle(senior.id);
    assertCanRequest(session, senior, circle);

    const kind = input.professionalKind === PROFESSIONAL_KIND.PRACTITIONER
      ? PROFESSIONAL_KIND.PRACTITIONER
      : PROFESSIONAL_KIND.CAREGIVER;
    const professional = findProfessionalMember(
      circle,
      input.caregiverId || input.practitionerId || input.caregiverEmail,
      kind,
    );
    if (!professional) {
      throw new Error(kind === PROFESSIONAL_KIND.PRACTITIONER
        ? "Choose a health practitioner on this circle."
        : "Choose a caregiver on this circle.");
    }
    await assertProfessionalEligible(professional);

    const window = windowInstants(
      input.date,
      input.startTime,
      input.endTime,
      input.timeZone || professional.timeZone || session?.timeZone,
    );
    if (!window) throw new Error("Choose a valid date and time.");
    const familyId = senior.familyId || senior.ownerId || session.familyId || session.id;
    const assignment = await shiftAssignmentForMember(professional, familyId);
    const result = await callCloudFunction("saveCareShift", {
      familyId,
      seniorId: senior.id,
      startAtMs: window.startsAt,
      endAtMs: window.endsAt,
      caregiverId: assignment.caregiverId,
      professionalId: assignment.professionalId,
      professionalRole: assignment.professionalRole,
      professionalDisplayName: assignment.professionalDisplayName,
      careLocation: String(input.careLocation || ""),
      careInstructions: String(input.careInstructions || ""),
      tasks: Array.isArray(input.tasks) ? input.tasks : [],
      recurrence: input.recurrence || "none",
      status: "requested",
    }, { fallback: "That visit could not be requested." });
    const saved = await readShiftByPath(senior.id, result.shiftId);
    trackProductEvent(PRODUCT_EVENTS.SCHEDULE_CREATED, {
      dedupeKey: `schedule_created:${saved.id}`,
      visitId: saved.id,
      seniorId: saved.seniorId,
      professionalKind: saved.professionalKind || "",
    }, session);
    return saved;
  }

  const senior = await getSeniorForUser(session);
  const circle = senior ? await listCareCircle(senior.id) : [];
  assertCanRequest(session, senior, circle);

  const kind = input.professionalKind === PROFESSIONAL_KIND.PRACTITIONER
    ? PROFESSIONAL_KIND.PRACTITIONER
    : PROFESSIONAL_KIND.CAREGIVER;
  const professional = findProfessionalMember(
    circle,
    input.caregiverId || input.practitionerId || input.caregiverEmail,
    kind,
  );
  if (!professional) {
    throw new Error(kind === PROFESSIONAL_KIND.PRACTITIONER
      ? "Choose a health practitioner on this circle."
      : "Choose a caregiver on this circle.");
  }
  await assertProfessionalEligible(professional);

  const draft = createScheduleVisit({
    id: newId("visit"),
    professionalKind: kind,
    seniorId: senior.id,
    seniorName: senior.displayName,
    familyId: senior.ownerId || session.id,
    familyName: session.displayName,
    caregiverUserId: professional.userId,
    caregiverEmail: professional.email,
    caregiverName: professional.name,
    caregiverMemberId: professional.id,
    title: String(input.title || (kind === PROFESSIONAL_KIND.PRACTITIONER ? "Appointment" : "Care visit")).trim()
      || (kind === PROFESSIONAL_KIND.PRACTITIONER ? "Appointment" : "Care visit"),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    originalEndTime: input.endTime,
    timeZone: resolveTimeZone(input.timeZone || professional.timeZone || session?.timeZone),
    status: VISIT_STATUS.REQUESTED,
    requestedBy: session.id,
    requestedByName: session.displayName,
    requestedAt: nowIso(),
    createdAt: nowIso(),
  });

  assertValidWindow(draft);
  await assertFitsAvailability(draft);
  await assertNoOverlap(draft);
  const saved = await commitVisit(draft);
  await notifyQuietly([{ userId: professional.userId, email: professional.email }], {
    type: NOTIFICATION_TYPES.SCHEDULE_REQUEST,
    title: `${saved.title} requested`,
    body: `${session.displayName} requested ${saved.title} for ${senior.displayName} on ${saved.date}.`,
    seniorId: senior.id,
    visitId: saved.id,
    entityType: "visit",
    entityId: saved.id,
  }, session);
  trackProductEvent(PRODUCT_EVENTS.SCHEDULE_CREATED, {
    dedupeKey: `schedule_created:${saved.id}`,
    visitId: saved.id,
    seniorId: saved.seniorId,
    professionalKind: saved.professionalKind || "",
  }, session);
  return saved;
}

export async function acceptScheduleVisit(visitId, session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    await callCloudFunction("respondToCareShift", {
      familyId: visit.familyId,
      seniorId: visit.seniorId,
      shiftId: visitId,
      action: "accept",
    }, { fallback: "That visit could not be accepted." });
    return readShiftByPath(visit.seniorId, visitId);
  }
  const visit = await requireVisit(visitId);
  assertAssignedCaregiver(visit, session);
  await assertProfessionalEligible(session);
  if (visit.status !== VISIT_STATUS.REQUESTED) {
    throw new Error("Only requested visits can be accepted.");
  }
  await assertFitsAvailability(visit);
  const next = visitFrom({
    ...visit,
    status: VISIT_STATUS.ACCEPTED,
    respondedAt: nowIso(),
  });
  const saved = await commitVisit(next);
  await notifyQuietly([{ userId: visit.requestedBy }, { userId: visit.familyId }], {
    type: NOTIFICATION_TYPES.SCHEDULE_ACCEPTED,
    title: `${saved.title} accepted`,
    body: `${session.displayName} accepted ${saved.title} on ${saved.date}.`,
    seniorId: visit.seniorId,
    visitId: saved.id,
    entityType: "visit",
    entityId: saved.id,
  }, session);
  return saved;
}

export async function declineScheduleVisit(visitId, reason = "", session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    await callCloudFunction("respondToCareShift", {
      familyId: visit.familyId,
      seniorId: visit.seniorId,
      shiftId: visitId,
      action: "decline",
    }, { fallback: "That visit could not be declined." });
    return readShiftByPath(visit.seniorId, visitId);
  }
  const visit = await requireVisit(visitId);
  assertAssignedCaregiver(visit, session);
  if (visit.status !== VISIT_STATUS.REQUESTED) {
    throw new Error("Only requested visits can be declined.");
  }
  const next = visitFrom({
    ...visit,
    status: VISIT_STATUS.DECLINED,
    declineReason: String(reason || "").trim(),
    respondedAt: nowIso(),
  });
  const saved = await commitVisit(next);
  await notifyQuietly([{ userId: visit.requestedBy }, { userId: visit.familyId }], {
    type: NOTIFICATION_TYPES.SCHEDULE_CHANGED,
    title: `${saved.title} declined`,
    body: `${session.displayName} declined ${saved.title}${saved.declineReason ? `: ${saved.declineReason}` : "."}`,
    seniorId: visit.seniorId,
    visitId: saved.id,
    entityType: "visit",
    entityId: saved.id,
  }, session);
  return saved;
}

export async function cancelScheduleVisit(visitId, session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    const senior = await getSeniorForUser(session);
    const circle = senior ? await listCareCircle(senior.id) : [];
    const assigned = matchesCaregiver(visit, session);
    if (!assigned) assertCanRequest(session, senior, circle);
    if (![VISIT_STATUS.REQUESTED, VISIT_STATUS.ACCEPTED].includes(visit.status)) {
      throw new Error("That visit can no longer be cancelled.");
    }
    const sdk = getFirestoreSdk();
    await writeShiftFields(visit.seniorId, visitId, {
      status: VISIT_STATUS.CANCELLED,
      statusUpdatedBy: session.id,
      statusUpdatedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    });
    return readShiftByPath(visit.seniorId, visitId);
  }
  const visit = await requireVisit(visitId);
  const senior = await getSeniorForUser(session);
  const circle = senior ? await listCareCircle(senior.id) : [];
  const assigned = matchesCaregiver(visit, session);
  if (!assigned) assertCanRequest(session, senior, circle);
  if (![VISIT_STATUS.REQUESTED, VISIT_STATUS.ACCEPTED].includes(visit.status)) {
    throw new Error("That visit can no longer be cancelled.");
  }
  const saved = await commitVisit(visitFrom({
    ...visit,
    status: VISIT_STATUS.CANCELLED,
    respondedAt: nowIso(),
  }));
  await notifyQuietly([
    { userId: visit.caregiverUserId, email: visit.caregiverEmail },
    { userId: visit.requestedBy },
    { userId: visit.familyId },
  ], {
    type: NOTIFICATION_TYPES.SCHEDULE_CHANGED,
    title: `${saved.title} cancelled`,
    body: `${session.displayName} cancelled ${saved.title} on ${saved.date}.`,
    seniorId: visit.seniorId,
    visitId: saved.id,
    entityType: "visit",
    entityId: saved.id,
  }, session);
  return saved;
}

export async function checkInVisit(visitId, session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    assertAssignedCaregiver(visit, session);
    if (visit.status !== VISIT_STATUS.ACCEPTED) {
      throw new Error("Accept the visit before checking in.");
    }
    if (visit.date !== civilDateInZone(Date.now(), visit.timeZone || session?.timeZone)) {
      throw new Error("Check in on the day of the visit.");
    }
    const sdk = getFirestoreSdk();
    const checkInLocation = await visitLocation();
    await writeShiftFields(visit.seniorId, visitId, {
      checkInAt: sdk.Timestamp.fromDate(new Date()),
      checkInLocation,
      checkInBy: session.id,
      status: VISIT_STATUS.CHECKED_IN,
      statusUpdatedBy: session.id,
      statusUpdatedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    });
    const next = await readShiftByPath(visit.seniorId, visitId);
    await syncPresence(next, AVAILABILITY.ON_DUTY);
    await logVisitActivity(next, {
      kind: CARE_HISTORY_KINDS.CHECK_IN,
      title: "Caregiver checked in",
      body: `${next.caregiverName || session.displayName} arrived for ${next.title}.`,
      sourceId: `${next.id}:check_in`,
      occurredAt: next.checkedInAt,
    }, session);
    return next;
  }
  const visit = await requireVisit(visitId);
  assertAssignedCaregiver(visit, session);
  if (visit.status !== VISIT_STATUS.ACCEPTED) {
    throw new Error("Accept the visit before checking in.");
  }
  if (visit.date !== civilDateInZone(Date.now(), visit.timeZone || session?.timeZone)) {
    throw new Error("Check in on the day of the visit.");
  }
  const next = await commitVisit(visitFrom({
    ...visit,
    status: VISIT_STATUS.CHECKED_IN,
    checkedInAt: nowIso(),
  }));
  await syncPresence(next, AVAILABILITY.ON_DUTY);
  await logVisitActivity(next, {
    kind: CARE_HISTORY_KINDS.CHECK_IN,
    title: "Caregiver checked in",
    body: `${next.caregiverName || session.displayName} arrived for ${next.title}.`,
    sourceId: `${next.id}:check_in`,
    occurredAt: next.checkedInAt,
  }, session);
  return next;
}

export async function checkOutVisit(visitId, note = "", session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    assertAssignedCaregiver(visit, session);
    if (visit.status !== VISIT_STATUS.CHECKED_IN) {
      throw new Error("Check in before you check out.");
    }
    const sdk = getFirestoreSdk();
    const checkedOutAt = new Date();
    const checkedInMs = Date.parse(visit.checkedInAt || "") || checkedOutAt.getTime();
    const durationMinutes = Math.max(0, Math.round((checkedOutAt.getTime() - checkedInMs) / 60000));
    const checkOutLocation = await visitLocation();
    await writeShiftFields(visit.seniorId, visitId, {
      checkOutAt: sdk.Timestamp.fromDate(checkedOutAt),
      checkOutLocation,
      checkOutBy: session.id,
      completedTasks: [],
      visitDurationMinutes: durationMinutes,
      status: VISIT_STATUS.CHECKED_OUT,
      statusUpdatedBy: session.id,
      statusUpdatedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    });
    const body = String(note || "").trim();
    if (body) {
      await writeVisitReport(visit, { body }, session, { note: true });
    }
    const next = await readShiftByPath(visit.seniorId, visitId);
    await syncPresence(next, AVAILABILITY.AVAILABLE);
    await logVisitActivity(next, {
      kind: CARE_HISTORY_KINDS.CHECK_OUT,
      title: "Caregiver checked out",
      body: `${next.caregiverName || session.displayName} finished ${next.title}.`,
      sourceId: `${next.id}:check_out`,
      occurredAt: next.checkedOutAt,
    }, session);
    if (body) {
      await logVisitActivity(next, {
        kind: CARE_HISTORY_KINDS.VISIT_NOTE,
        type: ACTIVITY_TYPES.CARE,
        title: "Visit note added",
        body,
        sourceId: `${next.id}:note:checkout`,
        occurredAt: next.checkedOutAt,
      }, session);
    }
    trackProductEvent(PRODUCT_EVENTS.VISIT_COMPLETED, {
      dedupeKey: `visit_completed:${next.id}`,
      visitId: next.id,
      seniorId: next.seniorId,
      professionalKind: next.professionalKind || "",
    }, session);
    return next;
  }
  const visit = await requireVisit(visitId);
  assertAssignedCaregiver(visit, session);
  if (visit.status !== VISIT_STATUS.CHECKED_IN) {
    throw new Error("Check in before you check out.");
  }
  const notes = [...visit.notes];
  const body = String(note || "").trim();
  if (body) {
    notes.push(createVisitNote({
      id: newId("note"),
      body,
      author: session.displayName,
      authorId: session.id,
      createdAt: nowIso(),
    }));
  }
  const next = await commitVisit(visitFrom({
    ...visit,
    status: VISIT_STATUS.CHECKED_OUT,
    checkedOutAt: nowIso(),
    notes,
  }));
  await syncPresence(next, AVAILABILITY.AVAILABLE);
  await logVisitActivity(next, {
    kind: CARE_HISTORY_KINDS.CHECK_OUT,
    title: "Caregiver checked out",
    body: `${next.caregiverName || session.displayName} finished ${next.title}.`,
    sourceId: `${next.id}:check_out`,
    occurredAt: next.checkedOutAt,
  }, session);
  if (body) {
    const note = next.notes.at(-1);
    await logVisitActivity(next, {
      kind: CARE_HISTORY_KINDS.VISIT_NOTE,
      type: ACTIVITY_TYPES.CARE,
      title: "Visit note added",
      body,
      sourceId: `${next.id}:note:${note?.id || "checkout"}`,
      occurredAt: note?.createdAt || next.checkedOutAt,
    }, session);
  }
  trackProductEvent(PRODUCT_EVENTS.VISIT_COMPLETED, {
    dedupeKey: `visit_completed:${next.id}`,
    visitId: next.id,
    seniorId: next.seniorId,
    professionalKind: next.professionalKind || "",
  }, session);
  return next;
}

export async function addVisitNote(visitId, body, session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    const text = String(body || "").trim();
    if (!text) throw new Error("Write a visit note.");
    const assigned = matchesCaregiver(visit, session);
    if (!assigned) {
      const senior = await getSeniorForUser(session);
      const circle = senior ? await listCareCircle(senior.id) : [];
      assertCanRequest(session, senior, circle);
    }
    if (![VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN, VISIT_STATUS.CHECKED_OUT].includes(visit.status)) {
      throw new Error("Notes can be added after the visit is accepted.");
    }
    const sdk = getFirestoreSdk();
    const snap = await sdk.getDocs(sdk.query(
      visitReportsCol(visit.seniorId),
      sdk.where("shiftId", "==", visit.id),
      sdk.limit(1),
    ));
    const existing = snap.docs[0];
    let saved = null;
    if (existing) {
      const current = existing.data() || {};
      const prior = String(current.notes || "").trim();
      const notes = prior ? `${prior}\n${text}` : text;
      const update = {
        notes,
        updatedAt: sdk.serverTimestamp(),
      };
      const notesLog = Array.isArray(current.notesLog) ? [...current.notesLog] : null;
      if (notesLog) {
        notesLog.push({
          id: newId("note"),
          body: text,
          author: session?.displayName || "",
          authorId: session?.id || "",
          createdAt: nowIso(),
        });
        update.notesLog = notesLog;
      }
      await sdk.updateDoc(existing.ref, update);
      saved = {
        ...visit,
        report: reportFromDoc({ ...current, notes, ...(notesLog ? { notesLog } : {}) }),
      };
    } else {
      await writeVisitReport(visit, { body: text }, session, { note: true });
      saved = { ...visit, report: reportFromInput(visit, { summary: text }, session) };
    }
    await logVisitActivity(saved, {
      kind: CARE_HISTORY_KINDS.VISIT_NOTE,
      type: ACTIVITY_TYPES.CARE,
      title: "Visit note added",
      body: text,
      sourceId: `${saved.id}:note:note`,
      occurredAt: nowIso(),
    }, session);
    return saved;
  }
  const visit = await requireVisit(visitId);
  const text = String(body || "").trim();
  if (!text) throw new Error("Write a visit note.");
  const assigned = matchesCaregiver(visit, session);
  if (!assigned) {
    const senior = await getSeniorForUser(session);
    const circle = senior ? await listCareCircle(senior.id) : [];
    assertCanRequest(session, senior, circle);
  }
  if (![VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN, VISIT_STATUS.CHECKED_OUT].includes(visit.status)) {
    throw new Error("Notes can be added after the visit is accepted.");
  }
  const note = createVisitNote({
    id: newId("note"),
    body: text,
    author: session.displayName,
    authorId: session.id,
    createdAt: nowIso(),
  });
  const saved = await saveVisitRecord(visitFrom({
    ...visit,
    notes: [
      ...visit.notes,
      note,
    ],
  }));
  await logVisitActivity(saved, {
    kind: CARE_HISTORY_KINDS.VISIT_NOTE,
    type: ACTIVITY_TYPES.CARE,
    title: "Visit note added",
    body: text,
    sourceId: `${saved.id}:note:${note.id}`,
    occurredAt: note.createdAt,
  }, session);
  return saved;
}

export async function submitVisitReport(visitId, input, session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    assertAssignedCaregiver(visit, session);
    if (visit.status !== VISIT_STATUS.CHECKED_OUT && visit.status !== VISIT_STATUS.CHECKED_IN) {
      throw new Error("Write the visit report after you have been with them.");
    }
    const summary = String(input.summary || "").trim();
    if (!summary) throw new Error("Add a short summary for the family.");
    const report = reportFromInput(visit, input, session);
    await writeVisitReport(visit, input, session);
    const saved = { ...visit, report };
    await logVisitActivity(saved, {
      kind: CARE_HISTORY_KINDS.VISIT_REPORT,
      type: ACTIVITY_TYPES.CARE,
      title: "Visit report submitted",
      body: summary,
      sourceId: `${saved.id}:report`,
      occurredAt: report.submittedAt,
    }, session);
    return saved;
  }
  const visit = await requireVisit(visitId);
  assertAssignedCaregiver(visit, session);
  if (visit.status !== VISIT_STATUS.CHECKED_OUT && visit.status !== VISIT_STATUS.CHECKED_IN) {
    throw new Error("Write the visit report after you have been with them.");
  }
  const summary = String(input.summary || "").trim();
  if (!summary) throw new Error("Add a short summary for the family.");
  const submittedAt = nowIso();
  const saved = await saveVisitRecord(visitFrom({
    ...visit,
    report: createVisitReport({
      summary,
      mood: input.mood || "typical",
      meals: String(input.meals || "").trim(),
      mobility: String(input.mobility || "").trim(),
      concerns: String(input.concerns || "").trim(),
      followUp: String(input.followUp || "").trim(),
      submittedAt,
      submittedBy: session.displayName,
      submittedById: session.id,
    }),
  }));
  await logVisitActivity(saved, {
    kind: CARE_HISTORY_KINDS.VISIT_REPORT,
    type: ACTIVITY_TYPES.CARE,
    title: "Visit report submitted",
    body: summary,
    sourceId: `${saved.id}:report`,
    occurredAt: submittedAt,
  }, session);
  const urgent = saved.report?.mood === "unwell" || Boolean(saved.report?.concerns);
  await notifyQuietly([{ userId: visit.familyId }, { userId: visit.requestedBy }], {
    type: urgent ? NOTIFICATION_TYPES.EMERGENCY_ALERT : NOTIFICATION_TYPES.CARE_UPDATE,
    title: urgent ? `${saved.caregiverName || session.displayName} flagged ${saved.seniorName}` : "Visit report submitted",
    body: summary,
    seniorId: visit.seniorId,
    visitId: saved.id,
  }, session);
  return saved;
}

export async function modifyScheduleVisit(visitId, input, session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    const raw = await readShiftRaw(visit.seniorId, visitId);
    const assigned = matchesCaregiver(visit, session);
    const practitionerOwn = assigned
      && kindOf(visit) === PROFESSIONAL_KIND.PRACTITIONER
      && session?.role === ROLES.HEALTH_PRACTITIONER;
    if (!practitionerOwn) {
      const senior = await getSeniorForUser(session);
      const circle = senior ? await listCareCircle(senior.id) : [];
      assertCanRequest(session, senior, circle);
    }
    if (![VISIT_STATUS.REQUESTED, VISIT_STATUS.ACCEPTED].includes(visit.status)) {
      throw new Error("Only upcoming visits can be changed. Extend a visit that is already under way.");
    }
    const window = windowInstants(
      input.date || visit.date,
      input.startTime || visit.startTime,
      input.endTime || visit.endTime,
      visit.timeZone,
    );
    if (!window) throw new Error("Choose a valid date and time.");
    await callCloudFunction("saveCareShift", {
      familyId: raw?.familyId || visit.familyId,
      seniorId: visit.seniorId,
      shiftId: visitId,
      startAtMs: window.startsAt,
      endAtMs: window.endsAt,
      caregiverId: raw?.caregiverId ?? null,
      professionalId: raw?.professionalId ?? null,
      professionalRole: raw?.professionalRole ?? null,
      professionalDisplayName: raw?.caregiverDisplayName ?? null,
      careLocation: raw?.careLocation || "",
      careInstructions: raw?.careInstructions || "",
      tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
      recurrence: raw?.recurrence || "none",
    }, { fallback: "That visit could not be updated." });
    return readShiftByPath(visit.seniorId, visitId);
  }
  const visit = await requireVisit(visitId);
  const assigned = matchesCaregiver(visit, session);
  const practitionerOwn = assigned
    && kindOf(visit) === PROFESSIONAL_KIND.PRACTITIONER
    && session?.role === ROLES.HEALTH_PRACTITIONER;
  if (!practitionerOwn) {
    const senior = await getSeniorForUser(session);
    const circle = senior ? await listCareCircle(senior.id) : [];
    assertCanRequest(session, senior, circle);
  }
  if (![VISIT_STATUS.REQUESTED, VISIT_STATUS.ACCEPTED].includes(visit.status)) {
    throw new Error("Only upcoming visits can be changed. Extend a visit that is already under way.");
  }

  const next = visitFrom({
    ...visit,
    title: String(input.title || visit.title).trim() || visit.title,
    date: input.date || visit.date,
    startTime: input.startTime || visit.startTime,
    endTime: input.endTime || visit.endTime,
    originalEndTime: visit.originalEndTime || visit.endTime,
    extensionMinutes: 0,
    modifiedAt: nowIso(),
    modifiedBy: session.displayName,
  });
  assertValidWindow(next);
  await assertFitsAvailability(next);
  await assertNoOverlap(next, { ignoreVisitId: visit.id });
  const saved = await commitVisit(next, { ignoreVisitId: visit.id });
  await notifyQuietly([
    { userId: visit.caregiverUserId, email: visit.caregiverEmail },
    { userId: visit.requestedBy },
    { userId: visit.familyId },
  ], {
    type: NOTIFICATION_TYPES.SCHEDULE_CHANGED,
    title: `${saved.title} was changed`,
    body: `${session.displayName} moved ${saved.title} to ${saved.date} · ${saved.startTime}–${saved.endTime}.`,
    seniorId: visit.seniorId,
    visitId: saved.id,
    entityType: "visit",
    entityId: saved.id,
  }, session);
  return saved;
}

export async function extendScheduleVisit(visitId, extraMinutes, session = getSession()) {
  if (usesLiveAuth()) {
    const visit = await requireVisit(visitId);
    const raw = await readShiftRaw(visit.seniorId, visitId);
    const minutes = Number(extraMinutes);
    if (!Number.isFinite(minutes) || minutes < 15) {
      throw new Error("Extend the visit by at least 15 minutes.");
    }
    const assigned = matchesCaregiver(visit, session);
    if (!assigned) {
      const senior = await getSeniorForUser(session);
      const circle = senior ? await listCareCircle(senior.id) : [];
      assertCanRequest(session, senior, circle);
    }
    if (![VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN].includes(visit.status)) {
      throw new Error("Only an accepted or in-progress visit can be extended.");
    }
    const endTime = addMinutesToTime(visit.endTime, minutes);
    if (toMinutes(endTime) <= toMinutes(visit.endTime) || toMinutes(endTime) > 24 * 60 - 1) {
      throw new Error("That extension would run past midnight. Split it into a new visit instead.");
    }
    const window = windowInstants(visit.date, visit.startTime, endTime, visit.timeZone);
    if (!window) throw new Error("Choose a valid date and time.");
    await callCloudFunction("saveCareShift", {
      familyId: raw?.familyId || visit.familyId,
      seniorId: visit.seniorId,
      shiftId: visitId,
      startAtMs: window.startsAt,
      endAtMs: window.endsAt,
      caregiverId: raw?.caregiverId ?? null,
      professionalId: raw?.professionalId ?? null,
      professionalRole: raw?.professionalRole ?? null,
      professionalDisplayName: raw?.caregiverDisplayName ?? null,
      careLocation: raw?.careLocation || "",
      careInstructions: raw?.careInstructions || "",
      tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
      recurrence: raw?.recurrence || "none",
    }, { fallback: "That visit could not be extended." });
    return readShiftByPath(visit.seniorId, visitId);
  }
  const visit = await requireVisit(visitId);
  const minutes = Number(extraMinutes);
  if (!Number.isFinite(minutes) || minutes < 15) {
    throw new Error("Extend the visit by at least 15 minutes.");
  }
  const assigned = matchesCaregiver(visit, session);
  if (!assigned) {
    const senior = await getSeniorForUser(session);
    const circle = senior ? await listCareCircle(senior.id) : [];
    assertCanRequest(session, senior, circle);
  }
  if (![VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN].includes(visit.status)) {
    throw new Error("Only an accepted or in-progress visit can be extended.");
  }

  const endTime = addMinutesToTime(visit.endTime, minutes);
  if (toMinutes(endTime) <= toMinutes(visit.endTime) || toMinutes(endTime) > 24 * 60 - 1) {
    throw new Error("That extension would run past midnight. Split it into a new visit instead.");
  }

  const next = visitFrom({
    ...visit,
    endTime,
    originalEndTime: visit.originalEndTime || visit.endTime,
    extensionMinutes: (visit.extensionMinutes || 0) + minutes,
    modifiedAt: nowIso(),
    modifiedBy: session.displayName,
  });
  assertValidWindow(next);
  await assertFitsAvailability(next);
  await assertNoOverlap(next, { ignoreVisitId: visit.id });
  const saved = await commitVisit(next, { ignoreVisitId: visit.id });
  await notifyQuietly([
    { userId: visit.caregiverUserId, email: visit.caregiverEmail },
    { userId: visit.requestedBy },
    { userId: visit.familyId },
  ], {
    type: NOTIFICATION_TYPES.SCHEDULE_CHANGED,
    title: `${saved.title} was extended`,
    body: `${session.displayName} extended ${saved.title} by ${minutes} minutes.`,
    seniorId: visit.seniorId,
    visitId: saved.id,
    entityType: "visit",
    entityId: saved.id,
  }, session);
  return saved;
}

export async function saveCaregiverAvailability(input, session = getSession()) {
  if (!isProfessionalSession(session) && session?.role !== ROLES.ADMIN) {
    throw new Error("Only the assigned professional can set this availability.");
  }

  if (usesLiveAuth()) {
    const result = await callCloudFunction("saveProfessionalAvailability", {
      weekly: input.weekly,
      block: input.block,
      timeZone: input.timeZone || session?.timeZone,
    });
    if (result?.timeZone && session?.id) {
      setSession({ ...session, timeZone: result.timeZone });
    }
    return listAvailability({}, session);
  }

  const kind = professionalKindFor(session);
  const zone = resolveTimeZone(input.timeZone || session?.timeZone);
  const existing = (await readAvailability({ session })).filter((item) => item.kind === AVAILABILITY_KIND.WEEKLY);
  const kept = [];

  if (Array.isArray(input.weekly)) {
    for (const day of input.weekly) {
      if (!day?.enabled) continue;
      const window = createAvailabilityWindow({
        id: day.id || newId("av"),
        professionalKind: kind,
        caregiverUserId: session.id,
        caregiverEmail: session.email,
        caregiverName: session.displayName,
        kind: AVAILABILITY_KIND.WEEKLY,
        weekday: Number(day.weekday),
        startTime: day.startTime,
        endTime: day.endTime,
        timeZone: zone,
        active: true,
        createdAt: nowIso(),
      });
      if (toMinutes(window.startTime) == null || toMinutes(window.endTime) == null) {
        throw new Error("Set a start and end for each available day.");
      }
      if (toMinutes(window.endTime) <= toMinutes(window.startTime)) {
        throw new Error("Availability must end after it starts.");
      }
      kept.push(await saveAvailabilityRecord(window));
    }

    const keptIds = new Set(kept.map((item) => item.id));
    for (const window of existing) {
      if (keptIds.has(window.id)) continue;
      deleteLocalRecord(AVAIL_KEY, window.id);
    }
  }

  if (input.block) {
    const block = createAvailabilityWindow({
      id: newId("block"),
      professionalKind: kind,
      caregiverUserId: session.id,
      caregiverEmail: session.email,
      caregiverName: session.displayName,
      kind: AVAILABILITY_KIND.BLOCK,
      date: input.block.date,
      startTime: input.block.startTime,
      endTime: input.block.endTime,
      timeZone: zone,
      notes: input.block.notes || "Time off",
      createdAt: nowIso(),
    });
    assertValidWindow(block);
    await saveAvailabilityRecord(block);
  }

  return listAvailability({}, session);
}

export async function savePractitionerAvailability(input, session = getSession()) {
  return saveCaregiverAvailability(input, session);
}

export async function addAvailabilityBlock(input, session = getSession()) {
  return saveCaregiverAvailability({ block: input }, session);
}

export async function getScheduleState(session = getSession(), now = new Date()) {
  const senior = await getSeniorForUser(session);
  const circle = senior ? await listCareCircle(senior.id) : [];
  const caregivers = activeCaregivers(circle);
  const practitioners = activePractitioners(circle);
  const professionals = [...caregivers, ...practitioners];
  const isCaregiver = session?.role === ROLES.CAREGIVER;
  const isPractitioner = session?.role === ROLES.HEALTH_PRACTITIONER;
  const isProfessional = isCaregiver || isPractitioner;
  const visits = isProfessional
    ? await listVisits({ caregiver: { caregiverUserId: session.id, caregiverEmail: session.email } }, session)
    : await listVisits({ seniorId: senior?.id }, session);
  const availability = isProfessional
    ? await listAvailability({}, session)
    : (await Promise.all(professionals.map((member) => listAvailability({
      caregiver: { caregiverUserId: member.userId, caregiverEmail: member.email },
    }, session)))).flat();

  const professionalsWithZone = await withVerificationStatus(professionals.map((member) => {
    const zone = availability.find((item) => (
      item.timeZone
      && (item.caregiverUserId === member.userId || emailsEqual(item.caregiverEmail, member.email))
    ))?.timeZone;
    return { ...member, timeZone: resolveTimeZone(zone || session?.timeZone) };
  }));
  const caregiversWithZone = professionalsWithZone.filter((member) => member.kind === CIRCLE_KINDS.CAREGIVER);
  const practitionersWithZone = professionalsWithZone.filter((member) => member.kind === CIRCLE_KINDS.PRACTITIONER);

  const actor = circle.find((member) => (
    member.userId === session.id || emailsEqual(member.email, session.email)
  )) ?? null;
  const canManage = Boolean(senior) && !isProfessional && (
    session.role === ROLES.ADMIN
    || senior.ownerId === session.id
    || hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_SCHEDULE)
  );

  const todayDate = (item) => civilDateInZone(now.getTime?.() ?? now, item.timeZone || session?.timeZone);
  const visible = visits.filter((item) => item.status !== VISIT_STATUS.CANCELLED || isProfessional);
  const pending = visible.filter((item) => item.status === VISIT_STATUS.REQUESTED);
  const today = visible.filter((item) => item.date === todayDate(item) && item.status !== VISIT_STATUS.DECLINED && item.status !== VISIT_STATUS.CANCELLED);
  const upcoming = visible.filter((item) => (
    item.date >= todayDate(item)
    && [VISIT_STATUS.REQUESTED, VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN].includes(item.status)
  ));
  const reports = visible.filter((item) => item.report);

  return {
    session,
    senior,
    circle,
    caregivers: caregiversWithZone,
    practitioners: practitionersWithZone,
    professionals: professionalsWithZone,
    visits: visible.sort(bySoonest),
    availability,
    timeZone: resolveTimeZone(
      availability.find((item) => item.timeZone)?.timeZone || session?.timeZone,
    ),
    pending,
    today,
    upcoming,
    reports,
    week: weekDays(now),
    isCaregiver,
    isPractitioner,
    isProfessional,
    canManage,
    canSetAvailability: isProfessional || session?.role === ROLES.ADMIN,
    stats: {
      pending: pending.length,
      today: today.length,
      upcoming: upcoming.length,
      reports: reports.length,
    },
  };
}

async function requireVisit(visitId) {
  const visit = await readVisitById(visitId);
  if (!visit) throw new Error("That visit could not be found.");
  return visit;
}

function normalizeVisitInput(input, session) {
  return {
    id: input.visitId || "preview",
    seniorId: input.seniorId || session?.seniorId,
    seniorName: input.seniorName || "",
    caregiverUserId: input.caregiverUserId || "",
    caregiverEmail: input.caregiverEmail || "",
    professionalKind: input.professionalKind || professionalKindFor(session),
    caregiverName: input.caregiverName || "This caregiver",
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    timeZone: resolveTimeZone(input.timeZone || session?.timeZone),
    status: VISIT_STATUS.ACCEPTED,
  };
}

function bySoonest(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || String(a.startTime).localeCompare(String(b.startTime));
}

export { durationMinutes, readAvailabilityById };
