import {
  ACTIVITY_TYPES,
  APPOINTMENT_STATUS,
  CARE_HISTORY_KINDS,
  CARE_TASK_STATUS,
  CIRCLE_STATUS,
  MEDICATION_DOSE_OUTCOME,
} from "../config/constants.js";
import {
  activityTypeFromKind,
  canAddCareHistoryNote,
  careHistoryHref,
  careHistoryKindBadge,
  careHistoryKindLabel,
  defaultHistoryTitle,
  filterHistoryEvents,
  formatHistoryTime,
  groupHistoryByDay,
  historyCounts,
  historyDayKey,
  historyDayLabel,
} from "../config/care-history.js";
import { doseOutcomeLabel } from "../config/medication.js";
import { activitySourceKey, createActivity } from "../models/activity.js";
import { listActivities, postActivity } from "./activity-service.js";
import { listVisits } from "./caregiver-schedule-service.js";
import { listCarePlanCompletions, listCarePlanTasks } from "./care-plan-service.js";
import { listAppointments } from "./appointment-service.js";
import { listMedicationDoses } from "./medication-service.js";
import { listCareCircle } from "./care-circle-service.js";
import { getSeniorById } from "./senior-service.js";
import { getSession } from "../auth/session.js";
import { assertCanUseCareHistory, canUseCareHistory, householdContext } from "./entitlement-service.js";
import { formatWhen } from "../scheduling/time.js";
import { QUERY_LIMITS } from "../config/performance.js";

function findActor(members, session, senior) {
  if (!session) return null;
  return members.find((member) => (
    member.status !== CIRCLE_STATUS.REMOVED
    && (member.userId === session.id || String(member.email || "").toLowerCase() === String(session.email || "").toLowerCase())
  )) ?? (senior?.ownerId === session.id
    ? members.find((member) => member.role === "owner")
    : null);
}

function mapEvent(item, now = new Date()) {
  const occurredAt = item.occurredAt || item.createdAt;
  const kind = item.kind || CARE_HISTORY_KINDS.CARE;
  return {
    ...item,
    kind,
    kindLabel: careHistoryKindLabel(kind),
    badge: careHistoryKindBadge(kind),
    typeLabel: careHistoryKindLabel(kind),
    time: formatHistoryTime(occurredAt),
    when: formatWhen(occurredAt, now),
    dayKey: historyDayKey(occurredAt, now),
    dayLabel: historyDayLabel(occurredAt, now),
    href: item.href || careHistoryHref(kind),
    sourceKey: activitySourceKey(item.source, item.sourceId) || item.id,
  };
}

function eventFrom({
  id,
  seniorId,
  kind,
  title,
  body,
  actor,
  actorId,
  occurredAt,
  source,
  sourceId,
  relatedId,
  href,
}) {
  return createActivity({
    id,
    seniorId,
    kind,
    type: activityTypeFromKind(kind),
    title: title || defaultHistoryTitle(kind),
    body: body || "",
    actor: actor || "",
    actorId: actorId || "",
    occurredAt,
    createdAt: occurredAt,
    source,
    sourceId,
    relatedId: relatedId || "",
    href: href || careHistoryHref(kind),
  });
}

function eventsFromVisit(visit) {
  const events = [];
  const caregiver = visit.caregiverName || "Caregiver";
  const visitTitle = visit.title || "Care visit";
  if (visit.checkedInAt) {
    events.push(eventFrom({
      id: `hist-visit-${visit.id}-in`,
      seniorId: visit.seniorId,
      kind: CARE_HISTORY_KINDS.CHECK_IN,
      title: defaultHistoryTitle(CARE_HISTORY_KINDS.CHECK_IN),
      body: `${caregiver} arrived for ${visitTitle}.`,
      actor: caregiver,
      actorId: visit.caregiverUserId || "",
      occurredAt: visit.checkedInAt,
      source: "visit",
      sourceId: `${visit.id}:check_in`,
      relatedId: visit.id,
    }));
  }
  if (visit.checkedOutAt) {
    events.push(eventFrom({
      id: `hist-visit-${visit.id}-out`,
      seniorId: visit.seniorId,
      kind: CARE_HISTORY_KINDS.CHECK_OUT,
      title: defaultHistoryTitle(CARE_HISTORY_KINDS.CHECK_OUT),
      body: `${caregiver} finished ${visitTitle}.`,
      actor: caregiver,
      actorId: visit.caregiverUserId || "",
      occurredAt: visit.checkedOutAt,
      source: "visit",
      sourceId: `${visit.id}:check_out`,
      relatedId: visit.id,
    }));
  }
  for (const note of visit.notes || []) {
    if (!note?.createdAt) continue;
    events.push(eventFrom({
      id: `hist-visit-${visit.id}-note-${note.id}`,
      seniorId: visit.seniorId,
      kind: CARE_HISTORY_KINDS.VISIT_NOTE,
      title: defaultHistoryTitle(CARE_HISTORY_KINDS.VISIT_NOTE),
      body: note.body || "",
      actor: note.author || caregiver,
      actorId: note.authorId || "",
      occurredAt: note.createdAt,
      source: "visit",
      sourceId: `${visit.id}:note:${note.id}`,
      relatedId: visit.id,
    }));
  }
  if (visit.report?.submittedAt) {
    const report = visit.report;
    const parts = [report.summary, report.mood && `Mood · ${report.mood}`, report.followUp]
      .filter(Boolean);
    events.push(eventFrom({
      id: `hist-visit-${visit.id}-report`,
      seniorId: visit.seniorId,
      kind: CARE_HISTORY_KINDS.VISIT_REPORT,
      title: defaultHistoryTitle(CARE_HISTORY_KINDS.VISIT_REPORT),
      body: parts.join(" · "),
      actor: report.submittedBy || caregiver,
      actorId: report.submittedById || "",
      occurredAt: report.submittedAt,
      source: "visit",
      sourceId: `${visit.id}:report`,
      relatedId: visit.id,
    }));
  }
  return events;
}

function eventsFromCompletion(completion, tasks = []) {
  const task = tasks.find((item) => item.id === completion.taskId);
  const skipped = completion.outcome === CARE_TASK_STATUS.SKIPPED;
  const title = skipped
    ? `${task?.title || "Care task"} skipped`
    : `${task?.title || "Care task"} completed`;
  return [eventFrom({
    id: `hist-done-${completion.id}`,
    seniorId: completion.seniorId,
    kind: CARE_HISTORY_KINDS.TASK,
    title,
    body: completion.notes || `${completion.completedByName || "Someone"} logged this on the care plan.`,
    actor: completion.completedByName || "",
    actorId: completion.completedBy || "",
    occurredAt: completion.completedAt,
    source: "completion",
    sourceId: completion.id,
    relatedId: completion.taskId,
  })];
}

function eventsFromDose(dose) {
  const outcome = doseOutcomeLabel(dose.outcome).toLowerCase();
  const name = [dose.name, dose.dosage].filter(Boolean).join(" ");
  const title = dose.outcome === MEDICATION_DOSE_OUTCOME.TAKEN
    ? defaultHistoryTitle(CARE_HISTORY_KINDS.MEDICATION)
    : `${dose.name || "Medication"} ${outcome}`;
  return [eventFrom({
    id: `hist-dose-${dose.id}`,
    seniorId: dose.seniorId,
    kind: CARE_HISTORY_KINDS.MEDICATION,
    title,
    body: `${name} was logged as ${outcome}${dose.notes ? ` · ${dose.notes}` : ""}.`,
    actor: dose.recordedByName || "",
    actorId: dose.recordedBy || "",
    occurredAt: dose.recordedAt,
    source: "dose",
    sourceId: dose.id,
    relatedId: dose.medicationId,
  })];
}

function eventsFromAppointment(appointment) {
  const events = [];
  if (appointment.status === APPOINTMENT_STATUS.CANCELLED && appointment.cancelledAt) {
    events.push(eventFrom({
      id: `hist-appt-${appointment.id}-cancel`,
      seniorId: appointment.seniorId,
      kind: CARE_HISTORY_KINDS.APPOINTMENT,
      title: "Appointment cancelled",
      body: `${appointment.title} was cancelled${appointment.cancelReason ? ` · ${appointment.cancelReason}` : ""}.`,
      actor: appointment.cancelledByName || appointment.updatedByName || "",
      actorId: appointment.cancelledBy || "",
      occurredAt: appointment.cancelledAt,
      source: "appointment",
      sourceId: `${appointment.id}:cancelled`,
      relatedId: appointment.id,
    }));
  }
  if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
    events.push(eventFrom({
      id: `hist-appt-${appointment.id}-done`,
      seniorId: appointment.seniorId,
      kind: CARE_HISTORY_KINDS.APPOINTMENT,
      title: "Appointment completed",
      body: `${appointment.title}${appointment.practitionerName ? ` · ${appointment.practitionerName}` : ""}.`,
      actor: appointment.updatedByName || appointment.practitionerName || "",
      actorId: appointment.updatedBy || "",
      occurredAt: appointment.updatedAt || appointment.createdAt,
      source: "appointment",
      sourceId: `${appointment.id}:completed`,
      relatedId: appointment.id,
    }));
  }
  return events;
}

function mergeEvents(logged, derived) {
  const seen = new Set();
  const merged = [];
  for (const item of [...logged, ...derived]) {
    const key = activitySourceKey(item.source, item.sourceId) || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)));
}

export async function getCareHistoryWorkspace(senior, session = getSession(), now = new Date(), extras = {}) {
  const seniorId = senior?.id || session?.seniorId;
  if (!seniorId) {
    return emptyHistory();
  }

  const members = extras.members || await listCareCircle(seniorId);
  const actor = findActor(members, session, senior);
  const household = extras.ownerPlan
    ? { session, senior, members, ownerPlan: extras.ownerPlan, planId: extras.ownerPlan }
    : await householdContext({ session, senior, members });
  const isPlus = canUseCareHistory(household);
  const [activities, visits, completions, tasks, doses, appointments] = await Promise.all([
    extras.activities ? Promise.resolve(extras.activities) : listActivities({ seniorId, limit: QUERY_LIMITS.PAGE }),
    extras.visits ? Promise.resolve(extras.visits) : listVisits({ seniorId }, session),
    extras.completions ? Promise.resolve(extras.completions) : listCarePlanCompletions({ seniorId }),
    extras.tasks ? Promise.resolve(extras.tasks) : listCarePlanTasks({ seniorId }),
    extras.doses ? Promise.resolve(extras.doses) : listMedicationDoses({ seniorId }),
    extras.appointments ? Promise.resolve(extras.appointments) : listAppointments({ seniorId }),
  ]);

  const logged = activities
    .filter((item) => !item.seniorId || item.seniorId === seniorId)
    .map((item) => createActivity(item));
  const derived = [
    ...visits.flatMap(eventsFromVisit),
    ...completions.flatMap((item) => eventsFromCompletion(item, tasks)),
    ...doses.flatMap(eventsFromDose),
    ...appointments.flatMap(eventsFromAppointment),
  ];
  const events = mergeEvents(logged, derived).map((item) => mapEvent(item, now));
  const counts = historyCounts(events, now);
  const todayKey = historyDayKey(now.toISOString(), now);
  const today = events
    .filter((item) => item.dayKey === todayKey)
    .sort((a, b) => String(a.occurredAt || a.createdAt).localeCompare(String(b.occurredAt || b.createdAt)));

  return {
    events,
    days: groupHistoryByDay(events, now),
    today,
    filters: extras.filter || extras.query
      ? groupHistoryByDay(filterHistoryEvents(events, extras), now)
      : null,
    counts,
    canAddNote: isPlus && canAddCareHistoryNote(session, actor, senior),
    isPlus,
  };
}

export async function listRecentCareHistory(senior, session = getSession(), now = new Date(), limit = 8) {
  const workspace = await getCareHistoryWorkspace(senior, session, now);
  return workspace.events.slice(0, limit);
}

export async function addCareHistoryNote(seniorId, body, session = getSession()) {
  const [members, senior] = await Promise.all([
    listCareCircle(seniorId),
    getSeniorById(seniorId),
  ]);
  const household = await householdContext({ session, senior, members });
  assertCanUseCareHistory(household);
  return postActivity({
    seniorId,
    kind: CARE_HISTORY_KINDS.NOTE,
    type: ACTIVITY_TYPES.CARE,
    title: defaultHistoryTitle(CARE_HISTORY_KINDS.NOTE),
    body,
    source: "activity",
  }, session);
}

function emptyHistory() {
  return {
    events: [],
    days: [],
    today: [],
    filters: null,
    counts: {
      total: 0,
      today: 0,
      week: 0,
      checkIns: 0,
      checkOuts: 0,
      tasks: 0,
      medications: 0,
    },
    canAddNote: false,
    isPlus: false,
  };
}
