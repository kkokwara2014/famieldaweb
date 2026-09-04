import { IMAGE } from "../config/performance.js";
import { escapeHtml } from "./dom.js";
import { compressImageFile } from "./photo.js";
import { revokeObjectUrl, trackObjectUrl } from "./listeners.js";

export { compressImageFile };

export function imageAttrs({
  src,
  alt = "",
  lazy = true,
  priority = false,
  width,
  height,
  sizes,
} = {}) {
  const parts = [`src="${escapeHtml(src)}"`, `alt="${escapeHtml(alt)}"`, 'decoding="async"'];
  if (width) parts.push(`width="${escapeHtml(String(width))}"`);
  if (height) parts.push(`height="${escapeHtml(String(height))}"`);
  if (sizes) parts.push(`sizes="${escapeHtml(sizes)}"`);
  if (priority) {
    parts.push('fetchpriority="high"');
    parts.push('loading="eager"');
    parts.push("data-eager");
  } else if (lazy) {
    parts.push('loading="lazy"');
  }
  return parts.join(" ");
}

export function enhanceDocumentImages(root = document) {
  root.querySelectorAll("img").forEach((img) => {
    if (!img.getAttribute("decoding")) img.decoding = "async";
    const eager = img.hasAttribute("data-eager") || img.getAttribute("fetchpriority") === "high";
    if (!eager && !img.getAttribute("loading")) img.loading = "lazy";
  });
}

export function objectUrlForFile(file) {
  const url = URL.createObjectURL(file);
  return trackObjectUrl(url);
}

export function releaseObjectUrl(url) {
  revokeObjectUrl(url);
}

export function compressAvatarFile(file) {
  return compressImageFile(file, { maxSize: IMAGE.AVATAR_MAX, quality: IMAGE.PHOTO_QUALITY });
}
