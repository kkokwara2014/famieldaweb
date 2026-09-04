import { SUPPORT_PRIORITY, SUPPORT_STATUS } from "../config/constants.js";

export function createSupportTicket(data = {}) {
  return {
    id: data.id ?? "",
    userId: data.userId ?? "",
    userName: data.userName ?? "",
    email: data.email ?? "",
    subject: data.subject ?? "",
    body: data.body ?? "",
    category: data.category ?? "general",
    kind: data.kind ?? "contact",
    priority: data.priority ?? SUPPORT_PRIORITY.NORMAL,
    status: data.status ?? SUPPORT_STATUS.OPEN,
    pageUrl: data.pageUrl ?? "",
    userAgent: data.userAgent ?? "",
    source: data.source ?? "",
    audience: data.audience ?? "",
    replies: Array.isArray(data.replies) ? data.replies.map(createSupportReply) : [],
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    resolvedAt: data.resolvedAt ?? null,
    resolvedBy: data.resolvedBy ?? null,
  };
}

export function createSupportReply(data = {}) {
  return {
    id: data.id ?? "",
    authorId: data.authorId ?? "",
    authorName: data.authorName ?? "",
    body: data.body ?? "",
    internal: Boolean(data.internal),
    createdAt: data.createdAt ?? null,
  };
}
