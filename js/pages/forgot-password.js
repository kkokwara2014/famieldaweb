import { bootPublicAuth } from "../auth/public-boot.js";
import { requestPasswordReset } from "../auth/password.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";

await bootPublicAuth({ navLabel: "Log in" });

const form = qs("#forgot-form");
const errorBox = qs("#forgot-error");
const successBox = qs("#forgot-success");

on(form, "submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  successBox.hidden = true;
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);

  try {
    await requestPasswordReset(form.email.value);
    successBox.hidden = false;
    successBox.textContent = "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.";
    toast("Reset email sent if that account exists.", { type: "success" });
    form.reset();
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
});
