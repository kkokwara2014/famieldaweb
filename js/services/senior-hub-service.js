import {
  AVAILABILITY,
  CARE_STATUS,
  CIRCLE_KINDS,
  ROLES,
} from "../config/constants.js";
import { optionLabel, SENIOR_DIETS, SENIOR_MOBILITY } from "../config/senior.js";
import { professionalTypeLabel } from "../config/roles.js";
import { weekdayLabel, groupEventsByWeekday } from "../scheduling/calendar.js";
import { currentSeniorSection, SENIOR_HUB_SECTIONS } from "../config/senior-hub.js";
import { listCareCircle } from "./care-circle-service.js";
import { listScheduleEvents } from "./schedule-service.js";
import { listActivities } from "./activity-service.js";
import { getCareHistoryWorkspace } from "./care-history-service.js";
import { listVisits } from "./caregiver-schedule-service.js";
import { getNotificationFeed } from "../notifications/notification-center.js";
import { getConversationThread, getMessagingWorkspace, markConversationRead } from "./message-service.js";
import { getCarePlanWorkspace } from "./care-plan-service.js";
import { getAppointmentWorkspace } from "./appointment-service.js";
import { getMedicationWorkspace } from "./medication-service.js";
import { getDocumentWorkspace } from "./document-service.js";
import { buildReportsWorkspace } from "./reports-service.js";
import { getSession } from "../auth/session.js";
import { resolveHouseholdPlan } from "./entitlement-service.js";

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

export async function getSeniorHub(senior, now = new Date()) {
  const seniorId = senior?.id;
  const session = getSession();
  const [circle, events, activities, notices, documentWorkspace, messaging, care, appointmentsWorkspace, medicationsWorkspace, visits] = await Promise.all([
    listCareCircle(),
    listScheduleEvents(),
    listActivities({ seniorId }),
    getNotificationFeed(),
    getDocumentWorkspace(senior, session, now),
    getMessagingWorkspace(senior, session, now).catch(() => emptyMessaging()),
    getCarePlanWorkspace(senior, session, now),
    getAppointmentWorkspace(senior, session, now),
    getMedicationWorkspace(senior, session, now),
    listVisits({ seniorId }, session),
  ]);
  const ownerPlan = await resolveHouseholdPlan({ session, senior, members: circle });
  const history = await getCareHistoryWorkspace(senior, session, now, {
    activities,
    visits,
    completions: care.completions || care.recentCompletions,
    tasks: care.tasks,
    doses: medicationsWorkspace.history,
    appointments: appointmentsWorkspace.appointments,
    members: circle,
    ownerPlan,
  });

  const caregivers = circle.filter((member) => member.kind === CIRCLE_KINDS.CAREGIVER).map(mapProfessional);
  const practitioners = circle.filter((member) => member.kind === CIRCLE_KINDS.PRACTITIONER).map(mapProfessional);
  const tasks = events
    .filter((event) => event.type !== "appointment" && event.type !== "family")
    .map((event) => mapTask(event, now))
    .sort(bySoonest);
  const todaysTasks = tasks.filter((task) => task.weekday === now.getDay());
  const appointments = appointmentsWorkspace.upcoming.length
    ? appointmentsWorkspace.upcoming
    : appointmentsWorkspace.today;
  const medications = medicationsWorkspace.active.length
    ? medicationsWorkspace.active
    : medicationsWorkspace.medications;
  const unread = notices.filter((item) => !item.read).length;
  const careTasksToday = care.dueToday.length;
  const careOpen = care.progress.open;
  const messageThread = await loadMessageThread(messaging, session, now);

  const hub = {
    senior,
    careStatus: mapCareStatus(senior?.care, now),
    caregivers,
    practitioners,
    tasks,
    todaysTasks,
    week: groupEventsByWeekday(events).map((day) => ({
      ...day,
      events: day.events.map((event) => mapWeekEvent(event)),
    })),
    appointments,
    medications,
    carePlan: care.plans,
    careTasks: care.tasks,
    careDueToday: care.dueToday,
    careOverdue: care.overdue,
    careRecurring: care.recurring,
    careCompleted: care.completed,
    careCompletions: care.recentCompletions,
    careAssignees: care.assignees,
    canManageCare: care.canManage,
    careProgress: care.progress,
    appointmentRecords: appointmentsWorkspace.appointments,
    appointmentUpcoming: appointmentsWorkspace.upcoming,
    appointmentToday: appointmentsWorkspace.today,
    appointmentPast: appointmentsWorkspace.past,
    appointmentCancelled: appointmentsWorkspace.cancelled,
    appointmentReminders: appointmentsWorkspace.reminders,
    appointmentPractitioners: appointmentsWorkspace.practitioners,
    appointmentCalendar: appointmentsWorkspace.calendar,
    appointmentDay: appointmentsWorkspace.selectedDay,
    canManageAppointments: appointmentsWorkspace.canManage,
    medicationRecords: medicationsWorkspace.medications,
    medicationActive: medicationsWorkspace.active,
    medicationDue: medicationsWorkspace.dueToday,
    medicationReminders: medicationsWorkspace.reminders,
    medicationPaused: medicationsWorkspace.paused,
    medicationEnded: medicationsWorkspace.ended,
    medicationHistory: medicationsWorkspace.history,
    medicationAssignees: medicationsWorkspace.assignees,
    medicationClinicians: medicationsWorkspace.clinicians,
    canManageMedications: medicationsWorkspace.canManage,
    canLogMedications: medicationsWorkspace.canLog,
    medicationPlus: medicationsWorkspace.isPlus,
    medicationCounts: medicationsWorkspace.counts,
    supportNotes: buildSupportNotes(senior, caregivers, practitioners),
    activities: history.events.slice(0, 8),
    history,
    historyPlus: Boolean(history.isPlus),
    documents: documentWorkspace.documents,
    documentCounts: documentWorkspace.counts,
    canManageDocuments: documentWorkspace.canManage,
    documentPlus: documentWorkspace.isPlus,
    messaging,
    messageThread,
    messages: (messageThread?.messages || []).map(mapMessage),
    notices,
    counts: {
      tasksToday: todaysTasks.length + careTasksToday,
      tasksOpen: todaysTasks.filter((task) => task.status !== "completed").length + careOpen,
      appointments: appointmentsWorkspace.counts.upcoming,
      caregivers: caregivers.length,
      practitioners: practitioners.length,
      medications: medicationsWorkspace.counts.active,
      medicationsDue: medicationsWorkspace.counts.dueToday,
      documents: documentWorkspace.counts.total,
      messages: messaging?.counts?.conversations ?? 0,
      unread: unread + (messaging?.counts?.unread || 0),
      history: history.counts.today,
      carePlans: care.plans.length,
      careDue: careTasksToday,
      careOverdue: care.overdue.length,
    },
    shortcuts: SENIOR_HUB_SECTIONS.filter((item) => item.id !== "overview").map((item) => ({
      ...item,
      hint: shortcutHint(item.id, {
        tasksToday: todaysTasks.length,
        appointments: appointmentsWorkspace.counts.upcoming,
        caregivers: caregivers.length,
        practitioners: practitioners.length,
        medications: medicationsWorkspace.counts.active,
        medicationsDue: medicationsWorkspace.counts.dueToday,
        documents: documentWorkspace.counts.total,
        messages: messaging?.counts?.conversations ?? 0,
        unreadMessages: messaging?.counts?.unread || 0,
        carePlans: care.plans.length,
        careDue: careTasksToday,
        careOverdue: care.overdue.length,
        historyToday: history.counts.today,
      }),
    })),
  };

  hub.reports = buildReportsWorkspace({
    senior,
    session,
    now,
    visits,
    tasks: care.tasks,
    completions: care.completions,
    overdue: care.overdue,
    historyEvents: history.events,
    doses: medicationsWorkspace.history,
    caregivers,
    members: circle,
    ownerPlan,
    appointments,
    careStatus: hub.careStatus,
    todaysTasks,
    careProgress: care.progress,
    counts: hub.counts,
  });
  return hub;
}

function shortcutHint(id, counts) {
  const hints = {
    "care-plan": counts.carePlans
      ? `${counts.carePlans} plan${counts.carePlans === 1 ? "" : "s"} · ${counts.careDue} due today`
      : "Create a plan and assign tasks",
    tasks: counts.careDue
      ? `${counts.careDue} due today${counts.careOverdue ? ` · ${counts.careOverdue} overdue` : ""}`
      : "Create and assign care work",
    schedule: "Shared week for this household",
    caregivers: `${counts.caregivers} on the circle`,
    practitioners: `${counts.practitioners} clinicians`,
    medications: counts.medicationsDue
      ? `${counts.medicationsDue} due today`
      : (counts.medications ? `${counts.medications} on the shared list` : "Plus · shared list and history"),
    appointments: counts.appointments
      ? `${counts.appointments} upcoming`
      : "Create a visit and set a reminder",
    history: counts.historyToday
      ? `${counts.historyToday} logged today`
      : "Check-ins, tasks, and notes",
    reports: "Care summary, activity, and export",
    documents: counts.documents
      ? `${counts.documents} on file`
      : "Plus · private household vault",
    messages: counts.unreadMessages
      ? `${counts.unreadMessages} unread`
      : (counts.messages ? `${counts.messages} conversation${counts.messages === 1 ? "" : "s"}` : "Family ↔ caregiver and clinicians"),
  };
  return hints[id] ?? "";
}

function buildSupportNotes(senior, caregivers, practitioners) {
  if (!senior) return [];
  const prefs = senior.carePreferences ?? {};
  const info = senior.importantInfo ?? {};
  const onDuty = caregivers.find((person) => person.availability === "On duty");
  const items = [
    prefs.dailyRoutine && {
      id: "routine",
      category: "Routine",
      title: "Daily rhythm",
      detail: prefs.dailyRoutine,
      owner: onDuty?.name || "Household",
    },
    prefs.diet && {
      id: "diet",
      category: "Nutrition",
      title: optionLabel(SENIOR_DIETS, prefs.diet, "Diet"),
      detail: prefs.likes ? `Likes: ${prefs.likes}` : "Follow the recorded diet.",
      owner: "Caregivers",
    },
    prefs.mobility && {
      id: "mobility",
      category: "Mobility",
      title: optionLabel(SENIOR_MOBILITY, prefs.mobility, "Mobility"),
      detail: "Keep walks short if she is tired. Call before arriving so she can sit up.",
      owner: onDuty?.name || "Caregivers",
    },
    ...(senior.conditions ?? []).map((condition, index) => ({
      id: `condition-${index}`,
      category: "Clinical",
      title: condition,
      detail: info.medicalNotes || "Follow the clinician notes on the profile.",
      owner: practitioners[0]?.name || info.primaryPhysician || "Care team",
    })),
    prefs.notes && {
      id: "support",
      category: "Support",
      title: "How to help",
      detail: prefs.notes,
      owner: "Everyone",
    },
    senior.care?.coverageNote && {
      id: "coverage",
      category: "Coverage",
      title: "Who is covering",
      detail: senior.care.coverageNote,
      owner: "Family",
    },
  ];
  return items.filter(Boolean);
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

function mapProfessional(member) {
  const role = member.kind === CIRCLE_KINDS.PRACTITIONER ? ROLES.HEALTH_PRACTITIONER : ROLES.CAREGIVER;
  return {
    id: member.id,
    userId: member.userId || "",
    name: member.name,
    email: member.email,
    relationship: member.relationship,
    credential: professionalTypeLabel(role, member.professionalType) || member.relationship,
    availability: AVAILABILITY_LABEL[member.availability] ?? "Available",
    availabilityBadge: AVAILABILITY_BADGE[member.availability] ?? "badge--neutral",
    lastSeen: member.lastSeenAt ? formatWhen(member.lastSeenAt) : "No check-in yet",
    nextVisit: member.nextVisit || "No visit scheduled",
    notes: member.notes || "",
  };
}

function mapTask(event, now) {
  const status = liveTaskStatus(event, now);
  return {
    id: event.id,
    title: event.title,
    weekday: event.weekday,
    day: weekdayLabel(event.weekday, { long: true }),
    time: formatTime(event.time),
    assignee: event.assignee,
    type: event.type,
    notes: event.notes || "",
    when: `${weekdayLabel(event.weekday)} · ${formatTime(event.time)}`,
    meta: `${weekdayLabel(event.weekday, { long: true })} · ${formatTime(event.time)} · ${event.assignee}`,
    status,
    statusLabel: TASK_LABEL[status] ?? "Due",
    badge: TASK_BADGE[status] ?? "badge--brand",
    isToday: event.weekday === now.getDay(),
  };
}

function mapAppointment(event, now) {
  const delta = (event.weekday - now.getDay() + 7) % 7;
  const when = delta === 0 ? "Today" : delta === 1 ? "Tomorrow" : weekdayLabel(event.weekday, { long: true });
  return {
    id: event.id,
    title: event.title,
    weekday: event.weekday,
    time: formatTime(event.time),
    assignee: event.assignee,
    notes: event.notes || "",
    when,
    meta: `${when} · ${formatTime(event.time)} · ${event.assignee}`,
    soonest: delta,
  };
}

function mapWeekEvent(event) {
  return {
    id: event.id,
    title: event.title,
    time: formatTime(event.time),
    assignee: event.assignee,
    type: event.type,
    visitStatus: event.visitStatus || "",
    endTime: event.endTime ? formatTime(event.endTime) : "",
  };
}

function mapMessage(item) {
  return {
    ...item,
    author: item.author || item.authorName,
    when: item.when || formatWhen(item.createdAt),
  };
}

function emptyMessaging() {
  return {
    conversations: [],
    contactGroups: [],
    contacts: [],
    counts: { conversations: 0, unread: 0, contacts: 0 },
    canPostCircle: false,
  };
}

async function loadMessageThread(messaging, session, now) {
  if (typeof window === "undefined" || currentSeniorSection().id !== "messages") return null;
  const requested = new URLSearchParams(window.location.search).get("thread");
  const threadId = requested || messaging?.conversations?.[0]?.id || "";
  if (!threadId) return null;
  try {
    const thread = await getConversationThread(threadId, session, now);
    await markConversationRead(threadId, session);
    return thread;
  } catch {
    return null;
  }
}

function liveTaskStatus(event, now) {
  if (event.visitId) {
    if (event.visitStatus === "checked_out") return "completed";
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

function bySoonest(a, b) {
  const aDelta = a.soonest ?? ((a.weekday - new Date().getDay() + 7) % 7);
  const bDelta = b.soonest ?? ((b.weekday - new Date().getDay() + 7) % 7);
  return aDelta - bDelta || String(a.time).localeCompare(String(b.time));
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
