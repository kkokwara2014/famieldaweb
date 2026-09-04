import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { getBasePath } from "../core/paths.js";
import { homeFor } from "../config/routes.js";
import { MARKETING_MORE, MARKETING_PRIMARY, isMarketingMorePage, marketingPageId } from "../config/marketing.js";
import { getSession } from "../auth/session.js";
import { brandLockup } from "./brand.js";
import { initUiSystem } from "./ui-system.js";

function linkItem(root, link, active) {
  const current = active === link.id ? ' aria-current="page"' : "";
  return `<li><a href="${root}/${link.href}"${current}>${link.label}</a></li>`;
}

export function mountPublicNav(active = "home") {
  const header = qs("[data-public-header]");
  if (!header) return;
  const root = getBasePath();
  const page = marketingPageId(active);
  const session = getSession();
  const moreOpen = isMarketingMorePage(page);

  const actions = session
    ? `<a class="btn btn--primary btn--sm" href="${homeFor(session)}">Open workspace</a>`
    : `
        <a class="btn btn--ghost btn--sm" href="${root}/login.html"${page === "login" ? ' aria-current="page"' : ""}>Log in</a>
        <a class="btn btn--primary btn--sm" href="${root}/register.html"${page === "register" ? ' aria-current="page"' : ""}>Sign up</a>
      `;

  header.innerHTML = `
    <div class="site-header__inner">
      ${brandLockup({ href: `${root}/index.html` })}
      <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav">
        <span></span><span></span><span></span>
        <span class="visually-hidden">Menu</span>
      </button>
      <nav class="site-nav" id="site-nav" data-site-nav>
        <ul class="site-nav__links">
          ${MARKETING_PRIMARY.map((link) => linkItem(root, link, page)).join("")}
          <li class="site-nav__more dropdown" data-dropdown>
            <button class="site-nav__more-btn" type="button" data-dropdown-trigger aria-expanded="false"${moreOpen ? ' aria-current="true"' : ""}>More</button>
            <div class="dropdown__menu site-nav__menu" data-dropdown-menu hidden>
              ${MARKETING_MORE.map((link) => `
                <a class="dropdown__item" href="${root}/${link.href}"${page === link.id ? ' aria-current="page"' : ""}>${link.label}</a>
              `).join("")}
            </div>
          </li>
          ${MARKETING_MORE.map((link) => {
            const current = page === link.id ? ' aria-current="page"' : "";
            return `<li class="site-nav__extra"><a href="${root}/${link.href}"${current}>${link.label}</a></li>`;
          }).join("")}
        </ul>
        <div class="site-nav__actions">
          ${actions}
        </div>
      </nav>
    </div>
  `;

  const toggle = qs("[data-nav-toggle]", header);
  const nav = qs("[data-site-nav]", header);
  on(toggle, "click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  initUiSystem(header);
}
