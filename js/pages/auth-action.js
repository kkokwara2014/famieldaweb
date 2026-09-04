import { bootPublicAuth } from "../auth/public-boot.js";
import { inspectResetCode, completePasswordReset } from "../auth/password.js";
import { applyEmailVerification, applyAccountAction } from "../auth/email-verification.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { go, routes, sameOriginContinue } from "../config/routes.js";
import { AUTH } from "../config/constants.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { usesLiveAuth } from "../core/firebase.js";

await bootPublicAuth({ redirectSignedIn: false });

const params = actionParams();
const mode = params.get("mode");
const oobCode = params.get("oobCode");
const continueUrl = sameOriginContinue(params.get("continueUrl"), "");

const statusPanel = qs("#status-panel");
const resetPanel = qs("#reset-panel");
const messagePanel = qs("#message-panel");
const errorBox = qs("#action-error");
const successBox = qs("#action-success");
const title = qs("[data-action-title]");
const lead = qs("[data-action-lead]");

function actionParams() {
  const search = new URLSearchParams(window.location.search);
  if (search.get("mode") || search.get("oobCode")) return search;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash);
}

function showError(message) {
  statusPanel.hidden = true;
  resetPanel.hidden = true;
  messagePanel.hidden = false;
  errorBox.hidden = false;
  successBox.hidden = true;
  errorBox.textContent = message;
  title.textContent = "This link cannot be used";
  lead.textContent = "Request a new email from Famielda and try again.";
}

function showSuccess(heading, body) {
  statusPanel.hidden = true;
  resetPanel.hidden = true;
  messagePanel.hidden = false;
  errorBox.hidden = true;
  successBox.hidden = false;
  successBox.textContent = body;
  title.textContent = heading;
  lead.textContent = "You can return to your Famielda account now.";
}

async function handleResetPassword() {
  title.textContent = "Choose a new password";
  lead.textContent = "This password signs you in on Famielda Web and Famielda Mobile.";

  if (!usesLiveAuth()) {
    showError("Connect Firebase Authentication to finish a live password reset.");
    return;
  }

  const { email } = await inspectResetCode(oobCode);
  statusPanel.hidden = true;
  resetPanel.hidden = false;
  qs("[data-reset-email]").textContent = email;

  const form = qs("#reset-form");
  on(form, "submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const password = form.password.value;
    const confirm = form.confirm.value;
    if (password.length < AUTH.MIN_PASSWORD_LENGTH) {
      errorBox.hidden = false;
      errorBox.textContent = `Use at least ${AUTH.MIN_PASSWORD_LENGTH} characters.`;
      return;
    }
    if (password !== confirm) {
      errorBox.hidden = false;
      errorBox.textContent = "Passwords do not match.";
      return;
    }

    const submit = form.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await completePasswordReset(oobCode, password);
      toast("Password updated. Sign in with the new password.", { type: "success" });
      go(continueUrl || routes.login);
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
      toast(error.message, { type: "error" });
      setButtonLoading(submit, false);
    }
  });
}

async function handleVerifyEmail() {
  await applyEmailVerification(oobCode);
  showSuccess("Email verified", "This Famielda account can now open the care workspace on web and mobile.");
  window.setTimeout(() => go(continueUrl || routes.login), 1400);
}

async function handleRecoverEmail() {
  await applyAccountAction(oobCode);
  showSuccess("Email restored", "The previous email on this account is active again. Sign in with that address.");
}

try {
  if (!mode || !oobCode) {
    showError("This page is waiting for a valid email link from Famielda.");
  } else if (mode === "resetPassword") {
    await handleResetPassword();
  } else if (mode === "verifyEmail") {
    await handleVerifyEmail();
  } else if (mode === "recoverEmail") {
    await handleRecoverEmail();
  } else {
    showError("Famielda does not handle this type of email action.");
  }
} catch (error) {
  showError(error.message);
  toast(error.message, { type: "error" });
}
