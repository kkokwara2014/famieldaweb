import { getAuthSdk, getFirebaseAuth, usesLiveAuth } from "../core/firebase.js";

export async function setSessionPersistence(remember = true) {
  if (!usesLiveAuth()) return remember ? "local" : "session";

  const auth = getFirebaseAuth();
  const sdk = getAuthSdk();
  if (!auth || !sdk) return remember ? "local" : "session";

  const mode = remember ? sdk.browserLocalPersistence : sdk.browserSessionPersistence;
  await sdk.setPersistence(auth, mode);
  return remember ? "local" : "session";
}
