import { CIRCLE_KINDS, ROLES } from "./constants.js";

export const CARE_CIRCLE_INVITE_STORAGE_KEY = "famielda.careCircleInvite";
export const CARE_CIRCLE_INVITE_PREVIEW_KEY = "famielda.careCircleInvitePreview";

export const INVITE_CHANNELS = {
  EMAIL: "email",
  PHONE: "phone",
};

function readSession(key) {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSession(key, value) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Ignore private-mode quota failures; the query string still carries the token.
  }
}

export function normalizeInviteToken(value) {
  return String(value || "").trim().slice(0, 80);
}

export function persistInviteToken(token) {
  const normalized = normalizeInviteToken(token);
  if (!normalized) return "";
  writeSession(CARE_CIRCLE_INVITE_STORAGE_KEY, normalized);
  return normalized;
}

export function readStoredInviteToken() {
  if (typeof window === "undefined") return "";
  const fromQuery = normalizeInviteToken(
    new URLSearchParams(window.location.search).get("invite")
      || new URLSearchParams(window.location.search).get("t"),
  );
  if (fromQuery) {
    persistInviteToken(fromQuery);
    return fromQuery;
  }
  return normalizeInviteToken(readSession(CARE_CIRCLE_INVITE_STORAGE_KEY));
}

export function clearStoredInviteToken() {
  writeSession(CARE_CIRCLE_INVITE_STORAGE_KEY, "");
  writeSession(CARE_CIRCLE_INVITE_PREVIEW_KEY, "");
}

export function persistInvitePreview(preview) {
  if (!preview || typeof preview !== "object") return null;
  writeSession(CARE_CIRCLE_INVITE_PREVIEW_KEY, JSON.stringify({
    token: normalizeInviteToken(preview.token),
    status: preview.status || "pending",
    name: String(preview.name || "").slice(0, 120),
    seniorName: String(preview.seniorName || "").slice(0, 120),
    invitedByName: String(preview.invitedByName || "").slice(0, 120),
    kind: preview.kind || CIRCLE_KINDS.FAMILY,
    relationship: String(preview.relationship || "").slice(0, 80),
    channel: preview.channel === INVITE_CHANNELS.PHONE ? INVITE_CHANNELS.PHONE : INVITE_CHANNELS.EMAIL,
    accountState: preview.accountState === "existing" ? "existing" : "new",
    email: String(preview.email || "").trim().toLowerCase().slice(0, 160),
    phone: String(preview.phone || "").slice(0, 20),
    loginEmail: String(preview.loginEmail || preview.email || "").trim().toLowerCase().slice(0, 160),
  }));
  if (preview.token) persistInviteToken(preview.token);
  return preview;
}

export function readStoredInvitePreview() {
  const raw = readSession(CARE_CIRCLE_INVITE_PREVIEW_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function inviteLandingPath(token) {
  const normalized = normalizeInviteToken(token);
  return normalized ? `/invite.html?t=${encodeURIComponent(normalized)}` : "/invite.html";
}

export function inviteAcceptPath(token) {
  const normalized = normalizeInviteToken(token);
  return normalized
    ? `/app/care-circle.html?invite=${encodeURIComponent(normalized)}`
    : "/app/care-circle.html";
}

export function inviteRegisterPath(token) {
  const normalized = normalizeInviteToken(token);
  return normalized ? `/register.html?invite=${encodeURIComponent(normalized)}` : "/register.html";
}

export function inviteLoginPath(token) {
  const normalized = normalizeInviteToken(token);
  return normalized ? `/login.html?invite=${encodeURIComponent(normalized)}` : "/login.html";
}

export function careCircleInviteUrl(token, origin = "") {
  const path = inviteLandingPath(token);
  const base = String(origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export function inviteContinuePath() {
  const token = readStoredInviteToken();
  return token ? inviteAcceptPath(token) : "";
}

export function maskEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.indexOf("@");
  if (at < 1) return value ? "an email address" : "";
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = name.slice(0, name.length === 1 ? 1 : 1);
  return `${visible}${"•".repeat(Math.min(6, Math.max(2, name.length - 1)))}@${domain}`;
}

export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return phone ? "a phone number" : "";
  return `+${"•".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export function inviteContactLabel(invite = {}) {
  if (invite.channel === INVITE_CHANNELS.PHONE || (invite.phone && !invite.email)) {
    return invite.phone || "their phone";
  }
  return invite.email || "their email";
}

export function roleForInviteKind(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return ROLES.CAREGIVER;
  if (kind === CIRCLE_KINDS.PRACTITIONER) return ROLES.HEALTH_PRACTITIONER;
  if (kind === CIRCLE_KINDS.FAMILY) return ROLES.FAMILY;
  return "";
}

export function inviteKindPhrase(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return "as a caregiver";
  if (kind === CIRCLE_KINDS.PRACTITIONER) return "as a health practitioner";
  return "as family";
}

export function inviteShareText({ invitedByName, seniorName, kind, url } = {}) {
  const who = String(invitedByName || "A family member").trim().split(/\s+/)[0] || "A family member";
  const household = String(seniorName || "a Famielda household").trim() || "a Famielda household";
  const role = inviteKindPhrase(kind);
  return `${who} invited you to join ${household}’s care circle ${role} on Famielda.\n\n${url}`;
}

export function inviteEmailSubject(seniorName) {
  const household = String(seniorName || "a Famielda household").trim() || "a Famielda household";
  return `You’re invited to ${household}’s care circle on Famielda`;
}

export function smsInviteHref(phone, body) {
  const number = String(phone || "").replace(/[^\d+]/g, "");
  const encoded = encodeURIComponent(body || "");
  const apple = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Mac/.test(navigator.userAgent);
  return apple
    ? `sms:${number}&body=${encoded}`
    : `sms:${number}?body=${encoded}`;
}

export function mailtoInviteHref(email, { subject, body } = {}) {
  const to = String(email || "").trim();
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${to}${query ? `?${query}` : ""}`;
}

export function splitInviteName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}
