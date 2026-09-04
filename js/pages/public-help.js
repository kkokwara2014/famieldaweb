import { mountPublicNav } from "../components/navbar.js";
import { mountPublicFooter } from "../components/footer.js";
import { initUiSystem } from "../components/ui-system.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { debounce } from "../core/debounce.js";
import { DEBOUNCE_MS } from "../config/performance.js";
import { initPerformance } from "../core/performance.js";
import { initSession, getSession } from "../auth/session.js";
import { routes } from "../config/routes.js";
import {
  FAQ_ITEMS,
  HELP_TOPICS,
  faqsForCategory,
  helpHref,
  searchFaq,
} from "../config/support.js";
import { faqFilterHtml, faqListHtml, topicCardsHtml } from "./help-views.js";
import { faqPage } from "../config/seo.js";
import { injectJsonLd } from "../seo/document.js";
import { initMonitoring } from "../observability/monitor.js";

initMonitoring();

mountPublicNav("faq");
mountPublicFooter();
initUiSystem();
initPerformance();
injectJsonLd([faqPage(FAQ_ITEMS.map((item) => ({ question: item.question, answer: item.answer })))]);

let session = null;
try {
  session = await initSession();
} catch {
  session = getSession();
}

let faqQuery = "";
let faqCategory = "all";

const signedIn = Boolean(session?.id);
const contactHref = signedIn ? helpHref("contact") : `${routes.login}?next=${encodeURIComponent(helpHref("contact"))}`;
const problemHref = signedIn ? helpHref("problem") : `${routes.login}?next=${encodeURIComponent(helpHref("problem"))}`;

const workspaceHelp = signedIn ? helpHref("center") : `${routes.login}?next=${encodeURIComponent(helpHref("center"))}`;
document.querySelectorAll("[data-workspace-help-href]").forEach((node) => {
  node.setAttribute("href", workspaceHelp);
});
document.querySelectorAll("[data-contact-href]").forEach((node) => {
  node.setAttribute("href", contactHref);
});
document.querySelectorAll("[data-problem-href]").forEach((node) => {
  node.setAttribute("href", problemHref);
});

const signInNote = qs("[data-signin-note]");
if (signInNote) {
  signInNote.hidden = signedIn;
}

const topics = qs("[data-help-topics]");
if (topics) topics.innerHTML = topicCardsHtml(HELP_TOPICS, { signedIn: false });

bindSearch();
applyHash();
renderFaq();
scrollHash();

function applyHash() {
  const raw = String(window.location.hash || "").replace("#", "");
  if (!raw) return;
  const aliases = { plans: "subscription", help: "all" };
  const id = aliases[raw] || raw.replace(/^faq-/, "");
  const categories = new Set(["getting-started", "circle", "schedule", "account", "subscription", "notifications", "privacy"]);
  if (categories.has(id)) faqCategory = id;
}

function scrollHash() {
  const hash = String(window.location.hash || "").replace("#", "");
  if (!hash) return;
  const target = document.getElementById(hash.startsWith("faq-") ? hash : `faq-${hash}`)
    || document.getElementById(hash);
  target?.scrollIntoView({ block: "start" });
}

function bindSearch() {
  const form = qs("[data-help-search]");
  const input = qs("[data-help-search-input]");
  on(form, "submit", (event) => {
    event.preventDefault();
    faqQuery = String(input?.value || "").trim();
    faqCategory = "all";
    renderFaq();
    qs("[data-faq-list]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  if (input) {
    on(input, "input", debounce(() => {
      faqQuery = String(input.value || "").trim();
      renderFaq();
    }, DEBOUNCE_MS.SEARCH));
  }
  qs("[data-faq-panel]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-faq-category]");
    if (!button) return;
    faqCategory = button.getAttribute("data-faq-category") || "all";
    renderFaq();
  });
}

function renderFaq() {
  const filters = qs("[data-faq-filters]");
  const list = qs("[data-faq-list]");
  const count = qs("[data-faq-count]");
  if (filters) filters.innerHTML = faqFilterHtml(faqCategory);
  const items = faqsForCategory(faqCategory, searchFaq(faqQuery, FAQ_ITEMS));
  if (list) list.innerHTML = faqListHtml(FAQ_ITEMS, { query: faqQuery, category: faqCategory });
  if (count) {
    count.textContent = faqQuery
      ? `${items.length} article${items.length === 1 ? "" : "s"} for “${faqQuery}”`
      : `${items.length} article${items.length === 1 ? "" : "s"}`;
  }
}
