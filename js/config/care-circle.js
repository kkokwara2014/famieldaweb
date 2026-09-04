import {
  CARE_CIRCLE_ROLES,
  CIRCLE_KINDS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  INVITE_STATUS,
  PROFESSIONAL_TYPES,
  ROLES,
} from "./constants.js";
import {
  EntitlementError,
  allowedKindsFor,
  entitlementsFor,
  isPlusPlan,
} from "./entitlements.js";

export const CIRCLE_KIND_OPTIONS = [
  {
    id: CIRCLE_KINDS.FAMILY,
    label: "Family Member",
    shortLabel: "Family Member",
    description: "A relative or close person who organizes care for a loved one.",
    plus: false,
  },
  {
    id: CIRCLE_KINDS.CAREGIVER,
    label: "Caregiver",
    shortLabel: "Caregiver",
    description: "Someone who provides hands-on daily support in the home.",
    plus: true,
  },
  {
    id: CIRCLE_KINDS.PRACTITIONER,
    label: "Health Practitioner",
    shortLabel: "Health Practitioner",
    description: "A clinician who supports the household with medical or therapy care.",
    plus: true,
  },
];

export const CIRCLE_ROLE_OPTIONS = [
  {
    id: CARE_CIRCLE_ROLES.COORDINATOR,
    label: "Coordinator",
    description: "Can invite people, edit the profile, and run the week.",
  },
  {
    id: CARE_CIRCLE_ROLES.MEMBER,
    label: "Member",
    description: "Can update the week, message the circle, and see the record.",
  },
  {
    id: CARE_CIRCLE_ROLES.VIEWER,
    label: "Viewer",
    description: "Can see the circle and the week, but cannot change them.",
  },
];

export const CIRCLE_PERMISSION_OPTIONS = [
  { id: CIRCLE_PERMISSIONS.VIEW_PROFILE, label: "View senior profile", locked: true },
  { id: CIRCLE_PERMISSIONS.EDIT_PROFILE, label: "Edit senior profile" },
  { id: CIRCLE_PERMISSIONS.VIEW_SCHEDULE, label: "View the shared week", locked: true },
  { id: CIRCLE_PERMISSIONS.MANAGE_SCHEDULE, label: "Add and change visits" },
  { id: CIRCLE_PERMISSIONS.MESSAGE_CIRCLE, label: "Message the circle" },
  { id: CIRCLE_PERMISSIONS.VIEW_CLINICAL, label: "View clinical notes" },
  { id: CIRCLE_PERMISSIONS.MANAGE_CARE, label: "Create and update care plans" },
  { id: CIRCLE_PERMISSIONS.INVITE_MEMBERS, label: "Invite people" },
  { id: CIRCLE_PERMISSIONS.MANAGE_MEMBERS, label: "Change permissions and remove people" },
];

const ALL_PERMISSIONS = CIRCLE_PERMISSION_OPTIONS.map((item) => item.id);

export const CIRCLE_ROLE_PERMISSIONS = {
  [CARE_CIRCLE_ROLES.OWNER]: ALL_PERMISSIONS,
  [CARE_CIRCLE_ROLES.COORDINATOR]: ALL_PERMISSIONS,
  [CARE_CIRCLE_ROLES.MEMBER]: [
    CIRCLE_PERMISSIONS.VIEW_PROFILE,
    CIRCLE_PERMISSIONS.VIEW_SCHEDULE,
    CIRCLE_PERMISSIONS.MANAGE_SCHEDULE,
    CIRCLE_PERMISSIONS.MESSAGE_CIRCLE,
    CIRCLE_PERMISSIONS.VIEW_CLINICAL,
  ],
  [CARE_CIRCLE_ROLES.VIEWER]: [
    CIRCLE_PERMISSIONS.VIEW_PROFILE,
    CIRCLE_PERMISSIONS.VIEW_SCHEDULE,
    CIRCLE_PERMISSIONS.MESSAGE_CIRCLE,
  ],
};

export const FAMILY_RELATIONSHIPS = [
  "Daughter",
  "Son",
  "Spouse",
  "Partner",
  "Sibling",
  "Grandchild",
  "Parent",
  "Niece",
  "Nephew",
  "Friend",
  "Neighbor",
  "Other",
];

export const CAREGIVER_RELATIONSHIPS = [
  "Home caregiver",
  "Companion",
  "Live-in caregiver",
  "Respite care",
  "Other",
];

export const PRACTITIONER_RELATIONSHIPS = [
  "Primary physician",
  "Nurse",
  "Home health",
  "Physiotherapist",
  "Specialist",
  "Other",
];

export function planCircleLimits(planId) {
  const limits = entitlementsFor(planId);
  return {
    maxMembers: limits.maxFamilyMembers,
    maxFamilyMembers: limits.maxFamilyMembers,
    maxCaregivers: limits.maxCaregivers,
    maxPractitioners: limits.maxPractitioners,
    allowedKinds: allowedKindsFor(planId),
  };
}

export function permissionsForRole(role) {
  return [...(CIRCLE_ROLE_PERMISSIONS[role] ?? CIRCLE_ROLE_PERMISSIONS[CARE_CIRCLE_ROLES.MEMBER])];
}

export function kindOption(kind) {
  return CIRCLE_KIND_OPTIONS.find((item) => item.id === kind) ?? CIRCLE_KIND_OPTIONS[0];
}

export function kindLabel(kind) {
  return kindOption(kind).shortLabel;
}

export function roleOption(role) {
  if (role === CARE_CIRCLE_ROLES.OWNER) {
    return { id: CARE_CIRCLE_ROLES.OWNER, label: "Owner", description: "Holds the household record." };
  }
  return CIRCLE_ROLE_OPTIONS.find((item) => item.id === role) ?? CIRCLE_ROLE_OPTIONS[1];
}

export function roleLabel(role) {
  return roleOption(role).label;
}

export function relationshipsFor(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return CAREGIVER_RELATIONSHIPS;
  if (kind === CIRCLE_KINDS.PRACTITIONER) return PRACTITIONER_RELATIONSHIPS;
  return FAMILY_RELATIONSHIPS;
}

export function defaultRelationship(kind) {
  return relationshipsFor(kind)[0];
}

export function professionalRoleForKind(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return ROLES.CAREGIVER;
  if (kind === CIRCLE_KINDS.PRACTITIONER) return ROLES.HEALTH_PRACTITIONER;
  return null;
}

export function defaultProfessionalType(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return PROFESSIONAL_TYPES.CNA;
  if (kind === CIRCLE_KINDS.PRACTITIONER) return PROFESSIONAL_TYPES.NURSE;
  return null;
}

export function statusLabel(status) {
  const labels = {
    [CIRCLE_STATUS.ACTIVE]: "Active",
    [CIRCLE_STATUS.INVITED]: "Waiting",
    [CIRCLE_STATUS.DECLINED]: "Declined",
    [CIRCLE_STATUS.REMOVED]: "Removed",
    [INVITE_STATUS.PENDING]: "Waiting",
    [INVITE_STATUS.ACCEPTED]: "Active",
    [INVITE_STATUS.REVOKED]: "Revoked",
  };
  return labels[status] ?? "Active";
}

export function statusBadge(status) {
  if (status === CIRCLE_STATUS.ACTIVE || status === INVITE_STATUS.ACCEPTED) return "badge--success";
  if (status === CIRCLE_STATUS.INVITED || status === INVITE_STATUS.PENDING) return "badge--warning";
  if (status === CIRCLE_STATUS.DECLINED || status === INVITE_STATUS.DECLINED) return "badge--danger";
  return "badge--neutral";
}

export function kindBadge(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return "badge--info";
  if (kind === CIRCLE_KINDS.PRACTITIONER) return "badge--accent";
  return "badge--brand";
}

export function permissionSummary(permissions = [], role) {
  if (role === CARE_CIRCLE_ROLES.OWNER) return "Full access";
  const set = new Set(permissions);
  if (set.has(CIRCLE_PERMISSIONS.MANAGE_MEMBERS) || set.has(CIRCLE_PERMISSIONS.INVITE_MEMBERS)) {
    return "Can invite and manage the circle";
  }
  if (set.has(CIRCLE_PERMISSIONS.MANAGE_SCHEDULE) || set.has(CIRCLE_PERMISSIONS.EDIT_PROFILE)) {
    return "Can update the week and the record";
  }
  if (set.has(CIRCLE_PERMISSIONS.VIEW_CLINICAL)) return "Can view the care record";
  return "View only";
}

export function hasPermission(member, permission) {
  return Boolean(member?.permissions?.includes(permission));
}

export { isPlusPlan };

export function kindAllowedOnPlan(planId, kind) {
  return allowedKindsFor(planId).includes(kind);
}

export function occupiesSeat(member) {
  return member?.status === CIRCLE_STATUS.ACTIVE || member?.status === CIRCLE_STATUS.INVITED;
}

export { EntitlementError as CirclePlanError };
