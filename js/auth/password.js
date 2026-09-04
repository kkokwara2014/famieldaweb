import { AUTH } from "../config/constants.js";
import { routes } from "../config/routes.js";
import { initFirebase, getFirebaseAuth, getAuthSdk, usesLiveAuth } from "../core/firebase.js";
import { wrapAuthError } from "./auth-errors.js";
import { emailActionSettings } from "./action-settings.js";
import { trackAuthEvent } from "../services/monitoring-service.js";

export async function requestPasswordReset(email) {
  const trimmed = email?.trim();
  if (!trimmed) {
    throw new Error("Enter the email for this account.");
  }

  await initFirebase();

  if (!usesLiveAuth()) {
    trackAuthEvent({ ok: true, name: "password_reset", code: "ok" });
    return { sent: true };
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    await sdk.sendPasswordResetEmail(auth, trimmed, emailActionSettings(routes.login));
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      trackAuthEvent({ ok: true, name: "password_reset", code: "ok" });
      return { sent: true };
    }
    trackAuthEvent({ ok: false, name: "password_reset_failed", code: error.code || "auth/unknown" });
    throw wrapAuthError(error);
  }

  trackAuthEvent({ ok: true, name: "password_reset", code: "ok" });
  return { sent: true };
}

export async function inspectResetCode(oobCode) {
  if (!oobCode) {
    throw new Error("This reset link is missing its code.");
  }

  await initFirebase();

  if (!usesLiveAuth()) {
    return { email: "family@famielda.test" };
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    const email = await sdk.verifyPasswordResetCode(auth, oobCode);
    return { email };
  } catch (error) {
    throw wrapAuthError(error);
  }
}

export async function completePasswordReset(oobCode, password) {
  if (!oobCode) {
    throw new Error("This reset link is missing its code.");
  }
  if (!password || password.length < AUTH.MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${AUTH.MIN_PASSWORD_LENGTH} characters.`);
  }

  await initFirebase();

  if (!usesLiveAuth()) {
    return { reset: true };
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();

  try {
    await sdk.confirmPasswordReset(auth, oobCode, password);
    trackAuthEvent({ ok: true, name: "password_changed", code: "ok" });
    return { reset: true };
  } catch (error) {
    trackAuthEvent({ ok: false, name: "password_changed_failed", code: error.code || "auth/unknown" });
    throw wrapAuthError(error);
  }
}
