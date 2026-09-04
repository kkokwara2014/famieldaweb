/**
 * Outbound email for Famielda Cloud Functions.
 * SMTP credentials stay in Secret Manager — never in client JavaScript.
 *
 *   firebase functions:secrets:set MAIL_SMTP_USER
 *   firebase functions:secrets:set MAIL_SMTP_PASS
 */

const nodemailer = require("nodemailer");
const { HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { logger } = require("firebase-functions");

const SUPPORT_INBOX = "support@famielda.org";
const SEND_FAILED_MESSAGE = "We couldn't send your message right now. Please try again or contact Famielda directly at support@famielda.org.";

const mailSmtpUser = defineSecret("MAIL_SMTP_USER");
const mailSmtpPass = defineSecret("MAIL_SMTP_PASS");
const mailSmtpHost = defineString("MAIL_SMTP_HOST", {
  description: "SMTP host used to deliver contact-form mail",
  default: "smtp.gmail.com",
});
const mailSmtpPort = defineString("MAIL_SMTP_PORT", {
  description: "SMTP port (465 SSL or 587 STARTTLS)",
  default: "465",
});
const mailFrom = defineString("MAIL_FROM", {
  description: "From header for contact-form mail",
  default: "Famielda <support@famielda.org>",
});

exports.SUPPORT_INBOX = SUPPORT_INBOX;
exports.SEND_FAILED_MESSAGE = SEND_FAILED_MESSAGE;
exports.secrets = [mailSmtpUser, mailSmtpPass];
exports.contactOptions = {
  invoker: "public",
  secrets: [mailSmtpUser, mailSmtpPass],
};

function secretValue(param) {
  try {
    return String(param.value() || "").trim();
  } catch {
    return "";
  }
}

function stringValue(param, fallback = "") {
  try {
    const value = String(param.value() || "").trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headerSafe(value) {
  return String(value || "").replace(/[\r\n\0]+/g, " ").trim();
}

function plainSafe(value) {
  return String(value || "").replace(/\0/g, "").replace(/\r\n/g, "\n").trim();
}

function rowHtml(label, value) {
  if (!value) return "";
  return `<tr>
    <th style="text-align:left;vertical-align:top;padding:8px 12px 8px 0;color:#5E35B1;font-weight:600;white-space:nowrap">${escapeHtml(label)}</th>
    <td style="padding:8px 0;color:#1f1633;white-space:pre-wrap">${escapeHtml(value)}</td>
  </tr>`;
}

function rowText(label, value) {
  if (!value) return "";
  return `${label}: ${value}`;
}

function buildBodies(enquiry) {
  const submittedAt = enquiry.submittedAt || new Date().toISOString();
  const fields = [
    ["Name", enquiry.name],
    ["Email", enquiry.email],
    ["Phone", enquiry.phone],
    ["I am", enquiry.role],
    ["Topic", enquiry.category],
    ["Subject", enquiry.subject],
    ["Message", enquiry.body],
    ["Submitted", submittedAt],
    ["Page", enquiry.pageUrl],
  ];
  const text = [
    "A new Famielda contact-form enquiry was submitted.",
    "",
    ...fields.map(([label, value]) => rowText(label, plainSafe(value))).filter(Boolean),
    "",
    "Reply directly to this email to reach the sender.",
  ].join("\n");
  const html = `<div style="font-family:Poppins,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f1633">
  <p style="margin:0 0 16px">A new Famielda contact-form enquiry was submitted.</p>
  <table style="border-collapse:collapse;width:100%;max-width:640px">${fields.map(([label, value]) => rowHtml(label, value)).join("")}</table>
  <p style="margin:16px 0 0;color:#6b6280;font-size:13px">Reply directly to this email to reach the sender.</p>
</div>`;
  return { text, html };
}

function createTransport() {
  const user = secretValue(mailSmtpUser);
  const pass = secretValue(mailSmtpPass);
  if (!user || !pass) {
    logger.error("Contact email SMTP secrets are not configured.");
    throw new HttpsError("failed-precondition", SEND_FAILED_MESSAGE);
  }
  const port = Number(stringValue(mailSmtpPort, "465")) || 465;
  return nodemailer.createTransport({
    host: stringValue(mailSmtpHost, "smtp.gmail.com"),
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

exports.sendContactEnquiry = async (enquiry = {}) => {
  const to = SUPPORT_INBOX;
  const replyTo = headerSafe(enquiry.email);
  if (!replyTo) {
    throw new HttpsError("invalid-argument", "Enter a valid email so we can reply.");
  }
  const subject = headerSafe(enquiry.subject) || "Website enquiry";
  const { text, html } = buildBodies(enquiry);
  const transporter = createTransport();
  try {
    const info = await transporter.sendMail({
      from: headerSafe(stringValue(mailFrom, `Famielda <${SUPPORT_INBOX}>`)) || `Famielda <${SUPPORT_INBOX}>`,
      to,
      replyTo,
      subject: `[Famielda] ${subject}`.slice(0, 180),
      text,
      html,
      headers: {
        "X-Famielda-Mail": "contact-form",
      },
    });
    if (Array.isArray(info.rejected) && info.rejected.length) {
      throw new Error("rejected");
    }
  } catch (error) {
    logger.error("Contact email delivery failed", { code: error.code || "" });
    throw new HttpsError("unavailable", SEND_FAILED_MESSAGE);
  }
  logger.info("Contact email delivered");
  return { ok: true };
};
