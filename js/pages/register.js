import { bootPublicAuth } from "../auth/public-boot.js";
import { register } from "../auth/register.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { go, homeFor, routes } from "../config/routes.js";
import { AUTH } from "../config/constants.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { bindPhoneField, readPhoneField } from "../components/phone-field.js";
import { usesLiveAuth } from "../core/firebase.js";
import { persistReferralCode, readStoredReferralCode } from "../config/referrals.js";
import { claimFamilyReferral, resolveFamilyReferralCode } from "../services/referral-service.js";

await bootPublicAuth({ navLabel: "register" });

const form = qs("#register-form");
const errorBox = qs("#register-error");
const referralNote = qs("[data-referral-note]");
const phoneRoot = qs("[data-phone-field]");
const storedCode = persistReferralCode(readStoredReferralCode());
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}'’. \-]{0,39}$/u;

bindPhoneField(phoneRoot);

if (storedCode && referralNote) {
  const preview = await resolveFamilyReferralCode(storedCode);
  referralNote.hidden = false;
  referralNote.textContent = preview?.referrerName
    ? `${preview.referrerName} invited you to Famielda. Create an account to start your own household.`
    : "You are joining from a family invite. Create an account to start your own household.";
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
