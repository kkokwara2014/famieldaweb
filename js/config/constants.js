export const AUTH = {
  MIN_PASSWORD_LENGTH: 8,
  PLATFORM: "web",
  USERS_COLLECTION: "users",
  SENIORS_COLLECTION: "seniors",
  CIRCLE_COLLECTION: "careCircleMembers",
  CIRCLE_INVITES_COLLECTION: "careCircleInvites",
  AVAILABILITY_COLLECTION: "caregiverAvailability",
  VISITS_COLLECTION: "scheduleVisits",
  SCHEDULE_LOCKS_COLLECTION: "caregiverScheduleLocks",
  CARE_PLANS_COLLECTION: "carePlans",
  CARE_PLAN_TASKS_COLLECTION: "carePlanTasks",
  CARE_PLAN_COMPLETIONS_COLLECTION: "carePlanCompletions",
  APPOINTMENTS_COLLECTION: "appointments",
  MEDICATIONS_COLLECTION: "medications",
  MEDICATION_DOSES_COLLECTION: "medicationDoses",
  ACTIVITIES_COLLECTION: "activities",
  DOCUMENTS_COLLECTION: "documents",
  CONVERSATIONS_COLLECTION: "conversations",
  MESSAGES_COLLECTION: "messages",
  NOTIFICATIONS_COLLECTION: "notifications",
  FCM_TOKENS_SUBCOLLECTION: "fcmTokens",
  SUBSCRIPTIONS_COLLECTION: "subscriptions",
  SUPPORT_TICKETS_COLLECTION: "supportTickets",
  ADMIN_AUDIT_COLLECTION: "adminAuditLogs",
  AUDIT_COLLECTION: "auditLogs",
  RATE_LIMITS_COLLECTION: "rateLimits",
  VERIFICATIONS_COLLECTION: "professionalVerifications",
  VERIFICATION_DOCS_COLLECTION: "professionalVerificationDocuments",
  FAMILY_REFERRALS_COLLECTION: "familyReferrals",
  FAMILY_REFERRAL_CODES_COLLECTION: "familyReferralCodes",
  FAMILY_REFERRAL_CODE_INDEX_COLLECTION: "familyReferralCodeIndex",
  ANALYTICS_COLLECTION: "analyticsEvents",
  MONITORING_COLLECTION: "monitoringEvents",
  RESEND_COOLDOWN_MS: 45_000,
};

export const ROLES = {
  FAMILY: "family",
  CAREGIVER: "caregiver",
  HEALTH_PRACTITIONER: "health_practitioner",
  ADMIN: "admin",
};

export const PROFESSIONAL_TYPES = {
  CNA: "cna",
  CMT: "cmt",
  OTHER_CAREGIVER: "other_caregiver",
  NURSE: "nurse",
  PHYSIOTHERAPIST: "physiotherapist",
  MD: "md",
  OTHER: "other",
};

export const CARE_TYPES = {
  PERSONAL_CARE: "personal_care",
  MEDICATION: "medication",
  COMPANIONSHIP: "companionship",
  HOUSEHOLD: "household",
  MOBILITY: "mobility",
  OVERNIGHT: "overnight",
};

export const ONBOARDING_PATH = {
  CREATE_SENIOR: "create_senior",
  JOIN_EXISTING: "join_existing",
};

export const CARE_CIRCLE_ROLES = {
  OWNER: "owner",
  COORDINATOR: "coordinator",
  MEMBER: "member",
  VIEWER: "viewer",
};

export const CIRCLE_KINDS = {
  FAMILY: "family",
  CAREGIVER: "caregiver",
  PRACTITIONER: "practitioner",
};

export const CIRCLE_STATUS = {
  ACTIVE: "active",
  INVITED: "invited",
  DECLINED: "declined",
  REMOVED: "removed",
};

export const INVITE_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  REVOKED: "revoked",
};

export const FAMILY_REFERRAL_STATUS = {
  PENDING: "pending",
  JOINED: "joined",
  SUCCESSFUL: "successful",
  REVOKED: "revoked",
};

export const FAMILY_REFERRAL_CHANNEL = {
  EMAIL: "email",
  LINK: "link",
};

export const CIRCLE_PERMISSIONS = {
  VIEW_PROFILE: "view_profile",
  EDIT_PROFILE: "edit_profile",
  VIEW_SCHEDULE: "view_schedule",
  MANAGE_SCHEDULE: "manage_schedule",
  MESSAGE_CIRCLE: "message_circle",
  INVITE_MEMBERS: "invite_members",
  MANAGE_MEMBERS: "manage_members",
  VIEW_CLINICAL: "view_clinical",
  MANAGE_CARE: "manage_care",
};

export const CARE_STATUS = {
  STABLE: "stable",
  ATTENTION: "attention",
  URGENT: "urgent",
};

export const AVAILABILITY = {
  ON_DUTY: "on_duty",
  AVAILABLE: "available",
  OFF_DUTY: "off_duty",
};

export const VISIT_STATUS = {
  REQUESTED: "requested",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CHECKED_IN: "checked_in",
  CHECKED_OUT: "checked_out",
  CANCELLED: "cancelled",
};

export const CARE_PLAN_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  ARCHIVED: "archived",
};

export const CARE_TASK_STATUS = {
  OPEN: "open",
  COMPLETED: "completed",
  SKIPPED: "skipped",
  MISSED: "missed",
};

export const CARE_TASK_FREQUENCY = {
  ONCE: "once",
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  AS_NEEDED: "as_needed",
};

export const CARE_TASK_PRIORITY = {
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

export const CARE_TASK_CATEGORY = {
  MEDICATION: "medication",
  PERSONAL_CARE: "personal_care",
  MOBILITY: "mobility",
  NUTRITION: "nutrition",
  HOUSEHOLD: "household",
  CLINICAL: "clinical",
  OTHER: "other",
};

export const APPOINTMENT_STATUS = {
  SCHEDULED: "scheduled",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  MISSED: "missed",
};

export const APPOINTMENT_REMINDER = {
  NONE: "none",
  AT_TIME: "at_time",
  MINUTES_15: "15min",
  HOUR_1: "1hour",
  DAY_1: "1day",
  DAY_2: "2days",
};

export const MEDICATION_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  ENDED: "ended",
};

export const MEDICATION_FREQUENCY = {
  ONCE: "once",
  DAILY: "daily",
  TWICE_DAILY: "twice_daily",
  THREE_TIMES: "three_times",
  WEEKLY: "weekly",
  EVERY_OTHER: "every_other",
  AS_NEEDED: "as_needed",
};

export const MEDICATION_REMINDER = {
  NONE: "none",
  AT_TIME: "at_time",
  MINUTES_15: "15min",
  HOUR_1: "1hour",
};

export const MEDICATION_DOSE_OUTCOME = {
  TAKEN: "taken",
  SKIPPED: "skipped",
  MISSED: "missed",
};

export const ACTIVITY_TYPES = {
  CARE: "care",
  SCHEDULE: "schedule",
  CLINICAL: "clinical",
  CIRCLE: "circle",
  SYSTEM: "system",
};

export const CARE_HISTORY_KINDS = {
  CHECK_IN: "check_in",
  CHECK_OUT: "check_out",
  TASK: "task",
  MEDICATION: "medication",
  APPOINTMENT: "appointment",
  CLINICAL: "clinical",
  DOCUMENT: "document",
  NOTE: "note",
  VISIT_NOTE: "visit_note",
  VISIT_REPORT: "visit_report",
  CIRCLE: "circle",
  SCHEDULE: "schedule",
  CARE: "care",
  SYSTEM: "system",
};

export const SUBSCRIPTION_PLANS = {
  FREE: "free",
  PLUS: "plus",
  FAMILY: "family",
  CIRCLE: "circle",
};

export const SUBSCRIPTION_STATUS = {
  NONE: "none",
  INCOMPLETE: "incomplete",
  ACTIVE: "active",
  TRIALING: "trialing",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  UNPAID: "unpaid",
  PAUSED: "paused",
};

export const ACCOUNT_STATUS = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
};

export const SUPPORT_STATUS = {
  OPEN: "open",
  PENDING: "pending",
  RESOLVED: "resolved",
  CLOSED: "closed",
};

export const SUPPORT_PRIORITY = {
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
  URGENT: "urgent",
};

export const DOCUMENT_CATEGORIES = {
  LEGAL: "legal",
  INSURANCE: "insurance",
  CLINICAL: "clinical",
  IDENTITY: "identity",
  OTHER: "other",
};

export const DOCUMENT_VISIBILITY = {
  CIRCLE: "circle",
  FAMILY: "family",
  CLINICAL: "clinical",
};

export const DOCUMENT_STATUS = {
  ON_FILE: "on_file",
  NEEDS_REVIEW: "needs_review",
};

export const VERIFICATION_STATUS = {
  PENDING: "pending",
  UNDER_REVIEW: "under_review",
  VERIFIED: "verified",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
};

export const VERIFICATION_DOC_KINDS = {
  IDENTITY: "identity",
  LICENSE: "license",
  CERTIFICATION: "certification",
  INSURANCE: "insurance",
  OTHER: "other",
};

export const VERIFICATION_REVIEW_ACTIONS = {
  START_REVIEW: "start_review",
  VERIFY: "verify",
  REJECT: "reject",
  SUSPEND: "suspend",
  RESTORE: "restore",
};

export const CONVERSATION_TYPES = {
  CIRCLE: "circle",
  DIRECT: "direct",
};

export const NOTIFICATION_TYPES = {
  NEW_USER_JOINED: "new_user_joined",
  FAMILY_INVITATION: "family_invitation",
  CAREGIVER_INVITATION: "caregiver_invitation",
  PRACTITIONER_INVITATION: "practitioner_invitation",
  INVITATION_ACCEPTED: "invitation_accepted",
  INVITATION_DECLINED: "invitation_declined",
  SCHEDULE_REQUEST: "schedule_request",
  SCHEDULE_ACCEPTED: "schedule_accepted",
  SCHEDULE_CHANGED: "schedule_changed",
  TASK_ASSIGNED: "task_assigned",
  APPOINTMENT_REMINDER: "appointment_reminder",
  MEDICATION_REMINDER: "medication_reminder",
  CARE_UPDATE: "care_update",
  EMERGENCY_ALERT: "emergency_alert",
  SCHEDULE: "schedule",
  CIRCLE: "circle",
  SENIOR: "senior",
  MEDICATION: "medication",
  DOCUMENT: "document",
  MESSAGE: "message",
  VERIFICATION: "verification",
  FAMILY_REFERRAL: "family_referral",
  FAMILY_REFERRAL_JOINED: "family_referral_joined",
  FAMILY_REFERRAL_SUCCESS: "family_referral_success",
  SYSTEM: "system",
};

export const NOTIFICATION_PRIORITY = {
  NORMAL: "normal",
  HIGH: "high",
  EMERGENCY: "emergency",
};

export const APP_NAV = [
  { id: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "dashboard.svg" },
  { id: "senior", label: "Senior", href: "senior.html", icon: "senior.svg" },
  { id: "care-circle", label: "Care Circle", href: "care-circle.html", icon: "care-circle.svg" },
  { id: "referrals", label: "Invite family", href: "referrals.html", icon: "referrals.svg" },
  { id: "schedule", label: "Schedule", href: "schedule.html", icon: "schedule.svg" },
  { id: "messages", label: "Messages", href: "messages.html", icon: "messages.svg" },
  { id: "notifications", label: "Notifications", href: "notifications.html", icon: "notifications.svg" },
  { id: "settings", label: "Settings", href: "settings.html", icon: "settings.svg" },
];
