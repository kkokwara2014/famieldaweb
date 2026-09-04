import { bindDropdownDocument, initDropdowns } from "./dropdown.js";
import { initTabs } from "./tabs.js";

export function initUiSystem(root = document) {
  bindDropdownDocument();
  initDropdowns(root);
  initTabs(root);

  root.querySelectorAll("[data-alert-dismiss]").forEach((button) => {
    if (button.dataset.uiReady === "true") return;
    button.dataset.uiReady = "true";
    button.addEventListener("click", () => {
      button.closest(".alert")?.setAttribute("hidden", "");
    });
  });
}
