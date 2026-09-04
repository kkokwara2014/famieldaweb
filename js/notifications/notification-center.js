import { formatWhen } from "../scheduling/time.js";
import {
  inAppAllowedForType,
  notificationPriority,
  notificationTypeLabel,
  noticeHref,
  resolveNoticeHref,
} from "../config/notifications.js";
import { NOTIFICATION_PRIORITY } from "../config/constants.js";
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadCount as countUnread,
  subscribeNotificationFeed,
} from "../services/notification-service.js";
import { getSession } from "../auth/session.js";

export function enrichNotice(item, { appRoot = "", now = new Date() } = {}) {
  const type = item.type;
  const href = item.href || noticeHref(type, item);
  return {
    ...item,
    typeLabel: notificationTypeLabel(type),
    href,
    resolvedHref: resolveNoticeHref({ ...item, href }, appRoot),
    when: item.when || formatWhen(item.createdAt, now),
    priority: item.priority || notificationPriority(type),
    isEmergency: (item.priority || notificationPriority(type)) === NOTIFICATION_PRIORITY.EMERGENCY
      || type === "emergency_alert",
  };
}

export async function getNotificationFeed(session = getSession(), { appRoot = "", now = new Date() } = {}) {
  const [items, prefs] = await Promise.all([
    listNotifications(session),
    getNotificationPreferences(session),
  ]);
  return items
    .filter((item) => inAppAllowedForType(prefs, item.type))
    .map((item) => enrichNotice(item, { appRoot, now }))
    .sort((a, b) => Number(a.read) - Number(b.read) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function unreadCount(session = getSession()) {
  const [items, prefs] = await Promise.all([
    listNotifications(session),
    getNotificationPreferences(session),
  ]);
  return items.filter((item) => !item.read && inAppAllowedForType(prefs, item.type)).length;
}

export async function markRead(id, read = true) {
  return markNotificationRead(id, read);
}

export async function markAllRead(session = getSession()) {
  return markAllNotificationsRead(session);
}

export function watchNotificationFeed(handler, session = getSession(), { appRoot = "" } = {}) {
  return subscribeNotificationFeed(async (items) => {
    const prefs = await getNotificationPreferences(session);
    const feed = items
      .filter((item) => inAppAllowedForType(prefs, item.type))
      .map((item) => enrichNotice(item, { appRoot }));
    handler(feed);
  }, session);
}

export { countUnread };
