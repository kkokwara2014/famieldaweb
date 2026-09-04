import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { debounce } from "../core/debounce.js";
import { DEBOUNCE_MS } from "../config/performance.js";
import { getSession } from "../auth/session.js";
import { selectTab } from "../components/tabs.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { formatBillingDate } from "../config/subscription.js";
import {
  ACCOUNT_GUIDES,
  FAQ_ITEMS,
  HELP_TABS,
  PROBLEM_TYPES,
  SUBSCRIPTION_GUIDES,
  SUPPORT_KIND_DEFAULTS,
  SUPPORT_KINDS,
  currentHelpTab,
  faqsForCategory,
  searchFaq,
} from "../config/support.js";
import { isPlusPlan } from "../services/entitlement-service.js";
import { getCurrentPlan, loadBillingSnapshot, formatPlanPrice } from "../subscriptions/plans.js";
import { listMySupportTickets, submitSupportTicket } from "../services/support-service.js";
import {
  faqFilterHtml,
  faqListHtml,
  guideListHtml,
  ticketListHtml,
  topicCardsHtml,
} from "./help-views.js";

const session = await bootApp({ page: "help" });
const current = getSession() || session;
const tabs = qs("[data-tabs]");
const requested = currentHelpTab();

if (tabs && HELP_TABS.some((item) => item.id === requested.id)) {
  selectTab(tabs, requested.id);
}

let tickets = [];
let faqQuery = new URLSearchParams(window.location.search).get("q") || "";
let faqCategory = "all";
let plan = null;

const snapshot = await loadBillingSnapshot(current).catch(() => null);
plan = await getCurrentPlan(current, snapshot).catch(() => null);
tickets = await listMySupportTickets(current).catch(() => []);

bindSearch();
bindFaqFilters();
bindTicketForms();
render();

qs("[data-tabs]")?.addEventListener("tabchange", (event) => {
  const id = event.detail?.id;
  if (!id) return;
  const url = new URL(window.location.href);
  if (id === "center") url.searchParams.delete("tab");
  else url.searchParams.set("tab", id);
  window.history.replaceState({}, "", url);
});

function bindSearch() {
  const form = qs("[data-help-search]");
  const input = qs("[data-help-search-input]");
  if (input && faqQuery) input.value = faqQuery;
  on(form, "submit", (event) => {
    event.preventDefault();
    faqQuery = String(input?.value || "").trim();
    faqCategory = "all";
    if (tabs) selectTab(tabs, "faq");
    renderFaq();
  });
  if (input) {
    on(input, "input", debounce(() => {
      faqQuery = String(input.value || "").trim();
      renderFaq();
    }, DEBOUNCE_MS.SEARCH));
  }
}

function bindFaqFilters() {
  delegate(qs("[data-faq-panel]") || document, "click", "[data-faq-category]", (_event, button) => {
    faqCategory = button.getAttribute("data-faq-category") || "all";
    renderFaq();
  });
}

function bindTicketForms() {
  [
    { form: "#contact-support-form", kind: SUPPORT_KINDS.CONTACT, success: "Sent to Famielda support." },
    { form: "#report-problem-form", kind: SUPPORT_KINDS.PROBLEM, success: "Problem reported. Operations will see it in the support inbox." },
    { form: "#account-support-form", kind: SUPPORT_KINDS.ACCOUNT, success: "Account request sent." },
    { form: "#subscription-support-form", kind: SUPPORT_KINDS.SUBSCRIPTION, success: "Billing request sent." },
  ].forEach(({ form: selector, kind, success }) => {
    const form = qs(selector);
    if (!form) return;
    on(form, "submit", async (event) => {
      event.preventDefault();
      const errorBox = form.querySelector("[data-form-error]");
      if (errorBox) errorBox.hidden = true;
      const submit = form.querySelector("[type='submit']");
      setButtonLoading(submit, true);
      try {
        await submitSupportTicket(ticketPayload(form, kind), current);
        form.reset();
        restoreHiddenCategory(form, kind);
        tickets = await listMySupportTickets(current).catch(() => tickets);
        renderTickets();
        toast(success, { type: "success" });
      } catch (error) {
        if (errorBox) {
          errorBox.hidden = false;
          errorBox.textContent = error.message;
        }
        toast(error.message, { type: "error" });
      } finally {
        setButtonLoading(submit, false);
      }
    });
  });
}

function restoreHiddenCategory(form, kind) {
  const defaults = SUPPORT_KIND_DEFAULTS[kind];
  if (form.category && form.category.type === "hidden" && defaults) {
    form.category.value = defaults.category;
  }
}

function ticketPayload(form, kind) {
  const defaults = SUPPORT_KIND_DEFAULTS[kind] || SUPPORT_KIND_DEFAULTS.contact;
  const problemType = form.problemType?.value;
  const problemLabel = PROBLEM_TYPES.find((item) => item.id === problemType)?.label;
  let subject = String(form.subject?.value || "").trim();
  let body = String(form.body?.value || "").trim();
  if (problemLabel) {
    subject = subject ? `${problemLabel}: ${subject}` : problemLabel;
  }
  if (kind === SUPPORT_KINDS.PROBLEM) {
    body = `${body}\n\nPage: ${window.location.href}\nBrowser: ${navigator.userAgent}`;
  }
  return {
    subject,
    body,
    kind,
    category: form.category?.value || defaults.category,
    priority: form.priority?.value || defaults.priority,
    pageUrl: window.location.href,
    userAgent: navigator.userAgent,
  };
}

function render() {
  const topics = qs("[data-help-topics]");
  if (topics) topics.innerHTML = topicCardsHtml();
  renderFaq();
  renderTickets();
  renderGuides();
  renderPlan();
}

function renderFaq() {
  const filters = qs("[data-faq-filters]");
  const list = qs("[data-faq-list]");
  const count = qs("[data-faq-count]");
  if (filters) filters.innerHTML = faqFilterHtml(faqCategory);
  const items = faqsForCategory(faqCategory, searchFaq(faqQuery));
  if (list) list.innerHTML = faqListHtml(FAQ_ITEMS, { query: faqQuery, category: faqCategory });
  if (count) {
    count.textContent = faqQuery
      ? `${items.length} article${items.length === 1 ? "" : "s"} for “${faqQuery}”`
      : `${items.length} article${items.length === 1 ? "" : "s"}`;
  }
}

function renderTickets() {
  const open = tickets.filter((item) => item.status === "open" || item.status === "pending");
  document.querySelectorAll("[data-ticket-list]").forEach((node) => {
    node.innerHTML = ticketListHtml(tickets);
  });
  const summary = qs("[data-ticket-summary]");
  if (summary) {
    summary.textContent = open.length
      ? `${open.length} open request${open.length === 1 ? "" : "s"}`
      : tickets.length
        ? "No open requests"
        : "Contact support when something needs a person.";
  }
}

function renderGuides() {
  const account = qs("[data-account-guides]");
  const subscription = qs("[data-subscription-guides]");
  if (account) account.innerHTML = guideListHtml(ACCOUNT_GUIDES);
  if (subscription) subscription.innerHTML = guideListHtml(SUBSCRIPTION_GUIDES);
}

function renderPlan() {
  const card = qs("[data-subscription-snapshot]");
  if (!card || !plan) return;
  const plus = isPlusPlan(plan.id);
  const when = formatBillingDate(plan.periodEnd);
  const status = plus
    ? (plan.cancelAtPeriodEnd ? "Cancels at period end" : plan.status === "past_due" ? "Past due" : "Active")
    : "Free";
  card.innerHTML = `
    <h2>Your plan</h2>
    <p><strong>${escapeHtml(plan.heading || plan.name)}</strong> · ${escapeHtml(formatPlanPrice(plan, { compact: true }) || plan.price)}</p>
    <p class="person__meta">${escapeHtml(status)}${when ? ` · ${plan.cancelAtPeriodEnd ? "through" : "renews"} ${when}` : ""}</p>
    <p class="person__meta">Upgrade, cancel, payment method, and invoices stay on Settings → Subscription. Write here if billing still looks wrong after Stripe.</p>
    <p><a class="btn btn--ghost btn--sm" href="settings.html?tab=plans">Manage subscription</a></p>
  `;
}
