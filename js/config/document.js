import {
  CARE_CIRCLE_ROLES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUS,
  DOCUMENT_VISIBILITY,
  ROLES,
} from "./constants.js";
import { ENTITLEMENT_MESSAGES, hasPlusAccess } from "./entitlements.js";
import { canManageCarePlan } from "./care-plan.js";

export const DOCUMENT_PLUS_MESSAGE = ENTITLEMENT_MESSAGES.documents;

export const DOCUMENT_MAX_BYTES = 12 * 1024 * 1024;

export const DOCUMENT_CATEGORY_OPTIONS = [
  { id: DOCUMENT_CATEGORIES.LEGAL, label: "Legal", hint: "Directives, power of attorney, and papers the family holds." },
  { id: DOCUMENT_CATEGORIES.INSURANCE, label: "Insurance", hint: "Cards and coverage the circle may need at a visit." },
  { id: DOCUMENT_CATEGORIES.CLINICAL, label: "Clinical", hint: "Medication lists, labs, and clinician papers." },
  { id: DOCUMENT_CATEGORIES.IDENTITY, label: "Identity", hint: "IDs and cards that should stay with the family." },
  { id: DOCUMENT_CATEGORIES.OTHER, label: "Household", hint: "Anything else the circle should be able to find." },
];

export const DOCUMENT_VISIBILITY_OPTIONS = [
  {
    id: DOCUMENT_VISIBILITY.CIRCLE,
    label: "Care circle",
    hint: "Everyone on this household can preview and download.",
  },
  {
    id: DOCUMENT_VISIBILITY.FAMILY,
    label: "Family only",
    hint: "Family and the household owner. Caregivers cannot open it.",
  },
  {
    id: DOCUMENT_VISIBILITY.CLINICAL,
    label: "Clinical",
    hint: "Family and health practitioners. Daily caregivers cannot open it.",
  },
];

export const DOCUMENT_STATUS_OPTIONS = [
  { id: DOCUMENT_STATUS.ON_FILE, label: "On file" },
  { id: DOCUMENT_STATUS.NEEDS_REVIEW, label: "Needs review" },
];

export const DOCUMENT_PLUS_FEATURES = [
  { id: "upload", label: "Upload", body: "Keep a private copy in Firebase Storage — not on a public link." },
  { id: "preview", label: "Preview", body: "Open PDFs and images in the hub without leaving the household." },
  { id: "download", label: "Download", body: "Signed-in members with permission can save a copy to their device." },
  { id: "delete", label: "Delete", body: "Remove the file and the record when it should no longer be on file." },
  { id: "categorize", label: "Categorize", body: "Legal, insurance, clinical, identity, or household." },
  { id: "permissions", label: "Permissions", body: "Choose whether the circle, family, or clinicians can open it." },
];

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "txt", "doc", "docx",
]);

const STATUS_BADGE = {
  [DOCUMENT_STATUS.ON_FILE]: "badge--success",
  [DOCUMENT_STATUS.NEEDS_REVIEW]: "badge--warning",
};

const CATEGORY_LABELS = Object.fromEntries(
  DOCUMENT_CATEGORY_OPTIONS.map((item) => [item.id, item.label]),
);

const VISIBILITY_LABELS = Object.fromEntries(
  DOCUMENT_VISIBILITY_OPTIONS.map((item) => [item.id, item.label]),
);

export function documentCategoryLabel(category) {
  return CATEGORY_LABELS[category] ?? "Household";
}

export function documentVisibilityLabel(visibility) {
  return VISIBILITY_LABELS[visibility] ?? "Care circle";
}

export function documentStatusLabel(status) {
  return DOCUMENT_STATUS_OPTIONS.find((item) => item.id === status)?.label ?? "On file";
}

export function documentStatusBadge(status) {
  return STATUS_BADGE[status] ?? "badge--success";
}

export function defaultVisibilityFor(category) {
  if (category === DOCUMENT_CATEGORIES.LEGAL || category === DOCUMENT_CATEGORIES.IDENTITY) {
    return DOCUMENT_VISIBILITY.FAMILY;
  }
  if (category === DOCUMENT_CATEGORIES.CLINICAL) return DOCUMENT_VISIBILITY.CLINICAL;
  return DOCUMENT_VISIBILITY.CIRCLE;
}

export function sessionHasDocumentsPlus(session) {
  return hasPlusAccess(session);
}

export function householdHasDocumentsPlus(session, senior, members = [], ownerPlan) {
  if (session?.role === ROLES.ADMIN) return true;
  if (ownerPlan) return hasPlusAccess({ plan: ownerPlan });
  if (senior?.ownerId && senior.ownerId === session?.id) return sessionHasDocumentsPlus(session);
  const owner = members.find((member) => member.role === CARE_CIRCLE_ROLES.OWNER);
  return Boolean(owner && hasPlusAccess(owner));
}

export function canManageDocuments(session, actor, senior) {
  return canManageCarePlan(session, actor, senior);
}

export function canViewDocument(doc, session, actor, senior) {
  if (!session || !doc) return false;
  if (session.role === ROLES.ADMIN) return true;
  if (senior?.ownerId && senior.ownerId === session.id) return true;
  const visibility = doc.visibility || DOCUMENT_VISIBILITY.CIRCLE;
  if (visibility === DOCUMENT_VISIBILITY.CIRCLE) return true;
  if (visibility === DOCUMENT_VISIBILITY.FAMILY) {
    return session.role === ROLES.FAMILY || actor?.role === CARE_CIRCLE_ROLES.OWNER;
  }
  if (visibility === DOCUMENT_VISIBILITY.CLINICAL) {
    return session.role === ROLES.FAMILY
      || session.role === ROLES.HEALTH_PRACTITIONER
      || actor?.role === CARE_CIRCLE_ROLES.OWNER;
  }
  return false;
}

export function visibilitiesFor(session, actor, senior) {
  if (!session) return [DOCUMENT_VISIBILITY.CIRCLE];
  if (session.role === ROLES.ADMIN || (senior?.ownerId && senior.ownerId === session.id) || session.role === ROLES.FAMILY) {
    return [DOCUMENT_VISIBILITY.CIRCLE, DOCUMENT_VISIBILITY.FAMILY, DOCUMENT_VISIBILITY.CLINICAL];
  }
  if (session.role === ROLES.HEALTH_PRACTITIONER) {
    return [DOCUMENT_VISIBILITY.CIRCLE, DOCUMENT_VISIBILITY.CLINICAL];
  }
  return [DOCUMENT_VISIBILITY.CIRCLE];
}

export function canDeleteDocument(doc, session, actor, senior) {
  if (!canManageDocuments(session, actor, senior)) return false;
  if (session.role === ROLES.ADMIN || (senior?.ownerId && senior.ownerId === session.id)) return true;
  if (doc?.uploadedBy && doc.uploadedBy === session.id) return true;
  return canManageDocuments(session, actor, senior);
}

const EXT_CONTENT_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function contentTypeForFile(file) {
  const type = String(file?.type || "").toLowerCase();
  if (ALLOWED_TYPES.has(type)) return type;
  return EXT_CONTENT_TYPES[fileExtension(file?.name)] || type;
}

export function fileExtension(name = "") {
  const parts = String(name).toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

export function isAllowedDocumentFile(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  const ext = fileExtension(file.name);
  return ALLOWED_TYPES.has(type) || ALLOWED_EXTENSIONS.has(ext);
}

export function isPreviewableDocument(doc) {
  const type = String(doc?.contentType || "").toLowerCase();
  const ext = fileExtension(doc?.fileName);
  return type.startsWith("image/")
    || type === "application/pdf"
    || ext === "pdf"
    || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext);
}

export function isPdfDocument(doc) {
  const type = String(doc?.contentType || "").toLowerCase();
  return type === "application/pdf" || fileExtension(doc?.fileName) === "pdf";
}

export function isImageDocument(doc) {
  const type = String(doc?.contentType || "").toLowerCase();
  return type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(fileExtension(doc?.fileName));
}

export function sanitizeFileName(name = "document") {
  const base = String(name).split(/[/\\]/).pop() || "document";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return (cleaned || "document").slice(0, 120);
}

export function documentStoragePath(seniorId, documentId, fileName) {
  return `seniors/${seniorId}/documents/${documentId}/${sanitizeFileName(fileName)}`;
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function optionHtml(options, selected) {
  return options.map((item) => {
    const value = String(item.id);
    const current = selected == null ? "" : String(selected);
    const selectedAttr = value === current ? " selected" : "";
    return `<option value="${value}"${selectedAttr}>${item.label}</option>`;
  }).join("");
}
