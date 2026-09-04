import { escapeHtml } from "../core/dom.js";
import { emptyState } from "../components/empty-state.js";
import { avatarHtml } from "../components/avatar.js";
import { pagerHtml } from "../core/pagination.js";
import { PAGE_SIZE } from "../config/performance.js";

export function messagingInboxHtml({
  workspace,
  thread = null,
  selectedId = "",
  name = "this household",
  composeTo = "",
  compact = false,
} = {}) {
  const conversations = workspace?.conversations || [];
  const selected = thread?.conversation || conversations.find((item) => item.id === selectedId) || conversations[0] || null;
  const messages = thread?.messages || [];
  const canPost = thread ? thread.canPost : workspace?.canPostCircle;
  const groups = workspace?.contactGroups || [];

  return `
    <div class="msg-board${compact ? " msg-board--compact" : ""}">
      <aside class="card msg-inbox" aria-labelledby="msg-inbox-title">
        <div class="card__header">
          <div>
            <h2 id="msg-inbox-title">Conversations</h2>
            <p class="person__meta">${workspace?.counts?.unread ? `${workspace.counts.unread} unread` : "Only this care circle"}</p>
          </div>
        </div>
        ${groups.length ? contactPickerHtml(groups, composeTo) : ""}
        ${conversations.length ? `
          <ul class="msg-inbox__list">
            ${conversations.map((item) => conversationItemHtml(item, selected?.id)).join("")}
          </ul>
        ` : emptyState({
          title: "No conversations yet",
          body: `Message the caregiver, nurse, physiotherapist, or MD on ${escapeHtml(name)}’s circle.`,
          compact: true,
        })}
      </aside>
      <section class="card msg-thread" aria-labelledby="msg-thread-title">
        ${selected ? `
          <div class="card__header">
            <div>
              <h2 id="msg-thread-title">${escapeHtml(selected.title)}</h2>
              <p class="person__meta">${escapeHtml(selected.subtitle)}</p>
            </div>
            <span class="badge ${selected.isCircle ? "badge--brand" : "badge--info"}">${selected.isCircle ? "Circle" : "Direct"}</span>
          </div>
          ${thread?.hasMore ? pagerHtml({ hasMore: true, loaded: messages.length, limit: PAGE_SIZE, label: "Load earlier messages" }) : ""}
          ${messages.length ? `
            <ol class="msg-thread__list">
              ${messages.map((item) => messageItemHtml(item)).join("")}
            </ol>
          ` : emptyState({
            title: "No messages yet",
            body: selected.isCircle
              ? "Write the first note so the circle has one place to talk about care."
              : `Start a private thread. Only you and ${escapeHtml(selected.title)} will see it.`,
            compact: true,
          })}
          ${canPost ? composeFormHtml(selected) : `
            <p class="person__meta">You can read this thread, but you cannot send a message.</p>
          `}
        ` : emptyState({
          title: "Choose someone to message",
          body: "Family can talk privately with the caregiver, nurse, physiotherapist, or MD on this circle. Unrelated people cannot.",
          compact: true,
        })}
      </section>
    </div>
  `;
}

function contactPickerHtml(groups, selectedId = "") {
  return `
    <form class="msg-start form" data-message-start>
      <div class="field">
        <label for="msg-contact">New private message</label>
        <select id="msg-contact" name="memberId" class="select" required>
          <option value="" ${selectedId ? "" : "selected"} disabled>Someone on this circle</option>
          ${groups.map((group) => `
            <optgroup label="${escapeHtml(group.label)}">
              ${group.items.map((item) => `
                <option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.roleLabel)}</option>
              `).join("")}
            </optgroup>
          `).join("")}
        </select>
      </div>
      <button class="btn btn--ghost btn--sm" type="submit">Open thread</button>
    </form>
  `;
}

function conversationHref(id) {
  const params = new URLSearchParams(window.location.search);
  params.set("thread", id);
  return `${window.location.pathname}?${params.toString()}`;
}

function conversationItemHtml(item, selectedId) {
  return `
    <li>
      <a class="msg-inbox__item${item.id === selectedId ? " is-active" : ""}${item.unread ? " is-unread" : ""}" href="${escapeHtml(conversationHref(item.id))}" data-open-thread="${escapeHtml(item.id)}">
        ${avatarHtml(item.otherName || item.title, item.photoURL)}
        <div>
          <div class="msg-inbox__meta">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.when)}</span>
          </div>
          <p>${escapeHtml(item.preview)}</p>
          <div class="person__meta">${escapeHtml(item.subtitle)}</div>
        </div>
      </a>
    </li>
  `;
}

function messageItemHtml(item) {
  return `
    <li class="msg-bubble${item.mine ? " is-mine" : ""}">
      ${avatarHtml(item.author, item.photoURL)}
      <div>
        <div class="msg-bubble__meta">
          <strong>${escapeHtml(item.author)}</strong>
          <span>${escapeHtml(item.when)}</span>
        </div>
        <p>${escapeHtml(item.body)}</p>
      </div>
    </li>
  `;
}

function composeFormHtml(conversation) {
  const placeholder = conversation.isCircle
    ? "A short update for everyone around them."
    : `A private note for ${conversation.title}.`;
  return `
    <form class="hub-compose form" data-message-form>
      <input type="hidden" name="conversationId" value="${escapeHtml(conversation.id)}">
      <div class="field">
        <label for="hub-message">${conversation.isCircle ? "Message the circle" : `Message ${escapeHtml(conversation.title)}`}</label>
        <textarea id="hub-message" name="body" required rows="3" maxlength="4000" placeholder="${escapeHtml(placeholder)}"></textarea>
      </div>
      <div class="hub-compose__actions">
        <button class="btn btn--primary" type="submit">Send message</button>
      </div>
    </form>
  `;
}

export function messagingPreviewHtml(conversations, { emptyTitle, emptyBody, href = "messages.html" } = {}) {
  if (!conversations?.length) {
    return emptyState({ title: emptyTitle, body: emptyBody, compact: true });
  }
  return `
    <ul class="list">
      ${conversations.map((item) => `
        <li class="list__item">
          <div>
            <div class="notice__type">${escapeHtml(item.subtitle)} · ${escapeHtml(item.when)}</div>
            <strong>${escapeHtml(item.title)}</strong>
            <p class="person__meta">${escapeHtml(item.preview)}</p>
          </div>
          <a class="btn btn--ghost btn--sm" href="${href}${item.id ? `?thread=${encodeURIComponent(item.id)}` : ""}">${item.unread ? "New" : "Open"}</a>
        </li>
      `).join("")}
    </ul>
  `;
}
