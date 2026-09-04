import { escapeHtml } from "../core/dom.js";

const ICON = `
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8"/>
    <path d="M12 8v5"/>
    <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none"/>
  </svg>
`;

export function errorState(options = {}) {
  const {
    title = "Something went wrong",
    body = "Famielda could not load this view. Try again in a moment.",
    actionLabel = "Go home",
    actionHref = "/",
    variant = "page",
  } = options;

  const action = actionLabel
    ? `<div class="error-state__actions"><a class="btn btn--primary" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a></div>`
    : "";

  return `
    <div class="error-state error-state--${escapeHtml(variant)}">
      <div class="error-state__icon">${ICON}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${action}
    </div>
  `;
}
