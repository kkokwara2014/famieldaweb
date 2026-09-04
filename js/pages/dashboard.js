import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml, initials } from "../core/dom.js";
import { emptyState } from "../components/empty-state.js";
import { avatarHtml } from "../components/avatar.js";
import { verificationChipHtml } from "../components/verification-banner.js";
import { openHomeIfNeeded, routes } from "../config/routes.js";
import { roleSummary } from "../config/roles.js";
import { paintDashboardChrome } from "./dashboard-chrome.js";
import { getFamilyDashboard } from "../services/family-dashboard-service.js";

const session = await bootApp({ page: "dashboard" });
if (!openHomeIfNeeded(session, routes.dashboard)) {
  await renderFamilyDashboard(session);
}

async function renderFamilyDashboard(session) {
  const dashboard = await getFamilyDashboard();
  const senior = dashboard.senior;

  qs("[data-welcome]").textContent = `Welcome back, ${session.displayName.split(" ")[0]}`;
  qs("[data-role-label]").textContent = roleSummary(session);
  paintDashboardChrome(session, { seniorName: senior.preferredName });

  qs("[data-stat-tasks]").textContent = dashboard.stats.tasksToday;
  qs("[data-stat-tasks-hint]").textContent = dashboard.stats.tasksHint;
  qs("[data-stat-appointments]").textContent = dashboard.stats.appointments;
  qs("[data-stat-appointments-hint]").textContent = dashboard.stats.appointmentsHint;
  qs("[data-stat-circle]").textContent = dashboard.stats.circle;
  qs("[data-stat-circle-hint]").textContent = dashboard.stats.circleHint;
  qs("[data-stat-alerts]").textContent = dashboard.stats.alerts;
  qs("[data-stat-alerts-hint]").textContent = dashboard.stats.alertsHint;

  const incomingHost = qs("[data-incoming-invites]");
  if (incomingHost) {
    incomingHost.innerHTML = dashboard.incoming.length
      ? dashboard.incoming.map((invite) => `
        <div class="alert alert--info" role="status">
          ${escapeHtml(invite.invitedByName || "A family member")} invited you to ${escapeHtml(invite.seniorName || "a household")} as ${escapeHtml(invite.relationship || "a circle member")}.
          <a href="care-circle.html">Accept or decline</a>
        </div>
      `).join("")
      : "";
  }

  qs("[data-senior-summary]").innerHTML = senior.exists
    ? `
    <div class="person family-senior">
      ${avatarHtml(senior.displayName, senior.photoURL, { size: "lg" })}
      <div>
        <h3>${escapeHtml(senior.displayName)}</h3>
        <p class="person__meta">Goes by ${escapeHtml(senior.preferredName)}${senior.age ? ` · ${senior.age}` : ""} · ${escapeHtml(senior.location)}</p>
      </div>
    </div>
    <dl class="detail-list family-details">
      <div><dt>Conditions</dt><dd>${senior.conditions.length ? escapeHtml(senior.conditions.join(", ")) : "None listed"}</dd></div>
      <div><dt>Medications</dt><dd>${senior.medications.length ? escapeHtml(senior.medications.join(", ")) : "None listed"}</dd></div>
      <div><dt>Emergency</dt><dd>${escapeHtml(senior.emergency)}</dd></div>
    </dl>
    ${chipRow(senior.conditions)}
  `
    : emptyState({
      title: dashboard.incoming.length ? "Join a household" : "No senior profile yet",
      body: dashboard.incoming.length
        ? "You have a care circle invitation waiting. Accept it to see this senior’s record."
        : "Create a profile so this dashboard has one person to gather around.",
      actionLabel: dashboard.incoming.length ? "Open care circle" : "Create senior",
      actionHref: dashboard.incoming.length ? "care-circle.html" : "senior.html",
      compact: true,
    });

  const care = dashboard.careStatus;
  const careCard = qs("[data-care-status-card]");
  careCard.classList.add(`care-status--${care.status}`);
  const careBadge = qs("[data-care-status-badge]");
  careBadge.className = `badge ${care.badge}`;
  careBadge.textContent = care.label;
  qs("[data-care-status]").innerHTML = `
    <p class="care-status__summary">${escapeHtml(care.summary)}</p>
    <p class="person__meta">${escapeHtml(care.coverageNote)}</p>
    <p class="person__meta">Updated ${escapeHtml(care.updatedLabel)}</p>
  `;

  qs("[data-todays-tasks]").innerHTML = renderList(dashboard.todaysTasks, {
    emptyTitle: "No tasks today",
    emptyBody: "When visits and medications are added, they will appear here.",
    item: (task) => `
      <li class="list__item${task.isOverdue ? " hub-task--overdue" : ""}">
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <div class="person__meta">${escapeHtml(task.meta)}</div>
          ${task.notes ? `<div class="person__meta">${escapeHtml(task.notes)}</div>` : ""}
        </div>
        <span class="badge ${task.badge}">${escapeHtml(task.statusLabel)}</span>
      </li>
    `,
  });

  qs("[data-appointments]").innerHTML = renderList(dashboard.appointments, {
    emptyTitle: "No upcoming appointments",
    emptyBody: "Clinical visits will show here once they are created.",
    item: (event) => `
      <li class="list__item">
        <div>
          <strong>${escapeHtml(event.title)}</strong>
          <div class="person__meta">${escapeHtml(event.meta)}</div>
          ${event.notes ? `<div class="person__meta">${escapeHtml(event.notes)}</div>` : ""}
        </div>
        <span class="badge ${event.badge || "badge--brand"}">${escapeHtml(event.statusLabel || "Visit")}</span>
      </li>
    `,
  });

  qs("[data-caregiver-status]").innerHTML = renderPeople(dashboard.caregivers, {
    emptyTitle: "No caregiver on the circle",
    emptyBody: "Invite a CNA, CMT, or home caregiver so the family can see who is on duty.",
  });

  qs("[data-practitioner-status]").innerHTML = renderPeople(dashboard.practitioners, {
    emptyTitle: "No practitioner on the circle",
    emptyBody: "Add a nurse, physician, or therapist to keep clinical coverage in view.",
  });

  qs("[data-activities]").innerHTML = renderList(dashboard.activities, {
    emptyTitle: "No recent activity",
    emptyBody: "Check-ins, notes, and schedule changes will land in this feed.",
    item: (activity) => `
      <li class="list__item">
        <div>
          <div class="notice__type">${escapeHtml(activity.type)} · ${escapeHtml(activity.when)}</div>
          <strong>${escapeHtml(activity.title)}</strong>
          <p class="person__meta">${escapeHtml(activity.body)}</p>
          <p class="person__meta">${escapeHtml(activity.actor)}</p>
        </div>
      </li>
    `,
  });

  qs("[data-notifications]").innerHTML = renderList(dashboard.notices, {
    emptyTitle: "No notifications yet",
    emptyBody: "Schedule and circle alerts for this household will appear here.",
    item: (notice) => `
      <li class="list__item notice${notice.read ? "" : " is-unread"}${notice.isEmergency ? " is-emergency" : ""}">
          <a class="notice__link" href="${escapeHtml(notice.href || "notifications.html")}" data-notice-id="${escapeHtml(notice.id || "")}">
            <div>
              <div class="notice__type">${escapeHtml(notice.type)} · ${escapeHtml(notice.when)}</div>
              <strong>${escapeHtml(notice.title)}</strong>
              <p class="person__meta">${escapeHtml(notice.body)}</p>
            </div>
            <span class="badge ${notice.isEmergency ? "badge--danger" : notice.read ? "badge--neutral" : "badge--accent"}">${notice.isEmergency ? "Alert" : notice.read ? "Read" : "New"}</span>
          </a>
        </li>
    `,
  });

  const messagesHost = qs("[data-messages]");
  if (messagesHost) {
    messagesHost.innerHTML = renderList(dashboard.messages || [], {
      emptyTitle: "No messages yet",
      emptyBody: "Message Maya, the nurse, physiotherapist, or MD on this circle.",
      item: (item) => `
        <li class="list__item">
          <div>
            <div class="notice__type">${escapeHtml(item.subtitle || "Message")} · ${escapeHtml(item.when || "")}</div>
            <strong>${escapeHtml(item.title)}</strong>
            <p class="person__meta">${escapeHtml(item.preview || "")}</p>
          </div>
          <a class="btn btn--ghost btn--sm" href="messages.html?thread=${encodeURIComponent(item.id)}">${item.unread ? "New" : "Open"}</a>
        </li>
      `,
    });
  }

  const circle = dashboard.circle;
  qs("[data-circle-summary]").innerHTML = circle.members.length
    ? `
      <div class="circle-counts">
        <span><strong>${circle.family}</strong> family</span>
        <span><strong>${circle.caregivers}</strong> caregivers</span>
        <span><strong>${circle.practitioners}</strong> clinicians</span>
      </div>
      <ul class="list">
        ${circle.members.map((member) => `
          <li class="list__item">
            <div class="person">
              <div class="avatar">${initials(member.name)}</div>
              <div>
                <strong>${escapeHtml(member.name)}</strong>
                <div class="person__meta">${escapeHtml(member.relationship)}</div>
              </div>
            </div>
            <span class="badge badge--accent">${escapeHtml(member.role)}</span>
          </li>
        `).join("")}
      </ul>
    `
    : emptyState({
      title: dashboard.incoming.length ? "You have an invitation waiting" : "The circle is empty",
      body: dashboard.incoming.length
        ? "Open Care Circle to accept or decline before the household record is shared."
        : "Invite the people already helping.",
      actionLabel: dashboard.incoming.length ? "Open care circle" : undefined,
      actionHref: dashboard.incoming.length ? "care-circle.html" : undefined,
      compact: true,
    });

  const plan = dashboard.subscription;
  qs("[data-subscription]").innerHTML = `
    <div class="subscription-panel">
      <div>
        <p class="stat-card__label">Current plan</p>
        <p class="stat-card__value">${escapeHtml(plan.name)}</p>
        <p class="person__meta">${escapeHtml(plan.hint)}</p>
      </div>
      <span class="badge ${plan.badge}">${escapeHtml(plan.status)}</span>
    </div>
    <p>${escapeHtml(plan.summary)}</p>
    <p><a class="btn ${plan.id === "free" ? "btn--primary" : "btn--ghost"} btn--sm" href="${escapeHtml(plan.href)}">${escapeHtml(plan.actionLabel)}</a></p>
  `;
}

function chipRow(items) {
  if (!items.length) return "";
  return `<div class="chip-row">${items.map((item) => `<span class="badge badge--neutral">${escapeHtml(item)}</span>`).join("")}</div>`;
}

function renderList(items, { emptyTitle, emptyBody, item }) {
  if (!items.length) {
    return emptyState({ title: emptyTitle, body: emptyBody, compact: true });
  }
  return `<ul class="list">${items.map(item).join("")}</ul>`;
}

function renderPeople(people, { emptyTitle, emptyBody }) {
  if (!people.length) {
    return emptyState({ title: emptyTitle, body: emptyBody, compact: true });
  }
  return people.map((person) => `
    <article class="status-person">
      <div class="person">
        <div class="avatar">${initials(person.name)}</div>
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <div class="person__meta">${escapeHtml(person.credential)} · ${escapeHtml(person.relationship)}</div>
        </div>
      </div>
      <span class="badge ${person.availabilityBadge}">${escapeHtml(person.availability)}</span>
      ${verificationChipHtml(person.verificationStatus)}
      <p class="person__meta">Last seen ${escapeHtml(person.lastSeen)}</p>
      <p class="person__meta">Next: ${escapeHtml(person.nextVisit)}</p>
      ${person.notes ? `<p class="person__meta">${escapeHtml(person.notes)}</p>` : ""}
    </article>
  `).join("");
}
