import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { VERIFICATION_STATUS } from "../config/constants.js";
import { isProfessionalRole } from "../config/roles.js";
import { go, homeFor } from "../config/routes.js";
import {
  VERIFICATION_DOC_KIND_OPTIONS,
  VERIFICATION_FLOW,
  verificationBanner,
  verificationStatusBadge,
  verificationStatusLabel,
} from "../config/verification.js";
import { emptyState } from "../components/empty-state.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { confirmDialog } from "../components/modal.js";
import {
  addVerificationDocument,
  downloadVerificationFile,
  getMyVerification,
  removeVerificationDocument,
  saveVerificationProfile,
  submitMyVerification,
} from "../services/verification-service.js";

const session = await bootApp({ page: "verification", title: "Verification" });
let current = null;
if (!isProfessionalRole(session.role)) {
  go(homeFor(session));
} else {
  bindPage();
  await renderVerification();
}

function bindPage() {
  const root = qs("[data-app-page]");

  on(qs("[data-verify-profile-form]"), "submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      current = await saveVerificationProfile({
        licenseNumber: form.licenseNumber.value,
        licenseState: form.licenseState.value,
        licenseExpiresAt: form.licenseExpiresAt.value,
        issuer: form.issuer.value,
        notes: form.notes.value,
      }, session);
      toast("Credential saved.", { type: "success" });
      renderVerification(current);
    } catch (error) {
      toast(error.message, { type: "error" });
    }
    setButtonLoading(submit, false);
  });

  on(qs("[data-verify-doc-form]"), "submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("[type='submit']");
    const file = form.file.files[0];
    setButtonLoading(submit, true);
    try {
      await addVerificationDocument({
        kind: form.kind.value,
        title: form.title.value,
        file,
      }, session);
      form.reset();
      toast("Document uploaded.", { type: "success" });
      await renderVerification();
    } catch (error) {
      toast(error.message, { type: "error" });
    }
    setButtonLoading(submit, false);
  });

  on(qs("[data-verify-submit]"), "click", async (event) => {
    const button = event.currentTarget;
    const confirmed = await confirmDialog({
      title: "Submit this file for review?",
      body: "An admin will see your identity document and credential. You can still work with households that already invited you.",
      confirmLabel: "Submit for review",
    });
    if (!confirmed) return;
    setButtonLoading(button, true);
    try {
      current = await submitMyVerification(session);
      toast("Submitted for review.", { type: "success" });
      renderVerification(current);
    } catch (error) {
      toast(error.message, { type: "error" });
    }
    setButtonLoading(button, false);
  });

  delegate(root, "click", "[data-remove-vdoc]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Remove this document?",
      body: "It will leave the verification file. You can upload another copy.",
      confirmLabel: "Remove document",
      danger: true,
    });
    if (!confirmed) return;
    setButtonLoading(button, true);
    try {
      await removeVerificationDocument(button.dataset.removeVdoc, session);
      toast("Document removed.", { type: "success" });
      await renderVerification();
    } catch (error) {
      toast(error.message, { type: "error" });
    }
    setButtonLoading(button, false);
  });

  delegate(root, "click", "[data-download-vdoc]", async (_event, button) => {
    try {
      const blob = await downloadVerificationFile(button.dataset.downloadVdoc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = button.dataset.fileName || "document";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error.message, { type: "error" });
    }
  });
}

async function renderVerification(record = null) {
  current = record || await getMyVerification(session);
  const status = current.status || VERIFICATION_STATUS.PENDING;
  const badge = qs("[data-verify-status]");
  badge.textContent = verificationStatusLabel(status);
  badge.className = `badge ${verificationStatusBadge(status)}`;

  qs("[data-verify-stepper]").innerHTML = VERIFICATION_FLOW.map((id, index) => {
    const currentIndex = VERIFICATION_FLOW.indexOf(status);
    const reached = status === VERIFICATION_STATUS.VERIFIED
      || (currentIndex >= 0 && index <= currentIndex)
      || (status === VERIFICATION_STATUS.REJECTED && index === 0)
      || (status === VERIFICATION_STATUS.SUSPENDED && index <= 2 && current.previousStatus === VERIFICATION_STATUS.VERIFIED);
    const active = id === status || (status === VERIFICATION_STATUS.SUSPENDED && id === VERIFICATION_STATUS.VERIFIED);
    return `
      <li class="verify-step${reached ? " is-complete" : ""}${active ? " is-active" : ""}">
        <span class="verify-step__mark">${index + 1}</span>
        <span>${escapeHtml(verificationStatusLabel(id))}</span>
      </li>
    `;
  }).join("");

  const banner = verificationBanner(status);
  const extra = current.reviewNotes
    ? `<p class="person__meta">Reviewer note: ${escapeHtml(current.reviewNotes)}</p>`
    : "";
  qs("[data-verify-banner]").innerHTML = `
    <div class="alert alert--${banner.tone === "error" ? "error" : banner.tone === "success" ? "success" : banner.tone === "info" ? "info" : "warning"}">
      <strong>${escapeHtml(banner.title)}</strong>
      <p>${escapeHtml(banner.body)}</p>
      ${extra}
    </div>
  `;

  const form = qs("[data-verify-profile-form]");
  form.licenseNumber.value = current.licenseNumber || "";
  form.licenseState.value = current.licenseState || "";
  form.licenseExpiresAt.value = current.licenseExpiresAt || "";
  form.issuer.value = current.issuer || "";
  form.notes.value = current.notes || "";
  [...form.elements].forEach((el) => {
    if (el.name) el.disabled = !current.canEdit;
  });
  form.querySelector("[type='submit']").hidden = !current.canEdit;

  const kindSelect = qs("[name='kind']");
  kindSelect.innerHTML = VERIFICATION_DOC_KIND_OPTIONS.map((item) => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`
  )).join("");
  qs("[data-verify-doc-form]").hidden = !current.canEdit;

  const docs = current.documents || [];
  qs("[data-verify-docs]").innerHTML = docs.length
    ? `<ul class="list">${docs.map(documentItem).join("")}</ul>`
    : emptyState({
      title: "No documents yet",
      body: "Upload an identity document and a license or certification.",
      compact: true,
    });

  const missing = current.requirements?.missing || [];
  qs("[data-verify-requirements]").textContent = missing.length
    ? missing.join(" ")
    : current.canSubmit
      ? "Ready to submit. An admin will move this file to Under review."
      : status === VERIFICATION_STATUS.UNDER_REVIEW
        ? "This file is with an admin. You can still add a clearer document if needed."
        : status === VERIFICATION_STATUS.VERIFIED
          ? "You’re verified. Upload a renewed card when this one expires."
          : status === VERIFICATION_STATUS.SUSPENDED
            ? "New visits cannot be accepted until an admin restores this file."
            : "Save your credential and documents, then submit.";

  const submit = qs("[data-verify-submit]");
  submit.disabled = !current.canSubmit;
  submit.hidden = !canShowSubmit(status);
}

function canShowSubmit(status) {
  return status === VERIFICATION_STATUS.PENDING || status === VERIFICATION_STATUS.REJECTED;
}

function documentItem(doc) {
  const actions = [
    doc.canDownload ? `<button class="btn btn--ghost btn--sm" type="button" data-download-vdoc="${escapeHtml(doc.storagePath)}" data-file-name="${escapeHtml(doc.fileName)}">Download</button>` : "",
    doc.canDelete ? `<button class="btn btn--ghost btn--sm" type="button" data-remove-vdoc="${escapeHtml(doc.id)}">Remove</button>` : "",
  ].filter(Boolean).join("");
  return `
    <li class="list__item">
      <div>
        <div class="hub-task__title">
          <strong>${escapeHtml(doc.title || doc.fileName)}</strong>
          <span class="badge badge--neutral">${escapeHtml(doc.kindLabel)}</span>
        </div>
        <p class="person__meta">${[
          doc.fileName,
          doc.sizeLabel,
          doc.uploadedLabel,
          doc.isLocal ? "Demo file" : "",
        ].filter(Boolean).join(" · ")}</p>
      </div>
      ${actions ? `<div class="hub-task__aside">${actions}</div>` : ""}
    </li>
  `;
}
