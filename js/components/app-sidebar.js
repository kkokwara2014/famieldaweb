import { escapeHtml } from "../core/dom.js";
import { iconUrl } from "../config/routes.js";
import { currentHubSection, navHref, sidebarNav } from "../config/shell.js";
import { logoUrl } from "./brand.js";
import { userMenuHtml } from "./user-menu.js";
import { subscriptionIndicatorHtml } from "./subscription-indicator.js";
import { shellIcon } from "./shell-icons.js";

const SENIOR_NAV_KEY = "famielda.nav.senior";

function navIcon(item) {
  return item.icon && item.icon.endsWith(".svg")
    ? `<img src="${iconUrl(item.icon)}" alt="" width="18" height="18">`
    : shellIcon(item.icon || "admin", { size: 18 });
}

function navLink({ item, page, session, appRoot }) {
  const href = navHref(item, session, appRoot);
  const active = item.id === page;
  return `
    <li>
      <a class="app-sidebar__link${active ? " is-active" : ""}" href="${href}" ${active ? 'aria-current="page"' : ""}>
        ${navIcon(item)}
        <span>${escapeHtml(item.label)}</span>
      </a>
    </li>
  `;
}

function isGroupOpen(item, page) {
  if (page === item.id) return true;
  try {
    return sessionStorage.getItem(SENIOR_NAV_KEY) === "1";
  } catch {
    return false;
  }
}

function navGroup({ item, page, session, appRoot }) {
  const href = navHref(item, session, appRoot);
  const inGroup = page === item.id;
  const open = isGroupOpen(item, page);
  const section = currentHubSection(page);
  const groupId = `nav-group-${item.id}`;

  return `
    <li class="app-sidebar__group${open ? " is-open" : ""}${inGroup ? " is-current" : ""}" data-nav-group="${escapeHtml(item.id)}">
      <div class="app-sidebar__parent">
        <a class="app-sidebar__link${inGroup ? " is-current" : ""}" href="${href}" ${inGroup && !section ? 'aria-current="page"' : ""}>
          ${navIcon(item)}
          <span>${escapeHtml(item.label)}</span>
        </a>
        <button
          class="app-sidebar__toggle"
          type="button"
          data-nav-toggle
          aria-expanded="${open}"
          aria-controls="${groupId}"
          aria-label="${open ? "Collapse" : "Expand"} ${escapeHtml(item.label)}"
        >
          ${shellIcon("chevron", { size: 14 })}
        </button>
      </div>
      <ul class="app-sidebar__sub" id="${groupId}" ${open ? "" : "hidden"}>
        ${(item.children ?? []).map((child) => {
          const childHref = navHref(child, session, appRoot);
          const active = inGroup && section === child.id;
          return `
            <li>
              <a class="app-sidebar__link app-sidebar__link--sub${active ? " is-active" : ""}" href="${childHref}" ${active ? 'aria-current="page"' : ""}>
                <span>${escapeHtml(child.label)}</span>
              </a>
            </li>
          `;
        }).join("")}
      </ul>
    </li>
  `;
}

function navItem(options) {
  return options.item.children?.length ? navGroup(options) : navLink(options);
}

export function sidebarHtml({ page, session, plan, appRoot }) {
  const items = sidebarNav(session);
  const workspace = items.filter((item) => item.section !== "operations");
  const operations = items.filter((item) => item.section === "operations");
  const itemOptions = { page, session, appRoot };

  return `
    <div class="app-sidebar__header">
      <a class="app-sidebar__brand" href="${navHref({ id: "dashboard", href: "dashboard.html" }, session, appRoot)}">
        <img class="brand__logo" src="${logoUrl()}" alt="" width="36" height="36">
        <span>Famielda</span>
      </a>
      <button type="button" class="icon-btn app-sidebar__close" data-sidebar-close aria-label="Close navigation">
        ${shellIcon("close", { size: 16 })}
      </button>
    </div>
    <div class="app-sidebar__user">
      ${userMenuHtml({ session })}
      ${subscriptionIndicatorHtml({ plan, href: `${appRoot}/settings.html?tab=plans` })}
    </div>
    <nav class="app-sidebar__nav" aria-label="Workspace">
      <p class="app-sidebar__label">Workspace</p>
      <ul>
        ${workspace.map((item) => navItem({ ...itemOptions, item })).join("")}
      </ul>
      ${operations.length ? `
        <p class="app-sidebar__label">Operations</p>
        <ul>
          ${operations.map((item) => navItem({ ...itemOptions, item })).join("")}
        </ul>
      ` : ""}
    </nav>
    <div class="app-sidebar__footer">
      <a href="${appRoot}/help.html">Help</a>
      <a href="${appRoot}/settings.html">Settings</a>
      <button type="button" data-logout aria-haspopup="dialog">Sign out</button>
    </div>
  `;
}
