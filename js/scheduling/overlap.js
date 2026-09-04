import { PROFESSIONAL_KIND, VISIT_STATUS, professionalNoun } from "../config/scheduling.js";
import { durationMinutes, formatDateLabel, formatRange, toMinutes } from "./time.js";
import { instantsOverlap, timeZoneAbbr, windowInstants } from "./timezone.js";

export const OCCUPYING_STATUSES = [VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN];

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function instantsOf(visit, fallbackZone) {
  if (Number.isFinite(visit?.startsAt) && Number.isFinite(visit?.endsAt)) {
    return { startsAt: Number(visit.startsAt), endsAt: Number(visit.endsAt) };
  }
  return windowInstants(visit?.date, visit?.startTime, visit?.endTime, visit?.timeZone || fallbackZone);
}

export function visitsOverlap(a, b) {
  if (!a || !b) return false;
  const zone = a.timeZone || b.timeZone;
  const aInst = instantsOf(a, zone);
  const bInst = instantsOf(b, zone);
  if (aInst && bInst) {
    return instantsOverlap(aInst.startsAt, aInst.endsAt, bInst.startsAt, bInst.endsAt);
  }
  if (String(a.date) !== String(b.date)) return false;
  const aStart = toMinutes(a.startTime);
  const aEnd = toMinutes(a.endTime);
  const bStart = toMinutes(b.startTime);
  const bEnd = toMinutes(b.endTime);
  if ([aStart, aEnd, bStart, bEnd].some((value) => value == null)) return false;
  return rangesOverlap(aStart, aEnd, bStart, bEnd);
}

export function occupiesCaregiver(visit) {
  return OCCUPYING_STATUSES.includes(visit?.status);
}

export function sameCaregiver(visit, candidate) {
  if (!visit || !candidate) return false;
  const visitUser = String(visit.caregiverUserId || "").trim();
  const candidateUser = String(candidate.caregiverUserId || "").trim();
  if (visitUser && candidateUser && visitUser === candidateUser) return true;
  const visitEmail = String(visit.caregiverEmail || "").trim().toLowerCase();
  const candidateEmail = String(candidate.caregiverEmail || "").trim().toLowerCase();
  return Boolean(visitEmail && candidateEmail && visitEmail === candidateEmail);
}

export function caregiverKey(visit) {
  const userId = String(visit?.caregiverUserId || "").trim();
  if (userId) return userId;
  return String(visit?.caregiverEmail || "").trim().toLowerCase();
}

export function lockDocId(key) {
  return String(key || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
}

export function slotFromVisit(visit) {
  const instants = instantsOf(visit, visit?.timeZone) || {};
  return {
    visitId: visit.id,
    seniorId: visit.seniorId,
    seniorName: visit.seniorName || "",
    familyId: visit.familyId || "",
    date: visit.date,
    startTime: visit.startTime,
    endTime: visit.endTime,
    startMin: toMinutes(visit.startTime),
    endMin: toMinutes(visit.endTime),
    startsAt: instants.startsAt,
    endsAt: instants.endsAt,
    timeZone: visit.timeZone || "",
    status: visit.status,
  };
}

export function findOccupyingConflict(candidate, visits, { ignoreVisitId } = {}) {
  return (visits || []).find((visit) => (
    visit.id !== ignoreVisitId
    && occupiesCaregiver(visit)
    && sameCaregiver(visit, candidate)
    && visitsOverlap(visit, candidate)
  )) ?? null;
}

export function overlapMessage(conflict, caregiverName = "", kind = PROFESSIONAL_KIND.CAREGIVER) {
  const name = caregiverName || (kind === PROFESSIONAL_KIND.PRACTITIONER ? "This clinician" : "This caregiver");
  const rule = `${professionalNoun(kind, { plural: true })} cannot hold overlapping schedules between families.`;
  if (!conflict) {
    return `${name} already has a visit in this window. ${rule}`;
  }
  const who = conflict.seniorName ? ` with ${conflict.seniorName}` : "";
  const zone = conflict.timeZone ? ` ${timeZoneAbbr(conflict.timeZone, conflict.startsAt)}` : "";
  const when = `${formatDateLabel(conflict.date)} · ${formatRange(conflict.startTime, conflict.endTime)}${zone}`;
  return `${name} is already scheduled${who} on ${when}. ${rule}`;
}

export function windowCoveredByAvailability(window, windows = []) {
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

export function windowBlocked(window, blocks = []) {
  return blocks.some((block) => visitsOverlap(window, {
    date: block.date,
    startTime: block.startTime,
    endTime: block.endTime,
    timeZone: block.timeZone || window.timeZone,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
  }));
}

export function assertValidWindow({ date, startTime, endTime }) {
  if (!String(date || "").match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new Error("Choose a visit date.");
  }
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start == null || end == null) {
    throw new Error("Choose a start and end time.");
  }
  if (end <= start) {
    throw new Error("The visit must end after it starts, on the same day.");
  }
  if (durationMinutes(startTime, endTime) < 30) {
    throw new Error("A visit needs at least 30 minutes.");
  }
}
