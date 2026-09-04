import "./marketing.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { submitPublicContactRequest } from "../services/admin-service.js";

const form = qs("#contact-form");
const errorBox = qs("#contact-error");
const successBox = qs("#contact-success");
if (!form) throw new Error("Contact form is missing.");

on(form, "submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  successBox.hidden = true;
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);

  try {
    await submitPublicContactRequest({
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      role: form.role?.value || "",
      category: form.category?.value || "general",
      subject: form.subject.value.trim(),
      body: form.body.value.trim(),
      website: form.website?.value || "",
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    });
    form.reset();
    successBox.hidden = false;
    successBox.textContent = "Message received. Famielda operations will reply to the email you gave.";
    toast("Message sent.", { type: "success" });
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    toast(error.message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
});
