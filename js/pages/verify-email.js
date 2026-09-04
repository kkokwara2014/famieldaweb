import { mountPublicNav } from "../components/navbar.js";
import { mountPublicFooter } from "../components/footer.js";
import { requireUnverifiedSession } from "../guards/auth-guard.js";
import { sendVerificationEmail } from "../auth/email-verification.js";
import { refreshSession } from "../auth/session.js";
import { requestLogout } from "../auth/logout.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { go, homeFor } from "../config/routes.js";
import { AUTH } from "../config/constants.js";
import { initFormUx } from "../core/forms.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";

initFormUx();
mountPublicNav();
mountPublicFooter();

const session = await requireUnverifiedSession();

qs("[data-verify-email]").textContent = session.email;

const errorBox = qs("#verify-error");
const successBox = qs("#verify-success");
const resend = qs("[data-resend]");
const refresh = qs("[data-refresh]");
let cooldownUntil = 0;

function setCooldown() {
  cooldownUntil = Date.now() + AUTH.RESEND_COOLDOWN_MS;
  resend.disabled = true;
  const tick = () => {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      resend.disabled = false;
      resend.textContent = "Resend verification email";
      return;
    }
    resend.textContent = `Resend available in ${remaining}s`;
    window.setTimeout(tick, 1000);
  };
  tick();
}

async function continueIfVerified() {
  const next = await refreshSession();
  if (next?.emailVerified) {
    go(homeFor(next));
    return true;
  }
  return false;
}

on(resend, "click", async () => {
  errorBox.hidden = true;
  successBox.hidden = true;
  setButtonLoading(resend, true);
  try {
    const result = await sendVerificationEmail();
    if (result.alreadyVerified) {
      go(homeFor(await refreshSession()));
      return;
    }
    successBox.hidden = false;
    successBox.textContent = "A new verification email is on its way.";
    toast("Verification email sent.", { type: "success" });
    setCooldown();
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(resend, false);
    if (Date.now() < cooldownUntil) resend.disabled = true;
  }
});

on(refresh, "click", async () => {
  errorBox.hidden = true;
  setButtonLoading(refresh, true);
  try {
    const verified = await continueIfVerified();
    if (!verified) {
      errorBox.hidden = false;
      errorBox.textContent = "Famielda has not seen the verification yet. Open the email, then try again.";
    }
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(refresh, false);
  }
});

on(qs("[data-sign-out]"), "click", () => requestLogout());

on(document, "visibilitychange", () => {
  if (document.visibilityState === "visible") {
    continueIfVerified();
  }
});
