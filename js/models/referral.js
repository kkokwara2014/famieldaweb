import { FAMILY_REFERRAL_CHANNEL, FAMILY_REFERRAL_STATUS } from "../config/constants.js";

export function createFamilyReferral(data = {}) {
  return {
    id: data.id ?? "",
    code: data.code ?? "",
    referrerId: data.referrerId ?? "",
    referrerName: data.referrerName ?? "",
    referrerEmail: data.referrerEmail ?? "",
    email: data.email ?? "",
    name: data.name ?? "",
    relationship: data.relationship ?? "",
    message: data.message ?? "",
    channel: data.channel ?? FAMILY_REFERRAL_CHANNEL.EMAIL,
    status: data.status ?? FAMILY_REFERRAL_STATUS.PENDING,
    inviteeUserId: data.inviteeUserId ?? null,
    inviteeName: data.inviteeName ?? "",
    inviteeRole: data.inviteeRole ?? null,
    joinedAt: data.joinedAt ?? null,
    successfulAt: data.successfulAt ?? null,
    lastSentAt: data.lastSentAt ?? data.createdAt ?? null,
    trialEligible: Boolean(data.trialEligible),
    trialGrantedAt: data.trialGrantedAt ?? null,
    trialEndsAt: data.trialEndsAt ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

export function createFamilyReferralProfile(data = {}) {
  return {
    userId: data.userId ?? data.id ?? "",
    code: data.code ?? "",
    displayName: data.displayName ?? "",
    email: data.email ?? "",
    invitedCount: Number(data.invitedCount) || 0,
    joinedCount: Number(data.joinedCount) || 0,
    successfulCount: Number(data.successfulCount) || 0,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}
