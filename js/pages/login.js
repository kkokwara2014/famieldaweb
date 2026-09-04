import { bootPublicAuth } from "../auth/public-boot.js";
import { login } from "../auth/login.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { go, routes, postAuthPath } from "../config/routes.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { usesLiveAuth } from "../core/firebase.js";
import { maybeClaimStoredReferral } from "../services/referral-service.js";

await bootPublicAuth({ navLabel: "Log in" });

if (usesLiveAuth()) {
  const demo = qs(".demo-note");
  if (demo) demo.hidden = true;
}

const form = qs("#login-form");
const errorBox = qs("#login-error");

on(form, "submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);

  const payload = {
    email: form.email.value.trim(),
    password: form.password.value,
    remember: Boolean(form.remember?.checked),
  };

  try {
    const session = await login(payload);
    if (usesLiveAuth() && !session.emailVerified) {
      go(routes.verifyEmail);
      return;
    }
    await maybeClaimStoredReferral(session).catch(() => null);
    go(postAuthPath(session));
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    toast(error.message, { type: "error" });
    setButtonLoading(submit, false);
  }
});
