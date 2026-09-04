import { getSession } from "../auth/session.js";

export async function getCurrentUser() {
  return getSession();
}
