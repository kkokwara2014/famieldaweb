/**
 * Product analytics — Module 33.
 * Funnel and billing events only. Never attach clinical or household content.
 */

export const PRODUCT_EVENTS = {
  REGISTRATION: "registration",
  ROLE_SELECTED: "role_selected",
  SENIOR_CREATED: "senior_created",
  FAMILY_INVITED: "family_invited",
  CAREGIVER_INVITED: "caregiver_invited",
  PRACTITIONER_INVITED: "practitioner_invited",
  INVITATION_ACCEPTED: "invitation_accepted",
  SCHEDULE_CREATED: "schedule_created",
  VISIT_COMPLETED: "visit_completed",
  TASK_COMPLETED: "task_completed",
  PLUS_UPGRADE: "plus_upgrade",
  SUBSCRIPTION_CANCELLED: "subscription_cancelled",
  ANDROID_APP_DOWNLOAD_CLICK: "android_app_download_click",
  IOS_APP_DOWNLOAD_CLICK: "ios_app_download_click",
};

export const PRODUCT_EVENT_NAMES = Object.values(PRODUCT_EVENTS);

export const PRODUCT_EVENT_META = [
  { id: PRODUCT_EVENTS.REGISTRATION, label: "Registration", stage: "Acquire" },
  { id: PRODUCT_EVENTS.ROLE_SELECTED, label: "Role selected", stage: "Onboard" },
  { id: PRODUCT_EVENTS.SENIOR_CREATED, label: "Senior created", stage: "Onboard" },
  { id: PRODUCT_EVENTS.FAMILY_INVITED, label: "Family invited", stage: "Circle" },
  { id: PRODUCT_EVENTS.CAREGIVER_INVITED, label: "Caregiver invited", stage: "Circle" },
  { id: PRODUCT_EVENTS.PRACTITIONER_INVITED, label: "Practitioner invited", stage: "Circle" },
  { id: PRODUCT_EVENTS.INVITATION_ACCEPTED, label: "Invitation accepted", stage: "Circle" },
  { id: PRODUCT_EVENTS.SCHEDULE_CREATED, label: "Schedule created", stage: "Care" },
  { id: PRODUCT_EVENTS.VISIT_COMPLETED, label: "Visit completed", stage: "Care" },
  { id: PRODUCT_EVENTS.TASK_COMPLETED, label: "Task completed", stage: "Care" },
  { id: PRODUCT_EVENTS.PLUS_UPGRADE, label: "Plus upgrade", stage: "Billing" },
  { id: PRODUCT_EVENTS.SUBSCRIPTION_CANCELLED, label: "Subscription cancelled", stage: "Billing" },
  { id: PRODUCT_EVENTS.ANDROID_APP_DOWNLOAD_CLICK, label: "Android app download", stage: "Acquire" },
  { id: PRODUCT_EVENTS.IOS_APP_DOWNLOAD_CLICK, label: "iOS app download", stage: "Acquire" },
];

/** Keys that may be stored on an analytics event. Everything else is dropped. */
export const ANALYTICS_ALLOWED_KEYS = [
  "name",
  "userId",
  "role",
  "plan",
  "platform",
  "source",
  "inviteKind",
  "professionalKind",
  "professionalType",
  "outcome",
  "planFrom",
  "planTo",
  "status",
  "cancelAtPeriodEnd",
  "interval",
  "seniorId",
  "visitId",
  "taskId",
  "inviteId",
  "completionId",
  "subscriptionId",
  "dedupeKey",
  "createdAt",
];

/**
 * Property names that look like health or identity content.
 * Dropped even if a caller tries to attach them.
 */
export const ANALYTICS_DENIED_KEYS = [
  "email",
  "name",
  "displayName",
  "firstName",
  "lastName",
  "preferredName",
  "body",
  "notes",
  "note",
  "title",
  "message",
  "phone",
  "phoneCountry",
  "phoneNumber",
  "address",
  "location",
  "dob",
  "dateOfBirth",
  "ssn",
  "mrn",
  "diagnosis",
  "diagnoses",
  "medication",
  "medications",
  "dose",
  "symptoms",
  "mood",
  "clinical",
  "careStatus",
  "summary",
  "photoURL",
  "emergencyContacts",
  "importantInfo",
  "carePreferences",
  "actorName",
  "seniorName",
  "caregiverName",
  "familyName",
];

export const ANALYTICS_SOURCES = {
  CLIENT: "client",
  SERVER: "server",
};

export const ANALYTICS_PRIVACY_NOTE =
  "Product analytics stores event names, role, plan, and opaque IDs. It does not store names, emails, notes, medications, or other health information.";

export function isProductEvent(name) {
  return PRODUCT_EVENT_NAMES.includes(name);
}

export function productEventLabel(name) {
  return PRODUCT_EVENT_META.find((item) => item.id === name)?.label
    || String(name || "").replaceAll("_", " ");
}

export function inviteEventName(kind) {
  if (kind === "caregiver") return PRODUCT_EVENTS.CAREGIVER_INVITED;
  if (kind === "practitioner") return PRODUCT_EVENTS.PRACTITIONER_INVITED;
  return PRODUCT_EVENTS.FAMILY_INVITED;
}

export function analyticsDocId(dedupeKey) {
  const raw = String(dedupeKey || "").trim();
  if (!raw) return "";
  return raw.replace(/[/#?[\]]+/g, "_").slice(0, 700);
}

export function emptyProductCounts() {
  return Object.fromEntries(PRODUCT_EVENT_NAMES.map((name) => [name, 0]));
}

export function productConversionRate(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part) / Number(whole)) * 1000) / 10;
}

export function summarizeProductEvents(events = [], now = Date.now()) {
  const totals = emptyProductCounts();
  const last7 = emptyProductCounts();
  const last30 = emptyProductCounts();
  const week = now - 7 * 24 * 60 * 60 * 1000;
  const month = now - 30 * 24 * 60 * 60 * 1000;

  events.forEach((event) => {
    const name = event.name;
    if (!PRODUCT_EVENT_NAMES.includes(name)) return;
    totals[name] += 1;
    const at = Date.parse(event.createdAt || "") || 0;
    if (at >= month) last30[name] += 1;
    if (at >= week) last7[name] += 1;
  });

  const registered = totals.registration || 0;
  return {
    generatedAt: new Date(now).toISOString(),
    totals,
    last7,
    last30,
    conversion: {
      roleSelected: productConversionRate(totals.role_selected, registered),
      seniorCreated: productConversionRate(totals.senior_created, registered),
      plusUpgrade: productConversionRate(totals.plus_upgrade, registered),
    },
    recent: events.slice(0, 40).map((event) => ({
      id: event.id,
      name: event.name,
      role: event.role || null,
      plan: event.plan || "free",
      platform: event.platform || "",
      source: event.source || "",
      inviteKind: event.inviteKind || "",
      createdAt: event.createdAt || null,
    })),
  };
}
