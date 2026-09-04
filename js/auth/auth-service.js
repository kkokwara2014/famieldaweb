import { appConfig } from "../config/app-config.js";
import { AUTH, PROFESSIONAL_TYPES, ROLES, SUBSCRIPTION_PLANS } from "../config/constants.js";
import { parsePhone } from "../config/phone.js";
import { routes } from "../config/routes.js";
import { createUser, joinDisplayName } from "../models/user.js";
import { storage } from "../core/storage.js";
import { initFirebase, getFirebaseAuth, getAuthSdk, usesLiveAuth } from "../core/firebase.js";
import { wrapAuthError } from "./auth-errors.js";
import { PRODUCT_EVENTS, trackProductEvent } from "../services/analytics-service.js";
import { trackAuthEvent } from "../services/monitoring-service.js";
import { setSessionPersistence } from "./persistence.js";
import { loadOrCreateUserProfile, profileFromAuthUser } from "./user-profile.js";
import { attachExistingHousehold } from "./household-link.js";
import { logger } from "../core/logger.js";
import { emailActionSettings } from "./action-settings.js";
import { clearSession } from "./session.js";

const USERS_KEY = "users";

const seedUsers = [
  createUser({
    id: "user-family",
    email: "family@famielda.test",
    displayName: "Sarah Walsh",
    role: ROLES.FAMILY,
    plan: SUBSCRIPTION_PLANS.FAMILY,
    referralCode: "AMINA-7K2P",
    seniorId: "senior-eleanor",
    emailVerified: true,
    createdPlatform: "web",
    onboardingCompletedAt: "2026-01-15T12:00:00.000Z",
    onboardingPath: "create_senior",
    familyRelationship: "Daughter",
  }),
  createUser({
    id: "user-admin",
    email: "admin@famielda.test",
    displayName: "Jordan Hale",
    role: ROLES.ADMIN,
    plan: SUBSCRIPTION_PLANS.CIRCLE,
    seniorId: "senior-eleanor",
    emailVerified: true,
    createdPlatform: "web",
    onboardingCompletedAt: "2026-01-15T12:00:00.000Z",
  }),
  createUser({
    id: "user-caregiver",
    email: "caregiver@famielda.test",
    displayName: "Maya Chen",
    role: ROLES.CAREGIVER,
    professionalType: PROFESSIONAL_TYPES.CNA,
    plan: SUBSCRIPTION_PLANS.FREE,
    seniorId: "senior-eleanor",
    emailVerified: true,
    verificationStatus: "verified",
    verifiedAt: "2026-08-12T14:20:00.000Z",
    createdPlatform: "web",
    onboardingCompletedAt: "2026-01-15T12:00:00.000Z",
    careTypes: ["personal_care", "medication"],
  }),
  createUser({
    id: "user-practitioner",
    email: "practitioner@famielda.test",
    displayName: "Dr. Priya Patel",
    role: ROLES.HEALTH_PRACTITIONER,
    professionalType: PROFESSIONAL_TYPES.MD,
    plan: SUBSCRIPTION_PLANS.FAMILY,
    seniorId: "senior-eleanor",
    emailVerified: true,
    verificationStatus: "verified",
    verifiedAt: "2026-07-22T10:05:00.000Z",
    createdPlatform: "web",
    onboardingCompletedAt: "2026-01-15T12:00:00.000Z",
    specialty: "Geriatric medicine",
  }),
  createUser({
    id: "user-kemi",
    email: "kemi@famielda.test",
    displayName: "Kate Walsh",
    role: ROLES.FAMILY,
    plan: SUBSCRIPTION_PLANS.FREE,
    seniorId: null,
    emailVerified: true,
    createdPlatform: "web",
  }),
];

function loadUsers() {
  const existing = storage.get(USERS_KEY);
  if (!existing?.length) {
    storage.set(USERS_KEY, seedUsers);
    return seedUsers;
  }

  const emails = new Set(existing.map((item) => item.email.toLowerCase()));
  const missing = seedUsers.filter((item) => !emails.has(item.email.toLowerCase()));
  const byEmail = new Map(seedUsers.map((item) => [item.email.toLowerCase(), item]));
  let patched = false;
  const mergedExisting = existing.map((user) => {
    const seed = byEmail.get(String(user.email || "").toLowerCase());
    if (seed?.verificationStatus && !user.verificationStatus) {
      patched = true;
      return createUser({ ...user, verificationStatus: seed.verificationStatus, verifiedAt: seed.verifiedAt });
    }
    return user;
  });
  if (!missing.length && !patched) return existing;
  const merged = [...mergedExisting, ...missing];
  storage.set(USERS_KEY, merged);
  return merged;
}

export function getMockUser(id) {
  if (!id) return null;
  return loadUsers().find((item) => item.id === id) ?? null;
}

export function listMockUsers() {
  return loadUsers().map((item) => createUser(item));
}

export function updateMockUser(user) {
  const users = loadUsers();
  const index = users.findIndex((item) => item.id === user.id || item.email === user.email);
  if (index >= 0) users[index] = createUser({ ...users[index], ...user });
  else users.push(createUser(user));
  storage.set(USERS_KEY, users);
  return users[index >= 0 ? index : users.length - 1];
}

function requireCredentials({ email, password }) {
  if (!email?.trim()) {
    throw new Error("Enter a valid email address.");
  }
  if (!password) {
    throw new Error("Enter your password.");
  }
}

function requirePasswordStrength(password) {
  if (!password || password.length < AUTH.MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${AUTH.MIN_PASSWORD_LENGTH} characters.`);
  }
}

export async function loginWithEmail({ email, password, remember = true }) {
  requireCredentials({ email, password });
  await initFirebase();

  if (!usesLiveAuth()) {
    const user = loadUsers().find((item) => item.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) {
      trackAuthEvent({ ok: false, name: "login_failed", code: "auth/invalid-credential" });
      throw new Error("Check your email and password.");
    }
    if (user.status === "suspended") {
      trackAuthEvent({ ok: false, name: "login_failed", code: "auth/user-disabled" });
      throw new Error("This account has been suspended. Contact Famielda support.");
    }
    trackAuthEvent({ ok: true, name: "login", code: "ok" });
    return createUser({ ...user, emailVerified: user.emailVerified ?? true });
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    await setSessionPersistence(remember);
    const credential = await sdk.signInWithEmailAndPassword(auth, email.trim(), password);
    trackAuthEvent({ ok: true, name: "login", code: "ok" });
    try {
      const profile = await loadOrCreateUserProfile(credential.user);
      return attachExistingHousehold(profile);
    } catch (profileError) {
      logger.warn("Signed in, but the shared Firestore profile could not be loaded.", profileError);
      return profileFromAuthUser(credential.user, { allowUnverified: true });
    }
  } catch (error) {
    trackAuthEvent({ ok: false, name: "login_failed", code: error.code || "auth/unknown" });
    throw wrapAuthError(error);
  }
}

export async function registerAccount({
  displayName,
  firstName,
  lastName,
  email,
  password,
  phone,
  phoneCountry,
  remember = true,
} = {}) {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  const name = String(displayName || "").trim() || joinDisplayName(first, last);
  const trimmedEmail = email?.trim();
  const parsedPhone = (phone || phoneCountry)
    ? parsePhone({ iso: phoneCountry, national: phone })
    : null;

  if (!name) {
    throw new Error("Name, email, and password are required.");
  }
  if (parsedPhone && !parsedPhone.ok) {
    throw new Error(parsedPhone.error);
  }
  requireCredentials({ email: trimmedEmail, password });
  requirePasswordStrength(password);

  await initFirebase();

  const accountFields = {
    firstName: first || undefined,
    lastName: last || undefined,
    phone: parsedPhone?.e164 || undefined,
    phoneCountry: parsedPhone?.iso || undefined,
  };

  if (!usesLiveAuth()) {
    const users = loadUsers();
    if (users.some((item) => item.email.toLowerCase() === trimmedEmail.toLowerCase())) {
      throw new Error("An account with that email already exists. Sign in or reset your password.");
    }

    const user = createUser({
      id: `user-${Date.now()}`,
      email: trimmedEmail,
      displayName: name,
      ...accountFields,
      role: null,
      professionalType: null,
      plan: SUBSCRIPTION_PLANS.FREE,
      seniorId: null,
      emailVerified: true,
      createdAt: new Date().toISOString(),
      createdPlatform: appConfig.platform,
    });

    storage.set(USERS_KEY, [...users, user]);
    trackProductEvent(PRODUCT_EVENTS.REGISTRATION, {
      dedupeKey: `registration:${user.id}`,
      plan: user.plan,
    }, user);
    trackAuthEvent({ ok: true, name: "register", code: "ok" });
    return user;
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    await setSessionPersistence(remember);
    const credential = await sdk.createUserWithEmailAndPassword(auth, trimmedEmail, password);
    await sdk.updateProfile(credential.user, { displayName: name });
    const profile = await loadOrCreateUserProfile(credential.user, {
      displayName: name,
      ...accountFields,
    });

    try {
      await sdk.sendEmailVerification(credential.user, emailActionSettings(routes.verifyEmail));
    } catch (error) {
      console.warn("[famielda] Verification email was not sent.", error);
    }

    trackProductEvent(PRODUCT_EVENTS.REGISTRATION, {
      dedupeKey: `registration:${profile.id}`,
      plan: profile.plan,
    }, profile);
    trackAuthEvent({ ok: true, name: "register", code: "ok" });
    return profile;
  } catch (error) {
    trackAuthEvent({ ok: false, name: "register_failed", code: error.code || "auth/unknown" });
    throw wrapAuthError(error);
  }
}

export async function logoutAccount() {
  await initFirebase();

  if (usesLiveAuth()) {
    const auth = getFirebaseAuth();
    const sdk = getAuthSdk();
    if (auth && sdk) {
      try {
        await sdk.signOut(auth);
      } catch (error) {
        throw wrapAuthError(error);
      }
    }
  }

  clearSession();
}

export function removeMockUser(userId) {
  const users = loadUsers().filter((item) => item.id !== userId);
  storage.set(USERS_KEY, users);
}
