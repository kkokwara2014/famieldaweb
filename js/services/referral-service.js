import {
  AUTH,
  FAMILY_REFERRAL_CHANNEL,
  FAMILY_REFERRAL_STATUS,
  NOTIFICATION_TYPES,
  ROLES,
} from "../config/constants.js";
import {
  FAMILY_REFERRAL_LIMITS,
  FAMILY_REFERRAL_PLUS_TRIAL_DAYS,
  FAMILY_REFERRAL_PLUS_TRIAL_ENABLED,
  FAMILY_REFERRAL_RELATIONSHIPS,
  clearStoredReferralCode,
  countsFromReferrals,
  firstNameOf,
  isValidReferralCode,
  normalizeReferralCode,
  plusTrialCopy,
  readStoredReferralCode,
  registerHrefForCode,
} from "../config/referrals.js";
import { createFamilyReferral, createFamilyReferralProfile } from "../models/referral.js";
import { storage } from "../core/storage.js";
import { usesLiveAuth } from "../core/firebase.js";
import { callCloudFunction } from "../core/functions.js";
import { getSession, setSession } from "../auth/session.js";
import { getMockUser, listMockUsers, updateMockUser } from "../auth/auth-service.js";
import { notifyQuietly } from "./notification-service.js";
import { PRODUCT_EVENTS, trackInviteSent, trackProductEvent } from "./analytics-service.js";

const REFERRALS_KEY = "familyReferrals";
const CODES_KEY = "familyReferralCodes";

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function randomSuffix(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function codeFromName(name) {
  const slug = String(name || "FAM").replace(/[^a-zA-Z]/g, "").slice(0, 5).toUpperCase() || "FAM";
  return `${slug}-${randomSuffix(4)}`;
}

function referralFrom(data) {
  return createFamilyReferral({
    ...data,
    createdAt: data.createdAt || nowIso(),
    updatedAt: data.updatedAt || data.createdAt || nowIso(),
    lastSentAt: data.lastSentAt || data.createdAt || null,
  });
}

function trialPayload(session) {
  return {
    enabled: FAMILY_REFERRAL_PLUS_TRIAL_ENABLED,
    days: FAMILY_REFERRAL_PLUS_TRIAL_DAYS,
    copy: plusTrialCopy(),
    grantActive: Boolean(session?.referralGrant?.active),
    grantExpiresAt: session?.referralGrant?.expiresAt || null,
  };
}

function seedLocal() {
  const existingCodes = storage.get(CODES_KEY, null);
  const existingReferrals = storage.get(REFERRALS_KEY, null);
  if (existingCodes?.length && existingReferrals) {
    return {
      codes: existingCodes.map((item) => createFamilyReferralProfile(item)),
      referrals: existingReferrals.map(referralFrom),
    };
  }

  const codes = [
    createFamilyReferralProfile({
      userId: "user-family",
      code: "AMINA-7K2P",
      displayName: "Sarah Walsh",
      email: "family@famielda.test",
      invitedCount: 1,
      joinedCount: 0,
      successfulCount: 0,
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    }),
  ];
  const referrals = [
    referralFrom({
      id: "ref-tunde",
      code: "AMINA-7K2P",
      referrerId: "user-family",
      referrerName: "Sarah Walsh",
      referrerEmail: "family@famielda.test",
      email: "daniel.harper@example.com",
      name: "Daniel Harper",
      relationship: "Sibling",
      message: "Let’s keep Mama’s care on one page instead of a group chat.",
      channel: FAMILY_REFERRAL_CHANNEL.EMAIL,
      status: FAMILY_REFERRAL_STATUS.PENDING,
      createdAt: "2026-09-01T10:00:00.000Z",
      lastSentAt: "2026-09-01T10:00:00.000Z",
    }),
  ];
  storage.set(CODES_KEY, codes);
  storage.set(REFERRALS_KEY, referrals);
  return { codes, referrals };
}

function localCodes() {
  return seedLocal().codes;
}

function localReferrals() {
  return seedLocal().referrals;
}

function writeCodes(codes) {
  storage.set(CODES_KEY, codes);
  return codes;
}

function writeReferrals(referrals) {
  storage.set(REFERRALS_KEY, referrals);
  return referrals;
}

function saveReferral(referral) {
  const all = localReferrals();
  const index = all.findIndex((item) => item.id === referral.id);
  const next = referralFrom(referral);
  if (index >= 0) all[index] = next;
  else all.unshift(next);
  writeReferrals(all);
  return next;
}

function bumpProfile(userId, patch) {
  const codes = localCodes();
  const index = codes.findIndex((item) => item.userId === userId);
  if (index < 0) return null;
  const current = codes[index];
  codes[index] = createFamilyReferralProfile({
    ...current,
    invitedCount: Math.max(0, current.invitedCount + (patch.invited || 0)),
    joinedCount: Math.max(0, current.joinedCount + (patch.joined || 0)),
    successfulCount: Math.max(0, current.successfulCount + (patch.successful || 0)),
    updatedAt: nowIso(),
  });
  writeCodes(codes);
  return codes[index];
}

function ensureLocalProfile(session) {
  const codes = localCodes();
  const existing = codes.find((item) => item.userId === session.id);
  if (existing) {
    if (session.referralCode !== existing.code) {
      setSession(updateMockUser({ ...session, referralCode: existing.code }));
    }
    return existing;
  }
  const used = new Set(codes.map((item) => item.code));
  let code = session.referralCode || codeFromName(session.displayName);
  while (used.has(code)) code = codeFromName(session.displayName);
  const profile = createFamilyReferralProfile({
    userId: session.id,
    code,
    displayName: session.displayName,
    email: session.email,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  writeCodes([...codes, profile]);
  setSession(updateMockUser({ ...session, referralCode: code }));
  return profile;
}

function shareUrl(code) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = typeof window !== "undefined" && window.location.pathname.includes("/app/")
    ? origin
    : origin;
  return `${base}${registerHrefForCode(code)}`;
}

export function familyInviteUrl(code) {
  return shareUrl(code);
}

function workspaceFrom(session, profile, referrals) {
  return {
    profile,
    referrals,
    counts: countsFromReferrals(referrals),
    shareUrl: shareUrl(profile.code),
    trial: trialPayload(session),
  };
}

async function invoke(name, data = {}) {
  return callCloudFunction(name, data);
}

export async function resolveFamilyReferralCode(code) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  if (usesLiveAuth()) {
    try {
      return await invoke("resolveFamilyReferralCode", { code: normalized });
    } catch {
      return null;
    }
  }
  const profile = localCodes().find((item) => item.code === normalized);
  if (!profile) return null;
  return {
    code: profile.code,
    referrerId: profile.userId,
    referrerName: firstNameOf(profile.displayName),
  };
}

export async function getFamilyReferralWorkspace(session = getSession()) {
  if (!session?.id) throw new Error("Sign in to invite your family.");
  if (usesLiveAuth()) {
    const data = await invoke("getFamilyReferralWorkspace");
    return {
      ...data,
      shareUrl: shareUrl(data.profile?.code),
      referrals: (data.referrals || []).map(referralFrom),
      trial: { ...trialPayload(session), ...(data.trial || {}) },
    };
  }
  const profile = ensureLocalProfile(session);
  const referrals = localReferrals()
    .filter((item) => item.referrerId === session.id)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return workspaceFrom(getSession() || session, profile, referrals);
}

export async function inviteFamilyRelative(input = {}, session = getSession()) {
  if (!session?.id) throw new Error("Sign in to invite your family.");
  if (usesLiveAuth()) {
    const result = await invoke("inviteFamilyRelative", input);
    const referralId = result?.referral?.id;
    if (referralId) {
      trackInviteSent("family", {
        dedupeKey: `family_invited:${referralId}`,
        inviteKind: "family",
        inviteId: referralId,
      }, session);
    }
    return getFamilyReferralWorkspace(session);
  }

  const email = String(input.email || "").trim().toLowerCase();
  const name = String(input.name || "").trim();
  const relationship = String(input.relationship || "").trim();
  const message = String(input.message || "").trim().slice(0, 500);
  if (!name) throw new Error("Enter their name.");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");
  if (emailsEqual(email, session.email)) throw new Error("You cannot invite yourself.");
  if (relationship && !FAMILY_REFERRAL_RELATIONSHIPS.includes(relationship)) {
    throw new Error("Choose a family relationship.");
  }

  const profile = ensureLocalProfile(session);
  const mine = localReferrals().filter((item) => item.referrerId === session.id);
  if (mine.filter((item) => item.status === FAMILY_REFERRAL_STATUS.PENDING).length >= FAMILY_REFERRAL_LIMITS.maxPending) {
    throw new Error("You have too many waiting family invites. Revoke one before sending another.");
  }
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (mine.filter((item) => new Date(item.createdAt || 0).getTime() >= dayAgo).length >= FAMILY_REFERRAL_LIMITS.maxPerDay) {
    throw new Error("Daily family invite limit reached. Try again tomorrow.");
  }
  if (mine.some((item) => emailsEqual(item.email, email) && item.status !== FAMILY_REFERRAL_STATUS.REVOKED)) {
    throw new Error("That relative already has a family invite from you.");
  }

  const now = nowIso();
  const referral = saveReferral({
    id: newId("ref"),
    code: profile.code,
    referrerId: session.id,
    referrerName: session.displayName,
    referrerEmail: session.email,
    email,
    name,
    relationship: relationship || "Other family",
    message,
    channel: FAMILY_REFERRAL_CHANNEL.EMAIL,
    status: FAMILY_REFERRAL_STATUS.PENDING,
    lastSentAt: now,
    createdAt: now,
    updatedAt: now,
  });
  bumpProfile(session.id, { invited: 1 });

  const existing = listMockUsers().find((item) => emailsEqual(item.email, email));
  await notifyQuietly([{ email, userId: existing?.id || "" }], {
    type: NOTIFICATION_TYPES.FAMILY_REFERRAL,
    title: `${firstNameOf(session.displayName)} invited you to Famielda`,
    body: message || "Create an account so your household can coordinate care in one place.",
    href: registerHrefForCode(profile.code).replace(/^\//, ""),
    inviteId: referral.id,
    inviteToken: profile.code,
    actorId: session.id,
    actorName: session.displayName,
    entityType: "family_referral",
    entityId: referral.id,
  }, session);

  trackInviteSent("family", {
    dedupeKey: `family_invited:${referral.id}`,
    inviteKind: "family",
    inviteId: referral.id,
  }, session);
  return getFamilyReferralWorkspace(session);
}

export async function resendFamilyReferral(referralId, session = getSession()) {
  if (usesLiveAuth()) {
    await invoke("resendFamilyReferral", { referralId });
    return getFamilyReferralWorkspace(session);
  }
  const referral = localReferrals().find((item) => item.id === referralId && item.referrerId === session.id);
  if (!referral) throw new Error("That family invite was not found.");
  if (referral.status !== FAMILY_REFERRAL_STATUS.PENDING) throw new Error("Only waiting invites can be sent again.");
  const last = new Date(referral.lastSentAt || 0).getTime();
  if (last && Date.now() - last < AUTH.RESEND_COOLDOWN_MS) {
    throw new Error("Wait a moment before sending that invite again.");
  }
  saveReferral({ ...referral, lastSentAt: nowIso(), updatedAt: nowIso() });
  await notifyQuietly([{ email: referral.email }], {
    type: NOTIFICATION_TYPES.FAMILY_REFERRAL,
    title: `${firstNameOf(session.displayName)} invited you to Famielda`,
    body: referral.message || "Create an account so your household can coordinate care in one place.",
    href: registerHrefForCode(referral.code).replace(/^\//, ""),
    inviteId: referral.id,
    inviteToken: referral.code,
    actorId: session.id,
    actorName: session.displayName,
  }, session);
  return getFamilyReferralWorkspace(session);
}

export async function revokeFamilyReferral(referralId, session = getSession()) {
  if (usesLiveAuth()) {
    await invoke("revokeFamilyReferral", { referralId });
    return getFamilyReferralWorkspace(session);
  }
  const referral = localReferrals().find((item) => item.id === referralId && item.referrerId === session.id);
  if (!referral) throw new Error("That family invite was not found.");
  if (referral.status !== FAMILY_REFERRAL_STATUS.PENDING) throw new Error("Only waiting invites can be revoked.");
  saveReferral({ ...referral, status: FAMILY_REFERRAL_STATUS.REVOKED, updatedAt: nowIso() });
  return getFamilyReferralWorkspace(session);
}

export async function claimFamilyReferral(code, session = getSession()) {
  const normalized = normalizeReferralCode(code || readStoredReferralCode());
  if (!normalized || !session?.id) return { ok: false };
  if (usesLiveAuth()) {
    const result = await invoke("claimFamilyReferral", { code: normalized });
    clearStoredReferralCode();
    if (result?.ok) {
      setSession({ ...session, referredBy: result.referrerId || session.referredBy, referredByCode: normalized });
      if (result.referralId) {
        trackProductEvent(PRODUCT_EVENTS.INVITATION_ACCEPTED, {
          dedupeKey: `invitation_accepted:${result.referralId}`,
          inviteId: result.referralId,
          inviteKind: "family",
        }, session);
      }
    }
    return result;
  }
  if (session.referredBy) {
    clearStoredReferralCode();
    return { ok: true, alreadyClaimed: true };
  }
  const profile = localCodes().find((item) => item.code === normalized);
  if (!profile) throw new Error("That family invite is not valid.");
  if (profile.userId === session.id) throw new Error("You cannot use your own family invite.");

  const now = nowIso();
  const mine = localReferrals();
  let target = mine.find((item) => (
    item.code === normalized
    && item.status === FAMILY_REFERRAL_STATUS.PENDING
    && emailsEqual(item.email, session.email)
  ));
  if (!target) {
    target = saveReferral({
      id: newId("ref"),
      code: normalized,
      referrerId: profile.userId,
      referrerName: profile.displayName,
      referrerEmail: profile.email,
      email: session.email,
      name: session.displayName,
      channel: FAMILY_REFERRAL_CHANNEL.LINK,
      status: FAMILY_REFERRAL_STATUS.JOINED,
      inviteeUserId: session.id,
      inviteeName: session.displayName,
      inviteeRole: session.role || null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    bumpProfile(profile.userId, { invited: 1, joined: 1 });
  } else {
    target = saveReferral({
      ...target,
      status: FAMILY_REFERRAL_STATUS.JOINED,
      inviteeUserId: session.id,
      inviteeName: session.displayName,
      inviteeRole: session.role || null,
      joinedAt: now,
      updatedAt: now,
    });
    bumpProfile(profile.userId, { joined: 1 });
  }

  const next = updateMockUser({ ...session, referredBy: profile.userId, referredByCode: normalized });
  setSession(next);
  const referrer = getMockUser(profile.userId);
  await notifyQuietly([{ userId: profile.userId, email: profile.email }], {
    type: NOTIFICATION_TYPES.FAMILY_REFERRAL_JOINED,
    title: `${firstNameOf(session.displayName)} joined Famielda`,
    body: "Your family invite was used. When they choose Family, this referral is successful.",
    href: "referrals.html",
    actorId: session.id,
    actorName: session.displayName,
    entityId: target.id,
  }, session);
  clearStoredReferralCode();
  trackProductEvent(PRODUCT_EVENTS.INVITATION_ACCEPTED, {
    dedupeKey: `invitation_accepted:${target.id}`,
    inviteId: target.id,
    inviteKind: "family",
  }, session);
  return { ok: true, referralId: target.id, referrerName: firstNameOf(referrer?.displayName || profile.displayName) };
}

export async function completeFamilyReferral(session = getSession()) {
  if (!session?.id) return { ok: false };
  if (usesLiveAuth()) {
    return invoke("completeFamilyReferral", { role: session.role });
  }
  if (!session.referredBy) return { ok: true, completed: false };
  const joined = localReferrals().filter((item) => (
    item.inviteeUserId === session.id && item.status === FAMILY_REFERRAL_STATUS.JOINED
  ));
  if (!joined.length) return { ok: true, completed: false };
  const now = nowIso();
  let completed = false;
  for (const referral of joined) {
    if (session.role === ROLES.FAMILY) {
      saveReferral({
        ...referral,
        status: FAMILY_REFERRAL_STATUS.SUCCESSFUL,
        inviteeRole: session.role,
        successfulAt: now,
        trialEligible: true,
        updatedAt: now,
      });
      bumpProfile(referral.referrerId, { successful: 1 });
      completed = true;
      const referrer = getMockUser(referral.referrerId);
      await notifyQuietly([{ userId: referral.referrerId, email: referrer?.email }], {
        type: NOTIFICATION_TYPES.FAMILY_REFERRAL_SUCCESS,
        title: `${firstNameOf(session.displayName)} joined as family`,
        body: "Your family referral is successful.",
        href: "referrals.html",
        actorId: session.id,
        actorName: session.displayName,
        entityId: referral.id,
      }, session);
    } else {
      saveReferral({ ...referral, inviteeRole: session.role, updatedAt: now });
    }
  }
  return { ok: true, completed };
}

export async function maybeClaimStoredReferral(session = getSession()) {
  const code = readStoredReferralCode();
  if (!code || !session?.id || session.referredBy) return null;
  if (session.role && session.roleSelectedAt) return null;
  try {
    return await claimFamilyReferral(code, session);
  } catch {
    return null;
  }
}

export { isValidReferralCode, normalizeReferralCode, FAMILY_REFERRAL_RELATIONSHIPS, plusTrialCopy };
