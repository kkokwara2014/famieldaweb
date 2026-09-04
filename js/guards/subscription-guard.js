import { SUBSCRIPTION_PLANS } from "../config/constants.js";
import { catalogPlanId, isPlusPlan } from "../config/entitlements.js";
import { logger } from "../core/logger.js";

const PLAN_RANK = {
  [SUBSCRIPTION_PLANS.FREE]: 0,
  [SUBSCRIPTION_PLANS.PLUS]: 1,
  [SUBSCRIPTION_PLANS.FAMILY]: 1,
  [SUBSCRIPTION_PLANS.CIRCLE]: 1,
};

export function requirePlan(session, plan) {
  const current = PLAN_RANK[catalogPlanId(session.plan)] ?? 0;
  const needed = PLAN_RANK[catalogPlanId(plan)] ?? (isPlusPlan(plan) ? 1 : 0);
  if (current < needed) {
    logger.warn("Plan gate would block this feature in production.", { plan, current: session.plan });
  }
  return session;
}
