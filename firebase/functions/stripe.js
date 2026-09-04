/**
 * Famielda Plus — Stripe Checkout, Customer Portal, and webhooks.
 *
 * Secret keys stay here (Cloud Functions env / Secret Manager).
 * Never put STRIPE_SECRET_KEY or webhook secrets in client JavaScript.
 *
 * Live catalog (Famielda Stripe account acct_1RXhwoG7IvO9PkSL):
 *   monthly  price_1UADb6G7IvO9PkSLxBMSEOsS  $9.99 / month
 *   annual   price_1UADb6G7IvO9PkSLQJ94b6JA  $99.99 / year (product copy; Stripe amount follows this Price)
 *
 * firebase functions:secrets:set STRIPE_SECRET_KEY
 * firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 *
 * Webhook URL (already configured): https://us-central1-famielda.cloudfunctions.net/stripeWebhook
 */

const Stripe = require("stripe");
const { HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const entitlements = require("./entitlements");
const analytics = require("./analytics");

const LIVE_PLUS_MONTHLY_PRICE_ID = "price_1UADb6G7IvO9PkSLxBMSEOsS";
const LIVE_PLUS_ANNUAL_PRICE_ID = "price_1UADb6G7IvO9PkSLQJ94b6JA";
const DEFAULT_CHECKOUT_ORIGINS = [
  "https://famielda.web.app",
  "https://famielda.firebaseapp.com",
];

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripePlusPriceId = defineString("STRIPE_PLUS_PRICE_ID", {
  description: "Stripe Price ID for the existing Famielda Plus monthly plan",
  default: LIVE_PLUS_MONTHLY_PRICE_ID,
});
const stripePlusAnnualPriceId = defineString("STRIPE_PLUS_ANNUAL_PRICE_ID", {
  description: "Stripe Price ID for the existing Famielda Plus annual plan",
  default: LIVE_PLUS_ANNUAL_PRICE_ID,
});
const stripeCheckoutOrigins = defineString("STRIPE_CHECKOUT_ORIGINS", {
  description: "Comma-separated extra origins allowed to start Checkout or the Customer Portal",
  default: DEFAULT_CHECKOUT_ORIGINS.join(","),
});

const REGION = "us-central1";
const USERS = "users";
const SUBSCRIPTIONS = "subscriptions";
const STRIPE_CUSTOMERS = "stripeCustomers";
const STRIPE_EVENTS = "stripeEvents";
const PLUS_PLAN = "plus";
const FREE_PLAN = "free";
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);
const PORTAL_FLOWS = new Set(["overview", "payment_method", "cancel", "invoices"]);
const PORTAL_METADATA_SOURCE = "famielda";

let cachedPortalConfigurationId = "";

exports.checkoutOptions = {
  region: REGION,
  secrets: [stripeSecretKey],
};

exports.webhookOptions = {
  region: REGION,
  cors: false,
  invoker: "public",
  secrets: [stripeSecretKey, stripeWebhookSecret],
};

function db() {
  return getFirestore();
}

function stripeClient() {
  let key = "";
  try {
    key = String(stripeSecretKey.value() || "").trim();
  } catch (error) {
    logger.error("STRIPE_SECRET_KEY is not available.", { message: error.message });
    throw new HttpsError("failed-precondition", "Stripe is not configured on Cloud Functions.");
  }
  if (!key) {
    throw new HttpsError("failed-precondition", "Stripe is not configured on Cloud Functions.");
  }
  if (!key.startsWith("sk_live_") && !key.startsWith("sk_test_")) {
    throw new HttpsError("failed-precondition", "Stripe is not configured on Cloud Functions.");
  }
  return new Stripe(key, {
    appInfo: { name: "Famielda Web", version: "1.0.0", url: "https://famielda.web.app" },
  });
}

function throwMappedStripeError(error, fallback = "Stripe could not complete that billing request.") {
  if (error instanceof HttpsError) throw error;
  logger.error("Stripe request failed", {
    type: error?.type || "",
    code: error?.code || "",
    param: error?.param || "",
    statusCode: error?.statusCode || 0,
    requestId: error?.requestId || "",
    message: error?.message || "",
  });
  const status = Number(error?.statusCode) || 0;
  if (status === 400 || status === 404 || error?.type === "StripeInvalidRequestError") {
    throw new HttpsError("failed-precondition", fallback);
  }
  if (status === 401 || status === 403) {
    throw new HttpsError("failed-precondition", "Stripe is not configured on Cloud Functions.");
  }
  throw new HttpsError("internal", fallback);
}

function plusPriceId() {
  const id = String(stripePlusPriceId.value() || process.env.STRIPE_PLUS_PRICE_ID || LIVE_PLUS_MONTHLY_PRICE_ID).trim();
  if (!id || !id.startsWith("price_")) {
    throw new HttpsError(
      "failed-precondition",
      "Set STRIPE_PLUS_PRICE_ID to the existing Famielda Plus Price in Stripe."
    );
  }
  return id;
}

function plusAnnualPriceId() {
  const id = String(
    stripePlusAnnualPriceId.value() || process.env.STRIPE_PLUS_ANNUAL_PRICE_ID || LIVE_PLUS_ANNUAL_PRICE_ID
  ).trim();
  if (!id || !id.startsWith("price_")) {
    throw new HttpsError(
      "failed-precondition",
      "Set STRIPE_PLUS_ANNUAL_PRICE_ID to the existing Famielda Plus yearly Price in Stripe."
    );
  }
  return id;
}

function plusPriceIds() {
  const annual = String(
    stripePlusAnnualPriceId.value() || process.env.STRIPE_PLUS_ANNUAL_PRICE_ID || LIVE_PLUS_ANNUAL_PRICE_ID
  ).trim();
  return new Set([plusPriceId(), annual].filter((id) => id.startsWith("price_")));
}

function checkoutIntervalOf(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "year" || raw === "yearly" || raw === "annual" || raw === "annually") return "year";
  return "month";
}

function checkoutPriceId(interval) {
  return interval === "year" ? plusAnnualPriceId() : plusPriceId();
}

function intervalFromStoredPrice(priceId) {
  const annual = String(
    stripePlusAnnualPriceId.value() || process.env.STRIPE_PLUS_ANNUAL_PRICE_ID || LIVE_PLUS_ANNUAL_PRICE_ID
  ).trim();
  if (priceId && annual && priceId === annual) return "year";
  if (priceId && plusPriceIds().has(priceId)) return "month";
  return "";
}

function subscriptionPriceId(subscription) {
  const price = subscription?.items?.data?.[0]?.price;
  if (!price) return "";
  return typeof price === "string" ? price : (price.id || "");
}

function planFromSubscription(subscription) {
  const status = String(subscription?.status || "");
  const priceId = subscriptionPriceId(subscription);
  if (!plusPriceIds().has(priceId)) return FREE_PLAN;
  return planFromStatus(status);
}

function allowedCheckoutOrigins() {
  const extra = String(stripeCheckoutOrigins.value() || process.env.STRIPE_CHECKOUT_ORIGINS || "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_CHECKOUT_ORIGINS, ...extra]);
}

function isAllowedCheckoutOrigin(url) {
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  if (allowedCheckoutOrigins().has(url.origin)) return true;
  return /^famielda--[\w-]+\.web\.app$/.test(url.hostname);
}

function requireUid(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
}

function idOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.id || "";
}

function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function periodEndIso(subscription) {
  const seconds = subscription?.current_period_end
    || subscription?.items?.data?.[0]?.current_period_end
    || null;
  if (!seconds) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

function unixToIso(seconds) {
  if (!seconds) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

function invoiceSubscriptionId(invoice) {
  return idOf(invoice?.subscription)
    || idOf(invoice?.parent?.subscription_details?.subscription)
    || "";
}

function planFromStatus(status) {
  return ACTIVE_STATUSES.has(status) ? PLUS_PLAN : FREE_PLAN;
}

function checkoutOrigin(request) {
  const header = String(request.rawRequest?.headers?.origin || "").trim();
  const given = String(request.data?.origin || "").trim();
  const origin = (header || given).replace(/\/$/, "");
  if (!origin) {
    throw new HttpsError("invalid-argument", "Checkout must start from the Famielda site.");
  }

  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new HttpsError("invalid-argument", "Checkout origin is not a valid URL.");
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && !local) {
    throw new HttpsError("invalid-argument", "Checkout is only allowed over HTTPS.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpsError("invalid-argument", "Checkout origin must be http or https.");
  }
  if (!isAllowedCheckoutOrigin(url)) {
    throw new HttpsError("invalid-argument", "Checkout is not allowed from this site.");
  }
  return url.origin;
}

async function loadUser(uid) {
  const snap = await db().doc(`${USERS}/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { id: snap.id, uid: snap.id, ...snap.data() };
}

async function findUidForCustomer(customerId) {
  if (!customerId) return "";
  const mapped = await db().doc(`${STRIPE_CUSTOMERS}/${customerId}`).get();
  if (mapped.exists && mapped.data()?.uid) return mapped.data().uid;

  const users = await db().collection(USERS).where("stripeCustomerId", "==", customerId).limit(1).get();
  if (!users.empty) return users.docs[0].id;
  return "";
}

async function rememberCustomer(customerId, uid, email) {
  if (!customerId || !uid) return;
  await db().doc(`${STRIPE_CUSTOMERS}/${customerId}`).set({
    uid,
    email: email || "",
    updatedAt: new Date(),
  }, { merge: true });
}

async function customerIdFor(user, stripe) {
  if (user.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId);
      if (existing && !existing.deleted) {
        await rememberCustomer(existing.id, user.id, user.email);
        return existing.id;
      }
    } catch (error) {
      logger.warn("Stored Stripe customer could not be retrieved; creating a new one.", {
        uid: user.id,
        customerId: user.stripeCustomerId,
        message: error.message,
      });
    }
  }

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.displayName || undefined,
    metadata: {
      firebaseUid: user.id,
      source: "web",
    },
  });

  await db().doc(`${USERS}/${user.id}`).set({
    stripeCustomerId: customer.id,
    updatedAt: new Date(),
  }, { merge: true });
  await rememberCustomer(customer.id, user.id, user.email);
  return customer.id;
}

async function applySubscription(uid, subscription, customerId = "") {
  if (!uid || !subscription) return { plan: FREE_PLAN };

  const status = String(subscription.status || "");
  const plan = planFromSubscription(subscription);
  const customer = customerId || idOf(subscription.customer);
  const priceId = subscriptionPriceId(subscription);
  const periodEnd = periodEndIso(subscription);
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const now = new Date();
  const prevSnap = await db().doc(`${USERS}/${uid}`).get();
  const prev = prevSnap.exists ? prevSnap.data() : {};
  const stripeInterval = subscription?.items?.data?.[0]?.price?.recurring?.interval || "";
  const interval = plan === PLUS_PLAN
    ? (stripeInterval === "year" || intervalFromStoredPrice(priceId) === "year" ? "year" : "month")
    : null;

  const userPatch = {
    plan,
    stripeCustomerId: customer || null,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId || null,
    subscriptionStatus: status || null,
    subscriptionPeriodEnd: periodEnd,
    subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
    subscriptionInterval: interval,
    updatedAt: now,
  };

  const billing = {
    uid,
    plan,
    status,
    stripeCustomerId: customer || null,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId || null,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd,
    interval,
    source: "stripe",
    updatedAt: now,
  };

  const batch = db().batch();
  batch.set(db().doc(`${USERS}/${uid}`), userPatch, { merge: true });
  batch.set(db().doc(`${SUBSCRIPTIONS}/${uid}`), billing, { merge: true });
  await batch.commit();
  await rememberCustomer(customer, uid, "");
  await analytics.trackBillingChange({
    uid,
    previousPlan: prev.plan,
    previousStatus: prev.subscriptionStatus,
    previousCancelAtPeriodEnd: Boolean(prev.subscriptionCancelAtPeriodEnd),
    plan,
    status,
    cancelAtPeriodEnd,
    subscriptionId: subscription.id,
    interval,
  });

  logger.info("Famielda Plus subscription synced", {
    uid,
    plan,
    status,
    subscriptionId: subscription.id,
  });

  return { plan, status };
}

async function famieldaPortalConfigurationId(stripe) {
  if (cachedPortalConfigurationId) return cachedPortalConfigurationId;

  try {
    const listed = await stripe.billingPortal.configurations.list({ limit: 20, active: true });
    const match = listed.data.find((item) => item.metadata?.source === PORTAL_METADATA_SOURCE);
    if (match) {
      cachedPortalConfigurationId = match.id;
      return match.id;
    }

    const created = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: "Manage your Famielda Plus subscription",
      },
      features: {
        customer_update: {
          enabled: true,
          allowed_updates: ["name", "email", "address"],
        },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: {
          enabled: true,
          mode: "at_period_end",
          proration_behavior: "none",
          cancellation_reason: {
            enabled: true,
            options: [
              "too_expensive",
              "missing_features",
              "unused",
              "switched_service",
              "too_complex",
              "other",
            ],
          },
        },
      },
      metadata: { source: PORTAL_METADATA_SOURCE },
    });
    cachedPortalConfigurationId = created.id;
    return created.id;
  } catch (error) {
    logger.warn("Could not ensure Stripe Customer Portal configuration; using the account default.", {
      message: error.message,
    });
    return "";
  }
}

async function activeSubscriptionId(stripe, user) {
  if (user.stripeSubscriptionId) {
    try {
      const existing = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (existing && !existing.canceled_at && ACTIVE_STATUSES.has(existing.status)) {
        return existing.id;
      }
    } catch (error) {
      logger.warn("Stored Stripe subscription could not be retrieved for the portal.", {
        uid: user.id,
        message: error.message,
      });
    }
  }

  if (!user.stripeCustomerId) return "";
  const listed = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
    limit: 8,
  });
  const match = listed.data.find((item) => ACTIVE_STATUSES.has(item.status));
  return match?.id || "";
}

function mapInvoice(invoice) {
  return {
    id: invoice.id,
    number: invoice.number || invoice.id,
    status: invoice.status || "",
    amountPaid: invoice.amount_paid || 0,
    amountDue: invoice.amount_due || 0,
    currency: (invoice.currency || "usd").toUpperCase(),
    createdAt: unixToIso(invoice.created),
    periodEnd: unixToIso(invoice.period_end),
    hostedInvoiceUrl: invoice.hosted_invoice_url || "",
    invoicePdf: invoice.invoice_pdf || "",
  };
}

async function listInvoicesFor(stripe, customerId) {
  if (!customerId) return [];
  const listed = await stripe.invoices.list({ customer: customerId, limit: 12 });
  return listed.data
    .filter((invoice) => invoice.status && invoice.status !== "draft")
    .map(mapInvoice);
}

async function paymentMethodSummary(stripe, customerId) {
  if (!customerId) return null;

  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    const defaultMethod = customer?.invoice_settings?.default_payment_method;
    if (defaultMethod && typeof defaultMethod === "object" && defaultMethod.card) {
      return {
        brand: defaultMethod.card.brand || "card",
        last4: defaultMethod.card.last4 || "",
        expMonth: defaultMethod.card.exp_month || null,
        expYear: defaultMethod.card.exp_year || null,
      };
    }
  } catch (error) {
    logger.warn("Could not read the default Stripe payment method.", {
      customerId,
      message: error.message,
    });
  }

  try {
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 1,
    });
    const card = methods.data[0]?.card;
    if (!card) return null;
    return {
      brand: card.brand || "card",
      last4: card.last4 || "",
      expMonth: card.exp_month || null,
      expYear: card.exp_year || null,
    };
  } catch (error) {
    logger.warn("Could not list Stripe payment methods.", {
      customerId,
      message: error.message,
    });
    return null;
  }
}

function billingSnapshotFrom(user, extras = {}) {
  const plan = user.plan || FREE_PLAN;
  const storedInterval = user.subscriptionInterval === "year"
    ? "year"
    : (user.subscriptionInterval === "month" ? "month" : "");
  const interval = entitlements.isPlusPlan(plan)
    ? (storedInterval || intervalFromStoredPrice(user.stripePriceId) || extras.interval || "month")
    : null;
  return {
    plan,
    status: user.subscriptionStatus || "none",
    periodEnd: toIsoDate(user.subscriptionPeriodEnd) || extras.periodEnd || null,
    cancelAtPeriodEnd: Boolean(user.subscriptionCancelAtPeriodEnd),
    stripeCustomerId: user.stripeCustomerId || extras.customerId || null,
    hasStripeCustomer: Boolean(user.stripeCustomerId || extras.customerId),
    paymentMethod: extras.paymentMethod || null,
    invoices: extras.invoices || [],
    interval,
    stripePriceId: user.stripePriceId || extras.stripePriceId || null,
  };
}

async function syncSubscriptionById(stripe, subscriptionId, uidHint = "") {
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const uid = uidHint
    || subscription.metadata?.firebaseUid
    || await findUidForCustomer(idOf(subscription.customer));
  if (!uid) {
    logger.warn("Stripe subscription had no Famielda user.", { subscriptionId });
    return;
  }
  await applySubscription(uid, subscription, idOf(subscription.customer));
}

exports.createPlusCheckout = async (request) => {
  const uid = requireUid(request);
  const user = await loadUser(uid);
  const stripe = stripeClient();
  const origin = checkoutOrigin(request);

  if (user.stripeSubscriptionId) {
    try {
      const existing = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (ACTIVE_STATUSES.has(existing.status)) {
        await applySubscription(uid, existing, idOf(existing.customer));
        throw new HttpsError("already-exists", "Famielda Plus is already active.");
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.warn("Could not retrieve stored Stripe subscription.", {
        uid,
        message: error.message,
      });
    }
  }

  if (entitlements.isPlusPlan(user.plan) && ACTIVE_STATUSES.has(user.subscriptionStatus || "active")) {
    throw new HttpsError("already-exists", "Famielda Plus is already active.");
  }

  const interval = checkoutIntervalOf(request.data?.interval);
  const priceId = checkoutPriceId(interval);

  // Checkout Subscriptions already attach the card to the customer.
  // Do not send subscription_data.payment_settings — live Stripe API 2024-06-20
  // rejects it as an unknown parameter and the callable then returns INTERNAL.
  let session;
  try {
    const customer = await customerIdFor(user, stripe);
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      customer_update: { name: "auto", address: "auto" },
      client_reference_id: uid,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${origin}/app/settings.html?tab=plans&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/settings.html?tab=plans&checkout=cancel`,
      metadata: { firebaseUid: uid, source: "web", interval },
      payment_method_collection: "always",
      subscription_data: {
        metadata: { firebaseUid: uid, source: "web", interval },
      },
    });
  } catch (error) {
    throwMappedStripeError(error, "Stripe Checkout could not start. Please try again in a moment.");
  }

  if (!session.url) {
    throw new HttpsError("internal", "Stripe Checkout did not return a URL.");
  }

  logger.info("Created Stripe Checkout session", { uid, sessionId: session.id, interval, priceId });
  return { url: session.url, sessionId: session.id, interval };
};

exports.createBillingPortal = async (request) => {
  const uid = requireUid(request);
  const user = await loadUser(uid);
  const origin = checkoutOrigin(request);
  const flow = String(request.data?.flow || "overview").trim();
  if (!PORTAL_FLOWS.has(flow)) {
    throw new HttpsError("invalid-argument", "Unknown Stripe Customer Portal flow.");
  }

  if (!user.stripeCustomerId) {
    throw new HttpsError("failed-precondition", "No Stripe billing profile is attached to this account yet.");
  }

  const stripe = stripeClient();
  const returnUrl = `${origin}/app/settings.html?tab=plans&portal=return`;
  const configuration = await famieldaPortalConfigurationId(stripe);
  const params = {
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  };
  if (configuration) params.configuration = configuration;

  if (flow === "payment_method") {
    params.flow_data = {
      type: "payment_method_update",
      after_completion: {
        type: "redirect",
        redirect: { return_url: returnUrl },
      },
    };
  } else if (flow === "cancel") {
    const subscriptionId = await activeSubscriptionId(stripe, user);
    if (!subscriptionId) {
      throw new HttpsError("failed-precondition", "There is no active Famielda Plus subscription to cancel.");
    }
    params.flow_data = {
      type: "subscription_cancel",
      subscription_cancel: { subscription: subscriptionId },
      after_completion: {
        type: "redirect",
        redirect: { return_url: returnUrl },
      },
    };
  }

  const portal = await stripe.billingPortal.sessions.create(params).catch((error) => {
    throwMappedStripeError(error, "The Stripe billing portal could not be opened. Please try again.");
  });
  if (!portal.url) {
    throw new HttpsError("internal", "Stripe billing portal did not return a URL.");
  }

  logger.info("Created Stripe Customer Portal session", { uid, flow, sessionId: portal.id });
  return { url: portal.url, flow };
};

exports.resumePlusSubscription = async (request) => {
  const uid = requireUid(request);
  const user = await loadUser(uid);
  const stripe = stripeClient();
  const subscriptionId = await activeSubscriptionId(stripe, user);
  if (!subscriptionId) {
    throw new HttpsError("failed-precondition", "There is no Famielda Plus subscription to resume.");
  }

  const existing = await stripe.subscriptions.retrieve(subscriptionId);
  if (!existing.cancel_at_period_end) {
    const applied = await applySubscription(uid, existing, idOf(existing.customer));
    return {
      ok: true,
      alreadyRenewing: true,
      ...applied,
      periodEnd: periodEndIso(existing),
      cancelAtPeriodEnd: false,
    };
  }

  const updated = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
  const applied = await applySubscription(uid, updated, idOf(updated.customer));
  logger.info("Resumed Famielda Plus subscription", { uid, subscriptionId });
  return {
    ok: true,
    ...applied,
    periodEnd: periodEndIso(updated),
    cancelAtPeriodEnd: false,
  };
};

exports.getBillingSnapshot = async (request) => {
  const uid = requireUid(request);
  const user = await loadUser(uid);
  if (!user.stripeCustomerId && !user.stripeSubscriptionId) {
    return billingSnapshotFrom(user);
  }

  const stripe = stripeClient();
  let subscription = null;

  if (user.stripeSubscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      await applySubscription(uid, subscription, idOf(subscription.customer));
    } catch (error) {
      logger.warn("Could not refresh the stored Stripe subscription.", {
        uid,
        message: error.message,
      });
    }
  }

  const customerId = user.stripeCustomerId || idOf(subscription?.customer);
  if (!subscription && customerId) {
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 8,
    });
    subscription = listed.data.find((item) => ACTIVE_STATUSES.has(item.status)) || listed.data[0] || null;
    if (subscription) {
      await applySubscription(uid, subscription, idOf(subscription.customer));
    }
  }

  const [paymentMethod, invoices] = await Promise.all([
    paymentMethodSummary(stripe, customerId),
    listInvoicesFor(stripe, customerId),
  ]);

  const refreshed = await loadUser(uid);
  const stripeInterval = subscription?.items?.data?.[0]?.price?.recurring?.interval;
  return billingSnapshotFrom(refreshed, {
    periodEnd: periodEndIso(subscription),
    customerId,
    paymentMethod,
    invoices,
    interval: stripeInterval === "year" ? "year" : (stripeInterval === "month" ? "month" : undefined),
    stripePriceId: subscriptionPriceId(subscription) || undefined,
  });
};

exports.finalizePlusCheckout = async (request) => {
  const uid = requireUid(request);
  const sessionId = String(request.data?.sessionId || "").trim();
  if (!sessionId.startsWith("cs_")) {
    throw new HttpsError("invalid-argument", "Missing Stripe Checkout session.");
  }

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });
  const owner = session.client_reference_id || session.metadata?.firebaseUid || "";
  if (owner && owner !== uid) {
    throw new HttpsError("permission-denied", "This checkout belongs to another account.");
  }

  if (session.mode !== "subscription") {
    return { ok: false, plan: FREE_PLAN, status: session.status || "" };
  }

  const paid = session.status === "complete" || session.payment_status === "paid";
  if (!paid || !session.subscription) {
    return { ok: false, plan: FREE_PLAN, status: session.status || "" };
  }

  const subscription = typeof session.subscription === "string"
    ? await stripe.subscriptions.retrieve(session.subscription)
    : session.subscription;

  const applied = await applySubscription(uid, subscription, idOf(session.customer));
  return { ok: true, ...applied };
};

async function rememberEvent(event) {
  const ref = db().doc(`${STRIPE_EVENTS}/${event.id}`);
  try {
    await ref.create({
      type: event.type,
      livemode: Boolean(event.livemode),
      createdAt: new Date(),
    });
    return true;
  } catch (error) {
    if (error?.code === 6 || error?.code === "already-exists") return false;
    logger.warn("Could not record Stripe event id; continuing.", {
      eventId: event.id,
      message: error.message,
    });
    return true;
  }
}

async function handleStripeEvent(event, stripe) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.mode !== "subscription") return;
      const uid = session.client_reference_id || session.metadata?.firebaseUid || "";
      const subscriptionId = idOf(session.subscription);
      if (subscriptionId) {
        await syncSubscriptionById(stripe, subscriptionId, uid);
      }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const subscription = event.data.object;
      const uid = subscription.metadata?.firebaseUid || "";
      await applySubscription(
        uid || await findUidForCustomer(idOf(subscription.customer)),
        subscription,
        idOf(subscription.customer)
      );
      return;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId = invoiceSubscriptionId(invoice);
      const uid = invoice.subscription_details?.metadata?.firebaseUid
        || invoice.parent?.subscription_details?.metadata?.firebaseUid
        || invoice.metadata?.firebaseUid
        || "";
      if (subscriptionId) {
        await syncSubscriptionById(
          stripe,
          subscriptionId,
          uid
        );
      }
      if (event.type === "invoice.payment_failed") {
        const monitoring = require("./monitoring");
        await monitoring.recordPaymentFailure({
          invoiceId: invoice.id,
          status: invoice.status || "open",
          amountCents: invoice.amount_due || invoice.amount_remaining || 0,
          currency: String(invoice.currency || "usd").toUpperCase(),
          userId: uid,
          code: event.type,
        });
        logger.warn("Stripe invoice payment failed.", {
          invoiceId: invoice.id,
          status: invoice.status || "",
        });
      }
      return;
    }
    default:
      return;
  }
}

exports.stripeWebhook = async (req, res) => {
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).send("Missing Stripe signature.");
  }

  let secret = "";
  try {
    secret = String(stripeWebhookSecret.value() || "").trim();
  } catch (error) {
    logger.error("STRIPE_WEBHOOK_SECRET is not available.", { message: error.message });
    return res.status(500).send("Webhook is not configured.");
  }
  if (!secret) {
    logger.error("STRIPE_WEBHOOK_SECRET is not bound.");
    return res.status(500).send("Webhook is not configured.");
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    return res.status(400).send("Missing raw webhook body.");
  }

  let event;
  try {
    event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    logger.warn("Stripe webhook signature failed.", { message: error.message });
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  const usingLiveKey = String(stripeSecretKey.value() || "").startsWith("sk_live_");
  if (usingLiveKey && !event.livemode) {
    logger.warn("Ignored test-mode Stripe event on the live endpoint.", {
      id: event.id,
      type: event.type,
    });
    return res.status(200).json({ received: true, ignored: "test_mode" });
  }

  const fresh = await rememberEvent(event);
  if (!fresh) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event, stripeClient());
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error("Stripe webhook handler failed.", {
      type: event.type,
      id: event.id,
      message: error.message,
    });
    const monitoring = require("./monitoring");
    await monitoring.recordFunctionLog({
      name: "stripeWebhook",
      ok: false,
      code: error.code || event.type,
      message: error.message || "Stripe webhook handler failed",
    });
    await db().doc(`${STRIPE_EVENTS}/${event.id}`).delete().catch(() => {});
    return res.status(500).send("Webhook handler failed.");
  }
};

exports.listPlatformPayments = async () => {
  const stripe = stripeClient();
  const listed = await stripe.invoices.list({ limit: 40 });
  const invoices = listed.data
    .filter((invoice) => invoice.status && invoice.status !== "draft")
    .map((invoice) => ({
      ...mapInvoice(invoice),
      customerEmail: invoice.customer_email || "",
      customerName: invoice.customer_name || "",
      customerId: idOf(invoice.customer),
    }));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const paid = invoices.filter((item) => item.status === "paid");
  const monthPaid = paid.filter((item) => {
    const created = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    return created >= monthStart;
  });
  const failed = invoices.filter((item) => item.status === "open" || item.status === "uncollectible" || item.status === "void");
  const revenueCents = paid.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
  const monthCents = monthPaid.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);

  return {
    generatedAt: now.toISOString(),
    invoices,
    totals: {
      invoices: invoices.length,
      paid: paid.length,
      open: invoices.filter((item) => item.status === "open").length,
      failed: failed.length,
      revenueCents,
      monthCents,
    },
  };
};

