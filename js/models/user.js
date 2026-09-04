import { normalizeNotificationPrefs } from "../config/notifications.js";
import { demoOnboardingDefaults } from "../config/onboarding.js";
import { normalizeRoleAndType } from "../config/roles.js";

function asCareTypes(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, on]) => on)
      .map(([key]) => key);
  }
  return [];
}

export function joinDisplayName(firstName, lastName) {
  return [firstName, lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function splitDisplayName(displayName) {
  const parts = String(displayName || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

export function createUser(data = {}) {
  const demo = demoOnboardingDefaults(data);
  const careTypes = asCareTypes(data.careTypes);
  const { role, professionalType } = normalizeRoleAndType(data.role, data.professionalType);
  const displayName = data.displayName || data.name || data.fullName || joinDisplayName(data.firstName || data.first_name, data.lastName || data.last_name);
  const split = splitDisplayName(displayName);
  const firstName = String(data.firstName || data.first_name || "").trim() || split.firstName;
  const lastName = String(data.lastName || data.last_name || "").trim() || split.lastName;
  return {
    id: data.id ?? data.uid ?? "",
    email: data.email ?? "",
    firstName,
    lastName,
    displayName,
    phone: data.phone || data.phoneNumber || data.phone_number || "",
    phoneCountry: data.phoneCountry || data.phone_country || "",
    role,
    professionalType,
    plan: data.plan ?? "free",
    subscriptionStatus: data.subscriptionStatus ?? null,
    subscriptionPeriodEnd: data.subscriptionPeriodEnd ?? null,
    subscriptionCancelAtPeriodEnd: Boolean(data.subscriptionCancelAtPeriodEnd),
    subscriptionInterval: data.subscriptionInterval === "year"
      ? "year"
      : (data.subscriptionInterval === "month" ? "month" : null),
    stripeCustomerId: data.stripeCustomerId ?? null,
    stripeSubscriptionId: data.stripeSubscriptionId ?? null,
    stripePriceId: data.stripePriceId ?? null,
    seniorId: data.seniorId || data.senior_id || data.currentSeniorId || null,
    emailVerified: Boolean(data.emailVerified),
    verificationStatus: data.verificationStatus ?? null,
    verifiedAt: data.verifiedAt ?? null,
    photoURL: data.photoURL || data.photoUrl || null,
    timeZone: data.timeZone ?? "",
    notificationPrefs: normalizeNotificationPrefs(data.notificationPrefs),
    status: data.status ?? "active",
    suspendedAt: data.suspendedAt ?? null,
    suspendedBy: data.suspendedBy ?? null,
    suspendedReason: data.suspendedReason ?? "",
    adminGrant: data.adminGrant ?? null,
    referralCode: data.referralCode ?? "",
    referredBy: data.referredBy ?? null,
    referredByCode: data.referredByCode ?? "",
    referralGrant: data.referralGrant ?? null,
    lastLoginAt: data.lastLoginAt ?? null,
    lastLoginPlatform: data.lastLoginPlatform ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    createdPlatform: data.createdPlatform ?? null,
    roleSelectedAt: data.roleSelectedAt ?? null,
    onboardingCompletedAt: data.onboardingCompletedAt ?? demo.onboardingCompletedAt ?? null,
    onboardingPath: data.onboardingPath || demo.onboardingPath || "",
    familyRelationship: data.familyRelationship || demo.familyRelationship || "",
    careTypes: careTypes.length ? careTypes : (demo.careTypes ?? []),
    specialty: data.specialty || demo.specialty || "",
  };
}
