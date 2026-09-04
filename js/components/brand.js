import { getBasePath } from "../core/paths.js";
import { imageAttrs } from "../core/images.js";

export function logoUrl() {
  return `${getBasePath()}/assets/images/logo.png`;
}

export function brandLockup({ href, subtitle = "Family care", inverted = false } = {}) {
  return `
    <a class="brand${inverted ? " brand--on-dark" : ""}" href="${href}" aria-label="Famielda home">
      <img class="brand__logo" ${imageAttrs({
        src: logoUrl(),
        alt: "",
        priority: true,
        lazy: false,
        width: 40,
        height: 40,
      })}>
      <span>
        <span class="brand__name">Famielda</span>
        ${subtitle ? `<span class="brand__tag">${subtitle}</span>` : ""}
      </span>
    </a>
  `;
}
