import { getBasePath } from "../core/paths.js";
import { ROLES } from "./constants.js";
import { inviteContinuePath, persistInviteToken } from "./invites.js";
import { hasCompletedOnboarding } from "./onboarding.js";
import { hasCompletedRoleSetup } from "./roles.js";

export const routes = {
  home: "/",
  howItWorks: "/how-it-works.html",
  forFamilies: "/for-families.html",
  forCaregivers: "/for-caregivers.html",
  forPractitioners: "/for-practitioners.html",
  pricing: "/pricing.html",
  about: "/about.html",
  faq: "/faq.html",
  resources: "/resources.html",
  contact: "/contact.html",
  privacy: "/privacy.html",
  terms: "/terms.html",
  login: "/login.html",
  register: "/register.html",
  invite: "/invite.html",
  forgotPassword: "/forgot-password.html",
  verifyEmail: "/verify-email.html",
  authAction: "/auth-action.html",
  selectRole: "/select-role.html",
  onboarding: "/onboarding.html",
  appHome: "/app/index.html",
  dashboard: "/app/dashboard.html",
  caregiver: "/app/caregiver.html",
  practitioner: "/app/practitioner.html",
  senior: "/app/senior.html",
  careCircle: "/app/care-circle.html",
  referrals: "/app/referrals.html",
  schedule: "/app/schedule.html",
  messages: "/app/messages.html",
  notifications: "/app/notifications.html",
  settings: "/app/settings.html",
  help: "/app/help.html",
  publicHelp: "/faq.html",
  verification: "/app/verification.html",
  admin: "/admin/index.html",
};

export function go(path) {
  window.location.assign(path);
}

export function iconUrl(name) {
  return `${getBasePath()}/assets/icons/${name}`;
}

export function homeFor(session) {
  if (!session) return routes.login;
  if (!hasCompletedRoleSetup(session)) return routes.selectRole;
  if (!hasCompletedOnboarding(session)) return routes.onboarding;
  const invited = inviteContinuePath();
  if (invited) return invited;
  if (session.role === ROLES.ADMIN) return routes.admin;
  if (session.role === ROLES.CAREGIVER) return routes.caregiver;
  if (session.role === ROLES.HEALTH_PRACTITIONER) return routes.practitioner;
  return routes.dashboard;
}

export function postAuthPath(session) {
  if (!hasCompletedRoleSetup(session)) return routes.selectRole;
  if (!hasCompletedOnboarding(session)) return routes.onboarding;
  const invited = inviteContinuePath();
  if (invited) return invited;
  const next = safeNextPath("");
  if (!next || next === routes.dashboard || next === routes.appHome || next === routes.selectRole || next === routes.onboarding) {
    return homeFor(session);
  }
  return next;
}

export function openHomeIfNeeded(session, currentRoute) {
  const home = homeFor(session);
  if (currentRoute && home !== currentRoute) {
    go(home);
    return true;
  }
  return false;
}

export function safeNextPath(fallback) {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return fallback;
  }
  return next;
}

export function goToLogin(nextPath = `${window.location.pathname}${window.location.search}`) {
  const inviteFromUrl = new URLSearchParams(window.location.search).get("invite") || "";
  if (inviteFromUrl) persistInviteToken(inviteFromUrl);
  const skip = [routes.login, routes.register, routes.forgotPassword, routes.verifyEmail, routes.authAction, routes.selectRole, routes.onboarding];
  const includeNext = nextPath && !skip.some((path) => nextPath.startsWith(path));
  const suffix = includeNext ? `?next=${encodeURIComponent(nextPath)}` : "";
  go(`${routes.login}${suffix}`);
}

export function sameOriginContinue(url, fallback) {
  if (!url) return fallback;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
