/**
 * Famielda Security — Module 29.
 * Authorization, audit, rate limits, and abuse controls live here.
 * Firestore/Storage rules enforce the data plane. Callables must not trust the client.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");

const USERS = "users";
const SENIORS = "seniors";
const MEMBERS = "careCircleMembers";
const AUDIT = "auditLogs";
const RATE_LIMITS = "rateLimits";

const ROLES = {
  FAMILY: "family",
  CAREGIVER: "caregiver",
  PRACTITIONER: "health_practitioner",
  ADMIN: "admin",
};

const CIRCLE_ROLES = {
  OWNER: "owner",
  COORDINATOR: "coordinator",
  MEMBER: "member",
  VIEWER: "viewer",
};

const PERMISSIONS = {
  VIEW_PROFILE: "view_profile",
  EDIT_PROFILE: "edit_profile",
  VIEW_SCHEDULE: "view_schedule",
  MANAGE_SCHEDULE: "manage_schedule",
  MESSAGE_CIRCLE: "message_circle",
  INVITE_MEMBERS: "invite_members",
  MANAGE_MEMBERS: "manage_members",
  VIEW_CLINICAL: "view_clinical",
  MANAGE_CARE: "manage_care",
};

const ACCOUNT = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
};

const LIMITS = {
  default: { max: 60, windowMs: 60_000, message: "Too many requests. Please wait a moment." },
  invite: { max: 8, windowMs: 60 * 60 * 1000, message: "Too many invitations. Try again later." },
  ticket: { max: 5, windowMs: 60 * 60 * 1000, message: "Too many support requests. Try again later." },
  billing: { max: 10, windowMs: 60 * 60 * 1000, message: "Billing is rate limited. Try again shortly." },
  schedule: { max: 40, windowMs: 60 * 60 * 1000, message: "Too many schedule changes. Try again later." },
  care: { max: 40, windowMs: 60 * 60 * 1000, message: "Too many care-record writes. Try again later." },
  verification: { max: 20, windowMs: 60 * 60 * 1000, message: "Too many verification attempts. Try again later." },
  referral: { max: 12, windowMs: 60 * 60 * 1000, message: "Too many family invites. Try again later." },
  invitePreview: { max: 40, windowMs: 60 * 60 * 1000, message: "Too many invitation lookups. Try again later." },
  admin: { max: 120, windowMs: 60_000, message: "Admin actions are rate limited." },
  notice: { max: 30, windowMs: 60 * 60 * 1000, message: "Too many notifications. Try again later." },
  contact: { max: 5, windowMs: 60 * 60 * 1000, message: "Too many messages from this network. Try again later." },
  referral: { max: 15, windowMs: 60 * 60 * 1000, message: "Too many family invitations. Try again later." },
  monitor: { max: 40, windowMs: 60 * 60 * 1000, message: "Too many monitoring reports. Try again later." },
};

const SENSITIVE_ACTIONS = new Set([
  "circle.invite",
  "circle.accept",
  "circle.decline",
  "circle.remove",
  "circle.update",
  "circle.revoke",
  "user.updated",
  "user.suspended",
  "user.restored",
  "plan.granted",
  "billing.checkout",
  "billing.portal",
  "billing.resume",
  "verification.submit",
  "verification.review",
  "referral.invite",
  "referral.claim",
  "referral.complete",
  "referral.revoke",
  "admin.notification",
  "support.created",
]);

function db() {
  return getFirestore();
}

function textOf(value) {
  return String(value || "").trim();
}

function emailOf(value) {
  return textOf(value).toLowerCase();
}

function phoneOf(value) {
  const raw = textOf(value);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const compact = raw.startsWith("+") ? `+${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : "";
}

function requireUid(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
}

async function loadUser(uid) {
  const snap = await db().doc(`${USERS}/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { id: snap.id, uid: snap.id, ...snap.data() };
}

async function loadSenior(seniorId) {
  const id = textOf(seniorId);
  if (!id) throw new HttpsError("invalid-argument", "A household is required.");
  const snap = await db().doc(`${SENIORS}/${id}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Senior record not found.");
  return { id: snap.id, ...snap.data() };
}

function isSuspended(user) {
  return user?.status === ACCOUNT.SUSPENDED;
}

function isAdminUser(user) {
  return user?.role === ROLES.ADMIN && !isSuspended(user);
}

function isFamilyRole(user) {
  return user?.role === ROLES.FAMILY || user?.role === ROLES.ADMIN;
}

function isClinicalRole(user) {
  return user?.role === ROLES.PRACTITIONER || user?.role === ROLES.FAMILY || user?.role === ROLES.ADMIN;
}

function isSeniorMember(senior, uid) {
  return Boolean(
    senior
    && uid
    && (senior.ownerId === uid || (Array.isArray(senior.memberIds) && senior.memberIds.includes(uid))),
  );
}

function isSeniorOwner(senior, uid) {
  return Boolean(senior && uid && senior.ownerId === uid);
}

async function requireActiveUser(request) {
  const uid = requireUid(request);
  const user = await loadUser(uid);
  if (isSuspended(user)) {
    throw new HttpsError("permission-denied", "This account is suspended.");
  }
  return { uid, user };
}

async function requireAdmin(request) {
  const { uid, user } = await requireActiveUser(request);
  if (!isAdminUser(user)) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return { uid, user, actor: user };
}

function assertRole(user, roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user?.role)) {
    throw new HttpsError("permission-denied", "You do not have access to this action.");
  }
}

async function loadMembership(seniorId, uid, email) {
  const members = db().collection(MEMBERS);
  const byUser = uid
    ? await members.where("seniorId", "==", seniorId).where("userId", "==", uid).limit(4).get()
    : { empty: true, docs: [] };
  let doc = byUser.docs.find((item) => {
    const status = item.data()?.status;
    return status === "active" || status === "invited";
  }) || byUser.docs[0];

  if (!doc && email) {
    const byEmail = await members.where("seniorId", "==", seniorId).where("email", "==", emailOf(email)).limit(4).get();
    doc = byEmail.docs.find((item) => {
      const status = item.data()?.status;
      return status === "active" || status === "invited";
    }) || byEmail.docs[0];
  }

  return doc ? { id: doc.id, ...doc.data() } : null;
}

function circlePermissionsFor(member, senior, uid) {
  if (isSeniorOwner(senior, uid) || member?.role === CIRCLE_ROLES.OWNER) {
    return Object.values(PERMISSIONS);
  }
  if (member?.role === CIRCLE_ROLES.COORDINATOR) {
    return Object.values(PERMISSIONS);
  }
  return Array.isArray(member?.permissions) ? member.permissions : [];
}

function hasCirclePermission(member, senior, uid, permission) {
  if (!permission) return true;
  if (isSeniorOwner(senior, uid) || member?.role === CIRCLE_ROLES.OWNER || member?.role === CIRCLE_ROLES.COORDINATOR) {
    return true;
  }
  return circlePermissionsFor(member, senior, uid).includes(permission);
}

async function requireHousehold(request, seniorId, permission = "") {
  const { uid, user } = await requireActiveUser(request);
  const senior = await loadSenior(seniorId);
  if (isAdminUser(user)) {
    const member = await loadMembership(senior.id, uid, user.email);
    return { uid, user, senior, member, admin: true };
  }
  if (!isSeniorMember(senior, uid)) {
    throw new HttpsError("permission-denied", "You are not on this household.");
  }
  const member = await loadMembership(senior.id, uid, user.email);
  if (permission && !hasCirclePermission(member, senior, uid, permission)) {
    throw new HttpsError("permission-denied", "You do not have permission to do that in this household.");
  }
  return { uid, user, senior, member, admin: false };
}

async function requireSeniorOwner(request, seniorId) {
  const ctx = await requireHousehold(request, seniorId);
  if (ctx.admin || isSeniorOwner(ctx.senior, ctx.uid)) return ctx;
  throw new HttpsError("permission-denied", "Only the household owner can do that.");
}

function redact(data) {
  if (!data || typeof data !== "object") return {};
  const blocked = new Set([
    "password",
    "token",
    "authorization",
    "stripe",
    "secret",
    "idToken",
    "refreshToken",
    "card",
    "ssn",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (blocked.has(lower) || lower.includes("token") || lower.includes("secret") || lower.includes("password")) {
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.slice(0, 240);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map((item) => (typeof item === "string" ? item.slice(0, 80) : item));
    }
  }
  return out;
}

function definedValue(value) {
  return value !== undefined;
}

async function writeAudit(actor, action, payload = {}) {
  const ref = db().collection(AUDIT).doc();
  const record = {
    action: textOf(action) || "unknown",
    actorId: actor?.id || actor?.uid || "",
    actorName: actor?.displayName || "",
    actorEmail: emailOf(actor?.email),
    actorRole: actor?.role || "",
    seniorId: textOf(payload.seniorId),
    targetId: textOf(payload.targetId),
    targetType: textOf(payload.targetType),
    ok: payload.ok !== false,
    sensitive: Boolean(payload.sensitive || SENSITIVE_ACTIONS.has(action)),
    ip: textOf(payload.ip),
    userAgent: textOf(payload.userAgent).slice(0, 180),
    createdAt: FieldValue.serverTimestamp(),
  };
  if (definedValue(payload.code)) record.code = textOf(payload.code);
  if (definedValue(payload.message)) record.message = textOf(payload.message).slice(0, 300);
  if (definedValue(payload.patch)) record.patch = payload.patch;
  if (definedValue(payload.meta)) record.meta = payload.meta;
  await ref.set(record);
  return ref.id;
}

async function writeSystemAudit(action, payload = {}) {
  return writeAudit({ id: "system", displayName: "Famielda", email: "", role: "system" }, action, payload);
}

async function assertRateLimit(uid, bucket = "default", custom = null) {
  const spec = custom || LIMITS[bucket] || LIMITS.default;
  const id = `${textOf(uid)}_${textOf(bucket) || "default"}`.slice(0, 120);
  const ref = db().doc(`${RATE_LIMITS}/${id}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const data = snap.exists ? snap.data() : {};
    const windowStart = typeof data.windowStart === "number" ? data.windowStart : 0;
    const expired = !windowStart || now - windowStart >= spec.windowMs;
    const count = expired ? 0 : Number(data.count) || 0;
    if (count >= spec.max) {
      throw new HttpsError("resource-exhausted", spec.message);
    }
    tx.set(ref, {
      uid,
      bucket,
      count: count + 1,
      windowStart: expired ? now : windowStart,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function requestMeta(request) {
  const raw = request?.rawRequest;
  return {
    ip: textOf(raw?.ip || raw?.headers?.["x-forwarded-for"]).split(",")[0],
    userAgent: textOf(raw?.headers?.["user-agent"]),
  };
}

function functionNameOf(handler, options = {}) {
  return textOf(options.name || handler?.name, 80) || "callable";
}

function recordCallable(payload) {
  try {
    require("./monitoring").recordFunctionLog(payload);
  } catch (error) {
    logger.warn("Function log was not recorded.", { message: error.message });
  }
}

function protect(handler, options = {}) {
  return async (request) => {
    const started = Date.now();
    const name = functionNameOf(handler, options);
    let actor = null;
    if (!options.public) {
      const ctx = options.admin ? await requireAdmin(request) : await requireActiveUser(request);
      actor = ctx.user;
      if (options.roles) assertRole(actor, options.roles);
    }
    if (options.rateLimit !== false) {
      if (actor) {
        await assertRateLimit(actor.id, options.rateLimit || "default", options.limits);
      } else if (options.public && options.rateLimit) {
        const ip = requestMeta(request).ip || "unknown";
        await assertRateLimit(`ip:${ip}`, options.rateLimit, options.limits);
      }
    }
    try {
      const result = await handler(request);
      if (options.audit && actor) {
        await writeAudit(actor, options.audit, {
          ok: true,
          sensitive: Boolean(options.sensitive),
          seniorId: request.data?.seniorId,
          targetId: request.data?.userId
            || request.data?.memberId
            || request.data?.visitId
            || request.data?.inviteId
            || request.data?.documentId
            || request.data?.ticketId,
          targetType: options.targetType || "",
          ...(options.includeInput ? { meta: redact(request.data) } : {}),
          ...requestMeta(request),
        }).catch((auditError) => {
          logger.warn("Could not write action audit", {
            action: options.audit,
            message: auditError.message,
          });
        });
      }
      const durationMs = Date.now() - started;
      if (options.monitor !== false && durationMs >= 2500) {
        recordCallable({
          name,
          ok: true,
          durationMs,
          userId: actor?.id || "",
        });
        logger.info("callable slow", { name, durationMs, uid: actor?.id || "" });
      }
      return result;
    } catch (error) {
      const durationMs = Date.now() - started;
      if (actor && (options.sensitive || options.auditDenied)) {
        await writeAudit(actor, `${options.audit || "call"}.denied`, {
          ok: false,
          sensitive: true,
          code: error.code || "",
          message: error.message || "",
          seniorId: request.data?.seniorId,
          ...requestMeta(request),
        }).catch((auditError) => {
          logger.warn("Could not write denied-action audit", { message: auditError.message });
        });
      }
      if (options.monitor !== false) {
        try {
          const monitoring = require("./monitoring");
          if (monitoring.shouldLogFunction(error, durationMs)) {
            recordCallable({
              name,
              ok: false,
              durationMs,
              code: monitoring.functionCode(error),
              message: error.message || "",
              userId: actor?.id || "",
            });
            logger.error("callable failed", {
              name,
              durationMs,
              code: error.code || "",
              uid: actor?.id || "",
            });
          }
        } catch (monitorError) {
          logger.warn("Function error was not recorded.", { message: monitorError.message });
        }
      }
      throw error;
    }
  };
}

module.exports = {
  USERS,
  SENIORS,
  MEMBERS,
  AUDIT,
  RATE_LIMITS,
  ROLES,
  CIRCLE_ROLES,
  PERMISSIONS,
  ACCOUNT,
  LIMITS,
  SENSITIVE_ACTIONS,
  requireUid,
  loadUser,
  loadSenior,
  loadMembership,
  isSuspended,
  isAdminUser,
  isFamilyRole,
  isClinicalRole,
  isSeniorMember,
  isSeniorOwner,
  hasCirclePermission,
  requireActiveUser,
  requireAdmin,
  requireHousehold,
  requireSeniorOwner,
  assertRole,
  assertRateLimit,
  writeAudit,
  writeSystemAudit,
  redact,
  protect,
  emailOf,
  phoneOf,
  textOf,
};
