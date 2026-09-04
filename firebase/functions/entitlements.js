const PLUS_PLAN_IDS = new Set(["plus", "family", "circle"]);

const FREE = {
  id: "free",
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
};

const PLUS = {
  id: "plus",
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
};

const MESSAGES = {
  createSenior: "Free includes one senior profile. Upgrade to Famielda Plus to coordinate care for more than one person.",
  familyMember: "Free includes two family members. Upgrade to Famielda Plus to add the rest of the household.",
  caregiver: "Inviting caregivers is a Famielda Plus feature. Upgrade for professional care-circle access.",
  practitioner: "Inviting health practitioners is a Famielda Plus feature. Upgrade for professional care-circle access.",
  medication: "Medication management is a Famielda Plus feature. Plus keeps a shared list — not a prescription.",
  professionalRelationship: "Free includes one active family relationship. Upgrade to Famielda Plus to work with more than one household.",
};

function occupiesSeat(member) {
  return member?.status === "active" || member?.status === "invited";
}

function referralGrantActive(user) {
  const grant = user?.referralGrant;
  if (!grant?.active) return false;
  if (!PLUS_PLAN_IDS.has(grant.plan || "plus")) return false;
  if (!grant.expiresAt) return true;
  const end = grant.expiresAt.toDate ? grant.expiresAt.toDate().getTime() : new Date(grant.expiresAt).getTime();
  return Number.isFinite(end) && end > Date.now();
}

function planOf(user) {
  if (user?.adminGrant?.active && PLUS_PLAN_IDS.has(user.adminGrant.plan)) {
    return user.adminGrant.plan;
  }
  if (referralGrantActive(user)) {
    return user.referralGrant.plan || "plus";
  }
  return user?.plan;
}

function underCap(used, max) {
  if (max == null) return true;
  return Number(used) < Number(max);
}

function countKind(members, kind) {
  return (members || []).filter((member) => member.kind === kind && occupiesSeat(member)).length;
}

exports.isPlusPlan = function isPlusPlan(planId) {
  return PLUS_PLAN_IDS.has(planId);
};

exports.hasPlusAccess = function hasPlusAccess(user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.adminGrant?.active && PLUS_PLAN_IDS.has(user.adminGrant.plan)) return true;
  if (referralGrantActive(user)) return true;
  return PLUS_PLAN_IDS.has(user.plan);
};

exports.entitlementsFor = function entitlementsFor(planId) {
  return PLUS_PLAN_IDS.has(planId) ? PLUS : FREE;
};

exports.message = function message(feature) {
  return MESSAGES[feature] || "This is a Famielda Plus feature.";
};

exports.canAddFamilyMember = function canAddFamilyMember({ user, owner, members }) {
  if (user?.role === "admin") return true;
  const limits = exports.entitlementsFor(planOf(owner) || planOf(user));
  return underCap(countKind(members, "family"), limits.maxFamilyMembers);
};

exports.canInviteCaregiver = function canInviteCaregiver({ user, owner, members }) {
  if (user?.role === "admin") return true;
  const limits = exports.entitlementsFor(planOf(owner) || planOf(user));
  if (!limits.professionalCircle && limits.maxCaregivers === 0) return false;
  return underCap(countKind(members, "caregiver"), limits.maxCaregivers);
};

exports.canInvitePractitioner = function canInvitePractitioner({ user, owner, members }) {
  if (user?.role === "admin") return true;
  const limits = exports.entitlementsFor(planOf(owner) || planOf(user));
  if (!limits.professionalCircle && limits.maxPractitioners === 0) return false;
  return underCap(countKind(members, "practitioner"), limits.maxPractitioners);
};

exports.canInviteKind = function canInviteKind(kind, ctx) {
  if (kind === "caregiver") return exports.canInviteCaregiver(ctx);
  if (kind === "practitioner") return exports.canInvitePractitioner(ctx);
  return exports.canAddFamilyMember(ctx);
};

exports.canUseMedication = function canUseMedication({ user, owner }) {
  if (user?.role === "admin") return true;
  return exports.entitlementsFor(planOf(owner) || planOf(user)).medication;
};

exports.canJoinAnotherFamily = function canJoinAnotherFamily({ user, memberships = [], kind, seniorId }) {
  if (user?.role === "admin") return true;
  if (kind === "family") {
    return memberships.every((member) => !occupiesSeat(member) || member.seniorId === seniorId);
  }
  const limits = exports.entitlementsFor(planOf(user));
  const used = memberships.filter((member) => occupiesSeat(member) && member.seniorId !== seniorId).length;
  return underCap(used, limits.maxProfessionalRelationships);
};
