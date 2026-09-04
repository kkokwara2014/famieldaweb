import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { delegate } from "../core/events.js";
import { getBasePath } from "../core/paths.js";
import { pagerHtml } from "../core/pagination.js";
import { PAGE_SIZE } from "../config/performance.js";
import { getSession } from "../auth/session.js";
import { NOTIFICATION_PRIORITY } from "../config/constants.js";
import { getNotificationFeed, markAllRead, markRead, watchNotificationFeed } from "../notifications/notification-center.js";
import { resolveNoticeHref } from "../config/notifications.js";
import { emptyState } from "../components/empty-state.js";
import { toast } from "../components/toast.js";

const session = await bootApp({ page: "notifications" });
const appRoot = `${getBasePath()}/app`;
let notices = await getNotificationFeed(session, { appRoot });
let filter = new URLSearchParams(window.location.search).get("filter") || "all";

const card = qs("[data-notice-card]");
const tabs = qs("[data-notice-tabs]");

if (tabs && ["all", "unread", "alerts"].includes(filter)) {
  tabs.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

qs("[data-notice-tabs]")?.addEventListener("tabchange", (event) => {
  filter = event.detail.id;
  render();
});

qs("[data-mark-all-read]")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const count = await markAllRead(session);
    notices = await getNotificationFeed(session, { appRoot });
    render();
    toast(count ? "All notifications marked as read." : "You are already caught up.", { type: "success" });
  } catch (error) {
    toast(error.message || "Could not update notifications.", { type: "error" });
  } finally {
    button.disabled = false;
  }
});

delegate(card, "click", "[data-notice-open]", async (_event, link) => {
  const id = link.dataset.noticeId;
  if (id) {
    try {
      await markRead(id, true);
    } catch {
      // Navigation still happens via href.
    }
  }
});

watchNotificationFeed((feed) => {
  notices = feed;
  render();
}, session, { appRoot });

render();

function visibleNotices() {
  if (filter === "unread") return notices.filter((item) => !item.read);
  if (filter === "alerts") {
    return notices.filter((item) => item.isEmergency || item.priority === NOTIFICATION_PRIORITY.EMERGENCY || item.priority === NOTIFICATION_PRIORITY.HIGH);
  }
  return notices;
}

function render() {
  const items = visibleNotices();
  const unread = notices.filter((item) => !item.read).length;
  const markAll = qs("[data-mark-all-read]");
  const count = qs("[data-notice-unread]");
  if (count) count.textContent = unread ? `${unread} unread` : "Caught up";
  if (markAll) markAll.disabled = !unread;

  if (!items.length) {
    card.innerHTML = emptyState({
      title: filter === "unread" ? "You are caught up" : filter === "alerts" ? "No alerts right now" : "No notifications yet",
      body: filter === "unread"
        ? "New schedule, invitation, and care alerts will appear here."
        : filter === "alerts"
          ? "Urgent care and high-priority household notices will land in this list."
          : "When the circle, schedule, or care plan changes, the feed will fill in.",
      compact: true,
    });
    return;
  }

  card.innerHTML = `
    <ul class="list notice-list">
      ${items.map((notice) => `
        <li class="list__item notice${notice.read ? "" : " is-unread"}${notice.isEmergency ? " is-emergency" : ""}">
          <a class="notice__link" href="${escapeHtml(resolveNoticeHref(notice, appRoot))}" data-notice-open data-notice-id="${escapeHtml(notice.id || "")}">
            <div>
              <div class="notice__type">${escapeHtml(notice.typeLabel || notice.type)}${notice.when ? ` · ${escapeHtml(notice.when)}` : ""}</div>
              <strong>${escapeHtml(notice.title)}</strong>
              <p class="person__meta">${escapeHtml(notice.body)}</p>
            </div>
            <span class="badge ${notice.isEmergency ? "badge--danger" : notice.read ? "badge--neutral" : "badge--accent"}">${notice.isEmergency ? "Alert" : notice.read ? "Read" : "New"}</span>
          </a>
        </li>
      `).join("")}
    </ul>
    ${pagerHtml({ hasMore: false, loaded: items.length, limit: PAGE_SIZE })}
  `;
}
