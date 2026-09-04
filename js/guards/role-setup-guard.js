import { requireAuth } from "./auth-guard.js";
import { hasCompletedRoleSetup } from "../config/roles.js";
import { go, homeFor, routes } from "../config/routes.js";

export function requireRoleSetup(session) {
  if (!hasCompletedRoleSetup(session)) {
    go(routes.selectRole);
    throw new Error("Choose your role to open Famielda.");
  }
  return session;
}

export async function requireRoleSelection() {
  const session = await requireAuth();
  if (hasCompletedRoleSetup(session)) {
    go(homeFor(session));
    throw new Error("Your role is already saved.");
  }
  return session;
}
