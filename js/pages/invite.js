import { bootPublicAuth } from "../auth/public-boot.js";
import { initSession } from "../auth/session.js";
import { qs, escapeHtml } from "../core/dom.js";
import { go, homeFor, routes } from "../config/routes.js";
import {
  inviteKindPhrase,
  inviteLoginPath,
  inviteRegisterPath,
  maskEmail,
  maskPhone,
  persistInviteToken,
  readStoredInviteToken,
} from "../config/invites.js";
import { resolveCareCircleInvite } from "../services/care-circle-service.js";
import { requestLogout } from "../auth/logout.js";
import { INVITE_STATUS } from "../config/constants.js";

await bootPublicAuth({ redirectSignedIn: false, navLabel: "Invitation" });
const session = await initSession();
const card = qs("[data-invite-card]");
const token = persistInviteToken(readStoredInviteToken());

if (!token) {
  renderMissing();
} else {
  try {
    const preview = await resolveCareCircleInvite(token);
    if (!preview) {
      renderMissing();
    } else if (preview.status && preview.status !== INVITE_STATUS.PENDING) {
      renderClosed(preview);
    } else if (session && preview.matchesViewer) {
      go(homeFor(session));
    } else {
      renderInvite(preview);
    }
  } catch (error) {
    renderMissing(error.message);
  }
}

function renderMissing(message) {
  card.innerHTML = `
    <header>
      <p class="page-kicker">Invitation</p>
      <h1>This invite is not available</h1>
      <p>${escapeHtml(message || "The link may be incomplete, or the family may have revoked it.")}</p>
    </header>
    <div class="invite-actions">
      <a class="btn btn--primary btn--block" href="${routes.login}">Sign in to Famielda</a>
      <a class="btn btn--ghost btn--block" href="${routes.register}">Create an account</a>
    </div>
  `;
}

function renderClosed(preview) {
  const status = preview.status === INVITE_STATUS.ACCEPTED
    ? "This invitation was already accepted."
    : preview.status === INVITE_STATUS.DECLINED
      ? "This invitation was declined."
      : "This invitation is no longer open.";
  card.innerHTML = `
    <header>
      <p class="page-kicker">Invitation</p>
      <h1>You’re no longer needed on this link</h1>
      <p>${escapeHtml(status)} Sign in if you already joined, or ask the family to send a new invite.</p>
    </header>
    <div class="invite-actions">
      <a class="btn btn--primary btn--block" href="${routes.login}">Sign in</a>
    </div>
  `;
}

function renderInvite(preview) {
  const existing = preview.accountState === "existing";
  const household = preview.seniorName || "a Famielda household";
  const inviter = preview.invitedByName || "A family member";
  const role = inviteKindPhrase(preview.kind);
  const contact = preview.channel === "phone"
    ? maskPhone(preview.phone)
    : maskEmail(preview.email);
  const primaryHref = existing ? inviteLoginPath(preview.token) : inviteRegisterPath(preview.token);
  const secondaryHref = existing ? inviteRegisterPath(preview.token) : inviteLoginPath(preview.token);
  const mismatch = Boolean(session && !preview.matchesViewer);

  card.innerHTML = `
    <header>
      <p class="page-kicker">Invitation</p>
      <h1>Join ${escapeHtml(household)}’s care circle</h1>
      <p>${escapeHtml(inviter)} invited ${escapeHtml(preview.name || "you")} ${escapeHtml(role)}.</p>
    </header>
    ${mismatch ? `
      <div class="alert alert--warning" role="status">
        You’re signed in as ${escapeHtml(session.email || session.displayName || "another account")}. This invite is for a different contact.
        <button class="btn btn--ghost btn--sm" type="button" data-invite-switch>Use a different account</button>
      </div>
    ` : ""}
    <dl class="invite-detail">
      <div>
        <dt>Household</dt>
        <dd>${escapeHtml(household)}</dd>
      </div>
      <div>
        <dt>Invited by</dt>
        <dd>${escapeHtml(inviter)}</dd>
      </div>
      ${preview.relationship ? `
        <div>
          <dt>Relationship</dt>
          <dd>${escapeHtml(preview.relationship)}</dd>
        </div>
      ` : ""}
      ${contact ? `
        <div>
          <dt>${preview.channel === "phone" ? "Phone" : "Email"}</dt>
          <dd>${escapeHtml(contact)}</dd>
        </div>
      ` : ""}
    </dl>
    ${preview.message ? `<p>${escapeHtml(preview.message)}</p>` : ""}
    <div class="invite-actions">
      <a class="btn btn--primary btn--block" href="${primaryHref}">
        ${existing ? "Sign in to join" : "Create an account to join"}
      </a>
      <a class="auth-switch" href="${secondaryHref}">
        ${existing ? "Need a new account instead?" : "Already have an account? Sign in"}
      </a>
    </div>
  `;

  card.querySelector("[data-invite-switch]")?.addEventListener("click", async () => {
    await requestLogout();
  });
}
