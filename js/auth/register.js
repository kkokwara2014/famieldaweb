import { registerAccount } from "./auth-service.js";
import { setSession } from "./session.js";

export async function register(payload) {
  const user = await registerAccount(payload);
  return setSession(user);
}
