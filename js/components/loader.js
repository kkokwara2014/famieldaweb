import { escapeHtml } from "../core/dom.js";

export function spinner({ size = "" } = {}) {
  const modifier = size ? ` loader--${size}` : "";
  return `<span class="loader${modifier}" role="status" aria-label="Loading"></span>`;
}

export function loaderBlock(message = "Loading…") {
  return `
    <div class="loader-block">
      ${spinner({ size: "lg" })}
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

export function pageLoader(message = "Opening your care workspace…") {
  return `
    <div class="page-loader">
      ${spinner({ size: "lg" })}
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

export function setButtonLoading(button, loading) {
  if (!button) return;
  button.classList.toggle("is-loading", Boolean(loading));
  button.disabled = Boolean(loading);
  button.setAttribute("aria-busy", String(Boolean(loading)));
}
