import { requireAuth } from "./auth-guard.js";
import { requireRoleSetup } from "./role-setup-guard.js";
import { hasCompletedOnboarding } from "../config/onboarding.js";
import { go, homeFor, routes } from "../config/routes.js";

export function requireOnboarding(session) {
  requireRoleSetup(session);
  if (!hasCompletedOnboarding(session)) {
    go(routes.onboarding);
    throw new Error("Finish onboarding to open Famielda.");
  }
  return session;
}

export async function requireOnboardingSelection() {
  const session = await requireAuth();
  requireRoleSetup(session);
  if (hasCompletedOnboarding(session)) {
    go(homeFor(session));
    throw new Error("Onboarding is already complete.");
  }
  return session;
}
