import { escapeHtml, initials } from "../core/dom.js";
import { roleSummary } from "../config/roles.js";
import { ROLES } from "../config/constants.js";
import { routes } from "../config/routes.js";
import { shellIcon } from "./shell-icons.js";

export function profileMenuHtml({ session, appRoot }) {
  const firstName = session.displayName.split(" ")[0] || "Account";

  return `
    <div class="dropdown profile-menu" data-dropdown>
      <button class="profile-menu__trigger dropdown__trigger" type="button" data-dropdown-trigger aria-label="Profile menu">
        <span class="avatar avatar--sm" aria-hidden="true">${escapeHtml(initials(session.displayName))}</span>
        <span class="profile-menu__name">${escapeHtml(firstName)}</span>
        ${shellIcon("chevron", { size: 16 })}
      </button>
      <div class="dropdown__menu dropdown__menu--end dropdown__menu--panel profile-menu__panel" data-dropdown-menu role="menu">
        <div class="profile-menu__head">
          <div class="avatar" aria-hidden="true">${escapeHtml(initials(session.displayName))}</div>
          <div>
            <strong>${escapeHtml(session.displayName)}</strong>
            <span>${escapeHtml(session.email)}</span>
            <span class="badge badge--brand">${escapeHtml(roleSummary(session))}</span>
          </div>
        </div>
        <div class="dropdown__sep" role="separator"></div>
        <a class="dropdown__item" role="menuitem" href="${appRoot}/settings.html">Account settings</a>
        <a class="dropdown__item" role="menuitem" href="${appRoot}/help.html">Help &amp; Support</a>
        ${session.role === ROLES.ADMIN ? `<a class="dropdown__item" role="menuitem" href="${routes.admin}">Admin console</a>` : ""}
        <div class="dropdown__sep" role="separator"></div>
        <button class="dropdown__item dropdown__item--danger" type="button" role="menuitem" data-logout-menu aria-haspopup="dialog">Sign out</button>
      </div>
    </div>
  `;
}
