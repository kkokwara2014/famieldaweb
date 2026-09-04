import { CARE_CIRCLE_ROLES, CIRCLE_KINDS, CIRCLE_STATUS, INVITE_STATUS } from "../config/constants.js";
import { permissionsForRole } from "../config/care-circle.js";

export function createCareCircleMember(data = {}) {
  const role = data.role ?? CARE_CIRCLE_ROLES.MEMBER;
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    userId: data.userId ?? null,
    name: data.name ?? "",
    email: data.email ?? "",
    phone: data.phone ?? "",
    phoneCountry: data.phoneCountry ?? "",
    role,
    relationship: data.relationship ?? "",
    status: data.status ?? CIRCLE_STATUS.ACTIVE,
    kind: data.kind ?? CIRCLE_KINDS.FAMILY,
    professionalType: data.professionalType ?? null,
    permissions: Array.isArray(data.permissions) ? data.permissions : permissionsForRole(role),
    availability: data.availability ?? "available",
    lastSeenAt: data.lastSeenAt ?? null,
    nextVisit: data.nextVisit ?? "",
    notes: data.notes ?? "",
    invitedBy: data.invitedBy ?? null,
    invitedAt: data.invitedAt ?? null,
    respondedAt: data.respondedAt ?? null,
    photoURL: data.photoURL ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

export function createCareCircleInvite(data = {}) {
  const role = data.role ?? CARE_CIRCLE_ROLES.MEMBER;
  return {
    id: data.id ?? "",
    token: data.token ?? "",
    seniorId: data.seniorId ?? "",
    seniorName: data.seniorName ?? "",
    email: data.email ?? "",
    name: data.name ?? "",
    phone: data.phone ?? "",
    phoneCountry: data.phoneCountry ?? "",
    channel: data.channel === "phone" ? "phone" : "email",
    inviteeUserId: data.inviteeUserId ?? null,
    accountState: data.accountState === "existing" ? "existing" : (data.accountState || ""),
    kind: data.kind ?? CIRCLE_KINDS.FAMILY,
    role,
    relationship: data.relationship ?? "",
    professionalType: data.professionalType ?? null,
    permissions: Array.isArray(data.permissions) ? data.permissions : permissionsForRole(role),
    status: data.status ?? INVITE_STATUS.PENDING,
    invitedBy: data.invitedBy ?? "",
    invitedByName: data.invitedByName ?? "",
    memberId: data.memberId ?? null,
    message: data.message ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    respondedAt: data.respondedAt ?? null,
  };
}
