/**
 * Resolve the household a Firebase Auth user already belongs to in Firestore.
 * Mobile and web share seniors/{id} and seniors/{id}/circleMembers; the web
 * session only stores one seniorId, so we pick the owned household first.
 */
import { CIRCLE_STATUS } from "../config/constants.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { seniorsCol } from "../core/firestore-paths.js";
import { logger } from "../core/logger.js";
import { updateUserProfile } from "./user-profile.js";

async function firstId(run) {
  try {
    const ids = await run();
    return ids.find(Boolean) || null;
  } catch {
    // Best-effort lookup. The seniors/circleMembers queries cannot be proven
    // against the security rules (rules are not filters), so a denial here is
    // expected for users without a household — not an error worth logging.
    return null;
  }
}

async function queryIds(base, constraints, pick) {
  const sdk = getFirestoreSdk();
  if (!sdk) return [];
  const snap = await sdk.getDocs(
    sdk.query(base, ...constraints, sdk.limit(QUERY_LIMITS.LOOKUP)),
  );
  return snap.docs.map((doc) => pick(doc.id, doc.data())).filter(Boolean);
}

function pickSeniorId(_id, data) {
  return data.status === CIRCLE_STATUS.REMOVED ? "" : data.seniorId;
}

export async function findSeniorIdForUser(profile) {
  if (!usesLiveAuth() || !profile?.id) return profile?.seniorId || null;
  if (profile.seniorId) return profile.seniorId;

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  if (!db || !sdk) return null;

  const owned = await firstId(() => queryIds(
    seniorsCol(),
    [sdk.where("ownerId", "==", profile.id)],
    (id) => id,
  ));
  if (owned) return owned;

  const memberOf = await firstId(() => queryIds(
    seniorsCol(),
    [sdk.where("memberIds", "array-contains", profile.id)],
    (id) => id,
  ));
  if (memberOf) return memberOf;

  const circleMembers = sdk.collectionGroup(db, "circleMembers");

  const byUser = await firstId(() => queryIds(
    circleMembers,
    [sdk.where("userId", "==", profile.id)],
    pickSeniorId,
  ));
  if (byUser) return byUser;

  const byUid = await firstId(() => queryIds(
    circleMembers,
    [sdk.where("uid", "==", profile.id)],
    pickSeniorId,
  ));
  if (byUid) return byUid;

  const email = String(profile.email || "").trim().toLowerCase();
  if (!email) return null;
  return firstId(() => queryIds(
    circleMembers,
    [sdk.where("email", "==", email)],
    pickSeniorId,
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
