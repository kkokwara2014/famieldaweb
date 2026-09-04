import { initSession, getSession } from "../auth/session.js";
import { usesLiveAuth } from "../core/firebase.js";
import { go, goToLogin, homeFor, postAuthPath, routes } from "../config/routes.js";

export async function requireAuth({ requireVerified = true } = {}) {
  const session = await initSession();

  if (!session) {
    goToLogin();
    throw new Error("Authentication required.");
  }

  if (requireVerified && usesLiveAuth() && !session.emailVerified) {
    go(routes.verifyEmail);
    throw new Error("Email verification required.");
  }

  return session;
}

export async function redirectIfAuthenticated() {
  const session = await initSession();
  if (!session) return null;

  if (usesLiveAuth() && !session.emailVerified) {
    go(routes.verifyEmail);
    return session;
  }

  go(postAuthPath(session));
  return session;
}

export async function requireUnverifiedSession() {
  const session = await initSession();
  if (!session) {
    goToLogin();
    throw new Error("Authentication required.");
  }

  if (!usesLiveAuth() || session.emailVerified) {
    go(homeFor(session));
    throw new Error("Email already verified.");
  }

  return session;
}

export { getSession };
