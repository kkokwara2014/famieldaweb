export const PLANS_SETTINGS_HREF = "settings.html?tab=plans";

export const CHECKOUT_RETURN = {
  SUCCESS: "success",
  CANCEL: "cancel",
};

export const PORTAL_RETURN = "return";

export const PORTAL_FLOWS = {
  OVERVIEW: "overview",
  PAYMENT_METHOD: "payment_method",
  CANCEL: "cancel",
  INVOICES: "invoices",
};

export const PLUS_MONTHLY_PRICE_ID = "price_1UADb6G7IvO9PkSLxBMSEOsS";
export const PLUS_ANNUAL_PRICE_ID = "price_1UADb6G7IvO9PkSLQJ94b6JA";

export function isActiveSubscriptionStatus(status) {
  return status === "active" || status === "trialing" || status === "past_due";
}

export function plusPlanHref(appRoot = "") {
  const base = appRoot ? `${appRoot.replace(/\/$/, "")}/` : "";
  return `${base}${PLANS_SETTINGS_HREF}`;
}

export function formatBillingDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatInvoiceAmount(amount, currency = "USD") {
  const cents = Number(amount);
  if (!Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export function paymentMethodLabel(method) {
  if (!method?.last4) return "";
  const brand = String(method.brand || "Card");
  const titled = brand.charAt(0).toUpperCase() + brand.slice(1);
  return `${titled} •••• ${method.last4}`;
}
