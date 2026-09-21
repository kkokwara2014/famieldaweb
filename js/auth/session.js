import { ACCOUNT_STATUS } from "../config/constants.js";
import { storage } from "../core/storage.js";
import { createUser } from "../models/user.js";
import { initFirebase, getFirebaseAuth, getAuthSdk, usesLiveAuth } from "../core/firebase.js";
import { callCloudFunction } from "../core/functions.js";
import { loadOrCreateUserProfile, profileFromAuthUser } from "./user-profile.js";
import { attachExistingHousehold } from "./household-link.js";
import { logger } from "../core/logger.js";

const SESSION_KEY = "current";

let current = null;
let startPromise = null;
let authEpoch = 0;
let syncedClaimsUid = null;
const listeners = new Set();

function readStored() {
  const raw = storage.get(SESSION_KEY);
  return raw ? createUser(raw) : null;
}

function emit(session) {
  listeners.forEach((handler) => {
    try {
      handler(session);
    } catch (error) {
      logger.error("Session listener failed.", error);
    }
  });
}

export function getSession() {
  return current ?? readStored();
}

export function setSession(user) {
  current = user ? createUser(user) : null;
  if (current) storage.set(SESSION_KEY, current);
  else storage.remove(SESSION_KEY);
  return current;
}

export function clearSession() {
  current = null;
  storage.remove(SESSION_KEY);
}

export function isSignedIn() {
  return Boolean(getSession()?.id);
}

export function onSessionChange(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/**
 * Mirrors the mobile app: Cloud Storage rules authorize from auth custom
 * claims (`role`, `seniorIds`, `familyIds`) written by the mobile
 * `refreshMyClaims` callable. Without this the web token never carries them,
 * so Storage reads/writes (e.g. the admin opening a verification document)
 * are denied even though Firestore rules authorize from the user document.
 */
async function syncAccessClaims(firebaseUser) {
  if (!firebaseUser || syncedClaimsUid === firebaseUser.uid) return;
  syncedClaimsUid = firebaseUser.uid;
  try {
    await callCloudFunction("refreshMyClaims", {}, { quiet: true });
    await firebaseUser.getIdToken(true);
  } catch (error) {
    syncedClaimsUid = null;
    logger.warn("Could not sync access claims.", error);
  }
}

async function hydrateFirebaseUser(firebaseUser) {
  const epoch = ++authEpoch;
  if (!firebaseUser) {
    syncedClaimsUid = null;
    clearSession();
    emit(null);
    return null;
  }

  try {
    const profile = await attachExistingHousehold(await loadOrCreateUserProfile(firebaseUser));
    if (epoch !== authEpoch) return getSession();
    if (profile.status === ACCOUNT_STATUS.SUSPENDED) {
      const auth = getFirebaseAuth();
      const sdk = getAuthSdk();
      if (auth && sdk?.signOut) await sdk.signOut(auth);
      clearSession();
      emit(null);
      return null;
    }
    setSession(profile);
    await syncAccessClaims(firebaseUser);
    emit(profile);
    return profile;
  } catch (error) {
    logger.error("Failed to hydrate session.", error);
    if (epoch !== authEpoch) return getSession();
    const fallback = profileFromAuthUser(firebaseUser, { allowUnverified: true });
    setSession(fallback);
    emit(fallback);
    return fallback;
  }
}

async function startSession() {
  await initFirebase();

  if (!usesLiveAuth()) {
    current = readStored();
    return current;
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  return new Promise((resolve) => {
    let settled = false;

    sdk.onAuthStateChanged(auth, async (firebaseUser) => {
      const session = await hydrateFirebaseUser(firebaseUser);
      if (settled) return;
      settled = true;
      resolve(session);
    });
  });
}

export async function initSession() {
  if (startPromise) return startPromise;
  startPromise = startSession().catch((error) => {
    startPromise = null;
    throw error;
  });
  return startPromise;
}

export async function refreshSession() {
  if (!usesLiveAuth()) return getSession();

  await initFirebase();
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) {
    clearSession();
    emit(null);
    return null;
  }

  await user.reload();
  return hydrateFirebaseUser(auth.currentUser);
}
