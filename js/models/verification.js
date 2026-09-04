import { ROLES, VERIFICATION_DOC_KINDS, VERIFICATION_STATUS } from "../config/constants.js";

export function createVerification(data = {}) {
  return {
    id: data.id ?? data.userId ?? "",
    userId: data.userId ?? data.id ?? "",
    email: data.email ?? "",
    displayName: data.displayName ?? "",
    role: data.role ?? ROLES.CAREGIVER,
    professionalType: data.professionalType ?? null,
    status: data.status ?? VERIFICATION_STATUS.PENDING,
    licenseNumber: data.licenseNumber ?? "",
    licenseState: data.licenseState ?? "",
    licenseExpiresAt: data.licenseExpiresAt ?? "",
    issuer: data.issuer ?? "",
    notes: data.notes ?? "",
    reviewNotes: data.reviewNotes ?? "",
    reviewedBy: data.reviewedBy ?? "",
    reviewedByName: data.reviewedByName ?? "",
    reviewedAt: data.reviewedAt ?? null,
    submittedAt: data.submittedAt ?? null,
    verifiedAt: data.verifiedAt ?? null,
    rejectedAt: data.rejectedAt ?? null,
    suspendedAt: data.suspendedAt ?? null,
    previousStatus: data.previousStatus ?? null,
    documents: Array.isArray(data.documents) ? data.documents.map(createVerificationDocument) : [],
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

export function createVerificationDocument(data = {}) {
  return {
    id: data.id ?? "",
    userId: data.userId ?? "",
    kind: data.kind ?? VERIFICATION_DOC_KINDS.OTHER,
    title: data.title ?? "",
    notes: data.notes ?? "",
    fileName: data.fileName ?? "",
    contentType: data.contentType ?? "",
    size: Number(data.size) || 0,
    storagePath: data.storagePath ?? "",
    uploadedAt: data.uploadedAt ?? data.createdAt ?? null,
    createdAt: data.createdAt ?? null,
  };
}
