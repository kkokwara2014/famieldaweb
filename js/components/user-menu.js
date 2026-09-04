import { escapeHtml, initials } from "../core/dom.js";
import { roleSummary } from "../config/roles.js";

export function userMenuHtml({ session }) {
  return `
    <div class="user-menu">
      <div class="avatar" aria-hidden="true">${escapeHtml(initials(session.displayName))}</div>
      <div class="user-menu__meta">
        <strong>${escapeHtml(session.displayName)}</strong>
        <span>${escapeHtml(roleSummary(session))}</span>
      </div>
    </div>
  `;
}
