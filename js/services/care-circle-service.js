import {
  AUTH,
  CARE_CIRCLE_ROLES,
  CIRCLE_KINDS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  INVITE_STATUS,
  NOTIFICATION_TYPES,
  ROLES,
} from "../config/constants.js";
import {
  defaultProfessionalType,
  defaultRelationship,
  hasPermission,
  permissionsForRole,
  professionalRoleForKind,
} from "../config/care-circle.js";
import {
  assertCanInviteKind,
  assertCanJoinAnotherFamily,
  circleUsage,
  resolveHouseholdPlan,
} from "./entitlement-service.js";
import { createCareCircleInvite, createCareCircleMember } from "../models/care-circle.js";
import { mockCircle, mockInvites } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { getQueryDocs } from "../core/query.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSession, setSession } from "../auth/session.js";
import { updateMockUser } from "../auth/auth-service.js";
import { updateUserProfile } from "../auth/user-profile.js";
import { getSeniorById, getSeniorForUser, linkSeniorToUser, updateSeniorProfile } from "./senior-service.js";
import { getCurrentPlan } from "./subscription-service.js";
import { isValidProfessionalType } from "../config/roles.js";
import { invitationTypeForKind } from "../config/notifications.js";
import { notifyQuietly } from "./notification-service.js";
import { withVerificationStatus } from "./verification-service.js";
import { callCloudFunction } from "../core/functions.js";
import { PRODUCT_EVENTS, trackInviteSent, trackProductEvent } from "./analytics-service.js";
import { inviteEventName } from "../config/analytics.js";

const MEMBERS_KEY = "careCircleMembers";
const INVITES_KEY = "careCircleInvites";

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function newToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return newId("tok");
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function memberFrom(data) {
  return createCareCircleMember({
    ...data,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    invitedAt: toIso(data.invitedAt),
    respondedAt: toIso(data.respondedAt),
    lastSeenAt: toIso(data.lastSeenAt),
  });
}

function inviteFrom(data) {
  return createCareCircleInvite({
    ...data,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    respondedAt: toIso(data.respondedAt),
  });
}

function toDoc(record) {
  const { id: _id, ...rest } = record;
  return rest;
}

function seedMap(key, records) {
  const map = storage.get(key, null) ?? {};
  let changed = false;
  for (const record of records) {
    if (!map[record.id]) {
      map[record.id] = record;
      changed = true;
    }
  }
  if (changed) storage.set(key, map);
  return map;
}

function seedLocal() {
  seedMap(MEMBERS_KEY, mockCircle);
  seedMap(INVITES_KEY, mockInvites);
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

function localMembers(seniorId) {
  return Object.values(readLocalMap(MEMBERS_KEY))
    .map((item) => memberFrom(item))
    .filter((item) => !seniorId || item.seniorId === seniorId);
}

function localInvites({ seniorId, email, token } = {}) {
  return Object.values(readLocalMap(INVITES_KEY))
    .map((item) => inviteFrom(item))
    .filter((item) => {
      if (seniorId && item.seniorId !== seniorId) return false;
      if (email && !emailsEqual(item.email, email)) return false;
      if (token && item.token !== token) return false;
      return true;
    });
}

async function collectionDocs(collection, constraints = [], options = {}) {
  return getQueryDocs(collection, constraints, { limit: QUERY_LIMITS.WORKSPACE, ...options });
}

async function readMembers(seniorId) {
  if (!usesLiveAuth()) return localMembers(seniorId);

  const sdk = getFirestoreSdk();
  const docs = await collectionDocs(AUTH.CIRCLE_COLLECTION, [
    sdk.where("seniorId", "==", seniorId),
  ]);
  return docs.map((item) => memberFrom(item));
}

async function readInvites(filter = {}) {
  if (!usesLiveAuth()) return localInvites(filter);

  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  else if (filter.email) constraints.push(sdk.where("email", "==", String(filter.email).trim().toLowerCase()));
  else if (filter.token) constraints.push(sdk.where("token", "==", filter.token));
  const docs = await collectionDocs(AUTH.CIRCLE_INVITES_COLLECTION, constraints);
  return docs
    .map((item) => inviteFrom(item))
    .filter((item) => {
      if (filter.email && !emailsEqual(item.email, filter.email)) return false;
      if (filter.token && item.token !== filter.token) return false;
      return true;
    });
}

async function saveMember(member) {
  const record = memberFrom({ ...member, updatedAt: nowIso() });
  if (!usesLiveAuth()) return memberFrom(writeLocalRecord(MEMBERS_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.CIRCLE_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.CIRCLE_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = {
    ...payload,
    updatedAt: sdk.serverTimestamp(),
  };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return memberFrom({ ...record, id: ref.id });
}

async function saveInvite(invite) {
  const record = inviteFrom({ ...invite, updatedAt: nowIso() });
  if (!usesLiveAuth()) return inviteFrom(writeLocalRecord(INVITES_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.CIRCLE_INVITES_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.CIRCLE_INVITES_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id, email: String(record.email).trim().toLowerCase() });
  const data = {
    ...payload,
    updatedAt: sdk.serverTimestamp(),
  };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return inviteFrom({ ...record, id: ref.id });
}

async function liveCircle(name, data) {
  return callCloudFunction(name, data);
}

function visibleMembers(members) {
  return members.filter((member) => member.status !== CIRCLE_STATUS.REMOVED);
}

function findActor(members, session, senior) {
  if (!session) return null;
  return members.find((member) => (
    member.status !== CIRCLE_STATUS.REMOVED
    && (member.userId === session.id || emailsEqual(member.email, session.email))
  )) ?? (senior?.ownerId === session.id
    ? members.find((member) => member.role === CARE_CIRCLE_ROLES.OWNER)
    : null);
}

function isHouseholdAdmin(session, senior) {
  if (!session) return false;
  if (session.role === ROLES.ADMIN) return true;
  return Boolean(senior && senior.ownerId === session.id);
}

function canInvite(actor, session, senior) {
  if (isHouseholdAdmin(session, senior)) return true;
  return hasPermission(actor, CIRCLE_PERMISSIONS.INVITE_MEMBERS);
}

function canManage(actor, session, senior) {
  if (isHouseholdAdmin(session, senior)) return true;
  return hasPermission(actor, CIRCLE_PERMISSIONS.MANAGE_MEMBERS);
}

function assertCanInvite(actor, session, senior) {
  if (!canInvite(actor, session, senior)) {
    throw new Error("You need invite permission to add people to this circle.");
  }
}

function assertCanManage(actor, session, senior) {
  if (!canManage(actor, session, senior)) {
    throw new Error("You need permission to change this circle.");
  }
}

async function addMemberId(senior, userId) {
  if (!senior?.id || !userId) return senior;
  if (senior.memberIds.includes(userId)) return senior;
  return updateSeniorProfile(senior.id, {
    memberIds: [...new Set([...senior.memberIds, userId])],
  });
}

async function dropMemberId(senior, userId) {
  if (!senior?.id || !userId) return senior;
  if (!senior.memberIds.includes(userId)) return senior;
  return updateSeniorProfile(senior.id, {
    memberIds: senior.memberIds.filter((id) => id !== userId),
  });
}

async function householdPlanId(senior, session) {
  return resolveHouseholdPlan({ session, senior });
}

async function attachSenior(session, seniorId) {
  if (!session?.id || session.seniorId === seniorId) return session;
  if (usesLiveAuth()) {
    await updateUserProfile(session.id, { seniorId });
  } else {
    updateMockUser({ ...session, seniorId });
  }
  return setSession({ ...session, seniorId }) ?? session;
}

function normalizeInviteInput(input = {}) {
  const kind = Object.values(CIRCLE_KINDS).includes(input.kind) ? input.kind : CIRCLE_KINDS.FAMILY;
  const role = [CARE_CIRCLE_ROLES.COORDINATOR, CARE_CIRCLE_ROLES.MEMBER, CARE_CIRCLE_ROLES.VIEWER]
    .includes(input.role)
    ? input.role
    : CARE_CIRCLE_ROLES.MEMBER;
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const relationship = String(input.relationship || "").trim() || defaultRelationship(kind);
  const professionalRole = professionalRoleForKind(kind);
  let professionalType = input.professionalType || null;

  if (!name) throw new Error("Enter their name.");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");

  if (professionalRole) {
    professionalType = professionalType || defaultProfessionalType(kind);
    if (!isValidProfessionalType(professionalRole, professionalType)) {
      throw new Error("Choose a professional type.");
    }
  } else {
    professionalType = null;
  }

  const permissions = Array.isArray(input.permissions) && input.permissions.length
    ? input.permissions
    : permissionsForRole(role);

  return {
    kind,
    role,
    name,
    email,
    relationship,
    professionalType,
    permissions,
    message: String(input.message || "").trim(),
  };
}

export async function listCircleMembers(seniorId, { includePending = true } = {}) {
  if (!seniorId) return [];
  const members = visibleMembers(await readMembers(seniorId));
  if (includePending) {
    return members.filter((member) => member.status !== CIRCLE_STATUS.DECLINED);
  }
  return members.filter((member) => member.status === CIRCLE_STATUS.ACTIVE);
}

export async function listCareCircle(seniorId = getSession()?.seniorId) {
  return listCircleMembers(seniorId, { includePending: false });
}

export async function listCircleByKind(kind, seniorId = getSession()?.seniorId) {
  const members = await listCareCircle(seniorId);
  return members.filter((member) => member.kind === kind);
}

export async function listCaregivers(seniorId) {
  return listCircleByKind(CIRCLE_KINDS.CAREGIVER, seniorId);
}

export async function listPractitioners(seniorId) {
  return listCircleByKind(CIRCLE_KINDS.PRACTITIONER, seniorId);
}

export async function listIncomingInvites(session = getSession()) {
  if (!session?.email) return [];
  const invites = await readInvites({ email: session.email });
  return invites.filter((invite) => invite.status === INVITE_STATUS.PENDING);
}

export async function getInviteByToken(token) {
  if (!token) return null;
  const invites = await readInvites({ token });
  return invites[0] ?? null;
}

export async function ensureOwnerMembership(senior, session = getSession()) {
  if (!senior?.id || !session?.id) return null;
  if (senior.ownerId && senior.ownerId !== session.id && session.role !== ROLES.ADMIN) return null;

  const members = await readMembers(senior.id);
  const existing = members.find((member) => (
    member.role === CARE_CIRCLE_ROLES.OWNER && member.status !== CIRCLE_STATUS.REMOVED
  ));
  if (existing) return existing;

  const ownerSession = senior.ownerId === session.id ? session : null;
  if (!ownerSession) return null;

  const owner = await saveMember(createCareCircleMember({
    id: usesLiveAuth() ? "" : newId("m"),
    seniorId: senior.id,
    userId: ownerSession.id,
    name: ownerSession.displayName,
    email: ownerSession.email,
    role: CARE_CIRCLE_ROLES.OWNER,
    relationship: ownerSession.familyRelationship || "Family",
    kind: CIRCLE_KINDS.FAMILY,
    status: CIRCLE_STATUS.ACTIVE,
    permissions: permissionsForRole(CARE_CIRCLE_ROLES.OWNER),
    createdAt: nowIso(),
  }));
  await addMemberId(senior, ownerSession.id);
  return owner;
}

export async function getCareCircleState(session = getSession(), { inviteToken } = {}) {
  const incoming = await listIncomingInvites(session);
  const token = inviteToken || "";
  const tokenInvite = token
    ? incoming.find((item) => item.token === token) ?? await getInviteByToken(token)
    : null;
  if (tokenInvite && tokenInvite.status === INVITE_STATUS.PENDING && !incoming.some((item) => item.id === tokenInvite.id)) {
    if (emailsEqual(tokenInvite.email, session.email)) incoming.unshift(tokenInvite);
  }

  const senior = await getSeniorForUser(session);
  if (senior) await ensureOwnerMembership(senior, session);

  const members = senior ? visibleMembers(await readMembers(senior.id)) : [];
  const invites = senior
    ? (await readInvites({ seniorId: senior.id }))
      .filter((invite) => invite.status !== INVITE_STATUS.ACCEPTED)
    : [];
  const actor = findActor(members, session, senior);
  const planId = await householdPlanId(senior, session);
  const plan = await getCurrentPlan({ ...session, plan: planId });
  const usage = circleUsage({ planId, members });
  const limits = {
    maxMembers: usage.max,
    maxFamilyMembers: usage.family.max,
    maxCaregivers: usage.caregivers.max,
    maxPractitioners: usage.practitioners.max,
  };

  const visible = await withVerificationStatus(members.filter((member) => member.status !== CIRCLE_STATUS.DECLINED));
  const declined = await withVerificationStatus(members.filter((member) => member.status === CIRCLE_STATUS.DECLINED));

  return {
    session,
    senior,
    members: visible,
    declined,
    invites,
    incoming,
    actor,
    plan,
    limits,
    usage,
    canInvite: Boolean(senior) && canInvite(actor, session, senior),
    canManage: Boolean(senior) && canManage(actor, session, senior),
    isOwner: Boolean(senior && (senior.ownerId === session.id || actor?.role === CARE_CIRCLE_ROLES.OWNER)),
  };
}

export async function inviteCareCircleMember(input, session = getSession()) {
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("Create a senior profile before inviting the circle.");

  const members = visibleMembers(await readMembers(senior.id));
  const actor = findActor(members, session, senior);
  assertCanInvite(actor, session, senior);

  const payload = normalizeInviteInput(input);
  const planId = await householdPlanId(senior, session);
  assertCanInviteKind(payload.kind, { session, senior, members, planId });

  if (emailsEqual(payload.email, session.email)) {
    throw new Error("You are already in this circle.");
  }

  const duplicate = members.find((member) => (
    emailsEqual(member.email, payload.email)
    && (member.status === CIRCLE_STATUS.ACTIVE || member.status === CIRCLE_STATUS.INVITED)
  ));
  if (duplicate) {
    throw new Error(`${duplicate.name || payload.email} is already in this circle.`);
  }

  if (usesLiveAuth()) {
    const result = await liveCircle("inviteCareCircleMember", {
      seniorId: senior.id,
      ...payload,
    });
    trackInviteSent(payload.kind, {
      dedupeKey: `${inviteEventName(payload.kind)}:${result.inviteId}`,
      inviteKind: payload.kind,
      inviteId: result.inviteId,
      seniorId: senior.id,
    }, session);
    return {
      member: { id: result.memberId, name: payload.name, email: payload.email, kind: payload.kind },
      invite: { id: result.inviteId, token: result.token },
    };
  }

  const now = nowIso();
  const member = await saveMember(createCareCircleMember({
    id: usesLiveAuth() ? "" : newId("m"),
    seniorId: senior.id,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    relationship: payload.relationship,
    kind: payload.kind,
    professionalType: payload.professionalType,
    permissions: payload.permissions,
    status: CIRCLE_STATUS.INVITED,
    invitedBy: session.id,
    invitedAt: now,
    notes: payload.message,
    createdAt: now,
  }));

  const invite = await saveInvite(createCareCircleInvite({
    id: usesLiveAuth() ? "" : newId("inv"),
    token: newToken(),
    seniorId: senior.id,
    seniorName: senior.displayName,
    email: payload.email,
    name: payload.name,
    kind: payload.kind,
    role: payload.role,
    relationship: payload.relationship,
    professionalType: payload.professionalType,
    permissions: payload.permissions,
    status: INVITE_STATUS.PENDING,
    invitedBy: session.id,
    invitedByName: session.displayName,
    memberId: member.id,
    message: payload.message,
    createdAt: now,
  }));

  await notifyQuietly([{ email: payload.email }], {
    type: invitationTypeForKind(payload.kind),
    title: `You’re invited to ${senior.displayName}’s circle`,
    body: `${session.displayName} invited you${payload.kind === "caregiver" ? " as a caregiver" : payload.kind === "practitioner" ? " as a health practitioner" : ""} to coordinate care.`,
    seniorId: senior.id,
    inviteId: invite.id,
    inviteToken: invite.token,
  }, session);

  trackInviteSent(payload.kind, {
    dedupeKey: `${inviteEventName(payload.kind)}:${invite.id}`,
    inviteKind: payload.kind,
    inviteId: invite.id,
    seniorId: senior.id,
  }, session);
  return { member, invite };
}

export async function resendInvitation(inviteId, session = getSession()) {
  if (usesLiveAuth()) {
    await liveCircle("resendCareCircleInvite", { inviteId });
    return true;
  }
  const state = await loadManagedInvite(inviteId, session);
  const now = nowIso();
  const invite = await saveInvite({ ...state.invite, status: INVITE_STATUS.PENDING, updatedAt: now });
  if (state.member) {
    await saveMember({
      ...state.member,
      status: CIRCLE_STATUS.INVITED,
      invitedAt: now,
      respondedAt: null,
    });
  }
  return invite;
}

export async function revokeInvitation(inviteId, session = getSession()) {
  if (usesLiveAuth()) {
    const senior = await getSeniorForUser(session);
    await liveCircle("revokeCareCircleInvite", { inviteId, seniorId: senior?.id });
    return true;
  }
  const state = await loadManagedInvite(inviteId, session);
  await saveInvite({
    ...state.invite,
    status: INVITE_STATUS.REVOKED,
    respondedAt: nowIso(),
  });
  if (state.member && state.member.status !== CIRCLE_STATUS.ACTIVE) {
    await saveMember({ ...state.member, status: CIRCLE_STATUS.REMOVED, respondedAt: nowIso() });
  }
  return true;
}

export async function acceptInvitation(inviteId, session = getSession()) {
  if (usesLiveAuth()) {
    const result = await liveCircle("acceptCareCircleInvite", { inviteId });
    if (result?.seniorId) await attachSenior(session, result.seniorId);
    trackProductEvent(PRODUCT_EVENTS.INVITATION_ACCEPTED, {
      dedupeKey: `invitation_accepted:${inviteId}`,
      inviteId,
      inviteKind: result?.kind || "",
      seniorId: result?.seniorId || "",
    }, session);
    return result;
  }
  const invite = await requireIncomingInvite(inviteId, session);
  const memberships = await listMembershipsForSession(session);
  assertCanJoinAnotherFamily({
    session,
    memberships,
    kind: invite.kind,
    seniorId: invite.seniorId,
  });

  const senior = await getSeniorById(invite.seniorId);
  if (!senior) throw new Error("That household is no longer available.");

  const members = visibleMembers(await readMembers(invite.seniorId));
  let member = members.find((item) => item.id === invite.memberId)
    ?? members.find((item) => emailsEqual(item.email, invite.email));

  const now = nowIso();
  if (member) {
    member = await saveMember({
      ...member,
      userId: session.id,
      name: session.displayName || member.name,
      email: session.email || member.email,
      status: CIRCLE_STATUS.ACTIVE,
      respondedAt: now,
      lastSeenAt: now,
    });
  } else {
    member = await saveMember(createCareCircleMember({
      id: usesLiveAuth() ? "" : newId("m"),
      seniorId: invite.seniorId,
      userId: session.id,
      name: session.displayName || invite.name,
      email: session.email || invite.email,
      role: invite.role,
      relationship: invite.relationship,
      kind: invite.kind,
      professionalType: invite.professionalType,
      permissions: invite.permissions,
      status: CIRCLE_STATUS.ACTIVE,
      invitedBy: invite.invitedBy,
      invitedAt: invite.createdAt,
      respondedAt: now,
      lastSeenAt: now,
      createdAt: now,
    }));
  }

  await saveInvite({
    ...invite,
    status: INVITE_STATUS.ACCEPTED,
    memberId: member.id,
    respondedAt: now,
  });
  await addMemberId(senior, session.id);
  await attachSenior(session, invite.seniorId);
  await notifyQuietly([{ userId: invite.invitedBy }], {
    type: NOTIFICATION_TYPES.INVITATION_ACCEPTED,
    title: `${session.displayName || member.name} accepted the invitation`,
    body: `${session.displayName || member.name} joined ${senior.displayName}’s circle.`,
    seniorId: invite.seniorId,
    inviteId: invite.id,
    inviteToken: invite.token,
  }, session);
  const others = members.filter((item) => (
    item.status === CIRCLE_STATUS.ACTIVE
    && item.userId
    && item.userId !== session.id
    && item.userId !== invite.invitedBy
  ));
  await notifyQuietly(others, {
    type: NOTIFICATION_TYPES.NEW_USER_JOINED,
    title: `${session.displayName || member.name} joined the household`,
    body: `${session.displayName || member.name} is now on ${senior.displayName}’s care circle.`,
    seniorId: invite.seniorId,
  }, session);
  trackProductEvent(PRODUCT_EVENTS.INVITATION_ACCEPTED, {
    dedupeKey: `invitation_accepted:${invite.id}`,
    inviteId: invite.id,
    inviteKind: invite.kind,
    seniorId: invite.seniorId,
  }, session);
  return member;
}

export async function declineInvitation(inviteId, session = getSession()) {
  if (usesLiveAuth()) {
    await liveCircle("declineCareCircleInvite", { inviteId });
    return true;
  }
  const invite = await requireIncomingInvite(inviteId, session);
  const now = nowIso();
  await saveInvite({ ...invite, status: INVITE_STATUS.DECLINED, respondedAt: now });

  const members = visibleMembers(await readMembers(invite.seniorId));
  const member = members.find((item) => item.id === invite.memberId)
    ?? members.find((item) => emailsEqual(item.email, invite.email));
  if (member && member.status !== CIRCLE_STATUS.ACTIVE) {
    await saveMember({ ...member, status: CIRCLE_STATUS.DECLINED, respondedAt: now });
  }
  await notifyQuietly([{ userId: invite.invitedBy }], {
    type: NOTIFICATION_TYPES.INVITATION_DECLINED,
    title: `${session.displayName || invite.name || invite.email} declined the invitation`,
    body: `${session.displayName || invite.name || "Someone"} declined to join ${invite.seniorName || "the circle"}.`,
    seniorId: invite.seniorId,
    inviteId: invite.id,
  }, session);
  return true;
}

export async function removeCircleMember(memberId, session = getSession()) {
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("No senior profile is linked to this account.");

  if (usesLiveAuth()) {
    await liveCircle("removeCareCircleMember", { seniorId: senior.id, memberId });
    return true;
  }

  const members = visibleMembers(await readMembers(senior.id));
  const actor = findActor(members, session, senior);
  assertCanManage(actor, session, senior);

  const member = members.find((item) => item.id === memberId);
  if (!member) throw new Error("That person is not in this circle.");
  if (member.role === CARE_CIRCLE_ROLES.OWNER) {
    throw new Error("The owner cannot be removed from the circle.");
  }
  if (member.userId === session.id) {
    throw new Error("Ask another coordinator to remove you, or decline an invitation before you join.");
  }

  await saveMember({ ...member, status: CIRCLE_STATUS.REMOVED, respondedAt: nowIso() });
  const invites = await readInvites({ seniorId: senior.id });
  const pending = invites.find((invite) => invite.memberId === member.id && invite.status === INVITE_STATUS.PENDING);
  if (pending) {
    await saveInvite({ ...pending, status: INVITE_STATUS.REVOKED, respondedAt: nowIso() });
  }
  if (member.userId) await dropMemberId(senior, member.userId);
  return true;
}

export async function updateCircleMember(memberId, patch, session = getSession()) {
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("No senior profile is linked to this account.");

  if (usesLiveAuth()) {
    await liveCircle("updateCareCircleMember", {
      seniorId: senior.id,
      memberId,
      role: patch.role,
      relationship: patch.relationship,
      permissions: patch.permissions,
    });
    return true;
  }

  const members = visibleMembers(await readMembers(senior.id));
  const actor = findActor(members, session, senior);
  assertCanManage(actor, session, senior);

  const member = members.find((item) => item.id === memberId);
  if (!member) throw new Error("That person is not in this circle.");
  if (member.role === CARE_CIRCLE_ROLES.OWNER) {
    throw new Error("The owner’s access cannot be changed.");
  }

  const nextRole = patch.role && patch.role !== CARE_CIRCLE_ROLES.OWNER ? patch.role : member.role;
  const nextPermissions = Array.isArray(patch.permissions) && patch.permissions.length
    ? patch.permissions
    : (patch.role ? permissionsForRole(nextRole) : member.permissions);

  return saveMember({
    ...member,
    role: nextRole,
    permissions: nextPermissions,
    relationship: patch.relationship?.trim() || member.relationship,
  });
}

export async function listMembershipsForSession(session = getSession()) {
  if (!session?.id && !session?.email) return [];
  if (!usesLiveAuth()) {
    return Object.values(readLocalMap(MEMBERS_KEY))
      .map((item) => memberFrom(item))
      .filter((member) => (
        member.status === CIRCLE_STATUS.ACTIVE
        && (member.userId === session.id || emailsEqual(member.email, session.email))
      ));
  }

  const sdk = getFirestoreSdk();
  const docs = [];
  if (session.id) {
    docs.push(...await collectionDocs(AUTH.CIRCLE_COLLECTION, [
      sdk.where("userId", "==", session.id),
    ]));
  }
  if (session.email) {
    docs.push(...await collectionDocs(AUTH.CIRCLE_COLLECTION, [
      sdk.where("email", "==", String(session.email).trim().toLowerCase()),
    ]));
  }
  const seen = new Set();
  return docs
    .map((item) => memberFrom(item))
    .filter((member) => {
      if (member.status !== CIRCLE_STATUS.ACTIVE || seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    });
}

export async function updateOwnPresence(seniorId, patch = {}, session = getSession()) {
  if (!seniorId || !session) throw new Error("Sign in to update your status.");
  const members = visibleMembers(await readMembers(seniorId));
  const me = members.find((member) => (
    member.userId === session.id || emailsEqual(member.email, session.email)
  ));
  if (!me) throw new Error("You are not on this circle.");
  const next = {
    availability: patch.availability ?? me.availability,
    lastSeenAt: patch.lastSeenAt ?? me.lastSeenAt,
    nextVisit: patch.nextVisit ?? me.nextVisit,
  };
  if (!usesLiveAuth()) {
    return saveMember({ ...me, ...next });
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  await sdk.updateDoc(sdk.doc(db, AUTH.CIRCLE_COLLECTION, me.id), {
    ...next,
    updatedAt: sdk.serverTimestamp(),
  });
  return memberFrom({ ...me, ...next });
}

async function requireIncomingInvite(inviteId, session) {
  if (!session?.email) throw new Error("Sign in to respond to this invitation.");
  const incoming = await listIncomingInvites(session);
  const invite = incoming.find((item) => item.id === inviteId || item.token === inviteId);
  if (!invite) throw new Error("This invitation is not waiting for you.");
  return invite;
}

async function loadManagedInvite(inviteId, session) {
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("No senior profile is linked to this account.");
  const members = visibleMembers(await readMembers(senior.id));
  const actor = findActor(members, session, senior);
  assertCanManage(actor, session, senior);

  const invites = await readInvites({ seniorId: senior.id });
  const invite = invites.find((item) => item.id === inviteId);
  if (!invite) throw new Error("That invitation could not be found.");
  const member = members.find((item) => item.id === invite.memberId)
    ?? members.find((item) => emailsEqual(item.email, invite.email));
  return { senior, invite, member };
}
