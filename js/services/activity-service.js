import {
  ACTIVITY_TYPES,
  CARE_HISTORY_KINDS,
} from "../config/constants.js";
import {
  activityTypeFromKind,
  defaultHistoryTitle,
} from "../config/care-history.js";
import { activitySourceKey, createActivity } from "../models/activity.js";
import { mockActivities } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { activitiesCol } from "../core/firestore-paths.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSession } from "../auth/session.js";

const ACTIVITIES_KEY = "senior-hub-activities";

function newId() {
  return `act-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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

function activityFrom(data) {
  return createActivity({
    ...data,
    occurredAt: toIso(data.occurredAt) || toIso(data.createdAt) || nowIso(),
    createdAt: toIso(data.createdAt) || toIso(data.occurredAt) || nowIso(),
  });
}

function toDoc(record) {
  const { id: _id, ...rest } = record;
  return rest;
}

function seedMap(records) {
  const existing = storage.get(ACTIVITIES_KEY, null);
  let map = {};
  if (Array.isArray(existing)) {
    map = Object.fromEntries(existing.filter((item) => item?.id).map((item) => [item.id, item]));
  } else if (existing && typeof existing === "object") {
    map = { ...existing };
  }
  let changed = Array.isArray(existing) || existing == null;
  for (const record of records) {
    if (!map[record.id]) {
      map[record.id] = record;
      changed = true;
    }
  }
  if (changed) storage.set(ACTIVITIES_KEY, map);
  return map;
}

function seedLocal() {
  return seedMap(mockActivities);
}

function readLocalMap() {
  seedLocal();
  return storage.get(ACTIVITIES_KEY, {}) ?? {};
}

function writeLocalRecord(record) {
  const map = readLocalMap();
  map[record.id] = record;
  storage.set(ACTIVITIES_KEY, map);
  return record;
}

function localActivities(filter = {}) {
  return Object.values(readLocalMap())
    .map((item) => activityFrom(item))
    .filter((item) => !filter.seniorId || !item.seniorId || item.seniorId === filter.seniorId);
}

async function collectionDocs(collectionRef, constraints = [], options = {}) {
  const sdk = getFirestoreSdk();
  const limit = options.limit ?? QUERY_LIMITS.PAGE;
  const parts = [...constraints];
  if (options.startAfter) parts.push(sdk.startAfter(options.startAfter));
  parts.push(sdk.limit(limit));
  const snap = await sdk.getDocs(sdk.query(collectionRef, ...parts));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function readActivities(filter = {}) {
  if (!usesLiveAuth()) return localActivities(filter);
  if (!filter.seniorId) return [];
  const sdk = getFirestoreSdk();
  const limit = filter.limit ?? QUERY_LIMITS.PAGE;
  try {
    const docs = await collectionDocs(activitiesCol(filter.seniorId), [sdk.orderBy("occurredAt", "desc")], { limit, startAfter: filter.startAfter });
    return docs.map((item) => activityFrom(item));
  } catch {
    const docs = await collectionDocs(activitiesCol(filter.seniorId), [], { limit, startAfter: filter.startAfter });
    return docs.map((item) => activityFrom(item));
  }
}

async function saveActivityRecord(activity) {
  const record = activityFrom({ ...activity, createdAt: activity.createdAt || nowIso() });
  if (!usesLiveAuth()) {
    const saved = activityFrom({
      ...record,
      id: record.id || newId(),
    });
    return activityFrom(writeLocalRecord(saved));
  }

  if (!record.seniorId) throw new Error("A senior record is needed before activity can be saved.");
  const sdk = getFirestoreSdk();
  const collection = activitiesCol(record.seniorId);
  const ref = record.id
    ? sdk.doc(collection, record.id)
    : sdk.doc(collection);
  const payload = toDoc({ ...record, id: ref.id });
  const data = { ...payload };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  if (!payload.occurredAt) data.occurredAt = data.createdAt;
  await sdk.setDoc(ref, data, { merge: true });
  return activityFrom({ ...record, id: ref.id });
}

function byNewest(a, b) {
  return String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt));
}

export async function listActivities(filter = {}) {
  const seniorId = typeof filter === "string" ? filter : filter?.seniorId;
  const limit = typeof filter === "string" ? QUERY_LIMITS.PAGE : filter?.limit;
  return (await readActivities({ seniorId, limit, startAfter: filter?.startAfter }))
    .map((item) => activityFrom(item))
    .sort(byNewest);
}

export async function postActivity(input = {}, session = getSession()) {
  const kind = input.kind || CARE_HISTORY_KINDS.CARE;
  const type = input.type || activityTypeFromKind(kind);
  const body = String(input.body ?? "").trim();
  const title = String(input.title || defaultHistoryTitle(kind)).trim() || defaultHistoryTitle(kind);
  const needsBody = kind === CARE_HISTORY_KINDS.NOTE || kind === CARE_HISTORY_KINDS.CLINICAL;
  if (needsBody && !body) {
    throw new Error("Write a note before saving.");
  }
  if (!title && !body) {
    throw new Error("Add a title or a note before saving.");
  }

  const occurredAt = input.occurredAt || nowIso();
  const source = input.source || "activity";
  const sourceId = input.sourceId || "";
  const next = createActivity({
    id: usesLiveAuth() ? "" : (input.id || newId()),
    seniorId: input.seniorId || session?.seniorId || "",
    kind,
    type,
    title,
    body,
    actor: input.actor || session?.displayName || "You",
    actorId: input.actorId || session?.id || "",
    occurredAt,
    createdAt: occurredAt,
    source,
    sourceId,
    relatedId: input.relatedId || "",
    href: input.href || "",
  });
  if (sourceId && !next.sourceId) next.sourceId = sourceId;
  if (source && sourceId) {
    next.sourceId = sourceId;
  }

  return saveActivityRecord({
    ...next,
    sourceId: sourceId || activitySourceKey(source, next.id),
  });
}

export { activitySourceKey };
