import { CONVERSATION_TYPES } from "../config/constants.js";

export function createMessage(data = {}) {
  return {
    id: data.id ?? "",
    conversationId: data.conversationId ?? "",
    seniorId: data.seniorId ?? "",
    type: data.type ?? CONVERSATION_TYPES.CIRCLE,
    authorId: data.authorId ?? "",
    authorKey: data.authorKey ?? data.authorId ?? "",
    author: data.author ?? data.authorName ?? "",
    authorName: data.authorName ?? data.author ?? "",
    role: data.role ?? "family",
    authorKind: data.authorKind ?? data.role ?? "",
    body: data.body ?? "",
    participantKeys: Array.isArray(data.participantKeys) ? [...data.participantKeys] : [],
    participantIds: Array.isArray(data.participantIds) ? [...data.participantIds] : [],
    createdAt: data.createdAt ?? new Date().toISOString(),
  };
}
