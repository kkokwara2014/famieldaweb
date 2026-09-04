function closeAll(except) {
  document.querySelectorAll("[data-dropdown].is-open").forEach((dropdown) => {
    if (dropdown === except) return;
    dropdown.classList.remove("is-open");
    const trigger = dropdown.querySelector("[data-dropdown-trigger]");
    const menu = dropdown.querySelector("[data-dropdown-menu]");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  });
}

export function toggleDropdown(dropdown, open) {
  const trigger = dropdown.querySelector("[data-dropdown-trigger]");
  const menu = dropdown.querySelector("[data-dropdown-menu]");
  if (!trigger || !menu) return;
  const next = open ?? !dropdown.classList.contains("is-open");
  if (next) closeAll(dropdown);
  dropdown.classList.toggle("is-open", next);
  trigger.setAttribute("aria-expanded", String(next));
  menu.hidden = !next;
}

export function initDropdowns(root = document) {
  root.querySelectorAll("[data-dropdown]").forEach((dropdown) => {
    if (dropdown.dataset.uiReady === "true") return;
    dropdown.dataset.uiReady = "true";

    const trigger = dropdown.querySelector("[data-dropdown-trigger]");
    const menu = dropdown.querySelector("[data-dropdown-menu]");
    if (!trigger || !menu) return;

    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    menu.hidden = true;

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDropdown(dropdown);
    });
  });
}

let documentBound = false;

export function bindDropdownDocument() {
  if (documentBound) return;
  documentBound = true;

  document.addEventListener("click", () => closeAll());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
}
