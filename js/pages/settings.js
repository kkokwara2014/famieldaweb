import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import {
  BILLING_INTERVALS,
  PLAN_CATALOG,
  PORTAL_FLOWS,
  checkoutIntervalOf,
  formatBillingDate,
  formatInvoiceAmount,
  formatPlanPrice,
  getCurrentPlan,
  startPlusCheckout,
  openBillingPortal,
  resumePlusSubscription,
  loadBillingSnapshot,
  handleCheckoutReturn,
  handlePortalReturn,
  paymentMethodLabel,
} from "../subscriptions/plans.js";
import { getSession } from "../auth/session.js";
import { usesLiveAuth } from "../core/firebase.js";
import { canUseAdvancedNotifications, isPlusPlan } from "../services/entitlement-service.js";
import { deleteAccount } from "../auth/account.js";
import { confirmDialog } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { selectTab } from "../components/tabs.js";
import { emptyState } from "../components/empty-state.js";
import { go, routes } from "../config/routes.js";
import { roleSummary, isProfessionalRole } from "../config/roles.js";
import { onboardingSummary } from "../config/onboarding.js";
import { verificationChipHtml } from "../components/verification-banner.js";
import { VERIFICATION_STATUS } from "../config/constants.js";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_PREFERENCE_GROUPS,
  isPlusNotificationType,
  isRequiredNotificationType,
} from "../config/notifications.js";
import { getNotificationPreferences, saveNotificationPreferences } from "../services/notification-service.js";
import {
  canUsePush,
  disablePushNotifications,
  enablePushNotifications,
  pushPermissionState,
} from "../notifications/fcm.js";

const session = await bootApp({ page: "settings" });
const checkout = await handleCheckoutReturn();
const portal = await handlePortalReturn();
const current = getSession() || session;
let snapshot = await loadBillingSnapshot(current).catch(() => null);
let plan = await getCurrentPlan(getSession() || current, snapshot);
const advancedNotices = canUseAdvancedNotifications({ session: current });
let prefs = await getNotificationPreferences(current);

qs("[data-profile-name]").textContent = current.displayName;
qs("[data-profile-email]").textContent = current.email;
qs("[data-profile-role]").textContent = roleSummary(current);
const onboardHint = qs("[data-profile-onboarding]");
if (onboardHint) onboardHint.textContent = onboardingSummary(current);
const verifyChip = qs("[data-profile-verification]");
if (verifyChip) {
  if (isProfessionalRole(current.role)) {
    const status = current.verificationStatus || VERIFICATION_STATUS.PENDING;
    verifyChip.innerHTML = `${verificationChipHtml(status)} <a href="verification.html">Verification file</a>`;
    verifyChip.hidden = false;
  } else {
    verifyChip.hidden = true;
  }
}

const status = qs("[data-email-status]");
status.textContent = current.emailVerified ? "Email verified" : "Email not verified";
status.className = `badge ${current.emailVerified ? "badge--success" : "badge--warning"}`;

renderBilling(plan);

const requestedTab = new URLSearchParams(window.location.search).get("tab");
const tabs = qs("[data-tabs]");
if (tabs && ["account", "notifications", "plans"].includes(requestedTab)) {
  selectTab(tabs, requestedTab);
}

if (checkout?.status === "success") {
  toast(
    checkout.activated
      ? "Famielda Plus is active. Medication, documents, history, and the full circle are unlocked."
      : "Payment received. Plus will appear as soon as Stripe confirms the subscription.",
    { type: checkout.activated ? "success" : "info", duration: 5200 }
  );
} else if (checkout?.status === "cancel") {
  toast("Checkout was cancelled. You are still on the Free plan.", { type: "info" });
} else if (portal?.status === "return") {
  toast("Returned from Stripe. Your plan, renewal date, and invoices are up to date.", { type: "success" });
}

bindPlanActions();
bindNotificationPrefs();

const deleteForm = qs("#delete-account-form");
const deleteError = qs("#delete-error");

on(deleteForm, "submit", async (event) => {
  event.preventDefault();
  deleteError.hidden = true;

  const confirmed = await confirmDialog({
    title: "Delete your Famielda account?",
    body: "This permanently removes the same account on Famielda Web and Famielda Mobile. Care data tied to this login cannot be recovered.",
    confirmLabel: "Delete account",
    cancelLabel: "Keep account",
    danger: true,
  });

  if (!confirmed) return;

  const submit = deleteForm.querySelector("[type='submit']");
  setButtonLoading(submit, true);

  try {
    await deleteAccount({ password: deleteForm.password.value });
    toast("Your Famielda account has been deleted.", { type: "success" });
    go(routes.login);
  } catch (error) {
    deleteError.hidden = false;
    deleteError.textContent = error.message;
    toast(error.message, { type: "error" });
    setButtonLoading(submit, false);
  }
});

function bindNotificationPrefs() {
  const channelForm = qs("[data-notice-channel-form]");
  const typesForm = qs("[data-notice-types-form]");
  const enablePush = qs("[data-enable-push]");
  const disablePush = qs("[data-disable-push]");
  if (!channelForm || !typesForm) return;

  typesForm.innerHTML = NOTIFICATION_PREFERENCE_GROUPS.map((group) => {
    const items = NOTIFICATION_CATALOG.filter((item) => item.group === group.id);
    if (!items.length) return "";
    return `
      <p class="notice-pref-group">${escapeHtml(group.label)}</p>
      ${items.map((item) => {
        const locked = isPlusNotificationType(item.id) && !advancedNotices;
        return `
        <label class="notice-pref${locked ? " notice-pref--locked" : ""}">
          <input type="checkbox" name="type:${escapeHtml(item.id)}" ${isRequiredNotificationType(item.id) || locked ? "disabled" : ""}>
          <span>
            <strong>${escapeHtml(item.label)}${locked ? ' <span class="badge badge--warning">Plus</span>' : ""}</strong>
            <span class="person__meta">${escapeHtml(locked ? "Medication and appointment reminders are a Famielda Plus feature." : item.description)}</span>
          </span>
        </label>
      `;
      }).join("")}
    `;
  }).join("");

  syncPrefForms();
  renderPushStatus();

  on(channelForm, "change", savePrefsFromForms);
  on(typesForm, "change", savePrefsFromForms);
  on(enablePush, "click", async () => {
    setButtonLoading(enablePush, true);
    const result = await enablePushNotifications(session);
    setButtonLoading(enablePush, false);
    if (result.ok) {
      prefs = await saveNotificationPreferences({ ...prefs, pushEnabled: true }, session);
      syncPrefForms();
      toast("Browser notifications are on.", { type: "success" });
    } else if (result.reason === "denied") {
      toast("Notifications are blocked in this browser. Allow them in site settings, then try again.", { type: "error" });
    } else if (result.reason === "unavailable") {
      toast("Push needs a configured Firebase Cloud Messaging key on this project.", { type: "info" });
    } else {
      toast("Browser notifications were not enabled.", { type: "info" });
    }
    renderPushStatus();
  });
  on(disablePush, "click", async () => {
    await disablePushNotifications(session);
    prefs = await saveNotificationPreferences({ ...prefs, pushEnabled: false }, session);
    syncPrefForms();
    renderPushStatus();
    toast("Push notifications are off on this browser.", { type: "info" });
  });
}

function syncPrefForms() {
  const channelForm = qs("[data-notice-channel-form]");
  const typesForm = qs("[data-notice-types-form]");
  if (channelForm.inAppEnabled) channelForm.inAppEnabled.checked = prefs.inAppEnabled !== false;
  if (channelForm.pushEnabled) channelForm.pushEnabled.checked = prefs.pushEnabled !== false;
  NOTIFICATION_CATALOG.forEach((item) => {
    const input = typesForm.elements.namedItem(`type:${item.id}`);
    if (input) input.checked = isRequiredNotificationType(item.id) || (isPlusNotificationType(item.id) && !advancedNotices ? false : prefs.types?.[item.id] !== false);
  });
}

async function savePrefsFromForms() {
  const channelForm = qs("[data-notice-channel-form]");
  const typesForm = qs("[data-notice-types-form]");
  const types = { ...prefs.types };
  NOTIFICATION_CATALOG.forEach((item) => {
    const input = typesForm.elements.namedItem(`type:${item.id}`);
    types[item.id] = isRequiredNotificationType(item.id)
      ? true
      : (isPlusNotificationType(item.id) && !advancedNotices ? false : Boolean(input?.checked));
  });
  prefs = await saveNotificationPreferences({
    inAppEnabled: Boolean(channelForm.inAppEnabled?.checked),
    pushEnabled: Boolean(channelForm.pushEnabled?.checked),
    types,
  }, session);
  toast("Notification preferences saved.", { type: "success" });
}

function renderPushStatus() {
  const badge = qs("[data-push-status]");
  const enablePush = qs("[data-enable-push]");
  const disablePush = qs("[data-disable-push]");
  const permission = pushPermissionState();
  let label = "Not enabled";
  let tone = "badge--neutral";
  if (!canUsePush()) {
    label = "Cloud Messaging is not configured";
  } else if (permission === "granted" && prefs.pushEnabled) {
    label = "Browser push is on";
    tone = "badge--success";
  } else if (permission === "denied") {
    label = "Blocked by the browser";
    tone = "badge--warning";
  } else if (permission === "granted") {
    label = "Permission granted";
    tone = "badge--info";
  }
  if (badge) {
    badge.textContent = label;
    badge.className = `badge ${tone}`;
  }
  if (enablePush) enablePush.hidden = permission === "granted" && prefs.pushEnabled;
  if (disablePush) disablePush.hidden = !(permission === "granted" && prefs.pushEnabled);
}

function statusBadge(currentPlan) {
  if (currentPlan.status === "past_due") return { label: "Past due", tone: "badge--warning" };
  if (isPlusPlan(currentPlan.id) && currentPlan.cancelAtPeriodEnd) {
    return { label: "Cancels at period end", tone: "badge--warning" };
  }
  if (isPlusPlan(currentPlan.id) && currentPlan.status === "trialing") {
    return { label: "Trial", tone: "badge--info" };
  }
  if (isPlusPlan(currentPlan.id)) return { label: "Active", tone: "badge--success" };
  return { label: "Free", tone: "badge--neutral" };
}

function renewalCopy(currentPlan) {
  const when = formatBillingDate(currentPlan.periodEnd);
  if (!isPlusPlan(currentPlan.id)) return "No renewal — upgrade anytime.";
  if (currentPlan.status === "past_due") {
    return when ? `Access continues if payment is updated before ${when}.` : "Update the card on file to keep Plus.";
  }
  if (currentPlan.cancelAtPeriodEnd) {
    return when ? `Plus stays on through ${when}, then returns to Free.` : "Plus stays on through the end of this billing period.";
  }
  return when ? `Renews ${when}` : "Renewal date will appear after Stripe confirms the subscription.";
}

function currentPlanCopy(currentPlan) {
  const price = formatPlanPrice(currentPlan, { compact: true });
  const heading = currentPlan.heading || currentPlan.name;
  if (!isPlusPlan(currentPlan.id)) {
    return `${heading} · ${price || currentPlan.price}`;
  }
  if (currentPlan.status === "past_due") {
    return `${heading} · payment past due`;
  }
  const when = formatBillingDate(currentPlan.periodEnd);
  if (currentPlan.cancelAtPeriodEnd && when) {
    return `${heading} · through ${when}`;
  }
  if (when) {
    return `${heading} · ${price} · renews ${when}`;
  }
  return `${heading} · ${price}`;
}

function billingBannerHtml(currentPlan) {
  if (currentPlan.status === "past_due") {
    return `<div class="alert alert--warning" role="status">The last Plus payment did not go through. Update the card in Stripe to keep medication, documents, and the full circle unlocked.</div>`;
  }
  if (isPlusPlan(currentPlan.id) && currentPlan.cancelAtPeriodEnd && currentPlan.periodEnd) {
    return `<div class="alert alert--info" role="status">Plus stays on through ${escapeHtml(formatBillingDate(currentPlan.periodEnd))}. Resume it here to keep renewing, or manage billing in Stripe.</div>`;
  }
  if (isPlusPlan(currentPlan.id)) {
    return `<div class="alert alert--success" role="status">Famielda Plus is active. The care circle, medication list, documents, history, and advanced reports are unlocked.</div>`;
  }
  return `<p class="person__meta">Upgrade through Stripe Checkout. Cancel, payment method, and invoices open the Stripe Customer Portal — Cloud Functions hold the Stripe keys.</p>`;
}

function overviewActionsHtml(currentPlan) {
  if (!isPlusPlan(currentPlan.id)) {
    return `
      <div class="billing-actions">
        <button class="btn btn--primary" type="button" data-upgrade-plus="${BILLING_INTERVALS.MONTH}">Upgrade to Plus</button>
      </div>
    `;
  }

  const canceling = currentPlan.cancelAtPeriodEnd;
  const pastDue = currentPlan.status === "past_due";
  return `
    <div class="billing-actions">
      ${pastDue ? `<button class="btn btn--primary" type="button" data-manage-billing="${PORTAL_FLOWS.PAYMENT_METHOD}">Update payment method</button>` : ""}
      ${canceling
        ? `<button class="btn btn--primary" type="button" data-resume-plus>Resume Plus</button>`
        : `<button class="btn btn--danger" type="button" data-cancel-plus>Cancel subscription</button>`}
      ${pastDue ? "" : `<button class="btn btn--ghost" type="button" data-manage-billing="${PORTAL_FLOWS.PAYMENT_METHOD}">Manage payment method</button>`}
      <button class="btn btn--ghost" type="button" data-manage-billing="${PORTAL_FLOWS.INVOICES}">View invoices in Stripe</button>
    </div>
  `;
}

function overviewHtml(currentPlan) {
  const badge = statusBadge(currentPlan);
  const card = paymentMethodLabel(currentPlan.paymentMethod);
  const when = formatBillingDate(currentPlan.periodEnd);
  return `
    <div class="billing-overview__head">
      <div>
        <p class="stat-card__label">Current plan</p>
        <p class="stat-card__value">${escapeHtml(currentPlan.heading || currentPlan.name)}</p>
        <p class="person__meta">${escapeHtml(formatPlanPrice(currentPlan) || currentPlan.price)}</p>
      </div>
      <span class="badge ${badge.tone}">${escapeHtml(badge.label)}</span>
    </div>
    <div class="billing-meta">
      <div>
        <p class="stat-card__label">${currentPlan.cancelAtPeriodEnd ? "Access through" : "Renewal date"}</p>
        <p>${escapeHtml(when || "Pending")}</p>
      </div>
      <div>
        <p class="stat-card__label">Payment method</p>
        <p>${escapeHtml(card || (isPlusPlan(currentPlan.id) ? "On file in Stripe" : "None yet"))}</p>
      </div>
    </div>
    ${overviewActionsHtml(currentPlan)}
  `;
}

function invoiceStatusBadge(status) {
  if (status === "paid") return "badge--success";
  if (status === "open") return "badge--warning";
  if (status === "void" || status === "uncollectible") return "badge--danger";
  return "badge--neutral";
}

function invoicesHtml(currentPlan) {
  const invoices = currentPlan.invoices || [];
  if (!invoices.length) {
    return emptyState({
      title: isPlusPlan(currentPlan.id) ? "No invoices yet" : "Invoices appear after Plus",
      body: isPlusPlan(currentPlan.id)
        ? "Paid invoices from Stripe will show here. You can also open the full history in the Customer Portal."
        : "Upgrade to Famielda Plus to receive monthly or yearly invoices from Stripe.",
      compact: true,
    });
  }

  return `
    <ul class="list">
      ${invoices.map((invoice) => {
        const amount = formatInvoiceAmount(invoice.amountPaid || invoice.amountDue, invoice.currency);
        const when = formatBillingDate(invoice.createdAt || invoice.periodEnd);
        const href = invoice.hostedInvoiceUrl || invoice.invoicePdf || "";
        const title = invoice.number || invoice.id;
        return `
          <li class="list__item">
            <div>
              <strong>${href
                ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
                : escapeHtml(title)}</strong>
              <p class="person__meta">${escapeHtml(when || "Invoice")}</p>
            </div>
            <div class="invoice-list__meta">
              <span class="invoice-list__amount">${escapeHtml(amount)}</span>
              <span class="badge ${invoiceStatusBadge(invoice.status)}">${escapeHtml(invoice.status || "invoice")}</span>
            </div>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function catalogItemIsCurrent(item, currentPlan) {
  if (item.catalogId && currentPlan.catalogId) return item.catalogId === currentPlan.catalogId;
  if (!isPlusPlan(item.id)) return item.id === currentPlan.id;
  return item.id === currentPlan.id
    && (item.interval || BILLING_INTERVALS.MONTH) === (currentPlan.interval || BILLING_INTERVALS.MONTH);
}

function planActionHtml(item, currentPlan) {
  if (!isPlusPlan(item.id)) {
    return `
      <div class="plan-card__actions">
        <span class="badge ${catalogItemIsCurrent(item, currentPlan) ? "badge--success" : "badge--neutral"}">${catalogItemIsCurrent(item, currentPlan) ? "Current" : "Included in Plus"}</span>
      </div>
    `;
  }
  if (catalogItemIsCurrent(item, currentPlan)) {
    return `
      <div class="plan-card__actions">
        <span class="badge badge--success">Current</span>
        ${currentPlan.cancelAtPeriodEnd
          ? `<button class="btn btn--primary" type="button" data-resume-plus>Resume Plus</button>`
          : `<button class="btn btn--ghost" type="button" data-manage-billing="${PORTAL_FLOWS.OVERVIEW}">Manage in Stripe</button>`}
      </div>
    `;
  }
  if (isPlusPlan(currentPlan.id)) {
    return `
      <div class="plan-card__actions">
        <span class="badge badge--neutral">Switch in Stripe</span>
        <button class="btn btn--ghost" type="button" data-manage-billing="${PORTAL_FLOWS.OVERVIEW}">Manage billing</button>
      </div>
    `;
  }
  const interval = item.interval || BILLING_INTERVALS.MONTH;
  const label = interval === BILLING_INTERVALS.YEAR ? "Upgrade yearly" : "Upgrade monthly";
  return `
    <div class="plan-card__actions">
      <button class="btn ${item.featured ? "btn--primary" : "btn--ghost"}" type="button" data-upgrade-plus="${interval}">${label}</button>
    </div>
  `;
}

function renderBilling(currentPlan) {
  const currentLabel = qs("[data-current-plan]");
  if (currentLabel) currentLabel.textContent = currentPlanCopy(currentPlan);

  const renewal = qs("[data-current-renewal]");
  if (renewal) renewal.textContent = renewalCopy(currentPlan);

  const banner = qs("[data-billing-banner]");
  if (banner) banner.innerHTML = billingBannerHtml(currentPlan);

  const overview = qs("[data-billing-overview]");
  if (overview) overview.innerHTML = overviewHtml(currentPlan);

  const invoices = qs("[data-billing-invoices]");
  if (invoices) invoices.innerHTML = invoicesHtml(currentPlan);

  const invoicesPortal = qs("[data-invoices-portal]");
  if (invoicesPortal) {
    invoicesPortal.hidden = !currentPlan.hasStripeCustomer && !(currentPlan.invoices || []).length;
  }

  const list = qs("[data-plan-list]");
  if (!list) return;
  list.innerHTML = PLAN_CATALOG.map((item) => `
    <article class="card plan-card${catalogItemIsCurrent(item, currentPlan) ? " is-current" : ""}${item.featured ? " plan-card--featured" : ""}">
      ${item.featured ? `<p class="plan-card__badge">Best value</p>` : ""}
      <h3>${escapeHtml(item.heading || item.name)}</h3>
      <p class="stat-card__value">${escapeHtml(item.price)}${item.period ? `<span class="person__meta"> ${escapeHtml(item.period)}</span>` : ""}</p>
      <p>${escapeHtml(item.summary)}</p>
      <ul class="plan-features">
        ${(item.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
      </ul>
      ${planActionHtml(item, currentPlan)}
    </article>
  `).join("");
}

async function reloadBilling() {
  snapshot = await loadBillingSnapshot(getSession() || current).catch(() => snapshot);
  plan = await getCurrentPlan(getSession() || current, snapshot);
  renderBilling(plan);
}

async function launchPortal(button, flow) {
  setButtonLoading(button, true);
  try {
    const result = await openBillingPortal(getSession() || current, flow);
    if (result?.url) {
      window.location.assign(result.url);
      return;
    }
    await reloadBilling();
    if (flow === PORTAL_FLOWS.CANCEL) {
      toast("Plus will stay on through the current period, then return to Free.", { type: "info" });
    } else if (flow === PORTAL_FLOWS.INVOICES) {
      qs("[data-billing-invoices]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Invoices for this architecture session are listed below.", { type: "info" });
    }
  } catch (error) {
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(button, false);
  }
}

function bindPlanActions() {
  const root = qs("[data-app-page]") || document;
  delegate(root, "click", "[data-upgrade-plus]", async (_event, button) => {
    setButtonLoading(button, true);
    try {
      const result = await startPlusCheckout(getSession() || current, {
        interval: checkoutIntervalOf(button.getAttribute("data-upgrade-plus")),
      });
      if (result?.url) {
        window.location.assign(result.url);
        return;
      }
      await reloadBilling();
      toast("Famielda Plus is active in this architecture session.", { type: "success" });
    } catch (error) {
      toast(error.message, { type: "error" });
    } finally {
      setButtonLoading(button, false);
    }
  });

  delegate(root, "click", "[data-manage-billing]", async (_event, button) => {
    await launchPortal(button, button.getAttribute("data-manage-billing") || PORTAL_FLOWS.OVERVIEW);
  });

  delegate(root, "click", "[data-cancel-plus]", async (_event, button) => {
    const when = formatBillingDate(plan.periodEnd);
    const confirmed = await confirmDialog({
      title: "Cancel Famielda Plus?",
      body: when
        ? `Stripe will confirm cancellation. Plus stays on through ${when}, then the circle returns to the Free limits.`
        : "Stripe will confirm cancellation. Plus stays on through the end of this billing period.",
      confirmLabel: usesLiveAuth() ? "Continue to Stripe" : "Cancel at period end",
      cancelLabel: "Keep Plus",
      danger: true,
    });
    if (!confirmed) return;
    await launchPortal(button, PORTAL_FLOWS.CANCEL);
  });

  delegate(root, "click", "[data-resume-plus]", async (_event, button) => {
    const when = formatBillingDate(plan.periodEnd);
    const confirmed = await confirmDialog({
      title: "Resume Famielda Plus?",
      body: when
        ? `Plus will keep renewing on ${when}. Medication, documents, history, and the full circle stay unlocked.`
        : "Plus will keep renewing at the end of this billing period.",
      confirmLabel: "Resume Plus",
      cancelLabel: "Not now",
    });
    if (!confirmed) return;
    setButtonLoading(button, true);
    try {
      await resumePlusSubscription(getSession() || current);
      await reloadBilling();
      toast("Famielda Plus will renew again.", { type: "success" });
    } catch (error) {
      toast(error.message, { type: "error" });
    } finally {
      setButtonLoading(button, false);
    }
  });
}

