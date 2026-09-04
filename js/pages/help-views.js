import { escapeHtml } from "../core/dom.js";
import { emptyState } from "../components/empty-state.js";
import { SUPPORT_PRIORITY_OPTIONS, supportCategoryLabel, supportStatusBadge, supportStatusLabel } from "../config/admin.js";
import {
  FAQ_CATEGORIES,
  FAQ_ITEMS,
  HELP_TOPICS,
  PROBLEM_TYPES,
  SUPPORT_CATEGORIES,
  faqCategoryLabel,
  faqsForCategory,
  helpHref,
  searchFaq,
  supportCategoryLabel as categoryLabel,
} from "../config/support.js";
import { formatSupportWhen } from "../services/support-service.js";

export function topicCardsHtml(topics = HELP_TOPICS, { signedIn = true } = {}) {
  return `
    <div class="help-topics">
      ${topics.map((topic) => {
        const href = signedIn
          ? helpHref(topic.tab)
          : (topic.tab === "problem" ? "#contact" : `#faq-${topic.category}`);
        return `
          <a class="card card--interactive help-topic" href="${escapeHtml(href)}">
            <h3>${escapeHtml(topic.label)}</h3>
            <p class="person__meta">${escapeHtml(topic.summary)}</p>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

export function faqListHtml(items = FAQ_ITEMS, { query = "", category = "all", emptyTitle = "No matching articles" } = {}) {
  const filtered = faqsForCategory(category, searchFaq(query, items));
  if (!filtered.length) {
    return emptyState({
      title: emptyTitle,
      body: query
        ? "Try a shorter phrase, or open Contact if you still need an answer."
        : "Articles will appear here.",
      compact: true,
    });
  }

  let lastCategory = "";
  return filtered.map((item) => {
    const heading = item.category !== lastCategory
      ? `<h3 class="help-faq__group" id="faq-${escapeHtml(item.category)}">${escapeHtml(faqCategoryLabel(item.category))}</h3>`
      : "";
    lastCategory = item.category;
    const link = item.href
      ? `<p><a href="${escapeHtml(item.href)}">${escapeHtml(item.hrefLabel || "Open")}</a></p>`
      : "";
    return `
      ${heading}
      <details class="help-faq" id="faq-${escapeHtml(item.id)}">
        <summary>${escapeHtml(item.question)}</summary>
        <div class="help-faq__body">
          <p>${escapeHtml(item.answer)}</p>
          ${link}
        </div>
      </details>
    `;
  }).join("");
}

export function faqFilterHtml(active = "all") {
  const options = [{ id: "all", label: "All topics" }, ...FAQ_CATEGORIES];
  return `
    <div class="help-filters" role="group" aria-label="FAQ topics">
      ${options.map((item) => `
        <button class="btn btn--sm ${item.id === active ? "btn--secondary" : "btn--ghost"}" type="button" data-faq-category="${escapeHtml(item.id)}">
          ${escapeHtml(item.label)}
        </button>
      `).join("")}
    </div>
  `;
}

export function guideListHtml(guides = []) {
  return `
    <div class="help-guides">
      ${guides.map((item) => `
        <article class="card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.body)}</p>
          ${item.href ? `<p><a class="btn btn--ghost btn--sm" href="${escapeHtml(item.href)}">${escapeHtml(item.hrefLabel || "Open")}</a></p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

export function ticketListHtml(tickets = []) {
  if (!tickets.length) {
    return emptyState({
      title: "No requests yet",
      body: "When you contact support or report a problem, it appears here and in the operations inbox.",
      compact: true,
    });
  }

  return `
    <ul class="list">
      ${tickets.map((ticket) => {
        const replies = (ticket.replies || []).filter((reply) => !reply.internal);
        const latest = replies[replies.length - 1];
        return `
          <li class="list__item help-ticket">
            <div>
              <strong>${escapeHtml(ticket.subject)}</strong>
              <p class="person__meta">${escapeHtml(supportCategoryLabel(ticket.category) || categoryLabel(ticket.category))} · ${escapeHtml(formatSupportWhen(ticket.createdAt))}</p>
              ${latest ? `<p class="person__meta">Reply: ${escapeHtml(latest.body)}</p>` : ""}
            </div>
            <span class="badge ${supportStatusBadge(ticket.status)}">${escapeHtml(supportStatusLabel(ticket.status))}</span>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

export function ticketFormFieldsHtml({
  formId,
  category = "general",
  priority = "normal",
  includeCategory = true,
  includePriority = false,
  includeProblemType = false,
  subjectPlaceholder = "How can we help?",
  bodyPlaceholder = "What happened, and what do you need?",
  submitLabel = "Send to support",
} = {}) {
  const categories = SUPPORT_CATEGORIES.filter((item) => item.id !== "problem" || includeProblemType);
  return `
    <div class="field">
      <label for="${formId}-subject">Subject</label>
      <input id="${formId}-subject" name="subject" required minlength="4" maxlength="140" placeholder="${escapeHtml(subjectPlaceholder)}">
    </div>
    ${includeProblemType ? `
      <div class="field">
        <label for="${formId}-problem-type">What went wrong?</label>
        <select id="${formId}-problem-type" name="problemType">
          ${PROBLEM_TYPES.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("")}
        </select>
      </div>
    ` : ""}
    ${includeCategory ? `
      <div class="form-row">
        <div class="field">
          <label for="${formId}-category">Topic</label>
          <select id="${formId}-category" name="category">
            ${categories.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === category ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </div>
        ${includePriority ? `
          <div class="field">
            <label for="${formId}-priority">Priority</label>
            <select id="${formId}-priority" name="priority">
              ${SUPPORT_PRIORITY_OPTIONS.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === priority ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
            </select>
          </div>
        ` : ""}
      </div>
    ` : `<input type="hidden" name="category" value="${escapeHtml(category)}">`}
    <div class="field">
      <label for="${formId}-body">Details</label>
      <textarea id="${formId}-body" name="body" rows="5" required minlength="12" maxlength="4000" placeholder="${escapeHtml(bodyPlaceholder)}"></textarea>
    </div>
    <button class="btn btn--primary" type="submit">${escapeHtml(submitLabel)}</button>
  `;
}
