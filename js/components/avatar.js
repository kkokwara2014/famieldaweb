import { escapeHtml, initials } from "../core/dom.js";
import { imageAttrs } from "../core/images.js";

export function avatarHtml(name = "", photoURL = "", { size = "", lazy = true } = {}) {
  const classes = ["avatar"];
  if (size === "lg") classes.push("avatar--lg");
  if (size === "xl") classes.push("avatar--xl");
  if (photoURL) classes.push("avatar--photo");

  if (photoURL) {
    const dim = size === "xl" ? 96 : size === "lg" ? 64 : 40;
    return `<div class="${classes.join(" ")}"><img ${imageAttrs({
      src: photoURL,
      alt: "",
      lazy,
      width: dim,
      height: dim,
    })}></div>`;
  }

  return `<div class="${classes.join(" ")}">${escapeHtml(initials(name) || "?")}</div>`;
}
