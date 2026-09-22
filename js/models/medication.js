import {
  MEDICATION_FREQUENCY,
  MEDICATION_REMINDER,
  MEDICATION_STATUS,
} from "../config/constants.js";

export function createMedication(data = {}) {
  const name = data.name ?? "";
  return {
    id: data.id ?? "",
    // Mobile-canonical fields (the mobile app reads these names).
    familyId: data.familyId ?? "",
    seniorId: data.seniorId ?? "",
    name,
    dosage: data.dosage ?? "",
    route: data.route ?? "",
    frequency: data.frequency ?? MEDICATION_FREQUENCY.DAILY,
    startDate: data.startDate ?? "",
    endDate: data.endDate ?? "",
    prescribingDoctor: data.prescribingDoctor ?? "",
    pharmacy: data.pharmacy ?? "",
    instructions: data.instructions ?? "",
    scheduleTimes: Array.isArray(data.scheduleTimes) ? [...data.scheduleTimes] : [],
    time: data.time ?? "",
    secondTime: data.secondTime ?? "",
    thirdTime: data.thirdTime ?? "",
    isActive: data.isActive ?? (data.status ? data.status === MEDICATION_STATUS.ACTIVE : true),
    status: data.status ?? MEDICATION_STATUS.ACTIVE,
    notifyEnabled: data.notifyEnabled ?? true,
    createdBy: data.createdBy ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    // Web fields (kept).
    weekday: data.weekday ?? null,
    reminder: data.reminder ?? MEDICATION_REMINDER.MINUTES_15,
    reminderAt: data.reminderAt ?? null,
    reminderSent: Boolean(data.reminderSent),
    notes: data.notes ?? "",
    responsibleId: data.responsibleId ?? "",
    responsibleUserId: data.responsibleUserId ?? "",
    responsibleEmail: data.responsibleEmail ?? "",
    responsibleName: data.responsibleName ?? "",
    clinicianId: data.clinicianId ?? "",
    clinicianUserId: data.clinicianUserId ?? "",
    clinicianEmail: data.clinicianEmail ?? "",
    clinicianName: data.clinicianName ?? "",
    createdByName: data.createdByName ?? "",
    updatedBy: data.updatedBy ?? "",
    updatedByName: data.updatedByName ?? "",
    endedAt: data.endedAt ?? null,
    endedBy: data.endedBy ?? "",
    endedByName: data.endedByName ?? "",
  };
}

export function createMedicationDose(data = {}) {
  const outcome = data.outcome ?? "";
  return {
    id: data.id ?? "",
    // Mobile-canonical fields (the mobile app reads these names).
    familyId: data.familyId ?? "",
    seniorId: data.seniorId ?? "",
    medicationId: data.medicationId ?? "",
    medicationName: data.medicationName ?? data.name ?? "",
    name: data.name ?? data.medicationName ?? "",
    dosage: data.dosage ?? "",
    scheduledAt: data.scheduledAt ?? null,
    status: data.status ?? outcome ?? "scheduled",
    instructions: data.instructions ?? "",
    notifyEnabled: data.notifyEnabled ?? true,
    createdBy: data.createdBy ?? data.recordedBy ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    takenAt: data.takenAt ?? null,
    statusUpdatedBy: data.statusUpdatedBy ?? "",
    statusUpdatedAt: data.statusUpdatedAt ?? null,
    notifiedAt: data.notifiedAt ?? null,
    notificationStatus: data.notificationStatus ?? null,
    // Web fields (kept).
    date: data.date ?? "",
    time: data.time ?? "",
    slotKey: data.slotKey ?? "",
    outcome,
    notes: data.notes ?? "",
    recordedBy: data.recordedBy ?? "",
    recordedByName: data.recordedByName ?? "",
    recordedAt: data.recordedAt ?? null,
  };
}
