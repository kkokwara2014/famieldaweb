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
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { callCloudFunction } from "../core/functions.js";
import { familyPaymentsCol, familySubscriptionDoc } from "../core/firestore-paths.js";
import { QUERY_LIMITS } from "../config/performance.js";
import {
  catalogPlanId,
  circleUsage,
  entitlementsFor,
  isPlusPlan,
  planIdOf,
} from "./entitlement-service.js";
import { resolveFamilyId } from "./user-service.js";
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

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

// Canonical-first subscription field reads with legacy fallbacks so documents
// written before the schema alignment keep working.
function statusOf(session, snapshot = null) {
  return snapshot?.status || session?.subscriptionStatus || null;
}

function periodEndOf(session, snapshot = null) {
  return snapshot?.currentPeriodEnd
    || snapshot?.periodEnd
    || session?.currentPeriodEnd
    || session?.subscriptionPeriodEnd
    || null;
}

function cancelAtPeriodEndOf(session, snapshot = null) {
  if (snapshot) {
    return Boolean(snapshot.cancelAtPeriodEnd ?? snapshot.subscriptionCancelAtPeriodEnd ?? false);
  }
  return Boolean(session?.cancelAtPeriodEnd ?? session?.subscriptionCancelAtPeriodEnd ?? false);
}

function intervalFieldOf(session, snapshot = null) {
  return snapshot?.interval || session?.interval || session?.subscriptionInterval || "";
}

function billingIntervalOf(session, snapshot = null) {
  const raw = String(intervalFieldOf(session, snapshot)).trim().toLowerCase();
  if (raw === BILLING_INTERVALS.YEAR) return BILLING_INTERVALS.YEAR;
  if ((snapshot?.stripePriceId || session?.stripePriceId) === PLUS_ANNUAL_PRICE_ID) {
    return BILLING_INTERVALS.YEAR;
  }
  if (isPlusPlan(snapshot?.plan || session?.plan)) return BILLING_INTERVALS.MONTH;
  return null;
}

function paymentToInvoice(payment = {}) {
  const amount = payment.amountPaid ?? payment.amount ?? payment.amountDue ?? payment.total ?? null;
  return {
    id: payment.id || payment.stripeInvoiceId || payment.stripePaymentIntentId || "",
    number: payment.number || payment.receiptNumber || payment.invoiceNumber || "",
    status: payment.status || "paid",
    amountPaid: payment.amountPaid ?? amount,
    amountDue: payment.amountDue ?? 0,
    currency: payment.currency || "USD",
    createdAt: toIso(payment.createdAt) || toIso(payment.paidAt) || toIso(payment.periodEnd),
    periodEnd: toIso(payment.periodEnd),
    hostedInvoiceUrl: payment.hostedInvoiceUrl || payment.receiptUrl || "",
    invoicePdf: payment.invoicePdf || "",
  };
}

// Map a canonical families/{familyId}/subscription/current (or legacy
// subscriptions/{uid}) document onto the snapshot shape the billing UI expects.
function subscriptionDocSnapshot(data = {}, { familyId = null, invoices = [] } = {}) {
  const plan = catalogPlanId(data.plan || (data.plusEntitled ? SUBSCRIPTION_PLANS.PLUS : SUBSCRIPTION_PLANS.FREE));
  const stripePriceId = data.stripePriceId || null;
  const interval = billingIntervalOf({ stripePriceId }, { plan, stripePriceId });
  return {
    familyId: data.familyId || familyId,
    plan,
    status: data.status || (data.plusEntitled ? "active" : "none"),
    periodEnd: toIso(data.currentPeriodEnd) || toIso(data.trialEndsAt),
    cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
    stripeCustomerId: data.stripeCustomerId || null,
    hasStripeCustomer: Boolean(data.stripeCustomerId),
    paymentMethod: null,
    invoices,
    interval,
    stripePriceId,
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    billingUserId: data.billingUserId || null,
    plusEntitled: Boolean(data.plusEntitled),
    trialEndsAt: toIso(data.trialEndsAt),
    trialUsed: Boolean(data.trialUsed),
    currentPeriodStart: toIso(data.currentPeriodStart),
    canceledAt: toIso(data.canceledAt),
    updatedAt: toIso(data.updatedAt),
    source: "family",
  };
}

async function readFamilyPayments(sdk, familyId) {
  const snap = await sdk.getDocs(sdk.query(
    familyPaymentsCol(familyId),
    sdk.orderBy("createdAt", "desc"),
    sdk.limit(QUERY_LIMITS.PAGE),
  ));
  return snap.docs.map((doc) => paymentToInvoice({ id: doc.id, ...doc.data() }));
}

// Canonical family-scoped billing read with a legacy per-user fallback.
async function readFamilyBillingSnapshot(session) {
  if (!usesLiveAuth() || !session?.id) return null;
  const sdk = getFirestoreSdk();
  const db = getFirebaseDb();
  if (!sdk || !db) return null;

  const familyId = await resolveFamilyId(session.id).catch(() => null);
  if (familyId) {
    try {
      const snap = await sdk.getDoc(familySubscriptionDoc(familyId));
      if (snap.exists()) {
        const invoices = await readFamilyPayments(sdk, familyId).catch(() => []);
        return subscriptionDocSnapshot(snap.data(), { familyId, invoices });
      }
    } catch {
      // fall back to the legacy per-user document
    }
  }

  try {
    const legacy = await sdk.getDoc(sdk.doc(db, "subscriptions", session.id));
    if (legacy.exists()) {
      return subscriptionDocSnapshot(legacy.data(), { familyId });
    }
  } catch {
    // no legacy billing document
  }
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
    status: statusOf(session) || (referralTrial ? "trialing" : (plus ? "active" : "none")),
    periodEnd,
    cancelAtPeriodEnd: cancelAtPeriodEndOf(session),
    stripeCustomerId: session?.stripeCustomerId || null,
    hasStripeCustomer: Boolean(session?.stripeCustomerId) || (plus && !usesLiveAuth() && !referralTrial),
    paymentMethod: plus && !usesLiveAuth() && !referralTrial ? { brand: "visa", last4: "4242" } : null,
    invoices: plus && !usesLiveAuth() && !referralTrial ? [mockInvoice(periodEnd, interval)] : [],
    interval,
    stripePriceId: session?.stripePriceId || null,
    stripeSubscriptionId: session?.stripeSubscriptionId || null,
    currentPeriodStart: session?.currentPeriodStart || null,
    trialEndsAt: session?.trialEndsAt || null,
    trialUsed: Boolean(session?.trialUsed),
    billingUserId: session?.billingUserId || session?.id || null,
    mock: !usesLiveAuth(),
  };
}

function withBilling(plan, session, snapshot = null) {
  const plus = isPlusPlan(plan.id);
  const periodEnd = periodEndOf(session, snapshot)
    || (plus && !usesLiveAuth() ? mockPeriodEnd(session) : null);
  return {
    ...plan,
    status: statusOf(session, snapshot) || (plus ? "active" : "none"),
    periodEnd,
    cancelAtPeriodEnd: cancelAtPeriodEndOf(session, snapshot),
    stripeCustomerId: snapshot?.stripeCustomerId || session?.stripeCustomerId || null,
    hasStripeCustomer: snapshot
      ? Boolean(snapshot.hasStripeCustomer ?? snapshot.stripeCustomerId)
      : Boolean(session?.stripeCustomerId) || (plus && !usesLiveAuth()),
    paymentMethod: snapshot?.paymentMethod || null,
    invoices: snapshot?.invoices || [],
    interval: intervalFieldOf(session, snapshot) || plan.interval || null,
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
      status: statusOf(session) || "trialing",
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

  const familyId = await resolveFamilyId(session.id);
  if (!familyId) {
    throw new Error("A family is required before starting Famielda Plus.");
  }
  const origin = checkoutOrigin();
  const result = await callCloudFunction("createSubscriptionCheckout", {
    familyId,
    plan: interval === BILLING_INTERVALS.YEAR ? "annual" : "monthly",
    successUrl: `${origin}/app/settings.html?tab=plans&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/app/settings.html?tab=plans&checkout=cancel`,
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

  const familyId = await resolveFamilyId(session.id);
  if (!familyId) {
    throw new Error("A family is required to manage billing.");
  }
  const result = await callCloudFunction("createBillingPortalSession", {
    familyId,
    returnUrl: `${checkoutOrigin()}/app/settings.html?tab=plans&portal=return`,
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

  const familyId = await resolveFamilyId(session.id);
  if (!familyId) {
    throw new Error("A family is required to resume Famielda Plus.");
  }
  const result = await callCloudFunction("resumeFamilySubscription", { familyId });
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
  // Mobile's getSubscriptionCatalog exposes plan metadata only; billing status
  // is read from the canonical families/{familyId}/subscription/current doc.
  const catalog = await callCloudFunction("getSubscriptionCatalog", {}).catch(() => null);
  await refreshSession();
  const familySnapshot = await readFamilyBillingSnapshot(session).catch(() => null);
  const snapshot = familySnapshot || emptySnapshot(getSession() || session);
  return catalog ? { ...snapshot, catalog } : snapshot;
}

// Web checkout finalization is owned by mobile's Stripe webhook, which syncs
// families/{familyId}/subscription/current. Mobile has no callable equivalent
// for the retired web finalizePlusCheckout (createSubscriptionPaymentSheet
// creates a new in-app payment sheet instead), so we only refresh locally.
export async function finalizeCheckoutReturn(sessionId, session = getSession()) {
  if (!usesLiveAuth() || !session?.id) {
    return { ok: false, mock: !usesLiveAuth() };
  }
  const id = String(sessionId || "").trim();
  if (!id.startsWith("cs_")) {
    return { ok: false };
  }
  await refreshSession();
  return { ok: false, sessionId: id, pendingWebhook: true };
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
    await finalizeCheckoutReturn(sessionId).catch(() => ({ ok: false }));
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
