import { bootPublicAuth } from "../auth/public-boot.js";
import { requireOnboardingSelection } from "../guards/onboarding-guard.js";
import { saveOnboardingProfile } from "../auth/onboarding.js";
import { requestLogout } from "../auth/logout.js";
import { ONBOARDING_PATH, ROLES } from "../config/constants.js";
import {
  CARE_TYPE_OPTIONS,
  familyRelationshipOptions,
  onboardingKicker,
  onboardingLead,
  onboardingQuestion,
  professionOptions,
} from "../config/onboarding.js";
import { go, homeFor } from "../config/routes.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on } from "../core/events.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { listIncomingInvites } from "../services/care-circle-service.js";
import { getSeniorForUser } from "../services/senior-service.js";

await bootPublicAuth({ redirectSignedIn: false });
const session = await requireOnboardingSelection();
const incoming = session.seniorId ? [] : await listIncomingInvites(session);
const existingSenior = session.role === ROLES.FAMILY ? await getSeniorForUser(session) : null;

const errorBox = qs("#onboarding-error");
const root = qs("[data-onboarding]");

const ICONS = {
  personal_care: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7 3.8C19 15.6 12 20 12 20Z"/></svg>`,
  medication: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="3"/><path d="M10 8h4M12 8v8"/></svg>`,
  companionship: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 14a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/><path d="M16.5 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/><path d="M3.5 20c.6-2.6 2.5-4 4.5-4s3.9 1.4 4.5 4"/><path d="M13 20c.4-2 1.8-3.2 3.5-3.2 1.8 0 3.3 1.2 3.7 3.2"/></svg>`,
  household: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7"/><path d="M6 10.5V20h12v-9.5"/></svg>`,
  mobility: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2"/><path d="M6 21l3-8 3 3 3-3 3 8"/></svg>`,
  overnight: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18h16M6 18V9l6-4 6 4v9"/></svg>`,
  nurse: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h16v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8Z"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  physiotherapist: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2"/><path d="M6 21l3-8 3 3 3-3 3 8"/></svg>`,
  md: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 12c0-4 2.2-7 5-7s5 3 5 7"/><path d="M12 12v7a2 2 0 0 0 4 0"/><path d="M9 16h6"/></svg>`,
  other: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v.01M12 12v4"/></svg>`,
};

const state = {
  onboardingPath: incoming.length ? ONBOARDING_PATH.JOIN_EXISTING : ONBOARDING_PATH.CREATE_SENIOR,
  displayName: existingSenior?.displayName || "",
  preferredName: existingSenior?.preferredName || "",
  familyRelationship: session.familyRelationship || "",
  location: existingSenior?.location || "",
  dateOfBirth: existingSenior?.dateOfBirth || "",
  careTypes: [...(session.careTypes || [])],
  professionalType: session.professionalType || null,
  specialty: session.specialty || "",
};

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
}

function stepperMarkup() {
  return `
    <ol class="stepper" aria-label="Profile setup">
      <li class="stepper__item is-complete">
        <span class="stepper__index">1</span>
        Select role
      </li>
      <li class="stepper__rule" aria-hidden="true"></li>
      <li class="stepper__item is-active">
        <span class="stepper__index">2</span>
        Your workspace
      </li>
    </ol>
  `;
}

function choiceCard({ name, option, selected, type = "radio" }) {
  const isOn = type === "checkbox"
    ? selected.includes(option.id)
    : selected === option.id;
  return `
    <label class="choice-card${isOn ? " is-selected" : ""}">
      <input type="${type}" name="${name}" value="${option.id}" ${isOn ? "checked" : ""}>
      <span class="choice-card__check" aria-hidden="true"></span>
      <span class="choice-card__icon">${ICONS[option.id] ?? ICONS.other}</span>
      <strong>${escapeHtml(option.label)}</strong>
      <p>${escapeHtml(option.description)}</p>
    </label>
  `;
}

function headerMarkup() {
  return `
    ${stepperMarkup()}
    <header>
      <p class="page-kicker">${escapeHtml(onboardingKicker(session.role))}</p>
      <h1>${escapeHtml(onboardingQuestion(session.role))}</h1>
      <p>${escapeHtml(onboardingLead(session.role))}</p>
    </header>
  `;
}

function renderFamily() {
  const joining = state.onboardingPath === ONBOARDING_PATH.JOIN_EXISTING;
  const inviteNote = incoming.length
    ? `
      <div class="onboard-invite">
        <strong>${incoming.length === 1 ? "You have a household invitation" : `You have ${incoming.length} household invitations`}</strong>
        <p>${escapeHtml(incoming[0].invitedByName || "A family member")} invited you to ${escapeHtml(incoming[0].seniorName || "a household")}.</p>
        <div class="onboard__actions">
          <button class="btn ${joining ? "btn--primary" : "btn--ghost"}" type="button" data-join-existing>
            ${joining ? "Joining that household" : "I’ll join a household that’s inviting me"}
          </button>
        </div>
      </div>
    `
    : "";

  return `
    ${headerMarkup()}
    ${joining ? `
      <p>We’ll open the family dashboard around that invitation. You can accept it from Care Circle.</p>
    ` : `
      <form class="form" data-onboarding-form>
        <div class="field">
          <label for="senior-name">Their full name</label>
          <input id="senior-name" name="displayName" type="text" required value="${escapeHtml(state.displayName)}" placeholder="Eleanor Walsh" autocomplete="name">
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-preferred">What they go by</label>
            <input id="senior-preferred" name="preferredName" type="text" value="${escapeHtml(state.preferredName)}" placeholder="Eleanor">
          </div>
          <div class="field">
            <label for="family-relationship">Your relationship</label>
            <select id="family-relationship" name="familyRelationship" required>
              <option value="">Choose one</option>
              ${familyRelationshipOptions().map((item) => `
                <option value="${escapeHtml(item)}" ${state.familyRelationship === item ? "selected" : ""}>${escapeHtml(item)}</option>
              `).join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="senior-location">Where they live <span class="hint">(optional)</span></label>
            <input id="senior-location" name="location" type="text" value="${escapeHtml(state.location)}" placeholder="Towson, Baltimore County, MD">
          </div>
          <div class="field">
            <label for="senior-dob">Date of birth <span class="hint">(optional)</span></label>
            <input id="senior-dob" name="dateOfBirth" type="date" value="${escapeHtml(state.dateOfBirth)}">
          </div>
        </div>
      </form>
    `}
    ${inviteNote}
    ${actionsMarkup(joining ? "Open family dashboard" : existingSenior ? "Continue to dashboard" : "Create their profile")}
  `;
}

function renderCaregiver() {
  return `
    ${headerMarkup()}
    <div class="choice-grid choice-grid--check" role="group" aria-label="Types of care">
      ${CARE_TYPE_OPTIONS.map((option) => choiceCard({
        name: "careTypes",
        option,
        selected: state.careTypes,
        type: "checkbox",
      })).join("")}
    </div>
    ${actionsMarkup("Save and open dashboard")}
  `;
}

function renderPractitioner() {
  return `
    ${headerMarkup()}
    <div class="choice-grid" role="radiogroup" aria-label="Your profession">
      ${professionOptions().map((option) => choiceCard({
        name: "professionalType",
        option,
        selected: state.professionalType,
      })).join("")}
    </div>
    <form class="form" data-onboarding-form>
      <div class="field">
        <label for="specialty">Specialty or focus <span class="hint">(optional)</span></label>
        <input id="specialty" name="specialty" type="text" value="${escapeHtml(state.specialty)}" placeholder="Geriatrics, home health, rehabilitation">
      </div>
    </form>
    ${actionsMarkup("Save and open dashboard")}
  `;
}

function actionsMarkup(saveLabel) {
  return `
    <div class="onboard__actions">
      <button class="btn btn--text" type="button" data-sign-out>Sign out</button>
      <button class="btn btn--primary" type="button" data-save>${escapeHtml(saveLabel)}</button>
    </div>
  `;
}

function render() {
  if (session.role === ROLES.CAREGIVER) {
    root.innerHTML = renderCaregiver();
    return;
  }
  if (session.role === ROLES.HEALTH_PRACTITIONER) {
    root.innerHTML = renderPractitioner();
    return;
  }
  root.innerHTML = renderFamily();
}

function readForm() {
  const form = qs("[data-onboarding-form]", root);
  if (!form) return;
  state.displayName = form.displayName?.value?.trim() || state.displayName;
  state.preferredName = form.preferredName?.value?.trim() || "";
  state.familyRelationship = form.familyRelationship?.value || state.familyRelationship;
  state.location = form.location?.value?.trim() || "";
  state.dateOfBirth = form.dateOfBirth?.value || "";
  state.specialty = form.specialty?.value?.trim() || "";
}

async function persist() {
  readForm();
  const saved = await saveOnboardingProfile({
    onboardingPath: state.onboardingPath,
    displayName: state.displayName,
    preferredName: state.preferredName,
    familyRelationship: state.familyRelationship,
    location: state.location,
    dateOfBirth: state.dateOfBirth,
    careTypes: state.careTypes,
    professionalType: state.professionalType,
    specialty: state.specialty,
  }, session);
  toast("Your workspace is ready.", { type: "success" });
  go(homeFor(saved));
}

on(root, "change", (event) => {
  const input = event.target.closest("input, select");
  if (!input) return;
  showError("");
  if (input.name === "careTypes") {
    state.careTypes = [...root.querySelectorAll("input[name='careTypes']:checked")].map((item) => item.value);
    render();
    return;
  }
  if (input.name === "professionalType") {
    state.professionalType = input.value;
    render();
    return;
  }
  readForm();
});

on(root, "click", async (event) => {
  const signOut = event.target.closest("[data-sign-out]");
  if (signOut) {
    await requestLogout();
    return;
  }

  const join = event.target.closest("[data-join-existing]");
  if (join) {
    state.onboardingPath = state.onboardingPath === ONBOARDING_PATH.JOIN_EXISTING
      ? ONBOARDING_PATH.CREATE_SENIOR
      : ONBOARDING_PATH.JOIN_EXISTING;
    showError("");
    render();
    return;
  }

  const save = event.target.closest("[data-save]");
  if (!save) return;
  setButtonLoading(save, true);
  try {
    await persist();
  } catch (error) {
    showError(error.message);
    toast(error.message, { type: "error" });
    setButtonLoading(save, false);
  }
});

render();
