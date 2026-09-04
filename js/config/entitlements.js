import { CIRCLE_KINDS, ROLES, SUBSCRIPTION_PLANS } from "./constants.js";
import { referralGrantActive } from "./referrals.js";

export const PLUS_PLAN_IDS = new Set([
  SUBSCRIPTION_PLANS.PLUS,
  SUBSCRIPTION_PLANS.FAMILY,
  SUBSCRIPTION_PLANS.CIRCLE,
]);

export const ENTITLEMENTS = {
  [SUBSCRIPTION_PLANS.FREE]: {
    id: SUBSCRIPTION_PLANS.FREE,
    name: "Free",
    maxSeniors: 1,
    maxFamilyMembers: 2,
    maxCaregivers: 0,
    maxPractitioners: 0,
    maxProfessionalRelationships: 1,
    medication: false,
    advancedReports: false,
    documents: false,
    careHistory: false,
    advancedNotifications: false,
    professionalCircle: false,
  },
  [SUBSCRIPTION_PLANS.PLUS]: {
    id: SUBSCRIPTION_PLANS.PLUS,
    name: "Plus",
    maxSeniors: null,
    maxFamilyMembers: null,
    maxCaregivers: null,
    maxPractitioners: null,
    maxProfessionalRelationships: null,
    medication: true,
    advancedReports: true,
    documents: true,
    careHistory: true,
    advancedNotifications: true,
    professionalCircle: true,
  },
};

export const FREE_FEATURES = [
  "1 senior profile",
  "2 family members",
  "Basic care coordination",
  "One active family relationship for caregivers and practitioners",
];

export const PLUS_FEATURES = [
  "Multiple family members",
  "Multiple caregivers",
  "Multiple professional relationships",
  "Advanced reports",
  "Medication management",
  "Care history",
  "Advanced notifications",
  "Document storage",
  "Professional care-circle access",
];

export const ENTITLEMENT_MESSAGES = {
  createSenior: "Free includes one senior profile. Upgrade to Famielda Plus to coordinate care for more than one person.",
  familyMember: "Free includes two family members. Upgrade to Famielda Plus to add the rest of the household.",
  caregiver: "Inviting caregivers is a Famielda Plus feature. Upgrade for professional care-circle access.",
  practitioner: "Inviting health practitioners is a Famielda Plus feature. Upgrade for professional care-circle access.",
  medication: "Medication management is a Famielda Plus feature. Plus keeps a shared list — name, dosage, frequency, dates, reminders, and history — so the circle stays coordinated. Famielda does not diagnose or prescribe.",
  reports: "Advanced care reports are a Famielda Plus feature. Plus opens caregiver activity, task completion, visit history, care trends, CSV export, and a printable PDF.",
  documents: "Document storage is a Famielda Plus feature. Plus keeps directives, insurance, and clinical papers in a private household vault — never on a public link.",
  careHistory: "Care history is a Famielda Plus feature. Plus keeps a chronological record of check-ins, tasks, medications, and notes.",
  notifications: "Advanced notifications are a Famielda Plus feature. Plus adds medication and appointment reminders on top of invitations and emergency alerts.",
  professionalRelationship: "Free includes one active family relationship. Upgrade to Famielda Plus to work with more than one household.",
};

export class EntitlementError extends Error {
  constructor(message, { code = "plan", upgrade = true, feature = null } = {}) {
    super(message);
    this.name = "EntitlementError";
    this.code = code;
    this.upgrade = upgrade;
    this.feature = feature;
  }
}

export function catalogPlanId(planId) {
  return isPlusPlan(planId) ? SUBSCRIPTION_PLANS.PLUS : SUBSCRIPTION_PLANS.FREE;
}

export function isPlusPlan(planId) {
  return PLUS_PLAN_IDS.has(planId);
}

export function entitlementsFor(planId) {
  return ENTITLEMENTS[catalogPlanId(planId)] ?? ENTITLEMENTS[SUBSCRIPTION_PLANS.FREE];
}

export function hasPlusAccess(user) {
  if (!user) return false;
  if (user.role === ROLES.ADMIN) return true;
  if (user.adminGrant?.active && isPlusPlan(user.adminGrant.plan)) return true;
  if (referralGrantActive(user)) return true;
  return isPlusPlan(user.plan);
}

export function planIdOf(userOrPlan) {
  if (!userOrPlan) return SUBSCRIPTION_PLANS.FREE;
  if (typeof userOrPlan === "string") return userOrPlan;
  if (userOrPlan.adminGrant?.active && isPlusPlan(userOrPlan.adminGrant.plan)) {
    return userOrPlan.adminGrant.plan;
  }
  if (referralGrantActive(userOrPlan)) {
    return userOrPlan.referralGrant?.plan || SUBSCRIPTION_PLANS.PLUS;
  }
  return userOrPlan.plan || SUBSCRIPTION_PLANS.FREE;
}

export function allowedKindsFor(planId) {
  const limits = entitlementsFor(planId);
  const kinds = [CIRCLE_KINDS.FAMILY];
  if (limits.professionalCircle || limits.maxCaregivers == null || limits.maxCaregivers > 0) {
    kinds.push(CIRCLE_KINDS.CAREGIVER);
  }
  if (limits.professionalCircle || limits.maxPractitioners == null || limits.maxPractitioners > 0) {
    kinds.push(CIRCLE_KINDS.PRACTITIONER);
  }
  return kinds;
}

export function entitlementMessage(feature) {
  return ENTITLEMENT_MESSAGES[feature] || "This is a Famielda Plus feature.";
}

export function denyEntitlement(feature, extra = {}) {
  return new EntitlementError(entitlementMessage(feature), {
    code: extra.code || feature || "plan",
    upgrade: extra.upgrade !== false,
    feature,
  });
}
