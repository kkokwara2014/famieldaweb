import { initPasswordVisibility } from "../components/password-toggle.js";

const PLACEHOLDERS = {
  email: "you@example.com",
  password: "Enter your password",
  confirm: "Re-enter your password",
  displayName: "Your full name",
  firstName: "Sarah",
  lastName: "Walsh",
};

function placeholderFor(field) {
  if (PLACEHOLDERS[field.name]) return PLACEHOLDERS[field.name];
  if (PLACEHOLDERS[field.id]) return PLACEHOLDERS[field.id];
  const label = field.labels?.[0]?.textContent?.trim();
  if (!label) return "";
  if (field.type === "email") return "you@example.com";
  if (field.tagName === "TEXTAREA") return `Add ${label.toLowerCase()}`;
  return `Enter ${label.toLowerCase()}`;
}

export function ensurePlaceholders(root = document) {
  root.querySelectorAll("form input, form textarea").forEach((field) => {
    const skip = ["hidden", "checkbox", "radio", "submit", "button", "file"];
    if (skip.includes(field.type)) return;
    if (field.getAttribute("placeholder")?.trim()) return;
    const value = placeholderFor(field);
    if (value) field.setAttribute("placeholder", value);
  });
}

export function initFormUx(root = document) {
  ensurePlaceholders(root);
  initPasswordVisibility(root);
}
