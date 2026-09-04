import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { getBasePath } from "../core/paths.js";
import { requestLogout } from "../auth/logout.js";
import { getNotificationFeed, markRead, unreadCount, watchNotificationFeed } from "../notifications/notification-center.js";
import { getCurrentPlan } from "../services/subscription-service.js";
import { pageTitle } from "../config/shell.js";
import { notificationTypeLabel, resolveNoticeHref } from "../config/notifications.js";
import { sidebarHtml } from "./app-sidebar.js";
import { topbarHtml } from "./app-topbar.js";
import { mobileNavHtml } from "./app-mobile-nav.js";

const MOBILE_MQ = "(max-width: 900px)";

let chromeBound = false;
let noticeWatch = null;
let noticeClickBound = false;

function isMobileNav() {
  return window.matchMedia(MOBILE_MQ).matches;
}

function ensureOverlay() {
  let overlay = qs("[data-sidebar-overlay]");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.className = "app-sidebar-overlay";
  overlay.dataset.sidebarOverlay = "";
  overlay.hidden = true;
  document.body.prepend(overlay);
  return overlay;
}

function ensureMobileNav() {
  let nav = qs("[data-app-mobile-nav]");
  if (nav) return nav;

  nav = document.createElement("nav");
  nav.className = "app-mobile-nav";
  nav.dataset.appMobileNav = "";
  nav.setAttribute("aria-label", "Primary");
  document.body.append(nav);
  return nav;
}

function collectSlots(layout, sidebar, topbar) {
  sidebar.id ||= "app-sidebar";
  return {
    layout,
    sidebar,
    topbar,
    overlay: ensureOverlay(),
    mobileNav: ensureMobileNav(),
  };
}

function ensureAppLayout() {
  const existing = qs("[data-app-layout], .app-layout");
  if (existing) {
    const sidebar = qs("[data-app-sidebar]", existing) || qs("[data-app-sidebar]");
    const topbar = qs("[data-app-topbar]", existing) || qs("[data-app-topbar]");
    if (sidebar && topbar) return collectSlots(existing, sidebar, topbar);
  }

  const host = qs("[data-app-shell]");
  if (!host) return null;

  const page = qs("[data-app-page], main, #main", host);
  const layout = document.createElement("div");
  layout.className = "app-layout";
  layout.dataset.appLayout = "";

  const sidebar = document.createElement("aside");
  sidebar.className = "app-sidebar";
  sidebar.dataset.appSidebar = "";
  sidebar.id = "app-sidebar";
  sidebar.setAttribute("aria-label", "Workspace");

  const content = document.createElement("div");
  content.className = "app-content";

  const topbar = document.createElement("header");
  topbar.className = "app-topbar";
  topbar.dataset.appTopbar = "";

  host.prepend(layout);
  layout.append(sidebar, content);
  content.append(topbar);
  if (page && page !== host) {
    page.classList.add("app-main");
    if (!page.id) page.id = "main";
    content.append(page);
  }

  return collectSlots(layout, sidebar, topbar);
}

function setSidebarOpen(open, slots) {
  const { sidebar, overlay } = slots;
  const mobile = isMobileNav();
  const next = mobile ? open : false;

  sidebar.classList.toggle("is-open", next);
  sidebar.setAttribute("aria-hidden", mobile ? String(!next) : "false");
  if (overlay) overlay.hidden = !next;
  document.body.classList.toggle("app-nav-open", next);

  document.querySelectorAll("[data-sidebar-open], [data-mobile-more]").forEach((button) => {
    button.setAttribute("aria-expanded", String(next));
  });

  if (next) {
    qs("[data-sidebar-close]", sidebar)?.focus();
  }
}

function bindChrome(slots) {
  if (chromeBound) return;
  chromeBound = true;

  delegate(document, "click", "[data-logout], [data-logout-menu], [data-sign-out]", (event) => {
    event.preventDefault();
    requestLogout();
  });
  delegate(document, "click", "[data-sidebar-open], [data-mobile-more]", () => {
    setSidebarOpen(true, slots);
  });
  delegate(document, "click", "[data-sidebar-close], [data-sidebar-overlay]", () => {
    setSidebarOpen(false, slots);
  });
  delegate(document, "click", "[data-nav-toggle]", (event, button) => {
    event.preventDefault();
    const group = button.closest("[data-nav-group]");
    if (!group) return;
    const open = !group.classList.contains("is-open");
    group.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
    const sub = group.querySelector(".app-sidebar__sub");
    if (sub) sub.hidden = !open;
    try {
      sessionStorage.setItem(`famielda.nav.${group.dataset.navGroup}`, open ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  });

  on(document, "keydown", (event) => {
    if (event.key === "Escape") setSidebarOpen(false, slots);
  });

  const media = window.matchMedia(MOBILE_MQ);
  const onChange = () => setSidebarOpen(false, slots);
  if (media.addEventListener) media.addEventListener("change", onChange);
  else media.addListener(onChange);
}

export async function initAppShell({ page, session, title, crumbs } = {}) {
  const slots = ensureAppLayout();
  if (!slots) return;

  const appRoot = `${getBasePath()}/app`;
  const [unread, plan, notices] = await Promise.all([
    unreadCount(),
    getCurrentPlan(),
    getNotificationFeed(session, { appRoot }),
  ]);
  const heading = pageTitle(page, title);

  document.body.classList.add("app-body", "has-app-shell");
  slots.sidebar.setAttribute("aria-label", "Workspace");

  slots.sidebar.innerHTML = sidebarHtml({ page, session, plan, appRoot });
  slots.topbar.innerHTML = topbarHtml({
    page,
    session,
    plan,
    title: heading,
    crumbs,
    notices,
    unread,
    appRoot,
  });
  slots.mobileNav.innerHTML = mobileNavHtml({ page, session, unread, appRoot });

  bindChrome(slots);
  setSidebarOpen(false, slots);
  bindNoticeChrome(slots, { session, appRoot });
}

function bindNoticeChrome(slots, { session, appRoot }) {
  if (!noticeClickBound) {
    noticeClickBound = true;
    delegate(document, "click", "[data-notice-id]", async (_event, link) => {
      const id = link.dataset.noticeId;
      if (id) {
        try {
          await markRead(id, true);
        } catch {
          // Opening the target still matters if the read flag cannot be saved.
        }
      }
    });
  }

  if (noticeWatch) {
    noticeWatch();
    noticeWatch = null;
  }
  noticeWatch = watchNotificationFeed((feed) => {
    updateNoticeChrome(feed, { appRoot, mobileNav: slots.mobileNav, session, page: slots.page });
  }, session, { appRoot });
}

function updateNoticeChrome(feed, { appRoot, mobileNav, session }) {
  const unread = feed.filter((item) => !item.read).length;
  const countLabel = unread > 9 ? "9+" : String(unread);
  const trigger = qs("[data-notice-chrome] [data-dropdown-trigger]");
  const count = qs("[data-notice-count]");
  const label = qs("[data-notice-unread-label]");
  const preview = qs("[data-notice-preview]");

  if (trigger) {
    trigger.setAttribute("aria-label", unread ? `${unread} unread notifications` : "Notifications");
  }
  if (count) {
    count.hidden = !unread;
    count.textContent = unread ? countLabel : "";
  }
  if (label) {
    label.textContent = unread ? `${unread} unread` : "You're caught up";
  }
  if (preview) {
    const items = feed.slice(0, 4);
    preview.innerHTML = items.length
      ? `
        <ul class="notice-bell__list">
          ${items.map((notice) => `
            <li>
              <a class="dropdown__item notice-bell__item${notice.read ? "" : " is-unread"}${notice.isEmergency ? " is-emergency" : ""}" role="menuitem" href="${escapeHtml(resolveNoticeHref(notice, appRoot))}" data-notice-id="${escapeHtml(notice.id || "")}">
                <span class="notice-bell__type">${escapeHtml(notice.typeLabel || notificationTypeLabel(notice.type))}</span>
                <strong>${escapeHtml(notice.title)}</strong>
                <span>${escapeHtml(notice.body)}</span>
              </a>
            </li>
          `).join("")}
        </ul>
      `
      : `<p class="notice-bell__empty">New schedule and circle alerts will appear here.</p>`;
  }

  const badge = mobileNav?.querySelector(".app-mobile-nav__badge, [data-notice-mobile-count]");
  const noticeLink = mobileNav?.querySelector('[href$="notifications.html"] .app-mobile-nav__icon');
  if (noticeLink) {
    let node = noticeLink.querySelector("[data-notice-mobile-count], .app-mobile-nav__badge");
    if (unread) {
      if (!node) {
        node = document.createElement("span");
        node.className = "app-mobile-nav__badge";
        node.dataset.noticeMobileCount = "";
        noticeLink.append(node);
      }
      node.textContent = countLabel;
    } else if (node) {
      node.remove();
    }
  }
  void session;
}
