import {
  AVAILABILITY,
  CARE_STATUS,
  CIRCLE_KINDS,
  ROLES,
} from "../config/constants.js";
import { professionalTypeLabel } from "../config/roles.js";
import { careHistoryKindLabel } from "../config/care-history.js";
import { getSeniorForUser } from "./senior-service.js";
import { listCareCircle, listIncomingInvites } from "./care-circle-service.js";
import { listTodaysTasks } from "./schedule-service.js";
import { getNotificationFeed } from "../notifications/notification-center.js";
import { listActivities } from "./activity-service.js";
import { formatBillingDate } from "../config/subscription.js";
import { formatPlanPrice, getCurrentPlan } from "./subscription-service.js";
import { getCarePlanWorkspace } from "./care-plan-service.js";
import { getAppointmentWorkspace } from "./appointment-service.js";
import { getMedicationWorkspace } from "./medication-service.js";
import { getMessagingWorkspace } from "./message-service.js";
import { getSession } from "../auth/session.js";
import { withVerificationStatus } from "./verification-service.js";

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

export async function getFamilyDashboard(now = new Date()) {
  const session = getSession();
  const [senior, circle, todaysTasks, notices, activities, plan, incoming, care, clinic, meds, messaging] = await Promise.all([
    getSeniorForUser(),
    listCareCircle(),
    listTodaysTasks(now),
    getNotificationFeed(),
    listActivities({ seniorId: session?.seniorId }),
    getCurrentPlan(),
    listIncomingInvites(),
    getCarePlanWorkspace(null, session, now),
    getAppointmentWorkspace(null, session, now),
    getMedicationWorkspace(null, session, now),
    getMessagingWorkspace(null, session, now).catch(() => ({ conversations: [], counts: { unread: 0 } })),
  ]);

  const caregivers = await withVerificationStatus(circle.filter((member) => member.kind === CIRCLE_KINDS.CAREGIVER));
  const practitioners = await withVerificationStatus(circle.filter((member) => member.kind === CIRCLE_KINDS.PRACTITIONER));
  const family = circle.filter((member) => member.kind === CIRCLE_KINDS.FAMILY);
  const unread = notices.filter((item) => !item.read).length;
  const careTasks = uniqueById([
    ...(care?.overdue || []),
    ...(care?.dueToday || []),
  ]).map(mapCareTask);
  const appointments = clinic.upcoming || [];
  const remainingTasks = todaysTasks.filter((event) => liveTaskStatus(event, now) !== "completed").length
    + careTasks.filter((task) => task.status !== "completed").length;
  const allToday = [...careTasks, ...todaysTasks.map((event) => mapTask(event, now))];

  return {
    senior: mapSenior(senior, meds),
    careStatus: mapCareStatus(senior?.care, now),
    stats: {
      tasksToday: String(todaysTasks.length + careTasks.length),
      tasksHint: remainingTasks ? `${remainingTasks} still open` : "All done for now",
      appointments: String(appointments.length),
      appointmentsHint: appointments[0]
        ? `Next: ${appointments[0].when}`
        : "None upcoming",
      circle: String(circle.length),
      circleHint: `${caregivers.length} caregivers · ${practitioners.length} clinicians`,
      alerts: String(unread),
      alertsHint: unread ? "Needs a look" : "Caught up",
    },
    todaysTasks: allToday,
    appointments: appointments.map(mapDashboardAppointment),
    caregivers: caregivers.map((member) => mapProfessional(member, ROLES.CAREGIVER)),
    practitioners: practitioners.map((member) => mapProfessional(member, ROLES.HEALTH_PRACTITIONER)),
    activities: activities.slice(0, 5).map(mapActivity),
    notices: notices.slice(0, 4).map(mapNotice),
    messages: (messaging.conversations || []).slice(0, 4),
    circle: {
      total: circle.length,
      family: family.length,
      caregivers: caregivers.length,
      practitioners: practitioners.length,
      active: circle.filter((member) => member.status === "active").length,
      members: circle.slice(0, 5).map(mapCircleMember),
    },
    subscription: mapSubscription(plan),
    incoming: incoming.map((invite) => ({
      id: invite.id,
      seniorName: invite.seniorName,
      invitedByName: invite.invitedByName,
      relationship: invite.relationship,
      kind: invite.kind,
    })),
  };
}

function mapSenior(senior, meds) {
  if (!senior) {
    return {
      exists: false,
      displayName: "",
      preferredName: "your senior",
      photoURL: null,
      age: null,
      location: "",
      dateOfBirth: "",
      conditions: [],
      medications: [],
      emergency: "No emergency contact yet",
    };
  }

  const emergency = senior.emergencyContacts?.[0] ?? null;
  const medicationNames = (meds?.active || []).map((item) => `${item.name} ${item.dosage}`.trim());
  return {
    exists: true,
    displayName: senior.displayName,
    preferredName: senior.preferredName,
    photoURL: senior.photoURL,
    age: ageFromDob(senior.dateOfBirth),
    location: senior.location,
    dateOfBirth: senior.dateOfBirth,
    conditions: senior.conditions ?? [],
    medications: medicationNames.length ? medicationNames : (senior.medications ?? []),
    emergency: emergency
      ? `${emergency.name} · ${emergency.relationship}`
      : "No emergency contact yet",
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

function mapTask(event, now) {
  const status = liveTaskStatus(event, now);
  return {
    id: event.id,
    title: event.title,
    meta: `${formatTime(event.time)} · ${event.assignee}`,
    type: event.type,
    status,
    statusLabel: TASK_LABEL[status] ?? "Due",
    badge: TASK_BADGE[status] ?? "badge--brand",
  };
}

function mapCareTask(task) {
  return {
    id: task.id,
    title: task.title,
    meta: task.meta,
    notes: task.notes || "",
    type: "care-plan",
    status: task.liveStatus,
    statusLabel: task.statusLabel,
    badge: task.badge,
    priorityLabel: task.priorityLabel,
    isOverdue: Boolean(task.isOverdue),
  };
}

function mapDashboardAppointment(item) {
  return {
    id: item.id,
    title: item.title,
    meta: item.meta,
    type: "appointment",
    notes: item.notes || "",
    statusLabel: item.statusLabel,
    badge: item.badge,
  };
}

function mapProfessional(member, role) {
  const credential = professionalTypeLabel(role, member.professionalType) || member.relationship;
  return {
    id: member.id,
    name: member.name,
    relationship: member.relationship,
    credential,
    availability: AVAILABILITY_LABEL[member.availability] ?? "Available",
    availabilityBadge: AVAILABILITY_BADGE[member.availability] ?? "badge--neutral",
    lastSeen: member.lastSeenAt ? formatWhen(member.lastSeenAt) : "No check-in yet",
    nextVisit: member.nextVisit || "No visit scheduled",
    notes: member.notes || "",
    verificationStatus: member.verificationStatus || null,
  };
}

function mapCircleMember(member) {
  return {
    id: member.id,
    name: member.name,
    relationship: member.relationship,
    role: member.role,
    kind: member.kind,
  };
}

function mapActivity(item) {
  return {
    id: item.id,
    type: item.kindLabel || careHistoryKindLabel(item.kind) || item.type,
    title: item.title,
    body: item.body,
    actor: item.actor,
    when: item.when || formatWhen(item.occurredAt || item.createdAt),
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

function mapSubscription(plan) {
  const plus = plan.id !== "free";
  const when = formatBillingDate(plan.periodEnd);
  const price = formatPlanPrice(plan, { compact: true }) || plan.price;
  let hint = plus
    ? `${price} · household plan`
    : "Upgrade to Plus for medication, documents, care history, reports, and a full circle.";
  if (plus && plan.status === "past_due") {
    hint = when ? `Payment past due · update the card before ${when}` : "Payment past due · update the card in Stripe";
  } else if (plus && plan.cancelAtPeriodEnd && when) {
    hint = `Access through ${when} · resume to keep renewing`;
  } else if (plus && when) {
    hint = `${price} · renews ${when}`;
  }

  return {
    id: plan.id,
    name: plan.heading || plan.name,
    price: plan.price,
    summary: plan.summary,
    status: plus ? (plan.cancelAtPeriodEnd ? "Ending" : "Plus") : "Free",
    badge: plus ? (plan.cancelAtPeriodEnd || plan.status === "past_due" ? "badge--warning" : "badge--success") : "badge--neutral",
    hint,
    href: "settings.html?tab=plans",
    actionLabel: plus ? "Manage subscription" : "Upgrade to Plus",
  };
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

function ageFromDob(value) {
  if (!value) return null;
  const dob = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hadBirthday = now.getMonth() > dob.getMonth()
    || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hadBirthday) age -= 1;
  return age;
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

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
