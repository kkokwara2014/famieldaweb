/**
 * Famielda Performance — Module 37.
 * Page-sized Firestore reads, cache TTLs, debounce windows, and image budgets.
 * Never load an entire collection when a screen only shows a page of records.
 */

export const PAGE_SIZE = 20;

export const QUERY_LIMITS = {
  PAGE: PAGE_SIZE,
  FEED: PAGE_SIZE,
  DASHBOARD: 40,
  WORKSPACE: 80,
  SCHEDULE: 80,
  ADMIN: PAGE_SIZE,
  ANALYTICS: 200,
  OVERVIEW_SAMPLE: 6,
  UNREAD: 21,
  LOOKUP: 8,
  HARD: 100,
};

export const CACHE_TTL_MS = {
  MEMORY: 8_000,
  SESSION: 60_000,
  FEED: 4_000,
};

export const CACHE_MAX_ENTRIES = 80;

export const DEBOUNCE_MS = {
  SEARCH: 280,
  INPUT: 220,
  LISTENER: 120,
  RESIZE: 150,
};

export const IMAGE = {
  AVATAR_MAX: 512,
  PHOTO_QUALITY: 0.82,
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
};

export const LISTENER = {
  FEED_LIMIT: PAGE_SIZE,
  PAUSE_WHEN_HIDDEN: false,
};

export function clampQueryLimit(value, fallback = PAGE_SIZE) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return fallback;
  return Math.min(Math.floor(next), QUERY_LIMITS.HARD);
}
