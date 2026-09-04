import { bootApp } from "../core/bootstrap.js";
import { qs, escapeHtml } from "../core/dom.js";
import { on, delegate } from "../core/events.js";
import { initFormUx } from "../core/forms.js";
import { getSession } from "../auth/session.js";
import { VISIT_STATUS } from "../config/constants.js";
import { AVAILABILITY_KIND, PROFESSIONAL_KIND, VISIT_MOODS, bookingNoun, isPractitionerVisit, moodLabel, visitStatusBadge, visitStatusLabel } from "../config/scheduling.js";
import { emptyState } from "../components/empty-state.js";
import { verificationChipHtml } from "../components/verification-banner.js";
import { toast } from "../components/toast.js";
import { setButtonLoading } from "../components/loader.js";
import { bindModal, closeModal, openModal, confirmDialog } from "../components/modal.js";
import { initTabs } from "../components/tabs.js";
import { weekdayLabel } from "../scheduling/calendar.js";
import { formatDateLabel, formatRange, formatTime, todayIso } from "../scheduling/time.js";
import { civilDateInZone, timeZoneAbbr, timeZoneLabel, timeZoneOptions } from "../scheduling/timezone.js";
import { listHouseholdEvents } from "../services/schedule-service.js";
import {
  acceptScheduleVisit,
  addVisitNote,
  cancelScheduleVisit,
  checkInVisit,
  checkOutVisit,
  declineScheduleVisit,
  extendScheduleVisit,
  getScheduleState,
  modifyScheduleVisit,
  previewScheduleConflict,
  requestScheduleVisit,
  saveCaregiverAvailability,
  submitVisitReport,
} from "../services/caregiver-schedule-service.js";
import { focusDeepLink } from "../notifications/deep-link.js";

const session = await bootApp({ page: "schedule" });
const root = qs("[data-schedule-page]");
const requestForm = qs("[data-request-form]");
const availabilityForm = qs("[data-availability-form]");
const declineForm = qs("[data-decline-form]");
const checkoutForm = qs("[data-checkout-form]");
const noteForm = qs("[data-note-form]");
const reportForm = qs("[data-report-form]");
const modifyForm = qs("[data-modify-form]");
const extendForm = qs("[data-extend-form]");

let state = await getScheduleState(session);
let household = await listHouseholdEvents();
let filter = "week";

["request", "availability", "decline", "checkout", "note", "report", "modify", "extend"].forEach(bindModal);
bindPage();
render();

function bindPage() {
  delegate(root, "click", "[data-open-request]", (_event, button) => {
    openRequest({
      kind: button.dataset.requestKind,
      memberId: button.dataset.requestMember,
    });
  });
  delegate(root, "click", "[data-open-availability]", () => openAvailability());
  delegate(root, "click", "[data-accept-visit]", async (_event, button) => {
    const visit = findVisit(button.dataset.acceptVisit);
    const noun = bookingNoun(visit?.professionalKind);
    await runAction(button, () => acceptScheduleVisit(button.dataset.acceptVisit), `${noun[0].toUpperCase()}${noun.slice(1)} accepted.`);
  });
  delegate(root, "click", "[data-decline-visit]", (_event, button) => openDecline(button.dataset.declineVisit));
  delegate(root, "click", "[data-cancel-visit]", async (_event, button) => {
    const visit = findVisit(button.dataset.cancelVisit);
    const noun = bookingNoun(visit?.professionalKind);
    const confirmed = await confirmDialog({
      title: `Cancel this ${noun}?`,
      body: visit ? `${visit.title} on ${formatDateLabel(visit.date)} will be released.` : "This time will be released.",
      confirmLabel: `Cancel ${noun}`,
      danger: true,
    });
    if (!confirmed) return;
    await runAction(button, () => cancelScheduleVisit(visit.id), `${noun[0].toUpperCase()}${noun.slice(1)} cancelled.`);
  });
  delegate(root, "click", "[data-checkin-visit]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Check in now?",
      body: "The family will see that you have arrived.",
      confirmLabel: "Check in",
    });
    if (!confirmed) return;
    await runAction(button, () => checkInVisit(button.dataset.checkinVisit), "Checked in.");
  });
  delegate(root, "click", "[data-checkout-visit]", (_event, button) => openCheckout(button.dataset.checkoutVisit));
  delegate(root, "click", "[data-note-visit]", (_event, button) => openNote(button.dataset.noteVisit));
  delegate(root, "click", "[data-report-visit]", (_event, button) => openReport(button.dataset.reportVisit));
  delegate(root, "click", "[data-modify-visit]", (_event, button) => openModify(button.dataset.modifyVisit));
  delegate(root, "click", "[data-extend-visit]", (_event, button) => openExtend(button.dataset.extendVisit));

  on(root, "tabchange", (event) => {
    filter = event.detail.id;
    renderPanels();
  });

  on(requestForm, "submit", async (event) => {
    event.preventDefault();
    const submit = requestForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await requestScheduleVisit(requestPayload());
      closeModal("request");
      toast(isAppointmentRequest() ? "Appointment requested." : "Visit requested.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(requestForm, "change", () => previewRequest());
  on(requestForm, "input", () => previewRequest());

  on(availabilityForm, "submit", async (event) => {
    event.preventDefault();
    const submit = availabilityForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await saveCaregiverAvailability(availabilityPayload());
      closeModal("availability");
      toast("Availability saved.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(declineForm, "submit", async (event) => {
    event.preventDefault();
    const submit = declineForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await declineScheduleVisit(declineForm.visitId.value, declineForm.reason.value);
      closeModal("decline");
      const visit = findVisit(declineForm.visitId.value);
      toast(isPractitionerVisit(visit) ? "Appointment declined." : "Visit declined.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(checkoutForm, "submit", async (event) => {
    event.preventDefault();
    const submit = checkoutForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await checkOutVisit(checkoutForm.visitId.value, checkoutForm.note.value);
      closeModal("checkout");
      toast("Checked out.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(noteForm, "submit", async (event) => {
    event.preventDefault();
    const submit = noteForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await addVisitNote(noteForm.visitId.value, noteForm.body.value);
      closeModal("note");
      toast("Note saved.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(reportForm, "submit", async (event) => {
    event.preventDefault();
    const submit = reportForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await submitVisitReport(reportForm.visitId.value, {
        summary: reportForm.summary.value,
        mood: reportForm.mood.value,
        meals: reportForm.meals.value,
        mobility: reportForm.mobility.value,
        concerns: reportForm.concerns.value,
        followUp: reportForm.followUp.value,
      });
      closeModal("report");
      toast("Visit report saved.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(modifyForm, "submit", async (event) => {
    event.preventDefault();
    const submit = modifyForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await modifyScheduleVisit(modifyForm.visitId.value, {
        title: modifyForm.title.value,
        date: modifyForm.date.value,
        startTime: modifyForm.startTime.value,
        endTime: modifyForm.endTime.value,
      });
      closeModal("modify");
      toast(isPractitionerVisit(findVisit(modifyForm.visitId.value)) ? "Appointment updated." : "Visit updated.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
  });

  on(modifyForm, "change", () => previewModify());
  on(modifyForm, "input", () => previewModify());

  on(extendForm, "submit", async (event) => {
    event.preventDefault();
    const submit = extendForm.querySelector("[type='submit']");
    setButtonLoading(submit, true);
    try {
      await extendScheduleVisit(extendForm.visitId.value, Number(extendForm.minutes.value));
      closeModal("extend");
      toast(isPractitionerVisit(findVisit(extendForm.visitId.value)) ? "Appointment extended." : "Visit extended.", { type: "success" });
      await reload();
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(submit, false);
    }
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
  state = await getScheduleState(getSession() ?? session);
  household = await listHouseholdEvents();
  render();
}

function handleError(error) {
  toast(error.message || "Something went wrong.", { type: "error" });
}

function findVisit(id) {
  return state.visits.find((item) => item.id === id) ?? null;
}

function render() {
  root.innerHTML = `
    ${headerHtml()}
    ${statsHtml()}
    ${bodyHtml()}
  `;
  initFormUx(root);
  initTabs(root);
  const tabs = qs("[data-tabs]", root);
  if (tabs) {
    tabs.querySelectorAll("[data-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === filter);
      button.setAttribute("aria-selected", String(button.dataset.tab === filter));
    });
  }
  renderPanels();
  window.requestAnimationFrame(() => focusDeepLink(root));
}

function headerHtml() {
  const lead = state.isPractitioner
    ? "Your appointments across households. Accept, decline, and keep families from overlapping."
    : (state.isCaregiver
      ? "Your visits across households. Accept, check in, and keep families from overlapping."
      : (state.senior
        ? `Request coverage for ${escapeHtml(state.senior.preferredName || state.senior.displayName)}. A caregiver or clinician cannot be booked with two families at the same time.`
        : "Create a senior profile, then request caregiver visits and clinical appointments here."));
  const kicker = state.isPractitioner
    ? "Practitioner scheduling"
    : (state.isCaregiver ? "Caregiver scheduling" : "Household week");
  const requestLabel = !state.caregivers.length && state.practitioners.length
    ? "Request an appointment"
    : (state.caregivers.length && state.practitioners.length ? "Request a time" : "Request a visit");

  return `
    <div class="welcome">
      <div>
        <p class="page-kicker">${kicker}</p>
        <h2>Schedule</h2>
        <p class="page-lead">${lead}</p>
      </div>
      <div class="schedule-actions">
        ${state.canSetAvailability ? `<button class="btn btn--ghost" type="button" data-open-availability>Set availability</button>` : ""}
        ${state.canManage ? `<button class="btn btn--primary" type="button" data-open-request>${requestLabel}</button>` : ""}
      </div>
    </div>
  `;
}

function statsHtml() {
  return `
    <div class="circle-stats schedule-stats">
      ${stat("Pending", state.stats.pending)}
      ${stat("Today", state.stats.today)}
      ${stat("Upcoming", state.stats.upcoming)}
      ${stat("Reports", state.stats.reports)}
    </div>
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

function bodyHtml() {
  return `
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist">
        <button class="tabs__tab" type="button" data-tab="week">Week</button>
        <button class="tabs__tab" type="button" data-tab="requests">Requests</button>
        <button class="tabs__tab" type="button" data-tab="visits">Visits</button>
        <button class="tabs__tab" type="button" data-tab="availability">Availability</button>
      </div>
    </div>
    <div data-schedule-panels></div>
  `;
}

function renderPanels() {
  const host = qs("[data-schedule-panels]", root);
  if (!host) return;
  if (filter === "requests") host.innerHTML = requestsHtml();
  else if (filter === "visits") host.innerHTML = visitsHtml();
  else if (filter === "availability") host.innerHTML = availabilityHtml();
  else host.innerHTML = weekHtml();
}

function weekHtml() {
  const hasItems = state.week.some((day) => dayEvents(day).length);
  if (!hasItems) {
    return emptyState({
      title: "No visits this week",
      body: state.canManage
        ? "Request a caregiver visit or clinical appointment. Medications and family time will sit on the same week."
        : (state.isPractitioner
          ? "Accepted appointments across households will appear here."
          : "Accepted visits and the household week will appear here."),
    });
  }

  return `
    <div class="week-grid">
      ${state.week.map((day) => {
        const items = dayEvents(day);
        const today = day.date === todayIso();
        return `
          <section class="day-col${today ? " day-col--today" : ""}">
            <h3>${escapeHtml(day.label)} <span>${escapeHtml(formatDateLabel(day.date, { weekday: false }))}</span></h3>
            ${items.length ? items.map(weekChip).join("") : `<p class="person__meta">No visits</p>`}
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function dayEvents(day) {
  const visits = state.visits.filter((visit) => (
    visit.date === day.date
    && visit.status !== VISIT_STATUS.DECLINED
    && visit.status !== VISIT_STATUS.CANCELLED
  ));
  const events = household
    .filter((event) => event.weekday === day.weekday)
    .map((event) => ({ kind: "event", event }));
  return [
    ...visits.map((visit) => ({ kind: "visit", visit })),
    ...events,
  ].sort((a, b) => {
    const aTime = a.visit?.startTime || a.event?.time || "";
    const bTime = b.visit?.startTime || b.event?.time || "";
    return String(aTime).localeCompare(String(bTime));
  });
}

function weekChip(item) {
  if (item.kind === "visit") {
    const visit = item.visit;
    return `
      <article class="event-chip event-chip--${escapeHtml(visit.status)}${isPractitionerVisit(visit) ? " event-chip--clay" : ""}">
        <strong>${escapeHtml(formatRange(visit.startTime, visit.endTime))}</strong>
        <div>${escapeHtml(visit.title)}</div>
        <div class="person__meta">${escapeHtml(visit.caregiverName)}${state.isProfessional ? ` · ${escapeHtml(visit.seniorName)}` : ""}</div>
        <span class="badge ${visitStatusBadge(visit.status)}">${escapeHtml(visitStatusLabel(visit.status))}</span>
      </article>
    `;
  }
  const event = item.event;
  return `
    <article class="event-chip${event.type === "appointment" ? " event-chip--clay" : ""}">
      <strong>${escapeHtml(formatTime(event.time) || event.time)}</strong>
      <div>${escapeHtml(event.title)}</div>
      <div class="person__meta">${escapeHtml(event.assignee)}</div>
    </article>
  `;
}

function requestsHtml() {
  if (!state.pending.length) {
    return emptyState({
      title: "No pending requests",
      body: state.isProfessional
        ? "When a family asks for a time, you can accept or decline here. Overlapping households are blocked."
        : "Sent requests wait here until the caregiver or clinician accepts.",
    });
  }

  return `<div class="visit-list">${state.pending.map(visitCard).join("")}</div>`;
}

function visitsHtml() {
  const items = state.visits.filter((item) => item.status !== VISIT_STATUS.DECLINED);
  if (!items.length) {
    return emptyState({
      title: "No visits yet",
      body: "Accepted visits, check-ins, notes, and reports will land here.",
    });
  }
  return `<div class="visit-list">${items.map(visitCard).join("")}</div>`;
}

function availabilityHtml() {
  if (state.isProfessional) {
    const weekly = state.availability.filter((item) => item.kind === AVAILABILITY_KIND.WEEKLY && item.active);
    const blocks = state.availability.filter((item) => item.kind === AVAILABILITY_KIND.BLOCK);
    const emptyHours = state.isPractitioner
      ? "Set the days you can take appointments so families request inside your window."
      : "Set the days you can take visits so families request inside your window.";
    return `
      <div class="availability-board">
        <section class="card">
          <div class="card__header">
            <h2>Weekly hours</h2>
            <button class="btn btn--ghost btn--sm" type="button" data-open-availability>Edit</button>
          </div>
          ${state.timeZone ? `<p class="person__meta">Times are in ${escapeHtml(timeZoneLabel(state.timeZone))} (${escapeHtml(timeZoneAbbr(state.timeZone))}).</p>` : ""}
          ${weekly.length ? `
            <ul class="list">
              ${[0, 1, 2, 3, 4, 5, 6].map((weekday) => {
                const window = weekly.find((item) => item.weekday === weekday);
                return `
                  <li class="list__item">
                    <strong>${escapeHtml(weekdayLabel(weekday, { long: true }))}</strong>
                    <span class="person__meta">${window ? escapeHtml(formatRange(window.startTime, window.endTime)) : "Unavailable"}</span>
                  </li>
                `;
              }).join("")}
            </ul>
          ` : emptyState({
            title: "No hours set",
            body: emptyHours,
            compact: true,
          })}
        </section>
        <section class="card">
          <div class="card__header">
            <h2>Time off</h2>
          </div>
          ${blocks.length ? `
            <ul class="list">
              ${blocks.map((item) => `
                <li class="list__item">
                  <div>
                    <strong>${escapeHtml(formatDateLabel(item.date))}</strong>
                    <div class="person__meta">${escapeHtml(formatRange(item.startTime, item.endTime))}</div>
                  </div>
                </li>
              `).join("")}
            </ul>
          ` : emptyState({ title: "No time off logged", body: "Block a date from the availability editor.", compact: true })}
        </section>
      </div>
    `;
  }

  if (!state.professionals.length) {
    return emptyState({
      title: "No caregiver or clinician on the circle",
      body: "Invite a caregiver or health practitioner, then you can see when they are free and request a time.",
      actionLabel: "Open care circle",
      actionHref: "care-circle.html",
    });
  }

  return `
    <div class="availability-board">
      ${state.professionals.map((member) => {
        const weekly = state.availability.filter((item) => (
          item.kind === AVAILABILITY_KIND.WEEKLY
          && item.active
          && (item.caregiverUserId === member.userId || String(item.caregiverEmail).toLowerCase() === String(member.email).toLowerCase())
        ));
        const requestLabel = member.kind === PROFESSIONAL_KIND.PRACTITIONER ? "Request appointment" : "Request visit";
        return `
          <section class="card">
            <div class="card__header">
              <h2>${escapeHtml(member.name)}</h2>
              ${state.canManage ? `<button class="btn btn--ghost btn--sm" type="button" data-open-request data-request-kind="${escapeHtml(member.kind)}" data-request-member="${escapeHtml(member.id)}">${requestLabel}</button>` : ""}
            </div>
            <p class="person__meta">${member.kind === PROFESSIONAL_KIND.PRACTITIONER ? "Health practitioner" : "Caregiver"}${member.timeZone ? ` · ${escapeHtml(timeZoneLabel(member.timeZone))}` : ""} ${verificationChipHtml(member.verificationStatus)}</p>
            ${weekly.length ? `
              <ul class="list">
                ${weekly.sort((a, b) => a.weekday - b.weekday).map((item) => `
                  <li class="list__item">
                    <strong>${escapeHtml(weekdayLabel(item.weekday, { long: true }))}</strong>
                    <span class="person__meta">${escapeHtml(formatRange(item.startTime, item.endTime))}</span>
                  </li>
                `).join("")}
              </ul>
            ` : `<p class="person__meta">No weekly hours published yet.</p>`}
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function visitCard(visit) {
  const household = state.isProfessional ? visit.seniorName : visit.caregiverName;
  const kindLabel = isPractitionerVisit(visit) ? "Appointment" : "Care visit";
  return `
    <article class="card visit-card" data-visit-id="${escapeHtml(visit.id)}" id="visit-${escapeHtml(visit.id)}">
      <div class="visit-card__top">
        <div>
          <p class="page-kicker">${escapeHtml(formatDateLabel(visit.date))} · ${escapeHtml(formatRange(visit.startTime, visit.endTime))}${visit.timeZone ? ` ${escapeHtml(timeZoneAbbr(visit.timeZone, visit.startsAt))}` : ""}</p>
          <h3>${escapeHtml(visit.title)}</h3>
          <p class="person__meta">${escapeHtml(household)} · ${kindLabel}${visit.extensionMinutes ? ` · extended ${visit.extensionMinutes} min` : ""}</p>
        </div>
        <span class="badge ${visitStatusBadge(visit.status)}">${escapeHtml(visitStatusLabel(visit.status))}</span>
      </div>
      ${visit.notes.length ? `
        <div class="visit-notes">
          ${visit.notes.map((note) => `
            <p><strong>${escapeHtml(note.author)}:</strong> ${escapeHtml(note.body)}</p>
          `).join("")}
        </div>
      ` : ""}
      ${visit.report ? `
        <div class="visit-report">
          <p class="page-kicker">Visit report · ${escapeHtml(moodLabel(visit.report.mood))}</p>
          <p>${escapeHtml(visit.report.summary)}</p>
          ${visit.report.followUp ? `<p class="person__meta">Follow-up: ${escapeHtml(visit.report.followUp)}</p>` : ""}
        </div>
      ` : ""}
      ${visit.declineReason ? `<p class="person__meta">Declined: ${escapeHtml(visit.declineReason)}</p>` : ""}
      <div class="visit-card__actions">${visitActions(visit)}</div>
    </article>
  `;
}

function visitActions(visit) {
  const buttons = [];
  const clinical = isPractitionerVisit(visit);
  const canEditSlot = state.canManage || (state.isPractitioner && clinical);
  if (state.isProfessional && visit.status === VISIT_STATUS.REQUESTED) {
    buttons.push(`<button class="btn btn--primary btn--sm" type="button" data-accept-visit="${escapeHtml(visit.id)}">Accept</button>`);
    buttons.push(`<button class="btn btn--ghost btn--sm" type="button" data-decline-visit="${escapeHtml(visit.id)}">Decline</button>`);
  }
  if (state.isCaregiver && !clinical && visit.status === VISIT_STATUS.ACCEPTED && visit.date === civilDateInZone(Date.now(), visit.timeZone || state.timeZone)) {
    buttons.push(`<button class="btn btn--primary btn--sm" type="button" data-checkin-visit="${escapeHtml(visit.id)}">Check in</button>`);
  }
  if (state.isCaregiver && !clinical && visit.status === VISIT_STATUS.CHECKED_IN) {
    buttons.push(`<button class="btn btn--primary btn--sm" type="button" data-checkout-visit="${escapeHtml(visit.id)}">Check out</button>`);
  }
  if ((state.isCaregiver || state.canManage) && !clinical && [VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN, VISIT_STATUS.CHECKED_OUT].includes(visit.status)) {
    buttons.push(`<button class="btn btn--ghost btn--sm" type="button" data-note-visit="${escapeHtml(visit.id)}">Add note</button>`);
  }
  if (state.isCaregiver && !clinical && [VISIT_STATUS.CHECKED_IN, VISIT_STATUS.CHECKED_OUT].includes(visit.status)) {
    buttons.push(`<button class="btn btn--ghost btn--sm" type="button" data-report-visit="${escapeHtml(visit.id)}">${visit.report ? "Update report" : "Visit report"}</button>`);
  }
  if (canEditSlot && [VISIT_STATUS.REQUESTED, VISIT_STATUS.ACCEPTED].includes(visit.status)) {
    buttons.push(`<button class="btn btn--ghost btn--sm" type="button" data-modify-visit="${escapeHtml(visit.id)}">Modify</button>`);
    buttons.push(`<button class="btn btn--ghost btn--sm" type="button" data-cancel-visit="${escapeHtml(visit.id)}">Cancel</button>`);
  }
  if ((state.isProfessional || state.canManage) && [VISIT_STATUS.ACCEPTED, VISIT_STATUS.CHECKED_IN].includes(visit.status)) {
    buttons.push(`<button class="btn btn--ghost btn--sm" type="button" data-extend-visit="${escapeHtml(visit.id)}">Extend</button>`);
  }
  return buttons.join("");
}

function openRequest(options = {}) {
  if (!state.professionals.length) {
    toast("Invite a caregiver or clinician before requesting a time.", { type: "warning" });
    return;
  }
  requestForm.reset();
  const preferredKind = options.kind || "";
  const groups = [
    { kind: PROFESSIONAL_KIND.CAREGIVER, label: "Caregivers", members: state.caregivers },
    { kind: PROFESSIONAL_KIND.PRACTITIONER, label: "Health practitioners", members: state.practitioners },
  ].filter((group) => group.members.length);
  requestForm.professionalId.innerHTML = groups.map((group) => `
    <optgroup label="${escapeHtml(group.label)}">
      ${group.members.map((member) => (
        `<option value="${escapeHtml(member.id)}" ${member.id === options.memberId ? "selected" : ""}>${escapeHtml(member.name)}</option>`
      )).join("")}
    </optgroup>
  `).join("");
  if (options.memberId) requestForm.professionalId.value = options.memberId;
  else if (preferredKind) {
    const first = (preferredKind === PROFESSIONAL_KIND.PRACTITIONER ? state.practitioners : state.caregivers)[0];
    if (first) requestForm.professionalId.value = first.id;
  }
  const clinical = isAppointmentRequest();
  requestForm.date.value = todayIso();
  requestForm.startTime.value = clinical ? "10:00" : "09:00";
  requestForm.endTime.value = clinical ? "10:45" : "11:00";
  requestForm.title.value = clinical ? "Appointment" : "Care visit";
  qs("[data-request-conflict]").hidden = true;
  updateRequestCopy();
  updateRequestAvailability();
  openModal("request");
}

function professionalFromForm() {
  return state.professionals.find((member) => member.id === requestForm.professionalId.value) ?? null;
}

function isAppointmentRequest() {
  return professionalFromForm()?.kind === PROFESSIONAL_KIND.PRACTITIONER;
}

function updateRequestCopy() {
  const clinical = isAppointmentRequest();
  const title = qs("#request-title");
  const lead = qs("[data-request-lead]");
  if (title) title.textContent = clinical ? "Request an appointment" : "Request a visit";
  if (lead) {
    lead.textContent = clinical
      ? "The clinician accepts before the time is held. Overlapping appointments with another family are blocked."
      : "The caregiver accepts before the time is held. Overlapping visits with another family are blocked.";
  }
  const titleField = requestForm.title;
  if (titleField && ["Care visit", "Appointment", ""].includes(titleField.value.trim())) {
    titleField.value = clinical ? "Appointment" : "Care visit";
    titleField.placeholder = clinical ? "Follow-up visit" : "Afternoon coverage";
  }
  const titleLabel = qs("[data-request-title-label]");
  if (titleLabel) titleLabel.textContent = clinical ? "Appointment" : "Visit";
}

function updateRequestAvailability() {
  const professional = professionalFromForm();
  const host = qs("[data-request-availability]");
  const zoneHost = qs("[data-request-timezone]");
  if (!professional) {
    host.textContent = "";
    if (zoneHost) zoneHost.textContent = "";
    return;
  }
  const weekly = state.availability.filter((item) => (
    item.kind === AVAILABILITY_KIND.WEEKLY
    && item.active
    && (item.caregiverUserId === professional.userId || String(item.caregiverEmail).toLowerCase() === String(professional.email).toLowerCase())
  ));
  const zone = professional.timeZone || weekly.find((item) => item.timeZone)?.timeZone || state.timeZone;
  host.textContent = weekly.length
    ? `${professional.name} is usually free ${weekly.map((item) => `${weekdayLabel(item.weekday)} ${formatRange(item.startTime, item.endTime)}`).join(" · ")}.`
    : `${professional.name} has not published weekly hours yet.`;
  if (zoneHost) {
    zoneHost.textContent = zone
      ? `Times are in ${professional.name}’s ${timeZoneLabel(zone)} (${timeZoneAbbr(zone)}). Simultaneous bookings with another family are blocked.`
      : "Simultaneous bookings with another family are blocked.";
  }
}

async function previewRequest() {
  updateRequestCopy();
  updateRequestAvailability();
  const box = qs("[data-request-conflict]");
  const professional = professionalFromForm();
  if (!professional || !requestForm.date.value || !requestForm.startTime.value || !requestForm.endTime.value) {
    box.hidden = true;
    return;
  }
  const preview = await previewScheduleConflict({
    caregiverUserId: professional.userId,
    caregiverEmail: professional.email,
    caregiverName: professional.name,
    professionalKind: professional.kind,
    date: requestForm.date.value,
    startTime: requestForm.startTime.value,
    endTime: requestForm.endTime.value,
    timeZone: professional.timeZone,
  });
  box.hidden = preview.ok;
  box.textContent = preview.message;
}

function requestPayload() {
  const professional = professionalFromForm();
  return {
    caregiverId: professional?.id || requestForm.professionalId.value,
    professionalKind: professional?.kind || PROFESSIONAL_KIND.CAREGIVER,
    title: requestForm.title.value.trim(),
    date: requestForm.date.value,
    startTime: requestForm.startTime.value,
    endTime: requestForm.endTime.value,
  };
}

function openAvailability() {
  const weekly = state.availability.filter((item) => item.kind === AVAILABILITY_KIND.WEEKLY);
  const lead = qs("[data-availability-lead]");
  if (lead) {
    lead.textContent = state.isPractitioner
      ? "Families can only request appointments inside these hours. Time off blocks a date even if the weekday is open. Hours are stored in your time zone."
      : "Families can only request visits inside these hours. Time off blocks a date even if the weekday is open. Hours are stored in your time zone.";
  }
  const zone = weekly.find((item) => item.timeZone)?.timeZone || state.timeZone;
  availabilityForm.timeZone.innerHTML = timeZoneOptions(zone).map((item) => (
    `<option value="${escapeHtml(item.id)}" ${item.id === zone ? "selected" : ""}>${escapeHtml(item.label)}</option>`
  )).join("");
  availabilityForm.timeZone.value = zone;
  qs("[data-availability-days]").innerHTML = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const window = weekly.find((item) => item.weekday === weekday);
    return `
      <label class="availability-day">
        <input type="checkbox" name="day-${weekday}" ${window ? "checked" : ""}>
        <span>${escapeHtml(weekdayLabel(weekday, { long: true }))}</span>
        <input type="hidden" name="id-${weekday}" value="${escapeHtml(window?.id || "")}">
        <input type="time" name="start-${weekday}" value="${escapeHtml(window?.startTime || "09:00")}">
        <input type="time" name="end-${weekday}" value="${escapeHtml(window?.endTime || "17:00")}">
      </label>
    `;
  }).join("");
  availabilityForm.blockDate.value = "";
  availabilityForm.blockStart.value = "";
  availabilityForm.blockEnd.value = "";
  openModal("availability");
}

function availabilityPayload() {
  const weekly = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: availabilityForm[`id-${weekday}`]?.value || "",
    weekday,
    enabled: Boolean(availabilityForm[`day-${weekday}`]?.checked),
    startTime: availabilityForm[`start-${weekday}`]?.value,
    endTime: availabilityForm[`end-${weekday}`]?.value,
  }));
  const block = availabilityForm.blockDate.value && availabilityForm.blockStart.value && availabilityForm.blockEnd.value
    ? {
      date: availabilityForm.blockDate.value,
      startTime: availabilityForm.blockStart.value,
      endTime: availabilityForm.blockEnd.value,
    }
    : null;
  return { weekly, block, timeZone: availabilityForm.timeZone.value };
}

function openDecline(id) {
  const visit = findVisit(id);
  if (!visit) return;
  declineForm.reset();
  declineForm.visitId.value = visit.id;
  qs("[data-decline-lead]").textContent = `${visit.title} for ${visit.seniorName} on ${formatDateLabel(visit.date)}.`;
  qs("#decline-title").textContent = isPractitionerVisit(visit) ? "Decline this appointment?" : "Decline this visit?";
  const submit = declineForm.querySelector("[type='submit']");
  if (submit) submit.textContent = isPractitionerVisit(visit) ? "Decline appointment" : "Decline visit";
  openModal("decline");
}

function openCheckout(id) {
  checkoutForm.reset();
  checkoutForm.visitId.value = id;
  openModal("checkout");
}

function openNote(id) {
  noteForm.reset();
  noteForm.visitId.value = id;
  openModal("note");
}

function openReport(id) {
  const visit = findVisit(id);
  reportForm.reset();
  reportForm.visitId.value = id;
  reportForm.mood.innerHTML = VISIT_MOODS.map((item) => (
    `<option value="${item.id}">${escapeHtml(item.label)}</option>`
  )).join("");
  if (visit?.report) {
    reportForm.summary.value = visit.report.summary;
    reportForm.mood.value = visit.report.mood;
    reportForm.meals.value = visit.report.meals;
    reportForm.mobility.value = visit.report.mobility;
    reportForm.concerns.value = visit.report.concerns;
    reportForm.followUp.value = visit.report.followUp;
  }
  openModal("report");
}

function openModify(id) {
  const visit = findVisit(id);
  if (!visit) return;
  modifyForm.visitId.value = visit.id;
  modifyForm.title.value = visit.title;
  modifyForm.date.value = visit.date;
  modifyForm.startTime.value = visit.startTime;
  modifyForm.endTime.value = visit.endTime;
  qs("[data-modify-conflict]").hidden = true;
  openModal("modify");
}

async function previewModify() {
  const visit = findVisit(modifyForm.visitId.value);
  const box = qs("[data-modify-conflict]");
  if (!visit) return;
  const preview = await previewScheduleConflict({
    visitId: visit.id,
    caregiverUserId: visit.caregiverUserId,
    caregiverEmail: visit.caregiverEmail,
    caregiverName: visit.caregiverName,
    professionalKind: visit.professionalKind,
    date: modifyForm.date.value,
    startTime: modifyForm.startTime.value,
    endTime: modifyForm.endTime.value,
    timeZone: visit.timeZone,
  });
  box.hidden = preview.ok;
  box.textContent = preview.message;
}

function openExtend(id) {
  const visit = findVisit(id);
  extendForm.reset();
  extendForm.visitId.value = id;
  qs("[data-extend-lead]").textContent = visit
    ? `${visit.title} currently ends at ${formatRange(visit.startTime, visit.endTime).split("–")[1]?.trim() || visit.endTime}.`
    : "Extra time is blocked if it would overlap another family.";
  openModal("extend");
}
