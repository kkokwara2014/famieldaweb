import { bootPublicAuth } from "../auth/public-boot.js";
import { login } from "../auth/login.js";
import { qs } from "../core/dom.js";
import { on } from "../core/events.js";
import { go, routes, postAuthPath } from "../config/routes.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { usesLiveAuth } from "../core/firebase.js";
import { maybeClaimStoredReferral } from "../services/referral-service.js";
import {
  inviteRegisterPath,
  persistInviteToken,
  readStoredInvitePreview,
  readStoredInviteToken,
} from "../config/invites.js";
import { resolveCareCircleInvite } from "../services/care-circle-service.js";

await bootPublicAuth({ navLabel: "Log in" });

if (usesLiveAuth()) {
  const demo = qs(".demo-note");
  if (demo) demo.hidden = true;
}

const form = qs("#login-form");
const errorBox = qs("#login-error");
const inviteNote = qs("[data-invite-note]");
const inviteToken = persistInviteToken(readStoredInviteToken());
const invitePreview = await loadInvitePreview(inviteToken);
if (invitePreview && inviteNote) {
  applyInviteToLogin(invitePreview);
}

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

function applyInviteToLogin(preview) {
  const household = preview.seniorName || "a Famielda household";
  inviteNote.hidden = false;
  inviteNote.textContent = preview.accountState === "existing"
    ? `${preview.invitedByName || "A family member"} invited you to ${household}. Sign in to join the care circle.`
    : `${preview.invitedByName || "A family member"} invited you to ${household}. Sign in if you already have a Famielda account.`;
  const email = preview.loginEmail || preview.email;
  if (email && !form.email.value) form.email.value = email;
  const registerLink = qs("[data-invite-register-link]");
  if (registerLink) registerLink.href = inviteRegisterPath(preview.token).replace(/^\//, "");
}
