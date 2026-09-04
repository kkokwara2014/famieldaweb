import { bootPublicAuth } from "../auth/public-boot.js";
import { requireRoleSelection } from "../guards/role-setup-guard.js";
import { saveRoleProfile } from "../auth/role.js";
import { requestLogout } from "../auth/logout.js";
import {
  ROLE_OPTIONS,
  professionalTypesFor,
  roleNeedsProfessionalType,
  roleLabel,
} from "../config/roles.js";
import { go, homeFor } from "../config/routes.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on } from "../core/events.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { completeFamilyReferral } from "../services/referral-service.js";
import { roleForInviteKind, readStoredInvitePreview } from "../config/invites.js";

await bootPublicAuth({ redirectSignedIn: false });
const session = await requireRoleSelection();

const errorBox = qs("#role-error");
const root = qs("[data-role-setup]");

const ICONS = {
  family: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 14a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/>
      <path d="M16.5 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>
      <path d="M3.5 20c.6-2.6 2.5-4 4.5-4s3.9 1.4 4.5 4"/>
      <path d="M13 20c.4-2 1.8-3.2 3.5-3.2 1.8 0 3.3 1.2 3.7 3.2"/>
    </svg>
  `,
  caregiver: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-9.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7 3.8C19 15.6 12 20 12 20Z"/>
    </svg>
  `,
  health_practitioner: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 4h6v3h3v6h-3v3H9v-3H6V7h3V4Z"/>
    </svg>
  `,
  cna: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 20v-2.2A4 4 0 0 1 12 14a4 4 0 0 1 4 3.8V20"/>
      <circle cx="12" cy="8" r="3"/>
    </svg>
  `,
  cmt: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="7" y="3" width="10" height="18" rx="3"/>
      <path d="M10 8h4M12 8v8"/>
    </svg>
  `,
  other_caregiver: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8"/>
      <path d="M12 8v8M8 12h8"/>
    </svg>
  `,
  nurse: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 10h16v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8Z"/>
      <path d="M8 10V7a4 4 0 0 1 8 0v3"/>
    </svg>
  `,
  physiotherapist: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="2"/>
      <path d="M6 21l3-8 3 3 3-3 3 8"/>
    </svg>
  `,
  md: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 12c0-4 2.2-7 5-7s5 3 5 7"/>
      <path d="M12 12v7a2 2 0 0 0 4 0"/>
      <path d="M9 16h6"/>
    </svg>
  `,
  other: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8"/>
      <path d="M12 8v.01M12 12v4"/>
    </svg>
  `,
};

const state = {
  step: "role",
  role: roleForInviteKind(readStoredInvitePreview()?.kind) || null,
  professionalType: null,
};

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
}

function choiceCard({ name, option, selected }) {
  return `
    <label class="choice-card${selected === option.id ? " is-selected" : ""}">
      <input type="radio" name="${name}" value="${option.id}" ${selected === option.id ? "checked" : ""}>
      <span class="choice-card__check" aria-hidden="true"></span>
      <span class="choice-card__icon">${ICONS[option.id] ?? ICONS.other}</span>
      <strong class="choice-card__title">${escapeHtml(option.label)}</strong>
      <p class="choice-card__desc">${escapeHtml(option.description)}</p>
    </label>
  `;
}

function stepperMarkup() {
  const onType = state.step === "type";
  return `
    <ol class="stepper" aria-label="Profile setup">
      <li class="stepper__item ${onType ? "is-complete" : "is-active"}">
        <span class="stepper__index">1</span>
        Select role
      </li>
      <li class="stepper__rule" aria-hidden="true"></li>
      <li class="stepper__item ${onType ? "is-active" : ""}">
        <span class="stepper__index">2</span>
        Professional type
      </li>
    </ol>
  `;
}

function renderRoleStep() {
  const firstName = session.displayName?.split(" ")[0] || "there";
  return `
    ${stepperMarkup()}
    <header>
      <p class="page-kicker">Role selection</p>
      <h1>How do you care, ${escapeHtml(firstName)}?</h1>
      <p>Choose one role. Famielda opens a workspace for <strong>Family Members</strong>, <strong>Caregivers</strong>, and <strong>Health Practitioners</strong>.</p>
    </header>
    <div class="choice-grid choice-grid--roles" role="radiogroup" aria-label="Your role">
      ${ROLE_OPTIONS.map((option) => choiceCard({ name: "role", option, selected: state.role })).join("")}
    </div>
    <div class="onboard__actions">
      <button class="btn btn--text" type="button" data-sign-out>Sign out</button>
      <button class="btn btn--primary" type="button" data-continue ${state.role ? "" : "disabled"}>
        ${state.role && !roleNeedsProfessionalType(state.role) ? "Save profile" : "Continue"}
      </button>
    </div>
  `;
}

function renderTypeStep() {
  const types = professionalTypesFor(state.role);
  return `
    ${stepperMarkup()}
    <header>
      <p class="page-kicker">${escapeHtml(roleLabel(state.role))}</p>
      <h1>What is your professional type?</h1>
      <p>This stays on your shared Famielda profile so the circle knows how you help.</p>
    </header>
    <div class="choice-grid" role="radiogroup" aria-label="Professional type">
      ${types.map((option) => choiceCard({ name: "professionalType", option, selected: state.professionalType })).join("")}
    </div>
    <div class="onboard__actions">
      <button class="btn btn--ghost" type="button" data-back>Back</button>
      <button class="btn btn--primary" type="button" data-save ${state.professionalType ? "" : "disabled"}>Save profile</button>
    </div>
  `;
}

function render() {
  root.innerHTML = state.step === "type" ? renderTypeStep() : renderRoleStep();
}

async function persistProfile() {
  const saved = await saveRoleProfile({
    role: state.role,
    professionalType: state.professionalType,
  });
  try {
    await completeFamilyReferral(saved);
  } catch {
    // Role is saved even if referral completion cannot run.
  }
  toast("Role saved. Next, a few questions for your workspace.", { type: "success" });
  go(homeFor(saved));
}

on(root, "change", (event) => {
  const input = event.target.closest("input[type='radio']");
  if (!input) return;
  showError("");
  if (input.name === "role") {
    state.role = input.value;
    state.professionalType = null;
  }
  if (input.name === "professionalType") {
    state.professionalType = input.value;
  }
  render();
});

on(root, "click", async (event) => {
  const signOut = event.target.closest("[data-sign-out]");
  if (signOut) {
    await requestLogout();
    return;
  }

  const back = event.target.closest("[data-back]");
  if (back) {
    state.step = "role";
    state.professionalType = null;
    showError("");
    render();
    return;
  }

  const next = event.target.closest("[data-continue]");
  if (next) {
    if (!state.role) {
      showError("Choose a role to continue.");
      return;
    }
    if (roleNeedsProfessionalType(state.role)) {
      state.step = "type";
      showError("");
      render();
      return;
    }
    setButtonLoading(next, true);
    try {
      await persistProfile();
    } catch (error) {
      showError(error.message);
      toast(error.message, { type: "error" });
      setButtonLoading(next, false);
    }
    return;
  }

  const save = event.target.closest("[data-save]");
  if (!save) return;
  if (!state.professionalType) {
    showError("Choose your professional type.");
    return;
  }
  setButtonLoading(save, true);
  try {
    await persistProfile();
  } catch (error) {
    showError(error.message);
    toast(error.message, { type: "error" });
    setButtonLoading(save, false);
  }
});

render();
