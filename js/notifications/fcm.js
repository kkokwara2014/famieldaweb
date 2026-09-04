import { fcmVapidKey, isFcmConfigured } from "../config/firebase-config.js";
import { ensureFirebaseMessaging, getFirebaseMessaging, getMessagingSdk, usesLiveAuth } from "../core/firebase.js";
import { getSession } from "../auth/session.js";
import { logger } from "../core/logger.js";
import { toast } from "../components/toast.js";
import { resolveNoticeHref } from "../config/notifications.js";
import { saveDeviceToken, removeDeviceToken } from "../services/notification-service.js";

const SW_PATH = "/firebase-messaging-sw.js";

let unsubscribeForeground = null;
let currentToken = "";

function permissionState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function pushPermissionState() {
  return permissionState();
}

export function canUsePush() {
  return isFcmConfigured()
    && usesLiveAuth()
    && typeof window !== "undefined"
    && "Notification" in window
    && "serviceWorker" in navigator;
}

async function registerMessagingWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH, { scope: "/" });
}

function bindForeground(session) {
  const sdk = getMessagingSdk();
  const messaging = getFirebaseMessaging();
  if (!messaging || !sdk || unsubscribeForeground) return;
  unsubscribeForeground = sdk.onMessage(messaging, (payload) => {
    const title = payload.notification?.title || payload.data?.title || "Famielda";
    const body = payload.notification?.body || payload.data?.body || "";
    const href = resolveNoticeHref({
      type: payload.data?.type,
      href: payload.data?.href,
    });
    toast(body ? `${title} · ${body}` : title, {
      type: payload.data?.type === "emergency_alert" ? "error" : "info",
      href,
      actionLabel: "Open",
      duration: payload.data?.type === "emergency_alert" ? 8000 : 5200,
    });
    window.dispatchEvent(new CustomEvent("famielda:notification", {
      detail: { payload, sessionId: session?.id || "" },
    }));
  });
}

export async function enablePushNotifications(session = getSession()) {
  if (!canUsePush() || !session?.id) {
    return { ok: false, reason: canUsePush() ? "signed-out" : "unavailable" };
  }
  if (permissionState() === "denied") {
    return { ok: false, reason: "denied" };
  }

  const permission = permissionState() === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission };
  }

  const registration = await registerMessagingWorker();
  await ensureFirebaseMessaging();
  const messaging = getFirebaseMessaging();
  const sdk = getMessagingSdk();
  if (!messaging || !sdk) return { ok: false, reason: "unsupported" };

  const token = await sdk.getToken(messaging, {
    vapidKey: fcmVapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) return { ok: false, reason: "no-token" };

  currentToken = token;
  await saveDeviceToken(token, session);
  bindForeground(session);
  logger.info("Famielda web push is ready.");
  return { ok: true, token };
}

export async function disablePushNotifications(session = getSession()) {
  const sdk = getMessagingSdk();
  const messaging = getFirebaseMessaging();
  if (currentToken && sdk && messaging && typeof sdk.deleteToken === "function") {
    try {
      await sdk.deleteToken(messaging);
    } catch {
      // Token may already be invalid.
    }
  }
  if (currentToken) {
    await removeDeviceToken(currentToken, session);
  }
  if (unsubscribeForeground) {
    unsubscribeForeground();
    unsubscribeForeground = null;
  }
  currentToken = "";
  return true;
}

export async function initPushNotifications(session = getSession()) {
  if (!canUsePush() || !session?.id) return { ok: false, reason: "unavailable" };
  if (permissionState() !== "granted") {
    return { ok: false, reason: permissionState() };
  }
  return enablePushNotifications(session);
}
