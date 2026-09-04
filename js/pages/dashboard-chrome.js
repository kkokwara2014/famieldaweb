import {
  applyDashboardLayout,
  dashboardLayoutFor,
  onboardingSummary,
} from "../config/onboarding.js";
import { escapeHtml, qs } from "../core/dom.js";

export function paintDashboardChrome(session, { seniorName, root = document } = {}) {
  const layout = dashboardLayoutFor(session);
  const name = seniorName || "your senior";
  applyDashboardLayout(root, layout);

  const lead = qs("[data-welcome-lead]", root);
  if (lead) lead.textContent = layout.lead(name);

  const primary = qs("[data-welcome-primary]", root);
  if (primary && layout.primaryHref) {
    primary.setAttribute("href", layout.primaryHref);
    primary.textContent = layout.primaryLabel;
  }

  const secondary = qs("[data-welcome-secondary]", root);
  if (secondary && layout.secondaryHref) {
    secondary.setAttribute("href", layout.secondaryHref);
    if (layout.secondaryLabel) secondary.textContent = layout.secondaryLabel;
  }

  const notesTitle = qs("[data-notes-title]", root);
  if (notesTitle && layout.notesTitle) notesTitle.textContent = layout.notesTitle;

  const focus = qs("[data-onboarding-focus]", root);
  if (focus) {
    const items = layout.focus?.length ? layout.focus : [];
    const summary = onboardingSummary(session);
    if (!items.length && !summary) {
      focus.hidden = true;
      focus.innerHTML = "";
    } else {
      focus.hidden = false;
      const chips = (items.length ? items : [summary]).map((item) => (
        `<span class="badge badge--neutral">${escapeHtml(item)}</span>`
      ));
      focus.innerHTML = chips.join("");
    }
  }

  return layout;
}
