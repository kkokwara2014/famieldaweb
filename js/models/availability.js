import { AVAILABILITY_KIND, PROFESSIONAL_KIND } from "../config/scheduling.js";

export function createAvailabilityWindow(data = {}) {
  return {
    id: data.id ?? "",
    professionalKind: data.professionalKind ?? PROFESSIONAL_KIND.CAREGIVER,
    caregiverUserId: data.caregiverUserId ?? null,
    caregiverEmail: data.caregiverEmail ?? "",
    caregiverName: data.caregiverName ?? "",
    kind: data.kind ?? AVAILABILITY_KIND.WEEKLY,
    weekday: data.weekday ?? null,
    date: data.date ?? "",
    startTime: data.startTime ?? "09:00",
    endTime: data.endTime ?? "17:00",
    timeZone: data.timeZone ?? "America/New_York",
    active: data.active !== false,
    notes: data.notes ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}
