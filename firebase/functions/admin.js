/**
 * Famielda Administration — Module 27.
 * Platform reads and operational writes stay on Cloud Functions (Admin SDK).
 * Clients never list every household from Firestore rules.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { logger } = require("firebase-functions");
const notifications = require("./notifications");
const security = require("./security");

const USERS = "users";
const SENIORS = "seniors";
const MEMBERS = "careCircleMembers";
const INVITES = "careCircleInvites";
const SUBSCRIPTIONS = "subscriptions";
const NOTICES = "notifications";
const TICKETS = "supportTickets";
const AUDIT = "adminAuditLogs";
const VISITS = "scheduleVisits";

const ROLES = {
  FAMILY: "family",
  CAREGIVER: "caregiver",
  PRACTITIONER: "health_practitioner",
  ADMIN: "admin",
};

const ASSIGNABLE_ROLES = new Set([
  ROLES.FAMILY,
  ROLES.CAREGIVER,
  ROLES.PRACTITIONER,
  ROLES.ADMIN,
]);

const ACCOUNT = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
};

const SUPPORT = {
  OPEN: "open",
  PENDING: "pending",
  RESOLVED: "resolved",
  CLOSED: "closed",
};

const SUPPORT_STATUSES = new Set(Object.values(SUPPORT));
const SUPPORT_CATEGORIES = new Set(["general", "billing", "account", "care", "technical", "problem"]);
const SUPPORT_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SUPPORT_KINDS = new Set(["contact", "problem", "account", "subscription"]);
const TICKET_WINDOW_MS = 24 * 60 * 60 * 1000;
const TICKET_CAP = 8;
const PAGE_SIZE = 20;
const LIST_CAP = PAGE_SIZE;
const HARD_CAP = 100;

function db() {
  return getFirestore();
}

function clampLimit(value, fallback = PAGE_SIZE) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), HARD_CAP);
}

async function countQuery(query) {
  const snap = await query.count().get();
  return snap.data().count || 0;
}

function requireUid(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
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

function textOf(value) {
  return String(value || "").trim();
}

function emailOf(value) {
  return textOf(value).toLowerCase();
}

function matchesQuery(haystack, query) {
  if (!query) return true;
  return String(haystack || "").toLowerCase().includes(query);
}

async function loadUser(uid) {
  const snap = await db().doc(`${USERS}/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { id: snap.id, uid: snap.id, ...snap.data() };
}

async function requireAdmin(request) {
  const { user } = await security.requireAdmin(request);
  return user;
}

async function writeAudit(actor, action, payload = {}) {
  await security.writeAudit(actor, action, {
    targetId: payload.targetId,
    targetType: payload.targetType,
    seniorId: payload.seniorId,
    patch: payload.patch,
    meta: payload.reason != null ? { reason: payload.reason } : payload.meta,
    sensitive: true,
  });
  await db().collection(AUDIT).doc().set({
    action,
    actorId: actor.id,
    actorName: actor.displayName || "",
    actorEmail: actor.email || "",
    createdAt: FieldValue.serverTimestamp(),
    ...payload,
  });
}

function serializeUser(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  const id = doc.id || data.id || data.uid || "";
  const grant = data.adminGrant && typeof data.adminGrant === "object" ? {
    plan: data.adminGrant.plan || "plus",
    active: Boolean(data.adminGrant.active),
    reason: data.adminGrant.reason || "",
    grantedBy: data.adminGrant.grantedBy || null,
    grantedByName: data.adminGrant.grantedByName || "",
    grantedAt: toIso(data.adminGrant.grantedAt),
  } : null;
  return {
    id,
    email: data.email || "",
    displayName: data.displayName || "",
    role: data.role || null,
    professionalType: data.professionalType || null,
    plan: data.plan || "free",
    subscriptionStatus: data.subscriptionStatus || null,
    subscriptionPeriodEnd: toIso(data.subscriptionPeriodEnd),
    subscriptionCancelAtPeriodEnd: Boolean(data.subscriptionCancelAtPeriodEnd),
    stripeCustomerId: data.stripeCustomerId || null,
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    seniorId: data.seniorId || null,
    emailVerified: Boolean(data.emailVerified),
    verificationStatus: data.verificationStatus || null,
    verifiedAt: toIso(data.verifiedAt),
    photoURL: data.photoURL || null,
    status: data.status || ACCOUNT.ACTIVE,
    suspendedAt: toIso(data.suspendedAt),
    suspendedBy: data.suspendedBy || null,
    suspendedReason: data.suspendedReason || "",
    adminGrant: grant,
    lastLoginAt: toIso(data.lastLoginAt),
    lastLoginPlatform: data.lastLoginPlatform || null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    createdPlatform: data.createdPlatform || null,
  };
}

function serializeSenior(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  const id = doc.id || data.id || "";
  const members = Array.isArray(data.memberIds) ? data.memberIds.filter(Boolean) : [];
  return {
    id,
    displayName: data.displayName || "",
    preferredName: data.preferredName || data.displayName || "",
    location: data.location || "",
    ownerId: data.ownerId || "",
    memberCount: members.length,
    memberIds: members,
    careStatus: data.care?.status || "stable",
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function serializeInvite(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  return {
    id: doc.id || data.id || "",
    email: data.email || "",
    name: data.name || "",
    kind: data.kind || "family",
    role: data.role || "",
    relationship: data.relationship || "",
    status: data.status || "pending",
    seniorId: data.seniorId || "",
    seniorName: data.seniorName || "",
    invitedBy: data.invitedBy || "",
    invitedByName: data.invitedByName || "",
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    respondedAt: toIso(data.respondedAt),
  };
}

function serializeNotice(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  return {
    id: doc.id || data.id || "",
    type: data.type || "system",
    title: data.title || "",
    body: data.body || "",
    userId: data.userId || "",
    email: data.email || "",
    seniorId: data.seniorId || "",
    href: data.href || "",
    read: Boolean(data.read),
    priority: data.priority || "normal",
    createdAt: toIso(data.createdAt),
  };
}

function serializeTicket(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  const replies = Array.isArray(data.replies) ? data.replies.map((reply) => ({
    id: reply.id || "",
    authorId: reply.authorId || "",
    authorName: reply.authorName || "",
    body: reply.body || "",
    internal: Boolean(reply.internal),
    createdAt: toIso(reply.createdAt),
  })) : [];
  return {
    id: doc.id || data.id || "",
    userId: data.userId || "",
    userName: data.userName || "",
    email: data.email || "",
    subject: data.subject || "",
    body: data.body || "",
    category: data.category || "general",
    kind: data.kind || "contact",
    priority: data.priority || "normal",
    status: data.status || SUPPORT.OPEN,
    pageUrl: data.pageUrl || "",
    userAgent: data.userAgent || "",
    source: data.source || "",
    replies,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    resolvedAt: toIso(data.resolvedAt),
    resolvedBy: data.resolvedBy || null,
  };
}

function serializeSubscription(user, billing = null) {
  const grant = user.adminGrant;
  return {
    userId: user.id,
    displayName: user.displayName || "",
    email: user.email || "",
    role: user.role,
    plan: user.plan || "free",
    status: user.subscriptionStatus || billing?.status || null,
    periodEnd: user.subscriptionPeriodEnd || toIso(billing?.currentPeriodEnd),
    cancelAtPeriodEnd: Boolean(user.subscriptionCancelAtPeriodEnd ?? billing?.cancelAtPeriodEnd),
    stripeCustomerId: user.stripeCustomerId || billing?.stripeCustomerId || null,
    stripeSubscriptionId: user.stripeSubscriptionId || billing?.stripeSubscriptionId || null,
    adminGrant: grant && grant.active ? grant : null,
    effectivePlus: Boolean(
      (grant && grant.active)
      || user.plan === "plus"
      || user.plan === "family"
      || user.plan === "circle"
    ),
  };
}

async function listCollection(name, limit = LIST_CAP) {
  const cap = clampLimit(typeof limit === "number" ? limit : LIST_CAP);
  const snap = await db().collection(name).limit(cap).get();
  return snap.docs;
}

async function membershipsForUser(userId, email) {
  const results = [];
  if (userId) {
    const byId = await db().collection(MEMBERS).where("userId", "==", userId).limit(40).get();
    byId.docs.forEach((doc) => results.push({ id: doc.id, ...doc.data() }));
  }
  if (email) {
    const byEmail = await db().collection(MEMBERS).where("email", "==", email).limit(40).get();
    byEmail.docs.forEach((doc) => {
      if (!results.some((item) => item.id === doc.id)) {
        results.push({ id: doc.id, ...doc.data() });
      }
    });
  }
  return results.map((item) => ({
    id: item.id,
    seniorId: item.seniorId || "",
    seniorName: item.seniorName || "",
    kind: item.kind || "",
    role: item.role || "",
    relationship: item.relationship || "",
    status: item.status || "",
    professionalType: item.professionalType || "",
  }));
}

async function membersForSenior(seniorId) {
  const snap = await db().collection(MEMBERS).where("seniorId", "==", seniorId).limit(80).get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      userId: data.userId || "",
      name: data.name || "",
      email: data.email || "",
      kind: data.kind || "",
      role: data.role || "",
      relationship: data.relationship || "",
      status: data.status || "",
      professionalType: data.professionalType || "",
    };
  });
}

function filterUsers(users, { role = "all", status = "all", query = "" } = {}) {
  const needle = emailOf(query);
  return users.filter((user) => {
    if (role && role !== "all" && user.role !== role) return false;
    if (status && status !== "all" && (user.status || ACCOUNT.ACTIVE) !== status) return false;
    if (!needle) return true;
    return matchesQuery(`${user.displayName} ${user.email} ${user.id}`, needle);
  });
}

exports.requireAdmin = requireAdmin;

exports.adminGetOverview = async (request) => {
  const admin = await requireAdmin(request);
  const usersCol = db().collection(USERS);
  const [
    userCount,
    familyCount,
    caregiverCount,
    practitionerCount,
    adminCount,
    plusCount,
    familyPlanCount,
    circlePlanCount,
    suspendedCount,
    seniorCount,
    pendingInvites,
    openTickets,
    visitCount,
    recentUserSnap,
    recentTicketSnap,
  ] = await Promise.all([
    countQuery(usersCol),
    countQuery(usersCol.where("role", "==", ROLES.FAMILY)),
    countQuery(usersCol.where("role", "==", ROLES.CAREGIVER)),
    countQuery(usersCol.where("role", "==", ROLES.PRACTITIONER)),
    countQuery(usersCol.where("role", "==", ROLES.ADMIN)),
    countQuery(usersCol.where("plan", "==", "plus")).catch(() => 0),
    countQuery(usersCol.where("plan", "==", "family")).catch(() => 0),
    countQuery(usersCol.where("plan", "==", "circle")).catch(() => 0),
    countQuery(usersCol.where("status", "==", ACCOUNT.SUSPENDED)).catch(() => 0),
    countQuery(db().collection(SENIORS)),
    countQuery(db().collection(INVITES).where("status", "==", "pending")).catch(() => 0),
    countQuery(db().collection(TICKETS).where("status", "==", SUPPORT.OPEN)).catch(() => 0),
    countQuery(db().collection(VISITS)),
    usersCol.orderBy("createdAt", "desc").limit(6).get().catch(() => usersCol.limit(6).get()),
    db().collection(TICKETS).orderBy("createdAt", "desc").limit(5).get().catch(() => db().collection(TICKETS).limit(5).get()),
  ]);

  const users = recentUserSnap.docs.map(serializeUser);
  const tickets = recentTicketSnap.docs.map(serializeTicket);
  const plus = plusCount + familyPlanCount + circlePlanCount;
  const byRole = {
    family: familyCount,
    caregiver: caregiverCount,
    practitioner: practitionerCount,
    admin: adminCount,
    unset: Math.max(0, userCount - familyCount - caregiverCount - practitionerCount - adminCount),
  };

  await writeAudit(admin, "overview.viewed");
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      users: userCount,
      families: familyCount,
      caregivers: caregiverCount,
      practitioners: practitionerCount,
      admins: adminCount,
      seniors: seniorCount,
      plus,
      free: Math.max(0, userCount - plus),
      suspended: suspendedCount,
      pendingInvites,
      openTickets,
      visits: visitCount,
    },
    byRole,
    recentUsers: users,
    recentTickets: tickets,
  };
};

exports.adminListUsers = async (request) => {
  await requireAdmin(request);
  const { role = "all", status = "all", query = "" } = request.data || {};
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  let queryRef = db().collection(USERS);
  if (role && role !== "all") queryRef = queryRef.where("role", "==", role);
  const snap = await queryRef.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const users = filterUsers(snap.docs.slice(0, limit).map(serializeUser), { role: "all", status, query });
  users.sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
  return { users, total: users.length, hasMore };
};

exports.adminGetUser = async (request) => {
  await requireAdmin(request);
  const userId = textOf(request.data?.userId);
  if (!userId) throw new HttpsError("invalid-argument", "userId is required.");
  const user = serializeUser(await db().doc(`${USERS}/${userId}`).get().then((snap) => {
    if (!snap.exists) throw new HttpsError("not-found", "User not found.");
    return snap;
  }));
  const billingSnap = await db().doc(`${SUBSCRIPTIONS}/${userId}`).get();
  const memberships = await membershipsForUser(user.id, emailOf(user.email));
  const seniors = [];
  for (const member of memberships) {
    if (!member.seniorId) continue;
    const seniorSnap = await db().doc(`${SENIORS}/${member.seniorId}`).get();
    if (seniorSnap.exists) seniors.push(serializeSenior(seniorSnap));
  }
  return {
    user,
    subscription: serializeSubscription(user, billingSnap.exists ? billingSnap.data() : null),
    memberships,
    seniors,
  };
};

exports.adminUpdateUser = async (request) => {
  const admin = await requireAdmin(request);
  const userId = textOf(request.data?.userId);
  if (!userId) throw new HttpsError("invalid-argument", "userId is required.");
  if (userId === admin.id && request.data?.role && request.data.role !== ROLES.ADMIN) {
    throw new HttpsError("failed-precondition", "You cannot change your own admin role.");
  }

  const snap = await db().doc(`${USERS}/${userId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User not found.");
  const current = snap.data();
  const patch = { updatedAt: new Date() };

  if (request.data?.displayName != null) {
    const name = textOf(request.data.displayName);
    if (!name) throw new HttpsError("invalid-argument", "Name cannot be empty.");
    patch.displayName = name;
  }

  if (request.data?.role != null) {
    const role = textOf(request.data.role);
    if (!ASSIGNABLE_ROLES.has(role)) {
      throw new HttpsError("invalid-argument", "That role cannot be assigned.");
    }
    if (current.role === ROLES.ADMIN && role !== ROLES.ADMIN) {
      const admins = await db().collection(USERS).where("role", "==", ROLES.ADMIN).get();
      const remaining = admins.docs.filter((doc) => doc.id !== userId && doc.data()?.status !== ACCOUNT.SUSPENDED);
      if (!remaining.length) {
        throw new HttpsError("failed-precondition", "Famielda needs at least one active admin.");
      }
    }
    patch.role = role;
    if (role === ROLES.FAMILY || role === ROLES.ADMIN) {
      patch.professionalType = null;
    }
  }

  if (request.data?.professionalType != null) {
    patch.professionalType = textOf(request.data.professionalType) || null;
  }

  await db().doc(`${USERS}/${userId}`).set(patch, { merge: true });
  await writeAudit(admin, "user.updated", { targetId: userId, patch: { ...patch, updatedAt: undefined } });
  logger.info("Admin updated user", { admin: admin.id, userId, keys: Object.keys(patch) });
  return { ok: true, user: serializeUser(await db().doc(`${USERS}/${userId}`).get()) };
};

exports.adminSetUserSuspended = async (request) => {
  const admin = await requireAdmin(request);
  const userId = textOf(request.data?.userId);
  const suspended = Boolean(request.data?.suspended);
  const reason = textOf(request.data?.reason);
  if (!userId) throw new HttpsError("invalid-argument", "userId is required.");
  if (userId === admin.id) {
    throw new HttpsError("failed-precondition", "You cannot suspend your own account.");
  }

  const snap = await db().doc(`${USERS}/${userId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User not found.");
  const current = snap.data();

  if (suspended && current.role === ROLES.ADMIN) {
    const admins = await db().collection(USERS).where("role", "==", ROLES.ADMIN).get();
    const remaining = admins.docs.filter((doc) => doc.id !== userId && doc.data()?.status !== ACCOUNT.SUSPENDED);
    if (!remaining.length) {
      throw new HttpsError("failed-precondition", "Famielda needs at least one active admin.");
    }
  }

  const now = new Date();
  const patch = suspended
    ? {
      status: ACCOUNT.SUSPENDED,
      suspendedAt: now,
      suspendedBy: admin.id,
      suspendedReason: reason,
      updatedAt: now,
    }
    : {
      status: ACCOUNT.ACTIVE,
      suspendedAt: null,
      suspendedBy: null,
      suspendedReason: "",
      updatedAt: now,
    };

  await db().doc(`${USERS}/${userId}`).set(patch, { merge: true });

  try {
    await getAuth().updateUser(userId, { disabled: suspended });
  } catch (error) {
    logger.warn("Auth disable did not apply; Firestore status was still saved.", {
      userId,
      message: error.message,
    });
  }

  await writeAudit(admin, suspended ? "user.suspended" : "user.restored", {
    targetId: userId,
    reason,
  });
  logger.info(suspended ? "Admin suspended user" : "Admin restored user", { admin: admin.id, userId });
  return { ok: true, user: serializeUser(await db().doc(`${USERS}/${userId}`).get()) };
};

exports.adminListFamilies = async (request) => {
  await requireAdmin(request);
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  const snap = await db().collection(USERS).where("role", "==", ROLES.FAMILY).limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const users = snap.docs.slice(0, limit).map(serializeUser);
  const households = [];
  for (const user of users) {
    const ownedSnap = await db().collection(SENIORS).where("ownerId", "==", user.id).limit(8).get();
    const owned = ownedSnap.docs.map(serializeSenior);
    households.push({
      ...user,
      households: owned,
      seniorCount: owned.length,
    });
  }
  households.sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
  return { families: households, total: households.length, hasMore };
};

exports.adminListSeniors = async (request) => {
  await requireAdmin(request);
  const query = emailOf(request.data?.query);
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  const snap = await db().collection(SENIORS).limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const seniors = snap.docs.slice(0, limit).map(serializeSenior)
    .filter((senior) => matchesQuery(`${senior.displayName} ${senior.preferredName} ${senior.location}`, query));
  const withOwners = [];
  for (const senior of seniors) {
    const ownerSnap = senior.ownerId ? await db().doc(`${USERS}/${senior.ownerId}`).get() : null;
    const owner = ownerSnap?.exists ? serializeUser(ownerSnap) : null;
    withOwners.push({
      ...senior,
      ownerName: owner?.displayName || "",
      ownerEmail: owner?.email || "",
    });
  }
  withOwners.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  return { seniors: withOwners, total: withOwners.length, hasMore };
};

exports.adminGetSenior = async (request) => {
  await requireAdmin(request);
  const seniorId = textOf(request.data?.seniorId);
  if (!seniorId) throw new HttpsError("invalid-argument", "seniorId is required.");
  const snap = await db().doc(`${SENIORS}/${seniorId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Senior profile not found.");
  const senior = serializeSenior(snap);
  const members = await membersForSenior(seniorId);
  const ownerSnap = senior.ownerId ? await db().doc(`${USERS}/${senior.ownerId}`).get() : null;
  return {
    senior,
    owner: ownerSnap?.exists ? serializeUser(ownerSnap) : null,
    members,
  };
};

exports.adminListProfessionals = async (request) => {
  await requireAdmin(request);
  const role = textOf(request.data?.role) === ROLES.PRACTITIONER ? ROLES.PRACTITIONER : ROLES.CAREGIVER;
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  const snap = await db().collection(USERS).where("role", "==", role).limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const users = snap.docs.slice(0, limit).map(serializeUser);
  const results = [];
  for (const user of users) {
    const memberships = await membershipsForUser(user.id, emailOf(user.email));
    results.push({
      ...user,
      households: memberships.filter((item) => item.status === "active" || item.status === "invited"),
    });
  }
  results.sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
  return { professionals: results, total: results.length, role, hasMore };
};

exports.adminListSubscriptions = async (request) => {
  await requireAdmin(request);
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  const snap = await db().collection(USERS).limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const users = snap.docs.slice(0, limit).map(serializeUser);
  const subscriptions = [];
  for (const user of users) {
    const billingSnap = await db().doc(`${SUBSCRIPTIONS}/${user.id}`).get();
    subscriptions.push(serializeSubscription(user, billingSnap.exists ? billingSnap.data() : null));
  }
  subscriptions.sort((a, b) => Number(b.effectivePlus) - Number(a.effectivePlus) || String(a.displayName).localeCompare(String(b.displayName)));
  return {
    subscriptions,
    total: subscriptions.length,
    plus: subscriptions.filter((item) => item.effectivePlus).length,
    hasMore,
  };
};

exports.adminSetPlanGrant = async (request) => {
  const admin = await requireAdmin(request);
  const userId = textOf(request.data?.userId);
  const grant = Boolean(request.data?.grant);
  const reason = textOf(request.data?.reason);
  if (!userId) throw new HttpsError("invalid-argument", "userId is required.");

  const snap = await db().doc(`${USERS}/${userId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User not found.");

  const now = new Date();
  const adminGrant = grant
    ? {
      plan: "plus",
      active: true,
      reason,
      grantedBy: admin.id,
      grantedByName: admin.displayName || "",
      grantedAt: now,
    }
    : {
      plan: "plus",
      active: false,
      reason,
      grantedBy: admin.id,
      grantedByName: admin.displayName || "",
      grantedAt: now,
    };

  await db().doc(`${USERS}/${userId}`).set({ adminGrant, updatedAt: now }, { merge: true });
  await writeAudit(admin, grant ? "subscription.granted" : "subscription.revoked", { targetId: userId, reason });
  logger.info(grant ? "Admin granted Plus" : "Admin revoked Plus grant", { admin: admin.id, userId });
  return { ok: true, user: serializeUser(await db().doc(`${USERS}/${userId}`).get()) };
};

exports.adminListInvites = async (request) => {
  await requireAdmin(request);
  const status = textOf(request.data?.status) || "all";
  const query = emailOf(request.data?.query);
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  let ref = db().collection(INVITES);
  if (status && status !== "all") ref = ref.where("status", "==", status);
  const snap = await ref.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  let invites = snap.docs.slice(0, limit).map(serializeInvite);
  if (query) {
    invites = invites.filter((item) => matchesQuery(`${item.email} ${item.name} ${item.seniorName}`, query));
  }
  invites.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { invites, total: invites.length, hasMore };
};

exports.adminRevokeInvite = async (request) => {
  const admin = await requireAdmin(request);
  const inviteId = textOf(request.data?.inviteId);
  if (!inviteId) throw new HttpsError("invalid-argument", "inviteId is required.");
  const ref = db().doc(`${INVITES}/${inviteId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Invitation not found.");
  const invite = snap.data();
  if (invite.status !== "pending") {
    throw new HttpsError("failed-precondition", "Only pending invitations can be revoked.");
  }
  const now = new Date();
  await ref.update({ status: "revoked", updatedAt: now, revokedBy: admin.id, revokedAt: now });
  if (invite.memberId) {
    await db().doc(`${MEMBERS}/${invite.memberId}`).set({
      status: "removed",
      updatedAt: now,
    }, { merge: true });
  }
  await writeAudit(admin, "invite.revoked", { targetId: inviteId, seniorId: invite.seniorId || "" });
  return { ok: true };
};

exports.adminGetReports = async (request) => {
  await requireAdmin(request);
  const usersCol = db().collection(USERS);
  const [
    total,
    family,
    caregiver,
    practitioner,
    adminCount,
    verified,
    suspended,
    seniors,
    pendingInvites,
    acceptedInvites,
    plus,
    familyPlan,
    circlePlan,
    visits,
    notificationsCount,
    openTickets,
  ] = await Promise.all([
    countQuery(usersCol),
    countQuery(usersCol.where("role", "==", ROLES.FAMILY)),
    countQuery(usersCol.where("role", "==", ROLES.CAREGIVER)),
    countQuery(usersCol.where("role", "==", ROLES.PRACTITIONER)),
    countQuery(usersCol.where("role", "==", ROLES.ADMIN)),
    countQuery(usersCol.where("emailVerified", "==", true)).catch(() => 0),
    countQuery(usersCol.where("status", "==", ACCOUNT.SUSPENDED)).catch(() => 0),
    countQuery(db().collection(SENIORS)),
    countQuery(db().collection(INVITES).where("status", "==", "pending")).catch(() => 0),
    countQuery(db().collection(INVITES).where("status", "==", "accepted")).catch(() => 0),
    countQuery(usersCol.where("plan", "==", "plus")).catch(() => 0),
    countQuery(usersCol.where("plan", "==", "family")).catch(() => 0),
    countQuery(usersCol.where("plan", "==", "circle")).catch(() => 0),
    countQuery(db().collection(VISITS)),
    countQuery(db().collection(NOTICES)),
    countQuery(db().collection(TICKETS).where("status", "==", SUPPORT.OPEN)).catch(() => 0),
  ]);
  const plusTotal = plus + familyPlan + circlePlan;
  return {
    generatedAt: new Date().toISOString(),
    users: {
      total,
      family,
      caregiver,
      practitioner,
      admin: adminCount,
      verified,
      suspended,
    },
    households: {
      seniors,
      pendingInvites,
      acceptedInvites,
    },
    billing: {
      plus: plusTotal,
      free: Math.max(0, total - plusTotal),
    },
    activity: {
      visits,
      notifications: notificationsCount,
      openTickets,
    },
  };
};

exports.adminListNotifications = async (request) => {
  await requireAdmin(request);
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  const snap = await db().collection(NOTICES).orderBy("createdAt", "desc").limit(limit + 1).get().catch(async () => (
    db().collection(NOTICES).limit(limit + 1).get()
  ));
  const hasMore = snap.docs.length > limit;
  return { notifications: snap.docs.slice(0, limit).map(serializeNotice), total: Math.min(snap.size, limit), hasMore };
};

exports.adminSendNotification = async (request) => {
  const admin = await requireAdmin(request);
  const title = textOf(request.data?.title);
  const body = textOf(request.data?.body);
  const type = textOf(request.data?.type) || "system";
  const userId = textOf(request.data?.userId);
  const role = textOf(request.data?.role);
  if (!title) throw new HttpsError("invalid-argument", "A title is required.");
  if (!body) throw new HttpsError("invalid-argument", "A message is required.");

  let recipients = [];
  if (userId) {
    const user = serializeUser(await db().doc(`${USERS}/${userId}`).get().then((snap) => {
      if (!snap.exists) throw new HttpsError("not-found", "User not found.");
      return snap;
    }));
    recipients = [{ userId: user.id, email: user.email }];
  } else if (role && role !== "all") {
    const snap = await db().collection(USERS).where("role", "==", role).limit(HARD_CAP).get();
    recipients = snap.docs.map((doc) => ({ userId: doc.id, email: doc.data()?.email || "" }));
  } else {
    const snap = await db().collection(USERS).limit(HARD_CAP).get();
    recipients = snap.docs.map((doc) => ({ userId: doc.id, email: doc.data()?.email || "" }));
  }

  const saved = await notifications.notifyPeople(recipients, {
    type,
    title,
    body,
    href: "/app/notifications.html",
    actorId: admin.id,
    actorName: admin.displayName || "Famielda admin",
    priority: type === "emergency_alert" ? "emergency" : "high",
  });

  await writeAudit(admin, "notification.sent", {
    title,
    recipientCount: saved.length,
    role: role || "",
    targetId: userId || "",
  });
  return { ok: true, sent: saved.length };
};

exports.adminListSupportTickets = async (request) => {
  await requireAdmin(request);
  const status = textOf(request.data?.status) || "all";
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  let ref = db().collection(TICKETS);
  if (status && status !== "all") ref = ref.where("status", "==", status);
  const snap = await ref.orderBy("createdAt", "desc").limit(limit + 1).get().catch(async () => (
    (status && status !== "all" ? db().collection(TICKETS).where("status", "==", status) : db().collection(TICKETS)).limit(limit + 1).get()
  ));
  const hasMore = snap.docs.length > limit;
  const tickets = snap.docs.slice(0, limit).map(serializeTicket);
  tickets.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { tickets, total: tickets.length, hasMore };
};

exports.createSupportTicket = async (request) => {
  const { uid, user } = await security.requireActiveUser(request);
  const subject = textOf(request.data?.subject).slice(0, 140);
  const body = textOf(request.data?.body).slice(0, 4000);
  const category = textOf(request.data?.category) || "general";
  const priority = textOf(request.data?.priority) || "normal";
  const kind = textOf(request.data?.kind) || "contact";
  if (!subject) throw new HttpsError("invalid-argument", "A subject is required.");
  if (subject.length < 4) throw new HttpsError("invalid-argument", "Give the request a short subject.");
  if (!body) throw new HttpsError("invalid-argument", "Describe what you need help with.");
  if (body.length < 12) throw new HttpsError("invalid-argument", "Add a bit more detail so we can help.");
  if (!SUPPORT_CATEGORIES.has(category)) {
    throw new HttpsError("invalid-argument", "That support category is not valid.");
  }
  if (!SUPPORT_PRIORITIES.has(priority)) {
    throw new HttpsError("invalid-argument", "That priority is not valid.");
  }
  if (!SUPPORT_KINDS.has(kind)) {
    throw new HttpsError("invalid-argument", "That support request type is not valid.");
  }

  const recentSnap = await db().collection(TICKETS)
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(TICKET_CAP)
    .get();
  const windowStart = Date.now() - TICKET_WINDOW_MS;
  const recentCount = recentSnap.docs.filter((doc) => {
    const created = doc.data().createdAt;
    const ms = created?.toMillis?.() || (created instanceof Date ? created.getTime() : Date.parse(created) || 0);
    return ms >= windowStart;
  }).length;
  if (recentCount >= TICKET_CAP) {
    throw new HttpsError("resource-exhausted", "You already sent several support requests today. Wait for a reply, or try again tomorrow.");
  }

  const ref = db().collection(TICKETS).doc();
  const now = new Date();
  const record = {
    userId: uid,
    userName: user.displayName || "",
    email: user.email || request.auth.token.email || "",
    subject,
    body,
    category,
    kind,
    priority,
    status: SUPPORT.OPEN,
    pageUrl: textOf(request.data?.pageUrl).slice(0, 500),
    userAgent: textOf(request.data?.userAgent).slice(0, 300),
    replies: [],
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  logger.info("Support ticket created", { uid, ticketId: ref.id, kind, category });
  return { ok: true, ticket: serializeTicket({ id: ref.id, data: () => record }) };
};

exports.submitPublicContact = async (request) => {
  if (textOf(request.data?.website) || textOf(request.data?.companyUrl)) {
    return { ok: true };
  }

  const name = textOf(request.data?.name).slice(0, 120);
  const email = emailOf(request.data?.email);
  const subject = textOf(request.data?.subject).slice(0, 140);
  const body = textOf(request.data?.body).slice(0, 4000);
  const role = textOf(request.data?.role).slice(0, 40);
  const category = textOf(request.data?.category) || "general";
  if (!name) throw new HttpsError("invalid-argument", "Your name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email so we can reply.");
  }
  if (!subject || subject.length < 4) {
    throw new HttpsError("invalid-argument", "Give the message a short subject.");
  }
  if (!body || body.length < 12) {
    throw new HttpsError("invalid-argument", "Add a bit more detail so we can help.");
  }
  const allowedTopics = new Set(["families", "caregivers", "practitioners", "press"]);
  if (category && !SUPPORT_CATEGORIES.has(category) && !allowedTopics.has(category)) {
    throw new HttpsError("invalid-argument", "That topic is not valid.");
  }

  await security.assertRateLimit(`email:${email}`, "contact");

  const ref = db().collection(TICKETS).doc();
  const now = new Date();
  const record = {
    userId: request.auth?.uid || "",
    userName: name,
    email,
    subject,
    body,
    category: SUPPORT_CATEGORIES.has(category) ? category : "general",
    kind: "contact",
    priority: "normal",
    status: SUPPORT.OPEN,
    pageUrl: textOf(request.data?.pageUrl).slice(0, 500),
    userAgent: textOf(request.data?.userAgent).slice(0, 300),
    source: "website",
    audience: role,
    replies: [],
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  await security.writeSystemAudit("support.created", {
    targetId: ref.id,
    targetType: "ticket",
    meta: { source: "website", category: record.category },
  });
  logger.info("Public contact received", { ticketId: ref.id, email });
  return { ok: true, ticket: serializeTicket({ id: ref.id, data: () => record }) };
};

exports.adminCreateSupportTicket = async (request) => {
  const admin = await requireAdmin(request);
  const subject = textOf(request.data?.subject);
  const body = textOf(request.data?.body);
  const email = emailOf(request.data?.email);
  const userId = textOf(request.data?.userId);
  if (!subject || !body) {
    throw new HttpsError("invalid-argument", "Subject and details are required.");
  }
  let profile = null;
  if (userId) {
    const snap = await db().doc(`${USERS}/${userId}`).get();
    if (snap.exists) profile = serializeUser(snap);
  }
  const ref = db().collection(TICKETS).doc();
  const now = new Date();
  const record = {
    userId: profile?.id || userId || "",
    userName: profile?.displayName || textOf(request.data?.userName) || "Logged by admin",
    email: profile?.email || email,
    subject,
    body,
    category: textOf(request.data?.category) || "general",
    priority: textOf(request.data?.priority) || "normal",
    status: SUPPORT.OPEN,
    replies: [],
    createdByAdmin: admin.id,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  await writeAudit(admin, "support.created", { targetId: ref.id });
  return { ok: true, ticket: serializeTicket({ id: ref.id, data: () => record }) };
};

exports.adminUpdateSupportTicket = async (request) => {
  const admin = await requireAdmin(request);
  const ticketId = textOf(request.data?.ticketId);
  if (!ticketId) throw new HttpsError("invalid-argument", "ticketId is required.");
  const ref = db().doc(`${TICKETS}/${ticketId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Ticket not found.");
  const current = snap.data();
  const now = new Date();
  const patch = { updatedAt: now };

  if (request.data?.status) {
    const status = textOf(request.data.status);
    if (!SUPPORT_STATUSES.has(status)) {
      throw new HttpsError("invalid-argument", "That ticket status is not valid.");
    }
    patch.status = status;
    if (status === SUPPORT.RESOLVED || status === SUPPORT.CLOSED) {
      patch.resolvedAt = now;
      patch.resolvedBy = admin.id;
    }
  }

  const reply = textOf(request.data?.reply);
  if (reply) {
    const replies = Array.isArray(current.replies) ? [...current.replies] : [];
    replies.push({
      id: `reply-${now.getTime()}`,
      authorId: admin.id,
      authorName: admin.displayName || "Admin",
      body: reply,
      internal: Boolean(request.data?.internal),
      createdAt: now,
    });
    patch.replies = replies;
    if (!patch.status && current.status === SUPPORT.OPEN) patch.status = SUPPORT.PENDING;
  }

  await ref.set(patch, { merge: true });
  await writeAudit(admin, "support.updated", { targetId: ticketId, status: patch.status || current.status });
  return { ok: true, ticket: serializeTicket(await ref.get()) };
};

function serializeAudit(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  return {
    id: doc.id,
    action: data.action || "",
    actorId: data.actorId || "",
    actorName: data.actorName || "",
    actorEmail: data.actorEmail || "",
    actorRole: data.actorRole || "",
    seniorId: data.seniorId || "",
    targetId: data.targetId || "",
    targetType: data.targetType || "",
    ok: data.ok !== false,
    sensitive: Boolean(data.sensitive),
    code: data.code || "",
    message: data.message || "",
    createdAt: toIso(data.createdAt),
    patch: data.patch || null,
    meta: data.meta || null,
  };
}

exports.adminListAuditLogs = async (request) => {
  await requireAdmin(request);
  const action = textOf(request.data?.action);
  const actorId = textOf(request.data?.actorId);
  const query = emailOf(request.data?.query);
  const limit = clampLimit(request.data?.limit, PAGE_SIZE);
  let snap;
  try {
    snap = await db().collection(security.AUDIT).orderBy("createdAt", "desc").limit(limit + 1).get();
  } catch (error) {
    logger.warn("auditLogs query fell back", { message: error.message });
    snap = await db().collection(security.AUDIT).limit(limit + 1).get();
  }
  const hasMore = snap.docs.length > limit;
  let logs = snap.docs.slice(0, limit).map(serializeAudit);
  if (action && action !== "all") logs = logs.filter((item) => item.action === action || item.action.startsWith(`${action}.`));
  if (actorId) logs = logs.filter((item) => item.actorId === actorId);
  if (query) {
    logs = logs.filter((item) => matchesQuery(`${item.actorName} ${item.actorEmail} ${item.action} ${item.targetId} ${item.seniorId}`, query));
  }
  logs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { logs, total: logs.length, hasMore };
};
