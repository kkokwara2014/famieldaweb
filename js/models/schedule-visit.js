import { VISIT_STATUS } from "../config/constants.js";
import { PROFESSIONAL_KIND } from "../config/scheduling.js";

export function createVisitNote(data = {}) {
  return {
    id: data.id ?? "",
    body: data.body ?? "",
    author: data.author ?? "",
    authorId: data.authorId ?? "",
    createdAt: data.createdAt ?? null,
  };
}

export function createVisitReport(data = {}) {
  if (!data || (typeof data === "object" && !data.summary && !data.submittedAt)) return null;
  return {
    summary: data.summary ?? "",
    mood: data.mood ?? "typical",
    meals: data.meals ?? "",
    mobility: data.mobility ?? "",
    concerns: data.concerns ?? "",
    followUp: data.followUp ?? "",
    submittedAt: data.submittedAt ?? null,
    submittedBy: data.submittedBy ?? "",
    submittedById: data.submittedById ?? "",
  };
}

export function createScheduleVisit(data = {}) {
  const notes = Array.isArray(data.notes)
    ? data.notes.map((item) => createVisitNote(item))
    : [];

  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    seniorName: data.seniorName ?? "",
    familyId: data.familyId ?? "",
    familyName: data.familyName ?? "",
    professionalKind: data.professionalKind ?? PROFESSIONAL_KIND.CAREGIVER,
    caregiverUserId: data.caregiverUserId ?? null,
    caregiverEmail: data.caregiverEmail ?? "",
    caregiverName: data.caregiverName ?? "",
    caregiverMemberId: data.caregiverMemberId ?? "",
    title: data.title ?? "Care visit",
    date: data.date ?? "",
    startTime: data.startTime ?? "",
    endTime: data.endTime ?? "",
    timeZone: data.timeZone ?? "",
    startsAt: Number.isFinite(data.startsAt) ? Number(data.startsAt) : null,
    endsAt: Number.isFinite(data.endsAt) ? Number(data.endsAt) : null,
    originalEndTime: data.originalEndTime ?? data.endTime ?? "",
    extensionMinutes: Number(data.extensionMinutes || 0),
    status: data.status ?? VISIT_STATUS.REQUESTED,
    requestedBy: data.requestedBy ?? "",
    requestedByName: data.requestedByName ?? "",
    requestedAt: data.requestedAt ?? null,
    respondedAt: data.respondedAt ?? null,
    declineReason: data.declineReason ?? "",
    checkedInAt: data.checkedInAt ?? null,
    checkedOutAt: data.checkedOutAt ?? null,
    notes,
    report: createVisitReport(data.report),
    modifiedAt: data.modifiedAt ?? null,
    modifiedBy: data.modifiedBy ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}
