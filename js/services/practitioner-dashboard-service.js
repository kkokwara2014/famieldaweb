import {
  ACTIVITY_TYPES,
  AVAILABILITY,
  CARE_STATUS,
  CIRCLE_STATUS,
  ROLES,
  VISIT_STATUS,
} from "../config/constants.js";
import { kindLabel } from "../config/care-circle.js";
import { professionalTypeLabel } from "../config/roles.js";
import {
  optionLabel,
  SENIOR_DIETS,
  SENIOR_MOBILITY,
  formatSeniorAge,
} from "../config/senior.js";
import { visitStatusBadge, visitStatusLabel } from "../config/scheduling.js";
import { weekdayLabel, groupEventsByWeekday } from "../scheduling/calendar.js";
import { formatDateLabel, formatRange } from "../scheduling/time.js";
import { getSession } from "../auth/session.js";
import { getSeniorForUser } from "./senior-service.js";
import { listCareCircle, listIncomingInvites } from "./care-circle-service.js";
import { listScheduleEvents } from "./schedule-service.js";
import { listVisits } from "./caregiver-schedule-service.js";
import { getNotificationFeed } from "../notifications/notification-center.js";
import { listActivities } from "./activity-service.js";
import { getMessagingWorkspace } from "./message-service.js";
import { getCarePlanWorkspace } from "./care-plan-service.js";
import { getAppointmentWorkspace } from "./appointment-service.js";
import { getMedicationWorkspace } from "./medication-service.js";

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

const TYPE_LABEL = {
  care: "Visit",
  appointment: "Appointment",
  meds: "Medication",
  errand: "Errand",
  family: "Family",
};

const NOTE_TYPE_LABEL = {
  [ACTIVITY_TYPES.CLINICAL]: "Clinical",
  [ACTIVITY_TYPES.CARE]: "Care",
  [ACTIVITY_TYPES.SCHEDULE]: "Schedule",
  [ACTIVITY_TYPES.CIRCLE]: "Circle",
  [ACTIVITY_TYPES.SYSTEM]: "System",
};

export async function getPractitionerDashboard(session = getSession(), now = new Date()) {
  const [senior, circle, events, notices, activities, incoming, messaging, visits, care, clinic, meds] = await Promise.all([
    getSeniorForUser(session),
    listCareCircle(session?.seniorId),
    listScheduleEvents(now),
    getNotificationFeed(),
    listActivities({ seniorId: session?.seniorId }),
    listIncomingInvites(session),
    getMessagingWorkspace(null, session, now).catch(() => ({ conversations: [], counts: { unread: 0 } })),
    listVisits({ caregiver: { caregiverUserId: session?.id, caregiverEmail: session?.email } }, session),
    getCarePlanWorkspace(null, session, now),
    getAppointmentWorkspace(null, session, now),
    getMedicationWorkspace(null, session, now),
  ]);

  const me = findSelf(circle, session);
  const credential = professionalTypeLabel(session?.role || ROLES.HEALTH_PRACTITIONER, session?.professionalType || me?.professionalType)
    || me?.relationship
    || "Clinician";
  const appointmentRequests = visits
    .filter((visit) => visit.status === VISIT_STATUS.REQUESTED)
    .sort(byVisitSoonest)
    .map(mapAppointmentRequest);
  const visitAppointments = visits
    .filter((visit) => ![VISIT_STATUS.DECLINED, VISIT_STATUS.CANCELLED, VISIT_STATUS.REQUESTED].includes(visit.status))
    .sort(byVisitSoonest)
    .map((visit) => mapVisitAppointment(visit, now));
  const householdAppointments = (clinic.upcoming || [])
    .filter((item) => item.isAssociated)
    .map(mapRecordAppointment);
  const appointments = uniqueById([...visitAppointments, ...householdAppointments])
    .sort((a, b) => String(a.sortKey || "").localeCompare(String(b.sortKey || "")));
  const clinicalWeek = groupEventsByWeekday(events.filter(isClinicalEvent), now).map((day) => ({
    ...day,
    isToday: day.weekday === now.getDay(),
    events: day.events
      .slice()
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .map((event) => mapWeekEvent(event, session, me)),
  }));
  const unread = notices.filter((item) => !item.read).length;
  const notes = buildNotes(senior, activities, now);
  const assignedSeniors = buildAssignedSeniors(senior, me, session, credential, appointments, now);

  return {
    senior: mapSenior(senior),
    me: mapSelf(me, session, credential),
    credential,
    careStatus: mapCareStatus(senior?.care, now),
    stats: {
      seniors: String(assignedSeniors.length),
      seniorsHint: assignedSeniors.length
        ? assignedSeniors[0].preferredName
        : (incoming.length ? "Invitation waiting" : "None assigned"),
      appointments: String(appointments.length),
      appointmentsHint: appointmentRequests.length
        ? `${appointmentRequests.length} request${appointmentRequests.length === 1 ? "" : "s"} waiting`
        : (appointments[0]
          ? `Next: ${appointments[0].when}`
          : "None this week"),
      invitations: String(incoming.length),
      invitationsHint: incoming.length ? "Needs a response" : "None waiting",
      alerts: String(unread),
      alertsHint: unread ? "Needs a look" : "Caught up",
    },
    assignedSeniors,
    appointmentRequests,
    appointments,
    invitations: incoming.map(mapInvite),
    schedule: clinicalWeek,
    careInformation: mapCareInformation(senior, care, meds),
    notes,
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
      medications: [],
      allergies: [],
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
    medications: senior.medications ?? [],
    allergies: senior.allergies ?? [],
  };
}

function mapSelf(member, session, credential) {
  const availability = member?.availability ?? AVAILABILITY.AVAILABLE;
  return {
    name: session?.displayName || member?.name || "Clinician",
    credential,
    relationship: member?.relationship || "Health practitioner",
    availability: AVAILABILITY_LABEL[availability] ?? "Available",
    availabilityBadge: AVAILABILITY_BADGE[availability] ?? "badge--neutral",
    lastSeen: member?.lastSeenAt ? formatWhen(member.lastSeenAt) : "No check-in yet",
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

function buildAssignedSeniors(senior, member, session, credential, appointments, now) {
  if (!senior) return [];
  const mapped = mapSelf(member, session, credential);
  const care = mapCareStatus(senior.care, now);
  const next = appointments[0];
  const emergency = senior.emergencyContacts?.[0] ?? null;
  return [{
    id: senior.id,
    seniorName: senior.displayName,
    preferredName: senior.preferredName,
    photoURL: senior.photoURL,
    location: senior.location,
    age: formatSeniorAge(senior.dateOfBirth),
    relationship: mapped.relationship,
    credential: mapped.credential,
    availability: mapped.availability,
    availabilityBadge: mapped.availabilityBadge,
    nextVisit: next ? `${next.when} · ${next.title}` : mapped.nextVisit,
    lastSeen: mapped.lastSeen,
    conditions: senior.conditions ?? [],
    careLabel: care.label,
    careBadge: care.badge,
    careStatus: care.status,
    coverageNote: care.coverageNote,
    summary: care.summary,
    emergency: emergency
      ? `${emergency.name} · ${emergency.relationship}`
      : "No emergency contact yet",
  }];
}

function mapCareInformation(senior, care, meds) {
  if (!senior) {
    return {
      exists: false,
      rows: [],
      conditions: [],
      medications: [],
      allergies: [],
      medicalNotes: "",
      supportNotes: "",
      carePlan: null,
    };
  }

  const info = senior.importantInfo ?? {};
  const prefs = senior.carePreferences ?? {};
  const emergency = senior.emergencyContacts?.[0] ?? null;
  const active = care?.plans?.find((item) => item.status === "active") ?? care?.plans?.[0] ?? null;
  const medicationNames = (meds?.active || []).map((item) => `${item.name} ${item.dosage}`.trim());
  const medications = medicationNames.length ? medicationNames : (senior.medications ?? []);

  return {
    exists: true,
    conditions: senior.conditions ?? [],
    medications,
    allergies: senior.allergies ?? [],
    medicalNotes: info.medicalNotes || "",
    supportNotes: prefs.notes || "",
    carePlan: active
      ? {
        title: active.title,
        goal: active.goal,
        statusLabel: active.statusLabel,
        badge: active.badge,
        progress: active.progress,
        dueToday: care?.dueToday?.length ?? 0,
      }
      : null,
    rows: [
      { label: "Conditions", value: joinList(senior.conditions) },
      { label: "Medications", value: joinList(medications) },
      { label: "Allergies", value: joinList(senior.allergies) },
      { label: "Blood type", value: info.bloodType || "Not recorded" },
      { label: "Physician", value: info.primaryPhysician || "Not recorded" },
      { label: "Pharmacy", value: info.pharmacy || "Not recorded" },
      { label: "Hospital", value: info.hospitalPreference || "Not recorded" },
      { label: "Mobility", value: optionLabel(SENIOR_MOBILITY, prefs.mobility) },
      { label: "Diet", value: optionLabel(SENIOR_DIETS, prefs.diet) },
      {
        label: "Emergency",
        value: emergency ? `${emergency.name} · ${emergency.relationship}` : "No emergency contact yet",
      },
    ],
  };
}

function buildNotes(senior, activities, now) {
  const pinned = [];
  const medical = senior?.importantInfo?.medicalNotes;
  const support = senior?.carePreferences?.notes;

  if (medical) {
    pinned.push({
      id: "record-medical",
      type: "Record",
      title: "Medical notes",
      body: medical,
      actor: senior.importantInfo.primaryPhysician || "Care record",
      when: "On the profile",
      pinned: true,
    });
  }
  if (support) {
    pinned.push({
      id: "record-support",
      type: "Support",
      title: "How to help",
      body: support,
      actor: "Household",
      when: "On the profile",
      pinned: true,
    });
  }

  const fromActivities = activities
    .filter((item) => item.type === ACTIVITY_TYPES.CLINICAL || item.type === ACTIVITY_TYPES.CARE)
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      type: NOTE_TYPE_LABEL[item.kind] || NOTE_TYPE_LABEL[item.type] ?? item.type,
      title: item.title,
      body: item.body,
      actor: item.actor,
      when: formatWhen(item.occurredAt || item.createdAt, now),
      pinned: false,
    }));

  return [...pinned, ...fromActivities];
}

function mapVisitAppointment(visit, now) {
  const date = new Date(`${visit.date}T12:00:00`);
  const delta = Number.isNaN(date.getTime()) ? 0 : (date.getDay() - now.getDay() + 7) % 7;
  const when = delta === 0 ? "Today" : delta === 1 ? "Tomorrow" : weekdayLabel(date.getDay(), { long: true });
  return {
    id: visit.id,
    title: visit.title,
    type: "appointment",
    typeLabel: visitStatusLabel(visit.status),
    badge: visitStatusBadge(visit.status),
    time: formatTime(visit.startTime),
    assignee: visit.caregiverName,
    notes: visit.notes.at(-1)?.body || "",
    when,
    meta: `${visit.seniorName} · ${formatDateLabel(visit.date)} · ${formatRange(visit.startTime, visit.endTime)}`,
    sortKey: `${visit.date}-${visit.startTime}`,
    visitId: visit.id,
    visitStatus: visit.status,
  };
}

function mapRecordAppointment(item) {
  return {
    id: item.id,
    title: item.title,
    type: "appointment",
    typeLabel: item.statusLabel,
    badge: item.badge,
    time: item.time,
    assignee: item.practitionerName || item.location || "Household",
    notes: item.notes || "",
    when: item.when,
    meta: item.meta,
    sortKey: item.sortKey,
    visitId: "",
    visitStatus: "",
  };
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function mapAppointmentRequest(visit) {
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

function mapWeekEvent(event, session, member) {
  return {
    id: event.id,
    title: event.title,
    time: formatTime(event.time),
    endTime: event.endTime ? formatTime(event.endTime) : "",
    assignee: event.assignee,
    type: event.type,
    typeLabel: TYPE_LABEL[event.type] ?? "Visit",
    notes: event.notes || "",
    mine: assignedTo(event, session, member),
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

function isClinicalEvent(event) {
  return event.type === "appointment" || event.type === "meds";
}

function assignedTo(event, session, member) {
  const assignee = String(event.assignee || "").trim().toLowerCase();
  if (!assignee) return false;
  const candidates = [session?.displayName, member?.name]
    .filter(Boolean)
    .flatMap((name) => {
      const full = String(name).trim().toLowerCase();
      const stripped = full.replace(/^dr\.?\s+/, "");
      const parts = stripped.split(/\s+/).filter(Boolean);
      return [full, stripped, parts[0], parts.at(-1)].filter(Boolean);
    });
  return candidates.some((name) => (
    name.length > 1 && (assignee === name || assignee.includes(name) || name.includes(assignee))
  ));
}

function findSelf(circle, session) {
  const email = String(session?.email || "").trim().toLowerCase();
  return circle.find((member) => (
    (session?.id && member.userId === session.id)
    || (email && String(member.email || "").trim().toLowerCase() === email)
  )) ?? null;
}

function bySoonest(now) {
  return (a, b) => {
    const aDelta = (a.weekday - now.getDay() + 7) % 7;
    const bDelta = (b.weekday - now.getDay() + 7) % 7;
    return aDelta - bDelta || String(a.time).localeCompare(String(b.time));
  };
}

function joinList(items) {
  return items?.length ? items.join(", ") : "None listed";
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
