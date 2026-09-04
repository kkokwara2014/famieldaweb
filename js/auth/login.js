import { loginWithEmail } from "./auth-service.js";
import { setSession } from "./session.js";

export async function login(credentials) {
  const user = await loginWithEmail(credentials);
  return setSession(user);
}
