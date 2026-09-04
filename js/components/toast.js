import { qs, escapeHtml } from "../core/dom.js";

const TYPES = new Set(["default", "success", "error", "warning", "info"]);

export function toast(message, options = {}) {
  const type = TYPES.has(options.type) ? options.type : "default";
  const duration = options.duration ?? 3200;

  let region = qs("[data-toast-region]");
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.dataset.toastRegion = "";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }

  const node = document.createElement("div");
  node.className = type === "default" ? "toast" : `toast toast--${type}`;
  node.setAttribute("role", "status");
  const href = options.href ? String(options.href) : "";
  const action = href
    ? ` <a class="toast__link" href="${escapeHtml(href)}">${escapeHtml(options.actionLabel || "Open")}</a>`
    : "";
  node.innerHTML = `<span class="toast__mark" aria-hidden="true"></span><span>${escapeHtml(message)}${action}</span>`;
  region.append(node);
  window.setTimeout(() => node.remove(), duration);
  return node;
}
