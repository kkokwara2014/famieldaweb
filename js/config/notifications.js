import { CIRCLE_KINDS, NOTIFICATION_PRIORITY, NOTIFICATION_TYPES } from "./constants.js";

export const NOTIFICATION_CATALOG = [
  {
    id: NOTIFICATION_TYPES.NEW_USER_JOINED,
    label: "New user joined",
    group: "circle",
    description: "Someone accepted an invitation and joined this household.",
    priority: NOTIFICATION_PRIORITY.NORMAL,
  },
  {
    id: NOTIFICATION_TYPES.FAMILY_INVITATION,
    label: "Family invitation",
    group: "circle",
    description: "You were invited to a family care circle.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.CAREGIVER_INVITATION,
    label: "Caregiver invitation",
    group: "circle",
    description: "You were invited as a caregiver.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.PRACTITIONER_INVITATION,
    label: "Practitioner invitation",
    group: "circle",
    description: "You were invited as a health practitioner.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.INVITATION_ACCEPTED,
    label: "Invitation accepted",
    group: "circle",
    description: "Someone accepted an invitation you sent.",
    priority: NOTIFICATION_PRIORITY.NORMAL,
  },
  {
    id: NOTIFICATION_TYPES.INVITATION_DECLINED,
    label: "Invitation declined",
    group: "circle",
    description: "Someone declined an invitation you sent.",
    priority: NOTIFICATION_PRIORITY.NORMAL,
  },
  {
    id: NOTIFICATION_TYPES.SCHEDULE_REQUEST,
    label: "Schedule request",
    group: "schedule",
    description: "A visit or appointment was requested of you.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.SCHEDULE_ACCEPTED,
    label: "Schedule accepted",
    group: "schedule",
    description: "A requested visit was accepted.",
    priority: NOTIFICATION_PRIORITY.NORMAL,
  },
  {
    id: NOTIFICATION_TYPES.SCHEDULE_CHANGED,
    label: "Schedule changed",
    group: "schedule",
    description: "A visit was moved, extended, or cancelled.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.TASK_ASSIGNED,
    label: "Task assigned",
    group: "care",
    description: "A care-plan task was assigned to you.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.APPOINTMENT_REMINDER,
    label: "Appointment reminder",
    group: "care",
    description: "An upcoming appointment is due.",
    priority: NOTIFICATION_PRIORITY.HIGH,
    plus: true,
  },
  {
    id: NOTIFICATION_TYPES.MEDICATION_REMINDER,
    label: "Medication reminder",
    group: "care",
    description: "A medication dose is due. This is a care reminder, not medical advice.",
    priority: NOTIFICATION_PRIORITY.HIGH,
    plus: true,
  },
  {
    id: NOTIFICATION_TYPES.CARE_UPDATE,
    label: "Important care update",
    group: "care",
    description: "The care plan, visit notes, or household status changed.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.EMERGENCY_ALERT,
    label: "Emergency alert",
    group: "safety",
    description: "Urgent care status that the whole circle should see immediately.",
    priority: NOTIFICATION_PRIORITY.EMERGENCY,
    required: true,
  },
  {
    id: NOTIFICATION_TYPES.MESSAGE,
    label: "Message",
    group: "circle",
    description: "A private message in the household.",
    priority: NOTIFICATION_PRIORITY.NORMAL,
  },
  {
    id: NOTIFICATION_TYPES.VERIFICATION,
    label: "Professional verification",
    group: "account",
    description: "Updates when your credentials are submitted, verified, rejected, or suspended.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.FAMILY_REFERRAL,
    label: "Family referral",
    group: "account",
    description: "A relative invited you to join Famielda.",
    priority: NOTIFICATION_PRIORITY.HIGH,
  },
  {
    id: NOTIFICATION_TYPES.FAMILY_REFERRAL_JOINED,
    label: "Relative joined",
    group: "account",
    description: "Someone you invited created a Famielda account.",
    priority: NOTIFICATION_PRIORITY.NORMAL,
  },
  {
    id: NOTIFICATION_TYPES.FAMILY_REFERRAL_SUCCESS,
    label: "Successful family referral",
    group: "account",
    description: "A relative joined Famielda as family.",
    priority: NOTIFICATION_PRIORITY.NORMAL,
  },
];

export const NOTIFICATION_PREFERENCE_GROUPS = [
  { id: "circle", label: "Care circle" },
  { id: "schedule", label: "Schedule" },
  { id: "care", label: "Care" },
  { id: "safety", label: "Safety" },
  { id: "account", label: "Account" },
];

const LEGACY_LABELS = {
  [NOTIFICATION_TYPES.SCHEDULE]: "Schedule",
  [NOTIFICATION_TYPES.CIRCLE]: "Care circle",
  [NOTIFICATION_TYPES.SENIOR]: "Senior",
  [NOTIFICATION_TYPES.MEDICATION]: "Medication",
  [NOTIFICATION_TYPES.DOCUMENT]: "Document",
  [NOTIFICATION_TYPES.SYSTEM]: "Famielda",
};

export function defaultNotificationPrefs() {
  const types = {};
  for (const item of NOTIFICATION_CATALOG) {
    types[item.id] = true;
  }
  return {
    pushEnabled: true,
    inAppEnabled: true,
    types,
  };
}

export function notificationTypeMeta(type) {
  return NOTIFICATION_CATALOG.find((item) => item.id === type) ?? null;
}

export function notificationTypeLabel(type) {
  return notificationTypeMeta(type)?.label || LEGACY_LABELS[type] || "Notice";
}

export function notificationPriority(type, fallback) {
  if (fallback) return fallback;
  if (type === NOTIFICATION_TYPES.EMERGENCY_ALERT) return NOTIFICATION_PRIORITY.EMERGENCY;
  return notificationTypeMeta(type)?.priority || NOTIFICATION_PRIORITY.NORMAL;
}

export function isRequiredNotificationType(type) {
  return Boolean(notificationTypeMeta(type)?.required) || type === NOTIFICATION_TYPES.EMERGENCY_ALERT;
}

export function isPlusNotificationType(type) {
  return Boolean(notificationTypeMeta(type)?.plus);
}

export function invitationTypeForKind(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return NOTIFICATION_TYPES.CAREGIVER_INVITATION;
  if (kind === CIRCLE_KINDS.PRACTITIONER) return NOTIFICATION_TYPES.PRACTITIONER_INVITATION;
  return NOTIFICATION_TYPES.FAMILY_INVITATION;
}

export function noticeHref(type, data = {}) {
  switch (type) {
    case NOTIFICATION_TYPES.NEW_USER_JOINED:
    case NOTIFICATION_TYPES.FAMILY_INVITATION:
    case NOTIFICATION_TYPES.CAREGIVER_INVITATION:
    case NOTIFICATION_TYPES.PRACTITIONER_INVITATION:
    case NOTIFICATION_TYPES.INVITATION_ACCEPTED:
    case NOTIFICATION_TYPES.INVITATION_DECLINED:
    case NOTIFICATION_TYPES.CIRCLE:
      return data.inviteToken || data.inviteId
        ? `care-circle.html?invite=${encodeURIComponent(data.inviteToken || data.inviteId)}`
        : "care-circle.html";
    case NOTIFICATION_TYPES.SCHEDULE_REQUEST:
    case NOTIFICATION_TYPES.SCHEDULE_ACCEPTED:
    case NOTIFICATION_TYPES.SCHEDULE_CHANGED:
    case NOTIFICATION_TYPES.SCHEDULE:
      return data.visitId ? `schedule.html?visit=${encodeURIComponent(data.visitId)}` : "schedule.html";
    case NOTIFICATION_TYPES.TASK_ASSIGNED:
      return data.taskId
        ? `senior.html?section=tasks&task=${encodeURIComponent(data.taskId)}`
        : "senior.html?section=tasks";
    case NOTIFICATION_TYPES.APPOINTMENT_REMINDER:
      return data.appointmentId
        ? `senior.html?section=appointments&appointment=${encodeURIComponent(data.appointmentId)}`
        : "senior.html?section=appointments";
    case NOTIFICATION_TYPES.MEDICATION_REMINDER:
    case NOTIFICATION_TYPES.MEDICATION:
      return data.medicationId
        ? `senior.html?section=medications&medication=${encodeURIComponent(data.medicationId)}`
        : "senior.html?section=medications";
    case NOTIFICATION_TYPES.CARE_UPDATE:
    case NOTIFICATION_TYPES.SENIOR:
      return "senior.html";
    case NOTIFICATION_TYPES.EMERGENCY_ALERT:
      return "dashboard.html";
    case NOTIFICATION_TYPES.MESSAGE:
      return data.conversationId
        ? `messages.html?thread=${encodeURIComponent(data.conversationId)}`
        : "messages.html";
    case NOTIFICATION_TYPES.DOCUMENT:
      return "senior.html?section=documents";
    case NOTIFICATION_TYPES.VERIFICATION:
      return data.admin || String(data.href || "").includes("/admin/")
        ? "/admin/index.html?section=verification"
        : "verification.html";
    case NOTIFICATION_TYPES.FAMILY_REFERRAL:
    case NOTIFICATION_TYPES.FAMILY_REFERRAL_JOINED:
    case NOTIFICATION_TYPES.FAMILY_REFERRAL_SUCCESS:
      return data.href || "referrals.html";
    default:
      return "notifications.html";
  }
}

export function noticeAppPath(href = "") {
  const value = String(href || "").trim();
  if (!value) return "/app/notifications.html";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return `/app/${value.replace(/^\.\//, "")}`;
}

export function resolveNoticeHref(notice, appRoot = "") {
  const href = notice?.href || noticeHref(notice?.type, notice);
  if (!href) return `${appRoot}/notifications.html`;
  if (/^https?:\/\//i.test(href) || href.startsWith("/")) return href;
  const root = String(appRoot || "").replace(/\/$/, "");
  return `${root}/${href.replace(/^\.\//, "")}`;
}

export function normalizeNotificationPrefs(value = {}) {
  const defaults = defaultNotificationPrefs();
  const types = { ...defaults.types };
  const incoming = value.types && typeof value.types === "object" ? value.types : {};
  for (const key of Object.keys(types)) {
    if (isRequiredNotificationType(key)) {
      types[key] = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      types[key] = incoming[key] !== false;
    }
  }
  return {
    pushEnabled: value.pushEnabled !== false,
    inAppEnabled: value.inAppEnabled !== false,
    types,
  };
}

export function pushAllowedForType(prefs, type) {
  const normalized = normalizeNotificationPrefs(prefs);
  if (isRequiredNotificationType(type)) return true;
  if (!normalized.pushEnabled) return false;
  return normalized.types[type] !== false;
}

export function inAppAllowedForType(prefs, type) {
  const normalized = normalizeNotificationPrefs(prefs);
  if (isRequiredNotificationType(type)) return true;
  if (!normalized.inAppEnabled) return false;
  return normalized.types[type] !== false;
}
