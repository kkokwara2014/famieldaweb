import { PROFESSIONAL_TYPES, ROLES } from "./constants.js";

export const SELECTABLE_ROLES = [
  ROLES.FAMILY,
  ROLES.CAREGIVER,
  ROLES.HEALTH_PRACTITIONER,
];

export const ASSIGNED_ROLES = [...SELECTABLE_ROLES, ROLES.ADMIN];

export const ROLE_OPTIONS = [
  {
    id: ROLES.FAMILY,
    label: "Family Member",
    description: "A relative or close person who organizes care for a loved one.",
    needsProfessionalType: false,
  },
  {
    id: ROLES.CAREGIVER,
    label: "Caregiver",
    description: "Someone who provides hands-on daily support in the home.",
    needsProfessionalType: true,
  },
  {
    id: ROLES.HEALTH_PRACTITIONER,
    label: "Health Practitioner",
    description: "A clinician who supports the household with medical or therapy care.",
    needsProfessionalType: true,
  },
];

export const PROFESSIONAL_TYPE_OPTIONS = {
  [ROLES.CAREGIVER]: [
    {
      id: PROFESSIONAL_TYPES.CNA,
      label: "CNA",
      description: "Certified Nursing Assistant — daily living and hands-on care.",
    },
    {
      id: PROFESSIONAL_TYPES.CMT,
      label: "CMT",
      description: "Certified Medication Technician — medication support in the home.",
    },
    {
      id: PROFESSIONAL_TYPES.OTHER_CAREGIVER,
      label: "Other Caregiver",
      description: "Companion care, home support, or another caregiving credential.",
    },
  ],
  [ROLES.HEALTH_PRACTITIONER]: [
    {
      id: PROFESSIONAL_TYPES.NURSE,
      label: "Nurse",
      description: "Nursing assessment, follow-up, and clinical care coordination.",
    },
    {
      id: PROFESSIONAL_TYPES.PHYSIOTHERAPIST,
      label: "Physiotherapist",
      description: "Mobility, rehabilitation, and recovery in the senior’s routine.",
    },
    {
      id: PROFESSIONAL_TYPES.MD,
      label: "MD",
      description: "Physician oversight and medical decisions for the care plan.",
    },
    {
      id: PROFESSIONAL_TYPES.OTHER,
      label: "Other",
      description: "Another licensed health professional supporting this household.",
    },
  ],
};

export function roleOption(role) {
  return ROLE_OPTIONS.find((item) => item.id === role) ?? null;
}

export function roleLabel(role) {
  if (role === ROLES.ADMIN) return "Admin";
  return roleOption(role)?.label ?? "Role needed";
}

export function roleDescription(role) {
  return roleOption(role)?.description ?? "";
}

export function professionalTypesFor(role) {
  return PROFESSIONAL_TYPE_OPTIONS[role] ?? [];
}

export function professionalTypeOption(role, type) {
  return professionalTypesFor(role).find((item) => item.id === type) ?? null;
}

export function professionalTypeLabel(role, type) {
  return professionalTypeOption(role, type)?.label ?? "";
}

export function roleNeedsProfessionalType(role) {
  return Boolean(roleOption(role)?.needsProfessionalType);
}

export function isProfessionalRole(role) {
  return roleNeedsProfessionalType(role);
}

export function isSelectableRole(role) {
  return SELECTABLE_ROLES.includes(role);
}

export function isValidProfessionalType(role, type) {
  return professionalTypesFor(role).some((item) => item.id === type);
}

function aliasKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const ROLE_ALIASES = {
  family: ROLES.FAMILY,
  family_member: ROLES.FAMILY,
  familymember: ROLES.FAMILY,
  relative: ROLES.FAMILY,
  caregiver: ROLES.CAREGIVER,
  care_giver: ROLES.CAREGIVER,
  carer: ROLES.CAREGIVER,
  caretaker: ROLES.CAREGIVER,
  health_practitioner: ROLES.HEALTH_PRACTITIONER,
  healthpractitioner: ROLES.HEALTH_PRACTITIONER,
  practitioner: ROLES.HEALTH_PRACTITIONER,
  clinician: ROLES.HEALTH_PRACTITIONER,
  doctor: ROLES.HEALTH_PRACTITIONER,
  physician: ROLES.HEALTH_PRACTITIONER,
  admin: ROLES.ADMIN,
  administrator: ROLES.ADMIN,
};

const TYPE_ALIASES = {
  cna: PROFESSIONAL_TYPES.CNA,
  certified_nursing_assistant: PROFESSIONAL_TYPES.CNA,
  cmt: PROFESSIONAL_TYPES.CMT,
  certified_medication_technician: PROFESSIONAL_TYPES.CMT,
  other_caregiver: PROFESSIONAL_TYPES.OTHER_CAREGIVER,
  companion: PROFESSIONAL_TYPES.OTHER_CAREGIVER,
  home_care: PROFESSIONAL_TYPES.OTHER_CAREGIVER,
  nurse: PROFESSIONAL_TYPES.NURSE,
  rn: PROFESSIONAL_TYPES.NURSE,
  registered_nurse: PROFESSIONAL_TYPES.NURSE,
  lpn: PROFESSIONAL_TYPES.NURSE,
  physiotherapist: PROFESSIONAL_TYPES.PHYSIOTHERAPIST,
  physical_therapist: PROFESSIONAL_TYPES.PHYSIOTHERAPIST,
  physio: PROFESSIONAL_TYPES.PHYSIOTHERAPIST,
  pt: PROFESSIONAL_TYPES.PHYSIOTHERAPIST,
  md: PROFESSIONAL_TYPES.MD,
  doctor: PROFESSIONAL_TYPES.MD,
  physician: PROFESSIONAL_TYPES.MD,
  gp: PROFESSIONAL_TYPES.MD,
  medical_doctor: PROFESSIONAL_TYPES.MD,
  other: PROFESSIONAL_TYPES.OTHER,
};

const TYPE_AS_ROLE = {
  [PROFESSIONAL_TYPES.CNA]: { role: ROLES.CAREGIVER, professionalType: PROFESSIONAL_TYPES.CNA },
  [PROFESSIONAL_TYPES.CMT]: { role: ROLES.CAREGIVER, professionalType: PROFESSIONAL_TYPES.CMT },
  [PROFESSIONAL_TYPES.OTHER_CAREGIVER]: { role: ROLES.CAREGIVER, professionalType: PROFESSIONAL_TYPES.OTHER_CAREGIVER },
  [PROFESSIONAL_TYPES.NURSE]: { role: ROLES.HEALTH_PRACTITIONER, professionalType: PROFESSIONAL_TYPES.NURSE },
  [PROFESSIONAL_TYPES.PHYSIOTHERAPIST]: { role: ROLES.HEALTH_PRACTITIONER, professionalType: PROFESSIONAL_TYPES.PHYSIOTHERAPIST },
  [PROFESSIONAL_TYPES.MD]: { role: ROLES.HEALTH_PRACTITIONER, professionalType: PROFESSIONAL_TYPES.MD },
};

export function normalizeStoredRole(value) {
  if (value == null || value === "") return null;
  if (ASSIGNED_ROLES.includes(value)) return value;
  const mapped = ROLE_ALIASES[aliasKey(value)];
  return mapped || null;
}

export function normalizeStoredProfessionalType(role, value) {
  if (value == null || value === "") return null;
  if (isValidProfessionalType(role, value)) return value;
  const mapped = TYPE_ALIASES[aliasKey(value)];
  if (!mapped) return null;
  if (mapped === PROFESSIONAL_TYPES.OTHER && role === ROLES.CAREGIVER) {
    return PROFESSIONAL_TYPES.OTHER_CAREGIVER;
  }
  if (isValidProfessionalType(role, mapped)) return mapped;
  return null;
}

export function normalizeRoleAndType(roleValue, typeValue) {
  let role = normalizeStoredRole(roleValue);
  let professionalType = normalizeStoredProfessionalType(role, typeValue);
  if (!role) {
    const fromType = TYPE_AS_ROLE[TYPE_ALIASES[aliasKey(roleValue)] || aliasKey(roleValue)];
    if (fromType) {
      role = fromType.role;
      professionalType = professionalType || fromType.professionalType;
    }
  }
  if (role && !professionalType) {
    professionalType = normalizeStoredProfessionalType(role, typeValue);
    const implied = TYPE_ALIASES[aliasKey(roleValue)];
    if (!professionalType && implied && isValidProfessionalType(role, implied)) {
      professionalType = implied;
    }
  }
  return { role, professionalType };
}

export function hasCompletedRoleSetup(user) {
  const role = user?.role;
  if (!ASSIGNED_ROLES.includes(role)) return false;
  if (roleNeedsProfessionalType(role)) {
    return isValidProfessionalType(role, user?.professionalType);
  }
  return true;
}

export function normalizeRoleSelection({ role, professionalType = null } = {}) {
  if (!isSelectableRole(role)) {
    throw new Error("Choose how you use Famielda.");
  }
  if (roleNeedsProfessionalType(role)) {
    if (!isValidProfessionalType(role, professionalType)) {
      throw new Error("Choose your professional type.");
    }
    return { role, professionalType };
  }
  return { role, professionalType: null };
}

export function roleSummary(user) {
  const role = roleLabel(user?.role);
  const type = professionalTypeLabel(user?.role, user?.professionalType);
  return type ? `${type} · ${role}` : role;
}

export function dashboardHrefFor(role) {
  if (role === ROLES.CAREGIVER) return "caregiver.html";
  if (role === ROLES.HEALTH_PRACTITIONER) return "practitioner.html";
  return "dashboard.html";
}
