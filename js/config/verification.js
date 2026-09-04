import {
  ROLES,
  VERIFICATION_DOC_KINDS,
  VERIFICATION_REVIEW_ACTIONS,
  VERIFICATION_STATUS,
} from "./constants.js";
import { roleNeedsProfessionalType } from "./roles.js";

export const VERIFICATION_MAX_BYTES = 12 * 1024 * 1024;

export const VERIFICATION_STATUS_OPTIONS = [
  {
    id: VERIFICATION_STATUS.PENDING,
    label: "Pending",
    hint: "Upload credentials so Famielda can review this professional.",
    badge: "badge--warning",
    step: 0,
  },
  {
    id: VERIFICATION_STATUS.UNDER_REVIEW,
    label: "Under review",
    hint: "An admin is reviewing the documents on this file.",
    badge: "badge--info",
    step: 1,
  },
  {
    id: VERIFICATION_STATUS.VERIFIED,
    label: "Verified",
    hint: "Famielda has verified this caregiver or health practitioner.",
    badge: "badge--success",
    step: 2,
  },
  {
    id: VERIFICATION_STATUS.REJECTED,
    label: "Rejected",
    hint: "The last review did not pass. Update the file and resubmit.",
    badge: "badge--danger",
    step: -1,
  },
  {
    id: VERIFICATION_STATUS.SUSPENDED,
    label: "Suspended",
    hint: "This professional cannot take new visits until an admin restores them.",
    badge: "badge--danger",
    step: -1,
  },
];

export const VERIFICATION_FLOW = [
  VERIFICATION_STATUS.PENDING,
  VERIFICATION_STATUS.UNDER_REVIEW,
  VERIFICATION_STATUS.VERIFIED,
];

export const VERIFICATION_DOC_KIND_OPTIONS = [
  {
    id: VERIFICATION_DOC_KINDS.IDENTITY,
    label: "Identity",
    hint: "Government ID or passport that matches the name on this account.",
    required: true,
  },
  {
    id: VERIFICATION_DOC_KINDS.LICENSE,
    label: "License",
    hint: "Active professional license, if your role is licensed.",
    required: false,
  },
  {
    id: VERIFICATION_DOC_KINDS.CERTIFICATION,
    label: "Certification",
    hint: "CNA, CMT, or another credential the household should be able to trust.",
    required: false,
  },
  {
    id: VERIFICATION_DOC_KINDS.INSURANCE,
    label: "Insurance",
    hint: "Liability or malpractice coverage, if you carry it.",
    required: false,
  },
  {
    id: VERIFICATION_DOC_KINDS.OTHER,
    label: "Other",
    hint: "Background check, training, or another paper an admin should see.",
    required: false,
  },
];

const STATUS_META = Object.fromEntries(
  VERIFICATION_STATUS_OPTIONS.map((item) => [item.id, item]),
);

const KIND_LABELS = Object.fromEntries(
  VERIFICATION_DOC_KIND_OPTIONS.map((item) => [item.id, item.label]),
);

export function isProfessionalRole(role) {
  return roleNeedsProfessionalType(role) || role === ROLES.CAREGIVER || role === ROLES.HEALTH_PRACTITIONER;
}

export function normalizeVerificationStatus(status, role) {
  if (!isProfessionalRole(role) && !status) return null;
  return STATUS_META[status] ? status : VERIFICATION_STATUS.PENDING;
}

export function verificationStatusMeta(status) {
  return STATUS_META[status] ?? STATUS_META[VERIFICATION_STATUS.PENDING];
}

export function verificationStatusLabel(status) {
  return verificationStatusMeta(status).label;
}

export function verificationStatusBadge(status) {
  return verificationStatusMeta(status).badge;
}

export function verificationDocKindLabel(kind) {
  return KIND_LABELS[kind] ?? "Document";
}

export function isVerifiedProfessional(user) {
  return isProfessionalRole(user?.role)
    && user?.verificationStatus === VERIFICATION_STATUS.VERIFIED;
}

export function isSuspendedProfessional(user) {
  return isProfessionalRole(user?.role)
    && user?.verificationStatus === VERIFICATION_STATUS.SUSPENDED;
}

export function canEditVerification(status) {
  return [
    VERIFICATION_STATUS.PENDING,
    VERIFICATION_STATUS.REJECTED,
    VERIFICATION_STATUS.UNDER_REVIEW,
    VERIFICATION_STATUS.VERIFIED,
  ].includes(status);
}

export function canSubmitVerification(status) {
  return status === VERIFICATION_STATUS.PENDING || status === VERIFICATION_STATUS.REJECTED;
}

export function canAddVerificationDocument(status) {
  return canEditVerification(status);
}

export function submitRequirements(record = {}) {
  const docs = Array.isArray(record.documents) ? record.documents : [];
  const hasIdentity = docs.some((item) => item.kind === VERIFICATION_DOC_KINDS.IDENTITY);
  const hasCredential = docs.some((item) => (
    item.kind === VERIFICATION_DOC_KINDS.LICENSE
    || item.kind === VERIFICATION_DOC_KINDS.CERTIFICATION
  ));
  const licenseNumber = String(record.licenseNumber || "").trim();
  const missing = [];
  if (!licenseNumber) missing.push("Add a license or certification number.");
  if (!hasIdentity) missing.push("Upload a photo of your identity document.");
  if (!hasCredential) missing.push("Upload a license or certification.");
  return {
    ok: missing.length === 0,
    missing,
    hasIdentity,
    hasCredential,
    licenseNumber: Boolean(licenseNumber),
  };
}

export function verificationBanner(status) {
  if (status === VERIFICATION_STATUS.VERIFIED) {
    return {
      tone: "success",
      title: "You’re verified",
      body: "Families can see the verified badge on your profile. Keep licenses current so this stays in good standing.",
      actionLabel: "View verification",
    };
  }
  if (status === VERIFICATION_STATUS.UNDER_REVIEW) {
    return {
      tone: "info",
      title: "Verification is under review",
      body: "An admin is reviewing your documents. You can keep working with households that already invited you.",
      actionLabel: "View your file",
    };
  }
  if (status === VERIFICATION_STATUS.REJECTED) {
    return {
      tone: "error",
      title: "Verification was not approved",
      body: "Read the review notes, update your documents, and submit again.",
      actionLabel: "Fix and resubmit",
    };
  }
  if (status === VERIFICATION_STATUS.SUSPENDED) {
    return {
      tone: "error",
      title: "Verification is suspended",
      body: "New visits cannot be accepted until an admin restores this account. Existing households still see your name.",
      actionLabel: "See details",
    };
  }
  return {
    tone: "warning",
    title: "Professional verification is pending",
    body: "Upload your ID and credential so families can trust who is walking into the home. This becomes more important as Famielda grows.",
    actionLabel: "Start verification",
  };
}

export function verificationStoragePath(userId, documentId, fileName) {
  const safe = String(fileName || "document").split(/[/\\]/).pop().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `professionals/${userId}/verification/${documentId}/${safe || "document"}`;
}

export function reviewActionLabel(action) {
  if (action === VERIFICATION_REVIEW_ACTIONS.START_REVIEW) return "Start review";
  if (action === VERIFICATION_REVIEW_ACTIONS.VERIFY) return "Verify";
  if (action === VERIFICATION_REVIEW_ACTIONS.REJECT) return "Reject";
  if (action === VERIFICATION_REVIEW_ACTIONS.SUSPEND) return "Suspend";
  if (action === VERIFICATION_REVIEW_ACTIONS.RESTORE) return "Restore";
  return "Review";
}

export function professionalKindLabel(role) {
  if (role === ROLES.HEALTH_PRACTITIONER) return "Health Practitioner";
  if (role === ROLES.CAREGIVER) return "Caregiver";
  return "Professional";
}
