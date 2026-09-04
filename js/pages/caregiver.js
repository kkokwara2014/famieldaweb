import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { emptyState } from "../components/empty-state.js";
import { avatarHtml } from "../components/avatar.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { confirmDialog, promptDialog } from "../components/modal.js";
import { openHomeIfNeeded, routes } from "../config/routes.js";
import { roleSummary } from "../config/roles.js";
import { paintDashboardChrome } from "./dashboard-chrome.js";
import { verificationBannerForSession } from "../components/verification-banner.js";
import { getCaregiverDashboard } from "../services/caregiver-dashboard-service.js";
import { acceptInvitation, declineInvitation } from "../services/care-circle-service.js";
import { acceptScheduleVisit, checkInVisit, checkOutVisit, declineScheduleVisit } from "../services/caregiver-schedule-service.js";
import { completeCarePlanTask, addCareTaskNote } from "../services/care-plan-service.js";
import { logMedicationDose } from "../services/medication-service.js";
import { postMessage } from "../services/message-service.js";

const session = await bootApp({ page: "dashboard" });
if (!openHomeIfNeeded(session, routes.caregiver)) {
  bindPage();
  await renderCaregiverDashboard();
}

function bindPage() {
  const root = qs("[data-app-page]");

  delegate(root, "click", "[data-accept-invite]", async (_event, button) => {
    await runInviteAction(button, () => acceptInvitation(button.dataset.acceptInvite), "You’re in the circle.");
  });

  delegate(root, "click", "[data-decline-invite]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Decline this invitation?",
      body: "You will not join this household. The family can send another invite later.",
      confirmLabel: "Decline invite",
      danger: true,
    });
    if (!confirmed) return;
    await runInviteAction(button, () => declineInvitation(button.dataset.declineInvite), "Invitation declined.");
  });

  delegate(root, "click", "[data-accept-visit]", async (_event, button) => {
    await runInviteAction(button, () => acceptScheduleVisit(button.dataset.acceptVisit), "Visit accepted.");
  });

  delegate(root, "click", "[data-decline-visit]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Decline this visit?",
      body: "The family will see that this time will not be covered.",
      confirmLabel: "Decline visit",
      danger: true,
    });
    if (!confirmed) return;
    await runInviteAction(button, () => declineScheduleVisit(button.dataset.declineVisit), "Visit declined.");
  });

  delegate(root, "click", "[data-checkin-visit]", async (_event, button) => {
    await runInviteAction(button, () => checkInVisit(button.dataset.checkinVisit), "Checked in.");
  });

  delegate(root, "click", "[data-checkout-visit]", async (_event, button) => {
    await runInviteAction(button, () => checkOutVisit(button.dataset.checkoutVisit), "Checked out.");
  });

  delegate(root, "click", "[data-complete-care-task]", async (_event, button) => {
    const notes = await promptDialog({
      title: "Mark this task done?",
      body: "Add a short note if anything is worth recording.",
      confirmLabel: "Mark done",
      label: "Completion notes",
      placeholder: "Taken with tea. No rush.",
    });
    if (notes == null) return;
    await runInviteAction(button, () => completeCarePlanTask(button.dataset.completeCareTask, { notes }), "Care task marked done.");
  });

  delegate(root, "click", "[data-note-care-task]", async (_event, button) => {
    const notes = await promptDialog({
      title: "Add a note",
      body: "This stays on the task for the rest of the circle.",
      confirmLabel: "Save note",
      label: "Note",
      placeholder: "She took the walk slowly and asked for water.",
      required: true,
    });
    if (notes == null) return;
    await runInviteAction(button, () => addCareTaskNote(button.dataset.noteCareTask, notes), "Note saved.");
  });

  delegate(root, "click", "[data-log-medication]", async (_event, button) => {
    const taken = button.dataset.logOutcome !== "skipped";
    const notes = await promptDialog({
      title: taken ? "Log this dose as taken?" : "Skip this dose?",
      body: taken
        ? "This records what you covered. It is not a clinical order."
        : "The skip stays on the history so the circle can see what changed.",
      confirmLabel: taken ? "Log taken" : "Skip dose",
      label: "Note (optional)",
      placeholder: taken ? "Taken with tea." : "Pharmacy bottle empty.",
      danger: !taken,
    });
    if (notes == null) return;
    await runInviteAction(
      button,
      () => logMedicationDose(button.dataset.logMedication, {
        outcome: taken ? "taken" : "skipped",
        notes,
        date: button.dataset.logDate || "",
        time: button.dataset.logTime || "",
      }),
      taken ? "Logged as taken." : "Logged as skipped.",
    );
  });

  on(root, "submit", async (event) => {
    if (!event.target.matches("[data-message-form]")) return;
    event.preventDefault();
    await sendMessage(event.target);
  });
}

async function renderCaregiverDashboard() {
  const dashboard = await getCaregiverDashboard(session);
  const senior = dashboard.senior;

  qs("[data-welcome]").textContent = `Welcome back, ${session.displayName.split(" ")[0]}`;
  qs("[data-role-label]").textContent = roleSummary(session);
  paintDashboardChrome(session, { seniorName: senior.preferredName });
  const banner = qs("[data-verify-banner]");
  if (banner) banner.innerHTML = verificationBannerForSession(session);

  qs("[data-stat-assignments]").textContent = dashboard.stats.assignments;
  qs("[data-stat-assignments-hint]").textContent = dashboard.stats.assignmentsHint;
  qs("[data-stat-visits]").textContent = dashboard.stats.visits;
  qs("[data-stat-visits-hint]").textContent = dashboard.stats.visitsHint;
  qs("[data-stat-tasks]").textContent = dashboard.stats.tasks;
  qs("[data-stat-tasks-hint]").textContent = dashboard.stats.tasksHint;
  qs("[data-stat-alerts]").textContent = dashboard.stats.alerts;
  qs("[data-stat-alerts-hint]").textContent = dashboard.stats.alertsHint;

  qs("[data-todays-assignments]").innerHTML = renderList(dashboard.todaysAssignments, {
    emptyTitle: "No assignments today",
    emptyBody: "When the family adds visits for you, they will appear here.",
    item: assignmentItem,
  });

  qs("[data-upcoming-visits]").innerHTML = renderList(dashboard.upcomingVisits, {
    emptyTitle: "No upcoming visits",
    emptyBody: "Later visits assigned to you will show here.",
    item: (visit) => `
      <li class="list__item">
        <div>
          <strong>${escapeHtml(visit.title)}</strong>
          <div class="person__meta">${escapeHtml(visit.meta)}</div>
          ${visit.notes ? `<div class="person__meta">${escapeHtml(visit.notes)}</div>` : ""}
        </div>
        <span class="badge badge--brand">${escapeHtml(visit.typeLabel)}</span>
      </li>
    `,
  });

  const engagementCard = qs("[data-engagements-card]");
  const firstEngagement = dashboard.engagements[0];
  engagementCard.classList.remove("care-status", "care-status--stable", "care-status--attention", "care-status--urgent");
  if (firstEngagement) {
    engagementCard.classList.add("care-status", `care-status--${firstEngagement.careStatus}`);
  }
  qs("[data-engagements]").innerHTML = renderEngagements(dashboard);

  qs("[data-tasks]").innerHTML = renderList(dashboard.tasks, {
    emptyTitle: "No open tasks",
    emptyBody: "Medication and household tasks assigned to you will land here.",
    item: assignmentItem,
  });

  qs("[data-invitations]").innerHTML = renderInvitations(dashboard.invitations);

  qs("[data-schedule-requests]").innerHTML = renderScheduleRequests(dashboard.scheduleRequests);

  qs("[data-visit-history]").innerHTML = renderList(dashboard.visitHistory, {
    emptyTitle: "No visit history yet",
    emptyBody: "Completed visits and check-ins you log will appear here.",
    item: (item) => `
      <li class="list__item">
        <div>
          <div class="notice__type">${escapeHtml(item.type)} · ${escapeHtml(item.when)}</div>
          <strong>${escapeHtml(item.title)}</strong>
          <p class="person__meta">${escapeHtml(item.body)}</p>
          <p class="person__meta">${escapeHtml(item.actor)}</p>
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

  qs("[data-messages]").innerHTML = renderMessages(dashboard, senior);
}

function assignmentItem(item) {
  const medActions = item.canLogMedication
    ? `
      <div class="caregiver-invite__actions">
        <button class="btn btn--primary btn--sm" type="button" data-log-medication="${escapeHtml(item.medicationId)}" data-log-date="${escapeHtml(item.medicationDate || "")}" data-log-time="${escapeHtml(item.medicationTime || "")}" data-log-outcome="taken">Log taken</button>
        <button class="btn btn--ghost btn--sm" type="button" data-log-medication="${escapeHtml(item.medicationId)}" data-log-date="${escapeHtml(item.medicationDate || "")}" data-log-time="${escapeHtml(item.medicationTime || "")}" data-log-outcome="skipped">Skip</button>
      </div>
    `
    : "";
  const taskActions = item.canComplete || item.canNote
    ? `
      <div class="caregiver-invite__actions">
        ${item.canComplete ? `<button class="btn btn--primary btn--sm" type="button" data-complete-care-task="${escapeHtml(item.careTaskId || item.id)}">Mark done</button>` : ""}
        ${item.canNote ? `<button class="btn btn--ghost btn--sm" type="button" data-note-care-task="${escapeHtml(item.careTaskId || item.id)}">Add note</button>` : ""}
      </div>
    `
    : "";
  const visitActions = item.canCheckIn || item.canCheckOut
    ? `
      <div class="caregiver-invite__actions">
        ${item.canCheckIn ? `<button class="btn btn--primary btn--sm" type="button" data-checkin-visit="${escapeHtml(item.visitId)}">Check in</button>` : ""}
        ${item.canCheckOut ? `<button class="btn btn--primary btn--sm" type="button" data-checkout-visit="${escapeHtml(item.visitId)}">Check out</button>` : ""}
      </div>
    `
    : "";
  const actions = medActions || taskActions || visitActions || `<span class="badge ${item.badge}">${escapeHtml(item.statusLabel)}</span>`;

  return `
    <li class="list__item${item.isOverdue ? " hub-task--overdue" : ""}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="person__meta">${escapeHtml(item.meta)}${item.typeLabel ? ` · ${escapeHtml(item.typeLabel)}` : ""}</div>
        ${item.notes ? `<div class="person__meta">${escapeHtml(item.notes)}</div>` : ""}
      </div>
      ${actions}
    </li>
  `;
}

function renderScheduleRequests(requests) {
  if (!requests.length) {
    return emptyState({
      title: "No schedule requests",
      body: "When a family asks for a time, accept or decline it here. Overlapping households are blocked.",
      compact: true,
    });
  }

  return requests.map((item) => `
    <article class="caregiver-invite">
      <div>
        <p class="page-kicker">Visit request</p>
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
}

function renderEngagements(dashboard) {
  if (!dashboard.engagements.length) {
    return emptyState({
      title: dashboard.invitations.length ? "Join a household" : "No engagement yet",
      body: dashboard.invitations.length
        ? "You have a care circle invitation waiting. Accept it to see who you are covering."
        : "Once a family adds you to a circle, that household will appear here.",
      actionLabel: dashboard.invitations.length ? "Review invitations" : undefined,
      actionHref: dashboard.invitations.length ? "care-circle.html" : undefined,
      compact: true,
    });
  }

  return dashboard.engagements.map((item) => `
    <article class="engagement">
      <div class="person family-senior">
        ${avatarHtml(item.seniorName, item.photoURL, { size: "lg" })}
        <div>
          <h3>${escapeHtml(item.seniorName)}</h3>
          <p class="person__meta">Goes by ${escapeHtml(item.preferredName)}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</p>
        </div>
        <span class="badge ${item.availabilityBadge}">${escapeHtml(item.availability)}</span>
      </div>
      <p class="care-status__summary">${escapeHtml(item.summary)}</p>
      <p class="person__meta">${escapeHtml(item.coverageNote)}</p>
      <p class="person__meta">${escapeHtml(item.credential)} · ${escapeHtml(item.relationship)} · Next: ${escapeHtml(item.nextVisit)}</p>
      ${item.notes ? `<p class="person__meta">${escapeHtml(item.notes)}</p>` : ""}
    </article>
  `).join("");
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
        <p class="page-kicker">Invitation</p>
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
          <label for="caregiver-message">Message the circle</label>
          <textarea id="caregiver-message" name="body" required rows="3" placeholder="A short update from today’s visit."></textarea>
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

async function runInviteAction(button, action, success) {
  setButtonLoading(button, true);
  try {
    await action();
    toast(success, { type: "success" });
    await renderCaregiverDashboard();
  } catch (error) {
    toast(error.message || "Something went wrong.", { type: "error" });
    setButtonLoading(button, false);
  }
}

async function sendMessage(form) {
  const field = form.elements.namedItem("body");
  const body = field && "value" in field ? field.value.trim() : "";
  const submit = form.querySelector("[type='submit']");
  setButtonLoading(submit, true);
  try {
    const dashboard = await getCaregiverDashboard(session);
    if (!dashboard.senior.exists) {
      throw new Error("A senior record is needed before the circle can message.");
    }
    await postMessage(dashboard.senior.id, body, session);
    toast("Message sent to the circle.", { type: "success" });
    await renderCaregiverDashboard();
  } catch (error) {
    toast(error.message || "Something went wrong.", { type: "error" });
    setButtonLoading(submit, false);
  }
}
