import {
  FAMILY_REFERRAL_CHANNEL,
  FAMILY_REFERRAL_STATUS,
  ROLES,
  SUBSCRIPTION_PLANS,
} from "./constants.js";

export const FAMILY_REFERRAL_PLUS_TRIAL_DAYS = 30;

/** Flip to true when a successful family referral should grant a 30-day Plus trial. */
export const FAMILY_REFERRAL_PLUS_TRIAL_ENABLED = false;

export const FAMILY_REFERRAL_LIMITS = {
  maxPending: 20,
  maxPerDay: 15,
};

export const FAMILY_REFERRAL_STORAGE_KEY = "famielda.familyReferralCode";

export const FAMILY_REFERRAL_RELATIONSHIPS = [
  "Daughter",
  "Son",
  "Spouse",
  "Partner",
  "Sibling",
  "Parent",
  "Grandchild",
  "Grandparent",
  "Niece",
  "Nephew",
  "Aunt",
  "Uncle",
  "Cousin",
  "In-law",
  "Other family",
];

export const FAMILY_REFERRAL_STATUS_OPTIONS = [
  {
    id: FAMILY_REFERRAL_STATUS.PENDING,
    label: "Waiting",
    hint: "They have not created a Famielda account yet.",
    badge: "badge--warning",
  },
  {
    id: FAMILY_REFERRAL_STATUS.JOINED,
    label: "Joined",
    hint: "They created an account with your invite.",
    badge: "badge--info",
  },
  {
    id: FAMILY_REFERRAL_STATUS.SUCCESSFUL,
    label: "Successful",
    hint: "A relative joined Famielda as family.",
    badge: "badge--success",
  },
  {
    id: FAMILY_REFERRAL_STATUS.REVOKED,
    label: "Revoked",
    hint: "This invite can no longer be used.",
    badge: "badge--neutral",
  },
];

const STATUS_META = Object.fromEntries(
  FAMILY_REFERRAL_STATUS_OPTIONS.map((item) => [item.id, item]),
);

export function normalizeReferralCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

export function isValidReferralCode(value) {
  const code = normalizeReferralCode(value);
  return /^[A-Z]{2,8}-[A-Z0-9]{4,8}$/.test(code);
}

export function referralStatusMeta(status) {
  return STATUS_META[status] ?? STATUS_META[FAMILY_REFERRAL_STATUS.PENDING];
}

export function referralStatusLabel(status) {
  return referralStatusMeta(status).label;
}

export function referralStatusBadge(status) {
  return referralStatusMeta(status).badge;
}

export function referralChannelLabel(channel) {
  if (channel === FAMILY_REFERRAL_CHANNEL.LINK) return "Share link";
  return "Email invite";
}

export function isOpenReferral(referral) {
  return referral?.status === FAMILY_REFERRAL_STATUS.PENDING;
}

export function isSuccessfulReferral(referral) {
  return referral?.status === FAMILY_REFERRAL_STATUS.SUCCESSFUL;
}

export function countsFromReferrals(referrals = []) {
  const items = Array.isArray(referrals) ? referrals : [];
  return {
    invited: items.filter((item) => item.status !== FAMILY_REFERRAL_STATUS.REVOKED).length,
    pending: items.filter((item) => item.status === FAMILY_REFERRAL_STATUS.PENDING).length,
    joined: items.filter((item) => (
      item.status === FAMILY_REFERRAL_STATUS.JOINED
      || item.status === FAMILY_REFERRAL_STATUS.SUCCESSFUL
    )).length,
    successful: items.filter((item) => item.status === FAMILY_REFERRAL_STATUS.SUCCESSFUL).length,
  };
}

export function registerHrefForCode(code, origin = "") {
  const normalized = normalizeReferralCode(code);
  const path = `/register.html?ref=${encodeURIComponent(normalized)}`;
  if (!origin) return path;
  return `${String(origin).replace(/\/$/, "")}${path}`;
}

export function persistReferralCode(code) {
  const normalized = normalizeReferralCode(code);
  if (!normalized || typeof sessionStorage === "undefined") return "";
  try {
    sessionStorage.setItem(FAMILY_REFERRAL_STORAGE_KEY, normalized);
  } catch {
    // Ignore private-mode quota failures; the query string still carries the code.
  }
  return normalized;
}

export function readStoredReferralCode() {
  if (typeof window === "undefined") return "";
  const fromQuery = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"));
  if (fromQuery) {
    persistReferralCode(fromQuery);
    return fromQuery;
  }
  try {
    return normalizeReferralCode(sessionStorage.getItem(FAMILY_REFERRAL_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function clearStoredReferralCode() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(FAMILY_REFERRAL_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export function firstNameOf(name) {
  const value = String(name || "").trim();
  return value.split(/\s+/)[0] || "A family member";
}

export function plusTrialCopy({ enabled = FAMILY_REFERRAL_PLUS_TRIAL_ENABLED, days = FAMILY_REFERRAL_PLUS_TRIAL_DAYS } = {}) {
  if (enabled) {
    return `When a relative joins Famielda as family, you receive a ${days}-day Plus trial.`;
  }
  return `A ${days}-day Famielda Plus trial is planned for successful referrals. Invites work today; the trial is not live yet.`;
}

export function referralGrantActive(user, now = Date.now()) {
  const grant = user?.referralGrant;
  if (!grant?.active) return false;
  const plan = grant.plan || SUBSCRIPTION_PLANS.PLUS;
  if (plan !== SUBSCRIPTION_PLANS.PLUS && plan !== SUBSCRIPTION_PLANS.FAMILY && plan !== SUBSCRIPTION_PLANS.CIRCLE) {
    return false;
  }
  if (!grant.expiresAt) return true;
  const end = new Date(grant.expiresAt).getTime();
  return Number.isFinite(end) && end > now;
}

export function roleCompletesFamilyReferral(role) {
  return role === ROLES.FAMILY;
}
