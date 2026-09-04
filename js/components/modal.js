import { escapeHtml } from "../core/dom.js";
import { setButtonLoading } from "./loader.js";

let activeDialog = null;

const DIALOG_ICONS = {
  signout: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  warning: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4.5"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/><path d="M10.2 4.8 2.6 18.2A2 2 0 0 0 4.4 21h15.2a2 2 0 0 0 1.8-2.8L13.8 4.8a2 2 0 0 0-3.6 0Z"/></svg>',
  question: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.4 2.4 0 1 1 2.6 2.4v1.2"/><circle cx="12" cy="16.6" r="0.8" fill="currentColor" stroke="none"/></svg>',
};

function dialogIcon(icon, danger) {
  if (icon && DIALOG_ICONS[icon]) return DIALOG_ICONS[icon];
  return danger ? DIALOG_ICONS.warning : DIALOG_ICONS.question;
}

export function openModal(id) {
  const modal = document.querySelector(`[data-modal="${id}"]`);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

export function closeModal(id) {
  const modal = document.querySelector(`[data-modal="${id}"]`);
  if (!modal) return;
  modal.hidden = true;
  if (!document.querySelector(".modal:not([hidden])")) {
    document.body.classList.remove("modal-open");
  }
}

export function bindModal(id) {
  const modal = document.querySelector(`[data-modal="${id}"]`);
  if (!modal) return;
  modal.addEventListener("click", (event) => {
    const closer = event.target.closest("[data-close-modal]");
    if (!closer || closer.classList.contains("modal__backdrop")) return;
    if (!closer.closest(".modal__panel")) return;
    closeModal(id);
  });
}

export function confirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  icon = "",
  kicker = "",
  onConfirm = null,
} = {}) {
  return new Promise((resolve) => {
    dismissActive();

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.dataset.modal = "confirm";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "confirm-dialog-title");
    modal.setAttribute("aria-describedby", "confirm-dialog-body");

    const markClass = `confirm-dialog__mark${danger ? " confirm-dialog__mark--danger" : ""}`;
    modal.innerHTML = `
      <div class="modal__backdrop"></div>
      <div class="modal__panel confirm-dialog" role="document">
        <button type="button" class="modal__dismiss" data-close-modal aria-label="Close dialog">✕</button>
        <div class="${markClass}" aria-hidden="true">${dialogIcon(icon, danger)}</div>
        ${kicker ? `<p class="confirm-dialog__kicker">${escapeHtml(kicker)}</p>` : ""}
        <h2 id="confirm-dialog-title">${escapeHtml(title)}</h2>
        <p id="confirm-dialog-body" class="modal__body">${escapeHtml(body)}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" data-close-modal>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? "btn--danger" : "btn--primary"}" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const previousFocus = document.activeElement;
    const confirmBtn = () => modal.querySelector("[data-confirm]");
    const cancelButtons = () => [...modal.querySelectorAll("[data-close-modal]")];
    let busy = false;

    const finish = (value) => {
      if (activeDialog !== modal || busy) return;
      activeDialog = null;
      modal.classList.remove("is-open");
      modal.remove();
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      }
      resolve(value);
    };

    const onKey = (event) => {
      if (busy && event.key !== "Tab") {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...modal.querySelectorAll("button:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const runConfirm = async () => {
      if (busy) return;
      if (typeof onConfirm !== "function") {
        finish(true);
        return;
      }

      busy = true;
      const action = confirmBtn();
      cancelButtons().forEach((button) => {
        button.disabled = true;
      });
      setButtonLoading(action, true);
      try {
        await onConfirm();
        busy = false;
        finish(true);
      } catch (error) {
        busy = false;
        cancelButtons().forEach((button) => {
          button.disabled = false;
        });
        setButtonLoading(action, false);
        throw error;
      }
    };

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-confirm]")) {
        runConfirm().catch(() => {});
        return;
      }
      if (event.target.closest("[data-close-modal]")) {
        finish(false);
      }
    });

    document.addEventListener("keydown", onKey);
    document.body.append(modal);
    document.body.classList.add("modal-open");
    activeDialog = modal;
    requestAnimationFrame(() => modal.classList.add("is-open"));
    modal.querySelector(".modal__actions [data-close-modal]")?.focus();
  });
}

export function promptDialog({
  title,
  body,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  label = "Notes",
  placeholder = "",
  required = false,
} = {}) {
  return new Promise((resolve) => {
    dismissActive();

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.dataset.modal = "prompt";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "prompt-dialog-title");

    modal.innerHTML = `
      <div class="modal__backdrop"></div>
      <div class="modal__panel confirm-dialog" role="document">
        <button type="button" class="modal__dismiss" data-close-modal aria-label="Close dialog">✕</button>
        <h2 id="prompt-dialog-title">${escapeHtml(title)}</h2>
        ${body ? `<p class="modal__body">${escapeHtml(body)}</p>` : ""}
        <form class="form" data-prompt-form>
          <div class="field">
            <label for="prompt-dialog-input">${escapeHtml(label)}</label>
            <textarea id="prompt-dialog-input" name="value" rows="3" ${required ? "required" : ""} placeholder="${escapeHtml(placeholder)}"></textarea>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn btn--ghost" data-close-modal>${escapeHtml(cancelLabel)}</button>
            <button type="submit" class="btn btn--primary">${escapeHtml(confirmLabel)}</button>
          </div>
        </form>
      </div>
    `;

    const previousFocus = document.activeElement;
    const input = () => modal.querySelector("#prompt-dialog-input");
    const finish = (value) => {
      if (activeDialog !== modal) return;
      activeDialog = null;
      modal.remove();
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      }
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key !== "Tab") return;
      const focusable = [...modal.querySelectorAll("button:not([disabled]), textarea, input")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-modal]")) finish(null);
    });
    modal.querySelector("[data-prompt-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input()?.value.trim() ?? "";
      if (required && !value) return;
      finish(value);
    });

    document.addEventListener("keydown", onKey);
    document.body.append(modal);
    document.body.classList.add("modal-open");
    activeDialog = modal;
    input()?.focus();
  });
}

function dismissActive() {
  if (!activeDialog) return;
  activeDialog.remove();
  document.body.classList.remove("modal-open");
  activeDialog = null;
}
