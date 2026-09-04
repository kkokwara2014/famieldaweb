/**
 * Client observability — Module 38.
 * Installs JS error, Firebase, and performance probes. Safe to call more than once.
 */

import { MONITORING_THRESHOLDS } from "../config/monitoring.js";
import {
  trackFirebaseSignal,
  trackJsError,
  trackPerformanceMetric,
} from "../services/monitoring-service.js";
import { usesLiveAuth } from "../core/firebase.js";

let installed = false;
let healthTimer = 0;

function currentPage() {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function detailFromErrorEvent(event) {
  const file = event.filename || "";
  const line = event.lineno || 0;
  const col = event.colno || 0;
  if (!file && !line) return "";
  return `${String(file).split("?")[0]}:${line}:${col}`.slice(0, 180);
}

function installErrorMonitor() {
  window.addEventListener("error", (event) => {
    const error = event.error instanceof Error
      ? event.error
      : new Error(event.message || "Unhandled exception");
    trackJsError(error, {
      page: currentPage(),
      filename: event.filename,
      lineno: event.lineno,
      detail: detailFromErrorEvent(event),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(String(reason || "Unhandled rejection"));
    trackJsError(error, {
      page: currentPage(),
      code: error.name || "unhandledrejection",
      detail: "unhandledrejection",
    });
  });
}

function navigationMetric() {
  const entry = performance.getEntriesByType?.("navigation")?.[0];
  if (!entry) {
    const timing = performance.timing;
    if (!timing?.navigationStart) return null;
    return {
      ttfb: timing.responseStart - timing.navigationStart,
      load: timing.loadEventEnd - timing.navigationStart,
    };
  }
  return {
    ttfb: Math.round(entry.responseStart),
    load: Math.round(entry.loadEventEnd || entry.duration),
  };
}

function installPerformanceMonitor() {
  const report = () => {
    const metric = navigationMetric();
    if (!metric) return;
    if (metric.load > 0) {
      trackPerformanceMetric({
        name: "page_load",
        durationMs: metric.load,
        page: currentPage(),
      });
    }
    if (metric.ttfb >= MONITORING_THRESHOLDS.slowTtfbMs) {
      trackPerformanceMetric({
        name: "ttfb",
        durationMs: metric.ttfb,
        page: currentPage(),
      });
    }
  };

  if (document.readyState === "complete") {
    setTimeout(report, 0);
  } else {
    window.addEventListener("load", () => setTimeout(report, 0), { once: true });
  }

  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.entryType !== "largest-contentful-paint") return;
          if (entry.startTime < MONITORING_THRESHOLDS.slowPageMs) return;
          trackPerformanceMetric({
            name: "lcp",
            durationMs: Math.round(entry.startTime),
            page: currentPage(),
          });
        });
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      /* Some browsers expose PerformanceObserver without LCP. */
    }
  }
}

async function pingFirebaseHealth() {
  if (!usesLiveAuth()) {
    trackFirebaseSignal({
      name: "health",
      ok: true,
      message: "Local architecture mode",
      durationMs: 0,
    });
    return;
  }
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const { callCloudFunction } = await import("../core/functions.js");
    const result = await callCloudFunction("health", {}, { quiet: true });
    const durationMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
    trackFirebaseSignal({
      name: "health",
      ok: result?.ok !== false,
      message: result?.service ? "Cloud Functions reachable" : "Health ping returned",
      durationMs,
    });
  } catch (error) {
    const durationMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
    trackFirebaseSignal({
      name: "health",
      ok: false,
      code: error.code || "unavailable",
      message: error.message || "Health ping failed",
      durationMs,
    });
  }
}

export function initMonitoring() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  installErrorMonitor();
  installPerformanceMonitor();
  window.clearTimeout(healthTimer);
  healthTimer = window.setTimeout(() => {
    pingFirebaseHealth().catch(() => {});
  }, 1200);
}
