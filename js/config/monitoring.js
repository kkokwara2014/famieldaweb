/**
 * Observability — Module 38.
 * Operational signals only. Never attach names, emails, notes, or health content.
 */

export const MONITORING_KINDS = {
  JS_ERROR: "js_error",
  FIREBASE: "firebase",
  FUNCTION: "function",
  AUTH: "auth",
  PERFORMANCE: "performance",
  PAYMENT: "payment",
  NOTIFICATION: "notification",
};

export const MONITORING_KIND_NAMES = Object.values(MONITORING_KINDS);

export const MONITORING_KIND_META = [
  { id: MONITORING_KINDS.JS_ERROR, label: "JavaScript errors", summary: "Unhandled exceptions on Famielda Web." },
  { id: MONITORING_KINDS.FIREBASE, label: "Firebase", summary: "SDK init and backend health checks." },
  { id: MONITORING_KINDS.FUNCTION, label: "Cloud Functions", summary: "Callable failures and slow handlers." },
  { id: MONITORING_KINDS.AUTH, label: "Authentication", summary: "Sign-in, registration, and reset outcomes." },
  { id: MONITORING_KINDS.PERFORMANCE, label: "Performance", summary: "Page load and interaction timing." },
  { id: MONITORING_KINDS.PAYMENT, label: "Failed payments", summary: "Stripe invoices that did not collect." },
  { id: MONITORING_KINDS.NOTIFICATION, label: "Notifications", summary: "Push delivery, skips, and FCM failures." },
];

export const MONITORING_SEVERITY = {
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  CRITICAL: "critical",
};

export const MONITORING_SOURCES = {
  CLIENT: "client",
  SERVER: "server",
};

export const MONITORING_STATUS = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  CRITICAL: "critical",
};

export const MONITORING_ALLOWED_KEYS = [
  "kind",
  "severity",
  "source",
  "ok",
  "code",
  "message",
  "detail",
  "page",
  "name",
  "durationMs",
  "status",
  "userId",
  "platform",
  "fingerprint",
  "sent",
  "failed",
  "amountCents",
  "currency",
  "createdAt",
];

export const MONITORING_DENIED_KEYS = [
  "email",
  "name",
  "displayName",
  "preferredName",
  "body",
  "notes",
  "note",
  "title",
  "phone",
  "address",
  "password",
  "token",
  "stack",
  "diagnosis",
  "medication",
  "symptoms",
  "mood",
];

export const MONITORING_PRIVACY_NOTE =
  "Health monitoring stores error codes, routes, timings, and opaque IDs. It does not store names, emails, stack traces with query strings, or care content.";

export const MONITORING_THRESHOLDS = {
  jsErrorDegraded: 5,
  jsErrorCritical: 20,
  functionErrorDegraded: 1,
  functionErrorCritical: 10,
  paymentDegraded: 1,
  paymentCritical: 3,
  authFailDegraded: 15,
  notificationFailRate: 20,
  slowFunctionMs: 2500,
  slowPageMs: 4000,
  slowTtfbMs: 1500,
  window24hMs: 24 * 60 * 60 * 1000,
  window7dMs: 7 * 24 * 60 * 60 * 1000,
};

export const QUIET_FUNCTION_NAMES = new Set([
  "reportMonitoringEvent",
  "health",
  "adminGetHealthOverview",
]);

export const AUTH_FAILURE_CODES = new Set([
  "auth/wrong-password",
  "auth/user-not-found",
  "auth/invalid-credential",
  "auth/invalid-login-credentials",
  "auth/user-disabled",
  "auth/too-many-requests",
  "auth/network-request-failed",
  "auth/email-already-in-use",
  "auth/weak-password",
  "auth/internal-error",
  "auth/operation-not-allowed",
]);

export function isMonitoringKind(kind) {
  return MONITORING_KIND_NAMES.includes(kind);
}

export function monitoringKindLabel(kind) {
  return MONITORING_KIND_META.find((item) => item.id === kind)?.label
    || String(kind || "").replaceAll("_", " ");
}

export function monitoringKindHref(kind) {
  if (kind === MONITORING_KINDS.PAYMENT) return "/admin/index.html?section=payments";
  if (kind === MONITORING_KINDS.NOTIFICATION) return "/admin/index.html?section=notifications";
  if (kind === MONITORING_KINDS.AUTH) return "/admin/index.html?section=users";
  return "/admin/index.html?section=health";
}

export function healthStatusLabel(status) {
  if (status === MONITORING_STATUS.CRITICAL) return "Critical";
  if (status === MONITORING_STATUS.DEGRADED) return "Degraded";
  return "Healthy";
}

export function healthStatusBadge(status) {
  if (status === MONITORING_STATUS.CRITICAL) return "badge--danger";
  if (status === MONITORING_STATUS.DEGRADED) return "badge--warning";
  return "badge--success";
}

export function severityLabel(severity) {
  if (severity === MONITORING_SEVERITY.CRITICAL) return "Critical";
  if (severity === MONITORING_SEVERITY.ERROR) return "Error";
  if (severity === MONITORING_SEVERITY.WARN) return "Warning";
  return "Info";
}

export function severityBadge(severity) {
  if (severity === MONITORING_SEVERITY.CRITICAL || severity === MONITORING_SEVERITY.ERROR) return "badge--danger";
  if (severity === MONITORING_SEVERITY.WARN) return "badge--warning";
  return "badge--neutral";
}

export function sanitizePagePath(value = "") {
  try {
    const url = new URL(value, "https://famielda.web.app");
    return `${url.pathname || "/"}`.slice(0, 180);
  } catch {
    return String(value || "").split("?")[0].split("#")[0].slice(0, 180) || "/";
  }
}

export function sanitizeMonitorText(value, max = 280) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  text = text.replace(/https?:\/\/[^\s]+/gi, (match) => sanitizePagePath(match));
  text = text.replace(/[?&](token|oobCode|apiKey|email)=[^&\s]+/gi, "");
  return text.slice(0, max);
}

export function errorFingerprint({ name = "", message = "", page = "", line = 0 } = {}) {
  const raw = [name, sanitizeMonitorText(message, 120), sanitizePagePath(page), Number(line) || 0].join("|");
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}

export function emptyKindCounts() {
  return Object.fromEntries(MONITORING_KIND_NAMES.map((kind) => [kind, 0]));
}

export function ratioPercent(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part) / Number(whole)) * 1000) / 10;
}

export function deriveHealthStatus(checks = []) {
  if (checks.some((item) => item.status === MONITORING_STATUS.CRITICAL)) return MONITORING_STATUS.CRITICAL;
  if (checks.some((item) => item.status === MONITORING_STATUS.DEGRADED)) return MONITORING_STATUS.DEGRADED;
  return MONITORING_STATUS.HEALTHY;
}

export function buildHealthChecks(stats = {}, firebase = {}) {
  const t = MONITORING_THRESHOLDS;
  const js = Number(stats.jsErrors24h || 0);
  const fn = Number(stats.functionErrors24h || 0);
  const pay = Number(stats.paymentFailures24h || 0);
  const authFails = Number(stats.authFailures24h || 0);
  const failRate = Number(stats.notificationFailRate || 0);
  const slow = Number(stats.slowFunctions24h || 0);
  const firebaseOk = firebase.ok !== false;

  const check = (id, label, status, value, hint) => ({ id, label, status, value, hint });

  return [
    check(
      MONITORING_KINDS.JS_ERROR,
      "JavaScript errors",
      js >= t.jsErrorCritical ? MONITORING_STATUS.CRITICAL : js >= t.jsErrorDegraded ? MONITORING_STATUS.DEGRADED : MONITORING_STATUS.HEALTHY,
      js,
      "Unhandled exceptions on Famielda Web in the last 24 hours."
    ),
    check(
      MONITORING_KINDS.FIREBASE,
      "Firebase",
      firebaseOk ? MONITORING_STATUS.HEALTHY : MONITORING_STATUS.CRITICAL,
      firebaseOk ? "Reachable" : "Unreachable",
      firebase.message || "SDK init and Cloud Functions health ping."
    ),
    check(
      MONITORING_KINDS.FUNCTION,
      "Cloud Functions",
      fn >= t.functionErrorCritical ? MONITORING_STATUS.CRITICAL : (fn >= t.functionErrorDegraded || slow >= 3) ? MONITORING_STATUS.DEGRADED : MONITORING_STATUS.HEALTHY,
      fn,
      slow ? `${slow} slow handlers over ${t.slowFunctionMs}ms.` : "Unexpected callable failures in the last 24 hours."
    ),
    check(
      MONITORING_KINDS.AUTH,
      "Authentication",
      authFails >= t.authFailDegraded ? MONITORING_STATUS.DEGRADED : MONITORING_STATUS.HEALTHY,
      authFails,
      `${stats.authSuccess24h || 0} successful sign-ins in the same window.`
    ),
    check(
      MONITORING_KINDS.PERFORMANCE,
      "Performance",
      Number(stats.slowPages24h || 0) >= 8 ? MONITORING_STATUS.DEGRADED : MONITORING_STATUS.HEALTHY,
      stats.slowPages24h || 0,
      `Loads slower than ${t.slowPageMs / 1000}s, or TTFB slower than ${t.slowTtfbMs}ms.`
    ),
    check(
      MONITORING_KINDS.PAYMENT,
      "Failed payments",
      pay >= t.paymentCritical ? MONITORING_STATUS.CRITICAL : pay >= t.paymentDegraded ? MONITORING_STATUS.DEGRADED : MONITORING_STATUS.HEALTHY,
      pay,
      "Stripe invoice.payment_failed events in the last 24 hours."
    ),
    check(
      MONITORING_KINDS.NOTIFICATION,
      "Notification delivery",
      failRate >= t.notificationFailRate ? MONITORING_STATUS.DEGRADED : MONITORING_STATUS.HEALTHY,
      `${failRate}%`,
      `${stats.notificationsSent24h || 0} delivered · ${stats.notificationsFailed24h || 0} failed · ${stats.notificationsSkipped24h || 0} skipped.`
    ),
  ];
}

export function summarizeMonitoringEvents(events = [], now = Date.now(), firebase = { ok: true }) {
  const last24 = now - MONITORING_THRESHOLDS.window24hMs;
  const last7 = now - MONITORING_THRESHOLDS.window7dMs;
  const counts24 = emptyKindCounts();
  const counts7 = emptyKindCounts();
  const fingerprints = new Map();
  const slowFunctions = new Map();
  let jsErrors24h = 0;
  let functionErrors24h = 0;
  let slowFunctions24h = 0;
  let paymentFailures24h = 0;
  let authFailures24h = 0;
  let authSuccess24h = 0;
  let notificationsSent24h = 0;
  let notificationsFailed24h = 0;
  let notificationsSkipped24h = 0;
  let slowPages24h = 0;

  const inWindow = (at, start) => at >= start;

  events.forEach((event) => {
    const kind = event.kind;
    if (!isMonitoringKind(kind)) return;
    const at = Date.parse(event.createdAt || "") || 0;
    if (inWindow(at, last7)) counts7[kind] += 1;
    if (inWindow(at, last24)) counts24[kind] += 1;
    if (!inWindow(at, last24)) return;

    if (kind === MONITORING_KINDS.JS_ERROR) {
      jsErrors24h += 1;
      const key = event.fingerprint || event.message || "unknown";
      const current = fingerprints.get(key) || {
        fingerprint: key,
        message: event.message || "Unknown error",
        page: event.page || "",
        count: 0,
        lastAt: event.createdAt,
      };
      current.count += 1;
      if (String(event.createdAt || "") > String(current.lastAt || "")) current.lastAt = event.createdAt;
      fingerprints.set(key, current);
    }

    if (kind === MONITORING_KINDS.FUNCTION && event.ok === false) functionErrors24h += 1;
    if (kind === MONITORING_KINDS.FUNCTION && (event.status === "slow" || Number(event.durationMs) >= MONITORING_THRESHOLDS.slowFunctionMs)) {
      slowFunctions24h += 1;
      const key = event.name || "callable";
      const current = slowFunctions.get(key) || { name: key, count: 0, maxMs: 0 };
      current.count += 1;
      current.maxMs = Math.max(current.maxMs, Number(event.durationMs) || 0);
      slowFunctions.set(key, current);
    }

    if (kind === MONITORING_KINDS.PAYMENT && event.ok === false) paymentFailures24h += 1;
    if (kind === MONITORING_KINDS.AUTH && event.ok === false) authFailures24h += 1;
    if (kind === MONITORING_KINDS.AUTH && event.ok !== false && event.name === "login") authSuccess24h += 1;
    if (kind === MONITORING_KINDS.NOTIFICATION) {
      notificationsSent24h += Number(event.sent || (event.status === "sent" ? 1 : 0));
      notificationsFailed24h += Number(event.failed || (event.status === "failed" ? 1 : 0));
      if (event.status === "skipped") notificationsSkipped24h += 1;
    }
    if (kind === MONITORING_KINDS.PERFORMANCE && Number(event.durationMs) >= MONITORING_THRESHOLDS.slowPageMs) {
      slowPages24h += 1;
    }
  });

  const delivered = notificationsSent24h + notificationsFailed24h;
  const stats = {
    jsErrors24h,
    functionErrors24h,
    slowFunctions24h,
    paymentFailures24h,
    authFailures24h,
    authSuccess24h,
    notificationsSent24h,
    notificationsFailed24h,
    notificationsSkipped24h,
    notificationFailRate: ratioPercent(notificationsFailed24h, delivered),
    slowPages24h,
  };

  const checks = buildHealthChecks(stats, firebase);
  const status = deriveHealthStatus(checks);
  const sorted = events
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return {
    generatedAt: new Date(now).toISOString(),
    status,
    firebase: {
      ok: firebase.ok !== false,
      durationMs: firebase.durationMs || null,
      message: firebase.message || "",
    },
    stats,
    counts24,
    counts7,
    checks,
    topErrors: [...fingerprints.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    slowFunctions: [...slowFunctions.values()].sort((a, b) => b.maxMs - a.maxMs).slice(0, 8),
    recent: sorted.slice(0, 40).map((event) => ({
      id: event.id,
      kind: event.kind,
      severity: event.severity || MONITORING_SEVERITY.INFO,
      ok: event.ok !== false,
      code: event.code || "",
      message: event.message || "",
      name: event.name || "",
      page: event.page || "",
      status: event.status || "",
      durationMs: event.durationMs || null,
      source: event.source || "",
      createdAt: event.createdAt || null,
    })),
  };
}
