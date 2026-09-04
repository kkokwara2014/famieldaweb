import { mountPublicNav } from "../components/navbar.js";
import { mountPublicFooter } from "../components/footer.js";
import { initUiSystem } from "../components/ui-system.js";
import { toast } from "../components/toast.js";
import { confirmDialog, bindModal, openModal } from "../components/modal.js";
import { setButtonLoading } from "../components/loader.js";
import { on, delegate } from "../core/events.js";
import { initMonitoring } from "../observability/monitor.js";

initMonitoring();

mountPublicNav();
mountPublicFooter();
initUiSystem();
bindModal("sample");

delegate(document, "click", "[data-toast]", (_event, button) => {
  toast(button.dataset.message || "Saved to the workspace.", { type: button.dataset.toast });
});

on("[data-confirm-demo]", "click", async () => {
  const confirmed = await confirmDialog({
    title: "Remove this visit?",
    body: "The rest of the circle will no longer see it on the shared week.",
    confirmLabel: "Remove visit",
    cancelLabel: "Keep visit",
    danger: true,
  });
  toast(confirmed ? "Visit removed from the week." : "No change was made.", {
    type: confirmed ? "success" : "info",
  });
});

on("[data-open-sample-modal]", "click", () => openModal("sample"));

on("[data-loading-demo]", "click", (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true);
  window.setTimeout(() => setButtonLoading(button, false), 1400);
});
