import { AUTH } from "../config/constants.js";
import {
  ANALYTICS_ALLOWED_KEYS,
  ANALYTICS_DENIED_KEYS,
  ANALYTICS_SOURCES,
  analyticsDocId,
  isProductEvent,
} from "../config/analytics.js";
import { catalogPlanId } from "../config/entitlements.js";

const ALLOWED = new Set(ANALYTICS_ALLOWED_KEYS);
const DENIED = new Set(ANALYTICS_DENIED_KEYS);

function textOf(value, max = 80) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean" || typeof value === "number") return value;
  return String(value).trim().slice(0, max);
}

function looksSensitive(key) {
  const lower = String(key || "").toLowerCase();
  if (DENIED.has(lower)) return true;
  return /(email|phone|address|diagnos|medicat|symptom|clinical|mood|ssn|dob|note|message|name)/i.test(lower)
    && lower !== "name"
    && lower !== "username";
}

export function sanitizeAnalyticsProperties(input = {}) {
  const out = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    if (!ALLOWED.has(key) || looksSensitive(key) || key === "name" || key === "userId" || key === "createdAt") {
      return;
    }
    if (value == null || value === "") return;
    if (typeof value === "boolean") {
      out[key] = value;
      return;
    }
    out[key] = textOf(value, 80);
  });
  return out;
}

export function createAnalyticsEvent(data = {}) {
  const name = String(data.name || "").trim();
  const properties = sanitizeAnalyticsProperties(data);
  const createdAt = data.createdAt || new Date().toISOString();
  const dedupeKey = textOf(data.dedupeKey || properties.dedupeKey, 200);
  const id = data.id || analyticsDocId(dedupeKey) || "";
  return {
    id,
    ...properties,
    name: isProductEvent(name) ? name : "",
    userId: textOf(data.userId, 128),
    role: textOf(data.role || properties.role, 40) || null,
    plan: catalogPlanId(data.plan || properties.plan),
    platform: textOf(data.platform || AUTH.PLATFORM, 20) || AUTH.PLATFORM,
    source: data.source === ANALYTICS_SOURCES.SERVER ? ANALYTICS_SOURCES.SERVER : ANALYTICS_SOURCES.CLIENT,
    dedupeKey,
    createdAt,
  };
}
