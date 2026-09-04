export function selectTab(tabs, id) {
  tabs.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  tabs.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== id;
  });

  tabs.dispatchEvent(new CustomEvent("tabchange", { detail: { id }, bubbles: true }));
}

export function initTabs(root = document) {
  root.querySelectorAll("[data-tabs]").forEach((tabs) => {
    if (tabs.dataset.uiReady === "true") return;
    tabs.dataset.uiReady = "true";

    tabs.querySelectorAll("[data-tab]").forEach((button) => {
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => selectTab(tabs, button.dataset.tab));
    });
  });
}
