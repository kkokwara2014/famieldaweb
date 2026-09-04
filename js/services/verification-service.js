import {
  AUTH,
  NOTIFICATION_TYPES,
  ROLES,
  VERIFICATION_DOC_KINDS,
  VERIFICATION_REVIEW_ACTIONS,
  VERIFICATION_STATUS,
} from "../config/constants.js";
import {
  VERIFICATION_MAX_BYTES,
  canAddVerificationDocument,
  canSubmitVerification,
  isProfessionalRole,
  submitRequirements,
  verificationStoragePath,
} from "../config/verification.js";
import { createVerification, createVerificationDocument } from "../models/verification.js";
import {
  contentTypeForFile,
  formatFileSize,
  isAllowedDocumentFile,
  isImageDocument,
  isPdfDocument,
  isPreviewableDocument,
  sanitizeFileName,
} from "../config/document.js";
import { professionalTypeLabel } from "../config/roles.js";
import { formatWhen } from "../scheduling/time.js";
import { storage } from "../core/storage.js";
import {
  ensureFirebaseStorage,
  getFirebaseDb,
  getFirebaseStorage,
  getFirestoreSdk,
  getStorageSdk,
  usesLiveAuth,
} from "../core/firebase.js";
import { callCloudFunction } from "../core/functions.js";
import { getSession, setSession } from "../auth/session.js";
import { getMockUser, listMockUsers, updateMockUser } from "../auth/auth-service.js";
import { notifyQuietly } from "./notification-service.js";

const RECORDS_KEY = "professionalVerifications";
const DOCS_KEY = "professionalVerificationDocuments";

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

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function recordFrom(data) {
  return createVerification({
    ...data,
    reviewedAt: toIso(data.reviewedAt),
    submittedAt: toIso(data.submittedAt),
    verifiedAt: toIso(data.verifiedAt),
    rejectedAt: toIso(data.rejectedAt),
    suspendedAt: toIso(data.suspendedAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    documents: Array.isArray(data.documents) ? data.documents.map(docFrom) : [],
  });
}

function docFrom(data) {
  return createVerificationDocument({
    ...data,
    size: Number(data.size) || 0,
    uploadedAt: toIso(data.uploadedAt) || toIso(data.createdAt),
    createdAt: toIso(data.createdAt),
  });
}

function seedRecords() {
  return [
    recordFrom({
      id: "user-caregiver",
      userId: "user-caregiver",
      email: "caregiver@famielda.test",
      displayName: "Maya Chen",
      role: ROLES.CAREGIVER,
      professionalType: "cna",
      status: VERIFICATION_STATUS.VERIFIED,
      licenseNumber: "CNA-48291",
      licenseState: "MD",
      licenseExpiresAt: "2027-04-30",
      issuer: "Maryland Board of Nursing",
      notes: "CNA for in-home personal care. Background check on file with the agency.",
      reviewNotes: "License and ID match. Verified for household care.",
      reviewedBy: "user-admin",
      reviewedByName: "Jordan Hale",
      reviewedAt: "2026-08-12T14:20:00.000Z",
      submittedAt: "2026-08-10T09:15:00.000Z",
      verifiedAt: "2026-08-12T14:20:00.000Z",
      createdAt: "2026-08-08T11:00:00.000Z",
      updatedAt: "2026-08-12T14:20:00.000Z",
    }),
    recordFrom({
      id: "user-practitioner",
      userId: "user-practitioner",
      email: "practitioner@famielda.test",
      displayName: "Dr. Priya Patel",
      role: ROLES.HEALTH_PRACTITIONER,
      professionalType: "md",
      status: VERIFICATION_STATUS.VERIFIED,
      licenseNumber: "D0084412",
      licenseState: "MD",
      licenseExpiresAt: "2028-01-31",
      issuer: "Maryland Board of Physicians",
      notes: "Primary physician following blood pressure and cardiology.",
      reviewNotes: "Active MD license confirmed.",
      reviewedBy: "user-admin",
      reviewedByName: "Jordan Hale",
      reviewedAt: "2026-07-22T10:05:00.000Z",
      submittedAt: "2026-07-20T16:40:00.000Z",
      verifiedAt: "2026-07-22T10:05:00.000Z",
      createdAt: "2026-07-18T08:30:00.000Z",
      updatedAt: "2026-07-22T10:05:00.000Z",
    }),
    recordFrom({
      id: "user-daniel",
      userId: "user-daniel",
      email: "daniel@famielda.test",
      displayName: "Daniel Brooks",
      role: ROLES.CAREGIVER,
      professionalType: "cna",
      status: VERIFICATION_STATUS.PENDING,
      licenseNumber: "",
      licenseState: "MD",
      notes: "New CNA covering weekend shifts.",
      createdAt: "2026-09-01T18:10:00.000Z",
      updatedAt: "2026-09-01T18:10:00.000Z",
    }),
    recordFrom({
      id: "user-rivera",
      userId: "user-rivera",
      email: "rivera@famielda.test",
      displayName: "Nurse Rivera",
      role: ROLES.HEALTH_PRACTITIONER,
      professionalType: "nurse",
      status: VERIFICATION_STATUS.UNDER_REVIEW,
      licenseNumber: "RN-20918",
      licenseState: "MD",
      licenseExpiresAt: "2027-11-15",
      issuer: "Maryland Board of Nursing",
      notes: "Home health RN. Submitted ID and RN license.",
      submittedAt: "2026-09-02T11:40:00.000Z",
      createdAt: "2026-08-28T09:00:00.000Z",
      updatedAt: "2026-09-02T11:40:00.000Z",
    }),
    recordFrom({
      id: "user-omar",
      userId: "user-omar",
      email: "omar@famielda.test",
      displayName: "Omar Torres",
      role: ROLES.CAREGIVER,
      professionalType: "cmt",
      status: VERIFICATION_STATUS.REJECTED,
      licenseNumber: "CMT-1104",
      licenseState: "MD",
      licenseExpiresAt: "2025-12-01",
      issuer: "Maryland Board of Nursing",
      notes: "Medication technician. License photo was cropped.",
      reviewNotes: "The certification photo is cropped and the expiry is unreadable. Upload a full, current card.",
      reviewedBy: "user-admin",
      reviewedByName: "Jordan Hale",
      reviewedAt: "2026-09-01T15:22:00.000Z",
      submittedAt: "2026-08-30T19:05:00.000Z",
      rejectedAt: "2026-09-01T15:22:00.000Z",
      createdAt: "2026-08-29T12:00:00.000Z",
      updatedAt: "2026-09-01T15:22:00.000Z",
    }),
    recordFrom({
      id: "user-aisha",
      userId: "user-aisha",
      email: "aisha@famielda.test",
      displayName: "Alicia Cole",
      role: ROLES.HEALTH_PRACTITIONER,
      professionalType: "physiotherapist",
      status: VERIFICATION_STATUS.SUSPENDED,
      licenseNumber: "PT-77421",
      licenseState: "MD",
      licenseExpiresAt: "2026-10-01",
      issuer: "Maryland Board of Physical Therapy Examiners",
      notes: "Mobility sessions twice a week.",
      reviewNotes: "License renewal lapsed. Suspended until a current card is on file.",
      reviewedBy: "user-admin",
      reviewedByName: "Jordan Hale",
      reviewedAt: "2026-08-26T13:10:00.000Z",
      submittedAt: "2026-06-02T10:00:00.000Z",
      verifiedAt: "2026-06-04T09:30:00.000Z",
      suspendedAt: "2026-08-26T13:10:00.000Z",
      previousStatus: VERIFICATION_STATUS.VERIFIED,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-08-26T13:10:00.000Z",
    }),
  ];
}

function seedDocs() {
  return [
    docFrom({
      id: "vdoc-maya-id",
      userId: "user-caregiver",
      kind: VERIFICATION_DOC_KINDS.IDENTITY,
      title: "Maryland driver’s license",
      fileName: "maya-chen-id.pdf",
      contentType: "application/pdf",
      size: 482112,
      storagePath: "local/maya-chen-id.pdf",
      uploadedAt: "2026-08-10T09:10:00.000Z",
    }),
    docFrom({
      id: "vdoc-maya-cert",
      userId: "user-caregiver",
      kind: VERIFICATION_DOC_KINDS.CERTIFICATION,
      title: "CNA certificate",
      fileName: "maya-chen-cna.pdf",
      contentType: "application/pdf",
      size: 391004,
      storagePath: "local/maya-chen-cna.pdf",
      uploadedAt: "2026-08-10T09:12:00.000Z",
    }),
    docFrom({
      id: "vdoc-priya-license",
      userId: "user-practitioner",
      kind: VERIFICATION_DOC_KINDS.LICENSE,
      title: "MD physician license",
      fileName: "priya-patel-md.pdf",
      contentType: "application/pdf",
      size: 512440,
      storagePath: "local/priya-patel-md.pdf",
      uploadedAt: "2026-07-20T16:38:00.000Z",
    }),
    docFrom({
      id: "vdoc-rivera-id",
      userId: "user-rivera",
      kind: VERIFICATION_DOC_KINDS.IDENTITY,
      title: "State ID",
      fileName: "rivera-id.jpg",
      contentType: "image/jpeg",
      size: 210554,
      storagePath: "local/rivera-id.jpg",
      uploadedAt: "2026-09-02T11:32:00.000Z",
    }),
    docFrom({
      id: "vdoc-rivera-rn",
      userId: "user-rivera",
      kind: VERIFICATION_DOC_KINDS.LICENSE,
      title: "RN license",
      fileName: "rivera-rn.pdf",
      contentType: "application/pdf",
      size: 388221,
      storagePath: "local/rivera-rn.pdf",
      uploadedAt: "2026-09-02T11:36:00.000Z",
    }),
    docFrom({
      id: "vdoc-omar-cert",
      userId: "user-omar",
      kind: VERIFICATION_DOC_KINDS.CERTIFICATION,
      title: "CMT card (cropped)",
      fileName: "omar-cmt.jpg",
      contentType: "image/jpeg",
      size: 144002,
      storagePath: "local/omar-cmt.jpg",
      uploadedAt: "2026-08-30T19:00:00.000Z",
    }),
    docFrom({
      id: "vdoc-aisha-pt",
      userId: "user-aisha",
      kind: VERIFICATION_DOC_KINDS.LICENSE,
      title: "PT license",
      fileName: "aisha-cole-pt.pdf",
      contentType: "application/pdf",
      size: 401228,
      storagePath: "local/aisha-cole-pt.pdf",
      uploadedAt: "2026-06-02T09:50:00.000Z",
    }),
  ];
}

function loadRecords() {
  const existing = storage.get(RECORDS_KEY, null);
  if (Array.isArray(existing) && existing.length) return existing.map(recordFrom);
  const seeded = seedRecords();
  storage.set(RECORDS_KEY, seeded);
  return seeded;
}

function saveRecords(records) {
  storage.set(RECORDS_KEY, records);
  return records;
}

function loadDocs() {
  const existing = storage.get(DOCS_KEY, null);
  if (Array.isArray(existing) && existing.length) return existing.map(docFrom);
  const seeded = seedDocs();
  storage.set(DOCS_KEY, seeded);
  return seeded;
}

function saveDocs(docs) {
  storage.set(DOCS_KEY, docs);
  return docs;
}

function withDocuments(record) {
  const docs = loadDocs().filter((item) => item.userId === record.userId);
  return recordFrom({ ...record, documents: docs });
}

function writeRecord(record) {
  const records = loadRecords();
  const next = recordFrom({ ...record, updatedAt: nowIso() });
  const index = records.findIndex((item) => item.userId === next.userId);
  if (index >= 0) records[index] = next;
  else records.push(next);
  saveRecords(records);
  return withDocuments(next);
}

function syncUser(record) {
  const user = getMockUser(record.userId);
  if (!user) return record;
  updateMockUser({
    ...user,
    verificationStatus: record.status,
    verifiedAt: record.verifiedAt,
  });
  const session = getSession();
  if (session?.id === record.userId) {
    setSession({
      ...session,
      verificationStatus: record.status,
      verifiedAt: record.verifiedAt,
    });
  }
  return record;
}

function draftFor(user) {
  return recordFrom({
    id: user.id,
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    professionalType: user.professionalType,
    status: VERIFICATION_STATUS.PENDING,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

function localEnsure(user) {
  if (!isProfessionalRole(user?.role)) {
    throw new Error("Verification is for caregivers and health practitioners.");
  }
  const existing = loadRecords().find((item) => item.userId === user.id);
  if (existing) {
    const next = writeRecord({
      ...existing,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      professionalType: user.professionalType,
    });
    syncUser(next);
    return next;
  }
  const created = writeRecord(draftFor(user));
  syncUser(created);
  return created;
}

function mapView(record, { now = new Date(), canManage = false } = {}) {
  const documents = (record.documents || []).map((item) => ({
    ...item,
    kindLabel: item.kind === VERIFICATION_DOC_KINDS.IDENTITY
      ? "Identity"
      : item.kind === VERIFICATION_DOC_KINDS.LICENSE
        ? "License"
        : item.kind === VERIFICATION_DOC_KINDS.CERTIFICATION
          ? "Certification"
          : item.kind === VERIFICATION_DOC_KINDS.INSURANCE
            ? "Insurance"
            : "Other",
    sizeLabel: item.size ? formatFileSize(item.size) : "",
    uploadedLabel: item.uploadedAt ? formatWhen(item.uploadedAt, now) : "",
    hasFile: Boolean(item.storagePath || item.fileName),
    isLocal: String(item.storagePath || "").startsWith("local/"),
    canPreview: Boolean(item.storagePath) && !String(item.storagePath).startsWith("local/") && isPreviewableDocument(item),
    canDownload: Boolean(item.storagePath) && !String(item.storagePath).startsWith("local/"),
    isImage: isImageDocument(item),
    isPdf: isPdfDocument(item),
    canDelete: canManage && canAddVerificationDocument(record.status),
  }));
  const requirements = submitRequirements({ ...record, documents });
  return {
    ...record,
    documents,
    credentialLabel: professionalTypeLabel(record.role, record.professionalType),
    canEdit: canAddVerificationDocument(record.status),
    canSubmit: canSubmitVerification(record.status) && requirements.ok,
    canStartReview: record.status === VERIFICATION_STATUS.PENDING || record.status === VERIFICATION_STATUS.REJECTED,
    canVerify: [
      VERIFICATION_STATUS.PENDING,
      VERIFICATION_STATUS.UNDER_REVIEW,
      VERIFICATION_STATUS.REJECTED,
      VERIFICATION_STATUS.SUSPENDED,
    ].includes(record.status),
    canReject: record.status === VERIFICATION_STATUS.PENDING || record.status === VERIFICATION_STATUS.UNDER_REVIEW,
    canSuspend: record.status === VERIFICATION_STATUS.VERIFIED || record.status === VERIFICATION_STATUS.UNDER_REVIEW,
    canRestore: record.status === VERIFICATION_STATUS.SUSPENDED,
    requirements,
  };
}

async function liveCall(name, data) {
  return callCloudFunction(name, data);
}

function assertFile(file) {
  if (!file) throw new Error("Choose a file to upload.");
  if (!isAllowedDocumentFile(file)) throw new Error("Use a PDF, image, Word document, or text file.");
  if (file.size > VERIFICATION_MAX_BYTES) throw new Error("Keep files under 12 MB.");
}

async function uploadPrivateFile(path, file) {
  await ensureFirebaseStorage();
  const bucket = getFirebaseStorage();
  const sdk = getStorageSdk();
  if (!bucket || !sdk) throw new Error("Private document storage is not ready.");
  await sdk.uploadBytes(sdk.ref(bucket, path), file, {
    contentType: contentTypeForFile(file) || "application/pdf",
    cacheControl: "private, max-age=0, no-transform",
    customMetadata: { visibility: "private", purpose: "professional-verification" },
  });
  return path;
}

async function deletePrivateFile(path) {
  if (!path || String(path).startsWith("local/")) return;
  await ensureFirebaseStorage();
  const bucket = getFirebaseStorage();
  const sdk = getStorageSdk();
  if (!bucket || !sdk) return;
  try {
    await sdk.deleteObject(sdk.ref(bucket, path));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") throw error;
  }
}

export async function downloadVerificationFile(path) {
  if (!path || String(path).startsWith("local/")) {
    throw new Error("This sample file is on the demo record only. Uploaded files can be opened here.");
  }
  await ensureFirebaseStorage();
  const bucket = getFirebaseStorage();
  const sdk = getStorageSdk();
  if (!bucket || !sdk) throw new Error("Private document storage is not ready.");
  return sdk.getBlob(sdk.ref(bucket, path));
}

export async function ensureMyVerification(session = getSession()) {
  if (!session?.id || !isProfessionalRole(session.role)) return null;
  if (!usesLiveAuth()) {
    const record = localEnsure(session);
    return mapView(record, { canManage: true });
  }
  const result = await liveCall("ensureProfessionalVerification");
  syncLiveSession(result.verification);
  return mapView(recordFrom(result.verification), { canManage: true });
}

export async function getMyVerification(session = getSession()) {
  return ensureMyVerification(session);
}

export async function saveVerificationProfile(input = {}, session = getSession()) {
  if (!usesLiveAuth()) {
    const current = localEnsure(session);
    if (current.status === VERIFICATION_STATUS.SUSPENDED) {
      throw new Error("A suspended file cannot be edited until an admin restores it.");
    }
    const saved = writeRecord({
      ...current,
      licenseNumber: String(input.licenseNumber || "").trim(),
      licenseState: String(input.licenseState || "").trim(),
      licenseExpiresAt: String(input.licenseExpiresAt || "").trim(),
      issuer: String(input.issuer || "").trim(),
      notes: String(input.notes || "").trim(),
    });
    return mapView(syncUser(saved), { canManage: true });
  }
  const result = await liveCall("saveVerificationProfile", input);
  syncLiveSession(result.verification);
  return mapView(recordFrom(result.verification), { canManage: true });
}

export async function addVerificationDocument({ kind, title, notes, file } = {}, session = getSession()) {
  assertFile(file);
  const safeKind = Object.values(VERIFICATION_DOC_KINDS).includes(kind) ? kind : VERIFICATION_DOC_KINDS.OTHER;
  const label = String(title || "").trim() || sanitizeFileName(file.name);

  if (!usesLiveAuth()) {
    const current = localEnsure(session);
    if (!canAddVerificationDocument(current.status)) {
      throw new Error("This file cannot accept new documents right now.");
    }
    const docs = loadDocs();
    docs.unshift(docFrom({
      id: newId("vdoc"),
      userId: session.id,
      kind: safeKind,
      title: label,
      notes: String(notes || "").trim(),
      fileName: file.name,
      contentType: contentTypeForFile(file),
      size: file.size,
      storagePath: `local/${sanitizeFileName(file.name)}`,
      uploadedAt: nowIso(),
      createdAt: nowIso(),
    }));
    saveDocs(docs);
    const saved = writeRecord(current);
    return mapView(saved, { canManage: true });
  }

  const current = await getMyVerification(session);
  if (!canAddVerificationDocument(current.status)) {
    throw new Error("This file cannot accept new documents right now.");
  }
  const documentId = newId("vdoc");
  const storagePath = verificationStoragePath(session.id, documentId, file.name);
  await uploadPrivateFile(storagePath, file);
  try {
    const result = await liveCall("addVerificationDocument", {
      kind: safeKind,
      title: label,
      notes: String(notes || "").trim(),
      fileName: file.name,
      contentType: contentTypeForFile(file),
      size: file.size,
      storagePath,
    });
    return result.document;
  } catch (error) {
    await deletePrivateFile(storagePath);
    throw error;
  }
}

export async function removeVerificationDocument(documentId, session = getSession()) {
  if (!documentId) throw new Error("Choose a document to remove.");
  if (!usesLiveAuth()) {
    const current = localEnsure(session);
    if (current.status === VERIFICATION_STATUS.SUSPENDED) {
      throw new Error("A suspended file cannot be changed.");
    }
    saveDocs(loadDocs().filter((item) => !(item.id === documentId && item.userId === session.id)));
    return mapView(writeRecord(current), { canManage: true });
  }
  await liveCall("removeVerificationDocument", { documentId });
  return getMyVerification(session);
}

export async function submitMyVerification(session = getSession()) {
  if (!usesLiveAuth()) {
    const current = localEnsure(session);
    if (!canSubmitVerification(current.status)) {
      throw new Error("This file is already in review or verified.");
    }
    const ready = submitRequirements(current);
    if (!ready.ok) throw new Error(ready.missing[0]);
    const saved = writeRecord({
      ...current,
      status: VERIFICATION_STATUS.UNDER_REVIEW,
      submittedAt: nowIso(),
      previousStatus: current.status,
    });
    syncUser(saved);
    const admins = listMockUsers().filter((item) => item.role === ROLES.ADMIN);
    await notifyQuietly(admins.map((item) => ({ userId: item.id, email: item.email })), {
      type: NOTIFICATION_TYPES.VERIFICATION,
      title: `${saved.displayName} submitted verification`,
      body: `${saved.displayName} is under review.`,
      href: `/admin/index.html?section=verification&id=${encodeURIComponent(saved.userId)}`,
      entityType: "verification",
      entityId: saved.userId,
    }, session);
    return mapView(saved, { canManage: true });
  }
  const result = await liveCall("submitProfessionalVerification");
  syncLiveSession(result.verification);
  return mapView(recordFrom(result.verification), { canManage: true });
}

export async function listVerificationQueue({ status = "all", role = "all", query = "" } = {}) {
  if (!usesLiveAuth()) {
    let items = loadRecords().map(withDocuments);
    if (status && status !== "all") items = items.filter((item) => item.status === status);
    if (role && role !== "all") items = items.filter((item) => item.role === role);
    const needle = String(query || "").trim().toLowerCase();
    if (needle) {
      items = items.filter((item) => `${item.displayName} ${item.email} ${item.licenseNumber}`.toLowerCase().includes(needle));
    }
    const all = loadRecords();
    const counts = {
      pending: all.filter((item) => item.status === VERIFICATION_STATUS.PENDING).length,
      under_review: all.filter((item) => item.status === VERIFICATION_STATUS.UNDER_REVIEW).length,
      verified: all.filter((item) => item.status === VERIFICATION_STATUS.VERIFIED).length,
      rejected: all.filter((item) => item.status === VERIFICATION_STATUS.REJECTED).length,
      suspended: all.filter((item) => item.status === VERIFICATION_STATUS.SUSPENDED).length,
    };
    items.sort((a, b) => {
      const rank = {
        [VERIFICATION_STATUS.UNDER_REVIEW]: 0,
        [VERIFICATION_STATUS.PENDING]: 1,
        [VERIFICATION_STATUS.REJECTED]: 2,
        [VERIFICATION_STATUS.SUSPENDED]: 3,
        [VERIFICATION_STATUS.VERIFIED]: 4,
      };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
        || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    return { verifications: items.slice(0, 20).map((item) => mapView(item)), total: items.length, counts };
  }
  const result = await liveCall("listProfessionalVerifications", { status, role, query, limit: 20 });
  return {
    ...result,
    verifications: (result.verifications || []).map((item) => mapView(recordFrom(item))),
  };
}

export async function getVerificationCase(userId) {
  if (!userId) return null;
  if (!usesLiveAuth()) {
    const record = loadRecords().find((item) => item.userId === userId);
    return record ? mapView(withDocuments(record)) : null;
  }
  const result = await liveCall("getProfessionalVerificationCase", { userId });
  return mapView(recordFrom(result.verification));
}

export async function reviewVerification({ userId, action, notes } = {}, session = getSession()) {
  if (!usesLiveAuth()) {
    const current = loadRecords().find((item) => item.userId === userId);
    if (!current) throw new Error("That verification file was not found.");
    const record = withDocuments(current);
    const reviewNotes = String(notes || "").trim();
    let status = record.status;
    const patch = {
      reviewedBy: session?.id || "user-admin",
      reviewedByName: session?.displayName || "Admin",
      reviewedAt: nowIso(),
      previousStatus: record.status,
      reviewNotes: reviewNotes || record.reviewNotes,
    };
    if (action === VERIFICATION_REVIEW_ACTIONS.START_REVIEW) {
      if (![VERIFICATION_STATUS.PENDING, VERIFICATION_STATUS.REJECTED].includes(record.status)) {
        throw new Error("Only pending or rejected files can move into review.");
      }
      status = VERIFICATION_STATUS.UNDER_REVIEW;
      patch.submittedAt = record.submittedAt || nowIso();
    } else if (action === VERIFICATION_REVIEW_ACTIONS.VERIFY) {
      if (![
        VERIFICATION_STATUS.PENDING,
        VERIFICATION_STATUS.UNDER_REVIEW,
        VERIFICATION_STATUS.REJECTED,
        VERIFICATION_STATUS.SUSPENDED,
      ].includes(record.status)) {
        throw new Error("This file cannot be verified in its current state.");
      }
      status = VERIFICATION_STATUS.VERIFIED;
      patch.verifiedAt = nowIso();
      patch.rejectedAt = null;
      patch.suspendedAt = null;
    } else if (action === VERIFICATION_REVIEW_ACTIONS.REJECT) {
      if (![VERIFICATION_STATUS.PENDING, VERIFICATION_STATUS.UNDER_REVIEW].includes(record.status)) {
        throw new Error("Only files in review can be rejected.");
      }
      if (!reviewNotes) throw new Error("Add a short reason so they know what to fix.");
      status = VERIFICATION_STATUS.REJECTED;
      patch.rejectedAt = nowIso();
      patch.reviewNotes = reviewNotes;
    } else if (action === VERIFICATION_REVIEW_ACTIONS.SUSPEND) {
      if (![VERIFICATION_STATUS.VERIFIED, VERIFICATION_STATUS.UNDER_REVIEW].includes(record.status)) {
        throw new Error("Only verified or in-review professionals can be suspended.");
      }
      if (!reviewNotes) throw new Error("Add a reason for the suspension.");
      status = VERIFICATION_STATUS.SUSPENDED;
      patch.suspendedAt = nowIso();
      patch.reviewNotes = reviewNotes;
    } else if (action === VERIFICATION_REVIEW_ACTIONS.RESTORE) {
      if (record.status !== VERIFICATION_STATUS.SUSPENDED) {
        throw new Error("Only a suspended file can be restored.");
      }
      status = VERIFICATION_STATUS.VERIFIED;
      patch.suspendedAt = null;
    } else {
      throw new Error("Choose a review action.");
    }
    const saved = writeRecord({ ...record, ...patch, status });
    syncUser(saved);
    await notifyQuietly([{ userId: saved.userId, email: saved.email }], {
      type: NOTIFICATION_TYPES.VERIFICATION,
      title: status === VERIFICATION_STATUS.VERIFIED
        ? "You’re verified on Famielda"
        : status === VERIFICATION_STATUS.REJECTED
          ? "Verification was not approved"
          : status === VERIFICATION_STATUS.SUSPENDED
            ? "Your verification was suspended"
            : status === VERIFICATION_STATUS.UNDER_REVIEW
              ? "Verification is under review"
              : "Verification updated",
      body: reviewNotes || "Your professional verification was updated.",
      href: "/app/verification.html",
      entityType: "verification",
      entityId: saved.userId,
    }, session);
    return mapView(saved);
  }
  const result = await liveCall("reviewProfessionalVerification", { userId, action, notes });
  return mapView(recordFrom(result.verification));
}

export async function verificationMapFor(people = []) {
  const ids = [...new Set(people.map((item) => item?.userId || item?.id).filter(Boolean))];
  const emails = [...new Set(people.map((item) => String(item?.email || "").trim().toLowerCase()).filter(Boolean))];
  if (!ids.length && !emails.length) return new Map();
  const map = new Map();
  if (!usesLiveAuth()) {
    for (const record of loadRecords()) {
      map.set(record.userId, record.status);
      if (record.email) map.set(`email:${record.email.toLowerCase()}`, record.status);
    }
    return map;
  }
  try {
    const db = getFirebaseDb();
    const sdk = getFirestoreSdk();
    await Promise.all(ids.map(async (id) => {
      const snap = await sdk.getDoc(sdk.doc(db, AUTH.VERIFICATIONS_COLLECTION, id));
      if (snap.exists()) {
        const data = snap.data();
        map.set(id, data.status || VERIFICATION_STATUS.PENDING);
        if (data.email) map.set(`email:${String(data.email).toLowerCase()}`, data.status);
      }
    }));
  } catch {
    return map;
  }
  return map;
}

export function attachVerification(people, map) {
  return (people || []).map((person) => {
    const status = map.get(person.userId)
      || map.get(person.id)
      || map.get(`email:${String(person.email || "").toLowerCase()}`)
      || person.verificationStatus
      || null;
    return { ...person, verificationStatus: status };
  });
}

export async function withVerificationStatus(people = []) {
  const map = await verificationMapFor(people);
  return attachVerification(people, map);
}

export function verificationStatusFor(person, map) {
  if (!person) return null;
  return map?.get(person.userId)
    || map?.get(person.id)
    || map?.get(`email:${String(person.email || "").toLowerCase()}`)
    || person.verificationStatus
    || null;
}

export async function assertProfessionalEligible(person) {
  if (!person) return;
  const status = person.verificationStatus
    || (await verificationMapFor([person])).get(person.userId)
    || (await verificationMapFor([person])).get(`email:${String(person.email || "").toLowerCase()}`);
  if (status === VERIFICATION_STATUS.SUSPENDED) {
    throw new Error("This professional’s verification is suspended. They cannot take new visits until Famielda restores them.");
  }
}

function syncLiveSession(record) {
  const session = getSession();
  if (!session || session.id !== record?.userId) return;
  setSession({
    ...session,
    verificationStatus: record.status,
    verifiedAt: record.verifiedAt,
  });
}

export { emailsEqual };
