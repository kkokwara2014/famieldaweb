import {
  CIRCLE_KINDS,
  CIRCLE_PERMISSIONS,
  CIRCLE_STATUS,
  CONVERSATION_TYPES,
  PROFESSIONAL_TYPES,
  ROLES,
} from "./constants.js";
import { hasPermission } from "./care-circle.js";
import { professionalTypeLabel } from "./roles.js";

export const MESSAGE_MAX_LENGTH = 4000;

export const UNAUTHORIZED_MESSAGE =
  "Famielda only lets people on the same care circle message each other.";

export const CONTACT_GROUPS = [
  { id: "caregiver", label: "Caregiver", kinds: [CIRCLE_KINDS.CAREGIVER] },
  { id: PROFESSIONAL_TYPES.NURSE, label: "Nurse", professionalType: PROFESSIONAL_TYPES.NURSE },
  { id: PROFESSIONAL_TYPES.PHYSIOTHERAPIST, label: "Physiotherapist", professionalType: PROFESSIONAL_TYPES.PHYSIOTHERAPIST },
  { id: PROFESSIONAL_TYPES.MD, label: "MD", professionalType: PROFESSIONAL_TYPES.MD },
  { id: "practitioner", label: "Practitioner", kinds: [CIRCLE_KINDS.PRACTITIONER] },
  { id: "family", label: "Family", kinds: [CIRCLE_KINDS.FAMILY] },
];

export function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

export function isActiveMember(member) {
  return member?.status === CIRCLE_STATUS.ACTIVE;
}

export function participantKey(person = {}) {
  if (person.userId) return String(person.userId);
  if (person.kind || person.status || person.relationship) {
    const email = String(person.email || "").trim().toLowerCase();
    if (email) return `email:${email}`;
    if (person.id) return `member:${person.id}`;
    return "";
  }
  if (person.id) return String(person.id);
  const email = String(person.email || "").trim().toLowerCase();
  return email ? `email:${email}` : "";
}

export function sessionParticipantKey(session) {
  if (!session) return "";
  if (session.id) return String(session.id);
  const email = String(session.email || "").trim().toLowerCase();
  return email ? `email:${email}` : "";
}

export function memberMatchesKey(member, key) {
  if (!member || !key) return false;
  return participantKey(member) === key
    || (member.userId && member.userId === key)
    || (member.id && `member:${member.id}` === key)
    || (member.email && `email:${String(member.email).trim().toLowerCase()}` === key);
}

export function findMemberByKey(members = [], key) {
  return members.find((member) => memberMatchesKey(member, key)) ?? null;
}

export function findActorMember(members = [], session, senior) {
  if (!session) return null;
  const key = sessionParticipantKey(session);
  const match = members.find((member) => (
    isActiveMember(member)
    && (
      (session.id && member.userId === session.id)
      || emailsEqual(member.email, session.email)
      || memberMatchesKey(member, key)
    )
  ));
  if (match) return match;
  if (senior?.ownerId && senior.ownerId === session.id) {
    return members.find((member) => member.role === "owner") ?? null;
  }
  if (session.role === ROLES.ADMIN) {
    return members.find((member) => isActiveMember(member)) ?? null;
  }
  return null;
}

export function isFamilySide(member, session) {
  if (session?.role === ROLES.ADMIN) return true;
  if (session?.role === ROLES.FAMILY) return true;
  return member?.kind === CIRCLE_KINDS.FAMILY;
}

export function isProfessionalSide(member) {
  return member?.kind === CIRCLE_KINDS.CAREGIVER || member?.kind === CIRCLE_KINDS.PRACTITIONER;
}

export function canPostToCircle(actor, session) {
  if (session?.role === ROLES.ADMIN) return true;
  if (!actor || !isActiveMember(actor)) return false;
  return hasPermission(actor, CIRCLE_PERMISSIONS.MESSAGE_CIRCLE);
}

export function canMessageDirect(actor, other, session) {
  if (!actor || !other) return false;
  if (actor.seniorId && other.seniorId && actor.seniorId !== other.seniorId) return false;
  if (!isActiveMember(actor) || !isActiveMember(other)) return false;
  if (participantKey(actor) === participantKey(other)) return false;
  if (session?.role === ROLES.ADMIN) return true;
  return (isFamilySide(actor, session) && isProfessionalSide(other))
    || (isProfessionalSide(actor) && isFamilySide(other, null));
}

export function unauthorizedMessageError(actor, other) {
  if (!actor && !other) return UNAUTHORIZED_MESSAGE;
  if (!other || !isActiveMember(other)) {
    return other
      ? "That person is not an active member of this care circle."
      : UNAUTHORIZED_MESSAGE;
  }
  if (actor && participantKey(actor) === participantKey(other)) {
    return "Choose someone else on this household to message.";
  }
  if (isProfessionalSide(actor) && isProfessionalSide(other)) {
    return "Caregivers and clinicians message family on this household — not each other through Famielda.";
  }
  return UNAUTHORIZED_MESSAGE;
}

export function authorizedContacts(members = [], actor, session) {
  return members
    .filter((member) => canMessageDirect(actor, member, session))
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function contactGroupId(member) {
  if (member?.kind === CIRCLE_KINDS.CAREGIVER) return "caregiver";
  if (member?.professionalType === PROFESSIONAL_TYPES.NURSE) return PROFESSIONAL_TYPES.NURSE;
  if (member?.professionalType === PROFESSIONAL_TYPES.PHYSIOTHERAPIST) return PROFESSIONAL_TYPES.PHYSIOTHERAPIST;
  if (member?.professionalType === PROFESSIONAL_TYPES.MD) return PROFESSIONAL_TYPES.MD;
  if (member?.kind === CIRCLE_KINDS.PRACTITIONER) return "practitioner";
  return "family";
}

export function contactGroupLabel(member) {
  return CONTACT_GROUPS.find((item) => item.id === contactGroupId(member))?.label ?? "Family";
}

export function groupedContacts(contacts = []) {
  const used = new Set();
  return CONTACT_GROUPS.map((group) => {
    const items = contacts.filter((member) => {
      const id = contactGroupId(member);
      if (id !== group.id) return false;
      if (used.has(member.id)) return false;
      used.add(member.id);
      return true;
    });
    return { ...group, items };
  }).filter((group) => group.items.length);
}

export function contactRoleLabel(member, sessionRole) {
  if (!member) return "Circle";
  if (member.kind === CIRCLE_KINDS.CAREGIVER) {
    return professionalTypeLabel(ROLES.CAREGIVER, member.professionalType) || member.relationship || "Caregiver";
  }
  if (member.kind === CIRCLE_KINDS.PRACTITIONER) {
    return professionalTypeLabel(ROLES.HEALTH_PRACTITIONER, member.professionalType) || member.relationship || "Practitioner";
  }
  return member.relationship || (sessionRole === ROLES.FAMILY ? "Family" : "Family member");
}

export function pairKeyFor(seniorId, keyA, keyB) {
  const keys = [String(keyA || ""), String(keyB || "")].filter(Boolean).sort();
  return `direct:${seniorId}:${keys.join("|")}`;
}

export function circlePairKey(seniorId) {
  return `circle:${seniorId}`;
}

export function conversationParticipantKeys(members = []) {
  return [...new Set(members.filter(isActiveMember).map(participantKey).filter(Boolean))];
}

export function conversationParticipantIds(members = []) {
  return [...new Set(members.filter((member) => isActiveMember(member) && member.userId).map((member) => member.userId))];
}

export function otherParticipantKey(conversation, sessionKey) {
  if (!conversation || conversation.type === CONVERSATION_TYPES.CIRCLE) return "";
  return (conversation.participantKeys || []).find((key) => key && key !== sessionKey) || "";
}

export function isUnreadConversation(conversation, sessionKey) {
  if (!conversation?.lastMessageAt || !sessionKey) return false;
  if (conversation.lastAuthorKey && conversation.lastAuthorKey === sessionKey) return false;
  const readAt = conversation.readAtBy?.[sessionKey];
  if (!readAt) return true;
  return String(conversation.lastMessageAt) > String(readAt);
}

export function truncateMessage(body, length = 88) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1)}…`;
}

export function normalizeMessageBody(body) {
  const text = String(body ?? "").trim();
  if (!text) throw new Error("Write a message before sending.");
  if (text.length > MESSAGE_MAX_LENGTH) {
    throw new Error("Keep messages under 4,000 characters.");
  }
  return text;
}
