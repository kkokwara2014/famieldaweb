import { escapeHtml } from "../core/dom.js";
import { emptyState } from "../components/empty-state.js";
import { avatarHtml } from "../components/avatar.js";
import { roleLabel, professionalTypeLabel } from "../config/roles.js";
import { notificationTypeLabel } from "../config/notifications.js";
import { CIRCLE_KINDS, ROLES, SUPPORT_STATUS, VERIFICATION_REVIEW_ACTIONS } from "../config/constants.js";
import {
  ADMIN_ROLE_FILTERS,
  ADMIN_SECTIONS,
  ADMIN_STATUS_FILTERS,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITY_OPTIONS,
  SUPPORT_STATUS_FILTERS,
  VERIFICATION_STATUS_FILTERS,
  accountStatusBadge,
  accountStatusLabel,
  adminHref,
  formatAdminDate,
  formatAdminWhen,
  inviteStatusBadge,
  inviteStatusLabel,
  planLabel,
  subscriptionStatusLabel,
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusBadge,
  supportStatusLabel,
} from "../config/admin.js";
import { verificationStatusBadge, verificationStatusLabel } from "../config/verification.js";
import { AUDIT_ACTION_FILTERS, auditActionLabel, auditResultBadge, auditResultLabel } from "../config/security.js";
import { paymentAmountLabel } from "../services/admin-service.js";
import { ANALYTICS_PRIVACY_NOTE, PRODUCT_EVENT_META, productEventLabel } from "../config/analytics.js";
import {
  MONITORING_KIND_META,
  MONITORING_PRIVACY_NOTE,
  healthStatusBadge,
  healthStatusLabel,
  monitoringKindLabel,
  severityBadge,
  severityLabel,
} from "../config/monitoring.js";

export function adminNavHtml(activeId) {
  return `
    <nav class="admin-nav" aria-label="Admin console">
      ${ADMIN_SECTIONS.map((item) => `
        <a class="admin-nav__link${item.id === activeId ? " is-active" : ""}" href="${item.href}" ${item.id === activeId ? 'aria-current="page"' : ""}>
          ${escapeHtml(item.label)}
        </a>
      `).join("")}
    </nav>
  `;
}

export function adminPageHead({ section, session, action = "" }) {
  return `
    <div class="welcome admin-head">
      <div>
        <p class="page-kicker">Administration</p>
        <h2>${escapeHtml(section.label)}</h2>
        <p class="page-lead">${escapeHtml(section.summary)} Signed in as ${escapeHtml(session.displayName)}.</p>
      </div>
      ${action}
    </div>
  `;
}

export function adminStatGrid(items = []) {
  return `
    <div class="stat-grid admin-stats">
      ${items.map((item) => `
        <article class="stat-card">
          <p class="stat-card__label">${escapeHtml(item.label)}</p>
          <p class="stat-card__value">${escapeHtml(String(item.value ?? "0"))}</p>
          ${item.hint ? `<p class="person__meta">${escapeHtml(item.hint)}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

export function adminToolbar({ search = "", searchName = "query", placeholder = "Search", filters = "", actions = "" } = {}) {
  return `
    <form class="admin-toolbar" data-admin-filter>
      <label class="admin-search">
        <span class="visually-hidden">Search</span>
        <input type="search" name="${escapeHtml(searchName)}" value="${escapeHtml(search)}" placeholder="${escapeHtml(placeholder)}">
      </label>
      ${filters}
      <button class="btn btn--ghost btn--sm" type="submit">Filter</button>
      ${actions}
    </form>
  `;
}

export function selectFilter(name, value, options) {
  return `
    <select name="${escapeHtml(name)}" aria-label="${escapeHtml(name)}">
      ${options.map((item) => `
        <option value="${escapeHtml(item.id)}" ${item.id === value ? "selected" : ""}>${escapeHtml(item.label)}</option>
      `).join("")}
    </select>
  `;
}

function roleChip(user) {
  const type = professionalTypeLabel(user.role, user.professionalType);
  return type ? `${type} · ${roleLabel(user.role)}` : roleLabel(user.role);
}

function personCell(user) {
  return `
    <div class="admin-person">
      ${avatarHtml(user.displayName || user.email, user.photoURL)}
      <div>
        <strong>${escapeHtml(user.displayName || user.email || "Unknown")}</strong>
        <div class="person__meta">${escapeHtml(user.email || "")}</div>
      </div>
    </div>
  `;
}

function emptyRow(cols, title, body) {
  return `<tr><td colspan="${cols}">${emptyState({ title, body, compact: true })}</td></tr>`;
}

export function overviewHtml(data) {
  const counts = data.counts || {};
  return `
    ${adminStatGrid([
      { label: "Users", value: counts.users, hint: `${counts.families || 0} family` },
      { label: "Seniors", value: counts.seniors, hint: `${counts.pendingInvites || 0} pending invites` },
      { label: "Plus", value: counts.plus, hint: `${counts.free || 0} on Free` },
      { label: "Support", value: counts.openTickets, hint: `${counts.suspended || 0} suspended` },
    ])}
    ${data.health ? healthStripHtml(data.health) : ""}
    ${data.verificationCounts ? `
    <section class="card">
      <div class="card__header">
        <h3>Professional verification</h3>
        <a class="btn btn--ghost btn--sm" href="${adminHref("verification")}">Review queue</a>
      </div>
      <ul class="list">
        <li class="list__item"><span>Pending</span><strong>${data.verificationCounts.pending || 0}</strong></li>
        <li class="list__item"><span>Under review</span><strong>${data.verificationCounts.under_review || 0}</strong></li>
        <li class="list__item"><span>Verified</span><strong>${data.verificationCounts.verified || 0}</strong></li>
        <li class="list__item"><span>Rejected / suspended</span><strong>${(data.verificationCounts.rejected || 0) + (data.verificationCounts.suspended || 0)}</strong></li>
      </ul>
    </section>
    ` : ""}
    <div class="admin-split">
      <section class="card">
        <div class="card__header">
          <h3>Roles</h3>
        </div>
        <ul class="list">
          <li class="list__item"><span>Family</span><strong>${counts.families || 0}</strong></li>
          <li class="list__item"><span>Caregivers</span><strong>${counts.caregivers || 0}</strong></li>
          <li class="list__item"><span>Practitioners</span><strong>${counts.practitioners || 0}</strong></li>
          <li class="list__item"><span>Admins</span><strong>${counts.admins || 0}</strong></li>
        </ul>
      </section>
      <section class="card">
        <div class="card__header">
          <h3>Recent accounts</h3>
          <a class="btn btn--ghost btn--sm" href="${adminHref("users")}">View users</a>
        </div>
        ${data.recentUsers?.length ? `
          <ul class="list">
            ${data.recentUsers.map((user) => `
              <li class="list__item">
                <div>
                  <strong>${escapeHtml(user.displayName || user.email)}</strong>
                  <div class="person__meta">${escapeHtml(roleChip(user))} · ${escapeHtml(formatAdminDate(user.createdAt))}</div>
                </div>
                <a class="btn btn--ghost btn--sm" href="${adminHref("users", { id: user.id })}">Open</a>
              </li>
            `).join("")}
          </ul>
        ` : emptyState({ title: "No accounts yet", body: "New registrations will appear here.", compact: true })}
      </section>
    </div>
    <section class="card">
      <div class="card__header">
        <h3>Open support</h3>
        <a class="btn btn--ghost btn--sm" href="${adminHref("support")}">Inbox</a>
      </div>
      ${data.recentTickets?.length ? `
        <ul class="list">
          ${data.recentTickets.map((ticket) => `
            <li class="list__item">
              <div>
                <strong>${escapeHtml(ticket.subject)}</strong>
                <div class="person__meta">${escapeHtml(ticket.userName || ticket.email)} · ${escapeHtml(supportStatusLabel(ticket.status))}</div>
              </div>
              <span class="badge ${supportStatusBadge(ticket.status)}">${escapeHtml(supportStatusLabel(ticket.status))}</span>
            </li>
          `).join("")}
        </ul>
      ` : emptyState({ title: "No tickets", body: "Support requests from households will land here.", compact: true })}
    </section>
  `;
}

export function usersHtml({ users = [], query = "", role = "all", status = "all", selected = null } = {}) {
  return `
    ${adminToolbar({
      search: query,
      placeholder: "Search name or email",
      filters: `${selectFilter("role", role, ADMIN_ROLE_FILTERS)}${selectFilter("status", status, ADMIN_STATUS_FILTERS)}`,
    })}
    <div class="admin-split${selected ? " has-detail" : ""}">
      <section class="card">
        <div class="table-wrap">
          <table class="data-table data-table--compact">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Plan</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${users.length ? users.map((user) => `
                <tr class="${selected?.user?.id === user.id ? "is-selected" : ""}">
                  <td>${personCell(user)}</td>
                  <td>${escapeHtml(roleChip(user))}</td>
                  <td>${escapeHtml(planLabel(user.adminGrant?.active ? "plus" : user.plan))}${user.adminGrant?.active ? ' <span class="badge badge--brand">Grant</span>' : ""}</td>
                  <td><span class="badge ${accountStatusBadge(user.status)}">${escapeHtml(accountStatusLabel(user.status))}</span></td>
                  <td><a class="btn btn--ghost btn--sm" href="${adminHref("users", { id: user.id, query, role, status })}">Manage</a></td>
                </tr>
              `).join("") : emptyRow(5, "No users match", "Try another role, status, or search.")}
            </tbody>
          </table>
        </div>
      </section>
      ${selected ? userDetailHtml(selected) : ""}
    </div>
  `;
}

export function userDetailHtml(detail) {
  const user = detail.user;
  const suspended = user.status === "suspended";
  return `
    <section class="card admin-detail" data-admin-detail>
      <div class="admin-detail__head">
        ${avatarHtml(user.displayName, user.photoURL, { size: "lg" })}
        <div>
          <h3>${escapeHtml(user.displayName || user.email)}</h3>
          <p class="person__meta">${escapeHtml(user.email)}</p>
          <p>
            <span class="badge badge--brand">${escapeHtml(roleChip(user))}</span>
            <span class="badge ${accountStatusBadge(user.status)}">${escapeHtml(accountStatusLabel(user.status))}</span>
          </p>
        </div>
      </div>
      <dl class="detail-list">
        <div><dt>Plan</dt><dd>${escapeHtml(planLabel(detail.subscription?.effectivePlus ? "plus" : user.plan))}${user.adminGrant?.active ? " (operational grant)" : ""}</dd></div>
        <div><dt>Subscription</dt><dd>${escapeHtml(subscriptionStatusLabel(user.subscriptionStatus))}</dd></div>
        <div><dt>Last login</dt><dd>${escapeHtml(formatAdminWhen(user.lastLoginAt))}</dd></div>
        <div><dt>Created</dt><dd>${escapeHtml(formatAdminDate(user.createdAt))}</dd></div>
      </dl>
      ${detail.memberships?.length ? `
        <h4>Households</h4>
        <ul class="list">
          ${detail.memberships.map((item) => `
            <li class="list__item">
              <div>
                <strong>${escapeHtml(item.seniorName || item.seniorId || "Household")}</strong>
                <div class="person__meta">${escapeHtml(item.relationship || item.kind)} · ${escapeHtml(item.status)}</div>
              </div>
              ${item.seniorId ? `<a class="btn btn--ghost btn--sm" href="${adminHref("seniors", { id: item.seniorId })}">Senior</a>` : ""}
            </li>
          `).join("")}
        </ul>
      ` : `<p class="person__meta">Not on a care circle yet.</p>`}
      ${suspended && user.suspendedReason ? `<p class="alert alert--warning">${escapeHtml(user.suspendedReason)}</p>` : ""}
      <form class="form admin-detail__form" data-user-form data-user-id="${escapeHtml(user.id)}">
        <div class="field">
          <label for="admin-user-name">Display name</label>
          <input id="admin-user-name" name="displayName" value="${escapeHtml(user.displayName || "")}" required>
        </div>
        <div class="field">
          <label for="admin-user-role">Role</label>
          <select id="admin-user-role" name="role">
            ${[ROLES.FAMILY, ROLES.CAREGIVER, ROLES.HEALTH_PRACTITIONER, ROLES.ADMIN].map((role) => `
              <option value="${role}" ${user.role === role ? "selected" : ""}>${escapeHtml(roleLabel(role))}</option>
            `).join("")}
          </select>
        </div>
        <div class="admin-detail__actions">
          <button class="btn btn--primary btn--sm" type="submit">Save</button>
          <button class="btn btn--ghost btn--sm" type="button" data-grant-plus data-user-id="${escapeHtml(user.id)}" data-grant="${user.adminGrant?.active ? "0" : "1"}">
            ${user.adminGrant?.active ? "Revoke Plus grant" : "Grant Plus"}
          </button>
          <button class="btn ${suspended ? "btn--primary" : "btn--danger"} btn--sm" type="button" data-suspend-user data-user-id="${escapeHtml(user.id)}" data-suspended="${suspended ? "0" : "1"}">
            ${suspended ? "Restore access" : "Suspend account"}
          </button>
        </div>
      </form>
    </section>
  `;
}

export function familiesHtml({ families = [], query = "" } = {}) {
  return `
    ${adminToolbar({ search: query, placeholder: "Search family members" })}
    <section class="card">
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Family member</th>
              <th>Plan</th>
              <th>Households</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${families.length ? families.map((user) => `
              <tr>
                <td>${personCell(user)}</td>
                <td>${escapeHtml(planLabel(user.adminGrant?.active ? "plus" : user.plan))}</td>
                <td>${user.households?.length
                  ? user.households.map((home) => escapeHtml(home.displayName || home.preferredName)).join(", ")
                  : "None yet"}</td>
                <td><a class="btn btn--ghost btn--sm" href="${adminHref("users", { id: user.id })}">User</a></td>
              </tr>
            `).join("") : emptyRow(4, "No family accounts", "Family members appear here after they choose a role.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function seniorsHtml({ seniors = [], query = "", selected = null } = {}) {
  return `
    ${adminToolbar({ search: query, placeholder: "Search seniors" })}
    <div class="admin-split${selected ? " has-detail" : ""}">
      <section class="card">
        <div class="table-wrap">
          <table class="data-table data-table--compact">
            <thead>
              <tr>
                <th>Senior</th>
                <th>Owner</th>
                <th>Circle</th>
                <th>Care</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${seniors.length ? seniors.map((senior) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(senior.displayName)}</strong>
                    <div class="person__meta">${escapeHtml(senior.location || "Location not listed")}</div>
                  </td>
                  <td>${escapeHtml(senior.ownerName || senior.ownerEmail || senior.ownerId || "—")}</td>
                  <td>${senior.memberCount ?? 0}</td>
                  <td><span class="badge badge--neutral">${escapeHtml(senior.careStatus || "stable")}</span></td>
                  <td><a class="btn btn--ghost btn--sm" href="${adminHref("seniors", { id: senior.id, query })}">Open</a></td>
                </tr>
              `).join("") : emptyRow(5, "No senior profiles", "Households create a senior record from the family workspace.")}
            </tbody>
          </table>
        </div>
      </section>
      ${selected ? seniorDetailHtml(selected) : ""}
    </div>
  `;
}

export function seniorDetailHtml(detail) {
  const senior = detail.senior;
  const owner = detail.owner;
  return `
    <section class="card admin-detail">
      <h3>${escapeHtml(senior.displayName)}</h3>
      <p class="person__meta">Goes by ${escapeHtml(senior.preferredName || senior.displayName)} · ${escapeHtml(senior.location || "No location")}</p>
      <dl class="detail-list">
        <div><dt>Owner</dt><dd>${escapeHtml(owner?.displayName || owner?.email || senior.ownerId || "—")}</dd></div>
        <div><dt>Members</dt><dd>${senior.memberCount ?? detail.members?.length ?? 0}</dd></div>
        <div><dt>Care status</dt><dd>${escapeHtml(senior.careStatus || "stable")}</dd></div>
      </dl>
      <h4>Circle</h4>
      <ul class="list">
        ${(detail.members || []).map((member) => `
          <li class="list__item">
            <div>
              <strong>${escapeHtml(member.name || member.email)}</strong>
              <div class="person__meta">${escapeHtml(member.relationship || member.kind)} · ${escapeHtml(member.status)}</div>
            </div>
            ${member.userId ? `<a class="btn btn--ghost btn--sm" href="${adminHref("users", { id: member.userId })}">User</a>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

export function professionalsHtml({ professionals = [], role, query = "" } = {}) {
  const caregiver = role === ROLES.CAREGIVER;
  return `
    ${adminToolbar({ search: query, placeholder: caregiver ? "Search caregivers" : "Search practitioners" })}
    <section class="card">
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Person</th>
              <th>Type</th>
              <th>Households</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${professionals.length ? professionals.map((user) => `
              <tr>
                <td>${personCell(user)}</td>
                <td>${escapeHtml(professionalTypeLabel(user.role, user.professionalType) || "—")}</td>
                <td>${user.households?.length
                  ? user.households.map((home) => escapeHtml(home.seniorName || home.seniorId)).join(", ")
                  : "None"}</td>
                <td>
                  <span class="badge ${accountStatusBadge(user.status)}">${escapeHtml(accountStatusLabel(user.status))}</span>
                  ${user.verificationStatus ? ` <span class="badge ${verificationStatusBadge(user.verificationStatus)}">${escapeHtml(verificationStatusLabel(user.verificationStatus))}</span>` : ""}
                </td>
                <td>
                  <a class="btn btn--ghost btn--sm" href="${adminHref("verification", { id: user.id })}">Review</a>
                  <a class="btn btn--ghost btn--sm" href="${adminHref("users", { id: user.id })}">Manage</a>
                </td>
              </tr>
            `).join("") : emptyRow(5, caregiver ? "No caregivers" : "No practitioners", "Professionals appear after they choose a role.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function subscriptionsHtml({ subscriptions = [], query = "" } = {}) {
  return `
    ${adminToolbar({ search: query, placeholder: "Search subscribers" })}
    <section class="card">
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Account</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Renewal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${subscriptions.length ? subscriptions.map((item) => `
              <tr>
                <td>
                  <strong>${escapeHtml(item.displayName || item.email)}</strong>
                  <div class="person__meta">${escapeHtml(item.email)}</div>
                </td>
                <td>
                  ${escapeHtml(planLabel(item.effectivePlus ? "plus" : item.plan))}
                  ${item.adminGrant ? ' <span class="badge badge--brand">Grant</span>' : ""}
                </td>
                <td>${escapeHtml(subscriptionStatusLabel(item.status))}</td>
                <td>${escapeHtml(formatAdminDate(item.periodEnd))}</td>
                <td>
                  <button class="btn btn--ghost btn--sm" type="button" data-grant-plus data-user-id="${escapeHtml(item.userId)}" data-grant="${item.adminGrant ? "0" : "1"}">
                    ${item.adminGrant ? "Revoke grant" : "Grant Plus"}
                  </button>
                </td>
              </tr>
            `).join("") : emptyRow(5, "No subscriptions", "Stripe and operational grants will appear here.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function paymentsHtml(data) {
  const totals = data.totals || {};
  const invoices = data.invoices || [];
  return `
    ${adminStatGrid([
      { label: "Recorded", value: paymentAmountLabel(totals.revenueCents), hint: `${totals.paid || 0} paid invoices` },
      { label: "This month", value: paymentAmountLabel(totals.monthCents), hint: "Paid in the current calendar month" },
      { label: "Open", value: totals.open || 0, hint: "Awaiting payment" },
      { label: "Unpaid / void", value: totals.failed || 0, hint: "Needs follow-up" },
    ])}
    <section class="card">
      <div class="card__header">
        <h3>Recent invoices</h3>
        <a class="btn btn--ghost btn--sm" href="${adminHref("health", { kind: "payment" })}">Payment failures</a>
      </div>
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${invoices.length ? invoices.map((invoice) => `
              <tr>
                <td>${invoice.hostedInvoiceUrl
                  ? `<a href="${escapeHtml(invoice.hostedInvoiceUrl)}" target="_blank" rel="noopener">${escapeHtml(invoice.number)}</a>`
                  : escapeHtml(invoice.number)}</td>
                <td>${escapeHtml(invoice.customerName || invoice.customerEmail || "—")}</td>
                <td>${escapeHtml(paymentAmountLabel(invoice.amountPaid || invoice.amountDue, invoice.currency))}</td>
                <td><span class="badge ${invoice.status === "paid" ? "badge--success" : "badge--warning"}">${escapeHtml(invoice.status)}</span></td>
                <td>${escapeHtml(formatAdminDate(invoice.createdAt))}</td>
              </tr>
            `).join("") : emptyRow(5, "No invoices yet", "Stripe invoices for Famielda Plus will appear here.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function invitationsHtml({ invites = [], status = "all", query = "" } = {}) {
  const statuses = [
    { id: "all", label: "All invitations" },
    { id: "pending", label: "Pending" },
    { id: "accepted", label: "Accepted" },
    { id: "declined", label: "Declined" },
    { id: "revoked", label: "Revoked" },
  ];
  return `
    ${adminToolbar({
      search: query,
      placeholder: "Search email or household",
      filters: selectFilter("status", status, statuses),
    })}
    <section class="card">
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Invitee</th>
              <th>Household</th>
              <th>Kind</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${invites.length ? invites.map((invite) => `
              <tr>
                <td>
                  <strong>${escapeHtml(invite.name || invite.email)}</strong>
                  <div class="person__meta">${escapeHtml(invite.email)}</div>
                </td>
                <td>${escapeHtml(invite.seniorName || invite.seniorId || "—")}</td>
                <td>${escapeHtml(invite.kind === CIRCLE_KINDS.CAREGIVER ? "Caregiver" : invite.kind === CIRCLE_KINDS.PRACTITIONER ? "Practitioner" : "Family")}</td>
                <td><span class="badge ${inviteStatusBadge(invite.status)}">${escapeHtml(inviteStatusLabel(invite.status))}</span></td>
                <td>
                  ${invite.status === "pending"
                    ? `<button class="btn btn--ghost btn--sm" type="button" data-revoke-invite data-invite-id="${escapeHtml(invite.id)}">Revoke</button>`
                    : ""}
                </td>
              </tr>
            `).join("") : emptyRow(5, "No invitations", "Care-circle invitations across households will appear here.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function familyReferralsHtml({ referrals = [], status = "all", query = "" } = {}) {
  const statuses = [
    { id: "all", label: "All referrals" },
    { id: "pending", label: "Waiting" },
    { id: "joined", label: "Joined" },
    { id: "successful", label: "Successful" },
    { id: "revoked", label: "Revoked" },
  ];
  return `
    ${adminToolbar({
      search: query,
      placeholder: "Search email, name, or code",
      filters: selectFilter("status", status, statuses),
    })}
    <section class="card">
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Relative</th>
              <th>Invited by</th>
              <th>Code</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${referrals.length ? referrals.map((item) => `
              <tr>
                <td>
                  <strong>${escapeHtml(item.name || item.email || "—")}</strong>
                  <div class="person__meta">${escapeHtml(item.email || "Share link")}${item.relationship ? ` · ${escapeHtml(item.relationship)}` : ""}</div>
                </td>
                <td>
                  ${escapeHtml(item.referrerName || "—")}
                  <div class="person__meta">${escapeHtml(item.referrerEmail || "")}</div>
                </td>
                <td>${escapeHtml(item.code || "—")}</td>
                <td><span class="badge ${inviteStatusBadge(item.status === "joined" ? "pending" : item.status === "successful" ? "accepted" : item.status)}">${escapeHtml(item.status || "pending")}</span></td>
              </tr>
            `).join("") : emptyRow(4, "No family referrals", "Invites sent from Invite your family will appear here.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function reportsHtml(report) {
  const users = report.users || {};
  const households = report.households || {};
  const billing = report.billing || {};
  const activity = report.activity || {};
  return `
    ${adminStatGrid([
      { label: "Accounts", value: users.total, hint: `${users.verified || 0} verified` },
      { label: "Seniors", value: households.seniors, hint: `${households.pendingInvites || 0} pending invites` },
      { label: "Plus", value: billing.plus, hint: `${billing.free || 0} Free` },
      { label: "Visits logged", value: activity.visits, hint: `${activity.openTickets || 0} open tickets` },
    ])}
    <div class="admin-split">
      <section class="card">
        <h3>People</h3>
        <ul class="list">
          <li class="list__item"><span>Family</span><strong>${users.family || 0}</strong></li>
          <li class="list__item"><span>Caregivers</span><strong>${users.caregiver || 0}</strong></li>
          <li class="list__item"><span>Practitioners</span><strong>${users.practitioner || 0}</strong></li>
          <li class="list__item"><span>Suspended</span><strong>${users.suspended || 0}</strong></li>
        </ul>
      </section>
      <section class="card">
        <h3>Operations</h3>
        <ul class="list">
          <li class="list__item"><span>Notifications</span><strong>${activity.notifications || 0}</strong></li>
          <li class="list__item"><span>Accepted invites</span><strong>${households.acceptedInvites || 0}</strong></li>
          <li class="list__item"><span>Open support</span><strong>${activity.openTickets || 0}</strong></li>
        </ul>
        <button class="btn btn--primary" type="button" data-export-report>Export CSV</button>
      </section>
    </div>
  `;
}

export function analyticsHtml(report = {}) {
  const totals = report.totals || {};
  const last7 = report.last7 || {};
  const last30 = report.last30 || {};
  const conversion = report.conversion || {};
  const recent = report.recent || [];
  const peak = Math.max(1, ...PRODUCT_EVENT_META.map((item) => Number(totals[item.id] || 0)));
  return `
    ${adminStatGrid([
      { label: "Registrations", value: totals.registration || 0, hint: `${last7.registration || 0} in 7 days` },
      { label: "Seniors created", value: totals.senior_created || 0, hint: `${conversion.seniorCreated || 0}% of sign-ups` },
      { label: "Plus upgrades", value: totals.plus_upgrade || 0, hint: `${conversion.plusUpgrade || 0}% of sign-ups` },
      { label: "Visits completed", value: totals.visit_completed || 0, hint: `${totals.task_completed || 0} tasks done` },
    ])}
    <p class="person__meta admin-privacy">${escapeHtml(ANALYTICS_PRIVACY_NOTE)}</p>
    <section class="card">
      <div class="card__header">
        <h3>Product funnel</h3>
        <button class="btn btn--ghost btn--sm" type="button" data-export-analytics>Export CSV</button>
      </div>
      <ul class="analytics-funnel">
        ${PRODUCT_EVENT_META.map((item) => {
          const count = Number(totals[item.id] || 0);
          const width = Math.max(6, Math.round((count / peak) * 100));
          return `
            <li class="analytics-funnel__row">
              <div class="analytics-funnel__label">
                <strong>${escapeHtml(item.label)}</strong>
                <span class="person__meta">${escapeHtml(item.stage)} · ${last7[item.id] || 0} / 7d · ${last30[item.id] || 0} / 30d</span>
              </div>
              <div class="analytics-funnel__bar" aria-hidden="true">
                <span style="width:${width}%"></span>
              </div>
              <strong class="analytics-funnel__count">${count}</strong>
            </li>
          `;
        }).join("")}
      </ul>
    </section>
    <section class="card">
      <h3>Recent events</h3>
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Event</th>
              <th>Role</th>
              <th>Plan</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            ${recent.length ? recent.map((event) => `
              <tr>
                <td>
                  <strong>${escapeHtml(productEventLabel(event.name))}</strong>
                  <div class="person__meta">${escapeHtml(event.source || "client")}${event.inviteKind ? ` · ${escapeHtml(event.inviteKind)}` : ""}</div>
                </td>
                <td>${escapeHtml(event.role ? roleLabel(event.role) : "—")}</td>
                <td>${escapeHtml(planLabel(event.plan))}</td>
                <td>${escapeHtml(formatAdminWhen(event.createdAt))}</td>
              </tr>
            `).join("") : emptyRow(4, "No product events yet", "Registration, invitations, visits, and billing will appear here.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function durationLabel(ms) {
  if (ms == null || ms === "") return "—";
  const value = Number(ms);
  if (!Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function healthStripHtml(health) {
  const stats = health.stats || {};
  return `
    <section class="card health-strip health-strip--${escapeHtml(health.status || "healthy")}">
      <div class="card__header">
        <h3>Platform health</h3>
        <a class="btn btn--ghost btn--sm" href="${adminHref("health")}">Open health</a>
      </div>
      <div class="health-strip__body">
        <span class="badge ${healthStatusBadge(health.status)}">${escapeHtml(healthStatusLabel(health.status))}</span>
        <span class="person__meta">${Number(stats.jsErrors24h || 0)} JS errors</span>
        <span class="person__meta">${Number(stats.functionErrors24h || 0)} function errors</span>
        <span class="person__meta">${Number(stats.paymentFailures24h || 0)} failed payments</span>
        <span class="person__meta">${stats.notificationFailRate || 0}% notification fail</span>
      </div>
    </section>
  `;
}

export function healthHtml(report = {}, { kind = "all" } = {}) {
  const stats = report.stats || {};
  const checks = report.checks || [];
  const recent = (report.recent || []).filter((item) => kind === "all" || item.kind === kind);
  const topErrors = report.topErrors || [];
  const slowFunctions = report.slowFunctions || [];
  const kindFilters = [{ id: "all", label: "All signals" }, ...MONITORING_KIND_META.map((item) => ({ id: item.id, label: item.label }))];
  return `
    <section class="health-banner health-banner--${escapeHtml(report.status || "healthy")}">
      <div>
        <p class="page-kicker">Module 38 — Monitoring</p>
        <h3>${escapeHtml(healthStatusLabel(report.status))}</h3>
        <p class="person__meta">${escapeHtml(report.firebase?.message || "Firebase, functions, auth, payments, and notifications.")}</p>
      </div>
      <span class="badge ${healthStatusBadge(report.status)}">${escapeHtml(healthStatusLabel(report.status))}</span>
    </section>
    ${adminStatGrid([
      { label: "JS errors", value: stats.jsErrors24h || 0, hint: `${report.counts7?.js_error || 0} in 7 days` },
      { label: "Function errors", value: stats.functionErrors24h || 0, hint: `${stats.slowFunctions24h || 0} slow handlers` },
      { label: "Failed payments", value: stats.paymentFailures24h || 0, hint: "Stripe invoice.payment_failed" },
      { label: "Notification fail", value: `${stats.notificationFailRate || 0}%`, hint: `${stats.notificationsSent24h || 0} delivered / 24h` },
    ])}
    <p class="person__meta admin-privacy">${escapeHtml(MONITORING_PRIVACY_NOTE)}</p>
    <section class="card">
      <div class="card__header">
        <h3>Health checks</h3>
        <span class="person__meta">Last 24 hours · ${escapeHtml(formatAdminWhen(report.generatedAt))}</span>
      </div>
      <ul class="health-checks">
        ${checks.map((check) => `
          <li class="health-check health-check--${escapeHtml(check.status)}">
            <div>
              <strong>${escapeHtml(check.label)}</strong>
              <p class="person__meta">${escapeHtml(check.hint || "")}</p>
            </div>
            <div class="health-check__value">
              <strong>${escapeHtml(String(check.value ?? "0"))}</strong>
              <span class="badge ${healthStatusBadge(check.status)}">${escapeHtml(healthStatusLabel(check.status))}</span>
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
    <div class="admin-split">
      <section class="card">
        <div class="card__header">
          <h3>Top JavaScript errors</h3>
        </div>
        ${topErrors.length ? `
          <ul class="list">
            ${topErrors.map((item) => `
              <li class="list__item">
                <div>
                  <strong>${escapeHtml(item.message)}</strong>
                  <div class="person__meta">${escapeHtml(item.page || "web")} · ${escapeHtml(formatAdminWhen(item.lastAt))}</div>
                </div>
                <strong>${item.count}</strong>
              </li>
            `).join("")}
          </ul>
        ` : emptyState({ title: "No JavaScript errors", body: "Unhandled exceptions on Famielda Web will group here.", compact: true })}
      </section>
      <section class="card">
        <div class="card__header">
          <h3>Slow Cloud Functions</h3>
        </div>
        ${slowFunctions.length ? `
          <ul class="list">
            ${slowFunctions.map((item) => `
              <li class="list__item">
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <div class="person__meta">${item.count} slow calls</div>
                </div>
                <strong>${escapeHtml(durationLabel(item.maxMs))}</strong>
              </li>
            `).join("")}
          </ul>
        ` : emptyState({ title: "No slow handlers", body: "Callables slower than 2.5s will appear here.", compact: true })}
      </section>
    </div>
    ${adminToolbar({
      filters: selectFilter("kind", kind, kindFilters),
    })}
    <section class="card">
      <div class="card__header">
        <h3>Recent signals</h3>
      </div>
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Detail</th>
              <th>Severity</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            ${recent.length ? recent.map((event) => `
              <tr>
                <td>
                  <strong>${escapeHtml(monitoringKindLabel(event.kind))}</strong>
                  <div class="person__meta">${escapeHtml(event.name || event.status || event.source || "")}</div>
                </td>
                <td>
                  ${escapeHtml(event.message || event.code || event.page || "—")}
                  <div class="person__meta">${[
                    event.code,
                    event.page,
                    event.durationMs != null ? durationLabel(event.durationMs) : "",
                  ].filter(Boolean).map((part) => escapeHtml(part)).join(" · ")}</div>
                </td>
                <td><span class="badge ${severityBadge(event.severity)}">${escapeHtml(severityLabel(event.severity))}</span></td>
                <td>${escapeHtml(formatAdminWhen(event.createdAt))}</td>
              </tr>
            `).join("") : emptyRow(4, "No monitoring events yet", "JavaScript errors, function logs, auth, payments, and notification delivery will appear here.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function notificationsHtml({ notifications = [] } = {}) {
  return `
    <div class="admin-split">
      <section class="card">
        <h3>Send a platform notice</h3>
        <form class="form" data-notice-form>
          <div class="field">
            <label for="admin-notice-title">Title</label>
            <input id="admin-notice-title" name="title" required maxlength="120" placeholder="Famielda update">
          </div>
          <div class="field">
            <label for="admin-notice-body">Message</label>
            <textarea id="admin-notice-body" name="body" rows="4" required placeholder="What should people know?"></textarea>
          </div>
          <div class="field">
            <label for="admin-notice-audience">Audience</label>
            <select id="admin-notice-audience" name="role">
              <option value="all">Everyone</option>
              <option value="${ROLES.FAMILY}">Family</option>
              <option value="${ROLES.CAREGIVER}">Caregivers</option>
              <option value="${ROLES.HEALTH_PRACTITIONER}">Practitioners</option>
            </select>
          </div>
          <button class="btn btn--primary" type="submit">Send notification</button>
        </form>
      </section>
      <section class="card">
        <h3>Recent notices</h3>
        ${notifications.length ? `
          <ul class="list">
            ${notifications.map((notice) => `
              <li class="list__item">
                <div>
                  <div class="notice__type">${escapeHtml(notificationTypeLabel(notice.type))} · ${escapeHtml(formatAdminWhen(notice.createdAt))}</div>
                  <strong>${escapeHtml(notice.title)}</strong>
                  <p class="person__meta">${escapeHtml(notice.body)}</p>
                  <p class="person__meta">${escapeHtml(notice.email || notice.userId || "Platform")}</p>
                </div>
                <span class="badge ${notice.read ? "badge--neutral" : "badge--accent"}">${notice.read ? "Read" : "Unread"}</span>
              </li>
            `).join("")}
          </ul>
        ` : emptyState({ title: "No notifications yet", body: "Household and platform notices will appear here.", compact: true })}
      </section>
    </div>
  `;
}

export function supportHtml({ tickets = [], status = "all", selected = null } = {}) {
  return `
    ${adminToolbar({
      search: "",
      placeholder: "Search is not required",
      filters: selectFilter("status", status, SUPPORT_STATUS_FILTERS),
      actions: `<button class="btn btn--primary btn--sm" type="button" data-open-ticket>Log ticket</button>`,
    })}
    <div class="admin-split${selected ? " has-detail" : ""}">
      <section class="card">
        <div class="table-wrap">
          <table class="data-table data-table--compact">
            <thead>
              <tr>
                <th>Subject</th>
                <th>From</th>
                <th>Priority</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${tickets.length ? tickets.map((ticket) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(ticket.subject)}</strong>
                    <div class="person__meta">${escapeHtml(supportCategoryLabel(ticket.category))} · ${escapeHtml(formatAdminWhen(ticket.createdAt))}</div>
                  </td>
                  <td>${escapeHtml(ticket.userName || ticket.email)}</td>
                  <td>${escapeHtml(supportPriorityLabel(ticket.priority))}</td>
                  <td><span class="badge ${supportStatusBadge(ticket.status)}">${escapeHtml(supportStatusLabel(ticket.status))}</span></td>
                  <td><a class="btn btn--ghost btn--sm" href="${adminHref("support", { id: ticket.id, status })}">Open</a></td>
                </tr>
              `).join("") : emptyRow(5, "No tickets", "Households can write from Settings. You can also log a ticket here.")}
            </tbody>
          </table>
        </div>
      </section>
      ${selected ? ticketDetailHtml(selected) : ticketCreateHtml()}
    </div>
  `;
}

export function ticketCreateHtml() {
  return `
    <section class="card admin-detail" data-ticket-create>
      <h3>Log a ticket</h3>
      <p class="person__meta">Use this when someone writes in outside the app.</p>
      <form class="form" data-ticket-create-form>
        <div class="field">
          <label for="ticket-email">Email</label>
          <input id="ticket-email" name="email" type="email" placeholder="family@example.com">
        </div>
        <div class="field">
          <label for="ticket-subject">Subject</label>
          <input id="ticket-subject" name="subject" required maxlength="140">
        </div>
        <div class="field">
          <label for="ticket-body">Details</label>
          <textarea id="ticket-body" name="body" rows="4" required></textarea>
        </div>
        <div class="field">
          <label for="ticket-category">Category</label>
          <select id="ticket-category" name="category">
            ${SUPPORT_CATEGORIES.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="ticket-priority">Priority</label>
          <select id="ticket-priority" name="priority">
            ${SUPPORT_PRIORITY_OPTIONS.map((item) => `<option value="${item.id}" ${item.id === "normal" ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn--primary" type="submit">Create ticket</button>
      </form>
    </section>
  `;
}

export function ticketDetailHtml(ticket) {
  return `
    <section class="card admin-detail">
      <h3>${escapeHtml(ticket.subject)}</h3>
      <p class="person__meta">${escapeHtml(ticket.userName || ticket.email)} · ${escapeHtml(supportCategoryLabel(ticket.category))} · ${escapeHtml(supportPriorityLabel(ticket.priority))}</p>
      <p><span class="badge ${supportStatusBadge(ticket.status)}">${escapeHtml(supportStatusLabel(ticket.status))}</span></p>
      <p>${escapeHtml(ticket.body)}</p>
      ${(ticket.replies || []).length ? `
        <ul class="list">
          ${ticket.replies.map((reply) => `
            <li class="list__item">
              <div>
                <strong>${escapeHtml(reply.authorName || "Admin")}${reply.internal ? " · internal" : ""}</strong>
                <p class="person__meta">${escapeHtml(reply.body)}</p>
                <p class="person__meta">${escapeHtml(formatAdminWhen(reply.createdAt))}</p>
              </div>
            </li>
          `).join("")}
        </ul>
      ` : ""}
      <form class="form" data-ticket-reply-form data-ticket-id="${escapeHtml(ticket.id)}">
        <div class="field">
          <label for="ticket-reply">Reply</label>
          <textarea id="ticket-reply" name="reply" rows="3" placeholder="Add a note or reply"></textarea>
        </div>
        <div class="field">
          <label for="ticket-status">Status</label>
          <select id="ticket-status" name="status">
            ${[SUPPORT_STATUS.OPEN, SUPPORT_STATUS.PENDING, SUPPORT_STATUS.RESOLVED, SUPPORT_STATUS.CLOSED].map((item) => `
              <option value="${item}" ${ticket.status === item ? "selected" : ""}>${escapeHtml(supportStatusLabel(item))}</option>
            `).join("")}
          </select>
        </div>
        <label class="notice-pref">
          <input type="checkbox" name="internal">
          <span>Internal note — not a customer-facing reply</span>
        </label>
        <button class="btn btn--primary" type="submit">Update ticket</button>
      </form>
    </section>
  `;
}

export function suspensionHtml({ users = [], query = "" } = {}) {
  const suspended = users.filter((item) => item.status === "suspended");
  const active = users.filter((item) => item.status !== "suspended");
  return `
    ${adminToolbar({ search: query, placeholder: "Search accounts to suspend" })}
    <section class="card">
      <h3>Suspended</h3>
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Person</th>
              <th>Reason</th>
              <th>Since</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${suspended.length ? suspended.map((user) => `
              <tr>
                <td>${personCell(user)}</td>
                <td>${escapeHtml(user.suspendedReason || "Not recorded")}</td>
                <td>${escapeHtml(formatAdminWhen(user.suspendedAt))}</td>
                <td>
                  <button class="btn btn--primary btn--sm" type="button" data-suspend-user data-user-id="${escapeHtml(user.id)}" data-suspended="0">Restore</button>
                </td>
              </tr>
            `).join("") : emptyRow(4, "No suspended accounts", "When you suspend someone, they cannot sign in until you restore access.")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <h3>Active accounts</h3>
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${active.slice(0, 40).map((user) => `
              <tr>
                <td>${personCell(user)}</td>
                <td>${escapeHtml(roleChip(user))}</td>
                <td>
                  <button class="btn btn--danger btn--sm" type="button" data-suspend-user data-user-id="${escapeHtml(user.id)}" data-suspended="1">Suspend</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function verificationQueueHtml({ verifications = [], counts = {}, status = "all", query = "", selected = null } = {}) {
  return `
    ${adminStatGrid([
      { label: "Pending", value: counts.pending || 0, hint: "Waiting on documents" },
      { label: "Under review", value: counts.under_review || 0, hint: "Needs an admin" },
      { label: "Verified", value: counts.verified || 0, hint: "Active credentials" },
      { label: "Held", value: (counts.rejected || 0) + (counts.suspended || 0), hint: `${counts.rejected || 0} rejected · ${counts.suspended || 0} suspended` },
    ])}
    <div class="admin-split${selected ? " has-detail" : ""}">
      <section class="card">
        ${adminToolbar({
          search: query,
          placeholder: "Search professionals",
          filters: selectFilter("status", status, VERIFICATION_STATUS_FILTERS),
        })}
        <div class="table-wrap">
          <table class="data-table data-table--compact">
            <thead>
              <tr>
                <th>Professional</th>
                <th>Type</th>
                <th>Status</th>
                <th>Submitted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${verifications.length ? verifications.map((item) => `
                <tr class="${selected?.userId === item.userId ? "is-selected" : ""}">
                  <td>
                    <strong>${escapeHtml(item.displayName || item.email)}</strong>
                    <div class="person__meta">${escapeHtml(item.email)}</div>
                  </td>
                  <td>${escapeHtml(item.credentialLabel || roleLabel(item.role))}</td>
                  <td><span class="badge ${verificationStatusBadge(item.status)}">${escapeHtml(verificationStatusLabel(item.status))}</span></td>
                  <td>${escapeHtml(formatAdminWhen(item.submittedAt || item.updatedAt))}</td>
                  <td><a class="btn btn--ghost btn--sm" href="${adminHref("verification", { id: item.userId, status, query })}">Review</a></td>
                </tr>
              `).join("") : emptyRow(5, "No verification files", "Caregivers and practitioners appear here after they choose a professional role.")}
            </tbody>
          </table>
        </div>
      </section>
      ${selected ? verificationCaseHtml(selected) : ""}
    </div>
  `;
}

function verificationCaseHtml(item) {
  const docs = item.documents || [];
  return `
    <section class="card admin-detail" data-admin-detail>
      <div class="admin-detail__head">
        ${avatarHtml(item.displayName, item.photoURL)}
        <div>
          <h3>${escapeHtml(item.displayName || item.email)}</h3>
          <p class="person__meta">${escapeHtml(item.credentialLabel || roleLabel(item.role))} · ${escapeHtml(item.email)}</p>
          <p><span class="badge ${verificationStatusBadge(item.status)}">${escapeHtml(verificationStatusLabel(item.status))}</span></p>
        </div>
      </div>
      <p class="person__meta">${escapeHtml(item.licenseNumber || "No license number")} · ${escapeHtml(item.licenseState || "No state")} · expires ${escapeHtml(item.licenseExpiresAt || "—")}</p>
      ${item.issuer ? `<p class="person__meta">${escapeHtml(item.issuer)}</p>` : ""}
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
      ${item.reviewNotes ? `<p class="person__meta">Last review: ${escapeHtml(item.reviewNotes)}</p>` : ""}
      <h3>Documents</h3>
      ${docs.length ? `
        <ul class="list">
          ${docs.map((doc) => `
            <li class="list__item">
              <div>
                <strong>${escapeHtml(doc.title || doc.fileName)}</strong>
                <div class="person__meta">${escapeHtml(doc.kindLabel || doc.kind)} · ${escapeHtml(doc.fileName || "")}${doc.isLocal ? " · Demo file" : ""}</div>
              </div>
              ${doc.canDownload ? `<button class="btn btn--ghost btn--sm" type="button" data-download-vdoc="${escapeHtml(doc.storagePath)}" data-file-name="${escapeHtml(doc.fileName || "document")}">Open</button>` : ""}
            </li>
          `).join("")}
        </ul>
      ` : `<p class="person__meta">No documents uploaded yet.</p>`}
      <div class="admin-detail__actions">
        ${item.canStartReview ? `<button class="btn btn--ghost btn--sm" type="button" data-review-verification="${escapeHtml(item.userId)}" data-review-action="${VERIFICATION_REVIEW_ACTIONS.START_REVIEW}">Start review</button>` : ""}
        ${item.canVerify ? `<button class="btn btn--primary btn--sm" type="button" data-review-verification="${escapeHtml(item.userId)}" data-review-action="${VERIFICATION_REVIEW_ACTIONS.VERIFY}">Verify</button>` : ""}
        ${item.canReject ? `<button class="btn btn--danger btn--sm" type="button" data-review-verification="${escapeHtml(item.userId)}" data-review-action="${VERIFICATION_REVIEW_ACTIONS.REJECT}">Reject</button>` : ""}
        ${item.canSuspend ? `<button class="btn btn--danger btn--sm" type="button" data-review-verification="${escapeHtml(item.userId)}" data-review-action="${VERIFICATION_REVIEW_ACTIONS.SUSPEND}">Suspend</button>` : ""}
        ${item.canRestore ? `<button class="btn btn--primary btn--sm" type="button" data-review-verification="${escapeHtml(item.userId)}" data-review-action="${VERIFICATION_REVIEW_ACTIONS.RESTORE}">Restore</button>` : ""}
      </div>
    </section>
  `;
}

export function auditLogsHtml({ logs = [], query = "", action = "all" } = {}) {
  return `
    ${adminToolbar({
      search: query,
      placeholder: "Search actor, action, or household",
      filters: selectFilter("action", action, AUDIT_ACTION_FILTERS),
    })}
    <section class="card">
      <div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            ${logs.length ? logs.map((item) => `
              <tr>
                <td>${escapeHtml(formatAdminWhen(item.createdAt))}</td>
                <td>
                  <strong>${escapeHtml(auditActionLabel(item.action))}</strong>
                  <div class="person__meta">${escapeHtml(item.action)}</div>
                </td>
                <td>
                  <strong>${escapeHtml(item.actorName || item.actorEmail || "System")}</strong>
                  <div class="person__meta">${escapeHtml(item.actorEmail || item.actorId || "")}</div>
                </td>
                <td>
                  ${escapeHtml(item.targetId || item.seniorId || "—")}
                  ${item.message ? `<div class="person__meta">${escapeHtml(item.message)}</div>` : ""}
                </td>
                <td><span class="badge ${auditResultBadge(item.ok)}">${escapeHtml(auditResultLabel(item.ok))}</span></td>
              </tr>
            `).join("") : emptyRow(5, "No audit events", "Sensitive actions from Cloud Functions appear here.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}
