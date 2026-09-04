import { DEBOUNCE_MS, LISTENER, QUERY_LIMITS, clampQueryLimit } from "../config/performance.js";
import { debounce } from "./debounce.js";
import { logger } from "./logger.js";

const registry = new Set();
const shared = new Map();
const objectUrls = new Set();

function track(stop) {
  if (typeof stop !== "function") return () => {};
  const entry = { stop, stopped: false };
  registry.add(entry);
  return () => {
    if (entry.stopped) return;
    entry.stopped = true;
    registry.delete(entry);
    try {
      stop();
    } catch (error) {
      logger.warn("Listener cleanup failed.", error);
    }
  };
}

export function registerListener(stop) {
  return track(stop);
}

export function stopAllListeners() {
  [...registry].forEach((entry) => {
    try {
      entry.stop();
    } catch {
      /* already gone */
    }
    entry.stopped = true;
  });
  registry.clear();
  shared.clear();
}

export function trackObjectUrl(url) {
  if (url) objectUrls.add(url);
  return url;
}

export function revokeObjectUrl(url) {
  if (!url) return;
  objectUrls.delete(url);
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

export function revokeAllObjectUrls() {
  [...objectUrls].forEach((url) => revokeObjectUrl(url));
}

export function subscribeShared(key, start, handler) {
  if (typeof handler !== "function") return () => {};
  let group = shared.get(key);
  if (!group) {
    group = { handlers: new Set(), last: undefined, stop: null };
    shared.set(key, group);
    const emit = (value) => {
      group.last = value;
      group.handlers.forEach((fn) => {
        try {
          fn(value);
        } catch (error) {
          logger.warn("Shared listener handler failed.", error);
        }
      });
    };
    group.stop = start(emit);
  }
  group.handlers.add(handler);
  if (group.last !== undefined) handler(group.last);
  return () => {
    group.handlers.delete(handler);
    if (group.handlers.size) return;
    try {
      group.stop?.();
    } catch {
      /* ignore */
    }
    shared.delete(key);
  };
}

export function listenCollection(sdk, db, collection, constraints, handler, options = {}) {
  if (!sdk || !db || typeof handler !== "function") return () => {};
  const limit = clampQueryLimit(options.limit ?? LISTENER.FEED_LIMIT ?? QUERY_LIMITS.FEED);
  const query = sdk.query(sdk.collection(db, collection), ...constraints, sdk.limit(limit));
  const emit = options.debounce === false
    ? handler
    : debounce(handler, options.debounceMs ?? DEBOUNCE_MS.LISTENER);
  const stop = sdk.onSnapshot(query, (snap) => {
    emit(snap);
  }, (error) => {
    logger.warn("Firestore listener failed.", error);
    options.onError?.(error);
  });
  return track(() => {
    emit.cancel?.();
    stop();
  });
}

export function bindLifecycleCleanup() {
  if (typeof window === "undefined" || window.__famieldaLifecycleBound) return;
  window.__famieldaLifecycleBound = true;
  window.addEventListener("pagehide", () => {
    stopAllListeners();
    revokeAllObjectUrls();
  });
}
