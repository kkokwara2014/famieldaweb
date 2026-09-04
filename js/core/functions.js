import { ensureFirebaseFunctions, getFirebaseFunctions, getFunctionsSdk, usesLiveAuth } from "./firebase.js";

export function functionsMessage(error, fallback = "That request could not be completed.") {
  const code = String(error?.code || "");
  if (code.endsWith("unauthenticated")) return "Sign in to continue.";
  if (code.endsWith("already-exists")) return error.message || "Famielda Plus is already active.";
  if (code.endsWith("failed-precondition")) return error.message || "That request could not be completed.";
  if (code.endsWith("permission-denied")) return error.message || "You cannot complete this request.";
  if (code.endsWith("resource-exhausted")) return error.message || "Too many attempts. Please wait and try again.";
  if (code.endsWith("invalid-argument")) return error.message || "That request was invalid.";
  const cleaned = String(error?.message || "").replace(/^Firebase:\s*/i, "").replace(/\s*\([^)]+\)\s*$/, "").trim();
  if (!cleaned || /^internal$/i.test(cleaned) || code.endsWith("internal")) return fallback;
  return cleaned;
}

export async function callCloudFunction(name, data = {}, options = {}) {
  await ensureFirebaseFunctions();
  if (!usesLiveAuth()) {
    throw new Error("Cloud Functions need a configured Firebase project.");
  }

  const functions = getFirebaseFunctions();
  const sdk = getFunctionsSdk();
  if (!functions || !sdk?.httpsCallable) {
    throw new Error("Cloud Functions are not available in this browser session.");
  }

  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const result = await sdk.httpsCallable(functions, name)(data);
    if (!options.quiet) {
      const durationMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
      import("../services/monitoring-service.js")
        .then((mod) => mod.trackFunctionCall({ name, ok: true, durationMs }))
        .catch(() => {});
    }
    return result?.data;
  } catch (error) {
    if (!options.quiet) {
      const durationMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
      import("../services/monitoring-service.js")
        .then((mod) => mod.trackFunctionCall({
          name,
          ok: false,
          durationMs,
          code: error.code || "",
          message: error.message || "",
        }))
        .catch(() => {});
    }
    throw new Error(functionsMessage(error, options.fallback));
  }
}
