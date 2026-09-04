import { AUTH } from "../config/constants.js";
import {
  ANALYTICS_SOURCES,
  PRODUCT_EVENT_NAMES,
  PRODUCT_EVENTS,
  analyticsDocId,
  inviteEventName,
  isProductEvent,
  summarizeProductEvents,
} from "../config/analytics.js";
import { createAnalyticsEvent } from "../models/analytics-event.js";
import { storage } from "../core/storage.js";
import { logger } from "../core/logger.js";
import { getFirebaseDb, getFirestoreSdk, initFirebase, usesLiveAuth } from "../core/firebase.js";
import { getSession } from "../auth/session.js";

const EVENTS_KEY = "product-analytics-events";

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function readLocalMap() {
  const existing = storage.get(EVENTS_KEY, null);
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return { ...existing };
  return {};
}

function writeLocalRecord(record) {
  const map = readLocalMap();
  map[record.id] = record;
  storage.set(EVENTS_KEY, map);
  return record;
}

function eventFrom(data) {
  return createAnalyticsEvent({
    ...data,
    createdAt: toIso(data.createdAt) || nowIso(),
  });
}

function toDoc(record) {
  const { id: _id, ...rest } = record;
  const out = {};
  Object.entries(rest).forEach(([key, value]) => {
    if (value == null || value === "") return;
    out[key] = value;
  });
  return out;
}

function actorFrom(actor) {
  if (actor && typeof actor === "object") return actor;
  return getSession();
}

async function persistLive(record) {
  await initFirebase();
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  if (!db || !sdk) return record;

  const ref = record.id
    ? sdk.doc(db, AUTH.ANALYTICS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.ANALYTICS_COLLECTION));
  const existing = record.id ? await sdk.getDoc(ref) : null;
  if (existing?.exists()) return eventFrom({ id: ref.id, ...existing.data() });

  const payload = toDoc({
    ...record,
    id: ref.id,
    source: ANALYTICS_SOURCES.CLIENT,
  });
  await sdk.setDoc(ref, {
    ...payload,
    createdAt: sdk.serverTimestamp(),
  });
  return eventFrom({ ...record, id: ref.id });
}

function persistLocal(record) {
  const saved = eventFrom({
    ...record,
    id: record.id || `evt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    source: ANALYTICS_SOURCES.CLIENT,
  });
  const map = readLocalMap();
  if (map[saved.id]) return eventFrom(map[saved.id]);
  return eventFrom(writeLocalRecord(saved));
}

async function writeEvent(input, actor) {
  const session = actorFrom(actor);
  const name = String(input.name || "").trim();
  if (!isProductEvent(name)) return null;

  const dedupeKey = String(input.dedupeKey || "").trim();
  const record = createAnalyticsEvent({
    ...input,
    name,
    id: analyticsDocId(dedupeKey),
    userId: input.userId || session?.id || "",
    role: input.role || session?.role || null,
    plan: input.plan || session?.plan,
    platform: input.platform || AUTH.PLATFORM,
    source: ANALYTICS_SOURCES.CLIENT,
    createdAt: nowIso(),
  });
  if (!record.name) return null;

  if (usesLiveAuth()) return persistLive(record);
  return persistLocal(record);
}

/**
 * Record a product event. Never throws — analytics must not break care flows.
 */
export function trackProductEvent(name, properties = {}, actor = null) {
  return writeEvent({ name, ...properties }, actor).catch((error) => {
    logger.warn("Product analytics event was not recorded.", error);
    return null;
  });
}

export function trackInviteSent(kind, properties = {}, actor = null) {
  return trackProductEvent(inviteEventName(kind), {
    inviteKind: kind === "caregiver" || kind === "practitioner" ? kind : "family",
    ...properties,
  }, actor);
}

export function listLocalAnalyticsEvents() {
  seedMockAnalytics();
  return Object.values(readLocalMap())
    .map((item) => eventFrom(item))
    .filter((item) => item.name)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getLocalProductAnalytics() {
  return summarizeProductEvents(listLocalAnalyticsEvents());
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function seedMockAnalytics() {
  if (Object.keys(readLocalMap()).length) return;
  const samples = [
    { name: PRODUCT_EVENTS.REGISTRATION, userId: "user-family", role: null, plan: "free", hours: 72 },
    { name: PRODUCT_EVENTS.ROLE_SELECTED, userId: "user-family", role: "family", plan: "free", hours: 71 },
    { name: PRODUCT_EVENTS.SENIOR_CREATED, userId: "user-family", role: "family", plan: "free", hours: 70, seniorId: "senior-eleanor" },
    { name: PRODUCT_EVENTS.FAMILY_INVITED, userId: "user-family", role: "family", plan: "plus", hours: 48, inviteKind: "family" },
    { name: PRODUCT_EVENTS.CAREGIVER_INVITED, userId: "user-family", role: "family", plan: "plus", hours: 47, inviteKind: "caregiver" },
    { name: PRODUCT_EVENTS.PRACTITIONER_INVITED, userId: "user-family", role: "family", plan: "plus", hours: 46, inviteKind: "practitioner" },
    { name: PRODUCT_EVENTS.INVITATION_ACCEPTED, userId: "user-caregiver", role: "caregiver", plan: "free", hours: 40, inviteKind: "caregiver" },
    { name: PRODUCT_EVENTS.SCHEDULE_CREATED, userId: "user-family", role: "family", plan: "plus", hours: 30, professionalKind: "caregiver" },
    { name: PRODUCT_EVENTS.VISIT_COMPLETED, userId: "user-caregiver", role: "caregiver", plan: "free", hours: 8, professionalKind: "caregiver" },
    { name: PRODUCT_EVENTS.TASK_COMPLETED, userId: "user-caregiver", role: "caregiver", plan: "free", hours: 7 },
    { name: PRODUCT_EVENTS.PLUS_UPGRADE, userId: "user-family", role: "family", plan: "plus", hours: 50, planFrom: "free", planTo: "plus" },
    { name: PRODUCT_EVENTS.REGISTRATION, userId: "user-practitioner", role: null, plan: "free", hours: 20 },
    { name: PRODUCT_EVENTS.ROLE_SELECTED, userId: "user-practitioner", role: "health_practitioner", plan: "free", hours: 19 },
  ];
  samples.forEach((item, index) => {
    const createdAt = hoursAgo(item.hours);
    const record = createAnalyticsEvent({
      ...item,
      id: `seed-${item.name}-${index}`,
      dedupeKey: `seed:${item.name}:${index}`,
      platform: AUTH.PLATFORM,
      source: ANALYTICS_SOURCES.CLIENT,
      createdAt,
    });
    writeLocalRecord(record);
  });
}

export { PRODUCT_EVENTS, PRODUCT_EVENT_NAMES, summarizeProductEvents };
