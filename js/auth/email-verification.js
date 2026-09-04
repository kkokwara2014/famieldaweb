import { routes } from "../config/routes.js";
import { initFirebase, getFirebaseAuth, getAuthSdk, usesLiveAuth } from "../core/firebase.js";
import { wrapAuthError } from "./auth-errors.js";
import { emailActionSettings } from "./action-settings.js";
import { markEmailVerified } from "./user-profile.js";
import { refreshSession } from "./session.js";

export async function sendVerificationEmail() {
  await initFirebase();

  if (!usesLiveAuth()) {
    return { sent: true, alreadyVerified: true };
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();
  const user = auth?.currentUser;

  if (!user) {
    throw new Error("Sign in to verify your email.");
  }
  if (user.emailVerified) {
    await refreshSession();
    return { alreadyVerified: true };
  }

  try {
    await sdk.sendEmailVerification(user, emailActionSettings(routes.verifyEmail));
    return { sent: true };
  } catch (error) {
    throw wrapAuthError(error);
  }
}

export async function applyEmailVerification(oobCode) {
  if (!oobCode) {
    throw new Error("This verification link is missing its code.");
  }

  await initFirebase();

  if (!usesLiveAuth()) {
    return { verified: true };
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    await sdk.applyActionCode(auth, oobCode);
    if (auth.currentUser) {
      await auth.currentUser.reload();
      await markEmailVerified(auth.currentUser.uid, true);
      await refreshSession();
    }
    return { verified: true };
  } catch (error) {
    throw wrapAuthError(error);
  }
}

export async function inspectEmailAction(oobCode) {
  await initFirebase();
  if (!usesLiveAuth() || !oobCode) return null;

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    return await sdk.checkActionCode(auth, oobCode);
  } catch (error) {
    throw wrapAuthError(error);
  }
}

export async function applyAccountAction(oobCode) {
  await initFirebase();
  if (!usesLiveAuth()) return { applied: true };

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    await sdk.applyActionCode(auth, oobCode);
    if (auth.currentUser) {
      await refreshSession();
    }
    return { applied: true };
  } catch (error) {
    throw wrapAuthError(error);
  }
}
