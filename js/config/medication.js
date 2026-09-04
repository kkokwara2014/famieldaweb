import {
  CARE_CIRCLE_ROLES,
  CIRCLE_KINDS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  MEDICATION_DOSE_OUTCOME,
  MEDICATION_FREQUENCY,
  MEDICATION_REMINDER,
  MEDICATION_STATUS,
  ROLES,
} from "./constants.js";
import { hasPermission } from "./care-circle.js";
import { ENTITLEMENT_MESSAGES, hasPlusAccess } from "./entitlements.js";
import { canManageCarePlan } from "./care-plan.js";
import { formatDateLabel, formatTime, isoDate, parseIsoDate, todayIso, toMinutes } from "../scheduling/time.js";
import { weekdayLabel } from "../scheduling/calendar.js";

export const MEDICATION_PLUS_MESSAGE = ENTITLEMENT_MESSAGES.medication;

export const MEDICATION_STATUS_OPTIONS = [
  { id: MEDICATION_STATUS.ACTIVE, label: "Active" },
  { id: MEDICATION_STATUS.PAUSED, label: "Paused" },
  { id: MEDICATION_STATUS.ENDED, label: "Ended" },
];

export const MEDICATION_FREQUENCY_OPTIONS = [
  { id: MEDICATION_FREQUENCY.DAILY, label: "Once a day", hint: "Same time every day." },
  { id: MEDICATION_FREQUENCY.TWICE_DAILY, label: "Twice a day", hint: "Morning and evening, or two times you set." },
  { id: MEDICATION_FREQUENCY.THREE_TIMES, label: "Three times a day", hint: "Three times the circle is covering." },
  { id: MEDICATION_FREQUENCY.WEEKLY, label: "Weekly", hint: "The same weekday." },
  { id: MEDICATION_FREQUENCY.EVERY_OTHER, label: "Every other day", hint: "From the start date." },
  { id: MEDICATION_FREQUENCY.ONCE, label: "One course", hint: "A single stretch with a start and end." },
  { id: MEDICATION_FREQUENCY.AS_NEEDED, label: "As needed", hint: "Logged when the circle gives it." },
];

export const MEDICATION_REMINDER_OPTIONS = [
  { id: MEDICATION_REMINDER.NONE, label: "No reminder", minutes: null },
  { id: MEDICATION_REMINDER.AT_TIME, label: "At the dose time", minutes: 0 },
  { id: MEDICATION_REMINDER.MINUTES_15, label: "15 minutes before", minutes: 15 },
  { id: MEDICATION_REMINDER.HOUR_1, label: "1 hour before", minutes: 60 },
];

export const MEDICATION_WEEKDAY_OPTIONS = [
  { id: 0, label: "Sunday" },
  { id: 1, label: "Monday" },
  { id: 2, label: "Tuesday" },
  { id: 3, label: "Wednesday" },
  { id: 4, label: "Thursday" },
  { id: 5, label: "Friday" },
  { id: 6, label: "Saturday" },
];

const STATUS_BADGE = {
  [MEDICATION_STATUS.ACTIVE]: "badge--success",
  [MEDICATION_STATUS.PAUSED]: "badge--warning",
  [MEDICATION_STATUS.ENDED]: "badge--neutral",
};

const DOSE_BADGE = {
  [MEDICATION_DOSE_OUTCOME.TAKEN]: "badge--success",
  [MEDICATION_DOSE_OUTCOME.SKIPPED]: "badge--neutral",
  [MEDICATION_DOSE_OUTCOME.MISSED]: "badge--danger",
};

const DOSE_LABEL = {
  [MEDICATION_DOSE_OUTCOME.TAKEN]: "Taken",
  [MEDICATION_DOSE_OUTCOME.SKIPPED]: "Skipped",
  [MEDICATION_DOSE_OUTCOME.MISSED]: "Missed",
};

const REMINDER_MINUTES = Object.fromEntries(
  MEDICATION_REMINDER_OPTIONS.map((item) => [item.id, item.minutes]),
);

export function medicationStatusLabel(status) {
  return MEDICATION_STATUS_OPTIONS.find((item) => item.id === status)?.label ?? "Active";
}

export function medicationStatusBadge(status) {
  return STATUS_BADGE[status] ?? "badge--success";
}

export function medicationFrequencyLabel(frequency) {
  return MEDICATION_FREQUENCY_OPTIONS.find((item) => item.id === frequency)?.label ?? "Once a day";
}

export function medicationReminderLabel(reminder) {
  return MEDICATION_REMINDER_OPTIONS.find((item) => item.id === reminder)?.label ?? "No reminder";
}

export function medicationReminderMinutes(reminder) {
  const value = REMINDER_MINUTES[reminder];
  return value == null ? null : value;
}

export function doseOutcomeLabel(outcome) {
  return DOSE_LABEL[outcome] ?? "Due";
}

export function doseOutcomeBadge(outcome) {
  return DOSE_BADGE[outcome] ?? "badge--brand";
}

export function liveMedicationStatus(medication, now = new Date()) {
  if (medication.status === MEDICATION_STATUS.PAUSED) return MEDICATION_STATUS.PAUSED;
  if (medication.status === MEDICATION_STATUS.ENDED) return MEDICATION_STATUS.ENDED;
  const today = todayIso(now);
  if (medication.endDate && medication.endDate < today) return MEDICATION_STATUS.ENDED;
  if (medication.startDate && medication.startDate > today) return MEDICATION_STATUS.ACTIVE;
  return MEDICATION_STATUS.ACTIVE;
}

export function isOpenMedication(medication, now = new Date()) {
  return liveMedicationStatus(medication, now) === MEDICATION_STATUS.ACTIVE;
}

export function doseTimes(medication) {
  const times = [medication?.time, medication?.secondTime, medication?.thirdTime]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const frequency = medication?.frequency;
  if (frequency === MEDICATION_FREQUENCY.AS_NEEDED) return [];
  if (frequency === MEDICATION_FREQUENCY.TWICE_DAILY) {
    return (times.length >= 2 ? times.slice(0, 2) : [...times, "20:00"]).slice(0, 2).map(withFallbackTime);
  }
  if (frequency === MEDICATION_FREQUENCY.THREE_TIMES) {
    const fallback = ["08:00", "14:00", "20:00"];
    return fallback.map((slot, index) => times[index] || slot);
  }
  return [times[0] || "08:00"];
}

function withFallbackTime(value) {
  return value || "08:00";
}

export function occursOnDate(medication, iso) {
  if (!iso) return false;
  if (liveMedicationStatus(medication, parseIsoDate(iso) || new Date()) !== MEDICATION_STATUS.ACTIVE) {
    return false;
  }
  if (medication.startDate && iso < medication.startDate) return false;
  if (medication.endDate && iso > medication.endDate) return false;
  const frequency = medication.frequency;
  if (frequency === MEDICATION_FREQUENCY.AS_NEEDED) return false;
  if (frequency === MEDICATION_FREQUENCY.ONCE) {
    return iso === medication.startDate || (!medication.startDate && iso === todayIso());
  }
  if (frequency === MEDICATION_FREQUENCY.WEEKLY) {
    const date = parseIsoDate(iso);
    if (!date) return false;
    const weekday = Number.isInteger(Number(medication.weekday))
      ? Number(medication.weekday)
      : (parseIsoDate(medication.startDate)?.getDay() ?? date.getDay());
    return date.getDay() === weekday;
  }
  if (frequency === MEDICATION_FREQUENCY.EVERY_OTHER) {
    const start = parseIsoDate(medication.startDate);
    const date = parseIsoDate(iso);
    if (!start || !date) return false;
    const diff = Math.round((date.getTime() - start.getTime()) / 86_400_000);
    return diff >= 0 && diff % 2 === 0;
  }
  return true;
}

export function combineDateTime(date, time, fallbackHours = 8) {
  const day = parseIsoDate(date);
  if (!day) return null;
  const minutes = toMinutes(time);
  if (minutes == null) {
    day.setHours(fallbackHours, 0, 0, 0);
    return day;
  }
  day.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return day;
}

export function nextDoseAt(medication, now = new Date()) {
  if (!isOpenMedication(medication, now)) return null;
  const times = doseTimes(medication);
  if (!times.length) return null;
  for (let offset = 0; offset < 62; offset += 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(now.getDate() + offset);
    const iso = isoDate(day);
    if (!occursOnDate(medication, iso)) continue;
    for (const time of times) {
      const at = combineDateTime(iso, time);
      if (at && at.getTime() > now.getTime()) return at;
    }
  }
  return null;
}

export function medicationReminderAt(medication, now = new Date()) {
  if (!medication?.reminder || medication.reminder === MEDICATION_REMINDER.NONE) return null;
  const next = nextDoseAt(medication, now);
  if (!next) return null;
  const offset = medicationReminderMinutes(medication.reminder);
  if (offset == null) return null;
  return new Date(next.getTime() - offset * 60_000).toISOString();
}

export function doseSlotKey(date, time) {
  return `${date || ""}|${time || "as-needed"}`;
}

export function dueSlots(medication, now = new Date()) {
  if (!isOpenMedication(medication, now)) return [];
  if (medication.frequency === MEDICATION_FREQUENCY.AS_NEEDED) return [];
  const today = todayIso(now);
  if (!occursOnDate(medication, today)) return [];
  return doseTimes(medication).map((time) => {
    const at = combineDateTime(today, time);
    return {
      date: today,
      time,
      at,
      key: doseSlotKey(today, time),
    };
  });
}

export function liveDoseOutcome(slot, log, now = new Date()) {
  if (log?.outcome === MEDICATION_DOSE_OUTCOME.TAKEN) return MEDICATION_DOSE_OUTCOME.TAKEN;
  if (log?.outcome === MEDICATION_DOSE_OUTCOME.SKIPPED) return MEDICATION_DOSE_OUTCOME.SKIPPED;
  if (log?.outcome === MEDICATION_DOSE_OUTCOME.MISSED) return MEDICATION_DOSE_OUTCOME.MISSED;
  const grace = 20 * 60_000;
  if (slot?.at && slot.at.getTime() + grace < now.getTime()) return MEDICATION_DOSE_OUTCOME.MISSED;
  return "";
}

export function scheduleLabel(medication) {
  const frequency = medicationFrequencyLabel(medication.frequency);
  const times = doseTimes(medication).map((time) => formatTime(time)).filter(Boolean);
  if (medication.frequency === MEDICATION_FREQUENCY.AS_NEEDED) return frequency;
  if (medication.frequency === MEDICATION_FREQUENCY.WEEKLY) {
    const weekday = Number.isInteger(Number(medication.weekday))
      ? weekdayLabel(Number(medication.weekday), { long: true })
      : "";
    return [frequency, weekday, times.join(", ")].filter(Boolean).join(" · ");
  }
  return [frequency, times.join(", ")].filter(Boolean).join(" · ");
}

export function windowLabel(medication) {
  const start = medication.startDate ? formatDateLabel(medication.startDate, { weekday: false }) : "";
  const end = medication.endDate ? formatDateLabel(medication.endDate, { weekday: false }) : "No end date";
  if (!start) return end;
  return `${start} – ${end}`;
}

export function medicationMeta(medication) {
  const parts = [
    medication.dosage,
    scheduleLabel(medication),
    medication.responsibleName || "Household covering",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function canManageMedications(session, actor, senior) {
  return canManageCarePlan(session, actor, senior);
}

export function canLogMedicationDose(medication, session, actor) {
  if (!session || !medication) return false;
  if (liveMedicationStatus(medication) !== MEDICATION_STATUS.ACTIVE) return false;
  if (session.role === ROLES.ADMIN) return true;
  if (session.role === ROLES.FAMILY || session.role === ROLES.HEALTH_PRACTITIONER || session.role === ROLES.CAREGIVER) {
    return true;
  }
  if (medication.responsibleUserId && medication.responsibleUserId === session.id) return true;
  const email = String(session.email || "").trim().toLowerCase();
  if (email && String(medication.responsibleEmail || "").trim().toLowerCase() === email) return true;
  if (actor?.status === CIRCLE_STATUS.ACTIVE && actor.userId === session.id) return true;
  return hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_CARE);
}

export function sessionHasMedicationPlus(session) {
  return hasPlusAccess(session);
}

export function responsibleOptions(members = []) {
  return members
    .filter((member) => member.status === CIRCLE_STATUS.ACTIVE)
    .map((member) => ({
      id: member.id,
      userId: member.userId || "",
      email: member.email || "",
      name: member.name,
      relationship: member.relationship,
      kind: member.kind,
      label: member.relationship ? `${member.name} · ${member.relationship}` : member.name,
    }));
}

export function clinicianOptions(members = []) {
  return members
    .filter((member) => (
      member.kind === CIRCLE_KINDS.PRACTITIONER
      && member.status === CIRCLE_STATUS.ACTIVE
    ))
    .map((member) => ({
      id: member.id,
      userId: member.userId || "",
      email: member.email || "",
      name: member.name,
      relationship: member.relationship,
      label: member.relationship ? `${member.name} · ${member.relationship}` : member.name,
    }));
}

export function optionHtml(options, selected) {
  return options.map((item) => {
    const value = String(item.id);
    const current = selected == null ? "" : String(selected);
    const selectedAttr = value === current ? " selected" : "";
    return `<option value="${value}"${selectedAttr}>${item.label}</option>`;
  }).join("");
}

export function ownerHasMedicationPlus(senior, members = [], session) {
  if (sessionHasMedicationPlus(session)) return true;
  if (senior?.ownerId && senior.ownerId === session?.id) return sessionHasMedicationPlus(session);
  const owner = members.find((member) => member.role === CARE_CIRCLE_ROLES.OWNER);
  return Boolean(owner && hasPlusAccess(owner));
}
