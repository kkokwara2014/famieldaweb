import { SUBSCRIPTION_PLANS } from "../config/constants.js";
import { FREE_FEATURES, PLUS_FEATURES } from "../config/entitlements.js";
import {
  CHECKOUT_RETURN,
  PLUS_ANNUAL_PRICE_ID,
  PORTAL_FLOWS,
  PORTAL_RETURN,
  formatBillingDate,
  formatInvoiceAmount,
  isActiveSubscriptionStatus,
  paymentMethodLabel,
} from "../config/subscription.js";
import { getSession, refreshSession, setSession } from "../auth/session.js";
import { updateMockUser } from "../auth/auth-service.js";
import { createUser } from "../models/user.js";
import { usesLiveAuth } from "../core/firebase.js";
import { callCloudFunction } from "../core/functions.js";
import {
  catalogPlanId,
  circleUsage,
  entitlementsFor,
  isPlusPlan,
  planIdOf,
} from "./entitlement-service.js";
import { PRODUCT_EVENTS, trackProductEvent } from "./analytics-service.js";

export const BILLING_INTERVALS = {
  MONTH: "month",
  YEAR: "year",
};

export const PLAN_CATALOG = [
  {
    id: SUBSCRIPTION_PLANS.FREE,
    catalogId: "free",
    interval: null,
    name: "Free",
    heading: "Free",
    price: "$0",
    period: "forever",
    summary: "One senior, two family members, and basic care coordination.",
    features: FREE_FEATURES,
  },
  {
    id: SUBSCRIPTION_PLANS.PLUS,
    catalogId: "plus-monthly",
    interval: BILLING_INTERVALS.MONTH,
    name: "Plus",
    heading: "Plus Monthly",
    price: "$9.99",
    period: "/ month",
    summary: "The full care circle, billed each month. Cancel anytime; Plus stays on through the period.",
    features: PLUS_FEATURES,
  },
  {
    id: SUBSCRIPTION_PLANS.PLUS,
    catalogId: "plus-yearly",
    interval: BILLING_INTERVALS.YEAR,
    name: "Plus",
    heading: "Plus Yearly",
    price: "$99.99",
    period: "/ year",
    featured: true,
    summary: "Save two months versus monthly. Same Plus circle, billed once a year.",
    features: PLUS_FEATURES,
  },
];

export function checkoutIntervalOf(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === BILLING_INTERVALS.YEAR || raw === "yearly" || raw === "annual" || raw === "annually") {
    return BILLING_INTERVALS.YEAR;
  }
  return BILLING_INTERVALS.MONTH;
}

export function formatPlanPrice(plan, { compact = false } = {}) {
  if (!plan?.price) return "";
  if (plan.interval === BILLING_INTERVALS.YEAR) {
    return compact ? `${plan.price}/yr` : `${plan.price} / year`;
  }
  if (plan.interval === BILLING_INTERVALS.MONTH) {
    return compact ? `${plan.price}/mo` : `${plan.price} / month`;
  }
  if (plan.period && plan.period.startsWith("/")) {
    return compact ? `${plan.price}${plan.period.replace(" / ", "/")}` : `${plan.price} ${plan.period}`;
  }
  if (plan.period) return `${plan.price} ${plan.period}`;
  return plan.price;
}

function billingIntervalOf(session, snapshot = null) {
  const raw = String(snapshot?.interval || session?.subscriptionInterval || "").trim().toLowerCase();
  if (raw === BILLING_INTERVALS.YEAR) return BILLING_INTERVALS.YEAR;
  if ((snapshot?.stripePriceId || session?.stripePriceId) === PLUS_ANNUAL_PRICE_ID) {
    return BILLING_INTERVALS.YEAR;
  }
  if (isPlusPlan(snapshot?.plan || session?.plan)) return BILLING_INTERVALS.MONTH;
  return null;
}

function catalogItemFor(planId, interval = null) {
  const id = catalogPlanId(planId);
  if (!isPlusPlan(id)) {
    return PLAN_CATALOG.find((item) => item.id === id) ?? PLAN_CATALOG[0];
  }
  const billingInterval = interval === BILLING_INTERVALS.YEAR
    ? BILLING_INTERVALS.YEAR
    : BILLING_INTERVALS.MONTH;
  return PLAN_CATALOG.find((item) => item.id === SUBSCRIPTION_PLANS.PLUS && item.interval === billingInterval)
    || PLAN_CATALOG.find((item) => item.id === SUBSCRIPTION_PLANS.PLUS)
    || PLAN_CATALOG[0];
}

export {
  PORTAL_FLOWS,
  formatBillingDate,
  formatInvoiceAmount,
  isPlusPlan,
  entitlementsFor,
  circleUsage,
  paymentMethodLabel,
};

function mockPeriodEnd(session, interval = BILLING_INTERVALS.MONTH) {
  if (session?.subscriptionPeriodEnd) return session.subscriptionPeriodEnd;
  return mockPeriodEndFor(interval);
}

function mockPeriodEndFor(interval = BILLING_INTERVALS.MONTH) {
  const date = new Date();
  if (interval === BILLING_INTERVALS.YEAR) date.setFullYear(date.getFullYear() + 1);
  else date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

function mockInvoice(periodEnd, interval = BILLING_INTERVALS.MONTH) {
  const created = new Date();
  if (interval === BILLING_INTERVALS.YEAR) created.setFullYear(created.getFullYear() - 1);
  else created.setMonth(created.getMonth() - 1);
  return {
    id: interval === BILLING_INTERVALS.YEAR ? "in_mock_plus_yearly" : "in_mock_plus",
    number: interval === BILLING_INTERVALS.YEAR ? "MOCK-0001-Y" : "MOCK-0001",
    status: "paid",
    amountPaid: interval === BILLING_INTERVALS.YEAR ? 9999 : 999,
    amountDue: 0,
    currency: "USD",
    createdAt: created.toISOString(),
    periodEnd: periodEnd || mockPeriodEndFor(interval),
    hostedInvoiceUrl: "",
    invoicePdf: "",
  };
}

function emptySnapshot(session = getSession()) {
  const id = catalogPlanId(planIdOf(session));
  const plus = isPlusPlan(id);
  const interval = billingIntervalOf(session);
  const referralTrial = Boolean(session?.referralGrant?.active);
  const periodEnd = plus ? (session?.referralGrant?.expiresAt || mockPeriodEnd(session, interval)) : null;
  return {
    plan: id,
    status: session?.subscriptionStatus || (referralTrial ? "trialing" : (plus ? "active" : "none")),
    periodEnd,
    cancelAtPeriodEnd: Boolean(session?.subscriptionCancelAtPeriodEnd),
    stripeCustomerId: session?.stripeCustomerId || null,
    hasStripeCustomer: Boolean(session?.stripeCustomerId) || (plus && !usesLiveAuth() && !referralTrial),
    paymentMethod: plus && !usesLiveAuth() && !referralTrial ? { brand: "visa", last4: "4242" } : null,
    invoices: plus && !usesLiveAuth() && !referralTrial ? [mockInvoice(periodEnd, interval)] : [],
    interval,
    stripePriceId: session?.stripePriceId || null,
    mock: !usesLiveAuth(),
  };
}

function withBilling(plan, session, snapshot = null) {
  const plus = isPlusPlan(plan.id);
  const periodEnd = snapshot?.periodEnd
    || session?.subscriptionPeriodEnd
    || (plus && !usesLiveAuth() ? mockPeriodEnd(session) : null);
  return {
    ...plan,
    status: snapshot?.status || session?.subscriptionStatus || (plus ? "active" : "none"),
    periodEnd,
    cancelAtPeriodEnd: snapshot
      ? Boolean(snapshot.cancelAtPeriodEnd)
      : Boolean(session?.subscriptionCancelAtPeriodEnd),
    stripeCustomerId: snapshot?.stripeCustomerId || session?.stripeCustomerId || null,
    hasStripeCustomer: snapshot
      ? Boolean(snapshot.hasStripeCustomer)
      : Boolean(session?.stripeCustomerId) || (plus && !usesLiveAuth()),
    paymentMethod: snapshot?.paymentMethod || null,
    invoices: snapshot?.invoices || [],
    interval: snapshot?.interval || session?.subscriptionInterval || plan.interval || null,
  };
}

export async function getCurrentPlan(session = getSession(), snapshot = null) {
  const id = catalogPlanId(planIdOf(session));
  const interval = billingIntervalOf(session, snapshot);
  const plan = catalogItemFor(id, interval);
  const billing = withBilling(plan, session, snapshot);
  if (session?.referralGrant?.active && !snapshot?.status) {
    return {
      ...billing,
      status: session.subscriptionStatus || "trialing",
      periodEnd: session.referralGrant.expiresAt || billing.periodEnd,
      interval: billing.interval || interval,
    };
  }
  return {
    ...billing,
    interval: billing.interval || interval,
  };
}

export function getCirclePlanLimits(planId) {
  const limits = entitlementsFor(planId ?? getSession()?.plan);
  return {
    maxMembers: limits.maxFamilyMembers,
    maxFamilyMembers: limits.maxFamilyMembers,
    maxCaregivers: limits.maxCaregivers,
    maxPractitioners: limits.maxPractitioners,
    allowedKinds: limits.professionalCircle
      ? ["family", "caregiver", "practitioner"]
      : ["family"],
  };
}

function checkoutOrigin() {
  return window.location.origin;
}

function applyMockUser(session, patch) {
  const next = createUser({
    ...session,
    ...patch,
  });
  updateMockUser(next);
  return setSession(next);
}

function applyMockPlus(session, interval = BILLING_INTERVALS.MONTH) {
  const billingInterval = checkoutIntervalOf(interval);
  return applyMockUser(session, {
    plan: SUBSCRIPTION_PLANS.PLUS,
    subscriptionStatus: "active",
    subscriptionPeriodEnd: mockPeriodEndFor(billingInterval),
    subscriptionCancelAtPeriodEnd: false,
    subscriptionInterval: billingInterval,
  });
}

export async function startPlusCheckout(session = getSession(), options = {}) {
  if (!session?.id) {
    throw new Error("Sign in to upgrade to Famielda Plus.");
  }

  const interval = checkoutIntervalOf(options.interval);
  if (isPlusPlan(session.plan) && isActiveSubscriptionStatus(session.subscriptionStatus || "active") && !session.subscriptionCancelAtPeriodEnd) {
    throw new Error("Famielda Plus is already active.");
  }

  if (!usesLiveAuth()) {
    const upgraded = applyMockPlus(session, interval);
    trackProductEvent(PRODUCT_EVENTS.PLUS_UPGRADE, {
      dedupeKey: `plus_upgrade:${upgraded.id}:mock:${interval}`,
      planFrom: catalogPlanId(session.plan),
      planTo: SUBSCRIPTION_PLANS.PLUS,
      interval,
    }, upgraded);
    return { mock: true, url: null, interval };
  }

  const result = await callCloudFunction("createPlusCheckout", {
    origin: checkoutOrigin(),
    interval,
  }, { fallback: "Stripe Checkout could not start. Please try again." });
  if (!result?.url) {
    throw new Error("Stripe Checkout did not return a URL.");
  }
  return result;
}

export async function openBillingPortal(session = getSession(), flow = PORTAL_FLOWS.OVERVIEW) {
  if (!session?.id) {
    throw new Error("Sign in to manage billing.");
  }

  const allowed = new Set(Object.values(PORTAL_FLOWS));
  const nextFlow = allowed.has(flow) ? flow : PORTAL_FLOWS.OVERVIEW;

  if (!usesLiveAuth()) {
    if (nextFlow === PORTAL_FLOWS.CANCEL) {
      if (!isPlusPlan(session.plan)) {
        throw new Error("There is no Famielda Plus subscription to cancel.");
      }
      const cancelled = applyMockUser(session, {
        subscriptionCancelAtPeriodEnd: true,
        subscriptionStatus: session.subscriptionStatus || "active",
        subscriptionPeriodEnd: mockPeriodEnd(session),
      });
      trackProductEvent(PRODUCT_EVENTS.SUBSCRIPTION_CANCELLED, {
        dedupeKey: `subscription_cancelled:${cancelled.id}:mock`,
        planFrom: catalogPlanId(session.plan),
        status: cancelled.subscriptionStatus,
        cancelAtPeriodEnd: true,
      }, cancelled);
      return { mock: true, url: null, flow: nextFlow };
    }
    if (nextFlow === PORTAL_FLOWS.INVOICES) {
      return { mock: true, url: null, flow: nextFlow };
    }
    throw new Error("The Stripe customer portal is available when Firebase and Cloud Functions are connected.");
  }

  const result = await callCloudFunction("createBillingPortal", {
    origin: checkoutOrigin(),
    flow: nextFlow,
  }, { fallback: "The Stripe billing portal could not be opened. Please try again." });
  if (!result?.url) {
    throw new Error("Stripe billing portal did not return a URL.");
  }
  return result;
}

export async function resumePlusSubscription(session = getSession()) {
  if (!session?.id) {
    throw new Error("Sign in to resume Famielda Plus.");
  }
  if (!isPlusPlan(session.plan)) {
    throw new Error("There is no Famielda Plus subscription to resume.");
  }
  if (!session.subscriptionCancelAtPeriodEnd) {
    throw new Error("Famielda Plus is already set to renew.");
  }

  if (!usesLiveAuth()) {
    applyMockUser(session, {
      subscriptionCancelAtPeriodEnd: false,
      subscriptionStatus: "active",
      subscriptionPeriodEnd: mockPeriodEnd(session),
    });
    return { mock: true, ok: true, cancelAtPeriodEnd: false };
  }

  const result = await callCloudFunction("resumePlusSubscription", {});
  await refreshSession();
  return result;
}

export async function loadBillingSnapshot(session = getSession()) {
  if (!usesLiveAuth()) {
    return emptySnapshot(session);
  }
  if (!session?.id) {
    return emptySnapshot(session);
  }
  const result = await callCloudFunction("getBillingSnapshot", {});
  await refreshSession();
  return result || emptySnapshot(getSession() || session);
}

export async function finalizePlusCheckout(sessionId, session = getSession()) {
  if (!usesLiveAuth() || !session?.id) {
    return { ok: false, mock: !usesLiveAuth() };
  }
  const id = String(sessionId || "").trim();
  if (!id.startsWith("cs_")) {
    return { ok: false };
  }
  return callCloudFunction("finalizePlusCheckout", { sessionId: id });
}

function stripQueryParams(keys) {
  const params = new URLSearchParams(window.location.search);
  let changed = false;
  keys.forEach((key) => {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  });
  if (!changed) return params;
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);
  return params;
}

export async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get("checkout");
  if (!checkout) return { handled: false };

  const sessionId = params.get("session_id") || "";
  stripQueryParams(["checkout", "session_id"]);

  if (checkout === CHECKOUT_RETURN.CANCEL) {
    return { handled: true, status: "cancel" };
  }

  if (checkout === CHECKOUT_RETURN.SUCCESS) {
    await finalizePlusCheckout(sessionId).catch(() => ({ ok: false }));
    let session = await refreshSession();
    for (let attempt = 0; attempt < 4 && session && !isPlusPlan(session.plan); attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      session = await refreshSession();
    }
    return {
      handled: true,
      status: "success",
      activated: isPlusPlan(session?.plan),
    };
  }

  return { handled: true, status: checkout };
}

export async function handlePortalReturn() {
  const params = new URLSearchParams(window.location.search);
  const portal = params.get("portal");
  if (!portal) return { handled: false };

  stripQueryParams(["portal"]);
  if (portal !== PORTAL_RETURN) {
    return { handled: true, status: portal };
  }

  await loadBillingSnapshot().catch(() => null);
  await refreshSession();
  return { handled: true, status: PORTAL_RETURN };
}
