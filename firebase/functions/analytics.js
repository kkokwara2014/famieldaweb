/**
 * Product analytics — Module 33.
 * Funnel and billing events only. No names, emails, notes, or clinical content.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");

const EVENTS = "analyticsEvents";
const USERS = "users";

const NAMES = {
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

const NAME_LIST = Object.values(NAMES);

const ALLOWED = new Set([
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
]);

const DENIED = /(email|phone|address|diagnos|medicat|symptom|clinical|mood|ssn|dob|note|message|displayName|preferredName|seniorName|caregiverName|familyName|body|title)/i;

const PLUS = new Set(["plus", "family", "circle"]);
const ACTIVE = new Set(["active", "trialing", "past_due"]);
const CANCELLED = new Set(["canceled", "cancelled", "unpaid"]);

function db() {
  return getFirestore();
}

function textOf(value, max = 80) {
  if (value == null) return "";
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return String(value).trim().slice(0, max);
}

function catalogPlan(plan) {
  return PLUS.has(plan) ? "plus" : "free";
}

function docId(dedupeKey) {
  return String(dedupeKey || "").replace(/[/#?[\]]+/g, "_").slice(0, 700);
}

function propertiesOf(input = {}) {
  const out = {};
  Object.entries(input).forEach(([key, value]) => {
    if (!ALLOWED.has(key) || DENIED.test(key) || value == null || value === "") return;
    out[key] = typeof value === "boolean" ? value : textOf(value, 80);
  });
  return out;
}

function inviteEventName(kind) {
  if (kind === "caregiver") return NAMES.CAREGIVER_INVITED;
  if (kind === "practitioner") return NAMES.PRACTITIONER_INVITED;
  return NAMES.FAMILY_INVITED;
}

async function writeProductEvent(input = {}) {
  const name = textOf(input.name, 64);
  if (!NAME_LIST.includes(name)) return null;

  const props = propertiesOf(input);
  const dedupeKey = textOf(input.dedupeKey || props.dedupeKey, 200);
  const id = docId(dedupeKey);
  const ref = id ? db().collection(EVENTS).doc(id) : db().collection(EVENTS).doc();

  try {
    if (id) {
      const existing = await ref.get();
      if (existing.exists) return existing.id;
    }
    const record = {
      name,
      userId: textOf(input.userId, 128),
      plan: catalogPlan(input.plan),
      platform: textOf(input.platform, 20) || "server",
      source: "server",
      ...props,
      createdAt: FieldValue.serverTimestamp(),
    };
    const role = textOf(input.role, 40);
    if (role) record.role = role;
    if (dedupeKey) record.dedupeKey = dedupeKey;
    await ref.set(record);
    return ref.id;
  } catch (error) {
    logger.warn("Product analytics event was not recorded.", { name, message: error.message });
    return null;
  }
}

function trackQuietly(input) {
  return writeProductEvent(input).catch((error) => {
    logger.warn("Product analytics event failed.", { message: error.message });
    return null;
  });
}

async function actorFields(uid) {
  if (!uid) return { userId: "", role: null, plan: "free" };
  try {
    const snap = await db().doc(`${USERS}/${uid}`).get();
    const data = snap.exists ? snap.data() : {};
    return {
      userId: uid,
      role: data.role || null,
      plan: data.plan || "free",
    };
  } catch {
    return { userId: uid, role: null, plan: "free" };
  }
}

async function trackInvite(uid, kind, extra = {}) {
  const actor = await actorFields(uid);
  const name = inviteEventName(kind);
  return trackQuietly({
    name,
    ...actor,
    inviteKind: kind === "caregiver" || kind === "practitioner" ? kind : "family",
    platform: "server",
    ...extra,
    dedupeKey: extra.dedupeKey || `${name}:${extra.inviteId || ""}`,
  });
}

async function trackBillingChange({
  uid,
  previousPlan,
  previousStatus,
  previousCancelAtPeriodEnd,
  plan,
  status,
  cancelAtPeriodEnd,
  subscriptionId,
  interval,
} = {}) {
  const actor = await actorFields(uid);
  const wasPlus = PLUS.has(previousPlan);
  const isPlus = PLUS.has(plan);
  const wasCancelled = CANCELLED.has(String(previousStatus || "").toLowerCase());
  const nowCancelled = CANCELLED.has(String(status || "").toLowerCase());

  if (isPlus && !wasPlus && ACTIVE.has(status)) {
    await trackQuietly({
      name: NAMES.PLUS_UPGRADE,
      ...actor,
      plan,
      planFrom: catalogPlan(previousPlan),
      planTo: "plus",
      status,
      interval: interval || "",
      subscriptionId: subscriptionId || "",
      platform: "server",
      dedupeKey: `plus_upgrade:${uid}:${subscriptionId || "sub"}`,
    });
  }

  const newlyCancelled = (nowCancelled && !wasCancelled)
    || (Boolean(cancelAtPeriodEnd) && !previousCancelAtPeriodEnd && isPlus);
  if (newlyCancelled) {
    await trackQuietly({
      name: NAMES.SUBSCRIPTION_CANCELLED,
      ...actor,
      plan,
      planFrom: catalogPlan(previousPlan || plan),
      status,
      cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd),
      subscriptionId: subscriptionId || "",
      platform: "server",
      dedupeKey: `subscription_cancelled:${uid}:${subscriptionId || "sub"}`,
    });
  }
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function emptyCounts() {
  return Object.fromEntries(NAME_LIST.map((name) => [name, 0]));
}

function ratio(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part) / Number(whole)) * 1000) / 10;
}

function summarize(events, now = Date.now()) {
  const totals = emptyCounts();
  const last7 = emptyCounts();
  const last30 = emptyCounts();
  const week = now - 7 * 24 * 60 * 60 * 1000;
  const month = now - 30 * 24 * 60 * 60 * 1000;

  events.forEach((event) => {
    const name = event.name;
    if (!NAME_LIST.includes(name)) return;
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
      roleSelected: ratio(totals.role_selected, registered),
      seniorCreated: ratio(totals.senior_created, registered),
      plusUpgrade: ratio(totals.plus_upgrade, registered),
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

exports.NAMES = NAMES;
exports.inviteEventName = inviteEventName;
exports.writeProductEvent = writeProductEvent;
exports.trackQuietly = trackQuietly;
exports.trackInvite = trackInvite;
exports.trackBillingChange = trackBillingChange;
exports.actorFields = actorFields;
exports.summarize = summarize;

exports.adminGetProductAnalytics = async (request) => {
  const adminConsole = require("./admin");
  await adminConsole.requireAdmin(request);
  const snap = await db().collection(EVENTS).orderBy("createdAt", "desc").limit(200).get().catch(async () => (
    db().collection(EVENTS).limit(200).get()
  ));
  const events = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: toIso(doc.data()?.createdAt),
  }));
  return summarize(events);
};
