import { AUTH } from "../config/constants.js";
import { createNotification } from "../models/notification.js";
import {
  defaultNotificationPrefs,
  noticeHref,
  notificationPriority,
  normalizeNotificationPrefs,
} from "../config/notifications.js";
import { mockNotifications } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { getQueryDocs } from "../core/query.js";
import { QUERY_LIMITS, CACHE_TTL_MS } from "../config/performance.js";
import { remember } from "../core/cache.js";
import { listenCollection, subscribeShared } from "../core/listeners.js";
import { paginateItems } from "../core/pagination.js";
import { getSession, setSession } from "../auth/session.js";
import { updateUserProfile } from "../auth/user-profile.js";
import { logger } from "../core/logger.js";

const NOTICES_KEY = "notifications";
const PREFS_KEY = "notificationPrefs";
const TOKENS_KEY = "fcmTokens";

function newId() {
  return `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

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

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function noticeFrom(data) {
  return createNotification({
    ...data,
    createdAt: toIso(data.createdAt) || data.createdAt || nowIso(),
    readAt: toIso(data.readAt),
  });
}

function toDoc(notice) {
  const { id: _id, ...rest } = notice;
  return rest;
}

function seed() {
  const existing = storage.get(NOTICES_KEY, null);
  if (existing?.length) {
    const ids = new Set(existing.map((item) => item.id));
    const missing = mockNotifications.filter((item) => !ids.has(item.id));
    if (!missing.length) return existing;
    const merged = [...missing, ...existing];
    storage.set(NOTICES_KEY, merged);
    return merged;
  }
  storage.set(NOTICES_KEY, mockNotifications);
  return mockNotifications;
}

function localNotices() {
  return seed().map((item) => noticeFrom(item));
}

function writeLocal(all) {
  storage.set(NOTICES_KEY, all);
  return all;
}

function belongsToSession(item, session) {
  if (!session) return true;
  if (item.userId && item.userId === session.id) return true;
  if (item.email && emailsEqual(item.email, session.email)) return true;
  if (!item.userId && !item.email) return true;
  return false;
}

function emitLocalChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("famielda:notices"));
  }
}

function sortNotices(items) {
  return items.slice().sort((a, b) => (
    Number(a.read) - Number(b.read)
    || String(b.createdAt).localeCompare(String(a.createdAt))
  ));
}

function dedupeNotices(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function collectionDocs(constraints = [], options = {}) {
  const docs = await getQueryDocs(AUTH.NOTIFICATIONS_COLLECTION, constraints, {
    limit: options.limit ?? QUERY_LIMITS.FEED,
    startAfter: options.startAfter,
    cache: options.cache,
    ttl: options.ttl,
    cacheKey: options.cacheKey,
  });
  return docs.map((item) => noticeFrom(item));
}

async function readLiveNotices(session = getSession(), options = {}) {
  if (!session?.id && !session?.email) return [];
  const sdk = getFirestoreSdk();
  const limit = options.limit ?? QUERY_LIMITS.FEED;
  const key = `notices:${session.id || ""}:${session.email || ""}:${limit}`;
  return remember(key, CACHE_TTL_MS.FEED, async () => {
    const queries = [];
    if (session.id) {
      queries.push(collectionDocs([
        sdk.where("userId", "==", session.id),
        sdk.orderBy("createdAt", "desc"),
      ], { limit, cache: false, cacheKey: `uid:${session.id}` }).catch(() => collectionDocs([
        sdk.where("userId", "==", session.id),
      ], { limit, cache: false })));
    }
    if (session.email) {
      queries.push(collectionDocs([
        sdk.where("email", "==", String(session.email).trim().toLowerCase()),
        sdk.orderBy("createdAt", "desc"),
      ], { limit, cache: false, cacheKey: `email:${session.email}` }).catch(() => collectionDocs([
        sdk.where("email", "==", String(session.email).trim().toLowerCase()),
      ], { limit, cache: false })));
    }
    const batches = await Promise.all(queries);
    return sortNotices(dedupeNotices(batches.flat()));
  });
}

export async function listNotifications(session = getSession(), options = {}) {
  const page = await listNotificationPage(session, options);
  return page.items;
}

export async function listNotificationPage(session = getSession(), options = {}) {
  const limit = options.limit ?? QUERY_LIMITS.FEED;
  if (!usesLiveAuth()) {
    const items = sortNotices(localNotices().filter((item) => belongsToSession(item, session)));
    return paginateItems(items, { limit, cursor: options.cursor });
  }
  const items = await readLiveNotices(session, options);
  return {
    items,
    hasMore: items.length >= limit,
    lastDoc: null,
    limit,
  };
}

export async function unreadCount(session = getSession()) {
  if (!usesLiveAuth()) {
    return (await listNotifications(session)).filter((item) => !item.read).length;
  }
  if (!session?.id && !session?.email) return 0;
  const sdk = getFirestoreSdk();
  const limit = QUERY_LIMITS.UNREAD;
  const queries = [];
  if (session.id) {
    queries.push(collectionDocs([
      sdk.where("userId", "==", session.id),
      sdk.where("read", "==", false),
    ], { limit, cache: false }).catch(() => []));
  }
  if (session.email) {
    queries.push(collectionDocs([
      sdk.where("email", "==", String(session.email).trim().toLowerCase()),
      sdk.where("read", "==", false),
    ], { limit, cache: false }).catch(() => []));
  }
  const items = sortNotices(dedupeNotices((await Promise.all(queries)).flat()));
  return items.filter((item) => !item.read).length;
}

export async function getNotification(id, session = getSession()) {
  if (!id) return null;
  if (!usesLiveAuth()) {
    return localNotices().find((item) => item.id === id) ?? null;
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.NOTIFICATIONS_COLLECTION, id));
  if (!snap.exists()) return null;
  const notice = noticeFrom({ id: snap.id, ...snap.data() });
  return belongsToSession(notice, session) ? notice : null;
}

function buildNotice(input = {}, session = getSession()) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("A notification needs a title.");
  const type = input.type || "system";
  const href = input.href || noticeHref(type, input);
  return createNotification({
    id: input.id || (usesLiveAuth() ? "" : newId()),
    type,
    title,
    body: String(input.body ?? "").trim(),
    createdAt: input.createdAt || nowIso(),
    read: Boolean(input.read),
    readAt: input.readAt || null,
    userId: input.userId || "",
    email: String(input.email || "").trim().toLowerCase(),
    seniorId: input.seniorId || session?.seniorId || "",
    href,
    actorId: input.actorId || session?.id || "",
    actorName: input.actorName || session?.displayName || "",
    entityType: input.entityType || "",
    entityId: input.entityId || "",
    visitId: input.visitId || "",
    inviteId: input.inviteId || "",
    inviteToken: input.inviteToken || "",
    taskId: input.taskId || "",
    appointmentId: input.appointmentId || "",
    medicationId: input.medicationId || "",
    conversationId: input.conversationId || "",
    priority: input.priority || notificationPriority(type),
    channel: input.channel || "all",
  });
}

export async function postNotification(input = {}, session = getSession()) {
  const next = buildNotice(input, session);
  if (!usesLiveAuth()) {
    const all = localNotices();
    if (all.some((item) => item.id === next.id)) return next;
    writeLocal([next, ...all]);
    emitLocalChange();
    return next;
  }

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = next.id
    ? sdk.doc(db, AUTH.NOTIFICATIONS_COLLECTION, next.id)
    : sdk.doc(sdk.collection(db, AUTH.NOTIFICATIONS_COLLECTION));
  const payload = toDoc({ ...next, id: ref.id, email: String(next.email || "").toLowerCase() });
  await sdk.setDoc(ref, {
    ...payload,
    createdAt: payload.createdAt ? payload.createdAt : sdk.serverTimestamp(),
  }, { merge: true });
  return noticeFrom({ ...next, id: ref.id });
}

export function asRecipients(...people) {
  const seen = new Set();
  return people.flat().filter(Boolean).map((person) => {
    if (typeof person === "string") {
      return { userId: person, email: "" };
    }
    return {
      userId: person.userId || person.id || person.requestedBy || "",
      email: String(person.email || person.caregiverEmail || person.practitionerEmail || "").trim().toLowerCase(),
    };
  }).filter((person) => {
    const key = `${person.userId}|${person.email}`;
    if ((!person.userId && !person.email) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function notifyPeople(people, payload = {}, session = getSession()) {
  const actorId = payload.actorId || session?.id || "";
  const recipients = asRecipients(people).filter((person) => {
    if (actorId && person.userId && person.userId === actorId) return false;
    return true;
  });
  const saved = [];
  for (const recipient of recipients) {
    saved.push(await postNotification({
      ...payload,
      userId: recipient.userId,
      email: recipient.email,
    }, session));
  }
  return saved;
}

export async function notifyQuietly(people, payload = {}, session = getSession()) {
  try {
    return await notifyPeople(people, payload, session);
  } catch (error) {
    logger.warn("Notification could not be stored.", error);
    return [];
  }
}

async function saveNoticePatch(id, patch) {
  if (!usesLiveAuth()) {
    const all = localNotices();
    const next = all.map((item) => (item.id === id ? noticeFrom({ ...item, ...patch }) : item));
    writeLocal(next);
    emitLocalChange();
    return next.find((item) => item.id === id) ?? null;
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = sdk.doc(db, AUTH.NOTIFICATIONS_COLLECTION, id);
  await sdk.updateDoc(ref, patch);
  const snap = await sdk.getDoc(ref);
  return snap.exists() ? noticeFrom({ id: snap.id, ...snap.data() }) : null;
}

export async function markNotificationRead(id, read = true, session = getSession()) {
  const patch = {
    read: Boolean(read),
    readAt: read ? nowIso() : null,
  };
  const saved = await saveNoticePatch(id, usesLiveAuth()
    ? {
      read: patch.read,
      readAt: read ? getFirestoreSdk().serverTimestamp() : null,
    }
    : patch);
  void session;
  return saved;
}

export async function markAllNotificationsRead(session = getSession()) {
  const unread = (await listNotifications(session)).filter((item) => !item.read);
  await Promise.all(unread.map((item) => markNotificationRead(item.id, true, session)));
  return unread.length;
}

export function getLocalNotificationPrefs(session = getSession()) {
  const stored = storage.get(PREFS_KEY, null);
  return normalizeNotificationPrefs(stored || session?.notificationPrefs);
}

export async function getNotificationPreferences(session = getSession()) {
  if (!usesLiveAuth() || !session?.id) {
    return getLocalNotificationPrefs(session);
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.USERS_COLLECTION, session.id));
  const prefs = snap.exists() ? snap.data()?.notificationPrefs : session.notificationPrefs;
  return normalizeNotificationPrefs(prefs);
}

export async function saveNotificationPreferences(prefs, session = getSession()) {
  const next = normalizeNotificationPrefs(prefs);
  storage.set(PREFS_KEY, next);
  if (session?.id) {
    setSession({ ...session, notificationPrefs: next });
  }
  if (usesLiveAuth() && session?.id) {
    await updateUserProfile(session.id, { notificationPrefs: next });
  }
  return next;
}

export async function saveDeviceToken(token, session = getSession()) {
  const value = String(token || "").trim();
  if (!value || !session?.id) return null;
  const record = {
    token: value,
    platform: AUTH.PLATFORM,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    updatedAt: nowIso(),
  };
  if (!usesLiveAuth()) {
    const map = storage.get(TOKENS_KEY, {}) ?? {};
    map[session.id] = record;
    storage.set(TOKENS_KEY, map);
    return record;
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const id = value.slice(-40).replace(/[^a-zA-Z0-9_-]/g, "_") || "web";
  await sdk.setDoc(sdk.doc(db, AUTH.USERS_COLLECTION, session.id, AUTH.FCM_TOKENS_SUBCOLLECTION, id), {
    ...record,
    updatedAt: sdk.serverTimestamp(),
  }, { merge: true });
  return record;
}

export async function removeDeviceToken(token, session = getSession()) {
  const value = String(token || "").trim();
  if (!value || !session?.id) return;
  if (!usesLiveAuth()) {
    const map = storage.get(TOKENS_KEY, {}) ?? {};
    if (map[session.id]?.token === value) {
      delete map[session.id];
      storage.set(TOKENS_KEY, map);
    }
    return;
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const id = value.slice(-40).replace(/[^a-zA-Z0-9_-]/g, "_") || "web";
  await sdk.deleteDoc(sdk.doc(db, AUTH.USERS_COLLECTION, session.id, AUTH.FCM_TOKENS_SUBCOLLECTION, id));
}

export function subscribeNotificationFeed(handler, session = getSession()) {
  if (typeof handler !== "function") return () => {};
  const key = `notices:${session?.id || ""}:${session?.email || ""}`;
  return subscribeShared(key, (emit) => {
    if (!usesLiveAuth() || !session?.id) {
      const refresh = () => listNotifications(session).then(emit).catch(() => emit([]));
      refresh();
      if (typeof window === "undefined") return () => {};
      window.addEventListener("famielda:notices", refresh);
      window.addEventListener("famielda:notification", refresh);
      return () => {
        window.removeEventListener("famielda:notices", refresh);
        window.removeEventListener("famielda:notification", refresh);
      };
    }

    const db = getFirebaseDb();
    const sdk = getFirestoreSdk();
    const buckets = { user: [], email: [] };
    const publish = () => emit(sortNotices(dedupeNotices([...buckets.user, ...buckets.email])));
    const stops = [];

    const listen = (bucket, constraints) => listenCollection(
      sdk,
      db,
      AUTH.NOTIFICATIONS_COLLECTION,
      constraints,
      (snap) => {
        buckets[bucket] = snap.docs.map((doc) => noticeFrom({ id: doc.id, ...doc.data() }));
        publish();
      },
      { limit: QUERY_LIMITS.FEED },
    );

    if (session.id) {
      stops.push(listen("user", [
        sdk.where("userId", "==", session.id),
        sdk.orderBy("createdAt", "desc"),
      ]));
    }
    if (session.email) {
      stops.push(listen("email", [
        sdk.where("email", "==", String(session.email).trim().toLowerCase()),
        sdk.orderBy("createdAt", "desc"),
      ]));
    }

    return () => stops.forEach((stop) => stop());
  }, handler);
}

export { defaultNotificationPrefs };
