import "./marketing.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on } from "../core/events.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { submitPublicContactRequest } from "../services/admin-service.js";
import {
  CONTACT_ROLES,
  CONTACT_SEND_FAILED_MESSAGE,
  CONTACT_SUCCESS_MESSAGE,
  CONTACT_TOPICS,
  SUPPORT_EMAIL,
} from "../config/marketing.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\d.\s-]{7,40}$/;
const ALLOWED_ROLES = new Set(CONTACT_ROLES.map((item) => item.id));
const ALLOWED_TOPICS = new Set(CONTACT_TOPICS.map((item) => item.id));

const form = qs("#contact-form");
const errorBox = qs("#contact-error");
const successBox = qs("#contact-success");
if (!form) throw new Error("Contact form is missing.");

function showError(message, field) {
  errorBox.hidden = false;
  errorBox.textContent = message;
  field?.closest(".field")?.classList.add("is-invalid");
  field?.focus();
}

function showSendFailure() {
  errorBox.hidden = false;
  errorBox.innerHTML = `We couldn't send your message right now. Please try again or contact Famielda directly at <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a>.`;
}

function clearAlerts() {
  errorBox.hidden = true;
  errorBox.textContent = "";
  successBox.hidden = true;
  form.querySelectorAll(".field.is-invalid").forEach((field) => field.classList.remove("is-invalid"));
}

function readContactPayload() {
  const name = String(form.name.value || "").trim().replace(/\s+/g, " ");
  const email = String(form.email.value || "").trim().toLowerCase();
  const phone = String(form.phone?.value || "").trim();
  const role = String(form.role?.value || "").trim();
  const category = String(form.category?.value || "general").trim();
  const subject = String(form.subject.value || "").trim();
  const body = String(form.body.value || "").trim();
  const website = String(form.website?.value || "").trim();

  if (!name) return { error: "Your name is required.", field: form.name };
  if (name.length < 2) return { error: "Enter your name.", field: form.name };
  if (name.length > 120) return { error: "Use a shorter name.", field: form.name };
  if (!email) return { error: "Enter a valid email so we can reply.", field: form.email };
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { error: "Enter a valid email so we can reply.", field: form.email };
  }
  if (phone && !PHONE_PATTERN.test(phone)) {
    return { error: "Enter a valid phone number, or leave it blank.", field: form.phone };
  }
  if (role && !ALLOWED_ROLES.has(role)) {
    return { error: "That role is not valid.", field: form.role };
  }
  if (category && !ALLOWED_TOPICS.has(category)) {
    return { error: "That topic is not valid.", field: form.category };
  }
  if (!subject || subject.length < 4) {
    return { error: "Give the message a short subject.", field: form.subject };
  }
  if (subject.length > 140) return { error: "Use a shorter subject.", field: form.subject };
  if (!body || body.length < 12) {
    return { error: "Add a bit more detail so we can help.", field: form.body };
  }
  if (body.length > 4000) return { error: "Use a shorter message.", field: form.body };

  return {
    payload: {
      name,
      email,
      phone,
      role,
      category,
      subject,
      body,
      website,
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    },
  };
}

function isSendFailure(message) {
  const text = String(message || "");
  return text === CONTACT_SEND_FAILED_MESSAGE
    || /couldn't send your message/i.test(text)
    || /Cloud Functions need a configured Firebase project/i.test(text)
    || /not available in this browser session/i.test(text)
    || /That request could not be completed/i.test(text);
}

on(form, "submit", async (event) => {
  event.preventDefault();
  clearAlerts();
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  const parsed = readContactPayload();
  if (parsed.error) {
    showError(parsed.error, parsed.field);
    toast(parsed.error, { type: "error" });
    setButtonLoading(submit, false);
    return;
  }

  try {
    const result = await submitPublicContactRequest(parsed.payload);
    if (!result?.ok) {
      showSendFailure();
      toast(CONTACT_SEND_FAILED_MESSAGE, { type: "error" });
      return;
    }
    form.reset();
    successBox.hidden = false;
    successBox.textContent = CONTACT_SUCCESS_MESSAGE;
    toast(CONTACT_SUCCESS_MESSAGE, { type: "success" });
  } catch (error) {
    const message = error.message || CONTACT_SEND_FAILED_MESSAGE;
    if (isSendFailure(message)) {
      showSendFailure();
    } else {
      showError(message);
    }
    toast(message, { type: "error" });
  } finally {
    setButtonLoading(submit, false);
  }
});
