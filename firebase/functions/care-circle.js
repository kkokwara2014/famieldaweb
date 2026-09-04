const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const notifications = require("./notifications");
const entitlements = require("./entitlements");
const analytics = require("./analytics");
const security = require("./security");

const MEMBERS = "careCircleMembers";
const INVITES = "careCircleInvites";
const USERS = "users";

const STATUS = {
  ACTIVE: "active",
  INVITED: "invited",
  DECLINED: "declined",
  REMOVED: "removed",
};

const INVITE = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  REVOKED: "revoked",
};

const CIRCLE_ROLES = new Set(["coordinator", "member", "viewer"]);
const KINDS = new Set(["family", "caregiver", "practitioner"]);
const PENDING_INVITE_CAP = 20;

function db() {
  return getFirestore();
}

function emailOf(request) {
  return security.emailOf(request.auth?.token?.email);
}

async function listMembers(seniorId) {
  const snap = await db().collection(MEMBERS).where("seniorId", "==", seniorId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function addMemberId(seniorId, uid) {
  const senior = await security.loadSenior(seniorId);
  const memberIds = Array.isArray(senior.memberIds) ? senior.memberIds : [];
  if (memberIds.includes(uid)) return;
  await db().doc(`${security.SENIORS}/${seniorId}`).update({
    memberIds: [...memberIds, uid],
    updatedAt: new Date(),
  });
}

async function dropMemberId(seniorId, uid) {
  const senior = await security.loadSenior(seniorId);
  const memberIds = Array.isArray(senior.memberIds) ? senior.memberIds : [];
  await db().doc(`${security.SENIORS}/${seniorId}`).update({
    memberIds: memberIds.filter((id) => id !== uid),
    updatedAt: new Date(),
  });
}

function occupies(member) {
  return member.status === STATUS.ACTIVE || member.status === STATUS.INVITED;
}

function sameContact(record, email, phone) {
  if (email && security.emailOf(record?.email) === email) return true;
  if (phone && security.phoneOf(record?.phone) && security.phoneOf(record.phone) === phone) return true;
  return false;
}

async function findUserByContact({ email, phone }) {
  if (email) {
    const snap = await db().collection(USERS).where("email", "==", email).limit(2).get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  if (phone) {
    const snap = await db().collection(USERS).where("phone", "==", phone).limit(2).get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return null;
}

function inviteMatchesUser(invite, user, authEmail) {
  const uid = user?.id || user?.uid;
  if (invite?.inviteeUserId && uid && invite.inviteeUserId === uid) return true;
  const email = security.emailOf(authEmail || user?.email);
  const phone = security.phoneOf(user?.phone);
  if (invite?.email && security.emailOf(invite.email) === email) return true;
  if (invite?.phone && security.phoneOf(invite.phone) && security.phoneOf(invite.phone) === phone) return true;
  return false;
}

async function loadInviteByToken(token) {
  const id = security.textOf(token);
  if (!id || id.length > 80) return null;
  const byId = await db().doc(`${INVITES}/${id}`).get();
  if (byId.exists) {
    const data = byId.data();
    if (!data.token || data.token === id) return { id: byId.id, ...data };
  }
  const byToken = await db().collection(INVITES).where("token", "==", id).limit(1).get();
  if (byToken.empty) return null;
  const doc = byToken.docs[0];
  return { id: doc.id, ...doc.data() };
}

function publicInvitePreview(invite, extras = {}) {
  const channel = invite.channel === "phone" || (invite.phone && !invite.email) ? "phone" : "email";
  const existing = Boolean(invite.inviteeUserId || invite.accountState === "existing");
  return {
    token: invite.token || invite.id,
    status: invite.status || INVITE.PENDING,
    name: invite.name || "",
    seniorName: invite.seniorName || "",
    invitedByName: invite.invitedByName || "",
    kind: invite.kind || "family",
    relationship: invite.relationship || "",
    message: security.textOf(invite.message).slice(0, 500),
    channel,
    accountState: existing ? "existing" : "new",
    email: security.emailOf(invite.email),
    phone: security.phoneOf(invite.phone),
    loginEmail: security.emailOf(invite.email),
    ...extras,
  };
}

function inviteChannelOf(channel, email, phone) {
  if (channel === "phone" || (!email && phone)) return "phone";
  return "email";
}

exports.inviteCareCircleMember = async (request) => {
  const {
    seniorId,
    email,
    phone,
    phoneCountry,
    channel,
    name,
    kind,
    role,
    relationship,
    professionalType,
    permissions,
    message,
  } = request.data || {};
  const normalizedEmail = security.emailOf(email);
  const normalizedPhone = security.phoneOf(phone);
  if (!seniorId || !kind) {
    throw new HttpsError("invalid-argument", "seniorId and kind are required.");
  }
  if (normalizedEmail && (!normalizedEmail.includes("@") || normalizedEmail.length > 160)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  if (phone && !normalizedPhone) {
    throw new HttpsError("invalid-argument", "Enter a valid phone number, including country code.");
  }
  if (!normalizedEmail && !normalizedPhone) {
    throw new HttpsError("invalid-argument", "Invite them with an email address or a phone number.");
  }
  if (!KINDS.has(kind)) {
    throw new HttpsError("invalid-argument", "That circle role is not valid.");
  }
  const circleRole = CIRCLE_ROLES.has(role) ? role : "member";
  const inviteChannel = inviteChannelOf(channel, normalizedEmail, normalizedPhone);

  const { uid, user, senior } = await security.requireHousehold(
    request,
    seniorId,
    security.PERMISSIONS.INVITE_MEMBERS,
  );
  const members = await listMembers(seniorId);

  const owner = senior.ownerId && senior.ownerId !== uid
    ? await security.loadUser(senior.ownerId).catch(() => user)
    : user;
  if (!entitlements.canInviteKind(kind, { user, owner, members })) {
    throw new HttpsError(
      "failed-precondition",
      entitlements.message(
        kind === "practitioner" ? "practitioner" : kind === "caregiver" ? "caregiver" : "familyMember",
      ),
    );
  }

  const pending = members.filter((member) => member.status === STATUS.INVITED).length;
  if (pending >= PENDING_INVITE_CAP) {
    throw new HttpsError("resource-exhausted", "This household has too many waiting invitations.");
  }

  if (sameContact(user, normalizedEmail, normalizedPhone)) {
    throw new HttpsError("already-exists", "You are already in this circle.");
  }

  const duplicate = members.find((member) => occupies(member) && sameContact(member, normalizedEmail, normalizedPhone));
  if (duplicate) {
    throw new HttpsError("already-exists", "That person is already in this circle.");
  }

  const existingUser = await findUserByContact({ email: normalizedEmail, phone: normalizedPhone });
  if (existingUser && (existingUser.id === uid || existingUser.uid === uid)) {
    throw new HttpsError("already-exists", "You are already in this circle.");
  }
  if (existingUser && members.some((member) => (
    occupies(member) && (member.userId === existingUser.id || sameContact(member, security.emailOf(existingUser.email), security.phoneOf(existingUser.phone)))
  ))) {
    throw new HttpsError("already-exists", "That person is already in this circle.");
  }

  const storedEmail = normalizedEmail || security.emailOf(existingUser?.email);
  const storedPhone = normalizedPhone || security.phoneOf(existingUser?.phone);
  const now = new Date();
  const memberRef = db().collection(MEMBERS).doc();
  const inviteRef = db().collection(INVITES).doc();
  const memberPayload = {
    seniorId,
    name: security.textOf(name).slice(0, 120),
    email: storedEmail,
    phone: storedPhone,
    phoneCountry: security.textOf(phoneCountry).slice(0, 4).toUpperCase(),
    kind,
    role: circleRole,
    relationship: security.textOf(relationship).slice(0, 80),
    professionalType: professionalType || null,
    permissions: Array.isArray(permissions) ? permissions.slice(0, 20) : [],
    status: STATUS.INVITED,
    invitedBy: uid,
    invitedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const invitePayload = {
    token: inviteRef.id,
    seniorId,
    seniorName: senior.displayName || "",
    email: storedEmail,
    phone: storedPhone,
    phoneCountry: memberPayload.phoneCountry,
    channel: inviteChannel,
    inviteeUserId: existingUser?.id || null,
    accountState: existingUser ? "existing" : "new",
    name: memberPayload.name,
    kind,
    role: memberPayload.role,
    relationship: memberPayload.relationship,
    professionalType: memberPayload.professionalType,
    permissions: memberPayload.permissions,
    status: INVITE.PENDING,
    invitedBy: uid,
    invitedByName: user.displayName || "",
    memberId: memberRef.id,
    message: security.textOf(message).slice(0, 500),
    createdAt: now,
    updatedAt: now,
  };

  await memberRef.set(memberPayload);
  await inviteRef.set(invitePayload);
  const noticeRecipients = existingUser
    ? [{ userId: existingUser.id, email: storedEmail }]
    : (storedEmail ? [{ email: storedEmail }] : []);
  if (noticeRecipients.length) {
    await notifications.notifyPeople(noticeRecipients, {
      type: notifications.invitationTypeForKind(kind),
      title: `You’re invited to ${senior.displayName || "a Famielda household"}’s circle`,
      body: `${user.displayName || "A family member"} invited you to coordinate care.`,
      seniorId,
      inviteId: inviteRef.id,
      inviteToken: invitePayload.token,
      actorId: uid,
      actorName: user.displayName || "",
    }, uid);
  }
  logger.info("Care circle invite created", { uid, seniorId, kind, channel: inviteChannel });
  await analytics.trackInvite(uid, kind, {
    inviteId: inviteRef.id,
    seniorId,
    dedupeKey: `${analytics.inviteEventName(kind)}:${inviteRef.id}`,
  });
  return {
    queued: true,
    inviteId: inviteRef.id,
    memberId: memberRef.id,
    token: invitePayload.token,
    kind,
    channel: inviteChannel,
    accountState: invitePayload.accountState,
    email: storedEmail,
    phone: storedPhone,
  };
};

exports.resolveCareCircleInvite = async (request) => {
  const token = security.textOf(request.data?.token);
  if (!token) throw new HttpsError("invalid-argument", "That invitation link is missing.");
  const invite = await loadInviteByToken(token);
  if (!invite) throw new HttpsError("not-found", "This invitation could not be found.");

  const preview = publicInvitePreview(invite, { signedIn: false, matchesViewer: false });
  if (request.auth?.uid) {
    const user = await security.loadUser(request.auth.uid).catch(() => null);
    if (user) {
      preview.signedIn = true;
      preview.matchesViewer = inviteMatchesUser(invite, user, request.auth.token?.email);
    }
  }
  return preview;
};

exports.acceptCareCircleInvite = async (request) => {
  const { uid, user } = await security.requireActiveUser(request);
  const email = emailOf(request);
  const { inviteId } = request.data || {};
  if (!inviteId) throw new HttpsError("invalid-argument", "inviteId is required.");

  const inviteRef = db().doc(`${INVITES}/${inviteId}`);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw new HttpsError("not-found", "Invitation not found.");
  const invite = inviteSnap.data();
  if (!inviteMatchesUser(invite, user, email)) {
    throw new HttpsError("permission-denied", "This invitation is not for you.");
  }
  if (invite.status !== INVITE.PENDING) {
    throw new HttpsError("failed-precondition", "This invitation is no longer waiting.");
  }

  const memberships = await db().collection(MEMBERS).where("userId", "==", uid).get()
    .then((snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  if (!entitlements.canJoinAnotherFamily({
    user,
    memberships,
    kind: invite.kind,
    seniorId: invite.seniorId,
  })) {
    throw new HttpsError("failed-precondition", entitlements.message("professionalRelationship"));
  }

  const now = new Date();
  if (invite.memberId) {
    await db().doc(`${MEMBERS}/${invite.memberId}`).set({
      userId: uid,
      name: user.displayName || invite.name || "",
      email: email || invite.email || "",
      phone: security.phoneOf(user.phone) || invite.phone || "",
      status: STATUS.ACTIVE,
      respondedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    }, { merge: true });
  }
  await inviteRef.update({ status: INVITE.ACCEPTED, respondedAt: now, updatedAt: now });
  await addMemberId(invite.seniorId, uid);
  await db().doc(`${USERS}/${uid}`).update({ seniorId: invite.seniorId, updatedAt: now });
  await notifications.notifyPeople([{ userId: invite.invitedBy }], {
    type: notifications.TYPES.INVITATION_ACCEPTED,
    title: `${user.displayName || email} accepted the invitation`,
    body: `${user.displayName || email} joined ${invite.seniorName || "the circle"}.`,
    seniorId: invite.seniorId,
    inviteId,
    inviteToken: invite.token,
    actorId: uid,
    actorName: user.displayName || "",
  }, uid);
  const members = await listMembers(invite.seniorId);
  await notifications.notifyPeople(
    members.filter((member) => member.status === STATUS.ACTIVE && member.userId && member.userId !== uid && member.userId !== invite.invitedBy),
    {
      type: notifications.TYPES.NEW_USER_JOINED,
      title: `${user.displayName || email} joined the household`,
      body: `${user.displayName || email} is now on ${invite.seniorName || "the care circle"}.`,
      seniorId: invite.seniorId,
      actorId: uid,
      actorName: user.displayName || "",
    },
    uid,
  );
  logger.info("Care circle invite accepted", { uid, inviteId });
  const actor = await analytics.actorFields(uid);
  await analytics.trackQuietly({
    name: analytics.NAMES.INVITATION_ACCEPTED,
    ...actor,
    inviteId,
    inviteKind: invite.kind || "",
    seniorId: invite.seniorId || "",
    platform: "server",
    dedupeKey: `invitation_accepted:${inviteId}`,
  });
  return { ok: true, seniorId: invite.seniorId, memberId: invite.memberId || null, kind: invite.kind || "" };
};

exports.declineCareCircleInvite = async (request) => {
  const { uid, user } = await security.requireActiveUser(request);
  const email = emailOf(request);
  const { inviteId } = request.data || {};
  if (!inviteId) throw new HttpsError("invalid-argument", "inviteId is required.");

  const inviteRef = db().doc(`${INVITES}/${inviteId}`);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw new HttpsError("not-found", "Invitation not found.");
  const invite = inviteSnap.data();
  if (!inviteMatchesUser(invite, user, email)) {
    throw new HttpsError("permission-denied", "This invitation is not for you.");
  }

  const now = new Date();
  await inviteRef.update({ status: INVITE.DECLINED, respondedAt: now, updatedAt: now });
  if (invite.memberId) {
    await db().doc(`${MEMBERS}/${invite.memberId}`).set({
      status: STATUS.DECLINED,
      respondedAt: now,
      updatedAt: now,
    }, { merge: true });
  }
  logger.info("Care circle invite declined", { uid, inviteId });
  await notifications.notifyPeople([{ userId: invite.invitedBy }], {
    type: notifications.TYPES.INVITATION_DECLINED,
    title: `${user.displayName || email} declined the invitation`,
    body: `${user.displayName || email} declined to join ${invite.seniorName || "the circle"}.`,
    seniorId: invite.seniorId,
    inviteId,
    actorId: uid,
    actorName: user.displayName || "",
  }, uid);
  return { ok: true };
};

exports.removeCareCircleMember = async (request) => {
  const { seniorId, memberId } = request.data || {};
  if (!seniorId || !memberId) {
    throw new HttpsError("invalid-argument", "seniorId and memberId are required.");
  }

  const { uid, senior } = await security.requireHousehold(
    request,
    seniorId,
    security.PERMISSIONS.MANAGE_MEMBERS,
  );

  const memberRef = db().doc(`${MEMBERS}/${memberId}`);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw new HttpsError("not-found", "Member not found.");
  const member = memberSnap.data();
  if (member.seniorId !== seniorId) {
    throw new HttpsError("permission-denied", "That person is not on this household.");
  }
  if (member.role === "owner" || member.userId === senior.ownerId) {
    throw new HttpsError("failed-precondition", "The owner cannot be removed.");
  }
  if (member.userId === uid) {
    throw new HttpsError("failed-precondition", "Ask another coordinator to remove you.");
  }

  const now = new Date();
  await memberRef.update({ status: STATUS.REMOVED, updatedAt: now, respondedAt: now });
  const invites = await db().collection(INVITES).where("memberId", "==", memberId).get();
  await Promise.all(invites.docs.map((doc) => {
    if (doc.data().status === INVITE.PENDING) {
      return doc.ref.update({ status: INVITE.REVOKED, respondedAt: now, updatedAt: now });
    }
    return null;
  }));
  if (member.userId) await dropMemberId(seniorId, member.userId);
  logger.info("Care circle member removed", { uid, seniorId, memberId });
  return { ok: true };
};

exports.updateCareCircleMember = async (request) => {
  const { seniorId, memberId, role, permissions, relationship } = request.data || {};
  if (!seniorId || !memberId) {
    throw new HttpsError("invalid-argument", "seniorId and memberId are required.");
  }

  await security.requireHousehold(request, seniorId, security.PERMISSIONS.MANAGE_MEMBERS);
  const memberRef = db().doc(`${MEMBERS}/${memberId}`);
  const snap = await memberRef.get();
  if (!snap.exists || snap.data().seniorId !== seniorId) {
    throw new HttpsError("not-found", "Member not found.");
  }
  const member = snap.data();
  if (member.role === "owner") {
    throw new HttpsError("failed-precondition", "The owner’s access cannot be changed.");
  }

  const nextRole = CIRCLE_ROLES.has(role) ? role : member.role;
  const patch = {
    role: nextRole,
    relationship: relationship != null ? security.textOf(relationship).slice(0, 80) : member.relationship,
    updatedAt: new Date(),
  };
  if (Array.isArray(permissions)) patch.permissions = permissions.slice(0, 20);
  await memberRef.set(patch, { merge: true });
  return { ok: true, memberId };
};

exports.revokeCareCircleInvite = async (request) => {
  const { seniorId, inviteId } = request.data || {};
  if (!inviteId) throw new HttpsError("invalid-argument", "inviteId is required.");

  const inviteRef = db().doc(`${INVITES}/${inviteId}`);
  const snap = await inviteRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Invitation not found.");
  const invite = snap.data();
  const householdId = seniorId || invite.seniorId;
  await security.requireHousehold(request, householdId, security.PERMISSIONS.MANAGE_MEMBERS);
  if (invite.seniorId !== householdId) {
    throw new HttpsError("permission-denied", "That invitation is not for this household.");
  }

  const now = new Date();
  await inviteRef.update({ status: INVITE.REVOKED, respondedAt: now, updatedAt: now });
  if (invite.memberId) {
    const memberRef = db().doc(`${MEMBERS}/${invite.memberId}`);
    const memberSnap = await memberRef.get();
    if (memberSnap.exists && memberSnap.data().status !== STATUS.ACTIVE) {
      await memberRef.set({ status: STATUS.REMOVED, respondedAt: now, updatedAt: now }, { merge: true });
    }
  }
  return { ok: true };
};

exports.resendCareCircleInvite = async (request) => {
  const { inviteId } = request.data || {};
  if (!inviteId) throw new HttpsError("invalid-argument", "inviteId is required.");
  const inviteRef = db().doc(`${INVITES}/${inviteId}`);
  const snap = await inviteRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Invitation not found.");
  const invite = snap.data();
  const { uid, user } = await security.requireHousehold(
    request,
    invite.seniorId,
    security.PERMISSIONS.INVITE_MEMBERS,
  );

  const now = new Date();
  await inviteRef.update({ status: INVITE.PENDING, updatedAt: now });
  if (invite.memberId) {
    await db().doc(`${MEMBERS}/${invite.memberId}`).set({
      status: STATUS.INVITED,
      invitedAt: now,
      respondedAt: null,
      updatedAt: now,
    }, { merge: true });
  }
  const noticeRecipients = invite.inviteeUserId
    ? [{ userId: invite.inviteeUserId, email: invite.email || "" }]
    : (invite.email ? [{ email: invite.email }] : []);
  if (noticeRecipients.length) {
    await notifications.notifyPeople(noticeRecipients, {
      type: notifications.invitationTypeForKind(invite.kind),
      title: `You’re invited to ${invite.seniorName || "a Famielda household"}’s circle`,
      body: `${user.displayName || "A family member"} sent the invitation again.`,
      seniorId: invite.seniorId,
      inviteId,
      inviteToken: invite.token,
      actorId: uid,
      actorName: user.displayName || "",
    }, uid);
  }
  return { ok: true, token: invite.token || inviteId, channel: invite.channel || "email" };
};

exports.ensureOwnerMembership = async (request) => {
  const { seniorId } = request.data || {};
  const { uid, user, senior } = await security.requireSeniorOwner(request, seniorId);
  const members = await listMembers(senior.id);
  const existing = members.find((member) => member.role === "owner" && member.status !== STATUS.REMOVED);
  if (existing) return { ok: true, memberId: existing.id };

  const now = new Date();
  const ref = db().collection(MEMBERS).doc();
  await ref.set({
    seniorId: senior.id,
    userId: uid,
    name: user.displayName || "",
    email: security.emailOf(user.email),
    role: "owner",
    relationship: "Family",
    kind: "family",
    status: STATUS.ACTIVE,
    permissions: Object.values(security.PERMISSIONS),
    createdAt: now,
    updatedAt: now,
  });
  await addMemberId(senior.id, uid);
  return { ok: true, memberId: ref.id };
};
