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
  const startsAt = Number.isFinite(data.startsAt) ? Number(data.startsAt) : null;
  const endsAt = Number.isFinite(data.endsAt) ? Number(data.endsAt) : null;
  const checkInAt = data.checkInAt ?? data.checkedInAt ?? null;
  const checkOutAt = data.checkOutAt ?? data.checkedOutAt ?? null;
  const status = data.status ?? VISIT_STATUS.REQUESTED;

  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    familyId: data.familyId ?? "",
    // Mobile-canonical fields (the mobile app reads these names).
    startAt: data.startAt ?? (startsAt ? new Date(startsAt).toISOString() : null),
    endAt: data.endAt ?? (endsAt ? new Date(endsAt).toISOString() : null),
    caregiverId: data.caregiverId ?? "",
    caregiverDisplayName: data.caregiverDisplayName ?? data.caregiverName ?? "",
    professionalId: data.professionalId ?? data.caregiverUserId ?? "",
    professionalRole: data.professionalRole ?? data.professionalKind ?? "",
    careLocation: data.careLocation ?? "",
    careInstructions: data.careInstructions ?? "",
    tasks: Array.isArray(data.tasks) ? [...data.tasks] : [],
    recurrence: data.recurrence ?? "",
    seriesId: data.seriesId ?? "",
    mobileStatus: data.mobileStatus ?? status,
    checkInAt,
    checkOutAt,
    // Web fields (kept; aliases of the canonical ones above).
    seniorName: data.seniorName ?? "",
    familyName: data.familyName ?? "",
    professionalKind: data.professionalKind ?? PROFESSIONAL_KIND.CAREGIVER,
    caregiverUserId: data.caregiverUserId ?? null,
    caregiverEmail: data.caregiverEmail ?? "",
    caregiverName: data.caregiverName ?? data.caregiverDisplayName ?? "",
    caregiverMemberId: data.caregiverMemberId ?? "",
    title: data.title ?? "Care visit",
    date: data.date ?? "",
    startTime: data.startTime ?? "",
    endTime: data.endTime ?? "",
    timeZone: data.timeZone ?? "",
    startsAt,
    endsAt,
    originalEndTime: data.originalEndTime ?? data.endTime ?? "",
    extensionMinutes: Number(data.extensionMinutes || 0),
    status,
    requestedBy: data.requestedBy ?? "",
    requestedByName: data.requestedByName ?? "",
    requestedAt: data.requestedAt ?? null,
    respondedAt: data.respondedAt ?? null,
    declineReason: data.declineReason ?? "",
    checkedInAt: checkInAt,
    checkedOutAt: checkOutAt,
    notes,
    report: createVisitReport(data.report),
    modifiedAt: data.modifiedAt ?? null,
    modifiedBy: data.modifiedBy ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}
