import { AUTH } from "../config/constants.js";
import {
  MONITORING_KINDS,
  MONITORING_SEVERITY,
  MONITORING_SOURCES,
  QUIET_FUNCTION_NAMES,
  sanitizePagePath,
  summarizeMonitoringEvents,
} from "../config/monitoring.js";
import { createMonitoringEvent } from "../models/monitoring-event.js";
import { storage } from "../core/storage.js";
import { logger } from "../core/logger.js";
import { usesLiveAuth } from "../core/firebase.js";
import { getSession } from "../auth/session.js";

const EVENTS_KEY = "monitoring-events";
const MAX_LOCAL = 250;
const MAX_BURST = 8;
const BURST_MS = 60_000;

const burst = [];
const recentFingerprints = new Map();

function nowIso() {
  return new Date().toISOString();
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function readLocalMap() {
  const existing = storage.get(EVENTS_KEY, null);
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return { ...existing };
  return {};
}

function writeLocalRecord(record) {
  const map = readLocalMap();
  map[record.id] = record;
  const ids = Object.keys(map).sort((a, b) => String(map[b].createdAt || "").localeCompare(String(map[a].createdAt || "")));
  if (ids.length > MAX_LOCAL) {
    ids.slice(MAX_LOCAL).forEach((id) => {
      delete map[id];
    });
  }
  storage.set(EVENTS_KEY, map);
  return record;
}

function allowBurst() {
  const cutoff = Date.now() - BURST_MS;
  while (burst.length && burst[0] < cutoff) burst.shift();
  if (burst.length >= MAX_BURST) return false;
  burst.push(Date.now());
  return true;
}

function allowFingerprint(fingerprint) {
  if (!fingerprint) return true;
  const last = recentFingerprints.get(fingerprint) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return false;
  recentFingerprints.set(fingerprint, Date.now());
  return true;
}

function seedMockMonitoring() {
  const map = readLocalMap();
  if (map["seed-monitor-js_error-3"] || map["seed-monitor-payment-5"]) return;
  const samples = [
    {
      kind: MONITORING_KINDS.FIREBASE,
      name: "health",
      ok: true,
      status: "ok",
      durationMs: 180,
      severity: MONITORING_SEVERITY.INFO,
      hours: 1,
    },
    {
      kind: MONITORING_KINDS.AUTH,
      name: "login",
      ok: true,
      status: "ok",
      code: "ok",
      severity: MONITORING_SEVERITY.INFO,
      hours: 2,
    },
    {
      kind: MONITORING_KINDS.AUTH,
      name: "login_failed",
      ok: false,
      status: "failed",
      code: "auth/invalid-credential",
      message: "Sign-in rejected",
      severity: MONITORING_SEVERITY.WARN,
      hours: 3,
    },
    {
      kind: MONITORING_KINDS.JS_ERROR,
      name: "TypeError",
      ok: false,
      message: "Cannot read properties of undefined (reading 'href')",
      page: "/app/schedule.html",
      fingerprint: "fp_schedule_href",
      severity: MONITORING_SEVERITY.ERROR,
      hours: 4,
    },
    {
      kind: MONITORING_KINDS.FUNCTION,
      name: "requestScheduleVisit",
      ok: true,
      status: "slow",
      durationMs: 3120,
      severity: MONITORING_SEVERITY.WARN,
      hours: 5,
    },
    {
      kind: MONITORING_KINDS.PAYMENT,
      name: "invoice.payment_failed",
      ok: false,
      status: "open",
      code: "invoice.payment_failed",
      message: "Plus invoice payment failed",
      amountCents: 999,
      currency: "USD",
      severity: MONITORING_SEVERITY.ERROR,
      hours: 8,
    },
    {
      kind: MONITORING_KINDS.NOTIFICATION,
      name: "schedule_request",
      ok: true,
      status: "sent",
      sent: 2,
      failed: 0,
      severity: MONITORING_SEVERITY.INFO,
      hours: 6,
    },
    {
      kind: MONITORING_KINDS.NOTIFICATION,
      name: "message",
      ok: false,
      status: "failed",
      sent: 0,
      failed: 1,
      code: "messaging/registration-token-not-registered",
      severity: MONITORING_SEVERITY.WARN,
      hours: 7,
    },
    {
      kind: MONITORING_KINDS.PERFORMANCE,
      name: "page_load",
      ok: true,
      status: "ok",
      durationMs: 1480,
      page: "/app/dashboard.html",
      severity: MONITORING_SEVERITY.INFO,
      hours: 2,
    },
    {
      kind: MONITORING_KINDS.FUNCTION,
      name: "adminGetOverview",
      ok: true,
      status: "ok",
      durationMs: 640,
      severity: MONITORING_SEVERITY.INFO,
      hours: 1,
    },
  ];
  samples.forEach((item, index) => {
    const record = createMonitoringEvent({
      ...item,
      id: `seed-monitor-${item.kind}-${index}`,
      source: item.kind === MONITORING_KINDS.JS_ERROR || item.kind === MONITORING_KINDS.PERFORMANCE
        ? MONITORING_SOURCES.CLIENT
        : MONITORING_SOURCES.SERVER,
      platform: AUTH.PLATFORM,
      createdAt: hoursAgo(item.hours),
    });
    writeLocalRecord(record);
  });
}

export function listLocalMonitoringEvents() {
  seedMockMonitoring();
  return Object.values(readLocalMap())
    .map((item) => createMonitoringEvent(item))
    .filter((item) => item.kind)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getLocalHealthOverview(firebase = { ok: true, message: "Local architecture mode." }) {
  return summarizeMonitoringEvents(listLocalMonitoringEvents(), Date.now(), firebase);
}

function toPayload(record) {
  const out = {};
  Object.entries(record).forEach(([key, value]) => {
    if (key === "id" || value == null || value === "") return;
    out[key] = value;
  });
  return out;
}

async function persistLive(record) {
  const { callCloudFunction } = await import("../core/functions.js");
  await callCloudFunction("reportMonitoringEvent", toPayload(record), { quiet: true });
  return record;
}

/**
 * Record an operational event. Never throws — monitoring must not break care flows.
 */
export function recordMonitoringEvent(input = {}) {
  try {
    const session = getSession();
    const record = createMonitoringEvent({
      ...input,
      id: input.id || `mon-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId || session?.id || "",
      page: input.page || (typeof window !== "undefined" ? window.location.pathname : ""),
      platform: input.platform || AUTH.PLATFORM,
      source: input.source || MONITORING_SOURCES.CLIENT,
      createdAt: input.createdAt || nowIso(),
    });
    if (!record.kind) return Promise.resolve(null);
    if (record.fingerprint && !allowFingerprint(record.fingerprint)) return Promise.resolve(null);
    if (!allowBurst()) return Promise.resolve(null);

    writeLocalRecord(record);
    if (!usesLiveAuth()) return Promise.resolve(record);
    return persistLive(record).catch((error) => {
      logger.warn("Monitoring event was not sent.", error);
      return record;
    });
  } catch (error) {
    logger.warn("Monitoring event was not recorded.", error);
    return Promise.resolve(null);
  }
}

export function trackJsError(error, extra = {}) {
  const err = error instanceof Error ? error : new Error(String(error || "Unknown error"));
  return recordMonitoringEvent({
    kind: MONITORING_KINDS.JS_ERROR,
    ok: false,
    severity: MONITORING_SEVERITY.ERROR,
    name: err.name || "Error",
    message: err.message || extra.message || "Unhandled exception",
    detail: extra.detail || "",
    page: extra.page || extra.filename,
    code: extra.code || err.name || "Error",
    status: "uncaught",
    line: extra.lineno,
  });
}

export function trackFirebaseSignal(input = {}) {
  const ok = input.ok !== false;
  return recordMonitoringEvent({
    kind: MONITORING_KINDS.FIREBASE,
    ok,
    severity: ok ? MONITORING_SEVERITY.INFO : MONITORING_SEVERITY.ERROR,
    name: input.name || "init",
    message: input.message || (ok ? "Firebase reachable" : "Firebase unavailable"),
    code: input.code || "",
    durationMs: input.durationMs,
    status: ok ? "ok" : "failed",
  });
}

export function trackFunctionCall(input = {}) {
  if (QUIET_FUNCTION_NAMES.has(input.name)) return Promise.resolve(null);
  const durationMs = Number(input.durationMs) || 0;
  const ok = input.ok !== false;
  const slow = durationMs >= 2500;
  if (ok && !slow) return Promise.resolve(null);
  return recordMonitoringEvent({
    kind: MONITORING_KINDS.FUNCTION,
    ok,
    severity: ok ? MONITORING_SEVERITY.WARN : MONITORING_SEVERITY.ERROR,
    name: input.name || "callable",
    message: input.message || (ok ? "Slow Cloud Function" : "Cloud Function failed"),
    code: input.code || "",
    durationMs,
    status: ok ? "slow" : "failed",
    source: MONITORING_SOURCES.CLIENT,
  });
}

export function trackAuthEvent(input = {}) {
  const ok = input.ok !== false;
  return recordMonitoringEvent({
    kind: MONITORING_KINDS.AUTH,
    ok,
    severity: ok ? MONITORING_SEVERITY.INFO : MONITORING_SEVERITY.WARN,
    name: input.name || (ok ? "login" : "login_failed"),
    message: ok ? "" : sanitizeAuthMessage(input.message),
    code: input.code || (ok ? "ok" : "auth/unknown"),
    status: ok ? "ok" : "failed",
  });
}

function sanitizeAuthMessage(message) {
  const text = String(message || "");
  if (/email|password|account/i.test(text)) return "Sign-in rejected";
  return text;
}

export function trackPerformanceMetric(input = {}) {
  return recordMonitoringEvent({
    kind: MONITORING_KINDS.PERFORMANCE,
    ok: true,
    severity: Number(input.durationMs) >= 4000 ? MONITORING_SEVERITY.WARN : MONITORING_SEVERITY.INFO,
    name: input.name || "page_load",
    durationMs: input.durationMs,
    page: input.page || sanitizePagePath(typeof window !== "undefined" ? window.location.pathname : ""),
    status: Number(input.durationMs) >= 4000 ? "slow" : "ok",
  });
}

export { MONITORING_KINDS, summarizeMonitoringEvents };
