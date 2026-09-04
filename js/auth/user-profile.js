/**
 * Shared Famielda profile: Firestore `users/{uid}`.
 * Document ID is the Firebase Auth UID so the same account works on
 * Famielda Mobile and Famielda Web.
 *
 * Fields: uid, email, displayName, firstName, lastName, phone, phoneCountry,
 * role, professionalType, plan, seniorId,
 * emailVerified, photoURL, notificationPrefs, createdAt, updatedAt, createdPlatform,
 * lastLoginAt, lastLoginPlatform, roleSelectedAt, onboardingCompletedAt,
 * onboardingPath, familyRelationship, careTypes, specialty, status, adminGrant,
 * referralCode, referredBy, referredByCode, referralGrant,
 * subscriptionStatus, subscriptionPeriodEnd, subscriptionCancelAtPeriodEnd,
 * stripeCustomerId, stripeSubscriptionId
 *
 * plan and Stripe fields are owned by Cloud Functions after checkout. The
 * client must not write them.
 *
 * Existing Auth users (including mobile) are read from this document as-is.
 * Last-login writes must not block sign-in if security rules reject a field.
 */
import { ACCOUNT_STATUS, AUTH, SUBSCRIPTION_PLANS } from "../config/constants.js";
import { defaultNotificationPrefs } from "../config/notifications.js";
import { normalizeRoleAndType } from "../config/roles.js";
import { createUser } from "../models/user.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { logger } from "../core/logger.js";

function toIso(value) {
  if (!value) return null;
  if (value === true) return new Date().toISOString();
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function joinedName(data = {}) {
  const first = String(data.firstName || data.first_name || "").trim();
  const last = String(data.lastName || data.last_name || "").trim();
  return [first, last].filter(Boolean).join(" ");
}

function asCareTypes(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, on]) => on)
      .map(([key]) => key);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,|]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function onboardedAt(data = {}) {
  const explicit = toIso(
    data.onboardingCompletedAt
    || data.onboarding_completed_at
    || data.onboardedAt
    || data.onboarded_at,
  );
  if (explicit) return explicit;
  if (data.onboarded === true || data.isOnboarded === true || data.onboardingComplete === true) {
    return toIso(data.updatedAt) || toIso(data.createdAt) || new Date().toISOString();
  }
  return null;
}

function existingAuthUser(firebaseUser) {
  const created = Date.parse(firebaseUser?.metadata?.creationTime || "");
  return Number.isFinite(created) && Date.now() - created > 60_000;
}

function omitUndefined(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

export function profileFromAuthUser(firebaseUser, extra = {}) {
  const { role, professionalType } = normalizeRoleAndType(
    extra.role ?? extra.userType ?? extra.user_type ?? extra.accountType,
    extra.professionalType ?? extra.professional_type ?? extra.profession ?? extra.credential,
  );
  const allowUnverified = Boolean(extra.allowUnverified) || existingAuthUser(firebaseUser);

  return createUser({
    id: firebaseUser.uid,
    email: firebaseUser.email ?? extra.email ?? "",
    displayName: extra.displayName || extra.name || extra.fullName || extra.full_name || joinedName(extra) || firebaseUser.displayName || "",
    firstName: extra.firstName || extra.first_name || "",
    lastName: extra.lastName || extra.last_name || "",
    phone: extra.phone || extra.phoneNumber || extra.phone_number || "",
    phoneCountry: extra.phoneCountry || extra.phone_country || "",
    role: role ?? extra.role ?? null,
    professionalType: professionalType ?? extra.professionalType ?? null,
    plan: extra.plan ?? SUBSCRIPTION_PLANS.FREE,
    subscriptionStatus: extra.subscriptionStatus ?? null,
    subscriptionPeriodEnd: toIso(extra.subscriptionPeriodEnd),
    subscriptionCancelAtPeriodEnd: Boolean(extra.subscriptionCancelAtPeriodEnd),
    subscriptionInterval: extra.subscriptionInterval === "year"
      ? "year"
      : (extra.subscriptionInterval === "month" ? "month" : null),
    stripeCustomerId: extra.stripeCustomerId ?? null,
    stripeSubscriptionId: extra.stripeSubscriptionId ?? null,
    stripePriceId: extra.stripePriceId ?? extra.stripe_price_id ?? null,
    seniorId: extra.seniorId || extra.senior_id || extra.currentSeniorId || extra.current_senior_id || null,
    emailVerified: Boolean(firebaseUser.emailVerified) || allowUnverified,
    verificationStatus: extra.verificationStatus ?? null,
    verifiedAt: toIso(extra.verifiedAt),
    photoURL: firebaseUser.photoURL ?? extra.photoURL ?? extra.photoUrl ?? extra.photo_url ?? extra.avatarUrl ?? null,
    timeZone: extra.timeZone ?? extra.timezone ?? extra.time_zone ?? "",
    notificationPrefs: extra.notificationPrefs,
    status: extra.status ?? ACCOUNT_STATUS.ACTIVE,
    suspendedAt: toIso(extra.suspendedAt),
    suspendedBy: extra.suspendedBy ?? null,
    suspendedReason: extra.suspendedReason ?? "",
    adminGrant: extra.adminGrant ?? null,
    referralCode: extra.referralCode ?? "",
    referredBy: extra.referredBy ?? null,
    referredByCode: extra.referredByCode ?? "",
    referralGrant: extra.referralGrant ?? null,
    lastLoginAt: toIso(extra.lastLoginAt),
    lastLoginPlatform: extra.lastLoginPlatform ?? null,
    createdAt: extra.createdAt ?? null,
    updatedAt: extra.updatedAt ?? null,
    createdPlatform: extra.createdPlatform ?? extra.platform ?? AUTH.PLATFORM,
    roleSelectedAt: toIso(extra.roleSelectedAt || extra.role_selected_at),
    onboardingCompletedAt: onboardedAt(extra),
    onboardingPath: extra.onboardingPath ?? extra.onboarding_path ?? "",
    familyRelationship: extra.familyRelationship ?? extra.family_relationship ?? extra.relationship ?? "",
    careTypes: asCareTypes(extra.careTypes ?? extra.care_types),
    specialty: extra.specialty ?? "",
  });
}

function mappedProfile(firebaseUser, data, extras = {}) {
  return profileFromAuthUser(firebaseUser, {
    ...data,
    ...extras,
    displayName: extras.displayName || data.displayName || data.name || data.fullName || firebaseUser.displayName,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    lastLoginAt: toIso(data.lastLoginAt) || new Date().toISOString(),
    roleSelectedAt: toIso(data.roleSelectedAt || data.role_selected_at),
    suspendedAt: toIso(data.suspendedAt),
    allowUnverified: extras.allowUnverified,
  });
}

async function touchLastLogin(ref, sdk, firebaseUser, data) {
  try {
    await sdk.updateDoc(ref, omitUndefined({
      email: firebaseUser.email ?? data.email ?? "",
      emailVerified: Boolean(firebaseUser.emailVerified),
      lastLoginAt: sdk.serverTimestamp(),
      lastLoginPlatform: AUTH.PLATFORM,
      updatedAt: sdk.serverTimestamp(),
    }));
  } catch (error) {
    logger.warn("Could not update last login on the shared profile.", error);
  }
}

export async function loadOrCreateUserProfile(firebaseUser, extras = {}) {
  if (!usesLiveAuth()) {
    return profileFromAuthUser(firebaseUser, extras);
  }

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = sdk.doc(db, AUTH.USERS_COLLECTION, firebaseUser.uid);
  const snap = await sdk.getDoc(ref);
  const now = sdk.serverTimestamp();
  const existing = snap.exists();
  const allowUnverified = existing || existingAuthUser(firebaseUser);

  if (existing) {
    const data = snap.data() || {};
    await touchLastLogin(ref, sdk, firebaseUser, data);
    return mappedProfile(firebaseUser, data, { ...extras, allowUnverified: true });
  }

  const profile = omitUndefined({
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? extras.email ?? "",
    displayName: extras.displayName || joinedName(extras) || firebaseUser.displayName || "",
    firstName: extras.firstName || extras.first_name || undefined,
    lastName: extras.lastName || extras.last_name || undefined,
    phone: extras.phone || extras.phoneNumber || undefined,
    phoneCountry: extras.phoneCountry || extras.phone_country || undefined,
    role: extras.role ?? null,
    professionalType: extras.professionalType ?? null,
    plan: SUBSCRIPTION_PLANS.FREE,
    seniorId: extras.seniorId ?? null,
    emailVerified: Boolean(firebaseUser.emailVerified),
    photoURL: firebaseUser.photoURL ?? extras.photoURL ?? null,
    timeZone: extras.timeZone ?? null,
    status: ACCOUNT_STATUS.ACTIVE,
    notificationPrefs: extras.notificationPrefs ?? defaultNotificationPrefs(),
    createdAt: now,
    updatedAt: now,
    createdPlatform: AUTH.PLATFORM,
    lastLoginAt: now,
    lastLoginPlatform: AUTH.PLATFORM,
    roleSelectedAt: extras.roleSelectedAt ?? null,
    onboardingCompletedAt: extras.onboardingCompletedAt ?? null,
    onboardingPath: extras.onboardingPath ?? "",
    familyRelationship: extras.familyRelationship ?? "",
    careTypes: extras.careTypes ?? [],
    specialty: extras.specialty ?? "",
  });

  try {
    await sdk.setDoc(ref, profile);
  } catch (error) {
    logger.warn("Could not create a Firestore profile for this Auth user.", error);
    const again = await sdk.getDoc(ref);
    if (again.exists()) {
      return mappedProfile(firebaseUser, again.data() || {}, { ...extras, allowUnverified: true });
    }
    return profileFromAuthUser(firebaseUser, { ...extras, allowUnverified });
  }

  return profileFromAuthUser(firebaseUser, {
    ...profile,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    allowUnverified,
  });
}

export async function updateUserProfile(uid, patch) {
  if (!usesLiveAuth() || !uid) return;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  await sdk.updateDoc(sdk.doc(db, AUTH.USERS_COLLECTION, uid), omitUndefined({
    ...patch,
    updatedAt: sdk.serverTimestamp(),
  }));
}

export async function deleteUserProfile(uid) {
  if (!usesLiveAuth() || !uid) return;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  await sdk.deleteDoc(sdk.doc(db, AUTH.USERS_COLLECTION, uid));
}

export async function markEmailVerified(uid, verified = true) {
  if (!usesLiveAuth() || !uid) return;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  await sdk.updateDoc(sdk.doc(db, AUTH.USERS_COLLECTION, uid), {
    emailVerified: verified,
    updatedAt: sdk.serverTimestamp(),
  });
}
