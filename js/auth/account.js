import { initFirebase, getFirebaseAuth, getAuthSdk, usesLiveAuth } from "../core/firebase.js";
import { wrapAuthError } from "./auth-errors.js";
import { deleteUserProfile } from "./user-profile.js";
import { clearSession, getSession } from "./session.js";
import { removeMockUser } from "./auth-service.js";

export async function deleteAccount({ password }) {
  if (!password) {
    throw new Error("Enter your password to delete this account.");
  }

  await initFirebase();

  if (!usesLiveAuth()) {
    const session = getSession();
    if (session?.id) removeMockUser(session.id);
    clearSession();
    return { deleted: true };
  }

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();
  const user = auth?.currentUser;

  if (!user) {
    throw new Error("Sign in again to delete this account.");
  }

  try {
    const credential = sdk.EmailAuthProvider.credential(user.email, password);
    await sdk.reauthenticateWithCredential(user, credential);
    await deleteUserProfile(user.uid);
    await sdk.deleteUser(user);
    clearSession();
    return { deleted: true };
  } catch (error) {
    throw wrapAuthError(error);
  }
}
