import {
  AVAILABILITY,
  CARE_STATUS,
  CIRCLE_STATUS,
  ROLES,
  VISIT_STATUS,
} from "../config/constants.js";
import { kindLabel } from "../config/care-circle.js";
import { professionalTypeLabel } from "../config/roles.js";
import { dashboardLayoutFor } from "../config/onboarding.js";
import { weekdayLabel } from "../scheduling/calendar.js";
import { getSession } from "../auth/session.js";
import { getSeniorForUser } from "./senior-service.js";
import { listCareCircle, listIncomingInvites } from "./care-circle-service.js";
import { listScheduleEvents } from "./schedule-service.js";
import { listVisits } from "./caregiver-schedule-service.js";
import { visitStatusBadge, visitStatusLabel } from "../config/scheduling.js";
import { getNotificationFeed } from "../notifications/notification-center.js";
import { listActivities } from "./activity-service.js";
import { getMessagingWorkspace } from "./message-service.js";
import { getCarePlanWorkspace } from "./care-plan-service.js";
import { getMedicationWorkspace } from "./medication-service.js";
import { formatDateLabel, formatRange, todayIso } from "../scheduling/time.js";

const STATUS_BADGE = {
  [CARE_STATUS.STABLE]: "badge--success",
  [CARE_STATUS.ATTENTION]: "badge--warning",
  [CARE_STATUS.URGENT]: "badge--danger",
};

const STATUS_LABEL = {
  [CARE_STATUS.STABLE]: "Stable",
  [CARE_STATUS.ATTENTION]: "Needs attention",
  [CARE_STATUS.URGENT]: "Urgent",
};

const AVAILABILITY_BADGE = {
  [AVAILABILITY.ON_DUTY]: "badge--success",
  [AVAILABILITY.AVAILABLE]: "badge--info",
  [AVAILABILITY.OFF_DUTY]: "badge--neutral",
};

const AVAILABILITY_LABEL = {
  [AVAILABILITY.ON_DUTY]: "On duty",
  [AVAILABILITY.AVAILABLE]: "Available",
  [AVAILABILITY.OFF_DUTY]: "Off duty",
};

const TASK_BADGE = {
  completed: "badge--success",
  scheduled: "badge--brand",
  missed: "badge--danger",
};

const TASK_LABEL = {
  completed: "Done",
  scheduled: "Due",
  missed: "Missed",
};

const TYPE_LABEL = {
  care: "Visit",
  appointment: "Appointment",
  meds: "Medication",
  errand: "Errand",
  family: "Family",
};

export async function getCaregiverDashboard(session = getSession(), now = new Date()) {
  const [senior, circle, events, notices, activities, incoming, messaging, visits, care, meds] = await Promise.all([
    getSeniorForUser(session),
    listCareCircle(session?.seniorId),
    listScheduleEvents(now),
    getNotificationFeed(),
    listActivities({ seniorId: session?.seniorId }),
    listIncomingInvites(session),
    getMessagingWorkspace(null, session, now).catch(() => ({ conversations: [], counts: { unread: 0 } })),
    listVisits({ caregiver: { caregiverUserId: session?.id, caregiverEmail: session?.email } }, session),
    getCarePlanWorkspace(null, session, now),
    getMedicationWorkspace(null, session, now),
  ]);

  const mine = events.filter((event) => assignedTo(event, session));
  const myCareTasks = (care?.tasks || []).filter((task) => assignedCareTask(task, session));
  const careToday = myCareTasks
    .filter((task) => task.dueDate === todayIso(now) || task.liveStatus === "missed")
    .map(mapCareAssignment);
  const myMeds = (meds?.dueToday || []).filter((item) => assignedMedication(item, session, meds));
  const todaysAssignments = prioritizeByCare([
    ...careToday,
    ...myMeds.map(mapMedicationAssignment),
    ...mine
      .filter((event) => event.weekday === now.getDay() && event.type !== "meds")
      .sort(byTime)
      .map((event) => mapAssignment(event, now)),
  ], session);
  const upcomingVisits = mine
    .filter((event) => isUpcomingVisit(event, now))
    .sort(bySoonest(now))
    .map((event) => mapVisit(event, now));
  const tasks = prioritizeByCare([
    ...myCareTasks.filter((task) => task.liveStatus !== "completed" && task.liveStatus !== "skipped").map(mapCareAssignment),
    ...myMeds.filter((item) => item.canLog).map(mapMedicationAssignment),
    ...mine
      .filter((event) => isOpenTask(event, now) && event.type !== "meds")
      .sort(bySoonest(now))
      .map((event) => mapAssignment(event, now)),
  ], session);
  const visitHistory = buildVisitHistory(mine, activities, session, now);
  const unread = notices.filter((item) => !item.read).length;
  const openToday = todaysAssignments.filter((item) => item.status !== "completed").length;
  const me = findSelf(circle, session);
  const credential = professionalTypeLabel(session?.role || ROLES.CAREGIVER, session?.professionalType || me?.professionalType)
    || me?.relationship
    || "Caregiver";

  return {
    senior: mapSenior(senior),
    me: mapSelf(me, session, credential, now),
    credential,
    careStatus: mapCareStatus(senior?.care, now),
    stats: {
      assignments: String(todaysAssignments.length),
      assignmentsHint: todaysAssignments.length
        ? (openToday ? `${openToday} still open` : "All done for now")
        : "Nothing assigned today",
      visits: String(upcomingVisits.length),
      visitsHint: upcomingVisits[0]
        ? `Next: ${upcomingVisits[0].when}`
        : "None later this week",
      tasks: String(tasks.length),
      tasksHint: tasks[0] ? `Next: ${tasks[0].time || tasks[0].dueLabel || "due"}` : "Caught up",
      alerts: String(unread),
      alertsHint: unread ? "Needs a look" : "Caught up",
    },
    todaysAssignments,
    upcomingVisits,
    engagements: buildEngagements(senior, me, session, credential, now),
    tasks,
    invitations: incoming.map(mapInvite),
    scheduleRequests: visits
      .filter((visit) => visit.status === VISIT_STATUS.REQUESTED)
      .sort(byVisitSoonest)
      .map((visit) => mapScheduleRequest(visit)),
    visitHistory,
    notices: notices.slice(0, 4).map(mapNotice),
    messages: (messaging.conversations || []).slice(0, 5),
    unreadMessages: messaging.counts?.unread || 0,
  };
}

function mapSenior(senior) {
  if (!senior) {
    return {
      exists: false,
      id: "",
      displayName: "",
      preferredName: "your senior",
      photoURL: null,
      location: "",
      conditions: [],
      notes: "",
    };
  }

  return {
    exists: true,
    id: senior.id,
    displayName: senior.displayName,
    preferredName: senior.preferredName,
    photoURL: senior.photoURL,
    location: senior.location,
    conditions: senior.conditions ?? [],
    notes: senior.carePreferences?.notes || "",
  };
}

function mapSelf(member, session, credential, now) {
  const availability = member?.availability ?? AVAILABILITY.AVAILABLE;
  return {
    name: session?.displayName || member?.name || "Caregiver",
    credential,
    relationship: member?.relationship || "Caregiver",
    availability: AVAILABILITY_LABEL[availability] ?? "Available",
    availabilityBadge: AVAILABILITY_BADGE[availability] ?? "badge--neutral",
    lastSeen: member?.lastSeenAt ? formatWhen(member.lastSeenAt, now) : "No check-in yet",
    nextVisit: member?.nextVisit || "No visit scheduled",
    notes: member?.notes || "",
    status: member?.status || CIRCLE_STATUS.ACTIVE,
  };
}

function mapCareStatus(care = {}, now) {
  const status = care.status ?? CARE_STATUS.STABLE;
  return {
    status,
    label: STATUS_LABEL[status] ?? "Stable",
    badge: STATUS_BADGE[status] ?? "badge--success",
    summary: care.summary || "The household has not logged a care update yet.",
    updatedLabel: care.updatedAt ? formatWhen(care.updatedAt, now) : "Not updated",
    coverageNote: care.coverageNote || "No coverage note for today.",
  };
}

function buildEngagements(senior, member, session, credential, now) {
  if (!senior) return [];
  const mapped = mapSelf(member, session, credential, now);
  const care = mapCareStatus(senior.care, now);
  return [{
    id: senior.id,
    seniorName: senior.displayName,
    preferredName: senior.preferredName,
    photoURL: senior.photoURL,
    location: senior.location,
    relationship: mapped.relationship,
    credential: mapped.credential,
    availability: mapped.availability,
    availabilityBadge: mapped.availabilityBadge,
    nextVisit: mapped.nextVisit,
    lastSeen: mapped.lastSeen,
    notes: senior.carePreferences?.notes || mapped.notes,
    careLabel: care.label,
    careBadge: care.badge,
    careStatus: care.status,
    coverageNote: care.coverageNote,
    summary: care.summary,
  }];
}

function mapAssignment(event, now) {
  const status = liveTaskStatus(event, now);
  return {
    id: event.id,
    title: event.title,
    type: event.type,
    typeLabel: TYPE_LABEL[event.type] ?? "Task",
    time: formatTime(event.time),
    day: weekdayLabel(event.weekday, { long: true }),
    meta: event.visitId
      ? `${event.seniorName ? `${event.seniorName} · ` : ""}${event.weekday === now.getDay() ? formatTime(event.time) : `${weekdayLabel(event.weekday, { long: true })} · ${formatTime(event.time)}`}${event.endTime ? ` – ${formatTime(event.endTime)}` : ""}`
      : (event.weekday === now.getDay()
        ? formatTime(event.time)
        : `${weekdayLabel(event.weekday, { long: true })} · ${formatTime(event.time)}`),
    notes: event.notes || "",
    status,
    statusLabel: event.visitStatus ? visitStatusLabel(event.visitStatus) : (TASK_LABEL[status] ?? "Due"),
    badge: event.visitStatus ? visitStatusBadge(event.visitStatus) : (TASK_BADGE[status] ?? "badge--brand"),
    visitId: event.visitId || "",
    visitStatus: event.visitStatus || "",
    canCheckIn: event.visitStatus === VISIT_STATUS.ACCEPTED && event.date === todayIso(now),
    canCheckOut: event.visitStatus === VISIT_STATUS.CHECKED_IN,
  };
}

function mapVisit(event, now) {
  const assignment = mapAssignment(event, now);
  const delta = (event.weekday - now.getDay() + 7) % 7;
  const when = delta === 0 ? "Today" : delta === 1 ? "Tomorrow" : weekdayLabel(event.weekday, { long: true });
  return {
    ...assignment,
    when,
    meta: `${when} · ${assignment.time}`,
  };
}

function mapInvite(invite) {
  return {
    id: invite.id,
    seniorName: invite.seniorName || "a household",
    invitedByName: invite.invitedByName || "A family member",
    relationship: invite.relationship || kindLabel(invite.kind),
    kindLabel: kindLabel(invite.kind),
    message: invite.message || "",
  };
}

function mapNotice(item) {
  return {
    id: item.id,
    type: item.typeLabel || item.type,
    title: item.title,
    body: item.body,
    read: item.read,
    href: item.href || "",
    when: formatWhen(item.createdAt),
    isEmergency: Boolean(item.isEmergency),
  };
}

function buildVisitHistory(events, activities, session, now) {
  const fromEvents = events
    .filter((event) => isPastVisit(event, now))
    .sort((a, b) => b.weekday - a.weekday || String(b.time).localeCompare(String(a.time)))
    .map((event) => ({
      id: `visit-${event.id}`,
      type: TYPE_LABEL[event.type] ?? "Visit",
      title: event.title,
      body: event.notes || `Completed for ${event.assignee}.`,
      actor: session?.displayName || event.assignee,
      when: `${weekdayLabel(event.weekday, { long: true })} · ${formatTime(event.time)}`,
    }));

  const fromActivities = activities
    .filter((item) => isOwnActivity(item, session))
    .map((item) => ({
      id: item.id,
      type: item.kindLabel || item.type,
      title: item.title,
      body: item.body,
      actor: item.actor,
      when: formatWhen(item.occurredAt || item.createdAt, now),
    }));

  return [...fromActivities, ...fromEvents].slice(0, 6);
}

function assignedTo(event, session) {
  const assignee = String(event.assignee || "").trim().toLowerCase();
  if (!assignee) return false;
  const name = String(session?.displayName || "").trim().toLowerCase();
  if (!name) return false;
  const first = name.split(/\s+/)[0];
  return assignee === name || assignee === first;
}

function assignedCareTask(task, session) {
  if (!session) return false;
  if (task.assignedCaregiverUserId && task.assignedCaregiverUserId === session.id) return true;
  return String(task.assignedCaregiverEmail || "").trim().toLowerCase()
    === String(session.email || "").trim().toLowerCase();
}

function assignedMedication(item, session, meds) {
  if (!session) return false;
  const record = (meds?.medications || []).find((med) => med.id === item.medicationId) ?? item;
  if (record.responsibleUserId && record.responsibleUserId === session.id) return true;
  return String(record.responsibleEmail || "").trim().toLowerCase()
    === String(session.email || "").trim().toLowerCase();
}

function mapMedicationAssignment(item) {
  const done = item.outcome === "taken" || item.outcome === "skipped";
  return {
    id: `${item.medicationId}-${item.date}-${item.time}`,
    title: item.title || item.name,
    type: "meds",
    typeLabel: "Medication",
    time: item.timeLabel,
    dueLabel: item.timeLabel,
    day: "Today",
    meta: item.meta,
    notes: item.notes || "",
    status: item.outcome === "taken" ? "completed" : (item.outcome === "missed" ? "missed" : "scheduled"),
    statusLabel: item.outcomeLabel,
    badge: item.badge,
    isOverdue: item.outcome === "missed",
    visitId: "",
    visitStatus: "",
    canCheckIn: false,
    canCheckOut: false,
    canComplete: false,
    canNote: false,
    canLogMedication: Boolean(item.canLog) && !done,
    medicationId: item.medicationId,
    medicationDate: item.date,
    medicationTime: item.time,
  };
}

function mapCareAssignment(task) {
  return {
    id: task.id,
    title: task.title,
    type: "care-plan",
    typeLabel: task.isRecurring ? "Recurring" : "Care task",
    time: task.dueLabel,
    dueLabel: task.dueLabel,
    day: task.dueLabel,
    meta: task.meta,
    notes: task.notes || "",
    status: task.liveStatus,
    statusLabel: task.statusLabel,
    badge: task.badge,
    priorityLabel: task.priorityLabel,
    priorityBadge: task.priorityBadge,
    isOverdue: Boolean(task.isOverdue),
    visitId: "",
    visitStatus: "",
    canCheckIn: false,
    canCheckOut: false,
    canComplete: task.canComplete,
    canNote: task.canNote,
    careTaskId: task.id,
    category: task.category || "",
  };
}

function careFocusRank(item, layout) {
  if (!layout) return 1;
  const type = item.type || "";
  const category = item.category || "";
  if (layout.preferMedication && (type === "meds" || category === "medication")) return 0;
  if (layout.preferPersonal && (type === "care" || category === "personal_care")) return 0;
  if (layout.preferHousehold && (type === "errand" || category === "household")) return 0;
  if (layout.preferMobility && category === "mobility") return 0;
  return 1;
}

function prioritizeByCare(items, session) {
  const layout = dashboardLayoutFor(session);
  return [...items].sort((a, b) => careFocusRank(a, layout) - careFocusRank(b, layout));
}

function findSelf(circle, session) {
  const email = String(session?.email || "").trim().toLowerCase();
  return circle.find((member) => (
    (session?.id && member.userId === session.id)
    || (email && String(member.email || "").trim().toLowerCase() === email)
  )) ?? null;
}

function isUpcomingVisit(event, now) {
  if (event.type !== "care" && event.type !== "appointment") return false;
  return event.weekday > now.getDay();
}

function isOpenTask(event, now) {
  if (event.type !== "meds" && event.type !== "errand") return false;
  if (event.weekday < now.getDay()) return false;
  return liveTaskStatus(event, now) !== "completed";
}

function isPastVisit(event, now) {
  if (event.type !== "care" && event.type !== "appointment" && event.type !== "meds") return false;
  if (event.weekday < now.getDay()) return true;
  return event.weekday === now.getDay() && liveTaskStatus(event, now) === "completed";
}

function isOwnActivity(item, session) {
  const actor = String(item.actor || "").trim().toLowerCase();
  const name = String(session?.displayName || "").trim().toLowerCase();
  if (!actor || !name) return false;
  return actor === name || actor.startsWith(name.split(/\s+/)[0]);
}

function mapScheduleRequest(visit) {
  return {
    id: visit.id,
    title: visit.title,
    seniorName: visit.seniorName,
    familyName: visit.familyName,
    when: `${formatDateLabel(visit.date)} · ${formatRange(visit.startTime, visit.endTime)}`,
  };
}

function byVisitSoonest(a, b) {
  return String(a.date).localeCompare(String(b.date)) || String(a.startTime).localeCompare(String(b.startTime));
}

function liveTaskStatus(event, now) {
  if (event.visitId) {
    if (event.visitStatus === VISIT_STATUS.CHECKED_OUT) return "completed";
    return event.status === "completed" ? "completed" : "scheduled";
  }
  if (event.status === "missed" || event.status === "completed") return event.status;
  if (event.weekday !== now.getDay()) return event.status ?? "scheduled";
  const [hours, minutes] = String(event.time).split(":").map(Number);
  const eventMins = (hours || 0) * 60 + (minutes || 0);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  if (nowMins >= eventMins + 20) return "completed";
  return "scheduled";
}

function byTime(a, b) {
  return String(a.time).localeCompare(String(b.time));
}

function bySoonest(now) {
  return (a, b) => {
    const aDelta = (a.weekday - now.getDay() + 7) % 7;
    const bDelta = (b.weekday - now.getDay() + 7) % 7;
    return aDelta - bDelta || String(a.time).localeCompare(String(b.time));
  };
}

function formatTime(hhmm) {
  const [hours, minutes] = String(hhmm).split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatWhen(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  return `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}
