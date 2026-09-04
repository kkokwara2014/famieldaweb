import { escapeHtml } from "../core/dom.js";
import { verificationBanner, verificationStatusBadge, verificationStatusLabel } from "../config/verification.js";
import { routes } from "../config/routes.js";
import { VERIFICATION_STATUS } from "../config/constants.js";
import { isProfessionalRole } from "../config/roles.js";

export function verificationChipHtml(status, { empty = "" } = {}) {
  if (!status) return empty;
  return `<span class="badge ${verificationStatusBadge(status)}">${escapeHtml(verificationStatusLabel(status))}</span>`;
}

export function verificationBannerHtml(status, { href = routes.verification } = {}) {
  if (!status) return "";
  const banner = verificationBanner(status);
  const tone = banner.tone === "error" ? "error" : banner.tone === "success" ? "success" : banner.tone === "info" ? "info" : "warning";
  return `
    <div class="alert alert--${tone} verify-banner" data-verification-banner>
      <div class="alert__row">
        <div>
          <strong>${escapeHtml(banner.title)}</strong>
          <p>${escapeHtml(banner.body)}</p>
        </div>
        <a class="btn btn--ghost btn--sm" href="${escapeHtml(href)}">${escapeHtml(banner.actionLabel)}</a>
      </div>
    </div>
  `;
}

export function verificationBannerForSession(session) {
  if (!isProfessionalRole(session?.role)) return "";
  return verificationBannerHtml(session.verificationStatus || VERIFICATION_STATUS.PENDING);
}
