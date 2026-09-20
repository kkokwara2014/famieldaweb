import { getSession } from "../auth/session.js";
import { normalizeNotificationPrefs } from "../config/notifications.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { familiesCol, userDoc } from "../core/firestore-paths.js";

function readPhotoUrl(data = {}) {
  return data.photoUrl || data.photoURL || null;
}

function readNotificationPreferences(data = {}) {
  return normalizeNotificationPrefs(data.notificationPreferences ?? data.notificationPrefs);
}

function canonicalUser(uid, data = {}) {
  const photoUrl = readPhotoUrl(data);
  const notificationPreferences = readNotificationPreferences(data);
  return {
    ...data,
    id: data.id ?? uid,
    uid,
    photoUrl,
    photoURL: photoUrl,
    notificationPreferences,
    notificationPrefs: notificationPreferences,
  };
}

export async function getCurrentUser() {
  return getSession();
}

export async function getUserById(uid) {
  if (!uid || !usesLiveAuth()) return null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  if (!db || !sdk) return null;
  const snap = await sdk.getDoc(userDoc(uid));
  if (!snap.exists()) return null;
  return canonicalUser(uid, snap.data());
}

export async function resolveFamilyId(uid) {
  const userId = String(uid || "").trim();
  if (!userId || !usesLiveAuth()) return null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  if (!db || !sdk) return null;

  const owned = await sdk.getDocs(
    sdk.query(familiesCol(), sdk.where("createdBy", "==", userId), sdk.limit(1)),
  );
  if (!owned.empty) return owned.docs[0].id;

  const memberships = await sdk.getDocs(
    sdk.query(sdk.collectionGroup(db, "members"), sdk.where("userId", "==", userId), sdk.limit(1)),
  );
  if (memberships.empty) return null;
  return memberships.docs[0].ref.parent.parent?.id ?? null;
}
