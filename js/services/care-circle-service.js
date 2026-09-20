import {
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
import { parsePhone, phonesEqual, toE164 } from "../config/phone.js";
import {
  careCircleInviteUrl,
  clearStoredInviteToken,
  persistInvitePreview,
} from "../config/invites.js";
import { createCareCircleInvite, createCareCircleMember } from "../models/care-circle.js";
import { mockCircle, mockInvites } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import {
  careCircleInvitesCol,
  circleMemberDoc,
  circleMembersCol,
  seniorsCol,
} from "../core/firestore-paths.js";
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

function inviteMatchesSession(invite, session) {
  if (!invite || !session) return false;
  if (invite.inviteeUserId && session.id && invite.inviteeUserId === session.id) return true;
  if (invite.email && emailsEqual(invite.email, session.email)) return true;
  if (invite.phone && phonesEqual(invite.phone, session.phone)) return true;
  return false;
}

function sameContact(record, email, phone) {
  if (email && emailsEqual(record?.email, email)) return true;
  if (phone && phonesEqual(record?.phone, phone)) return true;
  return false;
}

function localUsers() {
  return storage.get("users", []) || [];
}

function findLocalUserByContact({ email, phone } = {}) {
  const users = localUsers();
  if (email) {
    const hit = users.find((item) => emailsEqual(item.email, email));
    if (hit) return hit;
  }
  if (phone) {
    const hit = users.find((item) => phonesEqual(item.phone, phone));
    if (hit) return hit;
  }
  return null;
}

function occupies(member) {
  return member.status === CIRCLE_STATUS.ACTIVE || member.status === CIRCLE_STATUS.INVITED;
}

function nowIso() {
  return new Date().toISOString();
}

const PERMISSION_OWNER = "owner";
const PERMISSION_FAMILY = "familyMember";
const PERMISSION_CAREGIVER = "caregiver";
const PERMISSION_PRACTITIONER = "healthPractitioner";
const PERMISSION_EMERGENCY = "emergencyContact";

const PERMISSION_BY_KIND = {
  [CIRCLE_KINDS.CAREGIVER]: PERMISSION_CAREGIVER,
  [CIRCLE_KINDS.PRACTITIONER]: PERMISSION_PRACTITIONER,
  [CIRCLE_KINDS.FAMILY]: PERMISSION_FAMILY,
};

function permissionForKind(kind) {
  return PERMISSION_BY_KIND[kind] || PERMISSION_FAMILY;
}

function familyIdForSenior(senior, session) {
  return senior?.familyId || senior?.ownerId || session?.familyId || session?.id || "";
}

function singularPermissionFor(record = {}) {
  if (record.permission) return record.permission;
  if (record.role === CARE_CIRCLE_ROLES.OWNER) return PERMISSION_OWNER;
  if (record.kind === CIRCLE_KINDS.CAREGIVER) return PERMISSION_CAREGIVER;
  if (record.kind === CIRCLE_KINDS.PRACTITIONER) return PERMISSION_PRACTITIONER;
  if (record.isEmergencyContact) return PERMISSION_EMERGENCY;
  return PERMISSION_FAMILY;
}

function roleForPermission(permission) {
  if (!permission) return undefined;
  if (permission === PERMISSION_OWNER) return CARE_CIRCLE_ROLES.OWNER;
  return CARE_CIRCLE_ROLES.MEMBER;
}

function kindForPermission(permission) {
  if (!permission) return undefined;
  if (permission === PERMISSION_CAREGIVER) return CIRCLE_KINDS.CAREGIVER;
  if (permission === PERMISSION_PRACTITIONER) return CIRCLE_KINDS.PRACTITIONER;
  return CIRCLE_KINDS.FAMILY;
}

function memberFrom(data) {
  const role = data.role ?? roleForPermission(data.permission);
  const kind = data.kind ?? kindForPermission(data.permission);
  const member = createCareCircleMember({
    ...data,
    role,
    kind,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    invitedAt: toIso(data.invitedAt),
    respondedAt: toIso(data.respondedAt),
    lastSeenAt: toIso(data.lastSeenAt),
  });
  return {
    ...member,
    permission: data.permission || singularPermissionFor(member),
    isEmergencyContact: Boolean(data.isEmergencyContact),
  };
}

function inviteFrom(data) {
  const status = data.status === "cancelled" ? INVITE_STATUS.REVOKED : data.status;
  const role = data.role ?? roleForPermission(data.permission);
  const kind = data.kind ?? kindForPermission(data.permission);
  const invite = createCareCircleInvite({
    ...data,
    status,
    role,
    kind,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    respondedAt: toIso(data.respondedAt),
  });
  return {
    ...invite,
    permission: data.permission || singularPermissionFor(invite),
    isEmergencyContact: Boolean(data.isEmergencyContact),
  };
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

function localInvites({ seniorId, email, phone, token } = {}) {
  return Object.values(readLocalMap(INVITES_KEY))
    .map((item) => inviteFrom(item))
    .filter((item) => {
      if (seniorId && item.seniorId !== seniorId) return false;
      if (email && !emailsEqual(item.email, email)) return false;
      if (phone && !phonesEqual(item.phone, phone)) return false;
      if (token && item.token !== token && item.id !== token) return false;
      return true;
    });
}

async function collectionDocs(ref, constraints = [], options = {}) {
  const sdk = getFirestoreSdk();
  if (!ref || !sdk) return [];
  const limit = options.limit ?? QUERY_LIMITS.WORKSPACE;
  const snap = await sdk.getDocs(sdk.query(ref, ...constraints, sdk.limit(limit)));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function readMembers(seniorId) {
  if (!usesLiveAuth()) return localMembers(seniorId);
  if (!seniorId) return [];

  const docs = await collectionDocs(circleMembersCol(seniorId));
  return docs.map((item) => memberFrom({ ...item, seniorId: item.seniorId || seniorId }));
}

async function readInvites(filter = {}) {
  if (!usesLiveAuth()) return localInvites(filter);

  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  else if (filter.email) constraints.push(sdk.where("email", "==", String(filter.email).trim().toLowerCase()));
  else if (filter.phone) constraints.push(sdk.where("phone", "==", toE164(filter.phone) || String(filter.phone).trim()));
  else if (filter.token) constraints.push(sdk.where("token", "==", filter.token));
  const docs = await collectionDocs(careCircleInvitesCol(), constraints);
  return docs
    .map((item) => inviteFrom(item))
    .filter((item) => {
      if (filter.email && !emailsEqual(item.email, filter.email)) return false;
      if (filter.phone && !phonesEqual(item.phone, filter.phone)) return false;
      if (filter.token && item.token !== filter.token && item.id !== filter.token) return false;
      return true;
    });
}

async function saveMember(member) {
  const record = memberFrom({ ...member, updatedAt: nowIso() });
  if (!usesLiveAuth()) return memberFrom(writeLocalRecord(MEMBERS_KEY, record));

  const sdk = getFirestoreSdk();
  const seniorId = record.seniorId;
  if (!seniorId) throw new Error("A circle member needs a senior id.");
  const memberId = record.userId || record.id;
  const ref = memberId
    ? circleMemberDoc(seniorId, memberId)
    : sdk.doc(circleMembersCol(seniorId));
  const payload = toDoc({ ...record, id: ref.id });
  const data = {
    ...payload,
    seniorId,
    permission: singularPermissionFor(record),
    updatedAt: sdk.serverTimestamp(),
  };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return memberFrom({ ...record, id: ref.id });
}

async function saveInvite(invite) {
  const record = inviteFrom({ ...invite, updatedAt: nowIso() });
  if (!usesLiveAuth()) return inviteFrom(writeLocalRecord(INVITES_KEY, record));

  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(careCircleInvitesCol(), record.id)
    : sdk.doc(careCircleInvitesCol());
  const payload = toDoc({
    ...record,
    id: ref.id,
    email: String(record.email || "").trim().toLowerCase(),
    phone: toE164(record.phone) || String(record.phone || "").trim(),
  });
  const data = {
    ...payload,
    permission: singularPermissionFor(record),
    updatedAt: sdk.serverTimestamp(),
  };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return inviteFrom({ ...record, id: ref.id });
}

async function liveCircle(name, data, fallback = "That request could not be completed.") {
  return callCloudFunction(name, data, { fallback });
}

async function updateInviteStatus(inviteId, status) {
  const sdk = getFirestoreSdk();
  await sdk.updateDoc(sdk.doc(careCircleInvitesCol(), inviteId), {
    status,
    respondedAt: sdk.serverTimestamp(),
  });
}

function visibleMembers(members) {
  return members.filter((member) => member.status !== CIRCLE_STATUS.REMOVED);
}

function findActor(members, session, senior) {
  if (!session) return null;
  return members.find((member) => (
    member.status !== CIRCLE_STATUS.REMOVED
    && (
      member.userId === session.id
      || emailsEqual(member.email, session.email)
      || (member.phone && phonesEqual(member.phone, session.phone))
    )
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
  const channel = input.channel === "phone" ? "phone" : "email";
  const email = String(input.email || "").trim().toLowerCase();
  let phone = "";
  let phoneCountry = String(input.phoneCountry || "").trim().toUpperCase();
  const relationship = String(input.relationship || "").trim() || defaultRelationship(kind);
  const professionalRole = professionalRoleForKind(kind);
  let professionalType = input.professionalType || null;

  if (!name) throw new Error("Enter their name.");

  if (channel === "phone") {
    const parsed = parsePhone({
      iso: input.phoneCountry || phoneCountry,
      national: input.phoneNational || input.phone,
    });
    if (!parsed.ok) {
      const compact = toE164(input.phone);
      if (!compact) throw new Error(parsed.error || "Enter a valid phone number.");
      phone = compact;
    } else {
      phone = parsed.e164;
      phoneCountry = parsed.iso;
    }
  } else if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email address.");
  } else {
    phone = toE164(input.phone);
  }

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
    phone,
    phoneCountry,
    channel,
    relationship,
    professionalType,
    permissions,
    professionalUserId: input.professionalUserId || null,
    isPrimaryCaregiver: Boolean(input.isPrimaryCaregiver),
    isEmergencyContact: Boolean(input.isEmergencyContact),
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
  if (!session?.email && !session?.phone) return [];
  const batches = [];
  if (session.email) batches.push(readInvites({ email: session.email }));
  if (session.phone) batches.push(readInvites({ phone: session.phone }));
  const invites = (await Promise.all(batches)).flat();
  const seen = new Set();
  return invites.filter((invite) => {
    if (invite.status !== INVITE_STATUS.PENDING || seen.has(invite.id)) return false;
    if (!inviteMatchesSession(invite, session)) return false;
    seen.add(invite.id);
    return true;
  });
}

export async function resolveCareCircleInvite(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return null;
  if (usesLiveAuth()) {
    const preview = await callCloudFunction("resolveCareCircleInvite", { token: normalized }, {
      fallback: "This invitation could not be found.",
    });
    persistInvitePreview(preview);
    return preview;
  }
  const invite = await getInviteByToken(normalized);
  if (!invite) return null;
  const session = getSession();
  const existingUser = findLocalUserByContact({ email: invite.email, phone: invite.phone });
  const preview = {
    token: invite.token || invite.id,
    status: invite.status,
    name: invite.name,
    seniorName: invite.seniorName,
    invitedByName: invite.invitedByName,
    kind: invite.kind,
    relationship: invite.relationship,
    message: invite.message,
    channel: invite.channel || (invite.phone && !invite.email ? "phone" : "email"),
    accountState: invite.accountState || (invite.inviteeUserId || existingUser ? "existing" : "new"),
    email: invite.email || existingUser?.email || "",
    phone: invite.phone || existingUser?.phone || "",
    loginEmail: invite.email || existingUser?.email || "",
    signedIn: Boolean(session?.id),
    matchesViewer: inviteMatchesSession(invite, session) || Boolean(existingUser && session?.id === existingUser.id),
  };
  persistInvitePreview(preview);
  return preview;
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
    if (inviteMatchesSession(tokenInvite, session)) incoming.unshift(tokenInvite);
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

  if (sameContact(session, payload.email, payload.phone)) {
    throw new Error("You are already in this circle.");
  }

  const duplicate = members.find((member) => occupies(member) && sameContact(member, payload.email, payload.phone));
  if (duplicate) {
    throw new Error(`${duplicate.name || payload.email || payload.phone} is already in this circle.`);
  }

  if (usesLiveAuth()) {
    if (!payload.email && !payload.professionalUserId && !payload.phone) {
      throw new Error("Invitations need an email address or phone number.");
    }
    const result = await callCloudFunction("sendCareCircleInvite", {
      familyId: familyIdForSenior(senior, session),
      seniorId: senior.id,
      seniorName: senior.displayName,
      email: payload.email || undefined,
      phone: payload.phone || undefined,
      professionalUserId: payload.professionalUserId || undefined,
      permission: permissionForKind(payload.kind),
      relationship: payload.relationship,
      isPrimaryCaregiver: payload.isPrimaryCaregiver,
      isEmergencyContact: payload.isEmergencyContact,
      invitedByName: session.displayName,
    }, { fallback: "The invitation could not be sent. Try again." });
    const invitationId = result?.invitationId;
    trackInviteSent(payload.kind, {
      dedupeKey: `${inviteEventName(payload.kind)}:${invitationId}`,
      inviteKind: payload.kind,
      inviteId: invitationId,
      seniorId: senior.id,
    }, session);
    return {
      member: {
        id: invitationId,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        kind: payload.kind,
      },
      invite: {
        id: invitationId,
        token: invitationId,
        channel: payload.channel,
        accountState: "new",
        email: payload.email,
        phone: payload.phone,
      },
      shareUrl: careCircleInviteUrl(invitationId),
      accountState: "new",
    };
  }

  const existingUser = findLocalUserByContact({ email: payload.email, phone: payload.phone });
  if (existingUser && existingUser.id === session.id) {
    throw new Error("You are already in this circle.");
  }
  const storedEmail = payload.email || String(existingUser?.email || "").trim().toLowerCase();
  const storedPhone = payload.phone || toE164(existingUser?.phone) || "";
  const accountState = existingUser ? "existing" : "new";

  const now = nowIso();
  const member = await saveMember(createCareCircleMember({
    id: usesLiveAuth() ? "" : newId("m"),
    seniorId: senior.id,
    userId: existingUser?.id || null,
    name: payload.name,
    email: storedEmail,
    phone: storedPhone,
    phoneCountry: payload.phoneCountry,
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
    email: storedEmail,
    phone: storedPhone,
    phoneCountry: payload.phoneCountry,
    channel: payload.channel,
    inviteeUserId: existingUser?.id || null,
    accountState,
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

  const noticeRecipients = existingUser
    ? [{ userId: existingUser.id, email: storedEmail }]
    : (storedEmail ? [{ email: storedEmail }] : []);
  if (noticeRecipients.length) {
    await notifyQuietly(noticeRecipients, {
      type: invitationTypeForKind(payload.kind),
      title: `You’re invited to ${senior.displayName}’s circle`,
      body: `${session.displayName} invited you${payload.kind === "caregiver" ? " as a caregiver" : payload.kind === "practitioner" ? " as a health practitioner" : ""} to coordinate care.`,
      seniorId: senior.id,
      inviteId: invite.id,
      inviteToken: invite.token,
    }, session);
  }

  trackInviteSent(payload.kind, {
    dedupeKey: `${inviteEventName(payload.kind)}:${invite.id}`,
    inviteKind: payload.kind,
    inviteId: invite.id,
    seniorId: senior.id,
  }, session);
  return {
    member,
    invite,
    shareUrl: careCircleInviteUrl(invite.token),
    accountState,
  };
}

export async function resendInvitation(inviteId, session = getSession()) {
  if (usesLiveAuth()) {
    const sdk = getFirestoreSdk();
    const snap = await sdk.getDoc(sdk.doc(careCircleInvitesCol(), inviteId));
    if (!snap.exists()) throw new Error("That invitation could not be found.");
    const raw = snap.data() || {};
    if (!raw.email && !raw.professionalUserId && !raw.phone) {
      throw new Error("This invitation has no contact to resend to.");
    }
    if (raw.status === INVITE_STATUS.PENDING) {
      await updateInviteStatus(inviteId, INVITE_STATUS.REVOKED);
    }
    const senior = raw.familyId ? null : await getSeniorForUser(session);
    await callCloudFunction("sendCareCircleInvite", {
      familyId: raw.familyId || familyIdForSenior(senior, session),
      seniorId: raw.seniorId,
      seniorName: raw.seniorName || senior?.displayName || "",
      email: raw.email || undefined,
      phone: raw.phone || undefined,
      professionalUserId: raw.professionalUserId || undefined,
      permission: raw.permission || PERMISSION_FAMILY,
      relationship: raw.relationship || "",
      isPrimaryCaregiver: raw.isPrimaryCaregiver === true,
      isEmergencyContact: raw.isEmergencyContact === true,
      invitedByName: session.displayName,
    }, { fallback: "The invitation could not be re-sent. Try again." });
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
    await updateInviteStatus(inviteId, INVITE_STATUS.REVOKED);
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
    clearStoredInviteToken();
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
    ?? members.find((item) => sameContact(item, invite.email, invite.phone));

  const now = nowIso();
  if (member) {
    member = await saveMember({
      ...member,
      userId: session.id,
      name: session.displayName || member.name,
      email: session.email || member.email,
      phone: session.phone || member.phone,
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
      phone: session.phone || invite.phone,
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
  clearStoredInviteToken();
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
    await updateInviteStatus(inviteId, INVITE_STATUS.DECLINED);
    clearStoredInviteToken();
    return true;
  }
  const invite = await requireIncomingInvite(inviteId, session);
  const now = nowIso();
  await saveInvite({ ...invite, status: INVITE_STATUS.DECLINED, respondedAt: now });

  const members = visibleMembers(await readMembers(invite.seniorId));
  const member = members.find((item) => item.id === invite.memberId)
    ?? members.find((item) => sameContact(item, invite.email, invite.phone));
  if (member && member.status !== CIRCLE_STATUS.ACTIVE) {
    await saveMember({ ...member, status: CIRCLE_STATUS.DECLINED, respondedAt: now });
  }
  await notifyQuietly([{ userId: invite.invitedBy }], {
    type: NOTIFICATION_TYPES.INVITATION_DECLINED,
    title: `${session.displayName || invite.name || invite.email || invite.phone} declined the invitation`,
    body: `${session.displayName || invite.name || "Someone"} declined to join ${invite.seniorName || "the circle"}.`,
    seniorId: invite.seniorId,
    inviteId: invite.id,
  }, session);
  clearStoredInviteToken();
  return true;
}

export async function removeCircleMember(memberId, session = getSession()) {
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("No senior profile is linked to this account.");

  if (usesLiveAuth()) {
    const sdk = getFirestoreSdk();
    await sdk.updateDoc(circleMemberDoc(senior.id, memberId), {
      status: CIRCLE_STATUS.REMOVED,
      endedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    });
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
    const sdk = getFirestoreSdk();
    const ref = circleMemberDoc(senior.id, memberId);
    const snap = await sdk.getDoc(ref);
    if (!snap.exists()) throw new Error("That person is not in this circle.");
    const current = snap.data() || {};
    if (current.role === CARE_CIRCLE_ROLES.OWNER || current.permission === PERMISSION_OWNER) {
      throw new Error("The owner’s access cannot be changed.");
    }
    const nextRole = patch.role && patch.role !== CARE_CIRCLE_ROLES.OWNER
      ? patch.role
      : (current.role || CARE_CIRCLE_ROLES.MEMBER);
    const currentPermission = current.permission || singularPermissionFor(current);
    const nextPermission = currentPermission === PERMISSION_OWNER
      ? PERMISSION_FAMILY
      : currentPermission;
    await sdk.updateDoc(ref, {
      role: nextRole,
      relationship: patch.relationship !== undefined
        ? String(patch.relationship || "").trim()
        : (current.relationship || ""),
      permissions: Array.isArray(patch.permissions) && patch.permissions.length
        ? patch.permissions
        : current.permissions,
      permission: nextPermission,
      updatedAt: sdk.serverTimestamp(),
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
        && (member.userId === session.id || emailsEqual(member.email, session.email) || phonesEqual(member.phone, session.phone))
      ));
  }

  const sdk = getFirestoreSdk();
  const seniorIds = new Set();
  if (session.seniorId) seniorIds.add(session.seniorId);
  if (session.id) {
    const [owned, memberOf] = await Promise.all([
      collectionDocs(seniorsCol(), [sdk.where("ownerId", "==", session.id)]),
      collectionDocs(seniorsCol(), [sdk.where("memberIds", "array-contains", session.id)]),
    ]);
    owned.forEach((doc) => seniorIds.add(doc.id));
    memberOf.forEach((doc) => seniorIds.add(doc.id));
  }

  const docs = (await Promise.all(
    [...seniorIds].map((seniorId) => collectionDocs(circleMembersCol(seniorId))),
  )).flat();
  const seen = new Set();
  return docs
    .map((item) => memberFrom(item))
    .filter((member) => {
      const matches = member.userId === session.id
        || emailsEqual(member.email, session.email)
        || phonesEqual(member.phone, session.phone);
      if (member.status !== CIRCLE_STATUS.ACTIVE || !matches || seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    });
}

export async function updateOwnPresence(seniorId, patch = {}, session = getSession()) {
  if (!seniorId || !session) throw new Error("Sign in to update your status.");
  const members = visibleMembers(await readMembers(seniorId));
  const me = members.find((member) => (
    member.userId === session.id || emailsEqual(member.email, session.email) || phonesEqual(member.phone, session.phone)
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
  const sdk = getFirestoreSdk();
  await sdk.updateDoc(circleMemberDoc(seniorId, me.userId || me.id), {
    ...next,
    permission: singularPermissionFor(me),
    updatedAt: sdk.serverTimestamp(),
  });
  return memberFrom({ ...me, ...next });
}

async function requireIncomingInvite(inviteId, session) {
  if (!session?.email && !session?.phone) throw new Error("Sign in to respond to this invitation.");
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
    ?? members.find((item) => sameContact(item, invite.email, invite.phone));
  return { senior, invite, member };
}
