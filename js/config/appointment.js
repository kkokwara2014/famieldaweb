import {
  APPOINTMENT_REMINDER,
  APPOINTMENT_STATUS,
  CARE_CIRCLE_ROLES,
  CIRCLE_KINDS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  ROLES,
} from "./constants.js";
import { hasPermission } from "./care-circle.js";
import { canManageCarePlan } from "./care-plan.js";
import { isoDate, parseIsoDate, todayIso, formatTime, formatRange, formatDateLabel, toMinutes } from "../scheduling/time.js";
import { weekdayLabel } from "../scheduling/calendar.js";

export const APPOINTMENT_STATUS_OPTIONS = [
  { id: APPOINTMENT_STATUS.SCHEDULED, label: "Scheduled" },
  { id: APPOINTMENT_STATUS.CONFIRMED, label: "Confirmed" },
  { id: APPOINTMENT_STATUS.COMPLETED, label: "Completed" },
  { id: APPOINTMENT_STATUS.CANCELLED, label: "Cancelled" },
  { id: APPOINTMENT_STATUS.MISSED, label: "Missed" },
];

export const APPOINTMENT_STATUS_EDIT_OPTIONS = [
  { id: APPOINTMENT_STATUS.SCHEDULED, label: "Scheduled" },
  { id: APPOINTMENT_STATUS.CONFIRMED, label: "Confirmed" },
];

export const APPOINTMENT_REMINDER_OPTIONS = [
  { id: APPOINTMENT_REMINDER.NONE, label: "No reminder", minutes: null },
  { id: APPOINTMENT_REMINDER.AT_TIME, label: "At the appointment time", minutes: 0 },
  { id: APPOINTMENT_REMINDER.MINUTES_15, label: "15 minutes before", minutes: 15 },
  { id: APPOINTMENT_REMINDER.HOUR_1, label: "1 hour before", minutes: 60 },
  { id: APPOINTMENT_REMINDER.DAY_1, label: "1 day before", minutes: 1_440 },
  { id: APPOINTMENT_REMINDER.DAY_2, label: "2 days before", minutes: 2_880 },
];

const STATUS_BADGE = {
  [APPOINTMENT_STATUS.SCHEDULED]: "badge--brand",
  [APPOINTMENT_STATUS.CONFIRMED]: "badge--success",
  [APPOINTMENT_STATUS.COMPLETED]: "badge--neutral",
  [APPOINTMENT_STATUS.CANCELLED]: "badge--danger",
  [APPOINTMENT_STATUS.MISSED]: "badge--warning",
};

const REMINDER_MINUTES = Object.fromEntries(
  APPOINTMENT_REMINDER_OPTIONS.map((item) => [item.id, item.minutes]),
);

export function appointmentStatusLabel(status) {
  return APPOINTMENT_STATUS_OPTIONS.find((item) => item.id === status)?.label ?? "Scheduled";
}

export function appointmentStatusBadge(status) {
  return STATUS_BADGE[status] ?? "badge--brand";
}

export function reminderLabel(reminder) {
  return APPOINTMENT_REMINDER_OPTIONS.find((item) => item.id === reminder)?.label ?? "1 day before";
}

export function reminderMinutes(reminder) {
  const value = REMINDER_MINUTES[reminder];
  return value == null ? null : value;
}

export function appointmentStartsAt(appointment) {
  const date = parseIsoDate(appointment?.date);
  if (!date) return null;
  const minutes = toMinutes(appointment.time);
  if (minutes == null) {
    date.setHours(9, 0, 0, 0);
    return date;
  }
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

export function appointmentReminderAt(date, time, reminder) {
  if (!reminder || reminder === APPOINTMENT_REMINDER.NONE) return null;
  const start = appointmentStartsAt({ date, time });
  if (!start) return null;
  const offset = reminderMinutes(reminder);
  if (offset == null) return null;
  return new Date(start.getTime() - offset * 60_000).toISOString();
}

export function liveAppointmentStatus(appointment, now = new Date()) {
  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) return APPOINTMENT_STATUS.CANCELLED;
  if (appointment.status === APPOINTMENT_STATUS.COMPLETED) return APPOINTMENT_STATUS.COMPLETED;
  const start = appointmentStartsAt(appointment);
  if (!start) return appointment.status || APPOINTMENT_STATUS.SCHEDULED;
  const grace = 20 * 60_000;
  if (start.getTime() + grace < now.getTime()) return APPOINTMENT_STATUS.MISSED;
  return appointment.status || APPOINTMENT_STATUS.SCHEDULED;
}

export function isOpenAppointment(appointment, now = new Date()) {
  const live = liveAppointmentStatus(appointment, now);
  return live === APPOINTMENT_STATUS.SCHEDULED || live === APPOINTMENT_STATUS.CONFIRMED;
}

export function isPastAppointment(appointment, now = new Date()) {
  const live = liveAppointmentStatus(appointment, now);
  return live === APPOINTMENT_STATUS.COMPLETED || live === APPOINTMENT_STATUS.MISSED;
}

export function appointmentWhenLabel(appointment, now = new Date()) {
  const date = parseIsoDate(appointment.date);
  if (!date) return formatTime(appointment.time) || "Time not set";
  const today = todayIso(now);
  const iso = isoDate(date);
  const time = formatTime(appointment.time);
  const range = appointment.endTime ? formatRange(appointment.time, appointment.endTime) : time;
  if (iso === today) return range ? `Today · ${range}` : "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (iso === isoDate(tomorrow)) return range ? `Tomorrow · ${range}` : "Tomorrow";
  const weekday = weekdayLabel(date.getDay(), { long: true });
  return range ? `${weekday} · ${formatDateLabel(iso, { weekday: false })} · ${range}` : `${weekday} · ${formatDateLabel(iso, { weekday: false })}`;
}

export function appointmentMeta(appointment, now = new Date()) {
  const parts = [
    appointmentWhenLabel(appointment, now),
    appointment.practitionerName || "",
    appointment.location || "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function canManageAppointments(session, actor, senior) {
  if (canManageCarePlan(session, actor, senior)) return true;
  if (actor?.role === CARE_CIRCLE_ROLES.OWNER || actor?.role === CARE_CIRCLE_ROLES.COORDINATOR) return true;
  return hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_SCHEDULE)
    || hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_CARE);
}

export function isAssociatedPractitioner(appointment, session) {
  if (!session || !appointment) return false;
  if (appointment.practitionerUserId && appointment.practitionerUserId === session.id) return true;
  const email = String(session.email || "").trim().toLowerCase();
  return Boolean(email && String(appointment.practitionerEmail || "").trim().toLowerCase() === email);
}

export function canActOnAppointment(appointment, session, actor, senior) {
  if (canManageAppointments(session, actor, senior)) return true;
  if (session?.role === ROLES.HEALTH_PRACTITIONER && isAssociatedPractitioner(appointment, session)) return true;
  return false;
}

export function practitionerOptions(members = []) {
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

export function yearMonthOf(value = new Date()) {
  const date = value instanceof Date ? value : parseIsoDate(String(value).slice(0, 10)) || new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftYearMonth(yearMonth, delta) {
  const [year, month] = String(yearMonth || yearMonthOf()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + Number(delta || 0), 1);
  return yearMonthOf(date);
}

export function monthGrid(yearMonth, items = [], selectedDay = "", now = new Date()) {
  const [year, month] = String(yearMonth || yearMonthOf(now)).split("-").map(Number);
  const first = new Date(year, (month || 1) - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayIso(now);
  const cells = [];

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = isoDate(new Date(year, month - 1, day));
    const dayItems = items.filter((item) => item.date === date && item.liveStatus !== APPOINTMENT_STATUS.CANCELLED);
    cells.push({
      date,
      day,
      isToday: date === today,
      isSelected: date === selectedDay,
      count: dayItems.length,
      items: dayItems,
    });
  }

  return {
    yearMonth: `${year}-${String(month).padStart(2, "0")}`,
    label: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    weekdayLabels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    cells,
    selectedDay,
  };
}
