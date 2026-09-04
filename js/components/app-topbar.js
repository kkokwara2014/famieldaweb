import { escapeHtml } from "../core/dom.js";
import { breadcrumbsHtml } from "./breadcrumbs.js";
import { notificationBellHtml } from "./notification-bell.js";
import { profileMenuHtml } from "./profile-menu.js";
import { subscriptionIndicatorHtml } from "./subscription-indicator.js";
import { shellIcon } from "./shell-icons.js";

export function topbarHtml({
  page,
  session,
  plan,
  title,
  crumbs,
  notices,
  unread,
  appRoot,
}) {
  return `
    <button class="icon-btn app-topbar__menu" type="button" data-sidebar-open aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded="false">
      ${shellIcon("menu", { size: 18 })}
    </button>
    <div class="app-topbar__title">
      ${breadcrumbsHtml({ page, session, crumbs, appRoot })}
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="app-topbar__actions">
      ${subscriptionIndicatorHtml({ plan, href: `${appRoot}/settings.html?tab=plans`, compact: true })}
      ${notificationBellHtml({ notices, unread, href: `${appRoot}/notifications.html`, appRoot })}
      ${profileMenuHtml({ session, appRoot })}
    </div>
  `;
}
