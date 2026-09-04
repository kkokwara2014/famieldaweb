import { firebaseConfig, functionsRegion, isFirebaseConfigured } from "../config/firebase-config.js";
import { logger } from "./logger.js";

const FIREBASE_VERSION = "10.14.1";
const SDK_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

let app = null;
let auth = null;
let db = null;
let fileStorage = null;
let messaging = null;
let functions = null;
let authSdk = null;
let firestoreSdk = null;
let storageSdk = null;
let messagingSdk = null;
let functionsSdk = null;
let initPromise = null;
const extra = {
  storage: null,
  messaging: null,
  functions: null,
};

export function usesLiveAuth() {
  return isFirebaseConfigured();
}

async function loadSdk(name) {
  return import(`${SDK_BASE}/${name}`);
}

export async function initFirebase() {
  if (!isFirebaseConfigured()) {
    logger.info("Firebase is not configured; using local architecture mode.");
    return null;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
      loadSdk("firebase-app.js"),
      loadSdk("firebase-auth.js"),
      loadSdk("firebase-firestore.js"),
    ]);

    authSdk = authModule;
    firestoreSdk = firestoreModule;
    app = initializeApp(firebaseConfig);
    auth = authSdk.getAuth(app);
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    db = firestoreSdk.getFirestore(app);
    logger.info("Firebase Authentication is ready for Famielda Web.");
    import("../services/monitoring-service.js")
      .then((mod) => mod.trackFirebaseSignal({ name: "init", ok: true, message: "Firebase Authentication is ready" }))
      .catch(() => {});
    return app;
  })().catch((error) => {
    initPromise = null;
    logger.error("Firebase failed to initialize.", error);
    import("../services/monitoring-service.js")
      .then((mod) => mod.trackFirebaseSignal({
        name: "init",
        ok: false,
        code: error.code || "init_failed",
        message: error.message || "Firebase failed to initialize",
      }))
      .catch(() => {});
    throw error;
  });

  return initPromise;
}

export async function ensureFirebaseStorage() {
  await initFirebase();
  if (!app) return null;
  if (fileStorage) return fileStorage;
  if (!extra.storage) {
    extra.storage = loadSdk("firebase-storage.js").then((mod) => {
      storageSdk = mod;
      fileStorage = mod.getStorage(app);
      return fileStorage;
    }).catch((error) => {
      extra.storage = null;
      logger.warn("Firebase Storage is unavailable.", error);
      return null;
    });
  }
  return extra.storage;
}

export async function ensureFirebaseFunctions() {
  await initFirebase();
  if (!app) return null;
  if (functions) return functions;
  if (!extra.functions) {
    extra.functions = loadSdk("firebase-functions.js").then((mod) => {
      functionsSdk = mod;
      functions = mod.getFunctions(app, functionsRegion);
      return functions;
    }).catch((error) => {
      extra.functions = null;
      logger.warn("Cloud Functions SDK is unavailable.", error);
      import("../services/monitoring-service.js")
        .then((mod) => mod.trackFirebaseSignal({
          name: "functions",
          ok: false,
          code: error.code || "unavailable",
          message: error.message || "Cloud Functions SDK is unavailable",
        }))
        .catch(() => {});
      return null;
    });
  }
  return extra.functions;
}

export async function ensureFirebaseMessaging() {
  await initFirebase();
  if (!app) return null;
  if (messaging) return messaging;
  if (!extra.messaging) {
    extra.messaging = loadSdk("firebase-messaging.js").then(async (mod) => {
      messagingSdk = mod;
      if (typeof window !== "undefined" && await mod.isSupported().catch(() => false)) {
        messaging = mod.getMessaging(app);
      }
      return messaging;
    }).catch((error) => {
      extra.messaging = null;
      logger.warn("Firebase Messaging is unavailable.", error);
      import("../services/monitoring-service.js")
        .then((mod) => mod.trackFirebaseSignal({
          name: "messaging",
          ok: false,
          code: error.code || "unavailable",
          message: error.message || "Firebase Messaging is unavailable",
        }))
        .catch(() => {});
      return null;
    });
  }
  return extra.messaging;
}

export function getFirebaseApp() {
  return app;
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirebaseDb() {
  return db;
}

export function getAuthSdk() {
  return authSdk;
}

export function getFirestoreSdk() {
  return firestoreSdk;
}

export function getFirebaseStorage() {
  return fileStorage;
}

export function getStorageSdk() {
  return storageSdk;
}

export function getFirebaseMessaging() {
  return messaging;
}

export function getMessagingSdk() {
  return messagingSdk;
}

export function getFirebaseFunctions() {
  return functions;
}

export function getFunctionsSdk() {
  return functionsSdk;
}

export function actionContinueUrl(path = "/login.html") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${window.location.origin}${normalized}`;
}
