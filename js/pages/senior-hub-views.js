import { escapeHtml, initials } from "../core/dom.js";
import { emptyState } from "../components/empty-state.js";
import { SENIOR_HUB_SECTIONS } from "../config/senior-hub.js";
import { CARE_HISTORY_FILTERS, CARE_HISTORY_PLUS_MESSAGE } from "../config/care-history.js";
import { REPORT_PLUS_FEATURES, REPORT_RANGES } from "../config/reports.js";
import { DOCUMENT_CATEGORY_OPTIONS, DOCUMENT_PLUS_FEATURES } from "../config/document.js";
import { messagingInboxHtml } from "./messaging-views.js";

export function hubNavHtml(activeId) {
  return `
    <nav class="hub-nav" aria-label="Senior care hub">
      ${SENIOR_HUB_SECTIONS.map((item) => `
        <a class="hub-nav__link${item.id === activeId ? " is-active" : ""}" href="${item.href}" ${item.id === activeId ? 'aria-current="page"' : ""}>
          ${escapeHtml(item.label)}
        </a>
      `).join("")}
    </nav>
  `;
}

export function hubPageHead({ kicker = "Senior care hub", title, lead, action }) {
  return `
    <div class="welcome hub-head">
      <div>
        <p class="page-kicker">${escapeHtml(kicker)}</p>
        <h2>${escapeHtml(title)}</h2>
        ${lead ? `<p class="page-lead">${lead}</p>` : ""}
      </div>
      ${action ?? ""}
    </div>
  `;
}

export function overviewSnapshotHtml(hub) {
  const care = hub.careStatus;
  return `
    <div class="stat-grid hub-stats">
      <article class="stat-card">
        <p class="stat-card__label">Today’s tasks</p>
        <p class="stat-card__value">${hub.counts.tasksToday}</p>
        <p class="stat-card__hint">${hub.counts.tasksOpen ? `${hub.counts.tasksOpen} still open` : "All done for now"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Appointments</p>
        <p class="stat-card__value">${hub.counts.appointments}</p>
        <p class="stat-card__hint">${hub.appointments[0] ? `Next: ${escapeHtml(hub.appointments[0].when)}` : "None upcoming"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Care team</p>
        <p class="stat-card__value">${hub.counts.caregivers + hub.counts.practitioners}</p>
        <p class="stat-card__hint">${hub.counts.caregivers} caregivers · ${hub.counts.practitioners} clinicians</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Messages</p>
        <p class="stat-card__value">${hub.counts.messages}</p>
        <p class="stat-card__hint">${hub.messaging?.counts?.unread ? `${hub.messaging.counts.unread} unread` : "Circle and private threads"}</p>
      </article>
    </div>

    <section class="card care-status care-status--${escapeHtml(care.status)}" aria-labelledby="hub-care-status-title">
      <div class="card__header">
        <h2 id="hub-care-status-title">Care status</h2>
        <span class="badge ${care.badge}">${escapeHtml(care.label)}</span>
      </div>
      <p class="care-status__summary">${escapeHtml(care.summary)}</p>
      <p class="person__meta">${escapeHtml(care.coverageNote)}</p>
      <p class="person__meta">Updated ${escapeHtml(care.updatedLabel)}</p>
    </section>

    ${todayHistoryCard(hub)}

    <section class="card" aria-labelledby="hub-shortcuts-title">
      <div class="card__header">
        <h2 id="hub-shortcuts-title">Care workspace</h2>
      </div>
      <div class="hub-shortcuts">
        ${hub.shortcuts.map((item) => `
          <a class="hub-shortcut" href="${item.href}">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.hint || item.summary)}</span>
          </a>
        `).join("")}
      </div>
    </section>
  `;
}

export function renderHubSection(section, { senior, hub }) {
  const name = senior.preferredName || senior.displayName;
  const renderers = {
    "care-plan": renderCarePlan,
    tasks: renderTasks,
    schedule: renderSchedule,
    caregivers: () => renderPeopleSection({
      title: "Caregivers",
      lead: `People providing daily support for ${escapeHtml(name)}.`,
      people: hub.caregivers,
      emptyTitle: "No caregiver on the circle",
      emptyBody: "Invite a CNA, CMT, or home caregiver so coverage is visible here.",
      actionHref: "care-circle.html",
      actionLabel: "Open care circle",
    }),
    practitioners: () => renderPeopleSection({
      title: "Health Practitioners",
      lead: `Clinical people on ${escapeHtml(name)}’s record.`,
      people: hub.practitioners,
      emptyTitle: "No practitioner on the circle",
      emptyBody: "Add a nurse, physician, or therapist to keep clinical coverage in view.",
      actionHref: "care-circle.html",
      actionLabel: "Open care circle",
    }),
    medications: renderMedications,
    appointments: renderAppointments,
    history: renderHistory,
    reports: renderReports,
    documents: renderDocuments,
    messages: renderMessages,
  };

  const renderer = renderers[section.id];
  const body = renderer ? renderer({ senior, hub, name }) : "";
  return `${hubNavHtml(section.id)}${body}`;
}

function renderCarePlan({ hub, name }) {
  const plans = hub.carePlan || [];
  const canManage = Boolean(hub.canManageCare);
  const progress = hub.careProgress || { done: 0, total: 0, percent: 0, overdue: 0, open: 0 };
  const actions = canManage
    ? `<div class="hub-head__actions">
        <button class="btn btn--ghost" type="button" data-create-plan>Create plan</button>
        ${plans[0] ? `<button class="btn btn--primary" type="button" data-add-task="${escapeHtml(plans[0].id)}">Assign task</button>` : ""}
      </div>`
    : "";

  return `
    ${hubPageHead({
      title: "Care Plan",
      lead: `Goals, assigned work, and what has been completed for ${escapeHtml(name)}.`,
      action: actions,
    })}
    ${progress.total ? `
      <div class="stat-grid hub-stats">
        <article class="stat-card">
          <p class="stat-card__label">Open tasks</p>
          <p class="stat-card__value">${progress.open}</p>
          <p class="stat-card__hint">${progress.overdue ? `${progress.overdue} overdue` : "On track"}</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__label">Completed</p>
          <p class="stat-card__value">${progress.done}</p>
          <p class="stat-card__hint">On the current plans</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__label">Due today</p>
          <p class="stat-card__value">${hub.careDueToday?.length ?? 0}</p>
          <p class="stat-card__hint">${hub.careOverdue?.length ? `${hub.careOverdue.length} overdue` : "Nothing overdue"}</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__label">Completion</p>
          <p class="stat-card__value">${progress.percent}%</p>
          <p class="stat-card__hint">${progress.done} of ${progress.total} tracked</p>
        </article>
      </div>
    ` : ""}
    ${plans.length ? `
      <div class="hub-stack">
        ${plans.map((plan) => renderPlanCard(plan, canManage)).join("")}
      </div>
    ` : emptyState({
      title: "No care plan yet",
      body: canManage
        ? "Create a plan, then assign tasks with a frequency, due date, and caregiver."
        : "When the family or a clinician writes a plan, tasks will appear here.",
    })}
    ${hub.supportNotes?.length ? `
      <section class="card" aria-labelledby="support-notes-title">
        <div class="card__header">
          <h2 id="support-notes-title">Support notes</h2>
          <a class="btn btn--ghost btn--sm" href="senior.html?mode=edit#preferences">Edit profile</a>
        </div>
        <div class="hub-stack hub-stack--tight">
          ${hub.supportNotes.map((item) => `
            <article class="hub-note">
              <div class="card__header">
                <h3>${escapeHtml(item.title)}</h3>
                <span class="badge badge--brand">${escapeHtml(item.category)}</span>
              </div>
              <p>${escapeHtml(item.detail)}</p>
              <p class="person__meta">Owner · ${escapeHtml(item.owner)}</p>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${hub.careCompletions?.length ? `
      <section class="card" aria-labelledby="care-tracking-title">
        <div class="card__header">
          <h2 id="care-tracking-title">Completion tracking</h2>
        </div>
        <ul class="list">
          ${hub.careCompletions.map((item) => `
            <li class="list__item">
              <div>
                <strong>${escapeHtml(item.taskTitle)}</strong>
                <div class="person__meta">${escapeHtml(item.completedByName || "Care circle")} · ${escapeHtml(item.when)}</div>
                ${item.notes ? `<div class="person__meta">${escapeHtml(item.notes)}</div>` : ""}
              </div>
              <span class="badge ${item.outcome === "skipped" ? "badge--neutral" : "badge--success"}">${item.outcome === "skipped" ? "Skipped" : "Done"}</span>
            </li>
          `).join("")}
        </ul>
      </section>
    ` : ""}
  `;
}

function renderPlanCard(plan, canManage) {
  const progress = plan.progress || { done: 0, total: 0, percent: 0 };
  return `
    <article class="card hub-plan">
      <div class="card__header">
        <div>
          <h2>${escapeHtml(plan.title)}</h2>
          <p class="person__meta">${escapeHtml(plan.goal || "No goal recorded yet.")}</p>
        </div>
        <span class="badge ${plan.badge}">${escapeHtml(plan.statusLabel)}</span>
      </div>
      <div class="hub-plan-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}" aria-label="Plan completion">
        <span style="width: ${progress.percent}%"></span>
      </div>
      <p class="person__meta">${progress.done} of ${progress.total} tasks complete${progress.overdue ? ` · ${progress.overdue} overdue` : ""}</p>
      ${plan.notes ? `<p>${escapeHtml(plan.notes)}</p>` : ""}
      ${canManage ? `
        <div class="hub-plan__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-edit-plan="${escapeHtml(plan.id)}">Update plan</button>
          <button class="btn btn--primary btn--sm" type="button" data-add-task="${escapeHtml(plan.id)}">Assign task</button>
        </div>
      ` : ""}
      ${plan.tasks.length ? careTaskList(plan.tasks) : `<p class="person__meta">No tasks on this plan yet.</p>`}
    </article>
  `;
}

function careTaskList(items) {
  return `
    <ul class="list">
      ${items.map((task) => careTaskItem(task)).join("")}
    </ul>
  `;
}

function careTaskItem(task) {
  const overdueClass = task.isOverdue ? " hub-task--overdue" : "";
  return `
    <li class="list__item hub-task${overdueClass}" data-task-id="${escapeHtml(task.id)}">
      <div>
        <div class="hub-task__title">
          <strong>${escapeHtml(task.title)}</strong>
          <span class="badge ${task.priorityBadge || "badge--brand"}">${escapeHtml(task.priorityLabel || "Medium")}</span>
        </div>
        <div class="person__meta">${escapeHtml(task.meta)}</div>
        ${task.notes ? `<div class="person__meta">${escapeHtml(task.notes)}</div>` : ""}
        ${task.latestNote ? `<div class="person__meta">Note · ${escapeHtml(task.latestNote.createdByName || "Circle")} · ${escapeHtml(task.latestNote.body)}</div>` : ""}
        ${task.completionCount ? `<div class="person__meta">Done ${task.completionCount} time${task.completionCount === 1 ? "" : "s"}${task.lastCompletedLabel ? ` · last ${escapeHtml(task.lastCompletedLabel)}` : ""}</div>` : ""}
      </div>
      <div class="hub-task__aside">
        <span class="badge ${task.badge}">${escapeHtml(task.statusLabel)}</span>
        <div class="hub-task__actions">
          ${task.canComplete ? `<button class="btn btn--primary btn--sm" type="button" data-complete-task="${escapeHtml(task.id)}">Mark done</button>` : ""}
          ${task.canComplete ? `<button class="btn btn--ghost btn--sm" type="button" data-skip-task="${escapeHtml(task.id)}">Skip</button>` : ""}
          ${task.canNote ? `<button class="btn btn--ghost btn--sm" type="button" data-note-task="${escapeHtml(task.id)}">Add note</button>` : ""}
          ${task.canEdit ? `<button class="btn btn--ghost btn--sm" type="button" data-edit-task="${escapeHtml(task.id)}">Edit</button>` : ""}
        </div>
      </div>
    </li>
  `;
}

function renderTasks({ hub, name }) {
  const canManage = Boolean(hub.canManageCare);
  const careTasks = hub.careTasks || [];
  const overdue = hub.careOverdue || [];
  const dueToday = hub.careDueToday || [];
  const recurring = hub.careRecurring || [];
  const completed = hub.careCompleted || [];
  const today = [
    ...dueToday.map((task) => ({ ...task, source: "care" })),
    ...hub.todaysTasks,
  ];
  const createAction = canManage
    ? `<div class="hub-head__actions">
        <button class="btn btn--primary" type="button" data-create-task>Create task</button>
      </div>`
    : "";

  return `
    ${hubPageHead({
      title: "Care tasks",
      lead: `Create, assign, and complete work for ${escapeHtml(name)} — with priority, due dates, and notes.`,
      action: createAction,
    })}
    <div class="stat-grid hub-stats">
      <article class="stat-card">
        <p class="stat-card__label">Due today</p>
        <p class="stat-card__value">${dueToday.length}</p>
        <p class="stat-card__hint">${dueToday.length ? "On the care plan" : "Nothing due today"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Overdue</p>
        <p class="stat-card__value">${overdue.length}</p>
        <p class="stat-card__hint">${overdue.length ? "Needs a look" : "Caught up"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Recurring</p>
        <p class="stat-card__value">${recurring.length}</p>
        <p class="stat-card__hint">Daily, weekly, or monthly</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Open</p>
        <p class="stat-card__value">${hub.careProgress?.open ?? 0}</p>
        <p class="stat-card__hint">${hub.careProgress?.done ?? 0} already done</p>
      </article>
    </div>
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist">
        <button class="tabs__tab is-active" type="button" data-tab="today">Today (${today.length})</button>
        <button class="tabs__tab" type="button" data-tab="overdue">Overdue (${overdue.length})</button>
        <button class="tabs__tab" type="button" data-tab="recurring">Recurring (${recurring.length})</button>
        <button class="tabs__tab" type="button" data-tab="all">All (${careTasks.length})</button>
        <button class="tabs__tab" type="button" data-tab="done">Done (${completed.length})</button>
      </div>
      <div data-tab-panel="today">
        ${today.length ? mixedTaskList(today) : emptyState({
          title: "Nothing on today’s list",
          body: "Create a care task or it will appear here when it is due.",
          compact: true,
        })}
      </div>
      <div data-tab-panel="overdue" hidden>
        ${overdue.length
          ? careTaskList(overdue)
          : emptyState({
            title: "Nothing overdue",
            body: "Missed due dates will collect here until someone marks them done.",
            compact: true,
          })}
      </div>
      <div data-tab-panel="recurring" hidden>
        ${recurring.length
          ? careTaskList(recurring)
          : emptyState({
            title: "No recurring tasks",
            body: "Daily, weekly, and monthly work will stay on this list until the repeat date ends.",
            compact: true,
          })}
      </div>
      <div data-tab-panel="all" hidden>
        ${careTasks.length
          ? careTaskList(careTasks)
          : emptyState({
            title: "No care tasks yet",
            body: canManage
              ? "Create a task, set a priority and due date, and assign it to someone on the circle."
              : "When the family assigns care work, it will appear here.",
            compact: true,
          })}
      </div>
      <div data-tab-panel="done" hidden>
        ${completed.length
          ? careTaskList(completed)
          : emptyState({
            title: "No completed tasks",
            body: "Finished one-time work and closed recurrences will land here.",
            compact: true,
          })}
      </div>
    </div>
  `;
}

function renderSchedule({ hub, name }) {
  const hasEvents = hub.week.some((day) => day.events.length);
  return `
    ${hubPageHead({
      title: "Schedule",
      lead: `${escapeHtml(name)}’s shared week — medications, care, and visits.`,
      action: `<a class="btn btn--primary" href="schedule.html">Manage schedule</a>`,
    })}
    ${hasEvents ? `
      <div class="week-grid">
        ${hub.week.map((day) => `
          <section class="day-col">
            <h3>${escapeHtml(day.label)}</h3>
            ${day.events.length ? day.events.map((event) => `
              <article class="event-chip${event.type === "appointment" ? " event-chip--clay" : ""}${event.visitStatus ? ` event-chip--${event.visitStatus}` : ""}">
                <strong>${escapeHtml(event.time)}</strong>
                <div>${escapeHtml(event.title)}</div>
                <div class="person__meta">${escapeHtml(event.assignee)}</div>
              </article>
            `).join("") : `<p class="person__meta">No visits</p>`}
          </section>
        `).join("")}
      </div>
    ` : emptyState({
      title: "No visits this week",
      body: "Medications, rides, and appointments will appear here when they are added.",
    })}
  `;
}

function renderPeopleSection({ title, lead, people, emptyTitle, emptyBody, actionHref, actionLabel }) {
  return `
    ${hubPageHead({
      title,
      lead,
      action: `<a class="btn btn--ghost" href="${actionHref}">${escapeHtml(actionLabel)}</a>`,
    })}
    ${people.length ? `
      <div class="hub-people">
        ${people.map((person) => `
          <article class="card">
            <div class="person">
              <div class="avatar">${initials(person.name)}</div>
              <div>
                <h3>${escapeHtml(person.name)}</h3>
                <p class="person__meta">${escapeHtml(person.credential)} · ${escapeHtml(person.relationship)}</p>
              </div>
              <span class="badge ${person.availabilityBadge}">${escapeHtml(person.availability)}</span>
            </div>
            <p class="person__meta">Last seen ${escapeHtml(person.lastSeen)}</p>
            <p class="person__meta">Next: ${escapeHtml(person.nextVisit)}</p>
            ${person.notes ? `<p>${escapeHtml(person.notes)}</p>` : ""}
          </article>
        `).join("")}
      </div>
    ` : emptyState({ title: emptyTitle, body: emptyBody, actionLabel, actionHref })}
  `;
}

function renderMedications({ hub, name, senior }) {
  const canManage = Boolean(hub.canManageMedications);
  const isPlus = Boolean(hub.medicationPlus);
  const active = hub.medicationActive || hub.medications || [];
  const due = hub.medicationDue || [];
  const reminders = hub.medicationReminders || [];
  const paused = hub.medicationPaused || [];
  const ended = hub.medicationEnded || [];
  const history = hub.medicationHistory || [];
  const dueOpen = due.filter((item) => !item.outcome || item.outcome === "missed");
  const createAction = canManage
    ? `<div class="hub-head__actions">
        <button class="btn btn--primary" type="button" data-create-medication>Add medication</button>
      </div>`
    : "";

  return `
    ${hubPageHead({
      kicker: "Senior care hub · Plus",
      title: "Medications",
      lead: `A shared list the circle is coordinating for ${escapeHtml(name)} — name, dosage, frequency, dates, reminders, and history. Famielda does not diagnose or prescribe.`,
      action: createAction,
    })}
    <div class="alert alert--info hub-alert" role="note">
      This is care coordination: what the household is covering and who logged it. It is not a prescription pad, a diagnosis, or medical advice.
    </div>
    ${!isPlus && canManage ? `
      <div class="alert alert--warning hub-alert" role="status">
        Medication management is a Famielda Plus feature. <a href="settings.html?tab=plans">Upgrade to Plus</a> to keep dosage, schedule, reminders, and history on this list.
      </div>
    ` : ""}
    ${senior.allergies?.length ? `
      <div class="alert alert--warning hub-alert" role="status">
        Allergies on the profile: ${escapeHtml(senior.allergies.join(", "))}
      </div>
    ` : ""}
    <div class="stat-grid hub-stats">
      <article class="stat-card">
        <p class="stat-card__label">On the list</p>
        <p class="stat-card__value">${active.length}</p>
        <p class="stat-card__hint">${paused.length ? `${paused.length} paused` : "Active now"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Due today</p>
        <p class="stat-card__value">${dueOpen.length}</p>
        <p class="stat-card__hint">${due.length ? `${due.length} slots on today’s list` : "Nothing scheduled"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Reminders</p>
        <p class="stat-card__value">${reminders.length}</p>
        <p class="stat-card__hint">${reminders.length ? "Before the dose time" : "None set"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">History</p>
        <p class="stat-card__value">${history.length}</p>
        <p class="stat-card__hint">${ended.length ? `${ended.length} ended` : "Logged by the circle"}</p>
      </article>
    </div>
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist">
        <button class="tabs__tab is-active" type="button" data-tab="active">Active (${active.length})</button>
        <button class="tabs__tab" type="button" data-tab="due">Due today (${due.length})</button>
        <button class="tabs__tab" type="button" data-tab="history">History (${history.length})</button>
        <button class="tabs__tab" type="button" data-tab="ended">Ended (${ended.length + paused.length})</button>
      </div>
      <div data-tab-panel="active">
        ${active.length ? medicationList(active) : `
          ${senior.medications?.length ? `
            <ul class="list">
              ${senior.medications.map((item) => `
                <li class="list__item">
                  <div>
                    <strong>${escapeHtml(item)}</strong>
                    <div class="person__meta">On the profile snapshot. Add it to the shared list for dosage, schedule, reminders, and history.</div>
                  </div>
                </li>
              `).join("")}
            </ul>
          ` : ""}
          ${emptyState({
            title: senior.medications?.length ? "Move these onto the shared list" : "No medications on the shared list",
            body: canManage
              ? (isPlus
                ? "Add what the circle is already covering — name, dosage, how often, and when it starts."
                : "Plus can keep this list, reminders, and a history of what was taken.")
              : "When the family adds medications to coordinate, they will appear here.",
            actionLabel: canManage && !isPlus ? "View plans" : "",
            actionHref: canManage && !isPlus ? "settings.html?tab=plans" : "",
            compact: true,
          })}
        `}
      </div>
      <div data-tab-panel="due" hidden>
        ${due.length ? dueMedicationList(due) : emptyState({
          title: "Nothing due today",
          body: "Scheduled doses for today will show here so someone can log taken or skipped.",
          compact: true,
        })}
      </div>
      <div data-tab-panel="history" hidden>
        ${history.length ? medicationHistoryList(history) : emptyState({
          title: "No medication history yet",
          body: "Taken and skipped logs stay here so the circle can see what already happened.",
          compact: true,
        })}
      </div>
      <div data-tab-panel="ended" hidden>
        ${paused.length || ended.length
          ? `${paused.length ? `<h3 class="hub-subhead">Paused</h3>${medicationList(paused)}` : ""}
             ${ended.length ? `<h3 class="hub-subhead">Ended</h3>${medicationList(ended)}` : ""}`
          : emptyState({
            title: "Nothing paused or ended",
            body: "When a course ends or the circle pauses an item, it remains on the record here.",
            compact: true,
          })}
      </div>
    </div>
  `;
}

function medicationList(items) {
  return `
    <ul class="list">
      ${items.map((item) => medicationItem(item)).join("")}
    </ul>
  `;
}

function medicationItem(item) {
  return `
    <li class="list__item hub-task" data-medication-id="${escapeHtml(item.id)}">
      <div>
        <div class="hub-task__title">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="badge ${item.badge}">${escapeHtml(item.statusLabel)}</span>
        </div>
        <div class="person__meta">${escapeHtml(item.dosage)} · ${escapeHtml(item.scheduleLabel)}</div>
        <div class="person__meta">${escapeHtml(item.windowLabel)} · ${escapeHtml(item.responsibleLabel)}</div>
        <div class="person__meta">Reminder · ${escapeHtml(item.reminderLabel || "None")}</div>
        ${item.clinicianName ? `<div class="person__meta">Clinician on the record · ${escapeHtml(item.clinicianName)}</div>` : ""}
        ${item.notes ? `<div class="person__meta">${escapeHtml(item.notes)}</div>` : ""}
        ${item.lastLogged ? `<div class="person__meta">Last logged · ${escapeHtml(item.lastLogged.outcomeLabel)} · ${escapeHtml(item.lastLogged.when)}</div>` : ""}
      </div>
      <div class="hub-task__aside">
        <div class="hub-task__actions">
          ${item.canLog ? `<button class="btn btn--primary btn--sm" type="button" data-log-medication="${escapeHtml(item.id)}" data-log-outcome="taken">Log taken</button>` : ""}
          ${item.canLog ? `<button class="btn btn--ghost btn--sm" type="button" data-log-medication="${escapeHtml(item.id)}" data-log-outcome="skipped">Skip</button>` : ""}
          ${item.canEdit ? `<button class="btn btn--ghost btn--sm" type="button" data-edit-medication="${escapeHtml(item.id)}">Edit</button>` : ""}
          ${item.canPause ? `<button class="btn btn--ghost btn--sm" type="button" data-pause-medication="${escapeHtml(item.id)}">Pause</button>` : ""}
          ${item.canResume ? `<button class="btn btn--ghost btn--sm" type="button" data-resume-medication="${escapeHtml(item.id)}">Resume</button>` : ""}
          ${item.canEnd ? `<button class="btn btn--ghost btn--sm" type="button" data-end-medication="${escapeHtml(item.id)}">End</button>` : ""}
        </div>
      </div>
    </li>
  `;
}

function dueMedicationList(items) {
  return `
    <ul class="list">
      ${items.map((item) => `
        <li class="list__item hub-task${item.outcome === "missed" ? " hub-task--overdue" : ""}">
          <div>
            <div class="hub-task__title">
              <strong>${escapeHtml(item.title || item.name)}</strong>
              <span class="badge ${item.badge}">${escapeHtml(item.outcomeLabel)}</span>
            </div>
            <div class="person__meta">${escapeHtml(item.meta || "")}</div>
            ${item.notes ? `<div class="person__meta">${escapeHtml(item.notes)}</div>` : ""}
          </div>
          <div class="hub-task__aside">
            <div class="hub-task__actions">
              ${item.canLog ? `<button class="btn btn--primary btn--sm" type="button" data-log-medication="${escapeHtml(item.medicationId)}" data-log-date="${escapeHtml(item.date)}" data-log-time="${escapeHtml(item.time)}" data-log-outcome="taken">Log taken</button>` : ""}
              ${item.canLog ? `<button class="btn btn--ghost btn--sm" type="button" data-log-medication="${escapeHtml(item.medicationId)}" data-log-date="${escapeHtml(item.date)}" data-log-time="${escapeHtml(item.time)}" data-log-outcome="skipped">Skip</button>` : ""}
            </div>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function medicationHistoryList(items) {
  return `
    <ul class="list">
      ${items.map((item) => `
        <li class="list__item">
          <div>
            <div class="hub-task__title">
              <strong>${escapeHtml(item.name)}</strong>
              <span class="badge ${item.badge}">${escapeHtml(item.outcomeLabel)}</span>
            </div>
            <div class="person__meta">${escapeHtml(item.dosage)} · ${escapeHtml(item.timeLabel)} · ${escapeHtml(item.when)}</div>
            ${item.recordedByName ? `<div class="person__meta">Logged by ${escapeHtml(item.recordedByName)}</div>` : ""}
            ${item.notes ? `<div class="person__meta">${escapeHtml(item.notes)}</div>` : ""}
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderAppointments({ hub, name }) {
  const canManage = Boolean(hub.canManageAppointments);
  const upcoming = hub.appointmentUpcoming || hub.appointments || [];
  const today = hub.appointmentToday || [];
  const past = hub.appointmentPast || [];
  const cancelled = hub.appointmentCancelled || [];
  const reminders = hub.appointmentReminders || [];
  const calendar = hub.appointmentCalendar;
  const selectedDay = hub.appointmentDay || "";
  const selectedItems = (hub.appointmentRecords || upcoming).filter((item) => (
    item.date === selectedDay && item.liveStatus !== "cancelled"
  ));
  const createAction = canManage
    ? `<div class="hub-head__actions">
        <button class="btn btn--primary" type="button" data-create-appointment>Create appointment</button>
      </div>`
    : "";

  return `
    ${hubPageHead({
      title: "Appointments",
      lead: `Create, edit, and keep ${escapeHtml(name)}’s clinical visits on a calendar — with reminders, status, and the practitioner on the record.`,
      action: createAction,
    })}
    <div class="stat-grid hub-stats">
      <article class="stat-card">
        <p class="stat-card__label">Upcoming</p>
        <p class="stat-card__value">${upcoming.length}</p>
        <p class="stat-card__hint">${upcoming[0] ? escapeHtml(upcoming[0].when) : "None scheduled"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Today</p>
        <p class="stat-card__value">${today.length}</p>
        <p class="stat-card__hint">${today.length ? "On the calendar" : "Nothing today"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Reminders</p>
        <p class="stat-card__value">${reminders.length}</p>
        <p class="stat-card__hint">${reminders.length ? "Before the visit" : "None set"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Cancelled</p>
        <p class="stat-card__value">${cancelled.length}</p>
        <p class="stat-card__hint">${past.length} already completed</p>
      </article>
    </div>
    ${calendar ? `
      <section class="card hub-calendar-card" aria-labelledby="appointment-calendar-title">
        <div class="card__header">
          <h2 id="appointment-calendar-title">Calendar</h2>
          <div class="hub-calendar__nav">
            <button class="btn btn--ghost btn--sm" type="button" data-calendar-prev aria-label="Previous month">Previous</button>
            <p class="hub-calendar__label">${escapeHtml(calendar.label)}</p>
            <button class="btn btn--ghost btn--sm" type="button" data-calendar-next aria-label="Next month">Next</button>
          </div>
        </div>
        ${renderAppointmentCalendar(calendar)}
        <div class="hub-calendar__selected">
          <h3>${selectedDay ? escapeHtml(selectedItems.length ? "On this day" : "Nothing on this day") : "Choose a day"}</h3>
          ${selectedItems.length ? appointmentList(selectedItems) : `<p class="person__meta">Select a date to see visits, or create one.</p>`}
        </div>
      </section>
    ` : ""}
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist">
        <button class="tabs__tab is-active" type="button" data-tab="upcoming">Upcoming (${upcoming.length})</button>
        <button class="tabs__tab" type="button" data-tab="reminders">Reminders (${reminders.length})</button>
        <button class="tabs__tab" type="button" data-tab="past">Past (${past.length})</button>
        <button class="tabs__tab" type="button" data-tab="cancelled">Cancelled (${cancelled.length})</button>
      </div>
      <div data-tab-panel="upcoming">
        ${upcoming.length ? appointmentList(upcoming) : emptyState({
          title: "No upcoming appointments",
          body: canManage
            ? "Create an appointment, link a practitioner, and set a reminder so the circle is ready."
            : "When the family books a visit, it will appear here.",
          compact: true,
        })}
      </div>
      <div data-tab-panel="reminders" hidden>
        ${reminders.length ? appointmentList(reminders) : emptyState({
          title: "No reminders set",
          body: "Choose 15 minutes, an hour, or a day before when you create or edit a visit.",
          compact: true,
        })}
      </div>
      <div data-tab-panel="past" hidden>
        ${past.length ? appointmentList(past) : emptyState({
          title: "No past appointments",
          body: "Completed and missed visits will collect here.",
          compact: true,
        })}
      </div>
      <div data-tab-panel="cancelled" hidden>
        ${cancelled.length ? appointmentList(cancelled) : emptyState({
          title: "No cancelled appointments",
          body: "Cancelled visits stay on the record so the circle can see what changed.",
          compact: true,
        })}
      </div>
    </div>
  `;
}

function renderAppointmentCalendar(calendar) {
  return `
    <div class="hub-calendar" role="grid" aria-label="${escapeHtml(calendar.label)}">
      ${calendar.weekdayLabels.map((label) => `<div class="hub-calendar__dow">${escapeHtml(label)}</div>`).join("")}
      ${calendar.cells.map((cell) => {
        if (!cell) return `<div class="hub-calendar__cell is-empty" aria-hidden="true"></div>`;
        const classes = [
          "hub-calendar__cell",
          cell.isToday ? "is-today" : "",
          cell.isSelected ? "is-selected" : "",
          cell.count ? "has-events" : "",
        ].filter(Boolean).join(" ");
        return `
          <button class="${classes}" type="button" data-calendar-day="${escapeHtml(cell.date)}" aria-pressed="${cell.isSelected ? "true" : "false"}">
            <span class="hub-calendar__date">${cell.day}</span>
            ${cell.count ? `<span class="hub-calendar__count">${cell.count}</span>` : ""}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function appointmentList(items) {
  return `
    <ul class="list">
      ${items.map((item) => appointmentItem(item)).join("")}
    </ul>
  `;
}

function appointmentItem(item) {
  return `
    <li class="list__item hub-task" data-appointment-id="${escapeHtml(item.id)}">
      <div>
        <div class="hub-task__title">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="badge ${item.badge}">${escapeHtml(item.statusLabel)}</span>
        </div>
        <div class="person__meta">${escapeHtml(item.meta)}</div>
        ${item.practitionerName ? `<div class="person__meta">Practitioner · ${escapeHtml(item.practitionerName)}</div>` : `<div class="person__meta">No clinician linked</div>`}
        <div class="person__meta">Reminder · ${escapeHtml(item.reminderLabel || "None")}</div>
        ${item.notes ? `<div class="person__meta">${escapeHtml(item.notes)}</div>` : ""}
        ${item.cancelReason ? `<div class="person__meta">Cancelled · ${escapeHtml(item.cancelReason)}</div>` : ""}
      </div>
      <div class="hub-task__aside">
        <div class="hub-task__actions">
          ${item.canConfirm ? `<button class="btn btn--primary btn--sm" type="button" data-confirm-appointment="${escapeHtml(item.id)}">Confirm</button>` : ""}
          ${item.canComplete ? `<button class="btn btn--ghost btn--sm" type="button" data-complete-appointment="${escapeHtml(item.id)}">Mark done</button>` : ""}
          ${item.canEdit ? `<button class="btn btn--ghost btn--sm" type="button" data-edit-appointment="${escapeHtml(item.id)}">Edit</button>` : ""}
          ${item.canCancel ? `<button class="btn btn--ghost btn--sm" type="button" data-cancel-appointment="${escapeHtml(item.id)}">Cancel</button>` : ""}
        </div>
      </div>
    </li>
  `;
}

function renderHistory({ hub, name }) {
  const history = hub.history || { days: [], today: [], counts: {}, canAddNote: false, isPlus: false };
  if (!history.isPlus) {
    return `
      ${hubPageHead({
        kicker: "Senior care hub",
        title: "Care History",
        lead: `A chronological record of what already happened around ${escapeHtml(name)}.`,
      })}
      ${plusHistoryTeaser()}
    `;
  }
  const counts = history.counts || {};
  const days = history.days || [];
  const action = history.canAddNote
    ? `<div class="hub-head__actions">
        <button class="btn btn--primary" type="button" data-add-history-note>Add a note</button>
      </div>`
    : "";

  return `
    ${hubPageHead({
      title: "Care History",
      lead: `A chronological record of what already happened around ${escapeHtml(name)} — check-ins, tasks, medications, and notes.`,
      action,
    })}
    <div class="stat-grid hub-stats">
      <article class="stat-card">
        <p class="stat-card__label">Today</p>
        <p class="stat-card__value">${counts.today || 0}</p>
        <p class="stat-card__hint">${counts.checkIns ? `${counts.checkIns} check-in${counts.checkIns === 1 ? "" : "s"}` : "Nothing logged yet"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Tasks done</p>
        <p class="stat-card__value">${counts.tasks || 0}</p>
        <p class="stat-card__hint">Completed today</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Medications</p>
        <p class="stat-card__value">${counts.medications || 0}</p>
        <p class="stat-card__hint">Recorded today</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">This week</p>
        <p class="stat-card__value">${counts.week || 0}</p>
        <p class="stat-card__hint">${counts.total || 0} on the full record</p>
      </article>
    </div>
    <div class="care-history-toolbar">
      <div class="chip-row care-history-filters" role="tablist" aria-label="Filter care history">
        ${CARE_HISTORY_FILTERS.map((item, index) => `
          <button class="chip-filter${index === 0 ? " is-active" : ""}" type="button" data-history-filter="${item.id}" ${index === 0 ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
            ${escapeHtml(item.label)}
          </button>
        `).join("")}
      </div>
      <label class="care-history-search">
        <span class="visually-hidden">Search care history</span>
        <input type="search" data-history-search placeholder="Search the timeline" autocomplete="off">
      </label>
    </div>
    ${days.length ? `
      <div class="care-timeline" data-care-timeline>
        ${days.map((day) => historyDayHtml(day)).join("")}
      </div>
      <div class="care-history-empty" data-history-empty hidden>
        ${emptyState({
          title: "Nothing matches that filter",
          body: "Try All, or search for a caregiver, task, or medication.",
          compact: true,
        })}
      </div>
    ` : emptyState({
      title: "No care history yet",
      body: "Check-ins, completed tasks, medications, and notes will land on this timeline.",
    })}
  `;
}

function plusHistoryTeaser() {
  return `
    <section class="card reports-plus-teaser">
      <div class="card__header">
        <h2>Care history</h2>
        <span class="badge badge--warning">Plus</span>
      </div>
      <p>${escapeHtml(CARE_HISTORY_PLUS_MESSAGE)}</p>
      <div class="hub-head__actions">
        <a class="btn btn--primary" href="settings.html?tab=plans">Upgrade to Plus</a>
      </div>
    </section>
  `;
}

function todayHistoryCard(hub) {
  if (!hub.history?.isPlus && !hub.historyPlus) return "";
  const today = hub.history?.today || [];
  if (!today.length) return "";
  return `
    <section class="card" aria-labelledby="hub-today-history-title">
      <div class="card__header">
        <h2 id="hub-today-history-title">Today so far</h2>
        <a class="btn btn--text btn--sm" href="senior.html?section=history">Open care history</a>
      </div>
      ${historyTreeHtml({ id: "today", label: "Today", events: today.length > 6 ? today.slice(-6) : today })}
    </section>
  `;
}

function historyDayHtml(day) {
  return `
    <section class="care-timeline__day" data-history-day="${escapeHtml(day.id)}">
      <h3 class="care-timeline__label">${escapeHtml(day.label)}</h3>
      ${historyTreeHtml(day)}
    </section>
  `;
}

function historyTreeHtml(day) {
  const events = day.events || [];
  return `
    <ol class="care-timeline__list">
      ${events.map((item, index) => historyItemHtml(item, index === events.length - 1)).join("")}
    </ol>
  `;
}

function historyItemHtml(item, isLast) {
  const searchText = [item.title, item.body, item.actor, item.kindLabel].filter(Boolean).join(" ").toLowerCase();
  return `
    <li class="care-timeline__item care-timeline__item--${escapeHtml(item.kind)}" data-history-item data-kind="${escapeHtml(item.kind)}" data-search="${escapeHtml(searchText)}" ${isLast ? 'data-last="true"' : ""}>
      <span class="care-timeline__branch" aria-hidden="true">${isLast ? "└──" : "├──"}</span>
      <div class="care-timeline__row">
        <time class="care-timeline__time" datetime="${escapeHtml(item.occurredAt || item.createdAt || "")}">${escapeHtml(item.time)}</time>
        <div class="care-timeline__copy">
          <div class="care-timeline__headline">
            <p class="care-timeline__title">${escapeHtml(item.title)}</p>
            <span class="badge ${item.badge}">${escapeHtml(item.kindLabel)}</span>
          </div>
          ${item.body ? `<p class="care-timeline__body">${escapeHtml(item.body)}</p>` : ""}
          <p class="person__meta">${escapeHtml(item.actor || "Household")}${item.href ? ` · <a href="${escapeHtml(item.href)}">Open</a>` : ""}</p>
        </div>
      </div>
    </li>
  `;
}

function renderReports({ hub, name }) {
  const report = hub.reports || {};
  const summary = report.summary || {};
  const isPlus = Boolean(report.isPlus);
  const actions = isPlus
    ? `<div class="hub-head__actions">
        <button class="btn btn--ghost" type="button" data-export-report="csv">Export CSV</button>
        <button class="btn btn--primary" type="button" data-export-report="pdf">Generate PDF</button>
      </div>`
    : "";

  return `
    ${hubPageHead({
      kicker: isPlus ? "Senior care hub · Plus" : "Senior care hub",
      title: "Reports",
      lead: isPlus
        ? `A care summary for ${escapeHtml(name)}, plus activity, completion, visits, and trends you can export.`
        : `A basic care summary for ${escapeHtml(name)}. Plus adds activity, trends, export, and a printable PDF.`,
      action: actions,
    })}
    ${basicCareSummary(summary, name)}
    ${isPlus ? advancedReportsHtml(report, name) : plusReportsTeaser()}
  `;
}

function basicCareSummary(summary, name) {
  const next = summary.nextAppointment;
  return `
    <div class="family-board hub-reports">
      <section class="card">
        <div class="card__header">
          <h2>Today</h2>
          <span class="badge ${summary.statusBadge || "badge--success"}">${escapeHtml(summary.statusLabel || "Stable")}</span>
        </div>
        <p>${escapeHtml(summary.statusSummary || "")}</p>
        <dl class="detail-list">
          <div><dt>Tasks done</dt><dd>${summary.tasksDone || 0} of ${summary.tasksTotal || 0}</dd></div>
          <div><dt>Still open</dt><dd>${summary.tasksOpen || 0}</dd></div>
          <div><dt>Care plan</dt><dd>${escapeHtml(summary.careProgress || "None yet")}</dd></div>
          <div><dt>Overdue tasks</dt><dd>${summary.overdue || 0}</dd></div>
          <div><dt>On duty</dt><dd>${escapeHtml(summary.onDutyName || "Not assigned")}</dd></div>
        </dl>
      </section>
      <section class="card">
        <div class="card__header">
          <h2>This week</h2>
        </div>
        <dl class="detail-list">
          <div><dt>Appointments</dt><dd>${summary.weekAppointments || 0}</dd></div>
          <div><dt>Medications on record</dt><dd>${summary.weekMedications || 0}</dd></div>
          <div><dt>Caregivers</dt><dd>${summary.weekCaregivers || 0}</dd></div>
          <div><dt>Health practitioners</dt><dd>${summary.weekPractitioners || 0}</dd></div>
          <div><dt>Unread alerts</dt><dd>${summary.unread || 0}</dd></div>
        </dl>
      </section>
      <section class="card">
        <div class="card__header">
          <h2>Coverage note</h2>
        </div>
        <p>${escapeHtml(summary.coverageNote || "")}</p>
        <p class="person__meta">Updated ${escapeHtml(summary.updatedLabel || "")}</p>
      </section>
      <section class="card">
        <div class="card__header">
          <h2>Next appointment</h2>
        </div>
        ${next ? `
          <h3>${escapeHtml(next.title)}</h3>
          <p class="person__meta">${escapeHtml(next.meta || "")}</p>
          ${next.notes ? `<p>${escapeHtml(next.notes)}</p>` : ""}
        ` : emptyState({
          title: "No visit scheduled",
          body: `Upcoming clinical visits for ${escapeHtml(name)} will appear in this report.`,
          compact: true,
        })}
      </section>
    </div>
  `;
}

function plusReportsTeaser() {
  return `
    <section class="card reports-plus-teaser">
      <div class="card__header">
        <h2>Advanced reports</h2>
        <span class="badge badge--warning">Plus</span>
      </div>
      <p>Plus adds caregiver activity, task completion, visit history, care trends, CSV export, and a printable PDF.</p>
      <ul class="reports-plus-grid">
        ${REPORT_PLUS_FEATURES.map((item) => `
          <li>
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.body)}</span>
          </li>
        `).join("")}
      </ul>
      <div class="hub-head__actions">
        <a class="btn btn--primary" href="settings.html?tab=plans">Upgrade to Plus</a>
      </div>
    </section>
  `;
}

function advancedReportsHtml(report, name) {
  const range = report.range || REPORT_RANGES[0];
  const advanced = report.advanced || {};
  const totals = advanced.totals || {};
  return `
    <div class="care-history-toolbar reports-toolbar">
      <div class="chip-row" role="tablist" aria-label="Report range">
        ${REPORT_RANGES.map((item) => `
          <button class="chip-filter${item.id === range.id ? " is-active" : ""}" type="button" data-report-range="${item.id}" aria-pressed="${item.id === range.id ? "true" : "false"}">
            ${escapeHtml(item.label)}
          </button>
        `).join("")}
      </div>
      <p class="person__meta">${escapeHtml(range.startLabel || "")} – ${escapeHtml(range.endLabel || "")} · Generated ${escapeHtml(report.generatedLabel || "")}</p>
    </div>
    <div class="stat-grid hub-stats">
      <article class="stat-card">
        <p class="stat-card__label">Visits completed</p>
        <p class="stat-card__value">${totals.visitsCompleted || 0}</p>
        <p class="stat-card__hint">${escapeHtml(totals.visitHoursLabel || "0h")} on the clock</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Task completion</p>
        <p class="stat-card__value">${escapeHtml(totals.taskRate || "—")}</p>
        <p class="stat-card__hint">${totals.tasksCompleted || 0} done · ${totals.tasksSkipped || 0} skipped</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Check-ins</p>
        <p class="stat-card__value">${totals.checkIns || 0}</p>
        <p class="stat-card__hint">${totals.reports || 0} visit report${totals.reports === 1 ? "" : "s"}</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Medications logged</p>
        <p class="stat-card__value">${totals.medicationsTaken || 0}</p>
        <p class="stat-card__hint">${totals.medicationsLogged || 0} on the period record</p>
      </article>
    </div>
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist" aria-label="Advanced reports">
        <button class="tabs__tab is-active" type="button" data-tab="caregivers" aria-selected="true">Caregiver activity</button>
        <button class="tabs__tab" type="button" data-tab="tasks" aria-selected="false">Task completion</button>
        <button class="tabs__tab" type="button" data-tab="visits" aria-selected="false">Visit history</button>
        <button class="tabs__tab" type="button" data-tab="trends" aria-selected="false">Care trends</button>
      </div>
      <div data-tab-panel="caregivers">
        ${caregiverActivityHtml(advanced.caregivers || [])}
      </div>
      <div data-tab-panel="tasks" hidden>
        ${taskCompletionHtml(advanced.tasks || {})}
      </div>
      <div data-tab-panel="visits" hidden>
        ${visitHistoryHtml(advanced.visits || [])}
      </div>
      <div data-tab-panel="trends" hidden>
        ${careTrendsHtml(advanced.trends || [], name)}
      </div>
    </div>
  `;
}

function caregiverActivityHtml(rows) {
  if (!rows.length) {
    return emptyState({
      title: "No caregiver activity in this range",
      body: "Check-ins, completed visits, and logged tasks will land here.",
    });
  }
  return `
    <ul class="list">
      ${rows.map((row) => `
        <li class="list__item">
          <div class="person">
            <div class="avatar">${initials(row.name)}</div>
            <div>
              <strong>${escapeHtml(row.name)}</strong>
              <div class="person__meta">${row.visits} visit${row.visits === 1 ? "" : "s"} · ${escapeHtml(row.hoursLabel)} · ${row.checkIns} check-in${row.checkIns === 1 ? "" : "s"}</div>
              <div class="person__meta">${row.reports} report${row.reports === 1 ? "" : "s"} · ${row.tasks} task${row.tasks === 1 ? "" : "s"} completed</div>
            </div>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function taskCompletionHtml(tasks) {
  const recent = tasks.recent || [];
  const assignees = tasks.byAssignee || [];
  const categories = tasks.byCategory || [];
  return `
    <div class="stat-grid hub-stats">
      <article class="stat-card">
        <p class="stat-card__label">Completed</p>
        <p class="stat-card__value">${tasks.completed || 0}</p>
        <p class="stat-card__hint">${escapeHtml(tasks.rate || "—")} of logged work</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Skipped</p>
        <p class="stat-card__value">${tasks.skipped || 0}</p>
        <p class="stat-card__hint">In this range</p>
      </article>
      <article class="stat-card">
        <p class="stat-card__label">Still overdue</p>
        <p class="stat-card__value">${tasks.overdue || 0}</p>
        <p class="stat-card__hint">Open on the care plan</p>
      </article>
    </div>
    <div class="family-board hub-reports">
      <section class="card">
        <div class="card__header">
          <h3>By person</h3>
        </div>
        ${assignees.length ? `
          <ul class="list">
            ${assignees.map((row) => `
              <li class="list__item">
                <div><strong>${escapeHtml(row.label)}</strong></div>
                <span class="badge badge--success">${row.count} done</span>
              </li>
            `).join("")}
          </ul>
        ` : emptyState({ title: "No completions yet", body: "Finished care tasks will group here by who logged them.", compact: true })}
      </section>
      <section class="card">
        <div class="card__header">
          <h3>By category</h3>
        </div>
        ${categories.filter((row) => row.count).length ? `
          <ul class="list">
            ${categories.filter((row) => row.count).map((row) => `
              <li class="list__item">
                <div>
                  <strong>${escapeHtml(row.label)}</strong>
                  <div class="person__meta">${row.done || 0} done · ${row.skipped || 0} skipped</div>
                </div>
                <span class="badge badge--brand">${row.count}</span>
              </li>
            `).join("")}
          </ul>
        ` : emptyState({ title: "No category mix yet", body: "Completions will group by medication, mobility, meals, and the rest.", compact: true })}
      </section>
    </div>
    ${recent.length ? `
      <h3 class="hub-subhead">Recent completions</h3>
      <ul class="list">
        ${recent.map((item) => `
          <li class="list__item">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <div class="person__meta">${escapeHtml(item.actor)} · ${escapeHtml(item.when)}</div>
              ${item.notes ? `<div class="person__meta">${escapeHtml(item.notes)}</div>` : ""}
            </div>
            <span class="badge ${item.badge}">${escapeHtml(item.outcomeLabel)}</span>
          </li>
        `).join("")}
      </ul>
    ` : ""}
  `;
}

function visitHistoryHtml(visits) {
  if (!visits.length) {
    return emptyState({
      title: "No completed visits in this range",
      body: "Checked-out visits and submitted reports will appear here.",
    });
  }
  return `
    <ul class="list">
      ${visits.map((visit) => `
        <li class="list__item">
          <div>
            <strong>${escapeHtml(visit.title)}</strong>
            <div class="person__meta">${escapeHtml(visit.dateLabel)} · ${escapeHtml(visit.caregiver)} · ${escapeHtml(visit.hoursLabel)}</div>
            ${visit.moodLabel ? `<div class="person__meta">${escapeHtml(visit.moodLabel)}${visit.summary ? ` · ${escapeHtml(visit.summary)}` : ""}</div>` : visit.summary ? `<div class="person__meta">${escapeHtml(visit.summary)}</div>` : ""}
            ${visit.followUp ? `<div class="person__meta">Follow-up · ${escapeHtml(visit.followUp)}</div>` : ""}
          </div>
          <span class="badge ${visit.badge}">${escapeHtml(visit.statusLabel)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function careTrendsHtml(days, name) {
  if (!days.length) {
    return emptyState({
      title: "No trend yet",
      body: `Activity around ${escapeHtml(name)} will chart here as the week fills in.`,
    });
  }
  return `
    <div class="care-trend" role="img" aria-label="Care activity by day">
      ${days.map((day) => `
        <div class="care-trend__col" title="${escapeHtml(day.label)}: ${day.total} logged">
          <div class="care-trend__track">
            <span class="care-trend__fill" style="height: ${Math.max(day.total ? 8 : 2, day.percent || 0)}%"></span>
          </div>
          <span class="care-trend__label">${escapeHtml(day.shortLabel)}</span>
          <span class="care-trend__count">${day.total}</span>
        </div>
      `).join("")}
    </div>
    <p class="person__meta">Each bar is visits, completed tasks, medications taken, and check-ins for that day.</p>
    <div class="family-board hub-reports care-trend-legend">
      ${days.filter((day) => day.total).slice(-7).map((day) => `
        <section class="card card--nested">
          <h3>${escapeHtml(day.label)}</h3>
          <p class="person__meta">${day.visits} visit${day.visits === 1 ? "" : "s"} · ${day.tasks} task${day.tasks === 1 ? "" : "s"} · ${day.medications} med${day.medications === 1 ? "" : "s"} · ${day.checkIns} check-in${day.checkIns === 1 ? "" : "s"}</p>
        </section>
      `).join("")}
    </div>
  `;
}

export function reportPrintHtml(report, name) {
  const summary = report?.summary || {};
  const advanced = report?.advanced || {};
  const range = report?.range || {};
  const totals = advanced.totals || {};
  const caregivers = advanced.caregivers || [];
  const visits = advanced.visits || [];
  const completions = advanced.tasks?.recent || [];
  const trends = (advanced.trends || []).filter((day) => day.total);

  return `
    <article class="care-report-sheet">
      <header class="care-report-sheet__head">
        <p class="page-kicker">Famielda care report</p>
        <h1>${escapeHtml(name)}</h1>
        <p>${escapeHtml(range.label || "Last 7 days")} · ${escapeHtml(range.startLabel || "")} – ${escapeHtml(range.endLabel || "")}</p>
        <p class="person__meta">Generated ${escapeHtml(report?.generatedLabel || "")}</p>
      </header>
      <section>
        <h2>Care summary <span class="badge ${summary.statusBadge || "badge--success"}">${escapeHtml(summary.statusLabel || "Stable")}</span></h2>
        <p>${escapeHtml(summary.statusSummary || "")}</p>
        <p>${escapeHtml(summary.coverageNote || "")}</p>
        <p>On duty · ${escapeHtml(summary.onDutyName || "Not assigned")} · Tasks done today ${summary.tasksDone || 0} of ${summary.tasksTotal || 0}</p>
      </section>
      <section>
        <h2>This period</h2>
        <p>${totals.visitsCompleted || 0} visits · ${escapeHtml(totals.visitHoursLabel || "0h")} · ${totals.tasksCompleted || 0} tasks done (${escapeHtml(totals.taskRate || "—")}) · ${totals.checkIns || 0} check-ins · ${totals.medicationsTaken || 0} medications taken</p>
      </section>
      <section>
        <h2>Caregiver activity</h2>
        ${caregivers.length ? `
          <table>
            <thead><tr><th>Caregiver</th><th>Visits</th><th>Hours</th><th>Check-ins</th><th>Reports</th><th>Tasks</th></tr></thead>
            <tbody>
              ${caregivers.map((row) => `
                <tr>
                  <td>${escapeHtml(row.name)}</td>
                  <td>${row.visits}</td>
                  <td>${escapeHtml(row.hoursLabel)}</td>
                  <td>${row.checkIns}</td>
                  <td>${row.reports}</td>
                  <td>${row.tasks}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : "<p>No caregiver activity in this range.</p>"}
      </section>
      <section>
        <h2>Task completion</h2>
        ${completions.length ? `
          <ul>
            ${completions.map((item) => `<li>${escapeHtml(item.title)} · ${escapeHtml(item.outcomeLabel)} · ${escapeHtml(item.actor)} · ${escapeHtml(item.when)}</li>`).join("")}
          </ul>
        ` : "<p>No completions in this range.</p>"}
        <p>${advanced.tasks?.overdue || 0} task${advanced.tasks?.overdue === 1 ? "" : "s"} still overdue on the care plan.</p>
      </section>
      <section>
        <h2>Visit history</h2>
        ${visits.length ? `
          <ul>
            ${visits.map((visit) => `<li>${escapeHtml(visit.dateLabel)} · ${escapeHtml(visit.title)} · ${escapeHtml(visit.caregiver)} · ${escapeHtml(visit.hoursLabel)}${visit.moodLabel ? ` · ${escapeHtml(visit.moodLabel)}` : ""}${visit.summary ? ` — ${escapeHtml(visit.summary)}` : ""}</li>`).join("")}
          </ul>
        ` : "<p>No completed visits in this range.</p>"}
      </section>
      <section>
        <h2>Care trends</h2>
        ${trends.length ? `
          <ul>
            ${trends.map((day) => `<li>${escapeHtml(day.label)} · ${day.total} logged (${day.visits} visits, ${day.tasks} tasks, ${day.medications} medications, ${day.checkIns} check-ins)</li>`).join("")}
          </ul>
        ` : "<p>No trend points in this range.</p>"}
      </section>
    </article>
  `;
}

function renderDocuments({ hub, name }) {
  const canManage = Boolean(hub.canManageDocuments);
  const isPlus = Boolean(hub.documentPlus);
  const docs = hub.documents || [];
  const counts = hub.documentCounts || { total: docs.length, needsReview: 0, files: 0 };
  const createAction = canManage
    ? `<div class="hub-head__actions">
        <button class="btn btn--primary" type="button" data-upload-document>Upload document</button>
      </div>`
    : "";

  return `
    ${hubPageHead({
      kicker: "Senior care hub · Plus",
      title: "Documents",
      lead: `A private vault for ${escapeHtml(name)} — directives, insurance, and clinical papers the household may need. Files stay in Firebase Storage and are never published on a public link.`,
      action: createAction,
    })}
    <div class="alert alert--info hub-alert" role="note">
      Opening a file uses your signed-in session. Famielda does not create a shareable public URL for these papers.
    </div>
    ${!isPlus ? `
      <div class="alert alert--warning hub-alert" role="status">
        Document management is a Famielda Plus feature. <a href="settings.html?tab=plans">Upgrade to Plus</a> to upload, preview, and set who on the circle can open each file.
      </div>
      ${plusDocumentsTeaser()}
    ` : `
      <div class="stat-grid hub-stats">
        <article class="stat-card">
          <p class="stat-card__label">On file</p>
          <p class="stat-card__value">${counts.total}</p>
          <p class="stat-card__hint">${counts.files ? `${counts.files} with a file attached` : "Titles the household is tracking"}</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__label">Needs review</p>
          <p class="stat-card__value">${counts.needsReview || 0}</p>
          <p class="stat-card__hint">${counts.needsReview ? "Update or replace the copy" : "Everything current"}</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__label">Insurance</p>
          <p class="stat-card__value">${counts.insurance || 0}</p>
          <p class="stat-card__hint">Cards the circle may need</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__label">Clinical</p>
          <p class="stat-card__value">${counts.clinical || 0}</p>
          <p class="stat-card__hint">Family and practitioners</p>
        </article>
      </div>
      ${docs.length ? documentGroups(docs) : emptyState({
        title: "No documents in the vault yet",
        body: canManage
          ? "Upload a PDF or image, choose a category, and set who on the circle may open it."
          : "When the family adds papers to the vault, the ones you are allowed to open will appear here.",
        compact: true,
      })}
    `}
  `;
}

function plusDocumentsTeaser() {
  return `
    <section class="card reports-plus-teaser">
      <div class="card__header">
        <h2>Private document vault</h2>
        <span class="badge badge--warning">Plus</span>
      </div>
      <p>Plus keeps sensitive papers in Firebase Storage. Only signed-in household members with permission can preview or download — never a public link.</p>
      <ul class="reports-plus-grid">
        ${DOCUMENT_PLUS_FEATURES.map((item) => `
          <li>
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.body)}</span>
          </li>
        `).join("")}
      </ul>
      <div class="hub-head__actions">
        <a class="btn btn--primary" href="settings.html?tab=plans">Upgrade to Plus</a>
      </div>
    </section>
  `;
}

function documentGroups(docs) {
  const groups = DOCUMENT_CATEGORY_OPTIONS
    .map((category) => ({
      ...category,
      items: docs.filter((doc) => doc.category === category.id),
    }))
    .filter((group) => group.items.length);
  const leftover = docs.filter((doc) => !DOCUMENT_CATEGORY_OPTIONS.some((item) => item.id === doc.category));
  if (leftover.length) {
    groups.push({ id: "other", label: "Household", items: leftover });
  }
  return groups.map((group) => `
    <section class="hub-doc-group" aria-labelledby="docs-${escapeHtml(group.id)}">
      <h3 class="hub-subhead" id="docs-${escapeHtml(group.id)}">${escapeHtml(group.label)} (${group.items.length})</h3>
      ${documentList(group.items)}
    </section>
  `).join("");
}

function documentList(items) {
  return `
    <ul class="list">
      ${items.map((doc) => documentItem(doc)).join("")}
    </ul>
  `;
}

function documentItem(doc) {
  const actions = [
    doc.canPreview ? `<button class="btn btn--ghost btn--sm" type="button" data-preview-document="${escapeHtml(doc.id)}">Preview</button>` : "",
    doc.canDownload ? `<button class="btn btn--ghost btn--sm" type="button" data-download-document="${escapeHtml(doc.id)}">Download</button>` : "",
    !doc.hasFile && doc.canEdit ? `<button class="btn btn--ghost btn--sm" type="button" data-preview-document="${escapeHtml(doc.id)}">Open</button>` : "",
    doc.canEdit ? `<button class="btn btn--ghost btn--sm" type="button" data-edit-document="${escapeHtml(doc.id)}">Edit</button>` : "",
    doc.canDelete ? `<button class="btn btn--ghost btn--sm" type="button" data-delete-document="${escapeHtml(doc.id)}">Delete</button>` : "",
  ].filter(Boolean).join("");

  return `
    <li class="list__item hub-task hub-doc">
      <div>
        <div class="hub-task__title">
          <strong>${escapeHtml(doc.title)}</strong>
          <span class="badge ${doc.badge}">${escapeHtml(doc.statusLabel)}</span>
        </div>
        <div class="person__meta">${escapeHtml(doc.categoryLabel)} · ${escapeHtml(doc.visibilityLabel)} · ${escapeHtml(doc.updatedLabel)}</div>
        <div class="person__meta">${[
          doc.fileName || (doc.hasFile ? "File on file" : "No file uploaded yet"),
          doc.sizeLabel,
          doc.uploadedByLabel ? `Added by ${doc.uploadedByLabel}` : "",
        ].filter(Boolean).join(" · ")}</div>
        ${doc.notes ? `<div class="person__meta">${escapeHtml(doc.notes)}</div>` : ""}
      </div>
      <div class="hub-task__aside">
        ${actions ? `<div class="hub-task__actions">${actions}</div>` : ""}
      </div>
    </li>
  `;
}

function renderMessages({ hub, name }) {
  return `
    ${hubPageHead({
      title: "Messages",
      lead: `Family talks privately with the caregiver, nurse, physiotherapist, or MD on ${escapeHtml(name)}’s circle. Unrelated people cannot write here.`,
      action: `<a class="btn btn--ghost" href="messages.html">Open inbox</a>`,
    })}
    ${messagingInboxHtml({
      workspace: hub.messaging,
      thread: hub.messageThread,
      selectedId: hub.messageThread?.conversation?.id || "",
      name,
    })}
  `;
}

function mixedTaskList(items) {
  return `
    <ul class="list">
      ${items.map((task) => task.source === "care" ? careTaskItem(task) : `
        <li class="list__item">
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <div class="person__meta">${escapeHtml(task.meta)}</div>
            ${task.notes ? `<div class="person__meta">${escapeHtml(task.notes)}</div>` : ""}
          </div>
          <span class="badge ${task.badge}">${escapeHtml(task.statusLabel)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function taskList(items, emptyTitle, emptyBody) {
  if (!items.length) {
    return emptyState({ title: emptyTitle, body: emptyBody, compact: true });
  }
  return `
    <ul class="list">
      ${items.map((task) => `
        <li class="list__item">
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <div class="person__meta">${escapeHtml(task.meta)}</div>
            ${task.notes ? `<div class="person__meta">${escapeHtml(task.notes)}</div>` : ""}
          </div>
          <span class="badge ${task.badge}">${escapeHtml(task.statusLabel)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}
