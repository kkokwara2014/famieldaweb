/**
 * Family Referral — Module 30.
 * Invite relatives to join Famielda. Writes stay on Cloud Functions.
 * A 30-day Plus trial is scaffolded behind FAMILY_REFERRAL_PLUS_TRIAL_ENABLED.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const notifications = require("./notifications");
const security = require("./security");
const analytics = require("./analytics");

const USERS = "users";
const REFERRALS = "familyReferrals";
const CODES = "familyReferralCodes";
const CODE_INDEX = "familyReferralCodeIndex";

const STATUS = {
  PENDING: "pending",
  JOINED: "joined",
  SUCCESSFUL: "successful",
  REVOKED: "revoked",
};

const CHANNEL = {
  EMAIL: "email",
  LINK: "link",
};

const RELATIONSHIPS = new Set([
  "Daughter",
  "Son",
  "Spouse",
  "Partner",
  "Sibling",
  "Parent",
  "Grandchild",
  "Grandparent",
  "Niece",
  "Nephew",
  "Aunt",
  "Uncle",
  "Cousin",
  "In-law",
  "Other family",
]);

const PLUS_TRIAL_DAYS = 30;
const PLUS_TRIAL_ENABLED = false;
const MAX_PENDING = 20;
const MAX_PER_DAY = 15;
const RESEND_COOLDOWN_MS = 45_000;

function db() {
  return getFirestore();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  return null;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function randomSuffix(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function codeFromName(name) {
  const slug = String(name || "FAM").replace(/[^a-zA-Z]/g, "").slice(0, 5).toUpperCase() || "FAM";
  return `${slug}-${randomSuffix(4)}`;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "A family member";
}

function serializeReferral(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  const id = doc.id || data.id || "";
  return {
    id,
    code: data.code || "",
    referrerId: data.referrerId || "",
    referrerName: data.referrerName || "",
    referrerEmail: data.referrerEmail || "",
    email: data.email || "",
    name: data.name || "",
    relationship: data.relationship || "",
    message: data.message || "",
    channel: data.channel || CHANNEL.EMAIL,
    status: data.status || STATUS.PENDING,
    inviteeUserId: data.inviteeUserId || null,
    inviteeName: data.inviteeName || "",
    inviteeRole: data.inviteeRole || null,
    joinedAt: toIso(data.joinedAt),
    successfulAt: toIso(data.successfulAt),
    lastSentAt: toIso(data.lastSentAt),
    trialEligible: Boolean(data.trialEligible),
    trialGrantedAt: toIso(data.trialGrantedAt),
    trialEndsAt: toIso(data.trialEndsAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function serializeProfile(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  return {
    userId: doc.id || data.userId || "",
    code: data.code || "",
    displayName: data.displayName || "",
    email: data.email || "",
    invitedCount: Number(data.invitedCount) || 0,
    joinedCount: Number(data.joinedCount) || 0,
    successfulCount: Number(data.successfulCount) || 0,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function countsFrom(items) {
  return {
    invited: items.filter((item) => item.status !== STATUS.REVOKED).length,
    pending: items.filter((item) => item.status === STATUS.PENDING).length,
    joined: items.filter((item) => item.status === STATUS.JOINED || item.status === STATUS.SUCCESSFUL).length,
    successful: items.filter((item) => item.status === STATUS.SUCCESSFUL).length,
  };
}

function trialBanner() {
  return {
    enabled: PLUS_TRIAL_ENABLED,
    days: PLUS_TRIAL_DAYS,
    copy: PLUS_TRIAL_ENABLED
      ? `When a relative joins Famielda as family, you receive a ${PLUS_TRIAL_DAYS}-day Plus trial.`
      : `A ${PLUS_TRIAL_DAYS}-day Famielda Plus trial is planned for successful referrals. Invites work today; the trial is not live yet.`,
  };
}

async function listReferralsFor(referrerId) {
  const snap = await db().collection(REFERRALS).where("referrerId", "==", referrerId).get();
  return snap.docs.map(serializeReferral).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function ensureProfile(user) {
  const ref = db().doc(`${CODES}/${user.id}`);
  const existing = await ref.get();
  if (existing.exists) {
    const profile = serializeProfile(existing);
    if (profile.code && user.referralCode !== profile.code) {
      await db().doc(`${USERS}/${user.id}`).set({ referralCode: profile.code, updatedAt: new Date() }, { merge: true });
    }
    return profile;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = codeFromName(user.displayName);
    const indexRef = db().doc(`${CODE_INDEX}/${code}`);
    try {
      const now = new Date();
      const profile = {
        userId: user.id,
        code,
        displayName: user.displayName || "",
        email: security.emailOf(user.email),
        invitedCount: 0,
        joinedCount: 0,
        successfulCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db().runTransaction(async (tx) => {
        const taken = await tx.get(indexRef);
        if (taken.exists) throw new HttpsError("already-exists", "retry");
        const again = await tx.get(ref);
        if (again.exists) throw new HttpsError("already-exists", "exists");
        tx.set(indexRef, { userId: user.id, code, createdAt: now });
        tx.set(ref, profile);
        tx.set(db().doc(`${USERS}/${user.id}`), { referralCode: code, updatedAt: now }, { merge: true });
      });
      return serializeProfile({ id: user.id, data: () => profile });
    } catch (error) {
      if (error.message === "exists") {
        const snap = await ref.get();
        return serializeProfile(snap);
      }
      if (error.message !== "retry" && error.code !== "already-exists") throw error;
    }
  }
  throw new HttpsError("internal", "Could not create a family referral code.");
}

async function findInviteeByEmail(email) {
  if (!email) return null;
  const snap = await db().collection(USERS).where("email", "==", email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function bumpCounts(referrerId, patch) {
  const ref = db().doc(`${CODES}/${referrerId}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() || {};
  await ref.set({
    invitedCount: Math.max(0, (Number(data.invitedCount) || 0) + (patch.invited || 0)),
    joinedCount: Math.max(0, (Number(data.joinedCount) || 0) + (patch.joined || 0)),
    successfulCount: Math.max(0, (Number(data.successfulCount) || 0) + (patch.successful || 0)),
    updatedAt: new Date(),
  }, { merge: true });
}

async function maybeGrantPlusTrial(referrer, referral) {
  if (!PLUS_TRIAL_ENABLED) {
    return { granted: false, eligible: true };
  }
  const grant = referrer.referralGrant;
  if (grant?.active) {
    const end = grant.expiresAt ? new Date(toIso(grant.expiresAt)).getTime() : 0;
    if (!end || end > Date.now()) return { granted: false, eligible: true, alreadyActive: true };
  }
  if (referrer.plan === "plus" || referrer.plan === "family" || referrer.plan === "circle") {
    return { granted: false, eligible: true, alreadyPlus: true };
  }
  if (referrer.adminGrant?.active) {
    return { granted: false, eligible: true, alreadyPlus: true };
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLUS_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const referralGrant = {
    active: true,
    plan: "plus",
    source: "family_referral",
    grantedAt: now,
    expiresAt,
    referralId: referral.id,
  };
  await db().doc(`${USERS}/${referrer.id}`).set({
    referralGrant,
    updatedAt: now,
  }, { merge: true });
  await db().doc(`${REFERRALS}/${referral.id}`).set({
    trialEligible: true,
    trialGrantedAt: now,
    trialEndsAt: expiresAt,
    updatedAt: now,
  }, { merge: true });
  logger.info("Family referral Plus trial granted", { referrerId: referrer.id, referralId: referral.id });
  return { granted: true, eligible: true, expiresAt: expiresAt.toISOString() };
}

function workspacePayload(profile, referrals, session) {
  const counts = countsFrom(referrals);
  const grant = session?.referralGrant;
  return {
    profile,
    referrals,
    counts,
    trial: {
      ...trialBanner(),
      grantActive: Boolean(grant?.active),
      grantExpiresAt: toIso(grant?.expiresAt),
    },
  };
}

exports.getFamilyReferralWorkspace = async (request) => {
  const { user } = await security.requireActiveUser(request);
  const profile = await ensureProfile(user);
  const referrals = await listReferralsFor(user.id);
  return workspacePayload(profile, referrals, user);
};

exports.resolveFamilyReferralCode = async (request) => {
  const code = normalizeCode(request.data?.code);
  if (!code) throw new HttpsError("invalid-argument", "A referral code is required.");
  const ip = security.textOf(request.rawRequest?.ip || request.rawRequest?.headers?.["x-forwarded-for"]).split(",")[0] || "anon";
  await security.assertRateLimit(`anon_${ip}`, "referral", { max: 30, windowMs: 60 * 60 * 1000, message: "Too many lookup attempts. Try again later." });

  const index = await db().doc(`${CODE_INDEX}/${code}`).get();
  if (!index.exists) {
    throw new HttpsError("not-found", "That family invite is not valid.");
  }
  const userId = index.data()?.userId;
  const profileSnap = userId ? await db().doc(`${CODES}/${userId}`).get() : null;
  const profile = profileSnap?.exists ? serializeProfile(profileSnap) : null;
  return {
    code,
    referrerId: userId || "",
    referrerName: firstName(profile?.displayName),
  };
};

exports.inviteFamilyRelative = async (request) => {
  const { uid, user } = await security.requireActiveUser(request);
  const email = security.emailOf(request.data?.email);
  const name = security.textOf(request.data?.name);
  const relationship = security.textOf(request.data?.relationship);
  const message = security.textOf(request.data?.message).slice(0, 500);
  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "Enter a valid email address.");
  if (!name) throw new HttpsError("invalid-argument", "Enter their name.");
  if (relationship && !RELATIONSHIPS.has(relationship)) {
    throw new HttpsError("invalid-argument", "Choose a family relationship.");
  }
  if (email === security.emailOf(user.email)) {
    throw new HttpsError("failed-precondition", "You cannot invite yourself.");
  }

  const profile = await ensureProfile(user);
  const referrals = await listReferralsFor(uid);
  if (referrals.filter((item) => item.status === STATUS.PENDING).length >= MAX_PENDING) {
    throw new HttpsError("resource-exhausted", "You have too many waiting family invites. Revoke one before sending another.");
  }
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (referrals.filter((item) => new Date(item.createdAt || 0).getTime() >= dayAgo).length >= MAX_PER_DAY) {
    throw new HttpsError("resource-exhausted", "Daily family invite limit reached. Try again tomorrow.");
  }
  const duplicate = referrals.find((item) => (
    item.email === email && (item.status === STATUS.PENDING || item.status === STATUS.JOINED || item.status === STATUS.SUCCESSFUL)
  ));
  if (duplicate) {
    throw new HttpsError("already-exists", "That relative already has a family invite from you.");
  }

  const now = new Date();
  const ref = db().collection(REFERRALS).doc();
  const record = {
    code: profile.code,
    referrerId: uid,
    referrerName: user.displayName || "",
    referrerEmail: security.emailOf(user.email),
    email,
    name,
    relationship: relationship || "Other family",
    message,
    channel: CHANNEL.EMAIL,
    status: STATUS.PENDING,
    inviteeUserId: null,
    inviteeName: "",
    inviteeRole: null,
    lastSentAt: now,
    trialEligible: false,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  await bumpCounts(uid, { invited: 1 });

  const existing = await findInviteeByEmail(email);
  await notifications.notifyPeople([{ email, userId: existing?.id || "" }], {
    type: notifications.TYPES.FAMILY_REFERRAL,
    title: `${firstName(user.displayName)} invited you to Famielda`,
    body: message || "Create an account so your household can coordinate care in one place.",
    href: `/register.html?ref=${encodeURIComponent(profile.code)}`,
    inviteId: ref.id,
    inviteToken: profile.code,
    actorId: uid,
    actorName: user.displayName || "",
    entityType: "family_referral",
    entityId: ref.id,
  }, uid);

  logger.info("Family referral invite created", { uid, referralId: ref.id });
  await analytics.trackInvite(uid, "family", {
    inviteId: ref.id,
    dedupeKey: `family_invited:${ref.id}`,
  });
  return { ok: true, referral: serializeReferral({ id: ref.id, data: () => record }) };
};

exports.resendFamilyReferral = async (request) => {
  const { uid, user } = await security.requireActiveUser(request);
  const referralId = security.textOf(request.data?.referralId);
  if (!referralId) throw new HttpsError("invalid-argument", "referralId is required.");
  const ref = db().doc(`${REFERRALS}/${referralId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That family invite was not found.");
  const referral = snap.data();
  if (referral.referrerId !== uid) throw new HttpsError("permission-denied", "You cannot resend this invite.");
  if (referral.status !== STATUS.PENDING) throw new HttpsError("failed-precondition", "Only waiting invites can be sent again.");
  const last = referral.lastSentAt ? new Date(toIso(referral.lastSentAt)).getTime() : 0;
  if (last && Date.now() - last < RESEND_COOLDOWN_MS) {
    throw new HttpsError("failed-precondition", "Wait a moment before sending that invite again.");
  }
  const now = new Date();
  await ref.set({ lastSentAt: now, updatedAt: now }, { merge: true });
  await notifications.notifyPeople([{ email: referral.email }], {
    type: notifications.TYPES.FAMILY_REFERRAL,
    title: `${firstName(user.displayName)} invited you to Famielda`,
    body: referral.message || "Create an account so your household can coordinate care in one place.",
    href: `/register.html?ref=${encodeURIComponent(referral.code)}`,
    inviteId: referralId,
    inviteToken: referral.code,
    actorId: uid,
    actorName: user.displayName || "",
    entityType: "family_referral",
    entityId: referralId,
  }, uid);
  return { ok: true };
};

exports.revokeFamilyReferral = async (request) => {
  const { uid } = await security.requireActiveUser(request);
  const referralId = security.textOf(request.data?.referralId);
  if (!referralId) throw new HttpsError("invalid-argument", "referralId is required.");
  const ref = db().doc(`${REFERRALS}/${referralId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That family invite was not found.");
  const referral = snap.data();
  if (referral.referrerId !== uid) throw new HttpsError("permission-denied", "You cannot revoke this invite.");
  if (referral.status !== STATUS.PENDING) {
    throw new HttpsError("failed-precondition", "Only waiting invites can be revoked.");
  }
  const now = new Date();
  await ref.set({ status: STATUS.REVOKED, updatedAt: now }, { merge: true });
  return { ok: true };
};

exports.claimFamilyReferral = async (request) => {
  const { uid, user } = await security.requireActiveUser(request);
  const code = normalizeCode(request.data?.code);
  if (!code) throw new HttpsError("invalid-argument", "A referral code is required.");
  if (user.referredBy) {
    return { ok: true, alreadyClaimed: true };
  }
  if (user.referralCode && user.referralCode === code) {
    throw new HttpsError("failed-precondition", "You cannot use your own family invite.");
  }

  const index = await db().doc(`${CODE_INDEX}/${code}`).get();
  if (!index.exists) throw new HttpsError("not-found", "That family invite is not valid.");
  const referrerId = index.data()?.userId;
  if (!referrerId || referrerId === uid) {
    throw new HttpsError("failed-precondition", "You cannot use your own family invite.");
  }

  const email = security.emailOf(user.email);
  const pendingSnap = await db().collection(REFERRALS)
    .where("code", "==", code)
    .where("status", "==", STATUS.PENDING)
    .get();
  let target = pendingSnap.docs.find((doc) => security.emailOf(doc.data()?.email) === email);
  const now = new Date();

  if (!target) {
    const ref = db().collection(REFERRALS).doc();
    const record = {
      code,
      referrerId,
      referrerName: "",
      referrerEmail: "",
      email,
      name: user.displayName || "",
      relationship: "",
      message: "",
      channel: CHANNEL.LINK,
      status: STATUS.JOINED,
      inviteeUserId: uid,
      inviteeName: user.displayName || "",
      inviteeRole: user.role || null,
      joinedAt: now,
      lastSentAt: now,
      trialEligible: false,
      createdAt: now,
      updatedAt: now,
    };
    const referrerSnap = await db().doc(`${USERS}/${referrerId}`).get();
    if (referrerSnap.exists) {
      record.referrerName = referrerSnap.data()?.displayName || "";
      record.referrerEmail = security.emailOf(referrerSnap.data()?.email);
    }
    await ref.set(record);
    target = { id: ref.id, data: () => record };
    await bumpCounts(referrerId, { invited: 1, joined: 1 });
  } else {
    await target.ref.set({
      status: STATUS.JOINED,
      inviteeUserId: uid,
      inviteeName: user.displayName || "",
      inviteeRole: user.role || null,
      joinedAt: now,
      updatedAt: now,
    }, { merge: true });
    await bumpCounts(referrerId, { joined: 1 });
  }

  await db().doc(`${USERS}/${uid}`).set({
    referredBy: referrerId,
    referredByCode: code,
    updatedAt: now,
  }, { merge: true });

  const referrer = await security.loadUser(referrerId);
  await notifications.notifyPeople([{ userId: referrerId, email: referrer.email }], {
    type: notifications.TYPES.FAMILY_REFERRAL_JOINED,
    title: `${firstName(user.displayName)} joined Famielda`,
    body: "Your family invite was used. When they choose Family, this referral is successful.",
    href: "/app/referrals.html",
    actorId: uid,
    actorName: user.displayName || "",
    entityType: "family_referral",
    entityId: target.id,
  }, uid);

  logger.info("Family referral claimed", { uid, referrerId, referralId: target.id });
  const actor = await analytics.actorFields(uid);
  await analytics.trackQuietly({
    name: analytics.NAMES.INVITATION_ACCEPTED,
    ...actor,
    inviteId: target.id,
    inviteKind: "family",
    platform: "server",
    dedupeKey: `invitation_accepted:${target.id}`,
  });
  return { ok: true, referralId: target.id, referrerName: firstName(referrer.displayName) };
};

exports.completeFamilyReferral = async (request) => {
  const { uid, user } = await security.requireActiveUser(request);
  if (!user.referredBy) return { ok: true, completed: false };
  const snap = await db().collection(REFERRALS)
    .where("inviteeUserId", "==", uid)
    .where("status", "==", STATUS.JOINED)
    .limit(4)
    .get();
  if (snap.empty) return { ok: true, completed: false };

  const role = security.textOf(request.data?.role) || user.role;
  const now = new Date();
  let completed = false;
  for (const doc of snap.docs) {
    const patch = { inviteeRole: role || null, updatedAt: now };
    if (role === "family") {
      patch.status = STATUS.SUCCESSFUL;
      patch.successfulAt = now;
      patch.trialEligible = true;
      completed = true;
    }
    await doc.ref.set(patch, { merge: true });
    if (role === "family") {
      await bumpCounts(doc.data().referrerId, { successful: 1 });
      const referrer = await security.loadUser(doc.data().referrerId);
      const grant = await maybeGrantPlusTrial(referrer, { id: doc.id, ...doc.data() });
      await notifications.notifyPeople([{ userId: referrer.id, email: referrer.email }], {
        type: notifications.TYPES.FAMILY_REFERRAL_SUCCESS,
        title: `${firstName(user.displayName)} joined as family`,
        body: grant.granted
          ? `Your family referral is successful. Famielda Plus is on for ${PLUS_TRIAL_DAYS} days.`
          : "Your family referral is successful.",
        href: "/app/referrals.html",
        actorId: uid,
        actorName: user.displayName || "",
        entityType: "family_referral",
        entityId: doc.id,
      }, uid);
    }
  }
  return { ok: true, completed };
};

exports.adminListFamilyReferrals = async (request) => {
  const status = security.textOf(request.data?.status) || "all";
  const query = security.emailOf(request.data?.query);
  let items = (await db().collection(REFERRALS).limit(21).get()).docs.map(serializeReferral);
  if (status !== "all") items = items.filter((item) => item.status === status);
  if (query) {
    items = items.filter((item) => `${item.email} ${item.name} ${item.referrerName} ${item.code}`.toLowerCase().includes(query));
  }
  items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { referrals: items.slice(0, 20), total: items.length, counts: countsFrom(items), trial: trialBanner(), hasMore: items.length > 20 };
};
