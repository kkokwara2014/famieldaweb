import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from "../config/performance.js";

const memory = new Map();
const inflight = new Map();
const SESSION_PREFIX = "famielda.perf.";

function now() {
  return Date.now();
}

function pruneMemory() {
  const t = now();
  for (const [key, entry] of memory) {
    if (!entry || entry.expires <= t) memory.delete(key);
  }
  if (memory.size <= CACHE_MAX_ENTRIES) return;
  const extra = memory.size - CACHE_MAX_ENTRIES;
  const keys = [...memory.keys()].slice(0, extra);
  keys.forEach((key) => memory.delete(key));
}

export function cacheGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expires <= now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttl = CACHE_TTL_MS.MEMORY) {
  memory.set(key, { value, expires: now() + Math.max(0, ttl) });
  pruneMemory();
  return value;
}

export function cacheDelete(key) {
  memory.delete(key);
}

export function cacheClear() {
  memory.clear();
}

export function remember(key, ttl, producer) {
  const hit = cacheGet(key);
  if (hit !== null && hit !== undefined) return Promise.resolve(hit);
  if (inflight.has(key)) return inflight.get(key);
  const pending = Promise.resolve(producer()).then((value) => {
    cacheSet(key, value, ttl);
    inflight.delete(key);
    return value;
  }, (error) => {
    inflight.delete(key);
    throw error;
  });
  inflight.set(key, pending);
  return pending;
}

function sessionKey(key) {
  return `${SESSION_PREFIX}${key}`;
}

export function sessionCacheGet(key) {
  try {
    const raw = sessionStorage.getItem(sessionKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || entry.expires <= now()) {
      sessionStorage.removeItem(sessionKey(key));
      return null;
    }
    return entry.value;
  } catch {
    return cacheGet(`session:${key}`);
  }
}

export function sessionCacheSet(key, value, ttl = CACHE_TTL_MS.SESSION) {
  const entry = { value, expires: now() + Math.max(0, ttl) };
  try {
    sessionStorage.setItem(sessionKey(key), JSON.stringify(entry));
  } catch {
    cacheSet(`session:${key}`, value, ttl);
  }
  return value;
}

export function pruneCaches() {
  pruneMemory();
  try {
    const stale = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(SESSION_PREFIX)) continue;
      try {
        const entry = JSON.parse(sessionStorage.getItem(key));
        if (!entry || entry.expires <= now()) stale.push(key);
      } catch {
        stale.push(key);
      }
    }
    stale.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    /* private mode / quota */
  }
}
