import { SUPPORT_PRIORITY } from "./constants.js";
import { routes } from "./routes.js";

export const HELP_TABS = [
  { id: "center", label: "Help center" },
  { id: "faq", label: "FAQ" },
  { id: "contact", label: "Contact" },
  { id: "problem", label: "Report" },
  { id: "account", label: "Account" },
  { id: "subscription", label: "Subscription" },
];

export const SUPPORT_KINDS = {
  CONTACT: "contact",
  PROBLEM: "problem",
  ACCOUNT: "account",
  SUBSCRIPTION: "subscription",
};

export const SUPPORT_CATEGORIES = [
  { id: "general", label: "General" },
  { id: "billing", label: "Billing & subscription" },
  { id: "account", label: "Account" },
  { id: "care", label: "Care workspace" },
  { id: "technical", label: "Technical" },
  { id: "problem", label: "Problem report" },
];

export const SUPPORT_KIND_DEFAULTS = {
  [SUPPORT_KINDS.CONTACT]: { category: "general", priority: SUPPORT_PRIORITY.NORMAL },
  [SUPPORT_KINDS.PROBLEM]: { category: "problem", priority: SUPPORT_PRIORITY.HIGH },
  [SUPPORT_KINDS.ACCOUNT]: { category: "account", priority: SUPPORT_PRIORITY.NORMAL },
  [SUPPORT_KINDS.SUBSCRIPTION]: { category: "billing", priority: SUPPORT_PRIORITY.NORMAL },
};

export const PROBLEM_TYPES = [
  { id: "page", label: "A page will not load or looks wrong" },
  { id: "data", label: "Care data is missing or incorrect" },
  { id: "schedule", label: "A visit, overlap, or schedule change failed" },
  { id: "billing", label: "Checkout, Plus, or an invoice failed" },
  { id: "notifications", label: "Invitations or reminders are not arriving" },
  { id: "other", label: "Something else" },
];

export const HELP_TOPICS = [
  {
    id: "getting-started",
    label: "Getting started",
    summary: "Roles, the first senior profile, and how the workspace is organized.",
    tab: "faq",
    category: "getting-started",
  },
  {
    id: "care-circle",
    label: "Care circle",
    summary: "Invite family, caregivers, and practitioners, and manage access.",
    tab: "faq",
    category: "circle",
  },
  {
    id: "schedule",
    label: "Schedule & visits",
    summary: "Availability, overlapping visits, check-in, and cancellations.",
    tab: "faq",
    category: "schedule",
  },
  {
    id: "account",
    label: "Account support",
    summary: "Password, email, verification, role setup, and deleting an account.",
    tab: "account",
    category: "account",
  },
  {
    id: "subscription",
    label: "Subscription support",
    summary: "Free vs Plus, Stripe checkout, cancel, resume, and invoices.",
    tab: "subscription",
    category: "subscription",
  },
  {
    id: "problem",
    label: "Report a problem",
    summary: "Tell operations what broke, including the page and what you expected.",
    tab: "problem",
    category: "problem",
  },
];

export const FAQ_CATEGORIES = [
  { id: "getting-started", label: "Getting started" },
  { id: "circle", label: "Care circle" },
  { id: "schedule", label: "Schedule & care" },
  { id: "account", label: "Account" },
  { id: "subscription", label: "Subscription" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy & security" },
];

export const FAQ_ITEMS = [
  {
    id: "what-is-famielda",
    category: "getting-started",
    question: "What is Famielda?",
    answer: "Famielda is a family care workspace. One senior profile, one care circle, one schedule, and one record — so coverage is planned instead of pieced together in a group chat.",
  },
  {
    id: "which-role",
    category: "getting-started",
    question: "Which role should I choose?",
    answer: "Family members coordinate the household. Caregivers provide daily support in the home. Health practitioners bring clinical judgment into the same workspace. You pick a role once after you create an account; an admin can change it later if needed.",
  },
  {
    id: "web-and-mobile",
    category: "getting-started",
    question: "Do web and mobile use the same account?",
    answer: "Yes. The same email and password open Famielda Web and Famielda Mobile. Password resets and account deletion apply to both.",
  },
  {
    id: "first-senior",
    category: "getting-started",
    question: "How do I add the person we are caring for?",
    answer: "Open Senior in the workspace and create a profile. Free includes one senior. Famielda Plus unlocks additional seniors and a larger circle.",
  },
  {
    id: "invite-family",
    category: "circle",
    question: "How do I invite relatives?",
    answer: "Open Care Circle and send an invitation by email. The person creates or signs in to a Famielda account, then accepts. Free allows two family members on the circle.",
  },
  {
    id: "invite-professionals",
    category: "circle",
    question: "Can I add a caregiver or practitioner?",
    answer: "Yes, from Care Circle. Professionals complete role setup and verification. Free allows one professional relationship. Plus removes that cap so multiple caregivers and practitioners can join.",
  },
  {
    id: "circle-permissions",
    category: "circle",
    question: "Who can see clinical notes and documents?",
    answer: "Circle roles and visibility settings control access. Clinical notes and documents are not shown to every member by default. Plus is required for the documents library.",
  },
  {
    id: "overlapping-visits",
    category: "schedule",
    question: "Can a caregiver work with more than one family?",
    answer: "Yes — multiple families are allowed. Simultaneous engagements are not. The scheduling engine rejects overlapping visits for the same professional, including concurrent booking attempts.",
  },
  {
    id: "time-zones",
    category: "schedule",
    question: "How do time zones work for visits?",
    answer: "Each visit is stored with a time zone. Availability, overlap checks, and reminders use that zone so a household in one city and a caregiver in another stay aligned.",
  },
  {
    id: "check-in",
    category: "schedule",
    question: "How do check-in and visit notes work?",
    answer: "The assigned professional checks in and out from Schedule. Visit notes and reports stay on the visit record so the circle can see what happened without a separate thread.",
  },
  {
    id: "medication",
    category: "schedule",
    question: "Where is the medication list?",
    answer: "Medication, dose logging, and appointment reminders are Famielda Plus features. They live under Senior after Plus is active.",
  },
  {
    id: "reset-password",
    category: "account",
    question: "How do I reset my password?",
    answer: "Use Forgot password on the sign-in page. We email a reset link to the address on the account. The new password works on web and mobile immediately.",
    href: "/forgot-password.html",
    hrefLabel: "Reset your password",
  },
  {
    id: "verify-email",
    category: "account",
    question: "Why do I need to verify my email?",
    answer: "A verified email is required before the workspace opens. Open the link in the message we sent, or request a new one from the verification page.",
  },
  {
    id: "change-role",
    category: "account",
    question: "Can I change my role after setup?",
    answer: "Role setup runs once. If you chose the wrong role, contact support with the account email and the role you need. An admin can update it.",
  },
  {
    id: "delete-account",
    category: "account",
    question: "How do I delete my account?",
    answer: "Open Settings → Account, enter your password, and confirm. This permanently removes the same login on web and mobile. Care data tied to the account cannot be recovered.",
    href: "/app/settings.html",
    hrefLabel: "Open account settings",
  },
  {
    id: "suspended",
    category: "account",
    question: "My account says it is suspended. What now?",
    answer: "Sign-in is blocked until an admin restores access. Contact support from another device or ask a circle admin to write in. Include the email on the suspended account.",
  },
  {
    id: "verification",
    category: "account",
    question: "How does professional verification work?",
    answer: "Caregivers and health practitioners submit identity and credential documents. Status moves Pending → Under review → Verified. Rejected or suspended files can be updated from Verification, or you can write to account support.",
    href: "/app/verification.html",
    hrefLabel: "Open verification",
  },
  {
    id: "who-pays",
    category: "subscription",
    question: "Do caregivers or practitioners pay Famielda?",
    answer: "No. The household that runs the workspace upgrades to Plus. Professionals create a free account and join by invitation.",
  },
  {
    id: "free-vs-plus",
    category: "subscription",
    question: "What is included on Free vs Plus?",
    answer: "Free covers one senior, two family members, and basic coordination. Plus is $9.99/month or $99.99/year and unlocks a larger circle, medication, documents, care history, and advanced reports.",
    href: "/app/settings.html?tab=plans",
    hrefLabel: "View plans",
  },
  {
    id: "how-to-upgrade",
    category: "subscription",
    question: "How do I upgrade to Plus?",
    answer: "Open Settings → Subscription and start checkout. Stripe handles the card. Plus is activated only after the webhook writes the subscription — never by a key in the browser.",
  },
  {
    id: "cancel-plus",
    category: "subscription",
    question: "How do I cancel Plus?",
    answer: "Cancel from Settings → Subscription. Stripe confirms cancellation at period end. Plus stays on through the renewal date, then the household returns to Free limits.",
  },
  {
    id: "resume-plus",
    category: "subscription",
    question: "Can I resume Plus after I cancel?",
    answer: "Yes, as long as the period has not ended. Use Resume Plus on the Subscription tab. Renewal continues on the existing date.",
  },
  {
    id: "past-due",
    category: "subscription",
    question: "What if a Plus payment fails?",
    answer: "The plan shows as past due. Update the card in Stripe from Settings → Subscription. Access continues if payment is updated before the period ends.",
  },
  {
    id: "invoices",
    category: "subscription",
    question: "Where are my invoices?",
    answer: "Recent Stripe invoices are listed under Settings → Subscription. Open any invoice, or use Open in Stripe for the full Customer Portal history.",
  },
  {
    id: "notice-channels",
    category: "notifications",
    question: "How do I turn notifications on or off?",
    answer: "Open Settings → Notifications. You can enable the in-app inbox and browser push, then choose which types you receive. Emergency alerts stay on so the circle cannot miss urgent care status.",
    href: "/app/settings.html?tab=notifications",
    hrefLabel: "Notification preferences",
  },
  {
    id: "missed-invite",
    category: "notifications",
    question: "I did not get an invitation email.",
    answer: "Check spam, then ask the sender to resend from Care Circle. Invitations also appear in the in-app inbox when you are signed in with that email.",
  },
  {
    id: "who-can-see-data",
    category: "privacy",
    question: "Who can see our care data?",
    answer: "Only signed-in members of that senior’s circle, with permissions that match their role. Admins can review platform records for operations. Cloud Functions and Firestore rules enforce access — the browser is not the security boundary.",
    href: "/privacy.html",
    hrefLabel: "Read the Privacy Policy",
  },
  {
    id: "privacy-policy",
    category: "privacy",
    question: "Where can I read the Privacy Policy?",
    answer: "The Privacy Policy explains what Famielda collects, who in a care circle can see it, how long we keep it, and how to delete your account. It applies to Famielda Web and Famielda Mobile.",
    href: "/privacy.html",
    hrefLabel: "Open Privacy Policy",
  },
  {
    id: "terms",
    category: "privacy",
    question: "Where are the Terms & Conditions?",
    answer: "The Terms cover accounts, roles, Plus billing, acceptable use, and what Famielda is not — including that it is not a hospital, pharmacy, or emergency service.",
    href: "/terms.html",
    hrefLabel: "Open Terms & Conditions",
  },
  {
    id: "stripe-keys",
    category: "privacy",
    question: "Does Famielda store my card number?",
    answer: "No. Checkout and the Customer Portal run on Stripe. Secret keys stay in Cloud Functions. Famielda stores subscription status, renewal date, and invoice references — not the full card.",
  },
  {
    id: "not-emergency",
    category: "privacy",
    question: "Is Famielda a medical device or emergency service?",
    answer: "No. Famielda coordinates the circle. It does not diagnose, prescribe, or replace emergency services. If someone is in immediate danger, contact local emergency services.",
  },
];

export const ACCOUNT_GUIDES = [
  {
    id: "password",
    title: "Password & sign-in",
    body: "Reset from the sign-in page. The new password opens web and mobile. If you are locked out after too many attempts, wait a few minutes and try again.",
    href: "/forgot-password.html",
    hrefLabel: "Forgot password",
  },
  {
    id: "email",
    title: "Email verification",
    body: "The workspace waits until the email is verified. Request a new link from the verification page if the first one expired.",
    href: "/verify-email.html",
    hrefLabel: "Verify email",
  },
  {
    id: "role",
    title: "Role and dashboard",
    body: "Family, caregiver, and practitioner dashboards are configured from the role you chose. If the wrong workspace opened, write to account support with the role you need.",
  },
  {
    id: "delete",
    title: "Delete the account",
    body: "Settings → Account permanently removes this login. Have your password ready. This cannot be undone.",
    href: "/app/settings.html",
    hrefLabel: "Account settings",
  },
];

export const SUBSCRIPTION_GUIDES = [
  {
    id: "upgrade",
    title: "Upgrade to Plus",
    body: "Checkout runs through Stripe. Plus unlocks after the webhook writes the subscription to Firestore.",
    href: "/app/settings.html?tab=plans",
    hrefLabel: "Manage subscription",
  },
  {
    id: "cancel",
    title: "Cancel or resume",
    body: "Cancel at period end from Settings. Resume before the renewal date to keep Plus without checking out again.",
    href: "/app/settings.html?tab=plans",
    hrefLabel: "Open billing",
  },
  {
    id: "payment",
    title: "Payment method & invoices",
    body: "Update the card and view the full invoice history in the Stripe Customer Portal. Recent invoices also appear in Settings.",
    href: "/app/settings.html?tab=plans",
    hrefLabel: "View invoices",
  },
];

export function helpTab(id) {
  return HELP_TABS.find((item) => item.id === id) ?? HELP_TABS[0];
}

export function currentHelpTab(search = window.location.search) {
  const requested = new URLSearchParams(search).get("tab");
  return helpTab(HELP_TABS.some((item) => item.id === requested) ? requested : "center");
}

export function helpHref(tab = "center", extra = {}) {
  const params = new URLSearchParams();
  if (tab && tab !== "center") params.set("tab", tab);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${routes.help}?${query}` : routes.help;
}

export function publicHelpHref(hash = "") {
  return hash ? `${routes.faq}#${hash}` : routes.faq;
}

export function supportCategoryLabel(category) {
  return SUPPORT_CATEGORIES.find((item) => item.id === category)?.label || "General";
}

export function searchFaq(query, items = FAQ_ITEMS) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const haystack = [item.question, item.answer, item.category].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function faqsForCategory(category, items = FAQ_ITEMS) {
  if (!category || category === "all") return items;
  return items.filter((item) => item.category === category);
}

export function faqCategoryLabel(id) {
  return FAQ_CATEGORIES.find((item) => item.id === id)?.label || "Help";
}
