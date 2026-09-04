import { getBasePath } from "../core/paths.js";
import { notificationTypeLabel } from "../config/notifications.js";

export function deepLinkParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  return {
    visit: params.get("visit") || "",
    task: params.get("task") || "",
    appointment: params.get("appointment") || "",
    medication: params.get("medication") || "",
    invite: params.get("invite") || "",
    thread: params.get("thread") || "",
  };
}

export function focusDeepLink(root = document) {
  const params = deepLinkParams();
  const map = [
    ["visit", "data-visit-id"],
    ["task", "data-task-id"],
    ["appointment", "data-appointment-id"],
    ["medication", "data-medication-id"],
    ["invite", "data-invite-id"],
  ];
  for (const [key, attr] of map) {
    const id = params[key];
    if (!id) continue;
    const node = root.querySelector(`[${attr}="${CSS.escape(id)}"]`)
      || (key === "invite" ? root.querySelector(`[data-invite-token="${CSS.escape(id)}"]`) : null);
    if (!node) continue;
    node.classList.add("is-deep-target");
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    return node;
  }
  return null;
}

export function noticeInboxHref() {
  return `${getBasePath()}/app/notifications.html`;
}

export { notificationTypeLabel };
