import { escapeHtml } from "../core/dom.js";
import { breadcrumbItems } from "../config/shell.js";
import { shellIcon } from "./shell-icons.js";

export function breadcrumbsHtml(options) {
  const items = breadcrumbItems(options);
  if (!items.length) return "";

  return `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol class="breadcrumbs__list">
        ${items.map((item, index) => {
          const last = index === items.length - 1;
          const inner = item.href && !last
            ? `<a href="${item.href}">${escapeHtml(item.label)}</a>`
            : `<span>${escapeHtml(item.label)}</span>`;
          return `
            <li class="breadcrumbs__item${last ? " is-current" : ""}" ${last ? 'aria-current="page"' : ""}>
              ${index ? `<span class="breadcrumbs__sep" aria-hidden="true">${shellIcon("chevron", { size: 14 })}</span>` : ""}
              ${inner}
            </li>
          `;
        }).join("")}
      </ol>
    </nav>
  `;
}
