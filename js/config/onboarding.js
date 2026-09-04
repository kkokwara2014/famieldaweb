import { CARE_TYPES, ONBOARDING_PATH, PROFESSIONAL_TYPES, ROLES } from "./constants.js";
import { FAMILY_RELATIONSHIPS } from "./care-circle.js";
import {
  PROFESSIONAL_TYPE_OPTIONS,
  hasCompletedRoleSetup,
  isProfessionalRole,
  isValidProfessionalType,
  professionalTypeLabel,
  roleLabel,
} from "./roles.js";

export const CARE_TYPE_OPTIONS = [
  {
    id: CARE_TYPES.PERSONAL_CARE,
    label: "Personal care",
    description: "Bathing, dressing, meals, and daily living support.",
  },
  {
    id: CARE_TYPES.MEDICATION,
    label: "Medication support",
    description: "Reminders, logging doses, and help with the medicine routine.",
  },
  {
    id: CARE_TYPES.COMPANIONSHIP,
    label: "Companionship",
    description: "Presence, conversation, outings, and company in the home.",
  },
  {
    id: CARE_TYPES.HOUSEHOLD,
    label: "Household help",
    description: "Cooking, cleaning, errands, and keeping the home running.",
  },
  {
    id: CARE_TYPES.MOBILITY,
    label: "Mobility",
    description: "Transfers, walking support, and getting around safely.",
  },
  {
    id: CARE_TYPES.OVERNIGHT,
    label: "Overnight / respite",
    description: "Night coverage or short-term relief for the family.",
  },
];

const DEMO_COMPLETED_AT = "2026-01-15T12:00:00.000Z";

const DEMO_ONBOARDING = {
  "family@famielda.test": {
    onboardingCompletedAt: DEMO_COMPLETED_AT,
    onboardingPath: ONBOARDING_PATH.CREATE_SENIOR,
    familyRelationship: "Daughter",
  },
  "admin@famielda.test": {
    onboardingCompletedAt: DEMO_COMPLETED_AT,
  },
  "caregiver@famielda.test": {
    onboardingCompletedAt: DEMO_COMPLETED_AT,
    careTypes: [CARE_TYPES.PERSONAL_CARE, CARE_TYPES.MEDICATION],
  },
  "practitioner@famielda.test": {
    onboardingCompletedAt: DEMO_COMPLETED_AT,
    specialty: "Geriatric medicine",
  },
};

export function demoOnboardingDefaults(user = {}) {
  const email = String(user.email || "").trim().toLowerCase();
  return DEMO_ONBOARDING[email] ?? {};
}

export function careTypeOption(id) {
  return CARE_TYPE_OPTIONS.find((item) => item.id === id) ?? null;
}

export function careTypeLabel(id) {
  return careTypeOption(id)?.label ?? "";
}

export function careTypeLabels(ids = []) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => careTypeLabel(id))
    .filter(Boolean);
}

export function isValidCareType(id) {
  return CARE_TYPE_OPTIONS.some((item) => item.id === id);
}

export function normalizeCareTypes(ids = []) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).filter(isValidCareType))];
  return unique;
}

export function hasCompletedOnboarding(user) {
  if (!user) return false;
  if (user.role === ROLES.ADMIN) return true;
  if (!hasCompletedRoleSetup(user)) return false;
  if (user.onboardingCompletedAt) return true;
  return Boolean(user.seniorId);
}

export function onboardingQuestion(role) {
  if (role === ROLES.CAREGIVER) return "What type of care do you provide?";
  if (role === ROLES.HEALTH_PRACTITIONER) return "What is your profession?";
  return "Who are you caring for?";
}

export function onboardingKicker(role) {
  if (role === ROLES.CAREGIVER) return "Caregiver onboarding";
  if (role === ROLES.HEALTH_PRACTITIONER) return "Clinical onboarding";
  return "Family onboarding";
}

export function onboardingLead(role) {
  if (role === ROLES.CAREGIVER) {
    return "Choose the kinds of care you actually give. Famielda will put those tasks and visits first on your dashboard.";
  }
  if (role === ROLES.HEALTH_PRACTITIONER) {
    return "Confirm your profession so the clinical workspace opens around appointments, notes, or rehabilitation.";
  }
  return "Name the person at the center of this household. The family dashboard gathers around their record.";
}

export function professionOptions() {
  return PROFESSIONAL_TYPE_OPTIONS[ROLES.HEALTH_PRACTITIONER] ?? [];
}

export function familyRelationshipOptions() {
  return FAMILY_RELATIONSHIPS;
}

export function normalizeOnboardingInput(role, input = {}) {
  if (role === ROLES.FAMILY) {
    const path = input.onboardingPath === ONBOARDING_PATH.JOIN_EXISTING
      ? ONBOARDING_PATH.JOIN_EXISTING
      : ONBOARDING_PATH.CREATE_SENIOR;
    const displayName = String(input.displayName || "").trim();
    const preferredName = String(input.preferredName || "").trim();
    const relationship = String(input.familyRelationship || "").trim();
    if (path === ONBOARDING_PATH.CREATE_SENIOR) {
      if (!displayName) throw new Error("Enter the name of the person you are caring for.");
      if (!relationship || !FAMILY_RELATIONSHIPS.includes(relationship)) {
        throw new Error("Choose how you are related to them.");
      }
    }
    return {
      onboardingPath: path,
      familyRelationship: relationship || "",
      senior: path === ONBOARDING_PATH.CREATE_SENIOR
        ? {
          displayName,
          preferredName: preferredName || displayName,
          location: String(input.location || "").trim(),
          dateOfBirth: String(input.dateOfBirth || "").trim(),
        }
        : null,
      careTypes: [],
      specialty: "",
      professionalType: null,
    };
  }

  if (role === ROLES.CAREGIVER) {
    const careTypes = normalizeCareTypes(input.careTypes);
    if (!careTypes.length) {
      throw new Error("Choose at least one type of care you provide.");
    }
    return {
      onboardingPath: "",
      familyRelationship: "",
      senior: null,
      careTypes,
      specialty: "",
      professionalType: isValidProfessionalType(role, input.professionalType)
        ? input.professionalType
        : null,
    };
  }

  if (role === ROLES.HEALTH_PRACTITIONER) {
    if (!isValidProfessionalType(role, input.professionalType)) {
      throw new Error("Choose your profession.");
    }
    return {
      onboardingPath: "",
      familyRelationship: "",
      senior: null,
      careTypes: [],
      specialty: String(input.specialty || "").trim(),
      professionalType: input.professionalType,
    };
  }

  throw new Error("Choose how you use Famielda first.");
}

export function onboardingSummary(user) {
  if (!user?.role) return "";
  if (user.role === ROLES.FAMILY) {
    if (user.onboardingPath === ONBOARDING_PATH.JOIN_EXISTING) {
      return "Joining a household that invited you.";
    }
    return user.familyRelationship
      ? `Caring as ${user.familyRelationship.toLowerCase()}`
      : "Coordinating family care";
  }
  if (user.role === ROLES.CAREGIVER) {
    const types = careTypeLabels(user.careTypes);
    return types.length ? types.join(" · ") : roleLabel(user.role);
  }
  const profession = professionalTypeLabel(user.role, user.professionalType);
  if (user.specialty && profession) return `${profession} · ${user.specialty}`;
  return profession || roleLabel(user.role);
}

function familyLayout(user) {
  const relationship = user?.familyRelationship;
  return {
    id: "family",
    sectionOrder: ["senior", "care-status", "tasks", "appointments", "caregivers", "practitioners", "activities", "circle", "messages", "notifications", "subscription"],
    focus: relationship ? [relationship] : [],
    primaryHref: "senior.html",
    primaryLabel: "Open care hub",
    secondaryHref: "schedule.html",
    secondaryLabel: "Request a visit",
    lead(seniorName) {
      if (user?.onboardingPath === ONBOARDING_PATH.JOIN_EXISTING && seniorName === "your senior") {
        return "Accept a care-circle invitation to open this household’s record, week, and people.";
      }
      if (relationship) {
        return `You’re coordinating care for ${seniorName} as their ${relationship.toLowerCase()} — coverage, the day, and the people around them.`;
      }
      return `One view of ${seniorName}’s care — coverage, the day, and the people around them.`;
    },
  };
}

function caregiverLayout(user) {
  const types = normalizeCareTypes(user?.careTypes);
  const wantsMeds = types.includes(CARE_TYPES.MEDICATION);
  const wantsPersonal = types.includes(CARE_TYPES.PERSONAL_CARE) || types.includes(CARE_TYPES.OVERNIGHT);
  const wantsCompanion = types.includes(CARE_TYPES.COMPANIONSHIP);
  const wantsHousehold = types.includes(CARE_TYPES.HOUSEHOLD);
  const wantsMobility = types.includes(CARE_TYPES.MOBILITY);

  const sectionOrder = [];
  if (wantsMeds || wantsHousehold) sectionOrder.push("tasks");
  if (wantsPersonal || wantsMobility || types.includes(CARE_TYPES.OVERNIGHT)) {
    sectionOrder.push("assignments", "visits", "schedule-requests");
  } else {
    sectionOrder.push("assignments", "schedule-requests", "visits");
  }
  if (wantsCompanion) sectionOrder.push("messages", "engagements");
  else sectionOrder.push("engagements", "messages");
  sectionOrder.push("invitations", "visit-history", "notifications");

  const focus = careTypeLabels(types);
  const credential = professionalTypeLabel(user?.role, user?.professionalType);

  return {
    id: "caregiver",
    sectionOrder,
    focus,
    primaryHref: wantsMeds ? "senior.html?section=medications" : "schedule.html",
    primaryLabel: wantsMeds ? "Open medications" : "Open today’s week",
    lead(seniorName) {
      const care = focus.length ? focus[0].toLowerCase() : "daily care";
      const extra = focus.length > 1 ? ` plus ${focus.slice(1).join(", ").toLowerCase()}` : "";
      if (credential) {
        return `${credential} providing ${care}${extra} for ${seniorName}. Assignments that match your care stay at the top.`;
      }
      return `Your ${care}${extra} with ${seniorName} — assignments, visits, and the circle thread.`;
    },
    preferMedication: wantsMeds,
    preferPersonal: wantsPersonal,
    preferHousehold: wantsHousehold,
    preferMobility: wantsMobility,
    preferCompanionship: wantsCompanion,
  };
}

function practitionerLayout(user) {
  const profession = user?.professionalType || PROFESSIONAL_TYPES.OTHER;
  const specialty = String(user?.specialty || "").trim();
  const label = professionalTypeLabel(user?.role, profession) || "Clinician";

  const layouts = {
    [PROFESSIONAL_TYPES.MD]: {
      sectionOrder: ["appointments", "care-info", "notes", "assigned", "schedule", "invitations", "messages", "notifications"],
      primaryHref: "senior.html?section=appointments",
      primaryLabel: "Appointments",
      secondaryHref: "schedule.html",
      secondaryLabel: "Open the week",
      notesTitle: "Clinical notes",
      lead(seniorName) {
        return `${label}${specialty ? ` · ${specialty}` : ""} — appointments, the care record, and notes for ${seniorName}.`;
      },
    },
    [PROFESSIONAL_TYPES.NURSE]: {
      sectionOrder: ["care-info", "notes", "appointments", "assigned", "schedule", "invitations", "messages", "notifications"],
      primaryHref: "senior.html?section=care-plan",
      primaryLabel: "Care plan",
      secondaryHref: "schedule.html",
      secondaryLabel: "Open the week",
      notesTitle: "Nursing notes",
      lead(seniorName) {
        return `${label}${specialty ? ` · ${specialty}` : ""} following ${seniorName}’s plan, medications, and clinical notes.`;
      },
    },
    [PROFESSIONAL_TYPES.PHYSIOTHERAPIST]: {
      sectionOrder: ["schedule", "appointments", "assigned", "care-info", "notes", "invitations", "messages", "notifications"],
      primaryHref: "schedule.html",
      primaryLabel: "Open the week",
      secondaryHref: "senior.html?section=appointments",
      secondaryLabel: "Appointments",
      notesTitle: "Therapy notes",
      lead(seniorName) {
        return `${label}${specialty ? ` · ${specialty}` : ""} — mobility visits and the rehabilitation week for ${seniorName}.`;
      },
    },
    [PROFESSIONAL_TYPES.OTHER]: {
      sectionOrder: ["assigned", "appointments", "care-info", "notes", "schedule", "invitations", "messages", "notifications"],
      primaryHref: "schedule.html",
      primaryLabel: "Open the week",
      secondaryHref: "senior.html?section=appointments",
      secondaryLabel: "Appointments",
      notesTitle: "Clinical notes",
      lead(seniorName) {
        return `${label}${specialty ? ` · ${specialty}` : ""} — the clinical picture for ${seniorName}.`;
      },
    },
  };

  return {
    id: "practitioner",
    profession,
    specialty,
    focus: [label, specialty].filter(Boolean),
    ...(layouts[profession] || layouts[PROFESSIONAL_TYPES.OTHER]),
  };
}

export function dashboardLayoutFor(user) {
  if (user?.role === ROLES.CAREGIVER) return caregiverLayout(user);
  if (user?.role === ROLES.HEALTH_PRACTITIONER) return practitionerLayout(user);
  return familyLayout(user);
}

export function applyDashboardLayout(root, layout) {
  if (!root || !layout?.sectionOrder?.length) return;
  const board = root.querySelector("[data-dashboard-board]");
  if (!board) return;
  board.querySelectorAll("[data-board-section]").forEach((card) => {
    card.style.order = "40";
  });
  layout.sectionOrder.forEach((id, index) => {
    const card = board.querySelector(`[data-board-section="${id}"]`);
    if (card) card.style.order = String(index + 1);
  });
}

export { isProfessionalRole };
