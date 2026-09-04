import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { debounce } from "../core/debounce.js";
import { DEBOUNCE_MS } from "../config/performance.js";
import { initFormUx } from "../core/forms.js";
import { compressImageFile } from "../core/photo.js";
import { avatarHtml } from "../components/avatar.js";
import { emptyState } from "../components/empty-state.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { bindModal, closeModal, openModal, confirmDialog, promptDialog } from "../components/modal.js";
import { initTabs, selectTab } from "../components/tabs.js";
import {
  SENIOR_BLOOD_TYPES,
  SENIOR_COMMUNICATION,
  SENIOR_DIETS,
  SENIOR_GENDERS,
  SENIOR_LANGUAGES,
  SENIOR_MOBILITY,
  formatSeniorAge,
  formatSeniorDate,
  optionLabel,
} from "../config/senior.js";
import {
  currentSeniorSection,
  seniorHubCrumbs,
  seniorHubHref,
  seniorHubTitle,
} from "../config/senior-hub.js";
import { focusDeepLink } from "../notifications/deep-link.js";
import {
  createSeniorProfile,
  getSeniorForUser,
  saveEmergencyContacts,
  saveSeniorPhoto,
  updateSeniorProfile,
} from "../services/senior-service.js";
import { getSeniorHub } from "../services/senior-hub-service.js";
import { openDirectConversation, sendConversationMessage } from "../services/message-service.js";
import {
  assignCarePlanTask,
  addCareTaskNote,
  completeCarePlanTask,
  createCarePlanForSenior,
  skipCarePlanTask,
  updateCarePlanRecord,
} from "../services/care-plan-service.js";
import {
  cancelAppointment,
  saveAppointment,
  updateAppointmentStatus,
} from "../services/appointment-service.js";
import {
  logMedicationDose,
  saveMedication,
  updateMedicationStatus,
} from "../services/medication-service.js";
import {
  deleteDocument,
  getDocumentBlob,
  saveDocument,
} from "../services/document-service.js";
import { addCareHistoryNote } from "../services/care-history-service.js";
import { rebuildReports } from "../services/reports-service.js";
import { CARE_HISTORY_FILTERS, CARE_HISTORY_PLUS_MESSAGE } from "../config/care-history.js";
import {
  downloadTextFile,
  printCareReport,
  reportsFileStem,
  REPORTS_PLUS_MESSAGE,
} from "../config/reports.js";
import {
  CARE_PLAN_STATUS_OPTIONS,
  CARE_TASK_CATEGORY_OPTIONS,
  CARE_TASK_FREQUENCY_OPTIONS,
  CARE_TASK_PRIORITY_OPTIONS,
  CARE_TASK_WEEKDAY_OPTIONS,
  optionHtml,
} from "../config/care-plan.js";
import {
  APPOINTMENT_REMINDER_OPTIONS,
  APPOINTMENT_STATUS_EDIT_OPTIONS,
  monthGrid,
  optionHtml as appointmentOptionHtml,
  shiftYearMonth,
  yearMonthOf,
} from "../config/appointment.js";
import {
  MEDICATION_FREQUENCY_OPTIONS,
  MEDICATION_REMINDER_OPTIONS,
  MEDICATION_WEEKDAY_OPTIONS,
  optionHtml as medicationOptionHtml,
} from "../config/medication.js";
import {
  DOCUMENT_CATEGORY_OPTIONS,
  DOCUMENT_PLUS_MESSAGE,
  DOCUMENT_STATUS_OPTIONS,
  DOCUMENT_VISIBILITY_OPTIONS,
  defaultVisibilityFor,
  optionHtml as documentOptionHtml,
} from "../config/document.js";
import { CirclePlanError } from "../config/care-circle.js";
import { APPOINTMENT_STATUS, MEDICATION_DOSE_OUTCOME, MEDICATION_STATUS } from "../config/constants.js";
import { todayIso } from "../scheduling/time.js";
import { hubNavHtml, overviewSnapshotHtml, renderHubSection, reportPrintHtml } from "./senior-hub-views.js";

const section = currentSeniorSection();
const session = await bootApp({
  page: "senior",
  title: seniorHubTitle(section),
  crumbs: seniorHubCrumbs(section),
});
const root = qs("[data-senior-page]");
const photoInput = qs("#senior-photo-file");
const contactForm = qs("[data-contact-form]");
const contactError = qs("#contact-error");
const planForm = qs("[data-plan-form]");
const planError = qs("#care-plan-error");
const taskForm = qs("[data-task-form]");
const taskError = qs("#care-task-error");
const appointmentForm = qs("[data-appointment-form]");
const appointmentError = qs("#appointment-error");
const medicationForm = qs("[data-medication-form]");
const medicationError = qs("#medication-error");
const documentForm = qs("[data-document-form]");
const documentError = qs("#document-error");
const historyNoteForm = qs("[data-history-note-form]");
const historyNoteError = qs("#history-note-error");

let senior = await getSeniorForUser(session);
let hub = null;
let mode = readMode(Boolean(senior));
let pendingPhotoURL = senior?.photoURL ?? null;
let contactSeq = 0;
let appointmentMonth = yearMonthOf();
let appointmentDay = todayIso();
let historyFilter = "all";
let historyQuery = "";
let reportsRange = "7d";
let reportsTab = "caregivers";
let previewObjectUrl = "";
let previewDocumentId = "";
let visibilityTouched = false;

if (senior) {
  hub = await getSeniorHub(senior);
}

syncShellHeading(section, mode);

bindModal("contact");
bindModal("care-plan");
bindModal("care-task");
bindModal("appointment");
bindModal("medication");
bindModal("document");
bindModal("document-preview");
bindModal("history-note");
bindModal("upgrade");
bindPage();
fillPlanOptions();
fillAppointmentOptions();
fillMedicationOptions();
fillDocumentOptions();
render();

function syncShellHeading(current = currentSeniorSection(), nextMode = mode) {
  const title = seniorHubTitle(current, nextMode);
  document.title = `${title} — Famielda`;
  const heading = qs(".app-topbar h1");
  if (heading) heading.textContent = title;
}

function readMode(hasSenior) {
  const requested = new URLSearchParams(window.location.search).get("mode");
  if (!hasSenior) return "create";
  return requested === "edit" ? "edit" : "view";
}

function setMode(next) {
  mode = next;
  const url = next === "view"
    ? seniorHubHref("overview")
    : seniorHubHref("overview", { mode: next, hash: window.location.hash || "" });
  history.replaceState({}, "", url);
  syncShellHeading(currentSeniorSection(), next);
}

function render() {
  if (mode === "create" || mode === "edit") {
    renderForm();
  } else if (senior && currentSeniorSection().id !== "overview") {
    syncAppointmentCalendar();
    root.innerHTML = renderHubSection(currentSeniorSection(), { senior, hub });
  } else {
    renderView();
  }
  initFormUx(root);
  initTabs(root);
  restoreHistoryToolbar();
  applyHistoryFilters();
  restoreReportsToolbar();
  if (window.location.hash) {
    window.requestAnimationFrame(() => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
    });
  }
  window.requestAnimationFrame(() => focusDeepLink(root));
}

function bindPage() {
  delegate(root, "click", "[data-edit-profile]", (_event, button) => {
    pendingPhotoURL = senior?.photoURL ?? null;
    const section = button.dataset.editSection;
    setMode("edit");
    if (section) {
      history.replaceState({}, "", `${seniorHubHref("overview", { mode: "edit" })}#${section}`);
    }
    render();
  });

  delegate(root, "click", "[data-cancel-edit]", () => {
    if (!senior) return;
    pendingPhotoURL = senior.photoURL;
    setMode("view");
    render();
  });

  delegate(root, "click", "[data-change-photo]", () => photoInput?.click());

  delegate(root, "click", "[data-add-contact-row]", () => {
    const list = qs("[data-contact-list]", root);
    if (!list) return;
    list.insertAdjacentHTML("beforeend", contactRowHtml());
    initFormUx(list);
  });

  delegate(root, "click", "[data-remove-contact-row]", (_event, button) => {
    button.closest("[data-contact-row]")?.remove();
  });

  delegate(root, "click", "[data-add-contact]", () => openContactEditor());

  delegate(root, "click", "[data-edit-contact]", (_event, button) => {
    const contact = senior?.emergencyContacts.find((item) => item.id === button.dataset.editContact);
    if (contact) openContactEditor(contact);
  });

  delegate(root, "click", "[data-remove-contact]", async (_event, button) => {
    const contact = senior?.emergencyContacts.find((item) => item.id === button.dataset.removeContact);
    if (!contact || !senior) return;
    const confirmed = await confirmDialog({
      title: `Remove ${contact.name}?`,
      body: "This person will no longer appear as an emergency contact on the senior profile.",
      confirmLabel: "Remove contact",
      cancelLabel: "Keep contact",
      danger: true,
    });
    if (!confirmed) return;
    try {
      senior = await saveEmergencyContacts(
        senior.id,
        senior.emergencyContacts.filter((item) => item.id !== contact.id),
      );
      toast(`${contact.name} was removed.`, { type: "success" });
      hub = await getSeniorHub(senior);
      render();
    } catch (error) {
      toast(error.message, { type: "error" });
    }
  });

  on(root, "submit", async (event) => {
    if (!event.target.matches("[data-senior-form]")) return;
    event.preventDefault();
    await saveProfile(event.target);
  });

  on(photoInput, "change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const dataUrl = await compressImageFile(file);
      pendingPhotoURL = dataUrl;

      if (mode === "view" && senior) {
        senior = await saveSeniorPhoto(senior.id, dataUrl);
        toast("Profile picture updated.", { type: "success" });
        hub = await getSeniorHub(senior);
        render();
        return;
      }

      const preview = qs("[data-photo-preview]", root);
      const name = qs("[name='displayName']", root)?.value || senior?.displayName || "Senior";
      if (preview) preview.innerHTML = avatarHtml(name, dataUrl, { size: "xl" });
      const badge = qs(".profile-photo__badge", root);
      if (badge) badge.textContent = "Change";
      toast("Photo ready. Save the profile to keep it.", { type: "info" });
    } catch (error) {
      toast(error.message, { type: "error" });
    }
  });

  on(contactForm, "submit", async (event) => {
    event.preventDefault();
    await saveContact(event.currentTarget);
  });

  on(root, "submit", async (event) => {
    if (event.target.matches("[data-message-start]")) {
      event.preventDefault();
      await startDirectThread(event.target);
      return;
    }
    if (!event.target.matches("[data-message-form]")) return;
    event.preventDefault();
    await sendMessage(event.target);
  });

  delegate(root, "click", "[data-open-thread]", async (event, link) => {
    event.preventDefault();
    const params = new URLSearchParams(window.location.search);
    params.set("section", "messages");
    params.set("thread", link.dataset.openThread);
    history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    hub = await getSeniorHub(senior);
    render();
  });

  delegate(root, "click", "[data-create-plan]", () => openPlanEditor());
  delegate(root, "click", "[data-edit-plan]", (_event, button) => {
    const plan = hub?.carePlan?.find((item) => item.id === button.dataset.editPlan);
    if (plan) openPlanEditor(plan);
  });
  delegate(root, "click", "[data-create-task]", () => openTaskEditor({ planId: hub?.carePlan?.[0]?.id || "" }));
  delegate(root, "click", "[data-add-task]", (_event, button) => openTaskEditor({ planId: button.dataset.addTask }));
  delegate(root, "click", "[data-edit-task]", (_event, button) => {
    const task = hub?.careTasks?.find((item) => item.id === button.dataset.editTask);
    if (task) openTaskEditor(task);
  });
  delegate(root, "click", "[data-complete-task]", async (_event, button) => {
    const notes = await promptDialog({
      title: "Mark this task done?",
      body: "Add a short note for the circle if anything is worth recording.",
      confirmLabel: "Mark done",
      label: "Completion notes",
      placeholder: "Taken with tea. No rush.",
    });
    if (notes == null) return;
    await runCareAction(button, () => completeCarePlanTask(button.dataset.completeTask, { notes }), "Marked done.");
  });
  delegate(root, "click", "[data-skip-task]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Skip this task?",
      body: "It will be recorded as skipped for this due date.",
      confirmLabel: "Skip task",
      danger: true,
    });
    if (!confirmed) return;
    await runCareAction(button, () => skipCarePlanTask(button.dataset.skipTask), "Task skipped.");
  });
  delegate(root, "click", "[data-note-task]", async (_event, button) => {
    const notes = await promptDialog({
      title: "Add a note",
      body: "This stays on the task for the rest of the circle.",
      confirmLabel: "Save note",
      label: "Note",
      placeholder: "Pharmacy said the refill will be ready Wednesday.",
      required: true,
    });
    if (notes == null) return;
    await runCareAction(button, () => addCareTaskNote(button.dataset.noteTask, notes), "Note saved.");
  });

  delegate(root, "click", "[data-create-appointment]", () => openAppointmentEditor());
  delegate(root, "click", "[data-edit-appointment]", (_event, button) => {
    const appointment = findAppointment(button.dataset.editAppointment);
    if (appointment) openAppointmentEditor(appointment);
  });
  delegate(root, "click", "[data-cancel-appointment]", async (_event, button) => {
    const appointment = findAppointment(button.dataset.cancelAppointment);
    if (!appointment) return;
    const reason = await promptDialog({
      title: `Cancel ${appointment.title}?`,
      body: "The circle will still see it as cancelled. Add a reason if that helps.",
      confirmLabel: "Cancel appointment",
      label: "Reason (optional)",
      placeholder: "Overlaps with rest after cardiology.",
      danger: true,
    });
    if (reason == null) return;
    await runCareAction(button, () => cancelAppointment(appointment.id, reason), "Appointment cancelled.");
  });
  delegate(root, "click", "[data-confirm-appointment]", async (_event, button) => {
    await runCareAction(
      button,
      () => updateAppointmentStatus(button.dataset.confirmAppointment, APPOINTMENT_STATUS.CONFIRMED),
      "Appointment confirmed.",
    );
  });
  delegate(root, "click", "[data-complete-appointment]", async (_event, button) => {
    await runCareAction(
      button,
      () => updateAppointmentStatus(button.dataset.completeAppointment, APPOINTMENT_STATUS.COMPLETED),
      "Appointment marked done.",
    );
  });
  delegate(root, "click", "[data-calendar-prev]", () => shiftAppointmentMonth(-1));
  delegate(root, "click", "[data-calendar-next]", () => shiftAppointmentMonth(1));
  delegate(root, "click", "[data-calendar-day]", (_event, button) => {
    appointmentDay = button.dataset.calendarDay;
    render();
  });

  if (planForm) {
    on(planForm, "submit", async (event) => {
      event.preventDefault();
      await savePlan(event.currentTarget);
    });
  }

  if (taskForm) {
    on(taskForm, "submit", async (event) => {
      event.preventDefault();
      await saveTask(event.currentTarget);
    });
    on(taskForm, "change", (event) => {
      if (event.target.name === "frequency") syncTaskFrequencyFields();
    });
  }

  if (appointmentForm) {
    on(appointmentForm, "submit", async (event) => {
      event.preventDefault();
      await saveAppointmentForm(event.currentTarget);
    });
  }

  delegate(root, "click", "[data-create-medication]", () => openMedicationEditor());
  delegate(root, "click", "[data-edit-medication]", (_event, button) => {
    const medication = findMedication(button.dataset.editMedication);
    if (medication) openMedicationEditor(medication);
  });
  delegate(root, "click", "[data-log-medication]", async (_event, button) => {
    const medication = findMedication(button.dataset.logMedication);
    if (!medication) return;
    const outcome = button.dataset.logOutcome === "skipped"
      ? MEDICATION_DOSE_OUTCOME.SKIPPED
      : MEDICATION_DOSE_OUTCOME.TAKEN;
    const taken = outcome === MEDICATION_DOSE_OUTCOME.TAKEN;
    const notes = await promptDialog({
      title: taken ? `Log ${medication.name} as taken?` : `Skip ${medication.name}?`,
      body: taken
        ? "This records what the circle covered. It is not a clinical order."
        : "The skip stays on the history so the circle can see what changed.",
      confirmLabel: taken ? "Log taken" : "Skip dose",
      label: "Note (optional)",
      placeholder: taken ? "Taken with tea." : "Pharmacy bottle empty.",
      danger: !taken,
    });
    if (notes == null) return;
    await runCareAction(
      button,
      () => logMedicationDose(medication.id, {
        outcome,
        notes,
        date: button.dataset.logDate || medication.dueOpen?.[0]?.date || "",
        time: button.dataset.logTime || medication.dueOpen?.[0]?.time || medication.time,
      }),
      taken ? "Logged as taken." : "Logged as skipped.",
    );
  });
  delegate(root, "click", "[data-pause-medication]", async (_event, button) => {
    const medication = findMedication(button.dataset.pauseMedication);
    if (!medication) return;
    const confirmed = await confirmDialog({
      title: `Pause ${medication.name}?`,
      body: "It stays on the record but drops off today’s list until someone resumes it.",
      confirmLabel: "Pause medication",
    });
    if (!confirmed) return;
    await runCareAction(
      button,
      () => updateMedicationStatus(medication.id, MEDICATION_STATUS.PAUSED),
      "Medication paused.",
    );
  });
  delegate(root, "click", "[data-resume-medication]", async (_event, button) => {
    await runCareAction(
      button,
      () => updateMedicationStatus(button.dataset.resumeMedication, MEDICATION_STATUS.ACTIVE),
      "Medication resumed.",
    );
  });
  delegate(root, "click", "[data-end-medication]", async (_event, button) => {
    const medication = findMedication(button.dataset.endMedication);
    if (!medication) return;
    const confirmed = await confirmDialog({
      title: `End ${medication.name}?`,
      body: "The circle will keep it in history. This does not change a prescription — it only ends the shared list item.",
      confirmLabel: "End on the list",
      danger: true,
    });
    if (!confirmed) return;
    await runCareAction(
      button,
      () => updateMedicationStatus(medication.id, MEDICATION_STATUS.ENDED),
      "Medication ended on the list.",
    );
  });

  if (medicationForm) {
    on(medicationForm, "submit", async (event) => {
      event.preventDefault();
      await saveMedicationForm(event.currentTarget);
    });
    on(medicationForm, "change", (event) => {
      if (event.target.name === "frequency") syncMedicationFrequencyFields();
    });
  }

  delegate(root, "click", "[data-upload-document]", () => openDocumentEditor());
  delegate(root, "click", "[data-edit-document]", (_event, button) => {
    const doc = findDocument(button.dataset.editDocument);
    if (doc) openDocumentEditor(doc);
  });
  delegate(root, "click", "[data-preview-document]", (_event, button) => {
    openDocumentPreview(button.dataset.previewDocument);
  });
  delegate(root, "click", "[data-download-document]", (_event, button) => {
    downloadHouseholdDocument(button.dataset.downloadDocument, button);
  });
  delegate(root, "click", "[data-delete-document]", async (_event, button) => {
    const doc = findDocument(button.dataset.deleteDocument);
    if (!doc) return;
    const confirmed = await confirmDialog({
      title: `Remove ${doc.title}?`,
      body: "The private file and the record will be deleted. This cannot be undone.",
      confirmLabel: "Delete document",
      danger: true,
    });
    if (!confirmed) return;
    await runCareAction(button, () => deleteDocument(doc.id), "Document removed from the vault.");
  });

  if (documentForm) {
    on(documentForm, "submit", async (event) => {
      event.preventDefault();
      await saveDocumentForm(event.currentTarget);
    });
    on(documentForm, "change", (event) => {
      if (event.target.name === "file") syncDocumentFileHint(event.target.files?.[0]);
      if (event.target.name === "visibility") visibilityTouched = true;
      if (event.target.name === "category" && !visibilityTouched && !documentForm.elements.namedItem("documentId").value) {
        documentForm.elements.namedItem("visibility").innerHTML = documentOptionHtml(
          DOCUMENT_VISIBILITY_OPTIONS,
          defaultVisibilityFor(event.target.value),
        );
      }
    });
  }

  const previewDownload = qs("[data-document-preview-download]");
  if (previewDownload) {
    on(previewDownload, "click", () => {
      if (previewDocumentId) downloadHouseholdDocument(previewDocumentId, previewDownload);
    });
  }

  delegate(document, "click", "[data-modal='document-preview'] .modal__panel [data-close-modal]", () => {
    clearDocumentPreview();
  });

  delegate(root, "click", "[data-add-history-note]", () => {
    if (!hub?.history?.isPlus) {
      openUpgrade(CARE_HISTORY_PLUS_MESSAGE);
      return;
    }
    historyNoteForm?.reset();
    if (historyNoteError) historyNoteError.hidden = true;
    openModal("history-note");
    window.requestAnimationFrame(() => qs("#history-note-body")?.focus());
  });

  delegate(root, "click", "[data-history-filter]", (_event, button) => {
    historyFilter = button.dataset.historyFilter || "all";
    applyHistoryFilters();
  });

  delegate(root, "input", "[data-history-search]", debounce((_event, input) => {
    historyQuery = input.value || "";
    applyHistoryFilters();
  }, DEBOUNCE_MS.SEARCH));

  if (historyNoteForm) {
    on(historyNoteForm, "submit", async (event) => {
      event.preventDefault();
      await saveHistoryNote(event.currentTarget);
    });
  }

  delegate(root, "click", "[data-report-range]", (_event, button) => {
    reportsRange = button.dataset.reportRange || "7d";
    if (!hub?.reports) return;
    hub.reports = rebuildReports(hub.reports, reportsRange, session);
    render();
  });

  delegate(root, "click", "[data-export-report]", (_event, button) => {
    if (!hub?.reports?.isPlus) {
      openUpgrade(REPORTS_PLUS_MESSAGE);
      return;
    }
    exportCareReport(button.dataset.exportReport);
  });

  delegate(root, "tabchange", "[data-tabs]", (event) => {
    if (currentSeniorSection().id !== "reports") return;
    reportsTab = event.detail?.id || reportsTab;
  });
}

async function saveProfile(form) {
  const errorBox = qs("[data-form-error]", form);
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  const payload = collectPayload(form);
  if (!payload.displayName) {
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = "Enter the senior’s full name.";
    }
    toast("Enter the senior’s full name.", { type: "error" });
    return;
  }

  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);

  try {
    if (mode === "create" || !senior) {
      senior = await createSeniorProfile(payload, session);
      toast(`${senior.preferredName}’s profile is ready.`, { type: "success" });
    } else {
      senior = await updateSeniorProfile(senior.id, payload);
      toast("Senior profile updated.", { type: "success" });
    }
    pendingPhotoURL = senior.photoURL;
    hub = await getSeniorHub(senior);
    setMode("view");
    render();
  } catch (error) {
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    }
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

function openContactEditor(contact = null) {
  contactError.hidden = true;
  contactError.textContent = "";
  contactForm.reset();
  contactForm.elements.namedItem("contactId").value = contact?.id ?? "";
  contactForm.elements.namedItem("name").value = contact?.name ?? "";
  contactForm.elements.namedItem("relationship").value = contact?.relationship ?? "";
  contactForm.elements.namedItem("phone").value = contact?.phone ?? "";
  contactForm.elements.namedItem("email").value = contact?.email ?? "";
  contactForm.elements.namedItem("isPrimary").checked = Boolean(contact?.isPrimary);
  qs("#contact-title").textContent = contact ? "Edit emergency contact" : "Add emergency contact";
  openModal("contact");
}

async function saveContact(form) {
  if (!senior) return;
  contactError.hidden = true;
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);

  try {
    const next = {
      id: form.elements.namedItem("contactId").value,
      name: form.elements.namedItem("name").value.trim(),
      relationship: form.elements.namedItem("relationship").value.trim(),
      phone: form.elements.namedItem("phone").value.trim(),
      email: form.elements.namedItem("email").value.trim(),
      isPrimary: form.elements.namedItem("isPrimary").checked,
    };

    const existing = senior.emergencyContacts.filter((item) => item.id !== next.id);
    const contacts = next.isPrimary
      ? [...existing.map((item) => ({ ...item, isPrimary: false })), next]
      : [...existing, next];

    senior = await saveEmergencyContacts(senior.id, contacts);
    closeModal("contact");
    form.reset();
    toast(`${next.name} is on the emergency list.`, { type: "success" });
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    contactError.hidden = false;
    contactError.textContent = error.message;
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

async function sendMessage(form) {
  if (!senior) return;
  const field = form.elements.namedItem("body");
  const conversationField = form.elements.namedItem("conversationId");
  const body = field && "value" in field ? field.value.trim() : "";
  const conversationId = conversationField && "value" in conversationField ? conversationField.value : "";
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  try {
    await sendConversationMessage({ conversationId, body }, session);
    toast("Message sent.", { type: "success" });
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

async function startDirectThread(form) {
  const field = form.elements.namedItem("memberId");
  const memberId = field && "value" in field ? field.value : "";
  if (!memberId) return;
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  try {
    const conversation = await openDirectConversation(memberId, session);
    const params = new URLSearchParams(window.location.search);
    params.set("section", "messages");
    params.set("thread", conversation.id);
    history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    toast(error.message, { type: "error" });
    setButtonLoading(submit, false);
  }
}

function fillPlanOptions() {
  if (!planForm || !taskForm) return;
  planForm.elements.namedItem("status").innerHTML = optionHtml(CARE_PLAN_STATUS_OPTIONS, "active");
  taskForm.elements.namedItem("category").innerHTML = optionHtml(CARE_TASK_CATEGORY_OPTIONS, "other");
  taskForm.elements.namedItem("priority").innerHTML = optionHtml(CARE_TASK_PRIORITY_OPTIONS, "medium");
  taskForm.elements.namedItem("frequency").innerHTML = optionHtml(CARE_TASK_FREQUENCY_OPTIONS, "daily");
  taskForm.elements.namedItem("weekday").innerHTML = optionHtml(CARE_TASK_WEEKDAY_OPTIONS, String(new Date().getDay()));
}

function fillAssigneeOptions(selected = "") {
  const select = taskForm?.elements.namedItem("assignedCaregiverId");
  if (!select) return;
  const people = hub?.careAssignees ?? [];
  select.innerHTML = [
    `<option value="">Unassigned</option>`,
    ...people.map((person) => {
      const current = person.id === selected ? " selected" : "";
      return `<option value="${escapeHtml(person.id)}"${current}>${escapeHtml(person.label)}</option>`;
    }),
  ].join("");
}

function fillPlanSelect(selected = "") {
  const select = taskForm?.elements.namedItem("planId");
  if (!select) return;
  const plans = hub?.carePlan ?? [];
  select.innerHTML = plans.length
    ? plans.map((plan) => {
      const current = plan.id === selected ? " selected" : "";
      return `<option value="${escapeHtml(plan.id)}"${current}>${escapeHtml(plan.title)}</option>`;
    }).join("")
    : `<option value="">A new daily support plan will be created</option>`;
}

function openPlanEditor(plan = null) {
  if (!planForm) return;
  if (planError) {
    planError.hidden = true;
    planError.textContent = "";
  }
  planForm.reset();
  planForm.elements.namedItem("planId").value = plan?.id ?? "";
  planForm.elements.namedItem("title").value = plan?.title ?? "";
  planForm.elements.namedItem("goal").value = plan?.goal ?? "";
  planForm.elements.namedItem("notes").value = plan?.notes ?? "";
  planForm.elements.namedItem("status").innerHTML = optionHtml(CARE_PLAN_STATUS_OPTIONS, plan?.status ?? "active");
  planForm.elements.namedItem("startDate").value = plan?.startDate ?? todayIso();
  planForm.elements.namedItem("endDate").value = plan?.endDate ?? "";
  qs("#care-plan-title").textContent = plan ? "Update plan" : "Create plan";
  openModal("care-plan");
}

function openTaskEditor(task = {}) {
  if (!taskForm) return;
  if (taskError) {
    taskError.hidden = true;
    taskError.textContent = "";
  }
  taskForm.reset();
  fillPlanSelect(task.planId || hub?.carePlan?.[0]?.id || "");
  fillAssigneeOptions(task.assignedCaregiverId || "");
  taskForm.elements.namedItem("taskId").value = task.id ?? "";
  taskForm.elements.namedItem("title").value = task.title ?? "";
  taskForm.elements.namedItem("notes").value = task.notes ?? "";
  taskForm.elements.namedItem("category").innerHTML = optionHtml(CARE_TASK_CATEGORY_OPTIONS, task.category ?? "other");
  taskForm.elements.namedItem("priority").innerHTML = optionHtml(CARE_TASK_PRIORITY_OPTIONS, task.priority ?? "medium");
  taskForm.elements.namedItem("frequency").innerHTML = optionHtml(CARE_TASK_FREQUENCY_OPTIONS, task.frequency ?? "daily");
  taskForm.elements.namedItem("dueDate").value = task.dueDate ?? todayIso();
  taskForm.elements.namedItem("dueTime").value = task.dueTime ?? "";
  taskForm.elements.namedItem("repeatUntil").value = task.repeatUntil ?? "";
  taskForm.elements.namedItem("weekday").innerHTML = optionHtml(
    CARE_TASK_WEEKDAY_OPTIONS,
    task.weekday == null ? String(new Date().getDay()) : String(task.weekday),
  );
  qs("#care-task-title").textContent = task.id ? "Update task" : "Create task";
  syncTaskFrequencyFields();
  openModal("care-task");
}

function syncTaskFrequencyFields() {
  if (!taskForm) return;
  const frequency = taskForm.elements.namedItem("frequency")?.value;
  const weekdayField = qs("[data-weekday-field]");
  if (weekdayField) weekdayField.hidden = frequency !== "weekly";
  const untilField = qs("[data-repeat-until-field]");
  if (untilField) untilField.hidden = frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly";
  const due = taskForm.elements.namedItem("dueDate");
  if (due) due.required = frequency !== "as_needed";
}

async function savePlan(form) {
  if (!senior) return;
  if (planError) {
    planError.hidden = true;
    planError.textContent = "";
  }
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  const payload = {
    title: form.elements.namedItem("title").value,
    goal: form.elements.namedItem("goal").value,
    notes: form.elements.namedItem("notes").value,
    status: form.elements.namedItem("status").value,
    startDate: form.elements.namedItem("startDate").value,
    endDate: form.elements.namedItem("endDate").value,
  };
  const planId = form.elements.namedItem("planId").value;
  try {
    if (planId) {
      await updateCarePlanRecord(planId, payload);
      toast("Care plan updated.", { type: "success" });
    } else {
      await createCarePlanForSenior(payload);
      toast("Care plan created.", { type: "success" });
    }
    closeModal("care-plan");
    form.reset();
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    if (planError) {
      planError.hidden = false;
      planError.textContent = error.message;
    }
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

async function saveTask(form) {
  if (!senior) return;
  if (taskError) {
    taskError.hidden = true;
    taskError.textContent = "";
  }
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  try {
    await assignCarePlanTask({
      taskId: form.elements.namedItem("taskId").value,
      planId: form.elements.namedItem("planId").value,
      title: form.elements.namedItem("title").value,
      notes: form.elements.namedItem("notes").value,
      category: form.elements.namedItem("category").value,
      priority: form.elements.namedItem("priority").value,
      frequency: form.elements.namedItem("frequency").value,
      dueDate: form.elements.namedItem("dueDate").value,
      dueTime: form.elements.namedItem("dueTime").value,
      weekday: form.elements.namedItem("weekday").value,
      repeatUntil: form.elements.namedItem("repeatUntil").value,
      assignedCaregiverId: form.elements.namedItem("assignedCaregiverId").value,
    });
    closeModal("care-task");
    form.reset();
    toast("Task saved.", { type: "success" });
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    if (taskError) {
      taskError.hidden = false;
      taskError.textContent = error.message;
    }
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

function fillAppointmentOptions() {
  if (!appointmentForm) return;
  appointmentForm.elements.namedItem("status").innerHTML = appointmentOptionHtml(
    APPOINTMENT_STATUS_EDIT_OPTIONS,
    "scheduled",
  );
  appointmentForm.elements.namedItem("reminder").innerHTML = appointmentOptionHtml(
    APPOINTMENT_REMINDER_OPTIONS,
    "1day",
  );
}

function fillPractitionerOptions(selected = "") {
  const select = appointmentForm?.elements.namedItem("practitionerId");
  if (!select) return;
  const people = hub?.appointmentPractitioners ?? [];
  select.innerHTML = [
    `<option value="">No clinician linked</option>`,
    ...people.map((person) => {
      const current = person.id === selected ? " selected" : "";
      return `<option value="${escapeHtml(person.id)}"${current}>${escapeHtml(person.label)}</option>`;
    }),
  ].join("");
}

function findAppointment(id) {
  return (hub?.appointmentRecords || hub?.appointments || []).find((item) => item.id === id) ?? null;
}

function openAppointmentEditor(appointment = null) {
  if (!appointmentForm) return;
  if (appointmentError) {
    appointmentError.hidden = true;
    appointmentError.textContent = "";
  }
  appointmentForm.reset();
  fillPractitionerOptions(appointment?.practitionerId || "");
  appointmentForm.elements.namedItem("appointmentId").value = appointment?.id ?? "";
  appointmentForm.elements.namedItem("title").value = appointment?.title ?? "";
  appointmentForm.elements.namedItem("date").value = appointment?.date ?? appointmentDay ?? todayIso();
  appointmentForm.elements.namedItem("time").value = appointment?.time ?? "09:00";
  appointmentForm.elements.namedItem("endTime").value = appointment?.endTime ?? "";
  appointmentForm.elements.namedItem("location").value = appointment?.location ?? "";
  appointmentForm.elements.namedItem("notes").value = appointment?.notes ?? "";
  appointmentForm.elements.namedItem("status").innerHTML = appointmentOptionHtml(
    APPOINTMENT_STATUS_EDIT_OPTIONS,
    appointment?.status === APPOINTMENT_STATUS.CONFIRMED ? APPOINTMENT_STATUS.CONFIRMED : APPOINTMENT_STATUS.SCHEDULED,
  );
  appointmentForm.elements.namedItem("reminder").innerHTML = appointmentOptionHtml(
    APPOINTMENT_REMINDER_OPTIONS,
    appointment?.reminder ?? "1day",
  );
  qs("#appointment-title").textContent = appointment?.id ? "Edit appointment" : "Create appointment";
  openModal("appointment");
}

async function saveAppointmentForm(form) {
  if (!senior) return;
  if (appointmentError) {
    appointmentError.hidden = true;
    appointmentError.textContent = "";
  }
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  const editing = Boolean(form.elements.namedItem("appointmentId").value);
  try {
    const saved = await saveAppointment({
      appointmentId: form.elements.namedItem("appointmentId").value,
      title: form.elements.namedItem("title").value,
      date: form.elements.namedItem("date").value,
      time: form.elements.namedItem("time").value,
      endTime: form.elements.namedItem("endTime").value,
      location: form.elements.namedItem("location").value,
      notes: form.elements.namedItem("notes").value,
      status: form.elements.namedItem("status").value,
      reminder: form.elements.namedItem("reminder").value,
      practitionerId: form.elements.namedItem("practitionerId").value,
    });
    closeModal("appointment");
    form.reset();
    if (saved?.date) {
      appointmentDay = saved.date;
      appointmentMonth = yearMonthOf(saved.date);
    }
    toast(editing ? "Appointment updated." : "Appointment created.", { type: "success" });
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    if (appointmentError) {
      appointmentError.hidden = false;
      appointmentError.textContent = error.message;
    }
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

function fillMedicationOptions() {
  if (!medicationForm) return;
  medicationForm.elements.namedItem("frequency").innerHTML = medicationOptionHtml(
    MEDICATION_FREQUENCY_OPTIONS,
    "daily",
  );
  medicationForm.elements.namedItem("reminder").innerHTML = medicationOptionHtml(
    MEDICATION_REMINDER_OPTIONS,
    "15min",
  );
  medicationForm.elements.namedItem("weekday").innerHTML = medicationOptionHtml(
    MEDICATION_WEEKDAY_OPTIONS,
    String(new Date().getDay()),
  );
}

function fillDocumentOptions() {
  if (!documentForm) return;
  documentForm.elements.namedItem("category").innerHTML = documentOptionHtml(
    DOCUMENT_CATEGORY_OPTIONS,
    "other",
  );
  documentForm.elements.namedItem("visibility").innerHTML = documentOptionHtml(
    DOCUMENT_VISIBILITY_OPTIONS,
    defaultVisibilityFor("other"),
  );
  documentForm.elements.namedItem("status").innerHTML = documentOptionHtml(
    DOCUMENT_STATUS_OPTIONS,
    "on_file",
  );
}

function findDocument(id) {
  return (hub?.documents || []).find((item) => item.id === id) ?? null;
}

function openDocumentEditor(doc = null) {
  if (!hub?.documentPlus && hub?.canManageDocuments) {
    openUpgrade(DOCUMENT_PLUS_MESSAGE);
    return;
  }
  if (!documentForm) return;
  if (documentError) {
    documentError.hidden = true;
    documentError.textContent = "";
  }
  visibilityTouched = Boolean(doc);
  documentForm.reset();
  documentForm.elements.namedItem("documentId").value = doc?.id ?? "";
  documentForm.elements.namedItem("title").value = doc?.title ?? "";
  documentForm.elements.namedItem("notes").value = doc?.notes ?? "";
  documentForm.elements.namedItem("category").innerHTML = documentOptionHtml(
    DOCUMENT_CATEGORY_OPTIONS,
    doc?.category ?? "other",
  );
  documentForm.elements.namedItem("visibility").innerHTML = documentOptionHtml(
    DOCUMENT_VISIBILITY_OPTIONS,
    doc?.visibility ?? defaultVisibilityFor(doc?.category ?? "other"),
  );
  documentForm.elements.namedItem("status").innerHTML = documentOptionHtml(
    DOCUMENT_STATUS_OPTIONS,
    doc?.status ?? "on_file",
  );
  const fileInput = documentForm.elements.namedItem("file");
  if (fileInput) fileInput.required = !doc?.id;
  qs("#document-title").textContent = doc?.id ? "Update document" : "Upload document";
  syncDocumentFileHint(null, doc);
  openModal("document");
}

function syncDocumentFileHint(file, doc = findDocument(documentForm?.elements.namedItem("documentId")?.value)) {
  const hint = qs("[data-document-file-hint]");
  if (!hint) return;
  if (file) {
    hint.textContent = `${file.name} · ready to keep in the private vault.`;
    const title = documentForm?.elements.namedItem("title");
    if (title && !title.value.trim()) {
      title.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    }
    return;
  }
  if (doc?.fileName) {
    hint.textContent = `Current file: ${doc.fileName}. Choose a new file only if you are replacing it.`;
    return;
  }
  hint.textContent = "PDF, image, Word, or text. Up to 12 MB. Required for a new upload.";
}

async function saveDocumentForm(form) {
  if (!senior) return;
  if (documentError) {
    documentError.hidden = true;
    documentError.textContent = "";
  }
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  const editing = Boolean(form.elements.namedItem("documentId").value);
  try {
    const file = form.elements.namedItem("file")?.files?.[0] || null;
    await saveDocument({
      documentId: form.elements.namedItem("documentId").value,
      title: form.elements.namedItem("title").value,
      category: form.elements.namedItem("category").value,
      visibility: form.elements.namedItem("visibility").value,
      status: form.elements.namedItem("status").value,
      notes: form.elements.namedItem("notes").value,
      file,
    });
    closeModal("document");
    form.reset();
    toast(editing ? "Document updated." : "Document saved to the private vault.", { type: "success" });
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    if (error instanceof CirclePlanError && error.upgrade) {
      closeModal("document");
      openUpgrade(error.message);
      return;
    }
    if (documentError) {
      documentError.hidden = false;
      documentError.textContent = error.message;
    }
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

function clearDocumentPreview() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }
  previewDocumentId = "";
  const frame = qs("[data-document-preview-frame]");
  if (frame) frame.innerHTML = `<p class="person__meta">No file is attached yet.</p>`;
  const download = qs("[data-document-preview-download]");
  if (download) download.hidden = true;
}

async function openDocumentPreview(id) {
  if (!hub?.documentPlus) {
    openUpgrade(DOCUMENT_PLUS_MESSAGE);
    return;
  }
  const doc = findDocument(id);
  if (!doc) return;
  clearDocumentPreview();
  previewDocumentId = doc.id;
  qs("#document-preview-title").textContent = doc.title;
  const meta = qs("[data-document-preview-meta]");
  if (meta) {
    meta.textContent = [doc.categoryLabel, doc.visibilityLabel, doc.updatedLabel, doc.fileName].filter(Boolean).join(" · ");
  }
  const notes = qs("[data-document-preview-notes]");
  if (notes) {
    notes.textContent = doc.notes || "";
    notes.hidden = !doc.notes;
  }
  const errorBox = qs("#document-preview-error");
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
  const download = qs("[data-document-preview-download]");
  if (download) download.hidden = !doc.canDownload;
  const frame = qs("[data-document-preview-frame]");
  openModal("document-preview");

  if (!doc.hasFile) {
    if (frame) {
      frame.innerHTML = `<p class="person__meta">No file is attached yet. ${doc.canEdit ? "Edit this record to upload a private copy." : "The household has this paper on the list, but a file has not been uploaded."}</p>`;
    }
    return;
  }

  if (frame) {
    frame.innerHTML = `<p class="person__meta">Opening a private copy…</p>`;
  }

  try {
    const { blob } = await getDocumentBlob(doc.id);
    previewObjectUrl = URL.createObjectURL(blob);
    if (!frame) return;
    if (doc.isImage || String(blob.type).startsWith("image/")) {
      frame.innerHTML = `<img alt="${escapeHtml(doc.title)}" src="${previewObjectUrl}">`;
    } else if (doc.isPdf || blob.type === "application/pdf") {
      frame.innerHTML = `<iframe title="${escapeHtml(doc.title)}" src="${previewObjectUrl}"></iframe>`;
    } else {
      frame.innerHTML = `<p class="person__meta">This file type cannot be previewed in the hub. Download a private copy instead.</p>`;
    }
  } catch (error) {
    if (error instanceof CirclePlanError && error.upgrade) {
      closeModal("document-preview");
      openUpgrade(error.message);
      return;
    }
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    }
    if (frame) {
      frame.innerHTML = `<p class="person__meta">${escapeHtml(error.message || "This file could not be opened.")}</p>`;
    }
  }
}

async function downloadHouseholdDocument(id, button) {
  if (!hub?.documentPlus) {
    openUpgrade(DOCUMENT_PLUS_MESSAGE);
    return;
  }
  const doc = findDocument(id);
  if (!doc) return;
  if (button) setButtonLoading(button, true);
  try {
    const { blob, document: record } = await getDocumentBlob(id);
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = record.fileName || `${record.title || "document"}.bin`;
    window.document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    toast("Private copy downloaded.", { type: "success" });
  } catch (error) {
    if (error instanceof CirclePlanError && error.upgrade) {
      openUpgrade(error.message);
      return;
    }
    toast(error.message || "That file could not be downloaded.", { type: "error" });
  } finally {
    if (button) setButtonLoading(button, false);
  }
}

function fillMedicationPeople(responsibleId = "", clinicianId = "") {
  const responsible = medicationForm?.elements.namedItem("responsibleId");
  const clinician = medicationForm?.elements.namedItem("clinicianId");
  if (responsible) {
    const people = hub?.medicationAssignees ?? [];
    responsible.innerHTML = [
      `<option value="">Household covering</option>`,
      ...people.map((person) => {
        const current = person.id === responsibleId ? " selected" : "";
        return `<option value="${escapeHtml(person.id)}"${current}>${escapeHtml(person.label)}</option>`;
      }),
    ].join("");
  }
  if (clinician) {
    const people = hub?.medicationClinicians ?? [];
    clinician.innerHTML = [
      `<option value="">No clinician linked</option>`,
      ...people.map((person) => {
        const current = person.id === clinicianId ? " selected" : "";
        return `<option value="${escapeHtml(person.id)}"${current}>${escapeHtml(person.label)}</option>`;
      }),
    ].join("");
  }
}

function findMedication(id) {
  return (hub?.medicationRecords || hub?.medications || []).find((item) => item.id === id) ?? null;
}

function openMedicationEditor(medication = null) {
  if (!hub?.medicationPlus && hub?.canManageMedications) {
    openUpgrade();
    return;
  }
  if (!medicationForm) return;
  if (medicationError) {
    medicationError.hidden = true;
    medicationError.textContent = "";
  }
  medicationForm.reset();
  fillMedicationPeople(medication?.responsibleId || "", medication?.clinicianId || "");
  medicationForm.elements.namedItem("medicationId").value = medication?.id ?? "";
  medicationForm.elements.namedItem("name").value = medication?.name ?? "";
  medicationForm.elements.namedItem("dosage").value = medication?.dosage ?? "";
  medicationForm.elements.namedItem("frequency").innerHTML = medicationOptionHtml(
    MEDICATION_FREQUENCY_OPTIONS,
    medication?.frequency ?? "daily",
  );
  medicationForm.elements.namedItem("time").value = medication?.time ?? "08:00";
  medicationForm.elements.namedItem("secondTime").value = medication?.secondTime ?? "";
  medicationForm.elements.namedItem("thirdTime").value = medication?.thirdTime ?? "";
  medicationForm.elements.namedItem("startDate").value = medication?.startDate ?? todayIso();
  medicationForm.elements.namedItem("endDate").value = medication?.endDate ?? "";
  medicationForm.elements.namedItem("notes").value = medication?.notes ?? "";
  medicationForm.elements.namedItem("reminder").innerHTML = medicationOptionHtml(
    MEDICATION_REMINDER_OPTIONS,
    medication?.reminder ?? "15min",
  );
  medicationForm.elements.namedItem("weekday").innerHTML = medicationOptionHtml(
    MEDICATION_WEEKDAY_OPTIONS,
    medication?.weekday == null ? String(new Date().getDay()) : String(medication.weekday),
  );
  qs("#medication-title").textContent = medication?.id ? "Update medication" : "Add medication";
  syncMedicationFrequencyFields();
  openModal("medication");
}

function syncMedicationFrequencyFields() {
  if (!medicationForm) return;
  const frequency = medicationForm.elements.namedItem("frequency")?.value;
  const second = qs("[data-second-time-field]");
  const third = qs("[data-third-time-field]");
  const weekdayField = qs("[data-med-weekday-field]");
  const time = medicationForm.elements.namedItem("time");
  if (second) second.hidden = frequency !== "twice_daily" && frequency !== "three_times";
  if (third) third.hidden = frequency !== "three_times";
  if (weekdayField) weekdayField.hidden = frequency !== "weekly";
  if (time) time.required = frequency !== "as_needed";
}

async function saveMedicationForm(form) {
  if (!senior) return;
  if (medicationError) {
    medicationError.hidden = true;
    medicationError.textContent = "";
  }
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  const editing = Boolean(form.elements.namedItem("medicationId").value);
  try {
    await saveMedication({
      medicationId: form.elements.namedItem("medicationId").value,
      name: form.elements.namedItem("name").value,
      dosage: form.elements.namedItem("dosage").value,
      frequency: form.elements.namedItem("frequency").value,
      time: form.elements.namedItem("time").value,
      secondTime: form.elements.namedItem("secondTime").value,
      thirdTime: form.elements.namedItem("thirdTime").value,
      weekday: form.elements.namedItem("weekday").value,
      startDate: form.elements.namedItem("startDate").value,
      endDate: form.elements.namedItem("endDate").value,
      reminder: form.elements.namedItem("reminder").value,
      notes: form.elements.namedItem("notes").value,
      responsibleId: form.elements.namedItem("responsibleId").value,
      clinicianId: form.elements.namedItem("clinicianId").value,
    });
    closeModal("medication");
    form.reset();
    toast(editing ? "Medication updated." : "Medication added to the shared list.", { type: "success" });
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    if (error instanceof CirclePlanError && error.upgrade) {
      closeModal("medication");
      openUpgrade(error.message);
      return;
    }
    if (medicationError) {
      medicationError.hidden = false;
      medicationError.textContent = error.message;
    }
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
}

function openUpgrade(message) {
  const body = qs("[data-upgrade-body]");
  if (body && message) body.textContent = message;
  openModal("upgrade");
}

function syncAppointmentCalendar() {
  if (!hub) return;
  const records = hub.appointmentRecords || [];
  hub.appointmentCalendar = monthGrid(appointmentMonth, records, appointmentDay);
  hub.appointmentDay = appointmentDay;
}

function shiftAppointmentMonth(delta) {
  appointmentMonth = shiftYearMonth(appointmentMonth, delta);
  const [year, month] = appointmentMonth.split("-").map(Number);
  const selected = appointmentDay?.startsWith(appointmentMonth);
  if (!selected) appointmentDay = `${appointmentMonth}-01`;
  if (year && month && appointmentDay === `${appointmentMonth}-01`) {
    const today = todayIso();
    if (today.startsWith(appointmentMonth)) appointmentDay = today;
  }
  render();
}

function restoreHistoryToolbar() {
  const search = qs("[data-history-search]", root);
  if (search) search.value = historyQuery;
  root.querySelectorAll("[data-history-filter]").forEach((button) => {
    const active = button.dataset.historyFilter === historyFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function restoreReportsToolbar() {
  if (currentSeniorSection().id !== "reports") return;
  root.querySelectorAll("[data-report-range]").forEach((button) => {
    const active = button.dataset.reportRange === reportsRange;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const tabs = qs("[data-tabs]", root);
  if (tabs && reportsTab) selectTab(tabs, reportsTab);
}

function exportCareReport(kind) {
  if (!hub?.reports || !senior) return;
  const name = senior.preferredName || senior.displayName || "care";
  if (kind === "csv") {
    downloadTextFile(`${reportsFileStem(name)}.csv`, hub.reports.advanced?.csv || "");
    toast("CSV downloaded.", { type: "success" });
    return;
  }
  printCareReport(reportPrintHtml(hub.reports, name));
  toast("Choose Save as PDF in the print dialog.", { type: "success" });
}

function applyHistoryFilters() {
  if (!qs("[data-history-filter]", root)) return;
  const selected = CARE_HISTORY_FILTERS.find((item) => item.id === historyFilter);
  const kinds = selected?.kinds;
  const needle = historyQuery.trim().toLowerCase();
  let visible = 0;

  root.querySelectorAll("[data-history-item]").forEach((item) => {
    const kindOk = !kinds || kinds.includes(item.dataset.kind);
    const searchOk = !needle || String(item.dataset.search || "").includes(needle);
    const show = kindOk && searchOk;
    item.hidden = !show;
    if (show) visible += 1;
  });

  root.querySelectorAll("[data-history-day]").forEach((day) => {
    const shown = [...day.querySelectorAll("[data-history-item]")].filter((item) => !item.hidden);
    day.hidden = shown.length === 0;
    shown.forEach((item, index) => {
      const last = index === shown.length - 1;
      item.toggleAttribute("data-last", last);
      const branch = item.querySelector(".care-timeline__branch");
      if (branch) branch.textContent = last ? "└──" : "├──";
    });
  });

  const empty = qs("[data-history-empty]", root);
  const timeline = qs("[data-care-timeline]", root);
  if (empty) empty.hidden = Boolean(visible);
  if (timeline) timeline.hidden = !visible && Boolean(empty);
}

async function saveHistoryNote(form) {
  if (!senior) return;
  const field = form.elements.namedItem("body");
  const body = field && "value" in field ? field.value.trim() : "";
  const submit = form.querySelector("[type='submit']");
  if (historyNoteError) historyNoteError.hidden = true;
  setButtonLoading(submit, true);
  try {
    await addCareHistoryNote(senior.id, body, session);
    toast("Note saved to care history.", { type: "success" });
    closeModal("history-note");
    form.reset();
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    if (error instanceof CirclePlanError && error.upgrade) {
      closeModal("history-note");
      openUpgrade(error.message);
    } else if (historyNoteError) {
      historyNoteError.textContent = error.message || "The note could not be saved.";
      historyNoteError.hidden = false;
    } else {
      toast(error.message, { type: "error" });
    }
  } finally {
    setButtonLoading(submit, false);
  }
}

async function runCareAction(button, action, success) {
  setButtonLoading(button, true);
  try {
    await action();
    toast(success, { type: "success" });
    hub = await getSeniorHub(senior);
    render();
  } catch (error) {
    if (error instanceof CirclePlanError && error.upgrade) {
      setButtonLoading(button, false);
      openUpgrade(error.message);
      return;
    }
    toast(error.message || "Something went wrong.", { type: "error" });
    setButtonLoading(button, false);
  }
}

function collectPayload(form) {
  const contacts = [...form.querySelectorAll("[data-contact-row]")].map((row) => ({
    id: row.dataset.contactId || "",
    name: row.querySelector("[name='contactName']")?.value.trim() ?? "",
    relationship: row.querySelector("[name='contactRelationship']")?.value.trim() ?? "",
    phone: row.querySelector("[name='contactPhone']")?.value.trim() ?? "",
    email: row.querySelector("[name='contactEmail']")?.value.trim() ?? "",
    isPrimary: Boolean(row.querySelector("[name='contactPrimary']")?.checked),
  })).filter((contact) => contact.name);

  let primarySeen = false;
  const emergencyContacts = contacts.map((contact) => {
    const isPrimary = contact.isPrimary && !primarySeen;
    if (isPrimary) primarySeen = true;
    return { ...contact, isPrimary };
  });

  return {
    displayName: fieldValue(form, "displayName"),
    preferredName: fieldValue(form, "preferredName"),
    dateOfBirth: fieldValue(form, "dateOfBirth"),
    gender: fieldValue(form, "gender"),
    phone: fieldValue(form, "phone"),
    location: fieldValue(form, "location"),
    address: fieldValue(form, "address"),
    photoURL: pendingPhotoURL,
    conditions: fieldValue(form, "conditions"),
    medications: fieldValue(form, "medications"),
    allergies: fieldValue(form, "allergies"),
    emergencyContacts,
    carePreferences: {
      preferredLanguage: fieldValue(form, "preferredLanguage"),
      mobility: fieldValue(form, "mobility"),
      diet: fieldValue(form, "diet"),
      communication: fieldValue(form, "communication"),
      dailyRoutine: fieldValue(form, "dailyRoutine"),
      likes: fieldValue(form, "likes"),
      dislikes: fieldValue(form, "dislikes"),
      notes: fieldValue(form, "careNotes"),
    },
    importantInfo: {
      bloodType: fieldValue(form, "bloodType"),
      primaryPhysician: fieldValue(form, "primaryPhysician"),
      physicianPhone: fieldValue(form, "physicianPhone"),
      pharmacy: fieldValue(form, "pharmacy"),
      insuranceProvider: fieldValue(form, "insuranceProvider"),
      insuranceId: fieldValue(form, "insuranceId"),
      hospitalPreference: fieldValue(form, "hospitalPreference"),
      medicalNotes: fieldValue(form, "medicalNotes"),
      other: fieldValue(form, "otherInfo"),
    },
  };
}

function fieldValue(form, name) {
  const field = form.elements.namedItem(name);
  return field && "value" in field ? field.value.trim() : "";
}

function renderView() {
  const person = senior;
  const age = formatSeniorAge(person.dateOfBirth);
  const born = formatSeniorDate(person.dateOfBirth);
  const prefs = person.carePreferences;
  const info = person.importantInfo;
  const contacts = [...person.emergencyContacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  root.innerHTML = `
    ${hubNavHtml("overview")}
    <section class="card profile-hero">
      <button type="button" class="profile-photo" data-change-photo aria-label="Change profile picture">
        ${avatarHtml(person.displayName, person.photoURL, { size: "xl" })}
        <span class="profile-photo__badge">${person.photoURL ? "Change" : "Add photo"}</span>
      </button>
      <div class="profile-hero__copy">
        <p class="page-kicker">Senior care hub</p>
        <h2>${escapeHtml(person.displayName)}</h2>
        <p class="person__meta">
          Goes by ${escapeHtml(person.preferredName)}
          ${age ? ` · ${escapeHtml(age)}` : ""}
          ${person.location ? ` · ${escapeHtml(person.location)}` : ""}
        </p>
      </div>
      <div class="profile-hero__actions">
        <button class="btn btn--primary" type="button" data-edit-profile>Edit profile</button>
      </div>
    </section>
    ${hub ? overviewSnapshotHtml(hub) : ""}

    <div class="profile-grid">
      <section class="card profile-section" id="personal">
        <div class="card__header">
          <h2>Personal information</h2>
          <button class="btn btn--text btn--sm" type="button" data-edit-profile data-edit-section="personal">Edit</button>
        </div>
        <dl class="detail-list">
          ${detail("Full name", person.displayName)}
          ${detail("Preferred name", person.preferredName)}
          ${detail("Date of birth", born)}
          ${detail("Gender", optionLabel(SENIOR_GENDERS, person.gender))}
          ${detail("Phone", person.phone)}
          ${detail("Location", person.location)}
          ${detail("Address", person.address)}
        </dl>
      </section>

      <section class="card profile-section" id="emergency">
        <div class="card__header">
          <h2>Emergency contacts</h2>
          <button class="btn btn--text btn--sm" type="button" data-add-contact>Add</button>
        </div>
        ${contacts.length ? `<ul class="list">${contacts.map(contactItemHtml).join("")}</ul>` : emptyState({
          title: "No emergency contacts",
          body: "Add someone the circle can call first.",
          compact: true,
        })}
      </section>

      <section class="card profile-section" id="preferences">
        <div class="card__header">
          <h2>Care preferences</h2>
          <button class="btn btn--text btn--sm" type="button" data-edit-profile data-edit-section="preferences">Edit</button>
        </div>
        <dl class="detail-list detail-list--stack">
          ${detail("Language", optionLabel(SENIOR_LANGUAGES, prefs.preferredLanguage))}
          ${detail("Mobility", optionLabel(SENIOR_MOBILITY, prefs.mobility))}
          ${detail("Diet", optionLabel(SENIOR_DIETS, prefs.diet))}
          ${detail("Communication", optionLabel(SENIOR_COMMUNICATION, prefs.communication))}
          ${detail("Daily routine", prefs.dailyRoutine)}
          ${detail("Likes", prefs.likes)}
          ${detail("Dislikes", prefs.dislikes)}
          ${detail("Notes for caregivers", prefs.notes)}
        </dl>
      </section>

      <section class="card profile-section" id="important">
        <div class="card__header">
          <h2>Important information</h2>
          <button class="btn btn--text btn--sm" type="button" data-edit-profile data-edit-section="important">Edit</button>
        </div>
        <div class="chip-block">
          <p class="person__meta">Conditions</p>
          ${chipList(person.conditions)}
        </div>
        <div class="chip-block">
          <p class="person__meta">Medications</p>
          ${chipList(medicationNames(person))}
          <p class="person__meta"><a href="senior.html?section=medications">Open medication list</a> · Plus keeps dosage, schedule, reminders, and history.</p>
        </div>
        <div class="chip-block">
          <p class="person__meta">Allergies</p>
          ${chipList(person.allergies, "None recorded")}
        </div>
        <dl class="detail-list detail-list--stack">
          ${detail("Blood type", optionLabel(SENIOR_BLOOD_TYPES, info.bloodType))}
          ${detail("Primary physician", info.primaryPhysician)}
          ${detail("Physician phone", info.physicianPhone)}
          ${detail("Pharmacy", info.pharmacy)}
          ${detail("Insurance", [info.insuranceProvider, info.insuranceId].filter(Boolean).join(" · "))}
          ${detail("Hospital preference", info.hospitalPreference)}
          ${detail("Medical notes", info.medicalNotes)}
          ${detail("Other alerts", info.other)}
        </dl>
      </section>
    </div>
  `;
}

function renderForm() {
  const person = senior;
  const creating = mode === "create" || !person;
  const prefs = person?.carePreferences ?? {};
  const info = person?.importantInfo ?? {};
  const photo = pendingPhotoURL ?? person?.photoURL ?? null;
  const contacts = person?.emergencyContacts?.length
    ? person.emergencyContacts
    : [{}];

  root.innerHTML = `
    <div class="welcome">
      <div>
        <p class="page-kicker">${creating ? "New household record" : "Update the record"}</p>
        <h2>${creating ? "Create senior profile" : `Edit ${escapeHtml(person.preferredName || person.displayName)}`}</h2>
        <p class="page-lead">${creating
          ? "Start with a photo and the details the circle should never have to hunt for."
          : "Keep personal details, contacts, and care notes accurate for everyone around them."}</p>
      </div>
    </div>

    <form class="form profile-grid profile-grid--form" data-senior-form>
      <div class="alert alert--error" data-form-error hidden role="alert"></div>

      <section class="card profile-section" id="personal">
        <div class="card__header">
          <h2>Profile picture &amp; personal information</h2>
        </div>
        <div class="profile-form__photo">
          <button type="button" class="profile-photo" data-change-photo aria-label="Choose a profile picture">
            <span data-photo-preview>${avatarHtml(person?.displayName || "Senior", photo, { size: "xl" })}</span>
            <span class="profile-photo__badge">${photo ? "Change" : "Add photo"}</span>
          </button>
          <p class="person__meta">A clear face photo helps the circle recognize the right person across devices.</p>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-display-name">Full name</label>
            <input id="senior-display-name" name="displayName" type="text" required value="${escapeHtml(person?.displayName || "")}" placeholder="Eleanor Walsh">
          </div>
          <div class="field">
            <label for="senior-preferred-name">Preferred name</label>
            <input id="senior-preferred-name" name="preferredName" type="text" value="${escapeHtml(person?.preferredName || "")}" placeholder="Ellie">
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-dob">Date of birth</label>
            <input id="senior-dob" name="dateOfBirth" type="date" value="${escapeHtml(person?.dateOfBirth || "")}">
          </div>
          <div class="field">
            <label for="senior-gender">Gender</label>
            <select id="senior-gender" name="gender" class="select">${optionsHtml(SENIOR_GENDERS, person?.gender)}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-phone">Phone</label>
            <input id="senior-phone" name="phone" type="tel" value="${escapeHtml(person?.phone || "")}" placeholder="(410) 555-0114">
          </div>
          <div class="field">
            <label for="senior-location">Location</label>
            <input id="senior-location" name="location" type="text" value="${escapeHtml(person?.location || "")}" placeholder="Towson, Baltimore County, MD">
          </div>
        </div>
        <div class="field">
          <label for="senior-address">Home address</label>
          <input id="senior-address" name="address" type="text" value="${escapeHtml(person?.address || "")}" placeholder="1 Olympic Pl, Towson, Baltimore County, MD 21204">
        </div>
      </section>

      <section class="card profile-section" id="emergency">
        <div class="card__header">
          <h2>Emergency contacts</h2>
          <button class="btn btn--text btn--sm" type="button" data-add-contact-row>Add another</button>
        </div>
        <div class="form" data-contact-list>
          ${contacts.map((contact) => contactRowHtml(contact)).join("")}
        </div>
      </section>

      <section class="card profile-section" id="preferences">
        <div class="card__header">
          <h2>Care preferences</h2>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-language">Preferred language</label>
            <select id="senior-language" name="preferredLanguage" class="select">${optionsHtml(SENIOR_LANGUAGES, prefs.preferredLanguage)}</select>
          </div>
          <div class="field">
            <label for="senior-mobility">Mobility</label>
            <select id="senior-mobility" name="mobility" class="select">${optionsHtml(SENIOR_MOBILITY, prefs.mobility)}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-diet">Diet</label>
            <select id="senior-diet" name="diet" class="select">${optionsHtml(SENIOR_DIETS, prefs.diet)}</select>
          </div>
          <div class="field">
            <label for="senior-communication">Communication</label>
            <select id="senior-communication" name="communication" class="select">${optionsHtml(SENIOR_COMMUNICATION, prefs.communication)}</select>
          </div>
        </div>
        <div class="field">
          <label for="senior-routine">Daily routine</label>
          <textarea id="senior-routine" name="dailyRoutine" placeholder="Morning rhythm, rest times, evening habits">${escapeHtml(prefs.dailyRoutine || "")}</textarea>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-likes">Likes</label>
            <textarea id="senior-likes" name="likes" placeholder="Food, music, company">${escapeHtml(prefs.likes || "")}</textarea>
          </div>
          <div class="field">
            <label for="senior-dislikes">Dislikes</label>
            <textarea id="senior-dislikes" name="dislikes" placeholder="What to avoid">${escapeHtml(prefs.dislikes || "")}</textarea>
          </div>
        </div>
        <div class="field">
          <label for="senior-care-notes">Notes for caregivers</label>
          <textarea id="senior-care-notes" name="careNotes" placeholder="How they prefer to be helped">${escapeHtml(prefs.notes || "")}</textarea>
        </div>
      </section>

      <section class="card profile-section" id="important">
        <div class="card__header">
          <h2>Important information</h2>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-conditions">Conditions</label>
            <textarea id="senior-conditions" name="conditions" placeholder="One per line">${escapeHtml((person?.conditions || []).join("\n"))}</textarea>
          </div>
          <div class="field">
            <label for="senior-medications">Medications snapshot</label>
            <textarea id="senior-medications" name="medications" placeholder="One per line">${escapeHtml((person?.medications || []).join("\n"))}</textarea>
            <p class="person__meta">A short household snapshot. Dosage, frequency, dates, reminders, and history live on <a href="senior.html?section=medications">Medications</a> (Plus).</p>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-allergies">Allergies</label>
            <textarea id="senior-allergies" name="allergies" placeholder="One per line">${escapeHtml((person?.allergies || []).join("\n"))}</textarea>
          </div>
          <div class="field">
            <label for="senior-blood-type">Blood type</label>
            <select id="senior-blood-type" name="bloodType" class="select">${optionsHtml(SENIOR_BLOOD_TYPES, info.bloodType)}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-physician">Primary physician</label>
            <input id="senior-physician" name="primaryPhysician" type="text" value="${escapeHtml(info.primaryPhysician || "")}" placeholder="Dr. Patel">
          </div>
          <div class="field">
            <label for="senior-physician-phone">Physician phone</label>
            <input id="senior-physician-phone" name="physicianPhone" type="tel" value="${escapeHtml(info.physicianPhone || "")}" placeholder="(410) 555-0198">
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-pharmacy">Pharmacy</label>
            <input id="senior-pharmacy" name="pharmacy" type="text" value="${escapeHtml(info.pharmacy || "")}" placeholder="CVS Pharmacy, York Road">
          </div>
          <div class="field">
            <label for="senior-hospital">Hospital preference</label>
            <input id="senior-hospital" name="hospitalPreference" type="text" value="${escapeHtml(info.hospitalPreference || "")}" placeholder="Greater Baltimore Medical Center">
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-insurance">Insurance provider</label>
            <input id="senior-insurance" name="insuranceProvider" type="text" value="${escapeHtml(info.insuranceProvider || "")}" placeholder="Medicare">
          </div>
          <div class="field">
            <label for="senior-insurance-id">Insurance ID</label>
            <input id="senior-insurance-id" name="insuranceId" type="text" value="${escapeHtml(info.insuranceId || "")}" placeholder="Member ID">
          </div>
        </div>
        <div class="field">
          <label for="senior-medical-notes">Medical notes</label>
          <textarea id="senior-medical-notes" name="medicalNotes" placeholder="What clinicians and caregivers should know">${escapeHtml(info.medicalNotes || "")}</textarea>
        </div>
        <div class="field">
          <label for="senior-other">Other alerts</label>
          <textarea id="senior-other" name="otherInfo" placeholder="Advance directives, door codes, or other household notes">${escapeHtml(info.other || "")}</textarea>
        </div>
      </section>

      <div class="profile-form-actions">
        ${creating ? "" : `<button class="btn btn--ghost" type="button" data-cancel-edit>Cancel</button>`}
        <button class="btn btn--primary" type="submit">${creating ? "Create senior" : "Save profile"}</button>
      </div>
    </form>
  `;
}

function contactRowHtml(contact = {}) {
  const id = contact.id || `new-${++contactSeq}`;
  return `
    <article class="contact-row card card--nested" data-contact-row data-contact-id="${escapeHtml(id)}">
      <div class="form-row">
        <div class="field">
          <label>Full name</label>
          <input name="contactName" type="text" value="${escapeHtml(contact.name || "")}" placeholder="Sarah Walsh">
        </div>
        <div class="field">
          <label>Relationship</label>
          <input name="contactRelationship" type="text" value="${escapeHtml(contact.relationship || "")}" placeholder="Daughter">
        </div>
      </div>
      <div class="form-row">
        <div class="field">
          <label>Phone</label>
          <input name="contactPhone" type="tel" value="${escapeHtml(contact.phone || "")}" placeholder="(410) 555-0142">
        </div>
        <div class="field">
          <label>Email</label>
          <input name="contactEmail" type="email" value="${escapeHtml(contact.email || "")}" placeholder="family@example.com">
        </div>
      </div>
      <div class="contact-row__footer">
        <label class="checkbox">
          <input type="checkbox" name="contactPrimary"${contact.isPrimary ? " checked" : ""}>
          Primary contact
        </label>
        <button class="btn btn--text btn--sm" type="button" data-remove-contact-row>Remove</button>
      </div>
    </article>
  `;
}

function contactItemHtml(contact) {
  return `
    <li class="list__item">
      <div>
        <strong>${escapeHtml(contact.name)}</strong>
        <div class="person__meta">${escapeHtml(contact.relationship)}${contact.email ? ` · ${escapeHtml(contact.email)}` : ""}</div>
      </div>
      <div class="profile-hero__actions">
        ${contact.isPrimary ? `<span class="badge badge--brand">Primary</span>` : ""}
        <span>${escapeHtml(contact.phone)}</span>
        <button class="btn btn--text btn--sm" type="button" data-edit-contact="${escapeHtml(contact.id)}">Edit</button>
        <button class="btn btn--text btn--sm" type="button" data-remove-contact="${escapeHtml(contact.id)}">Remove</button>
      </div>
    </li>
  `;
}

function detail(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "Not recorded")}</dd></div>`;
}

function medicationNames(person) {
  const fromHub = (hub?.medicationActive || hub?.medications || [])
    .map((item) => [item.name, item.dosage].filter(Boolean).join(" ").trim())
    .filter(Boolean);
  return fromHub.length ? fromHub : (person?.medications || []);
}

function chipList(items, empty = "None recorded") {
  if (!items?.length) return `<p class="person__meta">${escapeHtml(empty)}</p>`;
  return `<div class="chip-row">${items.map((item) => `<span class="badge badge--neutral">${escapeHtml(item)}</span>`).join("")}</div>`;
}

function optionsHtml(options, selected) {
  return [
    `<option value="">Select</option>`,
    ...options.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selected ? " selected" : ""}>${escapeHtml(item.label)}</option>`),
  ].join("");
}
