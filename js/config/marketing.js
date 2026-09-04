export const MARKETING_TAGLINE = "Know they're cared for, even when you can't be there.";

export const MARKETING_PRIMARY = [
  { id: "how-it-works", href: "how-it-works.html", label: "How it works" },
  { id: "families", href: "for-families.html", label: "Families" },
  { id: "caregivers", href: "for-caregivers.html", label: "Caregivers" },
  { id: "practitioners", href: "for-practitioners.html", label: "Practitioners" },
  { id: "pricing", href: "pricing.html", label: "Pricing" },
];

export const MARKETING_MORE = [
  { id: "about", href: "about.html", label: "About" },
  { id: "faq", href: "faq.html", label: "FAQ" },
  { id: "resources", href: "resources.html", label: "Resources" },
  { id: "contact", href: "contact.html", label: "Contact" },
];

export const MARKETING_AUTH = [
  { id: "login", href: "login.html", label: "Log in" },
  { id: "register", href: "register.html", label: "Sign up" },
];

export const CONTACT_ROLES = [
  { id: "family", label: "Family" },
  { id: "caregiver", label: "Caregiver" },
  { id: "practitioner", label: "Health practitioner" },
  { id: "other", label: "Something else" },
];

export const CONTACT_TOPICS = [
  { id: "general", label: "General question" },
  { id: "families", label: "For families" },
  { id: "caregivers", label: "For caregivers" },
  { id: "practitioners", label: "For health practitioners" },
  { id: "billing", label: "Pricing & billing" },
  { id: "press", label: "Press or partnership" },
];

const NAV_ALIASES = {
  home: "home",
  "how it works": "how-it-works",
  "log in": "login",
  login: "login",
  "sign up": "register",
  register: "register",
  "get started": "register",
  families: "families",
  caregivers: "caregivers",
  practitioners: "practitioners",
  pricing: "pricing",
  about: "about",
  faq: "faq",
  help: "faq",
  resources: "resources",
  "senior-care": "resources",
  "family-caregiver-guide": "resources",
  "caregiver-resources": "resources",
  "aging-parent": "resources",
  "care-from-a-distance": "resources",
  "building-a-care-circle": "resources",
  "talking-with-aging-parents": "resources",
  contact: "contact",
  privacy: "privacy",
  "privacy policy": "privacy",
  terms: "terms",
  "terms & conditions": "terms",
  "terms and conditions": "terms",
};

export function marketingPageId(active = "home") {
  const key = String(active || "home").trim().toLowerCase();
  return NAV_ALIASES[key] || key;
}

export function isMarketingMorePage(id) {
  return MARKETING_MORE.some((item) => item.id === id);
}
