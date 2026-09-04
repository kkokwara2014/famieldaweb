import { escapeHtml } from "../core/dom.js";

const ICON = `
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4" y="5" width="16" height="14" rx="2"/>
    <path d="M8 10h8M8 14h5"/>
  </svg>
`;

export function emptyState(titleOrOptions = {}, body) {
  const options = typeof titleOrOptions === "string"
    ? { title: titleOrOptions, body }
    : titleOrOptions;

  const {
    title = "Nothing here yet",
    body: description = "When there is something to show, it will appear in this space.",
    actionLabel,
    actionHref,
    compact = false,
  } = options;

  const action = actionLabel && actionHref
    ? `<div class="empty-state__actions"><a class="btn btn--primary btn--sm" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a></div>`
    : "";

  return `
    <div class="empty-state${compact ? " empty-state--compact" : ""}">
      <div class="empty-state__icon">${ICON}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${action}
    </div>
  `;
}
