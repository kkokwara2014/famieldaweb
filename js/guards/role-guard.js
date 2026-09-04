import { go, homeFor } from "../config/routes.js";

export function requireRole(session, role) {
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(session.role)) {
    go(homeFor(session));
    throw new Error("You do not have access to this area.");
  }
  return session;
}
