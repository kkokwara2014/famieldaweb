import { mountPublicNav } from "../components/navbar.js";
import { mountPublicFooter } from "../components/footer.js";
import { mountAppDownload } from "../components/app-download.js";
import { marketingPageId } from "../config/marketing.js";
import { PUBLIC_PAGES, SITE_ORIGIN, articleNode, breadcrumbList, faqPage, mobileAppNodes, softwareNode } from "../config/seo.js";
import { injectJsonLd } from "../seo/document.js";
import { initMonitoring } from "../observability/monitor.js";
import { initPerformance } from "../core/performance.js";

initMonitoring();

const page = marketingPageId(document.body.dataset.page || "home");
initPerformance();
mountPublicNav(page);
mountPublicFooter();
mountAppDownload();

function readJsonScript(id) {
  const node = document.getElementById(id);
  if (!node?.textContent?.trim()) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

function bootStructuredData() {
  if (document.querySelector("script[type='application/ld+json']")) return;
  const seoId = document.body.dataset.seoPage || page;
  const seoPage = PUBLIC_PAGES[seoId];
  if (!seoPage) return;

  const nodes = [];
  if (seoId === "home") nodes.push(softwareNode(), ...mobileAppNodes());
  if (seoPage.type === "article") {
    nodes.push(articleNode(seoPage, {
      datePublished: document.body.dataset.published,
      dateModified: document.body.dataset.modified,
    }));
  } else if (seoId !== "home") {
    nodes.push({
      "@type": seoId === "resources" ? "CollectionPage" : "WebPage",
      name: seoPage.title,
      description: seoPage.description,
      url: `${SITE_ORIGIN}${seoPage.path}`,
      isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
    });
  }

  const crumbs = readJsonScript("seo-breadcrumbs");
  const faqs = readJsonScript("seo-faqs");
  if (Array.isArray(crumbs) && crumbs.length) nodes.push(breadcrumbList(crumbs));
  if (Array.isArray(faqs) && faqs.length) nodes.push(faqPage(faqs));
  injectJsonLd(nodes);
}

try {
  bootStructuredData();
} catch {
  /* Public pages still render if structured data cannot be injected. */
}
