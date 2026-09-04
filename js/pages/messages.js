import { bootApp } from "../core/bootstrap.js";
import { qs } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { initFormUx } from "../core/forms.js";
import { emptyState } from "../components/empty-state.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import {
  getConversationThread,
  getMessagingWorkspace,
  markConversationRead,
  openDirectConversation,
  sendConversationMessage,
} from "../services/message-service.js";
import { messagingInboxHtml } from "./messaging-views.js";

const session = await bootApp({ page: "messages" });
const root = qs("[data-messages-page]");

let workspace = null;
let thread = null;
let selectedId = readThreadId();

bindPage();
await load();
render();

function readThreadId(search = window.location.search) {
  return new URLSearchParams(search).get("thread") || "";
}

function setThreadId(id) {
  selectedId = id || "";
  const url = new URL(window.location.href);
  if (selectedId) url.searchParams.set("thread", selectedId);
  else url.searchParams.delete("thread");
  history.replaceState({}, "", `${url.pathname}${url.search}`);
}

async function load() {
  try {
    workspace = await getMessagingWorkspace();
    if (!selectedId) selectedId = workspace.conversations[0]?.id || "";
    if (selectedId && !workspace.conversations.some((item) => item.id === selectedId)) {
      selectedId = workspace.conversations[0]?.id || "";
    }
    if (selectedId) {
      thread = await getConversationThread(selectedId);
      await markConversationRead(selectedId);
      workspace = await getMessagingWorkspace();
    } else {
      thread = null;
    }
  } catch (error) {
    workspace = { conversations: [], contactGroups: [], counts: { unread: 0, contacts: 0 } };
    thread = null;
    toast(error.message || "Messages could not be loaded.", { type: "error" });
  }
}

function render({ stickToBottom = true } = {}) {
  const name = workspace?.senior?.preferredName || workspace?.senior?.displayName || "this household";
  if (!workspace?.senior) {
    root.innerHTML = emptyState({
      title: "Join a household first",
      body: "Famielda only opens messages between people on the same care circle.",
      actionLabel: "Open care circle",
      actionHref: "care-circle.html",
    });
    return;
  }

  root.innerHTML = `
    <div class="welcome hub-head">
      <div>
        <p class="page-kicker">Secure communication</p>
        <h2>Messages</h2>
        <p class="page-lead">Family talks privately with the caregiver, nurse, physiotherapist, or MD on ${name}’s circle. People outside this household cannot write here.</p>
      </div>
    </div>
    ${messagingInboxHtml({
      workspace,
      thread,
      selectedId,
      name,
    })}
  `;
  initFormUx(root);
  const list = qs(".msg-thread__list", root);
  if (stickToBottom && list) list.scrollTop = list.scrollHeight;
}

function bindPage() {
  delegate(root, "click", "[data-open-thread]", async (event, link) => {
    event.preventDefault();
    setThreadId(link.dataset.openThread);
    await load();
    render();
  });

  delegate(root, "click", "[data-load-more]", async (event, button) => {
    event.preventDefault();
    if (!selectedId || !thread?.cursor) return;
    button.disabled = true;
    try {
      const older = await getConversationThread(selectedId, session, new Date(), { startAfter: thread.cursor });
      const seen = new Set((thread.messages || []).map((item) => item.id));
      thread = {
        ...older,
        messages: [...older.messages.filter((item) => !seen.has(item.id)), ...(thread.messages || [])],
        conversation: thread.conversation || older.conversation,
        canPost: thread.canPost,
      };
      render({ stickToBottom: false });
    } catch (error) {
      toast(error.message || "Older messages could not be loaded.", { type: "error" });
      button.disabled = false;
    }
  });

  on(root, "submit", async (event) => {
    if (event.target.matches("[data-message-start]")) {
      event.preventDefault();
      const field = event.target.elements.namedItem("memberId");
      const memberId = field && "value" in field ? field.value : "";
      if (!memberId) return;
      const submit = event.target.querySelector("[type='submit']");
      setButtonLoading(submit, true);
      try {
        const conversation = await openDirectConversation(memberId);
        setThreadId(conversation.id);
        await load();
        render();
      } catch (error) {
        toast(error.message || "That person cannot be messaged.", { type: "error" });
        setButtonLoading(submit, false);
      }
      return;
    }

    if (!event.target.matches("[data-message-form]")) return;
    event.preventDefault();
    await sendFromForm(event.target);
  });
}

async function sendFromForm(form) {
  const bodyField = form.elements.namedItem("body");
  const conversationField = form.elements.namedItem("conversationId");
  const body = bodyField && "value" in bodyField ? bodyField.value.trim() : "";
  const conversationId = conversationField && "value" in conversationField ? conversationField.value : selectedId;
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  try {
    await sendConversationMessage({ conversationId, body }, session);
    toast("Message sent.", { type: "success" });
    await load();
    render();
  } catch (error) {
    toast(error.message || "The message could not be sent.", { type: "error" });
    setButtonLoading(submit, false);
  }
}
