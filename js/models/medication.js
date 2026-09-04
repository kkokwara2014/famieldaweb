import {
  MEDICATION_FREQUENCY,
  MEDICATION_REMINDER,
  MEDICATION_STATUS,
} from "../config/constants.js";

export function createMedication(data = {}) {
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    name: data.name ?? "",
    dosage: data.dosage ?? "",
    frequency: data.frequency ?? MEDICATION_FREQUENCY.DAILY,
    time: data.time ?? "",
    secondTime: data.secondTime ?? "",
    thirdTime: data.thirdTime ?? "",
    weekday: data.weekday ?? null,
    startDate: data.startDate ?? "",
    endDate: data.endDate ?? "",
    reminder: data.reminder ?? MEDICATION_REMINDER.MINUTES_15,
    reminderAt: data.reminderAt ?? null,
    reminderSent: Boolean(data.reminderSent),
    notes: data.notes ?? "",
    status: data.status ?? MEDICATION_STATUS.ACTIVE,
    responsibleId: data.responsibleId ?? "",
    responsibleUserId: data.responsibleUserId ?? "",
    responsibleEmail: data.responsibleEmail ?? "",
    responsibleName: data.responsibleName ?? "",
    clinicianId: data.clinicianId ?? "",
    clinicianUserId: data.clinicianUserId ?? "",
    clinicianEmail: data.clinicianEmail ?? "",
    clinicianName: data.clinicianName ?? "",
    createdBy: data.createdBy ?? "",
    createdByName: data.createdByName ?? "",
    updatedBy: data.updatedBy ?? "",
    updatedByName: data.updatedByName ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    endedAt: data.endedAt ?? null,
    endedBy: data.endedBy ?? "",
    endedByName: data.endedByName ?? "",
  };
}

export function createMedicationDose(data = {}) {
  return {
    id: data.id ?? "",
    medicationId: data.medicationId ?? "",
    seniorId: data.seniorId ?? "",
    name: data.name ?? "",
    dosage: data.dosage ?? "",
    date: data.date ?? "",
    time: data.time ?? "",
    slotKey: data.slotKey ?? "",
    outcome: data.outcome ?? "",
    notes: data.notes ?? "",
    recordedBy: data.recordedBy ?? "",
    recordedByName: data.recordedByName ?? "",
    recordedAt: data.recordedAt ?? null,
  };
}
