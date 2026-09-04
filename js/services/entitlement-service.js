import { AUTH, CARE_CIRCLE_ROLES, CIRCLE_KINDS, ROLES } from "../config/constants.js";
import { occupiesSeat } from "../config/care-circle.js";
import {
  ENTITLEMENT_MESSAGES,
  EntitlementError,
  allowedKindsFor,
  catalogPlanId,
  denyEntitlement,
  entitlementMessage,
  entitlementsFor,
  hasPlusAccess,
  isPlusPlan,
  planIdOf,
} from "../config/entitlements.js";
import { getSession } from "../auth/session.js";
import { getMockUser } from "../auth/auth-service.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";

export {
  ENTITLEMENT_MESSAGES,
  EntitlementError,
  allowedKindsFor,
  catalogPlanId,
  entitlementMessage,
  entitlementsFor,
  hasPlusAccess,
  isPlusPlan,
  planIdOf,
};

function isAdmin(session) {
  return session?.role === ROLES.ADMIN;
}

function resolvedPlanId({ session, owner, ownerPlan, planId, senior } = {}) {
  if (planId) return planId;
  if (ownerPlan) return ownerPlan;
  if (owner) return planIdOf(owner);
  if (senior?.ownerId && session?.id && senior.ownerId === session.id) return planIdOf(session);
  return planIdOf(session);
}

function householdEntitlements(ctx = {}) {
  if (isAdmin(ctx.session)) return entitlementsFor(ctx.session?.plan);
  return entitlementsFor(resolvedPlanId(ctx));
}

function underCap(used, max) {
  if (max == null) return true;
  return Number(used) < Number(max);
}

function familySeatCount(members = []) {
  return members.filter((member) => member.kind === CIRCLE_KINDS.FAMILY && occupiesSeat(member)).length;
}

function caregiverSeatCount(members = []) {
  return members.filter((member) => member.kind === CIRCLE_KINDS.CAREGIVER && occupiesSeat(member)).length;
}

function practitionerSeatCount(members = []) {
  return members.filter((member) => member.kind === CIRCLE_KINDS.PRACTITIONER && occupiesSeat(member)).length;
}

function activeMembershipCount(memberships = [], { excludeSeniorId } = {}) {
  return memberships.filter((member) => {
    if (!occupiesSeat(member) && member.status !== "active") return false;
    if (excludeSeniorId && member.seniorId === excludeSeniorId) return false;
    return occupiesSeat(member) || member.status === "active";
  }).length;
}

export function circleUsage({ planId, members = [] } = {}) {
  const limits = entitlementsFor(planId);
  const familyUsed = familySeatCount(members);
  const caregiverUsed = caregiverSeatCount(members);
  const practitionerUsed = practitionerSeatCount(members);
  const familyRemaining = limits.maxFamilyMembers == null
    ? null
    : Math.max(0, limits.maxFamilyMembers - familyUsed);

  return {
    family: {
      used: familyUsed,
      max: limits.maxFamilyMembers,
      remaining: familyRemaining,
      atCap: !underCap(familyUsed, limits.maxFamilyMembers),
    },
    caregivers: {
      used: caregiverUsed,
      max: limits.maxCaregivers,
      atCap: !underCap(caregiverUsed, limits.maxCaregivers),
    },
    practitioners: {
      used: practitionerUsed,
      max: limits.maxPractitioners,
      atCap: !underCap(practitionerUsed, limits.maxPractitioners),
    },
    used: familyUsed,
    max: limits.maxFamilyMembers,
    remaining: familyRemaining,
    atCap: !underCap(familyUsed, limits.maxFamilyMembers),
  };
}

export function canCreateSenior({ session, seniorsOwned = 0 } = {}) {
  if (isAdmin(session)) return true;
  const limits = entitlementsFor(session?.plan);
  return underCap(seniorsOwned, limits.maxSeniors);
}

export function canAddFamilyMember({ session, members = [], owner, ownerPlan, planId, senior } = {}) {
  if (isAdmin(session)) return true;
  const limits = householdEntitlements({ session, owner, ownerPlan, planId, senior });
  return underCap(familySeatCount(members), limits.maxFamilyMembers);
}

export function canInviteCaregiver({ session, members = [], owner, ownerPlan, planId, senior } = {}) {
  if (isAdmin(session)) return true;
  const limits = householdEntitlements({ session, owner, ownerPlan, planId, senior });
  if (!limits.professionalCircle && limits.maxCaregivers === 0) return false;
  return underCap(caregiverSeatCount(members), limits.maxCaregivers);
}

export function canInvitePractitioner({ session, members = [], owner, ownerPlan, planId, senior } = {}) {
  if (isAdmin(session)) return true;
  const limits = householdEntitlements({ session, owner, ownerPlan, planId, senior });
  if (!limits.professionalCircle && limits.maxPractitioners === 0) return false;
  return underCap(practitionerSeatCount(members), limits.maxPractitioners);
}

export function canUseMedication(ctx = {}) {
  if (isAdmin(ctx.session)) return true;
  return householdEntitlements(ctx).medication;
}

export function canUseAdvancedReports(ctx = {}) {
  if (isAdmin(ctx.session)) return true;
  return householdEntitlements(ctx).advancedReports;
}

export function canUploadDocuments(ctx = {}) {
  if (isAdmin(ctx.session)) return true;
  return householdEntitlements(ctx).documents;
}

export function canUseCareHistory(ctx = {}) {
  if (isAdmin(ctx.session)) return true;
  return householdEntitlements(ctx).careHistory;
}

export function canUseAdvancedNotifications({ session } = {}) {
  if (isAdmin(session)) return true;
  return entitlementsFor(session?.plan).advancedNotifications;
}

export function canJoinAnotherFamily({
  session,
  memberships = [],
  kind,
  seniorId,
} = {}) {
  if (isAdmin(session)) return true;
  if (kind === CIRCLE_KINDS.FAMILY) {
    return memberships.every((member) => !occupiesSeat(member) || member.seniorId === seniorId);
  }
  const limits = entitlementsFor(session?.plan);
  return underCap(activeMembershipCount(memberships, { excludeSeniorId: seniorId }), limits.maxProfessionalRelationships);
}

export function canInviteKind(kind, ctx = {}) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return canInviteCaregiver(ctx);
  if (kind === CIRCLE_KINDS.PRACTITIONER) return canInvitePractitioner(ctx);
  return canAddFamilyMember(ctx);
}

export function kindAllowedOnPlan(planId, kind) {
  return allowedKindsFor(planId).includes(kind);
}

export function assertCanCreateSenior(ctx) {
  if (canCreateSenior(ctx)) return;
  throw denyEntitlement("createSenior");
}

export function assertCanAddFamilyMember(ctx) {
  if (canAddFamilyMember(ctx)) return;
  throw denyEntitlement("familyMember", { code: "capacity" });
}

export function assertCanInviteCaregiver(ctx) {
  if (canInviteCaregiver(ctx)) return;
  throw denyEntitlement("caregiver", { code: "kind" });
}

export function assertCanInvitePractitioner(ctx) {
  if (canInvitePractitioner(ctx)) return;
  throw denyEntitlement("practitioner", { code: "kind" });
}

export function assertCanUseMedication(ctx) {
  if (canUseMedication(ctx)) return;
  throw denyEntitlement("medication", { code: "plus" });
}

export function assertCanUseAdvancedReports(ctx) {
  if (canUseAdvancedReports(ctx)) return;
  throw denyEntitlement("reports", { code: "plus" });
}

export function assertCanUploadDocuments(ctx) {
  if (canUploadDocuments(ctx)) return;
  throw denyEntitlement("documents", { code: "plus" });
}

export function assertCanUseCareHistory(ctx) {
  if (canUseCareHistory(ctx)) return;
  throw denyEntitlement("careHistory", { code: "plus" });
}

export function assertCanJoinAnotherFamily(ctx) {
  if (canJoinAnotherFamily(ctx)) return;
  throw denyEntitlement("professionalRelationship");
}

export function assertCanInviteKind(kind, ctx) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return assertCanInviteCaregiver(ctx);
  if (kind === CIRCLE_KINDS.PRACTITIONER) return assertCanInvitePractitioner(ctx);
  return assertCanAddFamilyMember(ctx);
}

export async function resolveHouseholdPlan({ session = getSession(), senior, members = [] } = {}) {
  if (isAdmin(session)) return session?.plan;
  if (!senior?.ownerId || senior.ownerId === session?.id) return session?.plan;

  const ownerMember = members.find((member) => member.role === CARE_CIRCLE_ROLES.OWNER);
  if (ownerMember?.plan) return ownerMember.plan;

  if (!usesLiveAuth()) {
    return getMockUser(senior.ownerId)?.plan ?? session?.plan;
  }

  try {
    const db = getFirebaseDb();
    const sdk = getFirestoreSdk();
    const snap = await sdk.getDoc(sdk.doc(db, AUTH.USERS_COLLECTION, senior.ownerId));
    return snap.exists() ? snap.data()?.plan ?? session?.plan : session?.plan;
  } catch {
    return session?.plan;
  }
}

export async function householdContext({ session = getSession(), senior, members = [] } = {}) {
  const planId = await resolveHouseholdPlan({ session, senior, members });
  return {
    session,
    senior,
    members,
    planId,
    ownerPlan: planId,
    entitlements: entitlementsFor(planId),
    usage: circleUsage({ planId, members }),
  };
}
