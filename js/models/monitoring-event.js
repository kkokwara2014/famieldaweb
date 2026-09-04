import { AUTH } from "../config/constants.js";
import {
  MONITORING_ALLOWED_KEYS,
  MONITORING_KINDS,
  MONITORING_SEVERITY,
  MONITORING_SOURCES,
  errorFingerprint,
  isMonitoringKind,
  sanitizeMonitorText,
  sanitizePagePath,
} from "../config/monitoring.js";

const ALLOWED = new Set(MONITORING_ALLOWED_KEYS);

function boolOf(value, fallback = true) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function numberOf(value, max = 600000) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return null;
  return Math.min(Math.round(next), max);
}

export function createMonitoringEvent(data = {}) {
  const kind = isMonitoringKind(data.kind) ? data.kind : "";
  const page = sanitizePagePath(data.page || "");
  const message = sanitizeMonitorText(data.message, 280);
  const name = sanitizeMonitorText(data.name, 80);
  const fingerprint = data.fingerprint
    || (kind === MONITORING_KINDS.JS_ERROR ? errorFingerprint({ name, message, page, line: data.line }) : "");
  const severity = Object.values(MONITORING_SEVERITY).includes(data.severity)
    ? data.severity
    : (data.ok === false ? MONITORING_SEVERITY.ERROR : MONITORING_SEVERITY.INFO);

  const record = {
    id: data.id || "",
    kind,
    severity,
    source: data.source === MONITORING_SOURCES.SERVER ? MONITORING_SOURCES.SERVER : MONITORING_SOURCES.CLIENT,
    ok: boolOf(data.ok, data.ok !== false),
    code: sanitizeMonitorText(data.code, 80),
    message,
    detail: sanitizeMonitorText(data.detail, 400),
    page,
    name,
    durationMs: numberOf(data.durationMs),
    status: sanitizeMonitorText(data.status, 40),
    userId: sanitizeMonitorText(data.userId, 128),
    platform: sanitizeMonitorText(data.platform || AUTH.PLATFORM, 20) || AUTH.PLATFORM,
    fingerprint,
    sent: numberOf(data.sent, 5000),
    failed: numberOf(data.failed, 5000),
    amountCents: numberOf(data.amountCents, 100000000),
    currency: sanitizeMonitorText(data.currency, 8).toUpperCase(),
    createdAt: data.createdAt || new Date().toISOString(),
  };

  Object.keys(record).forEach((key) => {
    if (!ALLOWED.has(key) && key !== "id") delete record[key];
    if (record[key] == null || record[key] === "") delete record[key];
  });
  return record;
}
