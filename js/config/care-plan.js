import {
  CARE_CIRCLE_ROLES,
  CARE_PLAN_STATUS,
  CARE_TASK_CATEGORY,
  CARE_TASK_FREQUENCY,
  CARE_TASK_PRIORITY,
  CARE_TASK_STATUS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  ROLES,
} from "./constants.js";
import { hasPermission } from "./care-circle.js";
import { formatDateLabel, formatTime, isoDate, parseIsoDate, todayIso } from "../scheduling/time.js";
import { weekdayLabel } from "../scheduling/calendar.js";

export const CARE_PLAN_STATUS_OPTIONS = [
  { id: CARE_PLAN_STATUS.DRAFT, label: "Draft" },
  { id: CARE_PLAN_STATUS.ACTIVE, label: "Active" },
  { id: CARE_PLAN_STATUS.PAUSED, label: "Paused" },
  { id: CARE_PLAN_STATUS.COMPLETED, label: "Completed" },
  { id: CARE_PLAN_STATUS.ARCHIVED, label: "Archived" },
];

export const CARE_TASK_FREQUENCY_OPTIONS = [
  { id: CARE_TASK_FREQUENCY.ONCE, label: "Once", hint: "A single due date." },
  { id: CARE_TASK_FREQUENCY.DAILY, label: "Daily", hint: "Repeats every day until it ends." },
  { id: CARE_TASK_FREQUENCY.WEEKLY, label: "Weekly", hint: "Repeats on the same weekday." },
  { id: CARE_TASK_FREQUENCY.MONTHLY, label: "Monthly", hint: "Repeats on the same date each month." },
  { id: CARE_TASK_FREQUENCY.AS_NEEDED, label: "As needed", hint: "Done when the circle needs it." },
];

export const CARE_TASK_PRIORITY_OPTIONS = [
  { id: CARE_TASK_PRIORITY.URGENT, label: "Urgent" },
  { id: CARE_TASK_PRIORITY.HIGH, label: "High" },
  { id: CARE_TASK_PRIORITY.MEDIUM, label: "Medium" },
  { id: CARE_TASK_PRIORITY.LOW, label: "Low" },
];

export const CARE_TASK_CATEGORY_OPTIONS = [
  { id: CARE_TASK_CATEGORY.MEDICATION, label: "Medication" },
  { id: CARE_TASK_CATEGORY.PERSONAL_CARE, label: "Personal care" },
  { id: CARE_TASK_CATEGORY.MOBILITY, label: "Mobility" },
  { id: CARE_TASK_CATEGORY.NUTRITION, label: "Nutrition" },
  { id: CARE_TASK_CATEGORY.HOUSEHOLD, label: "Household" },
  { id: CARE_TASK_CATEGORY.CLINICAL, label: "Clinical" },
  { id: CARE_TASK_CATEGORY.OTHER, label: "Other" },
];

export const CARE_TASK_WEEKDAY_OPTIONS = [
  { id: 0, label: "Sunday" },
  { id: 1, label: "Monday" },
  { id: 2, label: "Tuesday" },
  { id: 3, label: "Wednesday" },
  { id: 4, label: "Thursday" },
  { id: 5, label: "Friday" },
  { id: 6, label: "Saturday" },
];

const PLAN_STATUS_BADGE = {
  [CARE_PLAN_STATUS.DRAFT]: "badge--neutral",
  [CARE_PLAN_STATUS.ACTIVE]: "badge--success",
  [CARE_PLAN_STATUS.PAUSED]: "badge--warning",
  [CARE_PLAN_STATUS.COMPLETED]: "badge--brand",
  [CARE_PLAN_STATUS.ARCHIVED]: "badge--neutral",
};

const TASK_STATUS_BADGE = {
  [CARE_TASK_STATUS.OPEN]: "badge--brand",
  [CARE_TASK_STATUS.COMPLETED]: "badge--success",
  [CARE_TASK_STATUS.SKIPPED]: "badge--neutral",
  [CARE_TASK_STATUS.MISSED]: "badge--danger",
};

const TASK_STATUS_LABEL = {
  [CARE_TASK_STATUS.OPEN]: "Due",
  [CARE_TASK_STATUS.COMPLETED]: "Done",
  [CARE_TASK_STATUS.SKIPPED]: "Skipped",
  [CARE_TASK_STATUS.MISSED]: "Overdue",
};

const TASK_PRIORITY_BADGE = {
  [CARE_TASK_PRIORITY.URGENT]: "badge--danger",
  [CARE_TASK_PRIORITY.HIGH]: "badge--warning",
  [CARE_TASK_PRIORITY.MEDIUM]: "badge--brand",
  [CARE_TASK_PRIORITY.LOW]: "badge--neutral",
};

const TASK_PRIORITY_RANK = {
  [CARE_TASK_PRIORITY.URGENT]: 0,
  [CARE_TASK_PRIORITY.HIGH]: 1,
  [CARE_TASK_PRIORITY.MEDIUM]: 2,
  [CARE_TASK_PRIORITY.LOW]: 3,
};

export function planStatusLabel(status) {
  return CARE_PLAN_STATUS_OPTIONS.find((item) => item.id === status)?.label ?? "Active";
}

export function planStatusBadge(status) {
  return PLAN_STATUS_BADGE[status] ?? "badge--neutral";
}

export function frequencyLabel(frequency) {
  return CARE_TASK_FREQUENCY_OPTIONS.find((item) => item.id === frequency)?.label ?? "Daily";
}

export function categoryLabel(category) {
  return CARE_TASK_CATEGORY_OPTIONS.find((item) => item.id === category)?.label ?? "Other";
}

export function priorityLabel(priority) {
  return CARE_TASK_PRIORITY_OPTIONS.find((item) => item.id === priority)?.label ?? "Medium";
}

export function priorityBadge(priority) {
  return TASK_PRIORITY_BADGE[priority] ?? "badge--brand";
}

export function priorityRank(priority) {
  return TASK_PRIORITY_RANK[priority] ?? TASK_PRIORITY_RANK[CARE_TASK_PRIORITY.MEDIUM];
}

export function taskStatusLabel(status) {
  return TASK_STATUS_LABEL[status] ?? "Due";
}

export function taskStatusBadge(status) {
  return TASK_STATUS_BADGE[status] ?? "badge--brand";
}

export function liveCareTaskStatus(task, now = new Date()) {
  if (task.status === CARE_TASK_STATUS.COMPLETED || task.status === CARE_TASK_STATUS.SKIPPED) {
    return task.status;
  }
  if (task.frequency === CARE_TASK_FREQUENCY.AS_NEEDED) return CARE_TASK_STATUS.OPEN;
  const due = parseIsoDate(task.dueDate);
  if (!due) return CARE_TASK_STATUS.OPEN;
  const today = todayIso(now);
  const iso = isoDate(due);
  if (iso < today) return CARE_TASK_STATUS.MISSED;
  if (iso === today && isPastDueTime(task.dueTime, now)) return CARE_TASK_STATUS.MISSED;
  return CARE_TASK_STATUS.OPEN;
}

function isPastDueTime(dueTime, now) {
  if (!dueTime) return false;
  const [hours, minutes] = String(dueTime).split(":").map(Number);
  if (!Number.isFinite(hours)) return false;
  const due = new Date(now);
  due.setHours(hours, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return due.getTime() < now.getTime();
}

export function dueDateLabel(task, now = new Date()) {
  const due = parseIsoDate(task.dueDate);
  if (!due) {
    return task.frequency === CARE_TASK_FREQUENCY.AS_NEEDED ? "As needed" : "No due date";
  }
  const today = todayIso(now);
  const iso = isoDate(due);
  const time = task.dueTime ? ` · ${formatTime(task.dueTime)}` : "";
  if (iso === today) return `Today${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (iso === isoDate(tomorrow)) return `Tomorrow${time}`;
  return `${formatDateLabel(iso)}${time}`;
}

export function overdueLabel(task, now = new Date()) {
  if (liveCareTaskStatus(task, now) !== CARE_TASK_STATUS.MISSED) return "";
  const days = daysOverdue(task, now);
  if (days <= 0) return "Past due";
  if (days === 1) return "1 day overdue";
  return `${days} days overdue`;
}

export function daysOverdue(task, now = new Date()) {
  const due = parseIsoDate(task.dueDate);
  if (!due) return 0;
  const today = parseIsoDate(todayIso(now));
  if (!today) return 0;
  const diff = Math.round((today.getTime() - due.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

export function taskMeta(task, now = new Date()) {
  const parts = [
    priorityLabel(task.priority),
    frequencyLabel(task.frequency),
    dueDateLabel(task, now),
    task.assignedCaregiverName || "Unassigned",
  ];
  const overdue = overdueLabel(task, now);
  if (overdue) parts.push(overdue);
  return parts.filter(Boolean).join(" · ");
}

export function nextDueDate(task, now = new Date()) {
  const today = todayIso(now);
  let due = parseIsoDate(task.dueDate) || new Date(now);
  due = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  if (task.frequency === CARE_TASK_FREQUENCY.ONCE || task.frequency === CARE_TASK_FREQUENCY.AS_NEEDED) {
    return isoDate(due);
  }

  if (task.frequency === CARE_TASK_FREQUENCY.WEEKLY) {
    const weekday = Number.isInteger(Number(task.weekday)) ? Number(task.weekday) : due.getDay();
    do {
      due.setDate(due.getDate() + 1);
    } while (isoDate(due) <= today || due.getDay() !== weekday);
    return isoDate(due);
  }

  if (task.frequency === CARE_TASK_FREQUENCY.MONTHLY) {
    do {
      due.setMonth(due.getMonth() + 1);
    } while (isoDate(due) <= today);
    return isoDate(due);
  }

  do {
    due.setDate(due.getDate() + 1);
  } while (isoDate(due) <= today);
  return isoDate(due);
}

export function recurrenceEnded(task, nextDue) {
  if (!isRecurringFrequency(task.frequency) || !task.repeatUntil) return false;
  return String(nextDue || "") > String(task.repeatUntil);
}

export function planProgress(tasks = [], now = new Date()) {
  const today = todayIso(now);
  const visible = tasks.filter((task) => (
    task.status !== CARE_TASK_STATUS.SKIPPED || isRecurringFrequency(task.frequency)
  ));
  const done = visible.filter((task) => isCaughtUp(task, now, today)).length;
  const overdue = visible.filter((task) => liveCareTaskStatus(task, now) === CARE_TASK_STATUS.MISSED).length;
  const total = visible.length;
  const open = Math.max(0, total - done);
  return {
    done,
    open,
    overdue,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

function isCaughtUp(task, now, today) {
  const live = liveCareTaskStatus(task, now);
  if (live === CARE_TASK_STATUS.COMPLETED) return true;
  if (task.status === CARE_TASK_STATUS.SKIPPED && !isRecurringFrequency(task.frequency)) return true;
  if (isRecurringFrequency(task.frequency) && task.dueDate && task.dueDate > today) return true;
  if (task.frequency === CARE_TASK_FREQUENCY.AS_NEEDED && task.lastCompletedAt) {
    return isoDate(new Date(task.lastCompletedAt)) === today;
  }
  return false;
}

export function isRecurringFrequency(frequency) {
  return frequency === CARE_TASK_FREQUENCY.DAILY
    || frequency === CARE_TASK_FREQUENCY.WEEKLY
    || frequency === CARE_TASK_FREQUENCY.MONTHLY;
}

export function canManageCarePlan(session, actor, senior) {
  if (!session) return false;
  if (session.role === ROLES.ADMIN) return true;
  if (senior?.ownerId && senior.ownerId === session.id) return true;
  if (session.role === ROLES.FAMILY) return true;
  if (session.role === ROLES.HEALTH_PRACTITIONER) return true;
  if (actor?.role === CARE_CIRCLE_ROLES.OWNER || actor?.role === CARE_CIRCLE_ROLES.COORDINATOR) return true;
  return hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_CARE)
    || hasPermission(actor, CIRCLE_PERMISSIONS.EDIT_PROFILE);
}

export function canCompleteCareTask(task, session, actor) {
  if (!session) return false;
  if (session.role === ROLES.ADMIN) return true;
  if (session.role === ROLES.FAMILY || session.role === ROLES.HEALTH_PRACTITIONER) return true;
  if (task?.assignedCaregiverUserId && task.assignedCaregiverUserId === session.id) return true;
  const email = String(session.email || "").trim().toLowerCase();
  if (email && String(task?.assignedCaregiverEmail || "").trim().toLowerCase() === email) return true;
  if (actor?.status === CIRCLE_STATUS.ACTIVE && actor.userId === session.id) return true;
  return hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_CARE);
}

export function weekdayFromDueDate(dueDate, fallback = null) {
  const date = parseIsoDate(dueDate);
  if (!date) return fallback;
  return date.getDay();
}

export function optionHtml(options, selected) {
  return options.map((item) => {
    const value = String(item.id);
    const current = selected == null ? "" : String(selected);
    const selectedAttr = value === current ? " selected" : "";
    return `<option value="${value}"${selectedAttr}>${item.label}</option>`;
  }).join("");
}

export function dueWeekdayLabel(task) {
  if (task.frequency !== CARE_TASK_FREQUENCY.WEEKLY) return "";
  const weekday = Number.isInteger(Number(task.weekday)) ? Number(task.weekday) : weekdayFromDueDate(task.dueDate);
  return weekdayLabel(weekday, { long: true });
}
