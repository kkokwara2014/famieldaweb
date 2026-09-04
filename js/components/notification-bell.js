import { escapeHtml } from "../core/dom.js";
import { notificationTypeLabel, resolveNoticeHref } from "../config/notifications.js";
import { shellIcon } from "./shell-icons.js";

export function notificationBellHtml({ notices = [], unread = 0, href, appRoot = "" }) {
  const preview = notices.slice(0, 4);
  const countLabel = unread > 9 ? "9+" : String(unread);
  const inbox = href || `${appRoot}/notifications.html`;

  return `
    <div class="dropdown notice-bell" data-dropdown data-notice-chrome>
      <button class="icon-btn dropdown__trigger notice-bell__trigger" type="button" data-dropdown-trigger aria-label="${unread ? `${unread} unread notifications` : "Notifications"}">
        ${shellIcon("bell", { size: 18 })}
        ${unread ? `<span class="notice-bell__count" data-notice-count aria-hidden="true">${escapeHtml(countLabel)}</span>` : `<span class="notice-bell__count" data-notice-count hidden aria-hidden="true"></span>`}
      </button>
      <div class="dropdown__menu dropdown__menu--end dropdown__menu--panel notice-bell__panel" data-dropdown-menu role="menu">
        <div class="notice-bell__head">
          <strong>Notifications</strong>
          <span data-notice-unread-label>${unread ? `${unread} unread` : "You're caught up"}</span>
        </div>
        <div data-notice-preview>
        ${preview.length ? `
          <ul class="notice-bell__list">
            ${preview.map((notice) => `
              <li>
                <a class="dropdown__item notice-bell__item${notice.read ? "" : " is-unread"}${notice.isEmergency ? " is-emergency" : ""}" role="menuitem" href="${escapeHtml(resolveNoticeHref(notice, appRoot))}" data-notice-id="${escapeHtml(notice.id || "")}">
                  <span class="notice-bell__type">${escapeHtml(notice.typeLabel || notificationTypeLabel(notice.type))}</span>
                  <strong>${escapeHtml(notice.title)}</strong>
                  <span>${escapeHtml(notice.body)}</span>
                </a>
              </li>
            `).join("")}
          </ul>
        ` : `<p class="notice-bell__empty">New schedule and circle alerts will appear here.</p>`}
        </div>
        <a class="dropdown__item notice-bell__all" role="menuitem" href="${inbox}">View all notifications</a>
      </div>
    </div>
  `;
}
