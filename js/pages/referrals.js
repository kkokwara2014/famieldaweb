import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { emptyState } from "../components/empty-state.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { confirmDialog } from "../components/modal.js";
import {
  FAMILY_REFERRAL_RELATIONSHIPS,
  referralChannelLabel,
  referralStatusBadge,
  referralStatusLabel,
} from "../config/referrals.js";
import { FAMILY_REFERRAL_STATUS } from "../config/constants.js";
import {
  getFamilyReferralWorkspace,
  inviteFamilyRelative,
  resendFamilyReferral,
  revokeFamilyReferral,
} from "../services/referral-service.js";

const session = await bootApp({ page: "referrals", title: "Invite your family" });
const root = qs("[data-referrals-page]");

let state = await getFamilyReferralWorkspace(session);

bindPage();
render();

function bindPage() {
  on(root, "submit", async (event) => {
    const form = event.target.closest("[data-invite-form]");
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector("[type='submit']");
    const name = form.name.value.trim();
    setButtonLoading(submit, true);
    try {
      state = await inviteFamilyRelative({
        name,
        email: form.email.value.trim(),
        relationship: form.relationship.value,
        message: form.message.value.trim(),
      });
      form.reset();
      if (form.relationship) form.relationship.value = FAMILY_REFERRAL_RELATIONSHIPS[0];
      toast(`Invite sent to ${name}.`, { type: "success" });
      render();
    } catch (error) {
      toast(error.message, { type: "error" });
    } finally {
      setButtonLoading(submit, false);
    }
  });

  delegate(root, "click", "[data-copy-link]", async () => {
    try {
      await navigator.clipboard.writeText(state.shareUrl);
      toast("Invite link copied.", { type: "success" });
    } catch {
      toast("Copy the link from the field.", { type: "info" });
    }
  });

  delegate(root, "click", "[data-copy-code]", async () => {
    try {
      await navigator.clipboard.writeText(state.profile?.code || "");
      toast("Referral code copied.", { type: "success" });
    } catch {
      toast("Copy the code from the page.", { type: "info" });
    }
  });

  delegate(root, "click", "[data-share-link]", async () => {
    if (!navigator.share) {
      toast("Copy the link and send it in a message.", { type: "info" });
      return;
    }
    try {
      await navigator.share({
        title: "Join me on Famielda",
        text: `${session.displayName.split(" ")[0]} invited you to Famielda — one workspace for family care.`,
        url: state.shareUrl,
      });
    } catch (error) {
      if (error?.name !== "AbortError") toast(error.message || "Could not open share sheet.", { type: "error" });
    }
  });

  delegate(root, "click", "[data-resend-referral]", async (_event, button) => {
    setButtonLoading(button, true);
    try {
      state = await resendFamilyReferral(button.dataset.resendReferral);
      toast("Invite sent again.", { type: "success" });
      render();
    } catch (error) {
      toast(error.message, { type: "error" });
      setButtonLoading(button, false);
    }
  });

  delegate(root, "click", "[data-revoke-referral]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Revoke this family invite?",
      body: "They will no longer be able to join Famielda with this invitation. Your share link still works for other relatives.",
      confirmLabel: "Revoke invite",
      danger: true,
    });
    if (!confirmed) return;
    setButtonLoading(button, true);
    try {
      state = await revokeFamilyReferral(button.dataset.revokeReferral);
      toast("Invitation revoked.", { type: "success" });
      render();
    } catch (error) {
      toast(error.message, { type: "error" });
      setButtonLoading(button, false);
    }
  });
}

function render() {
  const counts = state.counts || {};
  root.innerHTML = `
    <div class="welcome">
      <div>
        <p class="page-kicker">Module 30 — Family referral</p>
        <h2>Invite your family</h2>
        <p class="page-lead">Ask relatives to create their own Famielda account. This is not the same as adding someone to a senior’s care circle.</p>
      </div>
    </div>

    <div class="alert alert--info referral-trial" role="status">${escapeHtml(state.trial?.copy || "")}</div>

    <div class="stat-grid">
      <article class="stat-card">
        <p class="stat-card__label">Invited</p>
        <p class="stat-card__value">${counts.invited || 0}</p>
        <p class="stat-card__hint">Relatives asked to join</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Waiting</p>
        <p class="stat-card__value">${counts.pending || 0}</p>
        <p class="stat-card__hint">Have not created an account</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Joined</p>
        <p class="stat-card__value">${counts.joined || 0}</p>
        <p class="stat-card__hint">Used your invite</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Successful</p>
        <p class="stat-card__value">${counts.successful || 0}</p>
        <p class="stat-card__hint">Joined as family</p>
      </article>
    </div>

    <div class="referral-share">
      <section class="card">
        <h2>Your invite link</h2>
        <p class="person__meta">Share this so a relative can create their own Famielda household. Use Care Circle when you want them on this senior’s record instead.</p>
        <div class="referral-code">
          <span class="badge badge--brand">Code</span>
          <strong>${escapeHtml(state.profile?.code || "—")}</strong>
          <button class="btn btn--ghost btn--sm" type="button" data-copy-code>Copy code</button>
        </div>
        <div class="referral-share-row">
          <input id="referral-link" value="${escapeHtml(state.shareUrl || "")}" readonly aria-label="Family invite link">
          <button class="btn btn--primary" type="button" data-copy-link>Copy link</button>
        </div>
        <div class="referral-share-actions">
          <button class="btn btn--ghost" type="button" data-share-link>Share</button>
          <a class="btn btn--ghost" href="care-circle.html">Add someone to this circle</a>
        </div>
      </section>

      <section class="card">
        <h2>Email a relative</h2>
        <p class="person__meta">They get your code and a link to create an account.</p>
        <form class="form" data-invite-form>
          <div class="field">
            <label for="referral-name">Full name</label>
            <input id="referral-name" name="name" required maxlength="80" placeholder="Daniel Harper">
          </div>
          <div class="field">
            <label for="referral-email">Email</label>
            <input id="referral-email" name="email" type="email" required placeholder="daniel.harper@example.com">
          </div>
          <div class="field">
            <label for="referral-relationship">Relationship</label>
            <select id="referral-relationship" name="relationship" class="select" required>
              ${FAMILY_REFERRAL_RELATIONSHIPS.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="referral-message">Note <span class="hint">(optional)</span></label>
            <textarea id="referral-message" name="message" rows="3" maxlength="500" placeholder="Why you want them on Famielda"></textarea>
          </div>
          <button class="btn btn--primary" type="submit">Send family invite</button>
        </form>
      </section>
    </div>

    <section class="card">
      <div class="card__header">
        <h2>Invites you sent</h2>
      </div>
      ${renderList()}
    </section>

    <p class="person__meta referral-note">To put a relative on this senior’s circle — schedule, medications, messages — invite them from <a href="care-circle.html">Care Circle</a>.</p>
  `;
}

function renderList() {
  const items = state.referrals || [];
  if (!items.length) {
    return emptyState({
      title: "No family invites yet",
      body: "Copy your link or email a relative so they can start their own Famielda household.",
      compact: true,
    });
  }
  return `
    <ul class="list referral-list">
      ${items.map((item) => `
        <li class="list__item referral-card">
          <div>
            <strong>${escapeHtml(item.name || item.email || "Relative")}</strong>
            <p class="person__meta">${escapeHtml(item.email || "Share link")}${item.relationship ? ` · ${escapeHtml(item.relationship)}` : ""} · ${escapeHtml(referralChannelLabel(item.channel))}</p>
            ${item.message ? `<p class="person__meta">${escapeHtml(item.message)}</p>` : ""}
          </div>
          <div class="referral-card__actions">
            <span class="badge ${referralStatusBadge(item.status)}">${escapeHtml(referralStatusLabel(item.status))}</span>
            ${item.status === FAMILY_REFERRAL_STATUS.PENDING ? `
              <button class="btn btn--ghost btn--sm" type="button" data-resend-referral="${escapeHtml(item.id)}">Invite again</button>
              <button class="btn btn--ghost btn--sm" type="button" data-revoke-referral="${escapeHtml(item.id)}">Revoke</button>
            ` : ""}
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}
