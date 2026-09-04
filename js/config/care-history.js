import {
  ACTIVITY_TYPES,
  CARE_HISTORY_KINDS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  ROLES,
} from "./constants.js";
import { hasPermission } from "./care-circle.js";
import { ENTITLEMENT_MESSAGES } from "./entitlements.js";
import { isoDate } from "../scheduling/time.js";
import { seniorHubHref } from "./senior-hub.js";

export const CARE_HISTORY_PLUS_MESSAGE = ENTITLEMENT_MESSAGES.careHistory;

export const CARE_HISTORY_FILTERS = [
  { id: "all", label: "All", kinds: null },
  {
    id: "visits",
    label: "Check-ins",
    kinds: [CARE_HISTORY_KINDS.CHECK_IN, CARE_HISTORY_KINDS.CHECK_OUT],
  },
  {
    id: "tasks",
    label: "Tasks",
    kinds: [CARE_HISTORY_KINDS.TASK, CARE_HISTORY_KINDS.CARE],
  },
  {
    id: "medications",
    label: "Medications",
    kinds: [CARE_HISTORY_KINDS.MEDICATION],
  },
  {
    id: "clinical",
    label: "Clinical",
    kinds: [CARE_HISTORY_KINDS.CLINICAL, CARE_HISTORY_KINDS.APPOINTMENT, CARE_HISTORY_KINDS.DOCUMENT],
  },
  {
    id: "notes",
    label: "Notes",
    kinds: [CARE_HISTORY_KINDS.NOTE, CARE_HISTORY_KINDS.VISIT_NOTE, CARE_HISTORY_KINDS.VISIT_REPORT],
  },
];

const KIND_META = {
  [CARE_HISTORY_KINDS.CHECK_IN]: {
    label: "Check-in",
    badge: "badge--success",
    tone: "success",
    href: "schedule",
  },
  [CARE_HISTORY_KINDS.CHECK_OUT]: {
    label: "Check-out",
    badge: "badge--neutral",
    tone: "neutral",
    href: "schedule",
  },
  [CARE_HISTORY_KINDS.TASK]: {
    label: "Task",
    badge: "badge--brand",
    tone: "brand",
    href: "tasks",
  },
  [CARE_HISTORY_KINDS.MEDICATION]: {
    label: "Medication",
    badge: "badge--info",
    tone: "info",
    href: "medications",
  },
  [CARE_HISTORY_KINDS.APPOINTMENT]: {
    label: "Appointment",
    badge: "badge--info",
    tone: "info",
    href: "appointments",
  },
  [CARE_HISTORY_KINDS.CLINICAL]: {
    label: "Clinical",
    badge: "badge--warning",
    tone: "warning",
    href: "history",
  },
  [CARE_HISTORY_KINDS.DOCUMENT]: {
    label: "Document",
    badge: "badge--neutral",
    tone: "neutral",
    href: "documents",
  },
  [CARE_HISTORY_KINDS.NOTE]: {
    label: "Note",
    badge: "badge--brand",
    tone: "brand",
    href: "history",
  },
  [CARE_HISTORY_KINDS.VISIT_NOTE]: {
    label: "Visit note",
    badge: "badge--brand",
    tone: "brand",
    href: "schedule",
  },
  [CARE_HISTORY_KINDS.VISIT_REPORT]: {
    label: "Visit report",
    badge: "badge--success",
    tone: "success",
    href: "schedule",
  },
  [CARE_HISTORY_KINDS.CIRCLE]: {
    label: "Circle",
    badge: "badge--neutral",
    tone: "neutral",
    href: "caregivers",
  },
  [CARE_HISTORY_KINDS.SCHEDULE]: {
    label: "Schedule",
    badge: "badge--info",
    tone: "info",
    href: "schedule",
  },
  [CARE_HISTORY_KINDS.CARE]: {
    label: "Care",
    badge: "badge--brand",
    tone: "brand",
    href: "care-plan",
  },
  [CARE_HISTORY_KINDS.SYSTEM]: {
    label: "System",
    badge: "badge--neutral",
    tone: "neutral",
    href: "history",
  },
};

const TYPE_FROM_KIND = {
  [CARE_HISTORY_KINDS.CHECK_IN]: ACTIVITY_TYPES.SCHEDULE,
  [CARE_HISTORY_KINDS.CHECK_OUT]: ACTIVITY_TYPES.SCHEDULE,
  [CARE_HISTORY_KINDS.TASK]: ACTIVITY_TYPES.CARE,
  [CARE_HISTORY_KINDS.MEDICATION]: ACTIVITY_TYPES.CARE,
  [CARE_HISTORY_KINDS.APPOINTMENT]: ACTIVITY_TYPES.SCHEDULE,
  [CARE_HISTORY_KINDS.CLINICAL]: ACTIVITY_TYPES.CLINICAL,
  [CARE_HISTORY_KINDS.DOCUMENT]: ACTIVITY_TYPES.CARE,
  [CARE_HISTORY_KINDS.NOTE]: ACTIVITY_TYPES.CARE,
  [CARE_HISTORY_KINDS.VISIT_NOTE]: ACTIVITY_TYPES.CARE,
  [CARE_HISTORY_KINDS.VISIT_REPORT]: ACTIVITY_TYPES.CARE,
  [CARE_HISTORY_KINDS.CIRCLE]: ACTIVITY_TYPES.CIRCLE,
  [CARE_HISTORY_KINDS.SCHEDULE]: ACTIVITY_TYPES.SCHEDULE,
  [CARE_HISTORY_KINDS.CARE]: ACTIVITY_TYPES.CARE,
  [CARE_HISTORY_KINDS.SYSTEM]: ACTIVITY_TYPES.SYSTEM,
};

export function careHistoryKindMeta(kind) {
  return KIND_META[kind] ?? KIND_META[CARE_HISTORY_KINDS.CARE];
}

export function careHistoryKindLabel(kind) {
  return careHistoryKindMeta(kind).label;
}

export function careHistoryKindBadge(kind) {
  return careHistoryKindMeta(kind).badge;
}

export function activityTypeFromKind(kind, fallback = ACTIVITY_TYPES.CARE) {
  return TYPE_FROM_KIND[kind] ?? fallback;
}

export function careHistoryHref(kind, extra = "") {
  const section = careHistoryKindMeta(kind).href || "history";
  if (extra && String(extra).includes(".html")) return extra;
  return seniorHubHref(section);
}

export function formatHistoryTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function historyDayKey(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return isoDate(date) || isoDate(now);
}

export function historyDayLabel(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function groupHistoryByDay(events = [], now = new Date()) {
  const groups = new Map();
  for (const event of events) {
    const key = event.dayKey || historyDayKey(event.occurredAt || event.createdAt, now);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        label: event.dayLabel || historyDayLabel(event.occurredAt || event.createdAt, now),
        events: [],
      });
    }
    groups.get(key).events.push(event);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    events: group.events.sort(byOldest),
  }));
}

export function filterHistoryEvents(events = [], { filter = "all", query = "" } = {}) {
  const selected = CARE_HISTORY_FILTERS.find((item) => item.id === filter);
  const kinds = selected?.kinds;
  const needle = String(query || "").trim().toLowerCase();
  return events.filter((event) => {
    if (kinds && !kinds.includes(event.kind)) return false;
    if (!needle) return true;
    const haystack = [event.title, event.body, event.actor, event.kindLabel]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function historyCounts(events = [], now = new Date()) {
  const todayKey = isoDate(now);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - now.getDay());
  const today = events.filter((item) => item.dayKey === todayKey);
  const week = events.filter((item) => {
    const at = new Date(item.occurredAt || item.createdAt);
    return !Number.isNaN(at.getTime()) && at >= weekStart;
  });
  return {
    total: events.length,
    today: today.length,
    week: week.length,
    checkIns: today.filter((item) => item.kind === CARE_HISTORY_KINDS.CHECK_IN).length,
    checkOuts: today.filter((item) => item.kind === CARE_HISTORY_KINDS.CHECK_OUT).length,
    tasks: today.filter((item) => item.kind === CARE_HISTORY_KINDS.TASK).length,
    medications: today.filter((item) => item.kind === CARE_HISTORY_KINDS.MEDICATION).length,
  };
}

export function canAddCareHistoryNote(session, actor, senior) {
  if (!session || !senior) return false;
  if (session.role === ROLES.ADMIN) return true;
  if (senior.ownerId && senior.ownerId === session.id) return true;
  if (session.role === ROLES.FAMILY || session.role === ROLES.CAREGIVER || session.role === ROLES.HEALTH_PRACTITIONER) {
    return true;
  }
  if (actor?.status === CIRCLE_STATUS.ACTIVE && actor.userId === session.id) return true;
  return hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_CARE)
    || hasPermission(actor, CIRCLE_PERMISSIONS.VIEW_CLINICAL);
}

export function defaultHistoryTitle(kind) {
  const titles = {
    [CARE_HISTORY_KINDS.CHECK_IN]: "Caregiver checked in",
    [CARE_HISTORY_KINDS.CHECK_OUT]: "Caregiver checked out",
    [CARE_HISTORY_KINDS.TASK]: "Task completed",
    [CARE_HISTORY_KINDS.MEDICATION]: "Medication recorded",
    [CARE_HISTORY_KINDS.APPOINTMENT]: "Appointment updated",
    [CARE_HISTORY_KINDS.CLINICAL]: "Clinical note",
    [CARE_HISTORY_KINDS.NOTE]: "Care note",
    [CARE_HISTORY_KINDS.VISIT_NOTE]: "Visit note added",
    [CARE_HISTORY_KINDS.VISIT_REPORT]: "Visit report submitted",
    [CARE_HISTORY_KINDS.CIRCLE]: "Circle update",
    [CARE_HISTORY_KINDS.SCHEDULE]: "Schedule update",
    [CARE_HISTORY_KINDS.CARE]: "Care update",
    [CARE_HISTORY_KINDS.SYSTEM]: "System update",
  };
  return titles[kind] || "Care update";
}

function byOldest(a, b) {
  return String(a.occurredAt || a.createdAt).localeCompare(String(b.occurredAt || b.createdAt));
}
