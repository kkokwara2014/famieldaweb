import {
  AUTH,
  CIRCLE_STATUS,
  CONVERSATION_TYPES,
  NOTIFICATION_TYPES,
  ROLES,
} from "../config/constants.js";
import {
  authorizedContacts,
  canMessageDirect,
  canPostToCircle,
  circlePairKey,
  contactGroupLabel,
  contactRoleLabel,
  conversationParticipantIds,
  conversationParticipantKeys,
  findActorMember,
  findMemberByKey,
  groupedContacts,
  isActiveMember,
  isUnreadConversation,
  normalizeMessageBody,
  otherParticipantKey,
  pairKeyFor,
  participantKey,
  sessionParticipantKey,
  truncateMessage,
  unauthorizedMessageError,
} from "../config/messaging.js";
import { createConversation } from "../models/conversation.js";
import { createMessage } from "../models/message.js";
import { mockConversations, mockMessages } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { getQueryDocs, queryPage } from "../core/query.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSession } from "../auth/session.js";
import { getSeniorForUser } from "./senior-service.js";
import { listCareCircle } from "./care-circle-service.js";
import { postNotification } from "./notification-service.js";
import { formatWhen } from "../scheduling/time.js";

const CONVERSATIONS_KEY = "conversations";
const MESSAGES_KEY = "senior-hub-messages";

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function conversationFrom(data) {
  return createConversation({
    ...data,
    lastMessageAt: toIso(data.lastMessageAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    readAtBy: normalizeReadMap(data.readAtBy),
  });
}

function messageFrom(data) {
  return createMessage({
    ...data,
    createdAt: toIso(data.createdAt) || nowIso(),
  });
}

function normalizeReadMap(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, stamp]) => [key, toIso(stamp) || stamp]),
  );
}

function toDoc(record) {
  const { id: _id, ...rest } = record;
  return rest;
}

function seedMap(key, records) {
  const existing = storage.get(key, null);
  let map = {};
  if (Array.isArray(existing)) {
    map = Object.fromEntries(existing.filter((item) => item?.id).map((item) => [item.id, item]));
  } else if (existing && typeof existing === "object") {
    map = { ...existing };
  }
  let changed = Array.isArray(existing) || existing == null;
  for (const record of records) {
    if (!map[record.id]) {
      map[record.id] = record;
      changed = true;
    }
  }
  if (changed) storage.set(key, map);
  return map;
}

function migrateLegacyMessages(map) {
  let changed = false;
  for (const [id, item] of Object.entries(map)) {
    if (item?.conversationId) continue;
    delete map[id];
    changed = true;
  }
  return changed;
}

function seedLocal() {
  seedMap(CONVERSATIONS_KEY, mockConversations);
  const messages = seedMap(MESSAGES_KEY, mockMessages);
  if (migrateLegacyMessages(messages)) storage.set(MESSAGES_KEY, messages);
}

function readLocalMap(key) {
  seedLocal();
  return storage.get(key, {}) ?? {};
}

function writeLocalRecord(key, record) {
  const map = readLocalMap(key);
  map[record.id] = record;
  storage.set(key, map);
  return record;
}

function localConversations(filter = {}) {
  return Object.values(readLocalMap(CONVERSATIONS_KEY))
    .map((item) => conversationFrom(item))
    .filter((item) => {
      if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
      if (filter.pairKey && item.pairKey !== filter.pairKey) return false;
      if (filter.participantKey && !(item.participantKeys || []).includes(filter.participantKey) && item.type !== CONVERSATION_TYPES.CIRCLE) {
        return false;
      }
      return true;
    });
}

function localMessages(filter = {}) {
  return Object.values(readLocalMap(MESSAGES_KEY))
    .map((item) => messageFrom(item))
    .filter((item) => {
      if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
      if (filter.conversationId && item.conversationId !== filter.conversationId) return false;
      return true;
    });
}

async function collectionDocs(collection, constraints = [], options = {}) {
  return getQueryDocs(collection, constraints, { limit: QUERY_LIMITS.PAGE, ...options });
}

async function readConversations(filter = {}) {
  if (!usesLiveAuth()) return localConversations(filter);
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  if (filter.pairKey) constraints.push(sdk.where("pairKey", "==", filter.pairKey));
  if (filter.participantKey && !filter.pairKey) {
    constraints.push(sdk.where("participantKeys", "array-contains", filter.participantKey));
  }
  const docs = await collectionDocs(AUTH.CONVERSATIONS_COLLECTION, constraints, { limit: QUERY_LIMITS.WORKSPACE });
  return docs.map((item) => conversationFrom(item)).filter((item) => {
    if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
    if (filter.pairKey && item.pairKey !== filter.pairKey) return false;
    return true;
  });
}

async function readConversationById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) return localConversations().find((item) => item.id === id) ?? null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.CONVERSATIONS_COLLECTION, id));
  if (!snap.exists()) return null;
  return conversationFrom({ id: snap.id, ...snap.data() });
}

async function readMessages(filter = {}) {
  if (!usesLiveAuth()) {
    const items = localMessages(filter).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const limit = filter.limit ?? QUERY_LIMITS.PAGE;
    return { items: items.slice(-limit), hasMore: items.length > limit };
  }
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.conversationId) constraints.push(sdk.where("conversationId", "==", filter.conversationId));
  else if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  const limit = filter.limit ?? QUERY_LIMITS.PAGE;
  try {
    const page = await queryPage(AUTH.MESSAGES_COLLECTION, [
      ...constraints,
      sdk.orderBy("createdAt", "desc"),
    ], { limit, startAfter: filter.startAfter, cache: false });
    const items = page.items.map((item) => messageFrom(item)).reverse();
    return { items, hasMore: page.hasMore, lastDoc: page.lastDoc };
  } catch {
    const docs = await collectionDocs(AUTH.MESSAGES_COLLECTION, constraints, { limit });
    const items = docs.map((item) => messageFrom(item)).filter((item) => {
      if (filter.conversationId && item.conversationId !== filter.conversationId) return false;
      if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
      return true;
    }).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return { items, hasMore: items.length >= limit };
  }
}

async function saveConversationRecord(conversation) {
  const record = conversationFrom({ ...conversation, updatedAt: nowIso() });
  if (!usesLiveAuth()) return conversationFrom(writeLocalRecord(CONVERSATIONS_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.CONVERSATIONS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.CONVERSATIONS_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = { ...payload, updatedAt: sdk.serverTimestamp() };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return conversationFrom({ ...record, id: ref.id });
}

async function saveMessageRecord(message) {
  const record = messageFrom(message);
  if (!usesLiveAuth()) return messageFrom(writeLocalRecord(MESSAGES_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.MESSAGES_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.MESSAGES_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = { ...payload };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return messageFrom({ ...record, id: ref.id });
}

async function loadContext(session = getSession()) {
  if (!session) throw new Error("Sign in to send a message.");
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("A senior record is needed before anyone can message.");
  const members = (await listCareCircle(senior.id)).filter(isActiveMember);
  const actor = findActorMember(members, session, senior);
  if (!actor && session.role !== ROLES.ADMIN) {
    throw new Error(unauthorizedMessageError());
  }
  return {
    session,
    senior,
    members,
    actor: actor || {
      id: "admin",
      userId: session.id,
      name: session.displayName,
      email: session.email,
      kind: "family",
      status: CIRCLE_STATUS.ACTIVE,
      seniorId: senior.id,
      role: session.role,
    },
    sessionKey: sessionParticipantKey(session),
  };
}

function circleTitle(senior) {
  const name = senior?.preferredName || senior?.displayName || "this household";
  return `Everyone around ${name}`;
}

function directTitle(other) {
  return other?.name || "Care circle";
}

async function ensureCircleConversation(ctx) {
  const pairKey = circlePairKey(ctx.senior.id);
  const existing = (await readConversations({ seniorId: ctx.senior.id, pairKey }))[0]
    ?? (await readConversations({ seniorId: ctx.senior.id })).find((item) => item.type === CONVERSATION_TYPES.CIRCLE);
  const participantKeys = conversationParticipantKeys(ctx.members);
  const participantIds = conversationParticipantIds(ctx.members);
  const memberIds = ctx.members.map((member) => member.id);
  if (existing) {
    const sameKeys = existing.participantKeys.slice().sort().join("|") === participantKeys.slice().sort().join("|");
    if (sameKeys) return existing;
    return saveConversationRecord({
      ...existing,
      participantKeys,
      participantIds,
      memberIds,
      title: existing.title || circleTitle(ctx.senior),
    });
  }
  return saveConversationRecord(createConversation({
    id: usesLiveAuth() ? "" : `conv-circle-${ctx.senior.id}`,
    seniorId: ctx.senior.id,
    type: CONVERSATION_TYPES.CIRCLE,
    pairKey,
    participantKeys,
    participantIds,
    memberIds,
    title: circleTitle(ctx.senior),
    createdAt: nowIso(),
    createdBy: ctx.session.id,
  }));
}

async function ensureDirectConversation(ctx, other) {
  if (!canMessageDirect(ctx.actor, other, ctx.session)) {
    throw new Error(unauthorizedMessageError(ctx.actor, other));
  }
  if (usesLiveAuth() && !other.userId) {
    throw new Error("That person needs to join Famielda before you can message them privately.");
  }
  const keys = [ctx.sessionKey, participantKey(other)].filter(Boolean).sort();
  const pairKey = pairKeyFor(ctx.senior.id, keys[0], keys[1]);
  const existing = (await readConversations({ seniorId: ctx.senior.id, pairKey }))[0];
  if (existing) return existing;
  const pair = [ctx.actor, other];
  return saveConversationRecord(createConversation({
    id: usesLiveAuth() ? "" : newId("conv"),
    seniorId: ctx.senior.id,
    type: CONVERSATION_TYPES.DIRECT,
    pairKey,
    participantKeys: keys,
    participantIds: conversationParticipantIds(pair),
    memberIds: pair.map((member) => member.id).filter(Boolean),
    title: directTitle(other),
    createdAt: nowIso(),
    createdBy: ctx.session.id,
  }));
}

function canSeeConversation(conversation, ctx) {
  if (!conversation || conversation.seniorId !== ctx.senior.id) return false;
  if (ctx.session.role === ROLES.ADMIN) return true;
  if (conversation.type === CONVERSATION_TYPES.CIRCLE) return Boolean(ctx.actor);
  return (conversation.participantKeys || []).includes(ctx.sessionKey);
}

function mapContact(member, session) {
  return {
    id: member.id,
    userId: member.userId || "",
    name: member.name,
    email: member.email,
    kind: member.kind,
    professionalType: member.professionalType,
    relationship: member.relationship,
    photoURL: member.photoURL || null,
    group: contactGroupLabel(member),
    roleLabel: contactRoleLabel(member, session?.role),
    availability: member.availability || "",
  };
}

function mapConversation(conversation, ctx, now) {
  const sessionKey = ctx.sessionKey;
  const otherKey = otherParticipantKey(conversation, sessionKey);
  const other = conversation.type === CONVERSATION_TYPES.DIRECT
    ? findMemberByKey(ctx.members, otherKey)
    : null;
  const unread = isUnreadConversation(conversation, sessionKey);
  const title = conversation.type === CONVERSATION_TYPES.CIRCLE
    ? (conversation.title || circleTitle(ctx.senior))
    : (other?.name || conversation.title || "Care circle");
  return {
    ...conversation,
    title,
    subtitle: conversation.type === CONVERSATION_TYPES.CIRCLE
      ? "Everyone on this household"
      : (other ? contactRoleLabel(other, ctx.session.role) : "Direct message"),
    preview: truncateMessage(conversation.lastMessageBody) || "No messages yet",
    when: conversation.lastMessageAt ? formatWhen(conversation.lastMessageAt, now) : "",
    unread,
    otherId: other?.id || "",
    otherName: other?.name || title,
    photoURL: other?.photoURL || null,
    isCircle: conversation.type === CONVERSATION_TYPES.CIRCLE,
    isMine: conversation.lastAuthorKey === sessionKey,
  };
}

function mapMessageView(item, ctx, now) {
  const mine = item.authorKey === ctx.sessionKey || (item.authorId && item.authorId === ctx.session.id);
  return {
    ...item,
    author: item.authorName || item.author,
    when: formatWhen(item.createdAt, now),
    mine,
  };
}

async function notifyRecipient(conversation, message, ctx) {
  if (conversation.type !== CONVERSATION_TYPES.DIRECT) return;
  const otherKey = otherParticipantKey(conversation, ctx.sessionKey);
  const other = findMemberByKey(ctx.members, otherKey);
  try {
    await postNotification({
      type: NOTIFICATION_TYPES.MESSAGE,
      title: `${message.authorName} sent a message`,
      body: truncateMessage(message.body, 120),
      userId: other?.userId || "",
      email: other?.email || "",
      seniorId: ctx.senior.id,
      conversationId: conversation.id,
    });
  } catch {
    // Notifications are best-effort.
  }
}

export async function getMessagingWorkspace(seniorOrId = null, session = getSession(), now = new Date()) {
  const ctx = await loadContext(session);
  if (seniorOrId) {
    const requestedId = typeof seniorOrId === "string" ? seniorOrId : seniorOrId.id;
    if (requestedId && requestedId !== ctx.senior.id && session.role !== ROLES.ADMIN) {
      throw new Error(unauthorizedMessageError());
    }
  }
  const circle = await ensureCircleConversation(ctx);
  const listed = await readConversations({ seniorId: ctx.senior.id });
  const byId = new Map(listed.map((item) => [item.id, item]));
  if (!byId.has(circle.id)) byId.set(circle.id, circle);
  const visible = [...byId.values()]
    .filter((item) => canSeeConversation(item, ctx))
    .map((item) => mapConversation(item, ctx, now))
    .sort((a, b) => {
      if (a.isCircle !== b.isCircle) return a.isCircle ? -1 : 1;
      return String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || ""));
    });
  const contacts = authorizedContacts(ctx.members, ctx.actor, ctx.session).map((member) => mapContact(member, ctx.session));
  const unread = visible.filter((item) => item.unread).length;
  return {
    senior: ctx.senior,
    actor: ctx.actor,
    sessionKey: ctx.sessionKey,
    canPostCircle: canPostToCircle(ctx.actor, ctx.session),
    conversations: visible,
    contacts,
    contactGroups: groupedContacts(authorizedContacts(ctx.members, ctx.actor, ctx.session)).map((group) => ({
      id: group.id,
      label: group.label,
      items: group.items.map((member) => mapContact(member, ctx.session)),
    })),
    counts: {
      conversations: visible.length,
      unread,
      contacts: contacts.length,
    },
  };
}

export async function getConversationThread(conversationId, session = getSession(), now = new Date(), options = {}) {
  const ctx = await loadContext(session);
  const conversation = await readConversationById(conversationId);
  if (!conversation || !canSeeConversation(conversation, ctx)) {
    throw new Error("You cannot open that conversation.");
  }
  const page = await readMessages({
    conversationId: conversation.id,
    limit: options.limit ?? QUERY_LIMITS.PAGE,
    startAfter: options.startAfter,
  });
  const messages = page.items.map((item) => mapMessageView(item, ctx, now));
  return {
    conversation: mapConversation(conversation, ctx, now),
    messages,
    hasMore: Boolean(page.hasMore),
    cursor: page.lastDoc || null,
    canPost: conversation.type === CONVERSATION_TYPES.CIRCLE
      ? canPostToCircle(ctx.actor, ctx.session)
      : true,
  };
}

export async function markConversationRead(conversationId, session = getSession()) {
  const ctx = await loadContext(session);
  const conversation = await readConversationById(conversationId);
  if (!conversation || !canSeeConversation(conversation, ctx)) return null;
  const readAtBy = { ...(conversation.readAtBy || {}), [ctx.sessionKey]: nowIso() };
  return saveConversationRecord({ ...conversation, readAtBy });
}

export async function openDirectConversation(memberId, session = getSession()) {
  const ctx = await loadContext(session);
  const other = ctx.members.find((member) => member.id === memberId);
  if (!other) throw new Error("That person is not on this care circle.");
  const conversation = await ensureDirectConversation(ctx, other);
  await markConversationRead(conversation.id, session);
  return conversation;
}

export async function sendConversationMessage(input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  const body = normalizeMessageBody(input.body);
  let conversation = null;

  if (input.conversationId) {
    conversation = await readConversationById(input.conversationId);
    if (!conversation || !canSeeConversation(conversation, ctx)) {
      throw new Error("You cannot send a message in that conversation.");
    }
    if (conversation.type === CONVERSATION_TYPES.DIRECT) {
      const other = findMemberByKey(ctx.members, otherParticipantKey(conversation, ctx.sessionKey));
      if (!canMessageDirect(ctx.actor, other, ctx.session)) {
        throw new Error(unauthorizedMessageError(ctx.actor, other));
      }
    } else if (!canPostToCircle(ctx.actor, ctx.session)) {
      throw new Error("You need permission to message this circle.");
    }
  } else if (input.memberId) {
    const other = ctx.members.find((member) => member.id === input.memberId);
    if (!other) throw new Error("That person is not on this care circle.");
    conversation = await ensureDirectConversation(ctx, other);
  } else {
    conversation = await ensureCircleConversation(ctx);
    if (!canPostToCircle(ctx.actor, ctx.session)) {
      throw new Error("You need permission to message this circle.");
    }
  }

  const now = nowIso();
  const message = await saveMessageRecord(createMessage({
    id: usesLiveAuth() ? "" : newId("msg"),
    conversationId: conversation.id,
    seniorId: ctx.senior.id,
    type: conversation.type,
    authorId: ctx.session.id,
    authorKey: ctx.sessionKey,
    author: ctx.session.displayName || ctx.actor.name,
    authorName: ctx.session.displayName || ctx.actor.name,
    role: ctx.session.role || ctx.actor.kind,
    authorKind: ctx.actor.kind,
    body,
    participantKeys: conversation.participantKeys,
    participantIds: conversation.participantIds,
    createdAt: now,
  }));

  await saveConversationRecord({
    ...conversation,
    lastMessageAt: now,
    lastMessageBody: body,
    lastAuthorId: ctx.session.id,
    lastAuthorKey: ctx.sessionKey,
    lastAuthorName: message.authorName,
    readAtBy: { ...(conversation.readAtBy || {}), [ctx.sessionKey]: now },
  });

  await notifyRecipient(conversation, message, ctx);
  return message;
}

export async function listMessages(seniorId) {
  const session = getSession();
  if (!seniorId) return [];
  try {
    const ctx = await loadContext(session);
    if (ctx.senior.id !== seniorId && session.role !== ROLES.ADMIN) return [];
    const circle = (await readConversations({ seniorId, pairKey: circlePairKey(seniorId) }))[0]
      ?? (await readConversations({ seniorId })).find((item) => item.type === CONVERSATION_TYPES.CIRCLE);
    if (!circle) return [];
    return (await readMessages({ conversationId: circle.id, limit: QUERY_LIMITS.PAGE })).items
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  } catch {
    return [];
  }
}

export async function postMessage(seniorId, body, session = getSession()) {
  if (seniorId) {
    const senior = await getSeniorForUser(session);
    if (senior && senior.id !== seniorId && session.role !== ROLES.ADMIN) {
      throw new Error(unauthorizedMessageError());
    }
  }
  return sendConversationMessage({ body }, session);
}

export async function unreadMessageCount(session = getSession()) {
  try {
    const workspace = await getMessagingWorkspace(null, session);
    return workspace.counts.unread;
  } catch {
    return 0;
  }
}
