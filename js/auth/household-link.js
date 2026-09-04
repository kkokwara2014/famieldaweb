/**
 * Resolve the household a Firebase Auth user already belongs to in Firestore.
 * Mobile and web share seniors/{id} and careCircleMembers; the web session
 * only stores one seniorId, so we pick the owned household first.
 */
import { AUTH, CIRCLE_STATUS } from "../config/constants.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { logger } from "../core/logger.js";
import { updateUserProfile } from "./user-profile.js";

async function firstId(run) {
  try {
    const ids = await run();
    return ids.find(Boolean) || null;
  } catch (error) {
    logger.warn("Could not look up a shared household.", error);
    return null;
  }
}

async function queryIds(collection, constraints, pick) {
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  if (!db || !sdk) return [];
  const snap = await sdk.getDocs(
    sdk.query(sdk.collection(db, collection), ...constraints, sdk.limit(QUERY_LIMITS.LOOKUP)),
  );
  return snap.docs.map((doc) => pick(doc.id, doc.data())).filter(Boolean);
}

export async function findSeniorIdForUser(profile) {
  if (!usesLiveAuth() || !profile?.id) return profile?.seniorId || null;
  if (profile.seniorId) return profile.seniorId;

  const sdk = getFirestoreSdk();
  if (!sdk) return null;

  const owned = await firstId(() => queryIds(
    AUTH.SENIORS_COLLECTION,
    [sdk.where("ownerId", "==", profile.id)],
    (id) => id,
  ));
  if (owned) return owned;

  const memberOf = await firstId(() => queryIds(
    AUTH.SENIORS_COLLECTION,
    [sdk.where("memberIds", "array-contains", profile.id)],
    (id) => id,
  ));
  if (memberOf) return memberOf;

  const byUser = await firstId(() => queryIds(
    AUTH.CIRCLE_COLLECTION,
    [sdk.where("userId", "==", profile.id)],
    (_id, data) => (data.status === CIRCLE_STATUS.REMOVED ? "" : data.seniorId),
  ));
  if (byUser) return byUser;

  const byUid = await firstId(() => queryIds(
    AUTH.CIRCLE_COLLECTION,
    [sdk.where("uid", "==", profile.id)],
    (_id, data) => (data.status === CIRCLE_STATUS.REMOVED ? "" : data.seniorId),
  ));
  if (byUid) return byUid;

  const email = String(profile.email || "").trim().toLowerCase();
  if (!email) return null;
  return firstId(() => queryIds(
    AUTH.CIRCLE_COLLECTION,
    [sdk.where("email", "==", email)],
    (_id, data) => (data.status === CIRCLE_STATUS.REMOVED ? "" : data.seniorId),
  ));
}

export async function attachExistingHousehold(profile) {
  if (!profile?.id || profile.seniorId || !usesLiveAuth()) return profile;

  const seniorId = await findSeniorIdForUser(profile);
  if (!seniorId) return profile;

  try {
    await updateUserProfile(profile.id, { seniorId });
  } catch (error) {
    logger.warn("Could not store seniorId on the shared profile.", error);
  }

  return { ...profile, seniorId };
}
