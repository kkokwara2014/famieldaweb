import { bootPublicAuth } from "../auth/public-boot.js";
import { register } from "../auth/register.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { go, homeFor, routes } from "../config/routes.js";
import { AUTH } from "../config/constants.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { bindPhoneField, readPhoneField, setPhoneField } from "../components/phone-field.js";
import { usesLiveAuth } from "../core/firebase.js";
import { persistReferralCode, readStoredReferralCode } from "../config/referrals.js";
import { claimFamilyReferral, resolveFamilyReferralCode } from "../services/referral-service.js";
import {
  inviteLoginPath,
  persistInviteToken,
  readStoredInvitePreview,
  readStoredInviteToken,
  splitInviteName,
} from "../config/invites.js";
import { resolveCareCircleInvite } from "../services/care-circle-service.js";

await bootPublicAuth({ navLabel: "register" });

const form = qs("#register-form");
const errorBox = qs("#register-error");
const referralNote = qs("[data-referral-note]");
const inviteNote = qs("[data-invite-note]");
const phoneRoot = qs("[data-phone-field]");
const storedCode = persistReferralCode(readStoredReferralCode());
const inviteToken = persistInviteToken(readStoredInviteToken());
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}'’. \-]{0,39}$/u;

bindPhoneField(phoneRoot);

if (storedCode && referralNote) {
  const preview = await resolveFamilyReferralCode(storedCode);
  referralNote.hidden = false;
  referralNote.textContent = preview?.referrerName
    ? `${preview.referrerName} invited you to Famielda. Create an account to start your own household.`
    : "You are joining from a family invite. Create an account to start your own household.";
}

const invitePreview = await loadInvitePreview(inviteToken);
if (invitePreview && inviteNote) {
  applyInviteToRegister(invitePreview);
}

function showError(message, field) {
  errorBox.hidden = false;
  errorBox.textContent = message;
  field?.closest(".field, .checkbox")?.classList.add("is-invalid");
  field?.focus();
}

function clearFieldErrors() {
  errorBox.hidden = true;
  form.querySelectorAll(".field.is-invalid, .checkbox.is-invalid").forEach((field) => field.classList.remove("is-invalid"));
}

function readName(value, label) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: `Enter your ${label}.` };
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: `Use letters, spaces, hyphens, or apostrophes for your ${label}.` };
  }
  return { ok: true, value: name };
}

async function loadInvitePreview(token) {
  if (!token) return readStoredInvitePreview();
  const stored = readStoredInvitePreview();
  if (stored?.token === token) return stored;
  try {
    return await resolveCareCircleInvite(token);
  } catch {
    return stored;
  }
}

function applyInviteToRegister(preview) {
  const household = preview.seniorName || "a Famielda household";
  inviteNote.hidden = false;
  inviteNote.textContent = preview.accountState === "existing"
    ? `${preview.invitedByName || "A family member"} invited you to ${household}. Sign in if you already have this account.`
    : `${preview.invitedByName || "A family member"} invited you to ${household}. Create an account to join the care circle.`;
  const names = splitInviteName(preview.name);
  if (names.firstName && !form.firstName.value) form.firstName.value = names.firstName;
  if (names.lastName && !form.lastName.value) form.lastName.value = names.lastName;
  if (preview.email) {
    form.email.value = preview.email;
    form.email.readOnly = preview.channel !== "phone";
  }
  if (preview.phone) {
    setPhoneField(phoneRoot, { e164: preview.phone });
    if (preview.channel === "phone") {
      form.phone.readOnly = true;
      qs("[data-phone-country]", phoneRoot).disabled = true;
    }
  }
  const loginLink = qs("[data-invite-login-link]");
  if (loginLink) loginLink.href = inviteLoginPath(preview.token).replace(/^\//, "");
}

on(form, "submit", async (event) => {
  event.preventDefault();
  clearFieldErrors();
  const submit = form.querySelector("[type='submit']");

  const firstName = readName(form.firstName.value, "first name");
  if (!firstName.ok) {
    showError(firstName.error, form.firstName);
    return;
  }
  const lastName = readName(form.lastName.value, "last name");
  if (!lastName.ok) {
    showError(lastName.error, form.lastName);
    return;
  }

  const email = form.email.value.trim();
  if (!email) {
    showError("Enter your email.", form.email);
    return;
  }

  const phone = readPhoneField(phoneRoot);
  if (!phone.ok) {
    showError(phone.error, form.phone);
    return;
  }

  const password = form.password.value;
  const confirm = form.confirm.value;
  if (password.length < AUTH.MIN_PASSWORD_LENGTH) {
    showError(`Use at least ${AUTH.MIN_PASSWORD_LENGTH} characters.`, form.password);
    return;
  }
  if (password !== confirm) {
    showError("Passwords do not match.", form.confirm);
    return;
  }

  if (!form.terms?.checked) {
    showError("Accept the Terms & Conditions and Privacy Policy to create an account.", form.terms);
    return;
  }

  setButtonLoading(submit, true);

  try {
    const session = await register({
      firstName: firstName.value,
      lastName: lastName.value,
      email,
      password,
      phone: phone.national,
      phoneCountry: phone.iso,
    });
    const code = readStoredReferralCode();
    if (code) {
      try {
        await claimFamilyReferral(code, session);
      } catch {
        // Keep going — the account was created even if the code could not be claimed.
      }
    }
    if (usesLiveAuth() && !session.emailVerified) {
      go(routes.verifyEmail);
      return;
    }
    go(homeFor(session));
  } catch (error) {
    showError(error.message, null);
    toast(error.message, { type: "error" });
    setButtonLoading(submit, false);
  }
});
