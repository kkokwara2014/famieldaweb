import { AUTH, CARE_STATUS, NOTIFICATION_TYPES } from "../config/constants.js";
import { createEmergencyContact, createSenior } from "../models/senior.js";
import { mockSenior } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { logger } from "../core/logger.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSession, setSession } from "../auth/session.js";
import { updateUserProfile } from "../auth/user-profile.js";
import { findSeniorIdForUser } from "../auth/household-link.js";
import { updateMockUser } from "../auth/auth-service.js";
import { notifyQuietly } from "./notification-service.js";
import { assertCanCreateSenior } from "./entitlement-service.js";
import { PRODUCT_EVENTS, trackProductEvent } from "./analytics-service.js";

const SENIORS_KEY = "seniors";

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function seedLocalSeniors() {
  const map = storage.get(SENIORS_KEY, null) ?? {};
  const existing = map[mockSenior.id];

  if (!existing) {
    map[mockSenior.id] = mockSenior;
    storage.set(SENIORS_KEY, map);
    return map;
  }

  if (!existing.carePreferences || !existing.importantInfo || !existing.care?.status) {
    map[mockSenior.id] = createSenior({
      ...mockSenior,
      ...existing,
      carePreferences: { ...mockSenior.carePreferences, ...existing.carePreferences },
      importantInfo: { ...mockSenior.importantInfo, ...existing.importantInfo },
      care: { ...mockSenior.care, ...existing.care },
    });
    storage.set(SENIORS_KEY, map);
  }

  return map;
}

function writeLocal(senior) {
  const map = seedLocalSeniors();
  map[senior.id] = senior;
  storage.set(SENIORS_KEY, map);
  return senior;
}

function fromDoc(id, data = {}) {
  return createSenior({
    ...data,
    id,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  });
}

function toDoc(senior) {
  const { id: _id, ...rest } = senior;
  return {
    ...rest,
    photoURL: rest.photoURL ?? null,
  };
}

export async function linkSeniorToUser(session, seniorId) {
  const next = {
    ...session,
    seniorId,
    updatedAt: new Date().toISOString(),
  };

  if (usesLiveAuth()) {
    await updateUserProfile(session.id, { seniorId });
  } else {
    updateMockUser(next);
  }

  return setSession(next);
}

export async function getSeniorById(id) {
  if (!id) return null;

  if (!usesLiveAuth()) {
    const record = seedLocalSeniors()[id];
    return record ? createSenior(record) : null;
  }

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  try {
    const snap = await sdk.getDoc(sdk.doc(db, AUTH.SENIORS_COLLECTION, id));
    if (!snap.exists()) return null;
    return fromDoc(snap.id, snap.data());
  } catch (error) {
    logger.warn("Could not read the shared senior profile.", error);
    return null;
  }
}

export async function getSeniorForUser(session = getSession()) {
  if (session?.seniorId) {
    const current = await getSeniorById(session.seniorId);
    if (current) return current;
  }

  if (!usesLiveAuth() || !session?.id) return null;

  const seniorId = await findSeniorIdForUser({ ...session, seniorId: null });
  if (!seniorId || seniorId === session.seniorId) return null;

  try {
    await linkSeniorToUser(session, seniorId);
  } catch {
    setSession({ ...session, seniorId });
  }

  return getSeniorById(seniorId);
}

export async function listSeniorsOwnedBy(userId) {
  if (!userId) return [];

  if (!usesLiveAuth()) {
    return Object.values(seedLocalSeniors())
      .map((item) => createSenior(item))
      .filter((item) => item.ownerId === userId);
  }

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDocs(
    sdk.query(
      sdk.collection(db, AUTH.SENIORS_COLLECTION),
      sdk.where("ownerId", "==", userId),
      sdk.limit(QUERY_LIMITS.LOOKUP),
    ),
  );
  return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
}

export async function createSeniorProfile(input, session = getSession()) {
  if (!session?.id) {
    throw new Error("Sign in to create a senior profile.");
  }

  const owned = await listSeniorsOwnedBy(session.id);
  assertCanCreateSenior({ session, seniorsOwned: owned.length });

  const now = new Date().toISOString();
  const contacts = (input.emergencyContacts ?? []).map((contact) => createEmergencyContact({
    ...contact,
    id: contact.id || newId("ec"),
  }));

  const draft = createSenior({
    ...input,
    ownerId: session.id,
    memberIds: [...new Set([session.id, ...(input.memberIds ?? [])])],
    emergencyContacts: contacts,
    createdAt: now,
    updatedAt: now,
    createdPlatform: AUTH.PLATFORM,
  });

  let saved;

  if (!usesLiveAuth()) {
    saved = writeLocal(createSenior({ ...draft, id: newId("senior") }));
  } else {
    const db = getFirebaseDb();
    const sdk = getFirestoreSdk();
    const ref = sdk.doc(sdk.collection(db, AUTH.SENIORS_COLLECTION));
    await sdk.setDoc(ref, {
      ...toDoc(draft),
      createdAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    });
    saved = createSenior({ ...draft, id: ref.id });
  }

  await linkSeniorToUser(session, saved.id);
  const { ensureOwnerMembership } = await import("./care-circle-service.js");
  await ensureOwnerMembership(saved, session);
  trackProductEvent(PRODUCT_EVENTS.SENIOR_CREATED, {
    dedupeKey: `senior_created:${saved.id}`,
    seniorId: saved.id,
  }, session);
  return saved;
}

export async function updateSeniorProfile(id, patch) {
  const current = await getSeniorById(id);
  if (!current) {
    throw new Error("That senior profile could not be found.");
  }

  const contacts = patch.emergencyContacts
    ? patch.emergencyContacts.map((contact) => createEmergencyContact({
      ...contact,
      id: contact.id || newId("ec"),
    }))
    : current.emergencyContacts;

  const next = createSenior({
    ...current,
    ...patch,
    id,
    emergencyContacts: contacts,
    carePreferences: {
      ...current.carePreferences,
      ...(patch.carePreferences ?? {}),
    },
    importantInfo: {
      ...current.importantInfo,
      ...(patch.importantInfo ?? {}),
    },
    care: {
      ...current.care,
      ...(patch.care ?? {}),
    },
    updatedAt: new Date().toISOString(),
  });

  if (!usesLiveAuth()) {
    const saved = writeLocal(next);
    await notifyCareStatusChange(current, saved);
    return saved;
  }

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const payload = toDoc(next);
  delete payload.createdAt;
  await sdk.updateDoc(sdk.doc(db, AUTH.SENIORS_COLLECTION, id), {
    ...payload,
    updatedAt: sdk.serverTimestamp(),
  });
  await notifyCareStatusChange(current, next);
  return next;
}

async function notifyCareStatusChange(previous, next) {
  const before = previous?.care?.status;
  const after = next?.care?.status;
  if (!after || before === after) return;
  const family = Array.isArray(next.memberIds) ? next.memberIds : [];
  const type = after === CARE_STATUS.URGENT ? NOTIFICATION_TYPES.EMERGENCY_ALERT : NOTIFICATION_TYPES.CARE_UPDATE;
  await notifyQuietly(family.map((userId) => ({ userId })), {
    type,
    title: after === CARE_STATUS.URGENT ? `Emergency · ${next.preferredName || next.displayName}` : `Care update · ${next.preferredName || next.displayName}`,
    body: next.care?.summary || `${next.preferredName || next.displayName}’s care status is now ${after}.`,
    seniorId: next.id,
  });
}

export async function saveSeniorPhoto(id, photoURL) {
  return updateSeniorProfile(id, { photoURL });
}

export async function saveEmergencyContacts(id, contacts) {
  return updateSeniorProfile(id, { emergencyContacts: contacts });
}
