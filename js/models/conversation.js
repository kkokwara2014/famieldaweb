import { CONVERSATION_TYPES } from "../config/constants.js";

export function createConversation(data = {}) {
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    type: data.type ?? CONVERSATION_TYPES.DIRECT,
    pairKey: data.pairKey ?? "",
    participantKeys: Array.isArray(data.participantKeys) ? [...data.participantKeys] : [],
    participantIds: Array.isArray(data.participantIds) ? [...data.participantIds] : [],
    memberIds: Array.isArray(data.memberIds) ? [...data.memberIds] : [],
    title: data.title ?? "",
    lastMessageAt: data.lastMessageAt ?? null,
    lastMessageBody: data.lastMessageBody ?? "",
    lastAuthorId: data.lastAuthorId ?? "",
    lastAuthorKey: data.lastAuthorKey ?? data.lastAuthorId ?? "",
    lastAuthorName: data.lastAuthorName ?? "",
    readAtBy: data.readAtBy && typeof data.readAtBy === "object" ? { ...data.readAtBy } : {},
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    createdBy: data.createdBy ?? "",
  };
}
