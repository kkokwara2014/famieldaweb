import { escapeHtml } from "../core/dom.js";
import { formatPlanPrice } from "../services/subscription-service.js";

export function planTone(planId) {
  if (planId === "plus" || planId === "family") return "plan-chip--plus";
  if (planId === "circle") return "plan-chip--plus";
  return "plan-chip--free";
}

export function subscriptionIndicatorHtml({ plan, href, compact = false }) {
  const name = plan?.name ?? "Free";
  const price = formatPlanPrice(plan, { compact: true });
  const label = compact ? name : `${name} plan`;

  return `
    <a class="plan-chip ${planTone(plan?.id)}" href="${href}" aria-label="${escapeHtml(`Current plan: ${name}${price ? `, ${price}` : ""}`)}">
      <span class="plan-chip__dot" aria-hidden="true"></span>
      <span class="plan-chip__label">${escapeHtml(label)}</span>
    </a>
  `;
}
