import { qs } from "../core/dom.js";
import { getBasePath } from "../core/paths.js";
import { brandLockup } from "./brand.js";
import { MARKETING_TAGLINE } from "../config/marketing.js";

export function mountPublicFooter() {
  const footer = qs("[data-public-footer]");
  if (!footer) return;

  const root = getBasePath();
  footer.innerHTML = `
    <div class="site-footer__grid site-footer__grid--marketing">
      <div>
        ${brandLockup({ href: `${root}/index.html`, inverted: true, subtitle: "Family care" })}
        <p class="site-footer__lead">${MARKETING_TAGLINE}</p>
        <p>Famielda keeps families, caregivers, and health practitioners aligned around one senior, one circle, and one week.</p>
      </div>
      <div>
        <h2 class="site-footer__heading">Product</h2>
        <ul>
          <li><a href="${root}/how-it-works.html">How it works</a></li>
          <li><a href="${root}/pricing.html">Pricing</a></li>
          <li><a href="${root}/resources.html">Resources</a></li>
          <li><a href="${root}/faq.html">FAQ</a></li>
        </ul>
      </div>
      <div>
        <h2 class="site-footer__heading">Who it’s for</h2>
        <ul>
          <li><a href="${root}/for-families.html">Families</a></li>
          <li><a href="${root}/for-caregivers.html">Caregivers</a></li>
          <li><a href="${root}/for-practitioners.html">Health practitioners</a></li>
        </ul>
      </div>
      <div>
        <h2 class="site-footer__heading">Company</h2>
        <ul>
          <li><a href="${root}/about.html">About</a></li>
          <li><a href="${root}/contact.html">Contact</a></li>
          <li><a href="${root}/login.html">Log in</a></li>
          <li><a href="${root}/register.html">Sign up</a></li>
        </ul>
      </div>
    </div>
    <div class="site-footer__copy">
      <p>© ${new Date().getFullYear()} Famielda. Care coordination for families — not a hospital, pharmacy, or diagnostic service.</p>
      <nav class="site-footer__legal" aria-label="Legal">
        <a href="${root}/privacy.html">Privacy Policy</a>
        <a href="${root}/terms.html">Terms &amp; Conditions</a>
      </nav>
    </div>
  `;
}
