import { CONVERSATION_TYPES } from "../config/constants.js";

export function createMessage(data = {}) {
  const authorId = data.authorId ?? data.senderId ?? "";
  const authorName = data.authorName ?? data.author ?? data.senderName ?? "";
  const body = data.body ?? data.text ?? "";
  return {
    id: data.id ?? "",
    conversationId: data.conversationId ?? "",
    seniorId: data.seniorId ?? "",
    familyId: data.familyId ?? "",
    type: data.type ?? CONVERSATION_TYPES.CIRCLE,
    // Mobile-canonical fields (the mobile app reads these names).
    senderId: data.senderId ?? authorId,
    senderName: data.senderName ?? authorName,
    text: data.text ?? body,
    messageType: data.messageType ?? "text",
    readBy: data.readBy && typeof data.readBy === "object" ? { ...data.readBy } : {},
    ...(data.attachment ? { attachment: data.attachment } : {}),
    // Web fields (kept; derived from the canonical ones above).
    authorId,
    authorKey: data.authorKey ?? authorId,
    author: data.author ?? authorName,
    authorName,
    role: data.role ?? "family",
    authorKind: data.authorKind ?? data.role ?? "",
    body,
    participantKeys: Array.isArray(data.participantKeys) ? [...data.participantKeys] : [],
    participantIds: Array.isArray(data.participantIds) ? [...data.participantIds] : [],
    createdAt: data.createdAt ?? new Date().toISOString(),
  };
}
