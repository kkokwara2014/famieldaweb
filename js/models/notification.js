import { NOTIFICATION_PRIORITY, NOTIFICATION_TYPES } from "../config/constants.js";
import {
  defaultNotificationPrefs,
  noticeHref,
  notificationPriority,
  normalizeNotificationPrefs,
} from "../config/notifications.js";

export function createNotification(data = {}) {
  const type = data.type ?? NOTIFICATION_TYPES.SYSTEM;
  const href = data.href || noticeHref(type, data);
  return {
    id: data.id ?? "",
    type,
    title: data.title ?? "",
    body: data.body ?? "",
    createdAt: data.createdAt ?? new Date().toISOString(),
    read: Boolean(data.read),
    readAt: data.readAt ?? null,
    userId: data.userId ?? "",
    email: data.email ?? "",
    seniorId: data.seniorId ?? "",
    href,
    actorId: data.actorId ?? "",
    actorName: data.actorName ?? "",
    entityType: data.entityType ?? "",
    entityId: data.entityId || data.visitId || data.inviteId || data.taskId || data.appointmentId || data.medicationId || data.conversationId || "",
    visitId: data.visitId ?? "",
    inviteId: data.inviteId ?? "",
    inviteToken: data.inviteToken ?? "",
    taskId: data.taskId ?? "",
    appointmentId: data.appointmentId ?? "",
    medicationId: data.medicationId ?? "",
    conversationId: data.conversationId ?? "",
    priority: data.priority || notificationPriority(type),
    channel: data.channel ?? "all",
  };
}

export function createNotificationPrefs(data = {}) {
  return normalizeNotificationPrefs(data);
}

export { defaultNotificationPrefs, NOTIFICATION_PRIORITY };
