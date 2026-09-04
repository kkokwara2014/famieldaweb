/**
 * Observability — Module 38.
 * Client reports, function logs, payment failures, and notification delivery.
 * No names, emails, notes, or clinical content.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");

const EVENTS = "monitoringEvents";

const KINDS = {
  JS_ERROR: "js_error",
  FIREBASE: "firebase",
  FUNCTION: "function",
  AUTH: "auth",
  PERFORMANCE: "performance",
  PAYMENT: "payment",
  NOTIFICATION: "notification",
};

const KIND_LIST = Object.values(KINDS);

const SEVERITY = {
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  CRITICAL: "critical",
};

const THRESHOLDS = {
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
  window24hMs: 24 * 60 * 60 * 1000,
  window7dMs: 7 * 24 * 60 * 60 * 1000,
};

const EXPECTED_FUNCTION_CODES = new Set([
  "invalid-argument",
  "unauthenticated",
  "permission-denied",
  "not-found",
  "already-exists",
  "failed-precondition",
  "resource-exhausted",
  "aborted",
  "out-of-range",
  "cancelled",
]);

const ALLOWED = new Set([
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
]);

const DENIED = /(email|phone|address|password|token|diagnos|medicat|symptom|clinical|mood|ssn|note|displayName|preferredName|stack)/i;

function db() {
  return getFirestore();
}

function textOf(value, max = 280) {
  if (value == null) return "";
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let text = String(value).replace(/\s+/g, " ").trim();
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  text = text.replace(/https?:\/\/[^\s]+/gi, (match) => {
    try {
      return new URL(match).pathname || "/";
    } catch {
      return "/";
    }
  });
  text = text.replace(/[?&](token|oobCode|apiKey|email)=[^&\s]+/gi, "");
  return text.slice(0, max);
}

function pageOf(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, "https://famielda.web.app").pathname.slice(0, 180);
  } catch {
    return raw.split("?")[0].split("#")[0].slice(0, 180);
  }
}

function numberOf(value, max = 600000) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return null;
  return Math.min(Math.round(next), max);
}

function fingerprintOf(input = {}) {
  if (input.fingerprint) return textOf(input.fingerprint, 80);
  if (input.kind !== KINDS.JS_ERROR) return "";
  const raw = [input.name, textOf(input.message, 120), pageOf(input.page)].join("|");
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}

function sanitizeRecord(input = {}, source = "server") {
  const kind = textOf(input.kind, 40);
  if (!KIND_LIST.includes(kind)) return null;
  const ok = input.ok !== false;
  const severity = [SEVERITY.INFO, SEVERITY.WARN, SEVERITY.ERROR, SEVERITY.CRITICAL].includes(input.severity)
    ? input.severity
    : (ok ? SEVERITY.INFO : SEVERITY.ERROR);

  const record = {
    kind,
    severity,
    source: source === "client" ? "client" : "server",
    ok,
    platform: textOf(input.platform, 20) || (source === "client" ? "web" : "server"),
    createdAt: FieldValue.serverTimestamp(),
  };

  const optional = {
    code: textOf(input.code, 80),
    message: textOf(input.message, 280),
    detail: textOf(input.detail, 400),
    page: pageOf(input.page),
    name: textOf(input.name, 80),
    status: textOf(input.status, 40),
    userId: textOf(input.userId, 128),
    fingerprint: fingerprintOf({ ...input, kind }),
    durationMs: numberOf(input.durationMs),
    sent: numberOf(input.sent, 5000),
    failed: numberOf(input.failed, 5000),
    amountCents: numberOf(input.amountCents, 100000000),
    currency: textOf(input.currency, 8).toUpperCase(),
  };

  Object.entries(optional).forEach(([key, value]) => {
    if (!ALLOWED.has(key) || DENIED.test(key)) return;
    if (value == null || value === "") return;
    record[key] = value;
  });

  return record;
}

async function writeEvent(input = {}, source = "server") {
  const record = sanitizeRecord(input, source);
  if (!record) return null;
  try {
    const ref = db().collection(EVENTS).doc();
    await ref.set(record);
    return ref.id;
  } catch (error) {
    logger.warn("Monitoring event was not recorded.", { kind: input.kind, message: error.message });
    return null;
  }
}

function recordQuiet(input, source = "server") {
  return writeEvent(input, source).catch((error) => {
    logger.warn("Monitoring event failed.", { message: error.message });
    return null;
  });
}

function functionCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

function shouldLogFunction(error, durationMs) {
  const code = functionCode(error);
  const unexpected = Boolean(error) && !EXPECTED_FUNCTION_CODES.has(code);
  const slow = Number(durationMs) >= THRESHOLDS.slowFunctionMs;
  return unexpected || slow;
}

function recordFunctionLog({ name, ok, durationMs, code, message, userId } = {}) {
  const failed = ok === false;
  const slow = Number(durationMs) >= THRESHOLDS.slowFunctionMs;
  if (!failed && !slow) return Promise.resolve(null);
  return recordQuiet({
    kind: KINDS.FUNCTION,
    ok: !failed,
    severity: failed ? SEVERITY.ERROR : SEVERITY.WARN,
    name: name || "callable",
    code: code || "",
    message: failed ? (message || "Cloud Function failed") : "Slow Cloud Function",
    durationMs,
    status: failed ? "failed" : "slow",
    userId: userId || "",
  });
}

function recordPaymentFailure({ invoiceId, status, amountCents, currency, userId, code } = {}) {
  return recordQuiet({
    kind: KINDS.PAYMENT,
    ok: false,
    severity: SEVERITY.ERROR,
    name: code || "invoice.payment_failed",
    code: code || "invoice.payment_failed",
    message: "Plus invoice payment failed",
    status: status || "open",
    amountCents,
    currency: currency || "USD",
    userId: userId || "",
    fingerprint: invoiceId ? `pay_${String(invoiceId).slice(0, 60)}` : "",
  });
}

function recordNotificationDelivery({ type, sent = 0, failed = 0, skipped = false, code, userId } = {}) {
  const status = skipped ? "skipped" : (failed > 0 && sent === 0 ? "failed" : (failed > 0 ? "partial" : "sent"));
  const ok = !skipped && failed === 0;
  return recordQuiet({
    kind: KINDS.NOTIFICATION,
    ok,
    severity: ok ? SEVERITY.INFO : SEVERITY.WARN,
    name: type || "notice",
    status,
    sent,
    failed,
    code: code || "",
    userId: userId || "",
  });
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function emptyCounts() {
  return Object.fromEntries(KIND_LIST.map((kind) => [kind, 0]));
}

function ratio(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part) / Number(whole)) * 1000) / 10;
}

function healthStatusOf(checks) {
  if (checks.some((item) => item.status === "critical")) return "critical";
  if (checks.some((item) => item.status === "degraded")) return "degraded";
  return "healthy";
}

function buildChecks(stats, firebase) {
  const t = THRESHOLDS;
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
      KINDS.JS_ERROR,
      "JavaScript errors",
      js >= t.jsErrorCritical ? "critical" : js >= t.jsErrorDegraded ? "degraded" : "healthy",
      js,
      "Unhandled exceptions on Famielda Web in the last 24 hours."
    ),
    check(
      KINDS.FIREBASE,
      "Firebase",
      firebaseOk ? "healthy" : "critical",
      firebaseOk ? "Reachable" : "Unreachable",
      firebase.message || "SDK init and Cloud Functions health ping."
    ),
    check(
      KINDS.FUNCTION,
      "Cloud Functions",
      fn >= t.functionErrorCritical ? "critical" : (fn >= t.functionErrorDegraded || slow >= 3) ? "degraded" : "healthy",
      fn,
      slow ? `${slow} slow handlers over ${t.slowFunctionMs}ms.` : "Unexpected callable failures in the last 24 hours."
    ),
    check(
      KINDS.AUTH,
      "Authentication",
      authFails >= t.authFailDegraded ? "degraded" : "healthy",
      authFails,
      `${stats.authSuccess24h || 0} successful sign-ins in the same window.`
    ),
    check(
      KINDS.PERFORMANCE,
      "Performance",
      Number(stats.slowPages24h || 0) >= 8 ? "degraded" : "healthy",
      stats.slowPages24h || 0,
      `Loads slower than ${t.slowPageMs / 1000}s.`
    ),
    check(
      KINDS.PAYMENT,
      "Failed payments",
      pay >= t.paymentCritical ? "critical" : pay >= t.paymentDegraded ? "degraded" : "healthy",
      pay,
      "Stripe invoice.payment_failed events in the last 24 hours."
    ),
    check(
      KINDS.NOTIFICATION,
      "Notification delivery",
      failRate >= t.notificationFailRate ? "degraded" : "healthy",
      `${failRate}%`,
      `${stats.notificationsSent24h || 0} delivered · ${stats.notificationsFailed24h || 0} failed · ${stats.notificationsSkipped24h || 0} skipped.`
    ),
  ];
}

function summarize(events, now = Date.now(), firebase = { ok: true }) {
  const last24 = now - THRESHOLDS.window24hMs;
  const last7 = now - THRESHOLDS.window7dMs;
  const counts24 = emptyCounts();
  const counts7 = emptyCounts();
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

  events.forEach((event) => {
    const kind = event.kind;
    if (!KIND_LIST.includes(kind)) return;
    const at = Date.parse(event.createdAt || "") || 0;
    if (at >= last7) counts7[kind] += 1;
    if (at >= last24) counts24[kind] += 1;
    if (at < last24) return;

    if (kind === KINDS.JS_ERROR) {
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
    if (kind === KINDS.FUNCTION && event.ok === false) functionErrors24h += 1;
    if (kind === KINDS.FUNCTION && (event.status === "slow" || Number(event.durationMs) >= THRESHOLDS.slowFunctionMs)) {
      slowFunctions24h += 1;
      const key = event.name || "callable";
      const current = slowFunctions.get(key) || { name: key, count: 0, maxMs: 0 };
      current.count += 1;
      current.maxMs = Math.max(current.maxMs, Number(event.durationMs) || 0);
      slowFunctions.set(key, current);
    }
    if (kind === KINDS.PAYMENT && event.ok === false) paymentFailures24h += 1;
    if (kind === KINDS.AUTH && event.ok === false) authFailures24h += 1;
    if (kind === KINDS.AUTH && event.ok !== false && event.name === "login") authSuccess24h += 1;
    if (kind === KINDS.NOTIFICATION) {
      notificationsSent24h += Number(event.sent || (event.status === "sent" ? 1 : 0));
      notificationsFailed24h += Number(event.failed || (event.status === "failed" ? 1 : 0));
      if (event.status === "skipped") notificationsSkipped24h += 1;
    }
    if (kind === KINDS.PERFORMANCE && Number(event.durationMs) >= THRESHOLDS.slowPageMs) {
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
    notificationFailRate: ratio(notificationsFailed24h, delivered),
    slowPages24h,
  };
  const checks = buildChecks(stats, firebase);
  const sorted = events.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return {
    generatedAt: new Date(now).toISOString(),
    status: healthStatusOf(checks),
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
      severity: event.severity || SEVERITY.INFO,
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

exports.KINDS = KINDS;
exports.SEVERITY = SEVERITY;
exports.recordQuiet = recordQuiet;
exports.writeEvent = writeEvent;
exports.recordFunctionLog = recordFunctionLog;
exports.recordPaymentFailure = recordPaymentFailure;
exports.recordNotificationDelivery = recordNotificationDelivery;
exports.shouldLogFunction = shouldLogFunction;
exports.functionCode = functionCode;
exports.summarize = summarize;

exports.reportMonitoringEvent = async (request) => {
  const uid = request.auth?.uid || "";
  const payload = request.data && typeof request.data === "object" ? request.data : {};
  const id = await writeEvent({
    ...payload,
    userId: uid || payload.userId || "",
    platform: payload.platform || "web",
  }, "client");
  return { ok: Boolean(id) };
};

exports.adminGetHealthOverview = async (request) => {
  const adminConsole = require("./admin");
  await adminConsole.requireAdmin(request);
  const started = Date.now();
  let firebase = { ok: true, message: "Cloud Functions and Firestore reachable." };
  let snap;
  try {
    snap = await db().collection(EVENTS).orderBy("createdAt", "desc").limit(2000).get();
  } catch (error) {
    logger.warn("monitoringEvents query fell back", { message: error.message });
    try {
      snap = await db().collection(EVENTS).limit(2000).get();
    } catch (inner) {
      firebase = { ok: false, message: inner.message || "Firestore query failed." };
      snap = { docs: [] };
    }
  }
  firebase.durationMs = Date.now() - started;
  const events = (snap.docs || []).map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: toIso(doc.data()?.createdAt),
  }));
  return summarize(events, Date.now(), firebase);
};
