import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { emptyState } from "../components/empty-state.js";
import { avatarHtml } from "../components/avatar.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { confirmDialog } from "../components/modal.js";
import { openHomeIfNeeded, routes } from "../config/routes.js";
import { roleSummary } from "../config/roles.js";
import { paintDashboardChrome } from "./dashboard-chrome.js";
import { verificationBannerForSession } from "../components/verification-banner.js";
import { ACTIVITY_TYPES, CARE_HISTORY_KINDS } from "../config/constants.js";
import { getPractitionerDashboard } from "../services/practitioner-dashboard-service.js";
import { acceptInvitation, declineInvitation } from "../services/care-circle-service.js";
import { acceptScheduleVisit, declineScheduleVisit } from "../services/caregiver-schedule-service.js";
import { postActivity } from "../services/activity-service.js";
import { postMessage } from "../services/message-service.js";

const session = await bootApp({ page: "dashboard" });
if (!openHomeIfNeeded(session, routes.practitioner)) {
  bindPage();
  await renderPractitionerDashboard();
}

function bindPage() {
  const root = qs("[data-app-page]");

  delegate(root, "click", "[data-accept-invite]", async (_event, button) => {
    await runAction(button, () => acceptInvitation(button.dataset.acceptInvite), "You’re on this circle.");
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

  delegate(root, "click", "[data-accept-visit]", async (_event, button) => {
    await runAction(button, () => acceptScheduleVisit(button.dataset.acceptVisit), "Appointment accepted.");
  });

  delegate(root, "click", "[data-decline-visit]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Decline this appointment?",
      body: "The family will see that this time will not be held.",
      confirmLabel: "Decline appointment",
      danger: true,
    });
    if (!confirmed) return;
    await runAction(button, () => declineScheduleVisit(button.dataset.declineVisit), "Appointment declined.");
  });

  on(root, "submit", async (event) => {
    if (event.target.matches("[data-note-form]")) {
      event.preventDefault();
      await saveNote(event.target);
      return;
    }
    if (event.target.matches("[data-message-form]")) {
      event.preventDefault();
      await sendMessage(event.target);
    }
  });
}

async function renderPractitionerDashboard() {
  const dashboard = await getPractitionerDashboard(session);
  const senior = dashboard.senior;

  qs("[data-welcome]").textContent = `Welcome back, ${firstName(session.displayName)}`;
  qs("[data-role-label]").textContent = roleSummary(session);
  paintDashboardChrome(session, { seniorName: senior.preferredName });
  const banner = qs("[data-verify-banner]");
  if (banner) banner.innerHTML = verificationBannerForSession(session);

  qs("[data-stat-seniors]").textContent = dashboard.stats.seniors;
  qs("[data-stat-seniors-hint]").textContent = dashboard.stats.seniorsHint;
  qs("[data-stat-appointments]").textContent = dashboard.stats.appointments;
  qs("[data-stat-appointments-hint]").textContent = dashboard.stats.appointmentsHint;
  qs("[data-stat-invitations]").textContent = dashboard.stats.invitations;
  qs("[data-stat-invitations-hint]").textContent = dashboard.stats.invitationsHint;
  qs("[data-stat-alerts]").textContent = dashboard.stats.alerts;
  qs("[data-stat-alerts-hint]").textContent = dashboard.stats.alertsHint;

  const assignedCard = qs("[data-assigned-card]");
  const firstAssigned = dashboard.assignedSeniors[0];
  assignedCard.classList.remove("care-status", "care-status--stable", "care-status--attention", "care-status--urgent");
  if (firstAssigned) {
    assignedCard.classList.add("care-status", `care-status--${firstAssigned.careStatus}`);
  }
  qs("[data-assigned-seniors]").innerHTML = renderAssignedSeniors(dashboard);

  qs("[data-appointments]").innerHTML = renderAppointments(dashboard);

  qs("[data-invitations]").innerHTML = renderInvitations(dashboard.invitations);
  qs("[data-schedule]").innerHTML = renderSchedule(dashboard.schedule);
  qs("[data-care-information]").innerHTML = renderCareInformation(dashboard, senior);
  qs("[data-notes]").innerHTML = renderNotes(dashboard, senior);

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

  qs("[data-messages]").innerHTML = renderMessages(dashboard, senior);
}

function renderAssignedSeniors(dashboard) {
  if (!dashboard.assignedSeniors.length) {
    return emptyState({
      title: dashboard.invitations.length ? "Join a household" : "No assigned senior yet",
      body: dashboard.invitations.length
        ? "You have a care circle invitation waiting. Accept it to see that senior’s record."
        : "Once a family adds you to a circle, that household will appear here.",
      actionLabel: dashboard.invitations.length ? "Review invitations" : undefined,
      actionHref: dashboard.invitations.length ? "care-circle.html" : undefined,
      compact: true,
    });
  }

  return dashboard.assignedSeniors.map((item) => `
    <article class="engagement">
      <div class="person family-senior">
        ${avatarHtml(item.seniorName, item.photoURL, { size: "lg" })}
        <div>
          <h3>${escapeHtml(item.seniorName)}</h3>
          <p class="person__meta">Goes by ${escapeHtml(item.preferredName)}${item.age ? ` · ${escapeHtml(item.age)}` : ""}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</p>
        </div>
        <span class="badge ${item.careBadge}">${escapeHtml(item.careLabel)}</span>
      </div>
      <p class="care-status__summary">${escapeHtml(item.summary)}</p>
      <p class="person__meta">${escapeHtml(item.coverageNote)}</p>
      <p class="person__meta">${escapeHtml(item.credential)} · ${escapeHtml(item.relationship)} · Next: ${escapeHtml(item.nextVisit)}</p>
      ${item.conditions.length ? `<div class="chip-row">${item.conditions.map((condition) => `<span class="badge badge--neutral">${escapeHtml(condition)}</span>`).join("")}</div>` : ""}
    </article>
  `).join("");
}

function renderAppointments(dashboard) {
  const requests = dashboard.appointmentRequests || [];
  if (!requests.length && !dashboard.appointments.length) {
    return emptyState({
      title: "No appointments this week",
      body: "Clinical visits for your assigned seniors will show here. Families request inside your published hours.",
      compact: true,
    });
  }

  const requestHtml = requests.map((item) => `
    <article class="caregiver-invite">
      <div>
        <p class="page-kicker">Appointment request</p>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="person__meta">${escapeHtml(item.seniorName)} · ${escapeHtml(item.when)}</p>
        ${item.familyName ? `<p class="person__meta">From ${escapeHtml(item.familyName)}</p>` : ""}
      </div>
      <div class="caregiver-invite__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-decline-visit="${escapeHtml(item.id)}">Decline</button>
        <button class="btn btn--primary btn--sm" type="button" data-accept-visit="${escapeHtml(item.id)}">Accept</button>
      </div>
    </article>
  `).join("");

  const listHtml = dashboard.appointments.length
    ? `<ul class="list">${dashboard.appointments.map((event) => `
        <li class="list__item">
          <div>
            <strong>${escapeHtml(event.title)}</strong>
            <div class="person__meta">${escapeHtml(event.meta)}</div>
            ${event.notes ? `<div class="person__meta">${escapeHtml(event.notes)}</div>` : ""}
          </div>
          <span class="badge ${escapeHtml(event.badge || "badge--brand")}">${escapeHtml(event.typeLabel)}</span>
        </li>
      `).join("")}</ul>`
    : "";

  return `${requestHtml}${listHtml}`;
}

function renderInvitations(invites) {
  if (!invites.length) {
    return emptyState({
      title: "No invitations waiting",
      body: "When a family invites you onto a circle, you can accept or decline here.",
      compact: true,
    });
  }

  return invites.map((invite) => `
    <article class="caregiver-invite">
      <div>
        <p class="page-kicker">${escapeHtml(invite.kindLabel)}</p>
        <h3>Join ${escapeHtml(invite.seniorName)}</h3>
        <p class="person__meta">${escapeHtml(invite.invitedByName)} invited you as ${escapeHtml(invite.relationship)}</p>
        ${invite.message ? `<p>${escapeHtml(invite.message)}</p>` : ""}
      </div>
      <div class="caregiver-invite__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-decline-invite="${escapeHtml(invite.id)}">Decline</button>
        <button class="btn btn--primary btn--sm" type="button" data-accept-invite="${escapeHtml(invite.id)}">Accept</button>
      </div>
    </article>
  `).join("");
}

function renderSchedule(week) {
  const days = week.filter((day) => day.events.length);
  if (!days.length) {
    return emptyState({
      title: "Nothing on the clinical week",
      body: "Appointments and medications for your assigned seniors will appear here.",
      compact: true,
    });
  }

  return `
    <div class="practitioner-week">
      ${days.map((day) => `
        <section class="practitioner-day${day.isToday ? " is-today" : ""}">
          <h3>${escapeHtml(day.label)}${day.isToday ? " · Today" : ""}</h3>
          <ul class="list">
            ${day.events.map((event) => `
              <li class="list__item">
                <div>
                  <strong>${escapeHtml(event.time)}${event.endTime ? ` – ${escapeHtml(event.endTime)}` : ""} · ${escapeHtml(event.title)}</strong>
                  <div class="person__meta">${escapeHtml(event.assignee)}${event.notes ? ` · ${escapeHtml(event.notes)}` : ""}</div>
                </div>
                <span class="badge ${event.mine ? "badge--accent" : "badge--brand"}">${escapeHtml(event.mine ? "Yours" : event.typeLabel)}</span>
              </li>
            `).join("")}
          </ul>
        </section>
      `).join("")}
    </div>
  `;
}

function renderCareInformation(dashboard, senior) {
  const info = dashboard.careInformation;
  if (!info.exists) {
    return emptyState({
      title: dashboard.invitations.length ? "Join a household" : "No care record yet",
      body: dashboard.invitations.length
        ? "Accept a care circle invitation to see conditions, medications, and clinical notes."
        : "Clinical details will attach to the household senior record once it exists.",
      actionLabel: dashboard.invitations.length ? "Open care circle" : "Open senior hub",
      actionHref: dashboard.invitations.length ? "care-circle.html" : "senior.html",
      compact: true,
    });
  }

  return `
    <dl class="detail-list family-details">
      ${info.rows.map((row) => `
        <div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>
      `).join("")}
    </dl>
    ${info.allergies.length || info.conditions.length ? `
      <div class="chip-row">
        ${info.allergies.map((item) => `<span class="badge badge--danger">${escapeHtml(item)}</span>`).join("")}
        ${info.conditions.map((item) => `<span class="badge badge--neutral">${escapeHtml(item)}</span>`).join("")}
      </div>
    ` : ""}
    ${info.medicalNotes ? `<p class="care-status__summary">${escapeHtml(info.medicalNotes)}</p>` : ""}
    ${info.carePlan ? `
      <div class="hub-note">
        <div class="card__header">
          <h3>${escapeHtml(info.carePlan.title)}</h3>
          <span class="badge ${info.carePlan.badge}">${escapeHtml(info.carePlan.statusLabel)}</span>
        </div>
        ${info.carePlan.goal ? `<p>${escapeHtml(info.carePlan.goal)}</p>` : ""}
        <p class="person__meta">${info.carePlan.progress.done} of ${info.carePlan.progress.total} tasks complete · ${info.carePlan.dueToday} due today</p>
      </div>
    ` : ""}
    ${senior.exists ? `<p class="person__meta"><a href="senior.html?section=care-plan">Care plan</a> · <a href="senior.html?section=medications">Medications</a> · <a href="senior.html?section=documents">Documents</a></p>` : ""}
  `;
}

function renderNotes(dashboard, senior) {
  const feed = dashboard.notes.length
    ? `<ul class="list">${dashboard.notes.map((item) => `
        <li class="list__item">
          <div>
            <div class="notice__type">${escapeHtml(item.type)} · ${escapeHtml(item.when)}</div>
            <strong>${escapeHtml(item.title)}</strong>
            <p class="person__meta">${escapeHtml(item.body)}</p>
            <p class="person__meta">${escapeHtml(item.actor)}</p>
          </div>
          ${item.pinned ? `<span class="badge badge--neutral">Record</span>` : ""}
        </li>
      `).join("")}</ul>`
    : emptyState({
      title: "No clinical notes yet",
      body: "Medical notes from the record and notes you add will appear here.",
      compact: true,
    });

  const compose = senior.exists
    ? `
      <form class="caregiver-compose form" data-note-form>
        <div class="field">
          <label for="practitioner-note">Add a clinical note</label>
          <textarea id="practitioner-note" name="body" required rows="3" placeholder="A short note for the household record."></textarea>
        </div>
        <div class="caregiver-compose__actions">
          <button class="btn btn--primary" type="submit">Save note</button>
        </div>
      </form>
    `
    : "";

  return `${feed}${compose}`;
}

function renderMessages(dashboard, senior) {
  const thread = dashboard.messages.length
    ? `<ul class="list">${dashboard.messages.map((item) => `
        <li class="list__item">
          <div>
            <div class="notice__type">${escapeHtml(item.subtitle || "Message")} · ${escapeHtml(item.when || "")}</div>
            <strong>${escapeHtml(item.title)}</strong>
            <p class="person__meta">${escapeHtml(item.preview || "")}</p>
          </div>
          <a class="btn btn--ghost btn--sm" href="messages.html?thread=${encodeURIComponent(item.id)}">${item.unread ? "New" : "Open"}</a>
        </li>
      `).join("")}</ul>`
    : emptyState({
      title: "No messages yet",
      body: "Private threads with family on this household will appear here.",
      compact: true,
    });

  const compose = senior.exists
    ? `
      <form class="caregiver-compose form" data-message-form>
        <div class="field">
          <label for="practitioner-message">Message the circle</label>
          <textarea id="practitioner-message" name="body" required rows="3" placeholder="A short clinical update for the family."></textarea>
        </div>
        <div class="caregiver-compose__actions">
          <button class="btn btn--primary" type="submit">Send to circle</button>
        </div>
      </form>
    `
    : "";

  return `${thread}${compose}`;
}

function renderList(items, { emptyTitle, emptyBody, item }) {
  if (!items.length) {
    return emptyState({ title: emptyTitle, body: emptyBody, compact: true });
  }
  return `<ul class="list">${items.map(item).join("")}</ul>`;
}

function firstName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (/^dr\.?$/i.test(parts[0]) && parts[1]) return parts[1];
  return parts[0] || "there";
}

async function runAction(button, action, success) {
  setButtonLoading(button, true);
  try {
    await action();
    toast(success, { type: "success" });
    await renderPractitionerDashboard();
  } catch (error) {
    toast(error.message || "Something went wrong.", { type: "error" });
    setButtonLoading(button, false);
  }
}

async function saveNote(form) {
  const field = form.elements.namedItem("body");
  const body = field && "value" in field ? field.value.trim() : "";
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  try {
    await postActivity({
      type: ACTIVITY_TYPES.CLINICAL,
      kind: CARE_HISTORY_KINDS.CLINICAL,
      title: "Clinical note",
      body,
      seniorId: session?.seniorId,
      source: "activity",
    }, session);
    toast("Note saved to the record.", { type: "success" });
    await renderPractitionerDashboard();
  } catch (error) {
    toast(error.message || "Something went wrong.", { type: "error" });
    setButtonLoading(submit, false);
  }
}

async function sendMessage(form) {
  const field = form.elements.namedItem("body");
  const body = field && "value" in field ? field.value.trim() : "";
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  try {
    const dashboard = await getPractitionerDashboard(session);
    if (!dashboard.senior.exists) {
      throw new Error("A senior record is needed before the circle can message.");
    }
    await postMessage(dashboard.senior.id, body, session);
    toast("Message sent to the circle.", { type: "success" });
    await renderPractitionerDashboard();
  } catch (error) {
    toast(error.message || "Something went wrong.", { type: "error" });
    setButtonLoading(submit, false);
  }
}
