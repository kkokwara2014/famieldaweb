/**
 * Professional verification — Module 28.
 * Caregivers and health practitioners: pending → under review → verified.
 * Rejected and suspended are admin outcomes. Status writes stay on Cloud Functions.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { logger } = require("firebase-functions");
const notifications = require("./notifications");
const security = require("./security");

const USERS = "users";
const VERIFICATIONS = "professionalVerifications";
const DOCS = "professionalVerificationDocuments";
const AUDIT = "adminAuditLogs";

const ROLES = {
  CAREGIVER: "caregiver",
  PRACTITIONER: "health_practitioner",
  ADMIN: "admin",
};

const STATUS = {
  PENDING: "pending",
  UNDER_REVIEW: "under_review",
  VERIFIED: "verified",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
};

const KINDS = new Set(["identity", "license", "certification", "insurance", "other"]);
const ACTIONS = {
  START_REVIEW: "start_review",
  VERIFY: "verify",
  REJECT: "reject",
  SUSPEND: "suspend",
  RESTORE: "restore",
};

const PROFESSIONAL_ROLES = new Set([ROLES.CAREGIVER, ROLES.PRACTITIONER]);

function db() {
  return getFirestore();
}

function requireUid(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  return request.auth.uid;
}

function textOf(value) {
  return String(value || "").trim();
}

function emailOf(value) {
  return textOf(value).toLowerCase();
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

async function loadUser(uid) {
  const snap = await db().doc(`${USERS}/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { id: snap.id, ...snap.data() };
}

function isProfessional(user) {
  return PROFESSIONAL_ROLES.has(user?.role);
}

function isAdminUser(user) {
  return user?.role === ROLES.ADMIN && user?.status !== "suspended";
}

async function requireProfessional(request) {
  const uid = requireUid(request);
  const user = await loadUser(uid);
  if (!isProfessional(user)) {
    throw new HttpsError("permission-denied", "Verification is for caregivers and health practitioners.");
  }
  if (user.status === "suspended") {
    throw new HttpsError("permission-denied", "This account is suspended.");
  }
  return user;
}

async function requireAdmin(request) {
  const uid = requireUid(request);
  const user = await loadUser(uid);
  if (!isAdminUser(user)) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return user;
}

async function writeAudit(actor, action, payload = {}) {
  await security.writeAudit(actor, action, {
    targetId: payload.targetId || payload.userId,
    targetType: "verification",
    sensitive: true,
    meta: payload,
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

function serializeVerification(doc, documents = []) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  const id = doc.id || data.id || data.userId || "";
  return {
    id,
    userId: data.userId || id,
    email: data.email || "",
    displayName: data.displayName || "",
    role: data.role || "",
    professionalType: data.professionalType || null,
    status: data.status || STATUS.PENDING,
    licenseNumber: data.licenseNumber || "",
    licenseState: data.licenseState || "",
    licenseExpiresAt: data.licenseExpiresAt || "",
    issuer: data.issuer || "",
    notes: data.notes || "",
    reviewNotes: data.reviewNotes || "",
    reviewedBy: data.reviewedBy || "",
    reviewedByName: data.reviewedByName || "",
    reviewedAt: toIso(data.reviewedAt),
    submittedAt: toIso(data.submittedAt),
    verifiedAt: toIso(data.verifiedAt),
    rejectedAt: toIso(data.rejectedAt),
    suspendedAt: toIso(data.suspendedAt),
    previousStatus: data.previousStatus || null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    documents: documents.map(serializeDocument),
  };
}

function serializeDocument(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  return {
    id: doc.id || data.id || "",
    userId: data.userId || "",
    kind: data.kind || "other",
    title: data.title || "",
    notes: data.notes || "",
    fileName: data.fileName || "",
    contentType: data.contentType || "",
    size: Number(data.size) || 0,
    storagePath: data.storagePath || "",
    uploadedAt: toIso(data.uploadedAt || data.createdAt),
    createdAt: toIso(data.createdAt),
  };
}

async function listDocuments(userId) {
  const snap = await db().collection(DOCS).where("userId", "==", userId).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(toIso(b.uploadedAt || b.createdAt) || "").localeCompare(String(toIso(a.uploadedAt || a.createdAt) || "")));
}

function draftFromUser(user) {
  return {
    userId: user.id,
    email: emailOf(user.email),
    displayName: user.displayName || "",
    role: user.role,
    professionalType: user.professionalType || null,
    status: STATUS.PENDING,
    licenseNumber: "",
    licenseState: "",
    licenseExpiresAt: "",
    issuer: "",
    notes: "",
    reviewNotes: "",
    reviewedBy: "",
    reviewedByName: "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function ensureRecord(user) {
  const ref = db().doc(`${VERIFICATIONS}/${user.id}`);
  const snap = await ref.get();
  if (snap.exists) {
    const current = snap.data();
    const patch = {};
    if (current.email !== emailOf(user.email)) patch.email = emailOf(user.email);
    if (current.displayName !== (user.displayName || "")) patch.displayName = user.displayName || "";
    if (current.role !== user.role) patch.role = user.role;
    if ((current.professionalType || null) !== (user.professionalType || null)) {
      patch.professionalType = user.professionalType || null;
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = FieldValue.serverTimestamp();
      await ref.set(patch, { merge: true });
    }
    if (!user.verificationStatus) {
      await db().doc(`${USERS}/${user.id}`).set({
        verificationStatus: current.status || STATUS.PENDING,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return serializeVerification({ id: ref.id, ...current, ...patch }, await listDocuments(user.id));
  }

  const draft = draftFromUser(user);
  await ref.set(draft);
  await db().doc(`${USERS}/${user.id}`).set({
    verificationStatus: STATUS.PENDING,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return serializeVerification({ id: ref.id, ...draft, createdAt: new Date(), updatedAt: new Date() }, []);
}

function submitReady(record, documents) {
  const hasIdentity = documents.some((item) => item.kind === "identity");
  const hasCredential = documents.some((item) => item.kind === "license" || item.kind === "certification");
  const licenseNumber = textOf(record.licenseNumber);
  const missing = [];
  if (!licenseNumber) missing.push("Add a license or certification number.");
  if (!hasIdentity) missing.push("Upload a photo of your identity document.");
  if (!hasCredential) missing.push("Upload a license or certification.");
  return { ok: missing.length === 0, missing };
}

async function notifyAdmins(payload, actorId) {
  const snap = await db().collection(USERS).where("role", "==", ROLES.ADMIN).get();
  const people = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((user) => user.status !== "suspended")
    .map((user) => ({ userId: user.id, email: user.email }));
  return notifications.notifyPeople(people, payload, actorId);
}

async function notifyProfessional(record, payload, actorId) {
  return notifications.notifyPeople(
    [{ userId: record.userId, email: record.email }],
    payload,
    actorId,
  );
}

exports.ensureProfessionalVerification = async (request) => {
  const user = await requireProfessional(request);
  return { verification: await ensureRecord(user) };
};

exports.getMyVerification = async (request) => {
  const user = await requireProfessional(request);
  return { verification: await ensureRecord(user) };
};

exports.saveVerificationProfile = async (request) => {
  const user = await requireProfessional(request);
  const current = await ensureRecord(user);
  if (current.status === STATUS.SUSPENDED) {
    throw new HttpsError("failed-precondition", "A suspended file cannot be edited until an admin restores it.");
  }
  const input = request.data || {};
  const patch = {
    licenseNumber: textOf(input.licenseNumber).slice(0, 80),
    licenseState: textOf(input.licenseState).slice(0, 40),
    licenseExpiresAt: textOf(input.licenseExpiresAt).slice(0, 20),
    issuer: textOf(input.issuer).slice(0, 120),
    notes: textOf(input.notes).slice(0, 2000),
    displayName: user.displayName || current.displayName,
    email: emailOf(user.email),
    role: user.role,
    professionalType: user.professionalType || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db().doc(`${VERIFICATIONS}/${user.id}`).set(patch, { merge: true });
  return { verification: await ensureRecord(user) };
};

exports.addVerificationDocument = async (request) => {
  const user = await requireProfessional(request);
  const current = await ensureRecord(user);
  if (current.status === STATUS.SUSPENDED) {
    throw new HttpsError("failed-precondition", "A suspended file cannot accept new documents.");
  }
  const input = request.data || {};
  const kind = KINDS.has(input.kind) ? input.kind : "other";
  const title = textOf(input.title) || kind;
  const storagePath = textOf(input.storagePath);
  const fileName = textOf(input.fileName);
  if (!storagePath || !fileName) {
    throw new HttpsError("invalid-argument", "Upload a file before saving this document.");
  }
  if (!storagePath.startsWith(`professionals/${user.id}/verification/`)) {
    throw new HttpsError("invalid-argument", "That file does not belong to this verification.");
  }
  const ref = db().collection(DOCS).doc();
  const record = {
    userId: user.id,
    kind,
    title: title.slice(0, 120),
    notes: textOf(input.notes).slice(0, 500),
    fileName: fileName.slice(0, 160),
    contentType: textOf(input.contentType).slice(0, 120),
    size: Number(input.size) || 0,
    storagePath,
    uploadedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(record);
  await db().doc(`${VERIFICATIONS}/${user.id}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { document: serializeDocument({ id: ref.id, ...record, uploadedAt: new Date(), createdAt: new Date() }) };
};

exports.removeVerificationDocument = async (request) => {
  const user = await requireProfessional(request);
  const current = await ensureRecord(user);
  if (current.status === STATUS.SUSPENDED) {
    throw new HttpsError("failed-precondition", "A suspended file cannot be changed.");
  }
  const documentId = textOf(request.data?.documentId);
  if (!documentId) throw new HttpsError("invalid-argument", "documentId is required.");
  const ref = db().doc(`${DOCS}/${documentId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data().userId !== user.id) {
    throw new HttpsError("not-found", "That document could not be found.");
  }
  await ref.delete();
  return { ok: true };
};

exports.submitProfessionalVerification = async (request) => {
  const user = await requireProfessional(request);
  const current = await ensureRecord(user);
  if (![STATUS.PENDING, STATUS.REJECTED].includes(current.status)) {
    throw new HttpsError("failed-precondition", "This file is already in review or verified.");
  }
  const ready = submitReady(current, current.documents);
  if (!ready.ok) {
    throw new HttpsError("failed-precondition", ready.missing[0] || "Add the required documents first.");
  }
  const now = new Date();
  await db().doc(`${VERIFICATIONS}/${user.id}`).set({
    status: STATUS.UNDER_REVIEW,
    submittedAt: now,
    previousStatus: current.status,
    updatedAt: now,
  }, { merge: true });
  await db().doc(`${USERS}/${user.id}`).set({
    verificationStatus: STATUS.UNDER_REVIEW,
    updatedAt: now,
  }, { merge: true });
  const saved = await ensureRecord(user);
  await notifyAdmins({
    type: notifications.TYPES.VERIFICATION || "verification",
    title: `${saved.displayName || "A professional"} submitted verification`,
    body: `${saved.displayName || "Someone"} (${saved.role === ROLES.PRACTITIONER ? "health practitioner" : "caregiver"}) is under review.`,
    href: `/admin/index.html?section=verification&id=${encodeURIComponent(saved.userId)}`,
    entityType: "verification",
    entityId: saved.userId,
  }, user.id);
  logger.info("Verification submitted", { userId: user.id });
  return { verification: saved };
};

exports.listProfessionalVerifications = async (request) => {
  await requireAdmin(request);
  const status = textOf(request.data?.status) || "all";
  const role = textOf(request.data?.role) || "all";
  const query = emailOf(request.data?.query);
  let ref = db().collection(VERIFICATIONS);
  if (status !== "all") ref = ref.where("status", "==", status);
  if (role !== "all") ref = ref.where("role", "==", role);
  const snap = await ref.limit(21).get();
  const hasMore = snap.docs.length > 20;
  let items = snap.docs.slice(0, 20).map((doc) => serializeVerification(doc, []));
  if (status !== "all") items = items.filter((item) => item.status === status);
  if (role !== "all") items = items.filter((item) => item.role === role);
  if (query) {
    items = items.filter((item) => `${item.displayName} ${item.email} ${item.licenseNumber}`.toLowerCase().includes(query));
  }
  items.sort((a, b) => {
    const rank = {
      [STATUS.UNDER_REVIEW]: 0,
      [STATUS.PENDING]: 1,
      [STATUS.REJECTED]: 2,
      [STATUS.SUSPENDED]: 3,
      [STATUS.VERIFIED]: 4,
    };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
      || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  const countStatus = async (value) => {
    const result = await db().collection(VERIFICATIONS).where("status", "==", value).count().get();
    return result.data().count || 0;
  };
  const counts = {
    pending: await countStatus(STATUS.PENDING),
    under_review: await countStatus(STATUS.UNDER_REVIEW),
    verified: await countStatus(STATUS.VERIFIED),
    rejected: await countStatus(STATUS.REJECTED),
    suspended: await countStatus(STATUS.SUSPENDED),
  };
  return { verifications: items, total: items.length, counts, hasMore };
};

exports.getProfessionalVerificationCase = async (request) => {
  await requireAdmin(request);
  const userId = textOf(request.data?.userId);
  if (!userId) throw new HttpsError("invalid-argument", "userId is required.");
  const snap = await db().doc(`${VERIFICATIONS}/${userId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That verification file was not found.");
  return { verification: serializeVerification(snap, await listDocuments(userId)) };
};

exports.reviewProfessionalVerification = async (request) => {
  const admin = await requireAdmin(request);
  const userId = textOf(request.data?.userId);
  const action = textOf(request.data?.action);
  const reviewNotes = textOf(request.data?.notes).slice(0, 2000);
  if (!userId) throw new HttpsError("invalid-argument", "userId is required.");
  if (!Object.values(ACTIONS).includes(action)) {
    throw new HttpsError("invalid-argument", "Choose a review action.");
  }

  const ref = db().doc(`${VERIFICATIONS}/${userId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That verification file was not found.");
  const current = serializeVerification(snap, await listDocuments(userId));
  const now = new Date();
  const patch = {
    reviewedBy: admin.id,
    reviewedByName: admin.displayName || "",
    reviewedAt: now,
    previousStatus: current.status,
    updatedAt: now,
  };
  let nextStatus = current.status;
  let title = "Verification updated";
  let body = "Your professional verification was updated.";

  if (action === ACTIONS.START_REVIEW) {
    if (![STATUS.PENDING, STATUS.REJECTED].includes(current.status)) {
      throw new HttpsError("failed-precondition", "Only pending or rejected files can move into review.");
    }
    nextStatus = STATUS.UNDER_REVIEW;
    patch.submittedAt = current.submittedAt || now;
    title = "Verification is under review";
    body = "Famielda started reviewing your documents.";
  } else if (action === ACTIONS.VERIFY) {
    if (![STATUS.PENDING, STATUS.UNDER_REVIEW, STATUS.REJECTED, STATUS.SUSPENDED].includes(current.status)) {
      throw new HttpsError("failed-precondition", "This file cannot be verified in its current state.");
    }
    nextStatus = STATUS.VERIFIED;
    patch.verifiedAt = now;
    patch.rejectedAt = null;
    patch.suspendedAt = null;
    patch.reviewNotes = reviewNotes;
    title = "You’re verified on Famielda";
    body = "Families can now see that Famielda has verified your credentials.";
  } else if (action === ACTIONS.REJECT) {
    if (![STATUS.PENDING, STATUS.UNDER_REVIEW].includes(current.status)) {
      throw new HttpsError("failed-precondition", "Only files in review can be rejected.");
    }
    if (!reviewNotes) throw new HttpsError("invalid-argument", "Add a short reason so they know what to fix.");
    nextStatus = STATUS.REJECTED;
    patch.rejectedAt = now;
    patch.reviewNotes = reviewNotes;
    title = "Verification was not approved";
    body = reviewNotes;
  } else if (action === ACTIONS.SUSPEND) {
    if (![STATUS.VERIFIED, STATUS.UNDER_REVIEW].includes(current.status)) {
      throw new HttpsError("failed-precondition", "Only verified or in-review professionals can be suspended.");
    }
    if (!reviewNotes) throw new HttpsError("invalid-argument", "Add a reason for the suspension.");
    nextStatus = STATUS.SUSPENDED;
    patch.suspendedAt = now;
    patch.reviewNotes = reviewNotes;
    title = "Your verification was suspended";
    body = reviewNotes;
  } else if (action === ACTIONS.RESTORE) {
    if (current.status !== STATUS.SUSPENDED) {
      throw new HttpsError("failed-precondition", "Only a suspended file can be restored.");
    }
    nextStatus = STATUS.VERIFIED;
    patch.verifiedAt = current.verifiedAt || now;
    patch.suspendedAt = null;
    patch.reviewNotes = reviewNotes;
    title = "Your verification was restored";
    body = "You can accept visits again. Keep your documents current.";
  }

  patch.status = nextStatus;
  await ref.set(patch, { merge: true });
  await db().doc(`${USERS}/${userId}`).set({
    verificationStatus: nextStatus,
    verifiedAt: nextStatus === STATUS.VERIFIED ? now : (current.verifiedAt || null),
    updatedAt: now,
  }, { merge: true });
  await writeAudit(admin, `verification.${action}`, { targetId: userId, notes: reviewNotes, status: nextStatus });
  const saved = serializeVerification({ id: userId, ...snap.data(), ...patch }, current.documents);
  await notifyProfessional(saved, {
    type: "verification",
    title,
    body,
    href: "/app/verification.html",
    entityType: "verification",
    entityId: userId,
  }, admin.id);
  logger.info("Verification reviewed", { admin: admin.id, userId, action, status: nextStatus });
  return { verification: saved };
};

exports.assertEligibleForVisits = async function assertEligibleForVisits(userId, email) {
  if (!userId && !email) return;
  let record = null;
  if (userId) {
    const snap = await db().doc(`${VERIFICATIONS}/${userId}`).get();
    if (snap.exists) record = snap.data();
    if (!record) {
      const userSnap = await db().doc(`${USERS}/${userId}`).get();
      if (userSnap.exists && userSnap.data().verificationStatus === STATUS.SUSPENDED) {
        throw new HttpsError("failed-precondition", "This professional’s verification is suspended.");
      }
    }
  }
  if (!record && email) {
    const snap = await db().collection(VERIFICATIONS).where("email", "==", emailOf(email)).limit(1).get();
    if (!snap.empty) record = snap.docs[0].data();
  }
  if (record?.status === STATUS.SUSPENDED) {
    throw new HttpsError(
      "failed-precondition",
      "This professional’s verification is suspended. They cannot take new visits until Famielda restores them.",
    );
  }
};

exports.onVerificationDocumentDeleted = onDocumentDeleted(
  `${DOCS}/{documentId}`,
  async (event) => {
    const path = event.data?.data()?.storagePath;
    if (!path || String(path).startsWith("local/")) return;
    try {
      await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
    } catch (error) {
      logger.warn("Could not remove verification document object", {
        id: event.params.documentId,
        path,
        message: error.message,
      });
    }
  }
);
