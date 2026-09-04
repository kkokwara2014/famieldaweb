import { ACCOUNT_STATUS, ROLES, SUPPORT_PRIORITY, SUPPORT_STATUS } from "./constants.js";
import { SUPPORT_CATEGORIES } from "./support.js";
import { routes } from "./routes.js";

export { SUPPORT_CATEGORIES };

export const ADMIN_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    href: "/admin/index.html",
    summary: "Platform activity across households, plans, and support.",
  },
  {
    id: "users",
    label: "Users",
    href: "/admin/index.html?section=users",
    summary: "Every Famielda account — role, plan, and access.",
  },
  {
    id: "families",
    label: "Families",
    href: "/admin/index.html?section=families",
    summary: "Family members and the households they coordinate.",
  },
  {
    id: "seniors",
    label: "Seniors",
    href: "/admin/index.html?section=seniors",
    summary: "Senior profiles, owners, and circle size.",
  },
  {
    id: "caregivers",
    label: "Caregivers",
    href: "/admin/index.html?section=caregivers",
    summary: "Home caregivers, credentials, and assigned households.",
  },
  {
    id: "practitioners",
    label: "Practitioners",
    href: "/admin/index.html?section=practitioners",
    summary: "Nurses, physicians, and therapists on the platform.",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    href: "/admin/index.html?section=subscriptions",
    summary: "Free, Plus, and operational grants.",
  },
  {
    id: "payments",
    label: "Payments",
    href: "/admin/index.html?section=payments",
    summary: "Stripe invoices and recent charges.",
  },
    {
      id: "invitations",
      label: "Invitations",
      href: "/admin/index.html?section=invitations",
      summary: "Care-circle invitations across every household.",
    },
    {
      id: "referrals",
      label: "Family referrals",
      href: "/admin/index.html?section=referrals",
      summary: "Relatives invited to join Famielda.",
    },
  {
    id: "reports",
    label: "Reports",
    href: "/admin/index.html?section=reports",
    summary: "Platform counts, coverage, and export.",
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/admin/index.html?section=analytics",
    summary: "Product funnel events without health content.",
  },
  {
    id: "health",
    label: "Health",
    href: "/admin/index.html?section=health",
    summary: "Errors, Firebase, functions, auth, payments, and notification delivery.",
  },
  {
    id: "notifications",
    label: "Notifications",
    href: "/admin/index.html?section=notifications",
    summary: "Recent notices and platform messages.",
  },
  {
    id: "support",
    label: "Support",
    href: "/admin/index.html?section=support",
    summary: "Tickets from families and professionals.",
  },
  {
    id: "verification",
    label: "Verification",
    href: "/admin/index.html?section=verification",
    summary: "Review caregiver and practitioner credentials.",
  },
  {
    id: "audit",
    label: "Audit",
    href: "/admin/index.html?section=audit",
    summary: "Sensitive actions recorded by Cloud Functions.",
  },
  {
    id: "suspension",
    label: "Suspension",
    href: "/admin/index.html?section=suspension",
    summary: "Disable sign-in and restore access.",
  },
];

export const ADMIN_ROLE_FILTERS = [
  { id: "all", label: "All roles" },
  { id: ROLES.FAMILY, label: "Family" },
  { id: ROLES.CAREGIVER, label: "Caregiver" },
  { id: ROLES.HEALTH_PRACTITIONER, label: "Practitioner" },
  { id: ROLES.ADMIN, label: "Admin" },
];

export const ADMIN_STATUS_FILTERS = [
  { id: "all", label: "All statuses" },
  { id: ACCOUNT_STATUS.ACTIVE, label: "Active" },
  { id: ACCOUNT_STATUS.SUSPENDED, label: "Suspended" },
];

export const SUPPORT_STATUS_FILTERS = [
  { id: "all", label: "All tickets" },
  { id: SUPPORT_STATUS.OPEN, label: "Open" },
  { id: SUPPORT_STATUS.PENDING, label: "Pending" },
  { id: SUPPORT_STATUS.RESOLVED, label: "Resolved" },
  { id: SUPPORT_STATUS.CLOSED, label: "Closed" },
];

export const VERIFICATION_STATUS_FILTERS = [
  { id: "all", label: "All files" },
  { id: "pending", label: "Pending" },
  { id: "under_review", label: "Under review" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
  { id: "suspended", label: "Suspended" },
];

export const SUPPORT_PRIORITY_OPTIONS = [
  { id: SUPPORT_PRIORITY.LOW, label: "Low" },
  { id: SUPPORT_PRIORITY.NORMAL, label: "Normal" },
  { id: SUPPORT_PRIORITY.HIGH, label: "High" },
  { id: SUPPORT_PRIORITY.URGENT, label: "Urgent" },
];

export function adminSection(id) {
  return ADMIN_SECTIONS.find((item) => item.id === id) ?? ADMIN_SECTIONS[0];
}

export function currentAdminSection(search = window.location.search) {
  return adminSection(new URLSearchParams(search).get("section") || "overview");
}

export function adminHref(section = "overview", extra = {}) {
  const params = new URLSearchParams();
  if (section && section !== "overview") params.set("section", section);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${routes.admin}?${query}` : routes.admin;
}

export function adminCrumbs(section = currentAdminSection()) {
  if (section.id === "overview") return [];
  return [{ label: "Admin console", href: routes.admin }, section.label];
}

export function accountStatusLabel(status) {
  if (status === ACCOUNT_STATUS.SUSPENDED) return "Suspended";
  return "Active";
}

export function accountStatusBadge(status) {
  return status === ACCOUNT_STATUS.SUSPENDED ? "badge--danger" : "badge--success";
}

export function supportStatusLabel(status) {
  if (status === SUPPORT_STATUS.PENDING) return "Pending";
  if (status === SUPPORT_STATUS.RESOLVED) return "Resolved";
  if (status === SUPPORT_STATUS.CLOSED) return "Closed";
  return "Open";
}

export function supportStatusBadge(status) {
  if (status === SUPPORT_STATUS.RESOLVED || status === SUPPORT_STATUS.CLOSED) return "badge--success";
  if (status === SUPPORT_STATUS.PENDING) return "badge--warning";
  return "badge--brand";
}

export function supportPriorityLabel(priority) {
  return SUPPORT_PRIORITY_OPTIONS.find((item) => item.id === priority)?.label || "Normal";
}

export function supportCategoryLabel(category) {
  return SUPPORT_CATEGORIES.find((item) => item.id === category)?.label || "General";
}

export function planLabel(plan) {
  if (plan === "plus" || plan === "family" || plan === "circle") return "Plus";
  return "Free";
}

export function subscriptionStatusLabel(status) {
  const map = {
    active: "Active",
    trialing: "Trial",
    past_due: "Past due",
    canceled: "Canceled",
    unpaid: "Unpaid",
    incomplete: "Incomplete",
    paused: "Paused",
    none: "None",
  };
  return map[status] || (status ? String(status).replaceAll("_", " ") : "None");
}

export function inviteStatusLabel(status) {
  const map = {
    pending: "Pending",
    accepted: "Accepted",
    declined: "Declined",
    revoked: "Revoked",
  };
  return map[status] || status || "Unknown";
}

export function inviteStatusBadge(status) {
  if (status === "accepted") return "badge--success";
  if (status === "pending") return "badge--warning";
  if (status === "declined" || status === "revoked") return "badge--neutral";
  return "badge--brand";
}

export function formatAdminDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatAdminWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
