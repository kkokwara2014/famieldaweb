import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { initFormUx } from "../core/forms.js";
import { getSession } from "../auth/session.js";
import { CARE_CIRCLE_ROLES, CIRCLE_KINDS, CIRCLE_STATUS } from "../config/constants.js";
import {
  CIRCLE_KIND_OPTIONS,
  CIRCLE_PERMISSION_OPTIONS,
  CIRCLE_ROLE_OPTIONS,
  CirclePlanError,
  defaultProfessionalType,
  defaultRelationship,
  kindLabel,
  kindOption,
  permissionSummary,
  permissionsForRole,
  professionalRoleForKind,
  relationshipsFor,
  roleLabel,
  statusBadge,
  statusLabel,
} from "../config/care-circle.js";
import {
  canInviteKind,
  entitlementMessage,
  isPlusPlan,
} from "../services/entitlement-service.js";
import { professionalTypeLabel, professionalTypesFor } from "../config/roles.js";
import { avatarHtml } from "../components/avatar.js";
import { emptyState } from "../components/empty-state.js";
import { bindPhoneField, readPhoneField } from "../components/phone-field.js";
import {
  careCircleInviteUrl,
  inviteEmailSubject,
  inviteShareText,
  mailtoInviteHref,
  smsInviteHref,
} from "../config/invites.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { bindModal, closeModal, openModal, confirmDialog } from "../components/modal.js";
import { initDropdowns } from "../components/dropdown.js";
import { initTabs } from "../components/tabs.js";
import { focusDeepLink } from "../notifications/deep-link.js";
import {
  acceptInvitation,
  declineInvitation,
  getCareCircleState,
  inviteCareCircleMember,
  removeCircleMember,
  resendInvitation,
  revokeInvitation,
  updateCircleMember,
} from "../services/care-circle-service.js";
import { verificationChipHtml } from "../components/verification-banner.js";

const session = await bootApp({ page: "care-circle" });
const root = qs("[data-circle-page]");
const inviteForm = qs("[data-invite-form]");
const inviteCompose = qs("[data-invite-compose]");
const inviteSent = qs("[data-invite-sent]");
const invitePhoneField = qs("[data-invite-phone-field]");
const permissionsForm = qs("[data-permissions-form]");
const inviteToken = new URLSearchParams(window.location.search).get("invite") || "";

let state = await getCareCircleState(session, { inviteToken });
let filter = "all";
let latestInviteShare = null;

bindModal("invite");
bindModal("permissions");
bindModal("upgrade");
bindPhoneField(invitePhoneField);
bindPage();
render();

function bindPage() {
  delegate(root, "click", "[data-invite-kind]", (_event, button) => {
    const kind = button.dataset.inviteKind;
    if (!canInviteKind(kind, { session: state.session, members: state.members, planId: state.plan.id, senior: state.senior })) {
      openUpgrade(
        kind === CIRCLE_KINDS.PRACTITIONER
          ? entitlementMessage("practitioner")
          : kind === CIRCLE_KINDS.CAREGIVER
            ? entitlementMessage("caregiver")
            : entitlementMessage("familyMember"),
      );
      return;
    }
    openInvite(kind);
  });

  delegate(root, "click", "[data-accept-invite]", async (_event, button) => {
    await runAction(button, () => acceptInvitation(button.dataset.acceptInvite), "You’re in the circle.");
  });

  delegate(root, "click", "[data-decline-invite]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Decline this invitation?",
      body: "You will not join this household. The family can send another invite later.",
      confirmLabel: "Decline invite",
      danger: true,
    });
    if (!confirmed) return;
    await runAction(button, () => declineInvitation(button.dataset.declineInvite), "Invitation declined.");
  });

  delegate(root, "click", "[data-copy-invite-link]", async (_event, button) => {
    const token = button.dataset.copyInviteLink;
    if (!token) return;
    await copyText(careCircleInviteUrl(token), "Invite link copied.");
  });

  delegate(root, "click", "[data-resend-invite]", async (_event, button) => {
    await runAction(button, () => resendInvitation(button.dataset.resendInvite), "Invite sent again. Share the link if they still need it.");
  });

  delegate(root, "click", "[data-revoke-invite]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Revoke this invitation?",
      body: "They will no longer be able to join with this invite.",
      confirmLabel: "Revoke invite",
      danger: true,
    });
    if (!confirmed) return;
    await runAction(button, () => revokeInvitation(button.dataset.revokeInvite), "Invitation revoked.");
  });

  delegate(root, "click", "[data-remove-member]", async (_event, button) => {
    const member = state.members.find((item) => item.id === button.dataset.removeMember)
      ?? state.declined.find((item) => item.id === button.dataset.removeMember);
    if (!member) return;
    const confirmed = await confirmDialog({
      title: `Remove ${member.name}?`,
      body: "They will lose access to this senior’s circle, week, and record.",
      confirmLabel: "Remove from circle",
      danger: true,
    });
    if (!confirmed) return;
    await runAction(button, () => removeCircleMember(member.id), `${member.name} was removed.`);
  });

  delegate(root, "click", "[data-edit-permissions]", (_event, button) => {
    const member = state.members.find((item) => item.id === button.dataset.editPermissions);
    if (member) openPermissions(member);
  });

  on(root, "tabchange", (event) => {
    filter = event.detail.id;
    renderGrid();
  });

  on(inviteForm, "change", (event) => {
    if (event.target.name === "channel") syncInviteChannel();
  });

  on(inviteForm, "submit", async (event) => {
    event.preventDefault();
    const submit = inviteForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      const payload = invitePayload(inviteForm);
      const result = await inviteCareCircleMember(payload);
      showInviteSent(result);
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(inviteSent, "click", async (event) => {
    const copy = event.target.closest("[data-copy-invite-share]");
    if (copy) {
      await copyText(qs("[data-invite-share-url]", inviteSent)?.value, "Invite link copied.");
      return;
    }
    const share = event.target.closest("[data-native-share-invite]");
    if (share) {
      await shareInviteLink(latestInviteShare);
      return;
    }
    const another = event.target.closest("[data-invite-another]");
    if (another) {
      resetInviteModal(inviteForm.kind.value || CIRCLE_KINDS.FAMILY);
    }
  });

  on(permissionsForm, "submit", async (event) => {
    event.preventDefault();
    const submit = permissionsForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await updateCircleMember(permissionsForm.memberId.value, {
        role: permissionsForm.role.value,
        relationship: permissionsForm.relationship.value,
        permissions: checkedPermissions(permissionsForm),
      });
      closeModal("permissions");
      toast("Permissions updated.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(permissionsForm.elements.namedItem("role"), "change", () => {
    fillPermissionChecks(permissionsForRole(permissionsForm.role.value));
  });
}

async function runAction(button, action, success) {
  setButtonLoading(button, true);
  try {
    await action();
    toast(success, { type: "success" });
    await reload();
  } catch (error) {
    handleError(error);
    setButtonLoading(button, false);
  }
}

async function reload() {
  state = await getCareCircleState(getSession() ?? session, { inviteToken });
  render();
}

function handleError(error) {
  if (error instanceof CirclePlanError && error.upgrade) {
    openUpgrade(error.message);
    return;
  }
  toast(error.message || "Something went wrong.", { type: "error" });
}

function openUpgrade(message) {
  qs("[data-upgrade-body]").textContent = message;
  openModal("upgrade");
}

function capacityMessage() {
  const max = state.usage.family?.max ?? state.usage.max ?? 2;
  return `Free includes ${max} family members. Upgrade to Famielda Plus to add the rest of the household.`;
}

function openInvite(kind) {
  resetInviteModal(kind);
  openModal("invite");
}

function resetInviteModal(kind) {
  const option = kindOption(kind);
  const types = professionalTypesFor(professionalRoleForKind(kind));
  qs("#invite-title").textContent = `Invite ${option.label.toLowerCase()}`;
  qs("[data-invite-lead]").textContent = `${option.description} They accept before they can see the household record.`;
  inviteForm.reset();
  inviteForm.kind.value = kind;
  inviteForm.channel.value = "email";
  inviteForm.role.innerHTML = CIRCLE_ROLE_OPTIONS.map((item) => (
    `<option value="${item.id}">${escapeHtml(item.label)}</option>`
  )).join("");
  inviteForm.role.value = CARE_CIRCLE_ROLES.MEMBER;
  fillRelationshipSelect(inviteForm.relationship, kind, defaultRelationship(kind));
  const typeField = qs("[data-professional-field]");
  typeField.hidden = !types.length;
  inviteForm.professionalType.innerHTML = types.map((item) => (
    `<option value="${item.id}">${escapeHtml(item.label)}</option>`
  )).join("");
  inviteForm.professionalType.required = Boolean(types.length);
  if (types.length) inviteForm.professionalType.value = defaultProfessionalType(kind);
  latestInviteShare = null;
  inviteCompose.hidden = false;
  inviteSent.hidden = true;
  syncInviteChannel();
}

function syncInviteChannel() {
  const channel = inviteForm.channel.value === "phone" ? "phone" : "email";
  const emailField = qs("[data-invite-email-field]");
  emailField.hidden = channel === "phone";
  invitePhoneField.hidden = channel !== "phone";
  inviteForm.email.required = channel === "email";
  inviteForm.phone.required = channel === "phone";
  if (channel === "phone") inviteForm.email.value = "";
}

function showInviteSent(result) {
  const invite = result.invite || {};
  const member = result.member || {};
  const url = result.shareUrl || careCircleInviteUrl(invite.token);
  const existing = (result.accountState || invite.accountState) === "existing";
  const channel = invite.channel === "phone" || (invite.phone && !invite.email) ? "phone" : "email";
  latestInviteShare = {
    url,
    name: member.name || invite.name || "",
    email: invite.email || member.email || "",
    phone: invite.phone || member.phone || "",
    channel,
    seniorName: state.senior?.displayName || "",
    invitedByName: state.session?.displayName || "",
    kind: member.kind || invite.kind || inviteForm.kind.value,
  };
  qs("#invite-title").textContent = existing ? "They already have an account" : "Share this invite";
  qs("[data-invite-lead]").textContent = existing
    ? `${member.name || "This person"} already has a Famielda account. Share the sign-in link so they can join this household.`
    : `${member.name || "This person"} is new to Famielda. Share the sign-up link so they can create an account and join.`;
  qs("[data-invite-sent-kicker]").textContent = existing ? "Sign-in link" : "Sign-up link";
  qs("[data-invite-sent-lead]").textContent = existing
    ? "If they are already signed in on another device, they will also see this invitation in Care Circle."
    : "The link takes them to a private invite page, then to create an account.";
  qs("[data-invite-share-url]").value = url;
  const send = qs("[data-invite-send-channel]", inviteSent);
  const text = inviteShareText({
    invitedByName: latestInviteShare.invitedByName,
    seniorName: latestInviteShare.seniorName,
    kind: latestInviteShare.kind,
    url,
  });
  if (channel === "phone" && latestInviteShare.phone) {
    send.hidden = false;
    send.textContent = "Send by text";
    send.href = smsInviteHref(latestInviteShare.phone, text);
  } else if (latestInviteShare.email) {
    send.hidden = false;
    send.textContent = "Send by email";
    send.href = mailtoInviteHref(latestInviteShare.email, {
      subject: inviteEmailSubject(latestInviteShare.seniorName),
      body: text,
    });
  } else {
    send.hidden = true;
    send.removeAttribute("href");
  }
  inviteCompose.hidden = true;
  inviteSent.hidden = false;
  toast(`Invite ready for ${member.name}.`, { type: "success" });
}

async function copyText(value, success) {
  const text = String(value || "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(success, { type: "success" });
  } catch {
    toast("Copy the link from the field.", { type: "info" });
  }
}

async function shareInviteLink(share) {
  if (!share?.url) return;
  if (!navigator.share) {
    await copyText(share.url, "Invite link copied.");
    return;
  }
  try {
    await navigator.share({
      title: inviteEmailSubject(share.seniorName),
      text: inviteShareText({
        invitedByName: share.invitedByName,
        seniorName: share.seniorName,
        kind: share.kind,
        url: share.url,
      }),
      url: share.url,
    });
  } catch (error) {
    if (error?.name !== "AbortError") toast(error.message || "Could not open share sheet.", { type: "error" });
  }
}

function openPermissions(member) {
  qs("#permissions-title").textContent = `Permissions · ${member.name}`;
  qs("[data-permissions-lead]").textContent = `${member.name} is ${member.relationship || "in the circle"} · ${roleLabel(member.role)}.`;
  permissionsForm.memberId.value = member.id;
  permissionsForm.role.innerHTML = CIRCLE_ROLE_OPTIONS.map((item) => (
    `<option value="${item.id}">${escapeHtml(item.label)}</option>`
  )).join("");
  permissionsForm.role.value = member.role === CARE_CIRCLE_ROLES.OWNER ? CARE_CIRCLE_ROLES.COORDINATOR : member.role;
  fillRelationshipSelect(permissionsForm.relationship, member.kind, member.relationship);
  fillPermissionChecks(member.permissions);
  openModal("permissions");
}

function fillRelationshipSelect(select, kind, current) {
  const options = relationshipsFor(kind);
  const extra = current && !options.includes(current) ? [current, ...options] : options;
  select.innerHTML = extra.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  if (current) select.value = current;
}

function fillPermissionChecks(selected) {
  const set = new Set(selected);
  qs("[data-permission-list]").innerHTML = CIRCLE_PERMISSION_OPTIONS.map((item) => `
    <label class="checkbox">
      <input type="checkbox" name="permission" value="${item.id}" ${set.has(item.id) || item.locked ? "checked" : ""} ${item.locked ? "disabled" : ""}>
      ${escapeHtml(item.label)}
    </label>
  `).join("");
}

function checkedPermissions(form) {
  return CIRCLE_PERMISSION_OPTIONS
    .filter((item) => item.locked || form.querySelector(`[name="permission"][value="${item.id}"]`)?.checked)
    .map((item) => item.id);
}

function invitePayload(form) {
  const channel = form.channel.value === "phone" ? "phone" : "email";
  const phone = channel === "phone" ? readPhoneField(invitePhoneField) : { ok: true, empty: true };
  if (channel === "phone" && !phone.ok) {
    throw new Error(phone.error);
  }
  return {
    kind: form.kind.value,
    name: form.name.value.trim(),
    channel,
    email: channel === "email" ? form.email.value.trim() : "",
    phone: phone.e164 || "",
    phoneCountry: phone.iso || "",
    phoneNational: phone.national || "",
    relationship: form.relationship.value,
    role: form.role.value,
    professionalType: form.professionalType.value || null,
    message: form.message.value.trim(),
  };
}

function render() {
  root.innerHTML = `
    ${incomingHtml()}
    ${headerHtml()}
    ${planBannerHtml()}
    ${bodyHtml()}
  `;
  initFormUx(root);
  initDropdowns(root);
  initTabs(root);
  const tabs = qs("[data-tabs]", root);
  if (tabs) {
    tabs.querySelectorAll("[data-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === filter);
      button.setAttribute("aria-selected", String(button.dataset.tab === filter));
    });
  }
  renderGrid();
  window.requestAnimationFrame(() => focusDeepLink(root));
}

function incomingHtml() {
  if (!state.incoming.length) return "";
  return `
    <section class="incoming-invites" aria-labelledby="incoming-title">
      <h2 id="incoming-title">Waiting for you</h2>
      ${state.incoming.map((invite) => `
        <article class="card incoming-card" data-invite-id="${escapeHtml(invite.id)}" data-invite-token="${escapeHtml(invite.token || "")}">
          <div>
            <p class="page-kicker">Invitation</p>
            <h3>Join ${escapeHtml(invite.seniorName || "this household")}</h3>
            <p class="person__meta">${escapeHtml(invite.invitedByName || "The family")} invited you as ${escapeHtml(invite.relationship || kindLabel(invite.kind))} · ${escapeHtml(roleLabel(invite.role))}</p>
            ${invite.message ? `<p>${escapeHtml(invite.message)}</p>` : ""}
          </div>
          <div class="incoming-card__actions">
            <button class="btn btn--ghost" type="button" data-decline-invite="${escapeHtml(invite.id)}">Decline</button>
            <button class="btn btn--primary" type="button" data-accept-invite="${escapeHtml(invite.id)}">Accept invitation</button>
          </div>
        </article>
      `).join("")}
    </section>
  `;
}

function headerHtml() {
  const count = state.members.filter((member) => member.status === CIRCLE_STATUS.ACTIVE).length;
  const waiting = state.members.filter((member) => member.status === CIRCLE_STATUS.INVITED).length;
  const lead = state.senior
    ? `${count} ${count === 1 ? "person" : "people"} in ${escapeHtml(state.senior.preferredName || state.senior.displayName)}’s circle${waiting ? ` · ${waiting} waiting` : ""}${state.usage.family?.max ? ` · ${state.usage.family.used} of ${state.usage.family.max} family on Free` : ""}`
    : "Invites and the people around the senior live here.";

  return `
    <div class="welcome">
      <div>
        <p class="page-kicker">People around the senior</p>
        <h2>Care circle</h2>
        <p class="page-lead">${lead}</p>
      </div>
      ${state.canInvite ? inviteMenuHtml() : ""}
    </div>
  `;
}

function inviteMenuHtml() {
  return `
    <div class="dropdown" data-dropdown>
      <button class="btn btn--primary dropdown__trigger" type="button" data-dropdown-trigger>Invite someone</button>
      <div class="dropdown__menu dropdown__menu--end" data-dropdown-menu role="menu">
        ${CIRCLE_KIND_OPTIONS.map((item) => {
          const locked = !canInviteKind(item.id, {
            session: state.session,
            members: state.members,
            planId: state.plan.id,
            senior: state.senior,
          });
          return `
            <button class="dropdown__item" type="button" role="menuitem" data-invite-kind="${item.id}">
              ${escapeHtml(item.label)}
              ${locked ? `<span class="badge badge--warning">Plus</span>` : ""}
            </button>
          `;
        }).join("")}
        <a class="dropdown__item" href="referrals.html" role="menuitem">Invite a relative to Famielda</a>
      </div>
    </div>
  `;
}

function planBannerHtml() {
  if (!state.senior || isPlusPlan(state.plan.id)) return "";
  if (state.usage.atCap) {
    return `<div class="alert alert--warning" role="status">${escapeHtml(capacityMessage())} <a href="settings.html?tab=plans">Upgrade to Plus</a></div>`;
  }
  return `<div class="alert alert--info" role="status">Free includes two family members and basic care coordination. Caregivers, practitioners, and a larger household need Plus.</div>`;
}

function bodyHtml() {
  if (!state.senior && !state.incoming.length) {
    return emptyState({
      title: "No household yet",
      body: "Create a senior profile, then invite the people already helping.",
      actionLabel: "Create senior",
      actionHref: "senior.html",
    });
  }
  if (!state.senior) return "";

  const family = countKind(CIRCLE_KINDS.FAMILY);
  const caregivers = countKind(CIRCLE_KINDS.CAREGIVER);
  const practitioners = countKind(CIRCLE_KINDS.PRACTITIONER);
  const waiting = state.members.filter((member) => member.status === CIRCLE_STATUS.INVITED).length;

  return `
    <div class="circle-stats">
      ${stat("Family", family)}
      ${stat("Caregivers", caregivers)}
      ${stat("Practitioners", practitioners)}
      ${stat("Waiting", waiting)}
    </div>
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist">
        <button class="tabs__tab" type="button" data-tab="all">All</button>
        <button class="tabs__tab" type="button" data-tab="family">Family</button>
        <button class="tabs__tab" type="button" data-tab="caregiver">Caregivers</button>
        <button class="tabs__tab" type="button" data-tab="practitioner">Practitioners</button>
        <button class="tabs__tab" type="button" data-tab="invited">Pending</button>
      </div>
    </div>
    <div class="member-grid" data-member-grid></div>
  `;
}

function stat(label, value) {
  return `
    <article class="stat-card">
      <p class="stat-card__label">${escapeHtml(label)}</p>
      <p class="stat-card__value">${value}</p>
    </article>
  `;
}

function countKind(kind) {
  return state.members.filter((member) => member.kind === kind && member.status !== CIRCLE_STATUS.REMOVED).length;
}

function renderGrid() {
  const grid = qs("[data-member-grid]", root);
  if (!grid) return;

  const members = visibleForFilter();
  if (!members.length) {
    grid.innerHTML = emptyState({
      title: emptyTitle(),
      body: emptyBody(),
    });
    return;
  }

  grid.innerHTML = members.map(memberCardHtml).join("");
}

function visibleForFilter() {
  const pendingInvites = new Map(state.invites.map((invite) => [invite.memberId, invite]));
  let members = [...state.members];
  if (filter === "invited") {
    members = [
      ...members.filter((member) => member.status === CIRCLE_STATUS.INVITED),
      ...state.declined,
    ];
  } else if (filter !== "all") {
    members = members.filter((member) => member.kind === filter);
  }
  return members.map((member) => ({ ...member, invite: pendingInvites.get(member.id) }));
}

function emptyTitle() {
  if (filter === "invited") return "No pending invitations";
  if (filter === "caregiver") return "No caregivers yet";
  if (filter === "practitioner") return "No health practitioners yet";
  if (filter === "family") return "No family on the circle";
  return "The circle is empty";
}

function emptyBody() {
  if (filter === "invited") return "Sent invites and waiting replies will appear here.";
  if (filter === "caregiver" || filter === "practitioner") {
    return isPlusPlan(state.plan.id)
      ? "Invite the people already helping so coverage stays visible."
      : "Caregivers and clinicians need a Famielda Plus plan.";
  }
  return "Invite family, neighbors, or caregivers so coverage is planned, not assumed.";
}

function memberCardHtml(member) {
  const credential = professionalTypeLabel(
    member.kind === CIRCLE_KINDS.PRACTITIONER ? "health_practitioner" : "caregiver",
    member.professionalType,
  );
  const contact = member.email || member.phone || "";
  const meta = [member.relationship, credential, contact].filter(Boolean).join(" · ");
  const waiting = member.status === CIRCLE_STATUS.INVITED || member.status === CIRCLE_STATUS.DECLINED;

  return `
    <article class="card member-card${waiting ? " member-card--pending" : ""}">
      <div class="member-card__top">
        <div class="person">
          ${avatarHtml(member.name, member.photoURL)}
          <div>
            <h3>${escapeHtml(member.name)}</h3>
            <p class="person__meta">${escapeHtml(meta)}</p>
          </div>
        </div>
        <div class="member-card__badges">
          <span class="badge ${kindBadgeClass(member.kind)}">${escapeHtml(kindLabel(member.kind))}</span>
          <span class="badge badge--neutral">${escapeHtml(roleLabel(member.role))}</span>
          <span class="badge ${statusBadge(member.status)}">${escapeHtml(statusLabel(member.status))}</span>
          ${member.kind !== CIRCLE_KINDS.FAMILY ? verificationChipHtml(member.verificationStatus) : ""}
        </div>
      </div>
      <p class="member-card__access">${escapeHtml(permissionSummary(member.permissions, member.role))}</p>
      ${member.notes && member.status === CIRCLE_STATUS.ACTIVE ? `<p class="person__meta">${escapeHtml(member.notes)}</p>` : ""}
      ${member.nextVisit ? `<p class="person__meta">Next: ${escapeHtml(member.nextVisit)}</p>` : ""}
      <div class="member-card__actions">${memberActions(member)}</div>
    </article>
  `;
}

function kindBadgeClass(kind) {
  if (kind === CIRCLE_KINDS.CAREGIVER) return "badge--info";
  if (kind === CIRCLE_KINDS.PRACTITIONER) return "badge--accent";
  return "badge--brand";
}

function memberActions(member) {
  if (!state.canManage || member.role === CARE_CIRCLE_ROLES.OWNER) return "";

  if (member.status === CIRCLE_STATUS.INVITED && member.invite) {
    const token = member.invite.token || member.invite.id;
    return `
      <button class="btn btn--ghost btn--sm" type="button" data-copy-invite-link="${escapeHtml(token)}">Copy link</button>
      <button class="btn btn--ghost btn--sm" type="button" data-resend-invite="${escapeHtml(member.invite.id)}">Resend</button>
      <button class="btn btn--ghost btn--sm" type="button" data-revoke-invite="${escapeHtml(member.invite.id)}">Revoke</button>
    `;
  }

  if (member.status === CIRCLE_STATUS.DECLINED) {
    const invite = state.invites.find((item) => item.memberId === member.id);
    return `
      ${invite ? `<button class="btn btn--ghost btn--sm" type="button" data-resend-invite="${escapeHtml(invite.id)}">Invite again</button>` : ""}
      <button class="btn btn--ghost btn--sm" type="button" data-remove-member="${escapeHtml(member.id)}">Remove</button>
    `;
  }

  return `
    <button class="btn btn--ghost btn--sm" type="button" data-edit-permissions="${escapeHtml(member.id)}">Permissions</button>
    <button class="btn btn--ghost btn--sm" type="button" data-remove-member="${escapeHtml(member.id)}">Remove</button>
  `;
}
