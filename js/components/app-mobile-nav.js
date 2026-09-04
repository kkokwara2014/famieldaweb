import { escapeHtml } from "../core/dom.js";
import { iconUrl } from "../config/routes.js";
import { mobileNav, navHref } from "../config/shell.js";
import { shellIcon } from "./shell-icons.js";

export function mobileNavHtml({ page, session, unread, appRoot }) {
  const items = mobileNav(session);

  return `
    ${items.map((item) => {
      const href = navHref(item, session, appRoot);
      const active = item.id === page;
      const badge = item.id === "notifications" && unread
        ? `<span class="app-mobile-nav__badge" data-notice-mobile-count>${unread > 9 ? "9+" : unread}</span>`
        : "";
      return `
        <a class="app-mobile-nav__link${active ? " is-active" : ""}" href="${href}" ${active ? 'aria-current="page"' : ""}>
          <span class="app-mobile-nav__icon">
            <img src="${iconUrl(item.icon)}" alt="" width="20" height="20">
            ${badge}
          </span>
          <span>${escapeHtml(item.label)}</span>
        </a>
      `;
    }).join("")}
    <button class="app-mobile-nav__link" type="button" data-mobile-more aria-label="Open more navigation" aria-controls="app-sidebar" aria-expanded="false">
      <span class="app-mobile-nav__icon">${shellIcon("more", { size: 20 })}</span>
      <span>More</span>
    </button>
  `;
}
