const MESSAGES = {
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-email": "Enter the email for this account.",
  "auth/missing-password": "Enter your password.",
  "auth/user-disabled": "This account has been suspended. Open the Help Center to contact Famielda support.",
  "auth/user-not-found": "Check your email and password.",
  "auth/wrong-password": "Check your email and password.",
  "auth/invalid-credential": "Check your email and password. Use the same Famielda account as the mobile app.",
  "auth/invalid-login-credentials": "Check your email and password. Use the same Famielda account as the mobile app.",
  "auth/email-already-in-use": "An account with that email already exists. Sign in or reset your password.",
  "auth/weak-password": "Use at least 8 characters for your password.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/requires-recent-login": "For security, enter your password again to continue.",
  "auth/expired-action-code": "This link has expired. Request a new one.",
  "auth/invalid-action-code": "This link is invalid or has already been used.",
  "auth/missing-continue-uri": "This email link is missing a return address.",
  "auth/invalid-continue-uri": "This email link cannot be completed from this page.",
  "auth/unauthorized-continue-uri": "This domain is not authorized for Famielda account emails.",
  "auth/unauthorized-domain": "This site is not authorized for Famielda sign-in yet. Add this domain in Firebase Authentication → Settings → Authorized domains.",
  "auth/invalid-api-key": "This web app is not using a valid Firebase API key for the famielda project.",
  "auth/api-key-not-valid": "This web app is not using a valid Firebase API key for the famielda project.",
  "auth/configuration-not-found": "Email sign-in is not fully configured for this Firebase project yet.",
  "permission-denied": "Famielda could not open the shared profile for this account. Try again with the same email and password used in the mobile app.",
  "auth/operation-not-allowed": "Email sign-in is not enabled for this Firebase project yet.",
  "auth/internal-error": "Something went wrong. Try again.",
  "auth/account-exists-with-different-credential": "That email is already used with a different sign-in method.",
};

export function authErrorMessage(error) {
  if (!error) return "Something went wrong. Try again.";
  if (MESSAGES[error.code]) return MESSAGES[error.code];
  const message = String(error.message ?? "").trim();
  if (message && !message.startsWith("Firebase:") && !message.includes("auth/")) {
    return message;
  }
  return "We could not complete that. Try again.";
}

export function wrapAuthError(error) {
  const wrapped = new Error(authErrorMessage(error));
  wrapped.code = error?.code ?? "auth/unknown";
  wrapped.cause = error;
  return wrapped;
}
