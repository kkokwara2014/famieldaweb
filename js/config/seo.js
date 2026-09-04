/**
 * Famielda SEO — Module 35.
 * Public titles, descriptions, canonicals, and structured data.
 * Keep sitemap.xml in sync with PUBLIC_PAGES.
 */

export const SITE_ORIGIN = "https://famielda.web.app";
export const SITE_NAME = "Famielda";
export const SITE_TAGLINE = "Know they're cared for, even when you can't be there.";
export const DEFAULT_LOCALE = "en_US";
export const OG_IMAGE_PATH = "/assets/images/og-cover.jpg";
export const OG_IMAGE_ALT = "Famielda — the family care platform";
export const OG_IMAGE_WIDTH = "1200";
export const OG_IMAGE_HEIGHT = "630";

export const DEFAULT_DESCRIPTION =
  "Famielda helps families know their loved one is cared for — even when they can't be there. One senior profile, one care circle, one week.";

export function absoluteUrl(path = "/") {
  if (!path || path === "/") return `${SITE_ORIGIN}/`;
  if (path.startsWith("http")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_ORIGIN}${normalized}`;
}

export function ogImageUrl() {
  return absoluteUrl(OG_IMAGE_PATH);
}

export const PUBLIC_PAGES = {
  home: {
    id: "home",
    path: "/",
    title: "Famielda — Coordinate senior care with your family",
    description: DEFAULT_DESCRIPTION,
    type: "website",
    changefreq: "weekly",
    priority: "1.0",
  },
  "how-it-works": {
    id: "how-it-works",
    path: "/how-it-works.html",
    title: "How Famielda works — Senior profile, care circle, and the week",
    description: "See how Famielda works: create a senior profile, invite the care circle, and run the week together.",
    type: "website",
    changefreq: "monthly",
    priority: "0.8",
  },
  families: {
    id: "families",
    path: "/for-families.html",
    title: "Famielda for families — Coordinate aging-parent care",
    description: "Famielda for families: coordinate a senior’s care circle, week, and record — even when you can't be there.",
    type: "website",
    changefreq: "monthly",
    priority: "0.8",
  },
  caregivers: {
    id: "caregivers",
    path: "/for-caregivers.html",
    title: "Famielda for caregivers — Arrive with the plan in hand",
    description: "Famielda for caregivers: visit the home with the plan, check in, and keep the family informed.",
    type: "website",
    changefreq: "monthly",
    priority: "0.8",
  },
  practitioners: {
    id: "practitioners",
    path: "/for-practitioners.html",
    title: "Famielda for health practitioners — Join the family workspace",
    description: "Famielda for health practitioners: bring clinical judgment into the same workspace the family already uses.",
    type: "website",
    changefreq: "monthly",
    priority: "0.7",
  },
  pricing: {
    id: "pricing",
    path: "/pricing.html",
    title: "Famielda pricing — Free family start and Plus",
    description: "Famielda pricing: Free for one senior and two family members. Plus is $9.99/month or $99.99/year for the full care circle.",
    type: "website",
    changefreq: "monthly",
    priority: "0.8",
  },
  about: {
    id: "about",
    path: "/about.html",
    title: "About Famielda — The family care platform",
    description: "About Famielda: a family care workspace so people know their loved one is cared for, even when they can't be there.",
    type: "website",
    changefreq: "monthly",
    priority: "0.6",
  },
  contact: {
    id: "contact",
    path: "/contact.html",
    title: "Contact Famielda",
    description: "Contact Famielda about family care coordination, professional accounts, pricing, or partnerships.",
    type: "website",
    changefreq: "monthly",
    priority: "0.5",
  },
  privacy: {
    id: "privacy",
    path: "/privacy.html",
    title: "Privacy Policy — Famielda",
    description: "Famielda Privacy Policy — how we collect, use, share, and protect information in the family care workspace.",
    type: "website",
    changefreq: "yearly",
    priority: "0.4",
  },
  terms: {
    id: "terms",
    path: "/terms.html",
    title: "Terms & Conditions — Famielda",
    description: "Famielda Terms & Conditions — the agreement for using the family care workspace on web and mobile.",
    type: "website",
    changefreq: "yearly",
    priority: "0.4",
  },
  faq: {
    id: "faq",
    path: "/faq.html",
    title: "Famielda FAQ — Care circles, scheduling, and accounts",
    description:
      "Answers about Famielda care circles, visits, accounts, and Plus — then write in if you still need the household Help Center.",
    type: "website",
    changefreq: "weekly",
    priority: "0.7",
  },
  resources: {
    id: "resources",
    path: "/resources.html",
    title: "Senior care & family caregiver resources — Famielda",
    description:
      "Guides for family caregivers, aging-parent care, and professional caregivers. Practical resources for coordinating senior care without the group-chat scramble.",
    type: "website",
    changefreq: "weekly",
    priority: "0.9",
  },
  "senior-care": {
    id: "senior-care",
    path: "/senior-care.html",
    title: "Senior care resources for families — Famielda",
    description:
      "A practical senior care resource for families: what to organize, who to involve, and how to keep daily care visible across the circle.",
    type: "article",
    changefreq: "monthly",
    priority: "0.8",
  },
  "family-caregiver-guide": {
    id: "family-caregiver-guide",
    path: "/family-caregiver-guide.html",
    title: "Family caregiver guide — Sharing care without losing the plot",
    description:
      "A family caregiver guide for the first weeks of coordinating care, dividing responsibility, and keeping siblings and helpers aligned.",
    type: "article",
    changefreq: "monthly",
    priority: "0.8",
  },
  "caregiver-resources": {
    id: "caregiver-resources",
    path: "/caregiver-resources.html",
    title: "Caregiver resources for working with families — Famielda",
    description:
      "Resources for caregivers working inside a family care circle — visit rhythm, notes, and how to stay coordinated with relatives.",
    type: "article",
    changefreq: "monthly",
    priority: "0.8",
  },
  "aging-parent": {
    id: "aging-parent",
    path: "/aging-parent.html",
    title: "Aging parent resources — Starting the care conversation",
    description:
      "Aging parent resources for families who need to talk about help, gather the essentials, and coordinate care while protecting independence.",
    type: "article",
    changefreq: "monthly",
    priority: "0.8",
  },
  "care-from-a-distance": {
    id: "care-from-a-distance",
    path: "/coordinating-care-from-a-distance.html",
    title: "How to coordinate senior care from a distance — Famielda",
    description:
      "A long-distance caregiving guide: coverage, check-ins, and a shared record so you can help an aging parent when you are not in the same city.",
    type: "article",
    changefreq: "monthly",
    priority: "0.7",
  },
  "building-a-care-circle": {
    id: "building-a-care-circle",
    path: "/building-a-care-circle.html",
    title: "How to build a family care circle — Famielda",
    description:
      "How to build a care circle around an aging parent — roles, invites, and a weekly rhythm families can actually keep.",
    type: "article",
    changefreq: "monthly",
    priority: "0.7",
  },
  "talking-with-aging-parents": {
    id: "talking-with-aging-parents",
    path: "/talking-with-aging-parents.html",
    title: "How to talk with aging parents about accepting help",
    description:
      "A respectful guide to talking with aging parents about care, independence, and letting family share the load.",
    type: "article",
    changefreq: "monthly",
    priority: "0.7",
  },
};

export const RESOURCE_NAV = [
  { id: "senior-care", label: "Senior care resources", href: "senior-care.html" },
  { id: "family-caregiver-guide", label: "Family caregiver guide", href: "family-caregiver-guide.html" },
  { id: "caregiver-resources", label: "Caregiver resources", href: "caregiver-resources.html" },
  { id: "aging-parent", label: "Aging parent resources", href: "aging-parent.html" },
];

export function organizationNode() {
  return {
    "@type": "Organization",
    "@id": `${SITE_ORIGIN}/#organization`,
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/assets/favicon.svg"),
    },
    description: DEFAULT_DESCRIPTION,
  };
}

export function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_ORIGIN}/#website`,
    url: `${SITE_ORIGIN}/`,
    name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    inLanguage: "en-US",
    publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  };
}

export function softwareNode() {
  return {
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "HealthApplication",
    operatingSystem: "Web",
    url: `${SITE_ORIGIN}/`,
    description: DEFAULT_DESCRIPTION,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  };
}

export function mobileAppNodes() {
  const description =
    "Stay connected to your loved one's care wherever you are. Famielda is available as a mobile app for Android and iOS.";
  return [
    {
      "@type": "MobileApplication",
      name: SITE_NAME,
      applicationCategory: "HealthApplication",
      operatingSystem: "Android",
      description,
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
    {
      "@type": "MobileApplication",
      name: SITE_NAME,
      applicationCategory: "HealthApplication",
      operatingSystem: "iOS",
      description,
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
  ];
}

export function breadcrumbList(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function articleNode(page, extras = {}) {
  return {
    "@type": "Article",
    headline: page.title,
    description: page.description,
    url: absoluteUrl(page.path),
    mainEntityOfPage: absoluteUrl(page.path),
    image: ogImageUrl(),
    datePublished: extras.datePublished || "2026-09-03",
    dateModified: extras.dateModified || extras.datePublished || "2026-09-03",
    inLanguage: "en-US",
    author: { "@id": `${SITE_ORIGIN}/#organization` },
    publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  };
}

export function faqPage(questions) {
  return {
    "@type": "FAQPage",
    mainEntity: questions.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function jsonLdGraph(nodes) {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationNode(), websiteNode(), ...nodes],
  };
}

export function sitemapEntries() {
  return Object.values(PUBLIC_PAGES).sort((a, b) => Number(b.priority) - Number(a.priority));
}
