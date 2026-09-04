import { APP_NAV, ROLES } from "./constants.js";
import { dashboardHrefFor, isProfessionalRole } from "./roles.js";
import { homeFor, routes } from "./routes.js";
import { ADMIN_SECTIONS, currentAdminSection } from "./admin.js";
import { currentSeniorMode, currentSeniorSection, SENIOR_HUB_SECTIONS, seniorHubCrumbs } from "./senior-hub.js";

export const PAGE_META = {
  dashboard: { id: "dashboard", label: "Dashboard" },
  senior: { id: "senior", label: "Senior" },
  "care-circle": { id: "care-circle", label: "Care Circle" },
  referrals: { id: "referrals", label: "Invite family" },
  schedule: { id: "schedule", label: "Schedule" },
  messages: { id: "messages", label: "Messages" },
  notifications: { id: "notifications", label: "Notifications" },
  settings: { id: "settings", label: "Settings" },
  help: { id: "help", label: "Help & Support" },
  verification: { id: "verification", label: "Verification" },
  admin: { id: "admin", label: "Admin console" },
};

export const MOBILE_NAV_IDS = ["dashboard", "senior", "messages", "schedule", "notifications"];

export function workspaceLabel(role) {
  if (role === ROLES.CAREGIVER) return "Caregiver workspace";
  if (role === ROLES.HEALTH_PRACTITIONER) return "Clinical workspace";
  if (role === ROLES.ADMIN) return "Admin";
  return "Family workspace";
}

export function pageMeta(page) {
  return PAGE_META[page] ?? { id: page, label: "Famielda" };
}

export function pageTitle(page, fallback) {
  return fallback || pageMeta(page).label;
}

export function toShellHref(path, appRoot) {
  if (!path) return appRoot;
  if (path.startsWith("/app/")) return `${appRoot}/${path.slice(5)}`;
  if (path.startsWith("/admin/")) {
    return `${appRoot.replace(/\/app$/, "/admin")}/${path.split("/").pop()}`;
  }
  if (path.startsWith("/")) return path;
  return `${appRoot}/${path.replace(/^\//, "")}`;
}

export function navHref(item, session, appRoot) {
  if (item.id === "dashboard") {
    return `${appRoot}/${dashboardHrefFor(session.role)}`;
  }
  if (item.absolute || item.href.startsWith("/")) {
    return toShellHref(item.href, appRoot);
  }
  return `${appRoot}/${item.href}`;
}

export function workspaceNav() {
  return APP_NAV.map((item) => {
    if (item.id === "senior") {
      return {
        ...item,
        section: "workspace",
        children: SENIOR_HUB_SECTIONS.map((child) => ({ ...child })),
      };
    }
    return { ...item, section: "workspace" };
  });
}

export function currentHubSection(page) {
  if (page === "senior") return currentSeniorSection().id;
  if (page === "admin") return currentAdminSection().id;
  return null;
}

export function sidebarNav(session) {
  const items = workspaceNav();
  if (isProfessionalRole(session.role)) {
    items.push({
      id: "verification",
      label: "Verification",
      href: "verification.html",
      icon: "shield",
      section: "account",
    });
  }
  if (session.role === ROLES.ADMIN) {
    items.push({
      id: "admin",
      label: "Admin console",
      href: routes.admin,
      icon: "admin",
      absolute: true,
      section: "operations",
      children: ADMIN_SECTIONS.map((child) => ({ ...child, absolute: true })),
    });
  }
  return items;
}

export function mobileNav(session) {
  return workspaceNav().filter((item) => MOBILE_NAV_IDS.includes(item.id));
}

export function breadcrumbItems({ page, session, crumbs, appRoot }) {
  const home = {
    label: workspaceLabel(session.role),
    href: toShellHref(homeFor(session), appRoot),
  };

  if (Array.isArray(crumbs) && crumbs.length) {
    return [
      home,
      ...crumbs.map((crumb) => (
        typeof crumb === "string" ? { label: crumb } : crumb
      )),
    ];
  }

  const current = pageMeta(page);
  if (page === "senior") {
    return [
      home,
      ...seniorHubCrumbs(currentSeniorSection(), currentSeniorMode()).map((crumb) => (
        typeof crumb === "string" ? { label: crumb } : crumb
      )),
    ];
  }

  if (page === "dashboard") {
    return [{ label: home.label }];
  }

  if (page === "admin") {
    const section = currentAdminSection();
    if (section.id === "overview") return [{ label: current.label }];
    return [
      { label: current.label, href: toShellHref(routes.admin, appRoot) },
      { label: section.label },
    ];
  }

  return [home, { label: current.label }];
}
