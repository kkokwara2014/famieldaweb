/**
 * Injects JSON-LD for public pages. Titles, descriptions, canonicals,
 * and Open Graph tags stay in static HTML so social crawlers can read them.
 */
import { jsonLdGraph } from "../config/seo.js";

export function injectJsonLd(nodes) {
  if (document.getElementById("famielda-jsonld")) return;
  const script = document.createElement("script");
  script.id = "famielda-jsonld";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(jsonLdGraph(nodes));
  document.head.appendChild(script);
}
