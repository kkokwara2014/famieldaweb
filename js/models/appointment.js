import { APPOINTMENT_REMINDER, APPOINTMENT_STATUS } from "../config/constants.js";

export function createAppointment(data = {}) {
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    title: data.title ?? "",
    date: data.date ?? "",
    time: data.time ?? "",
    endTime: data.endTime ?? "",
    location: data.location ?? "",
    notes: data.notes ?? "",
    status: data.status ?? APPOINTMENT_STATUS.SCHEDULED,
    practitionerId: data.practitionerId ?? "",
    practitionerUserId: data.practitionerUserId ?? "",
    practitionerEmail: data.practitionerEmail ?? "",
    practitionerName: data.practitionerName ?? "",
    reminder: data.reminder ?? APPOINTMENT_REMINDER.DAY_1,
    reminderAt: data.reminderAt ?? null,
    reminderSent: Boolean(data.reminderSent),
    createdBy: data.createdBy ?? "",
    createdByName: data.createdByName ?? "",
    updatedBy: data.updatedBy ?? "",
    updatedByName: data.updatedByName ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    cancelledAt: data.cancelledAt ?? null,
    cancelledBy: data.cancelledBy ?? "",
    cancelledByName: data.cancelledByName ?? "",
    cancelReason: data.cancelReason ?? "",
  };
}
