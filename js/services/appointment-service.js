import {
  AUTH,
  ACTIVITY_TYPES,
  CARE_HISTORY_KINDS,
  APPOINTMENT_REMINDER,
  APPOINTMENT_STATUS,
  CIRCLE_STATUS,
  NOTIFICATION_TYPES,
} from "../config/constants.js";
import {
  appointmentMeta,
  appointmentReminderAt,
  appointmentStatusBadge,
  appointmentStatusLabel,
  appointmentWhenLabel,
  canActOnAppointment,
  canManageAppointments,
  isAssociatedPractitioner,
  isOpenAppointment,
  liveAppointmentStatus,
  monthGrid,
  practitionerOptions,
  reminderLabel,
  yearMonthOf,
} from "../config/appointment.js";
import { createAppointment } from "../models/appointment.js";
import { createScheduleEvent } from "../models/schedule-event.js";
import { mockAppointments } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { getQueryDocs } from "../core/query.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSession } from "../auth/session.js";
import { getSeniorForUser } from "./senior-service.js";
import { listCareCircle } from "./care-circle-service.js";
import { postActivity } from "./activity-service.js";
import { notifyQuietly } from "./notification-service.js";
import { weekdayFromIso, todayIso } from "../scheduling/time.js";

const APPOINTMENTS_KEY = "appointments";

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function appointmentFrom(data) {
  return createAppointment({
    ...data,
    reminderSent: Boolean(data.reminderSent),
    reminderAt: toIso(data.reminderAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    cancelledAt: toIso(data.cancelledAt),
  });
}

function toDoc(record) {
  const { id: _id, ...rest } = record;
  return rest;
}

function seedMap(key, records) {
  const map = storage.get(key, null) ?? {};
  let changed = false;
  for (const record of records) {
    if (!map[record.id]) {
      map[record.id] = record;
      changed = true;
    }
  }
  if (changed) storage.set(key, map);
  return map;
}

function seedLocal() {
  seedMap(APPOINTMENTS_KEY, mockAppointments);
}

function readLocalMap(key) {
  seedLocal();
  return storage.get(key, {}) ?? {};
}

function writeLocalRecord(key, record) {
  const map = readLocalMap(key);
  map[record.id] = record;
  storage.set(key, map);
  return record;
}

function localAppointments(filter = {}) {
  return Object.values(readLocalMap(APPOINTMENTS_KEY))
    .map((item) => appointmentFrom(item))
    .filter((item) => matchesFilter(item, filter));
}

function matchesFilter(item, { seniorId, practitioner } = {}) {
  if (seniorId && item.seniorId !== seniorId) return false;
  if (practitioner && !matchesPractitioner(item, practitioner)) return false;
  return true;
}

function matchesPractitioner(item, practitioner) {
  if (!practitioner) return true;
  if (practitioner.id && item.practitionerId === practitioner.id) return true;
  if (practitioner.userId && item.practitionerUserId === practitioner.userId) return true;
  if (practitioner.email && emailsEqual(item.practitionerEmail, practitioner.email)) return true;
  return false;
}

async function collectionDocs(collection, constraints = [], options = {}) {
  return getQueryDocs(collection, constraints, { limit: QUERY_LIMITS.WORKSPACE, ...options });
}

async function readAppointments(filter = {}) {
  if (!usesLiveAuth()) return localAppointments(filter);
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  else if (filter.practitioner?.userId) {
    constraints.push(sdk.where("practitionerUserId", "==", filter.practitioner.userId));
  } else if (filter.practitioner?.email) {
    constraints.push(sdk.where("practitionerEmail", "==", String(filter.practitioner.email).trim().toLowerCase()));
  }
  const docs = await collectionDocs(AUTH.APPOINTMENTS_COLLECTION, constraints);
  return docs
    .map((item) => appointmentFrom(item))
    .filter((item) => matchesFilter(item, filter));
}

async function readAppointmentById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) return localAppointments().find((item) => item.id === id) ?? null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.APPOINTMENTS_COLLECTION, id));
  if (!snap.exists()) return null;
  return appointmentFrom({ id: snap.id, ...snap.data() });
}

async function saveAppointmentRecord(appointment) {
  const record = appointmentFrom({ ...appointment, updatedAt: nowIso() });
  if (!usesLiveAuth()) return appointmentFrom(writeLocalRecord(APPOINTMENTS_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.APPOINTMENTS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.APPOINTMENTS_COLLECTION));
  const payload = toDoc({
    ...record,
    id: ref.id,
    practitionerEmail: String(record.practitionerEmail || "").trim().toLowerCase(),
  });
  const data = { ...payload, updatedAt: sdk.serverTimestamp() };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return appointmentFrom({ ...record, id: ref.id });
}

function findActor(members, session, senior) {
  if (!session) return null;
  return members.find((member) => (
    member.status !== CIRCLE_STATUS.REMOVED
    && (member.userId === session.id || emailsEqual(member.email, session.email))
  )) ?? (senior?.ownerId === session.id
    ? members.find((member) => member.role === "owner")
    : null);
}

function applyPractitioner(appointment, practitionerId, members) {
  if (!practitionerId) {
    return {
      ...appointment,
      practitionerId: "",
      practitionerUserId: "",
      practitionerEmail: "",
      practitionerName: "",
    };
  }
  const member = members.find((item) => item.id === practitionerId);
  if (!member) {
    throw new Error("Choose a practitioner on this circle, or leave the clinician unassigned.");
  }
  return {
    ...appointment,
    practitionerId: member.id,
    practitionerUserId: member.userId || "",
    practitionerEmail: member.email || "",
    practitionerName: member.name,
  };
}

function normalizeInput(input = {}, existing = null) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("Give this appointment a name.");
  const date = String(input.date ?? existing?.date ?? "").trim();
  if (!date) throw new Error("Set a date for this appointment.");
  const time = String(input.time ?? existing?.time ?? "").trim();
  if (!time) throw new Error("Set a time for this appointment.");
  const endTime = String(input.endTime ?? existing?.endTime ?? "").trim();
  if (endTime && endTime <= time) {
    throw new Error("The end time needs to be after the start time.");
  }
  const reminder = Object.values(APPOINTMENT_REMINDER).includes(input.reminder)
    ? input.reminder
    : (existing?.reminder ?? APPOINTMENT_REMINDER.DAY_1);
  const requestedStatus = Object.values(APPOINTMENT_STATUS).includes(input.status)
    ? input.status
    : (existing?.status ?? APPOINTMENT_STATUS.SCHEDULED);
  const status = requestedStatus === APPOINTMENT_STATUS.CANCELLED
    ? APPOINTMENT_STATUS.CANCELLED
    : (requestedStatus === APPOINTMENT_STATUS.COMPLETED
      ? APPOINTMENT_STATUS.COMPLETED
      : (requestedStatus === APPOINTMENT_STATUS.CONFIRMED
        ? APPOINTMENT_STATUS.CONFIRMED
        : APPOINTMENT_STATUS.SCHEDULED));
  const reminderAt = appointmentReminderAt(date, time, reminder);
  const reminderChanged = reminder !== existing?.reminder
    || date !== existing?.date
    || time !== existing?.time;
  return {
    title,
    date,
    time,
    endTime,
    location: String(input.location ?? existing?.location ?? "").trim(),
    notes: String(input.notes ?? existing?.notes ?? "").trim(),
    reminder,
    reminderAt,
    reminderSent: reminderChanged ? false : Boolean(existing?.reminderSent),
    status,
  };
}

async function loadContext(session = getSession()) {
  if (!session) throw new Error("Sign in to manage appointments.");
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("A senior record is needed before an appointment can be saved.");
  const members = await listCareCircle(senior.id);
  const actor = findActor(members, session, senior);
  return { session, senior, members, actor };
}

function assertCanManage(ctx) {
  if (!canManageAppointments(ctx.session, ctx.actor, ctx.senior)) {
    throw new Error("You need permission to change appointments.");
  }
}

function assertCanAct(ctx, appointment) {
  if (!canActOnAppointment(appointment, ctx.session, ctx.actor, ctx.senior)) {
    throw new Error("You can only update appointments assigned to you.");
  }
}

function mapAppointmentView(appointment, { now, session, actor, senior, canManage } = {}) {
  const liveStatus = liveAppointmentStatus(appointment, now);
  const open = isOpenAppointment(appointment, now);
  const associated = isAssociatedPractitioner(appointment, session);
  const canAct = canActOnAppointment(appointment, session, actor, senior);
  return {
    ...appointment,
    liveStatus,
    statusLabel: appointmentStatusLabel(liveStatus),
    badge: appointmentStatusBadge(liveStatus),
    when: appointmentWhenLabel(appointment, now),
    meta: appointmentMeta(appointment, now),
    reminderLabel: reminderLabel(appointment.reminder),
    practitionerLabel: appointment.practitionerName || "No clinician linked",
    assignee: appointment.practitionerName || appointment.location || "Household",
    canEdit: Boolean(canManage) && liveStatus !== APPOINTMENT_STATUS.CANCELLED && liveStatus !== APPOINTMENT_STATUS.COMPLETED,
    canCancel: Boolean(canManage) && open,
    canConfirm: Boolean(canAct) && liveStatus === APPOINTMENT_STATUS.SCHEDULED,
    canComplete: Boolean(canAct) && (open || liveStatus === APPOINTMENT_STATUS.MISSED),
    isAssociated: associated,
    sortKey: `${appointment.date || "9999"}-${appointment.time || "99:99"}`,
  };
}

function bySoonest(a, b) {
  return String(a.sortKey || `${a.date}-${a.time}`).localeCompare(String(b.sortKey || `${b.date}-${b.time}`))
    || String(a.title).localeCompare(String(b.title));
}

async function logAppointmentActivity(title, body, session, extra = {}) {
  try {
    await postActivity({
      type: extra.type || ACTIVITY_TYPES.SCHEDULE,
      kind: extra.kind || CARE_HISTORY_KINDS.APPOINTMENT,
      title,
      body,
      seniorId: extra.seniorId,
      source: extra.source || "activity",
      sourceId: extra.sourceId || "",
      relatedId: extra.relatedId || "",
      occurredAt: extra.occurredAt,
    }, session);
  } catch {
    // History is helpful, not required to save the appointment.
  }
}

export function appointmentToEvent(appointment, now = new Date()) {
  const liveStatus = liveAppointmentStatus(appointment, now);
  return createScheduleEvent({
    id: appointment.id,
    title: appointment.title,
    weekday: weekdayFromIso(appointment.date),
    time: appointment.time,
    type: "appointment",
    assignee: appointment.practitionerName || appointment.location || "Household",
    status: liveStatus === APPOINTMENT_STATUS.COMPLETED
      ? "completed"
      : (liveStatus === APPOINTMENT_STATUS.MISSED ? "missed" : "scheduled"),
    notes: appointment.notes || appointment.location || "",
    date: appointment.date,
    endTime: appointment.endTime,
    seniorId: appointment.seniorId,
    practitionerId: appointment.practitionerId,
    practitionerUserId: appointment.practitionerUserId,
    practitionerEmail: appointment.practitionerEmail,
    appointmentStatus: liveStatus,
  });
}

export async function listAppointments(filter = {}) {
  return (await readAppointments(filter)).sort(bySoonest);
}

export async function listAppointmentEvents(filter = {}, now = new Date()) {
  return (await readAppointments(filter))
    .filter((item) => liveAppointmentStatus(item, now) !== APPOINTMENT_STATUS.CANCELLED)
    .map((item) => appointmentToEvent(item, now));
}

export async function getAppointmentWorkspace(senior, session = getSession(), now = new Date(), extras = {}) {
  const seniorId = senior?.id || session?.seniorId;
  const yearMonth = extras.yearMonth || yearMonthOf(now);
  const selectedDay = extras.selectedDay || todayIso(now);
  if (!seniorId) {
    return {
      appointments: [],
      upcoming: [],
      today: [],
      past: [],
      cancelled: [],
      reminders: [],
      practitioners: [],
      canManage: false,
      calendar: monthGrid(yearMonth, [], selectedDay, now),
      selectedDay,
      counts: { upcoming: 0, today: 0, cancelled: 0, reminders: 0 },
    };
  }

  const members = await listCareCircle(seniorId);
  const actor = findActor(members, session, senior);
  const canManage = canManageAppointments(session, actor, senior);
  const records = await readAppointments({ seniorId });
  await dispatchDueAppointmentReminders(records, now);
  const latest = await readAppointments({ seniorId });
  const mapped = latest
    .map((item) => mapAppointmentView(item, { now, session, actor, senior, canManage }))
    .sort(bySoonest);
  const today = todayIso(now);
  const upcoming = mapped.filter((item) => (
    (item.liveStatus === APPOINTMENT_STATUS.SCHEDULED || item.liveStatus === APPOINTMENT_STATUS.CONFIRMED)
    && item.date >= today
  ));
  const todayItems = mapped.filter((item) => item.date === today && item.liveStatus !== APPOINTMENT_STATUS.CANCELLED);
  const past = mapped.filter((item) => (
    item.liveStatus === APPOINTMENT_STATUS.COMPLETED
    || item.liveStatus === APPOINTMENT_STATUS.MISSED
    || (item.date < today && item.liveStatus !== APPOINTMENT_STATUS.CANCELLED)
  ));
  const cancelled = mapped.filter((item) => item.liveStatus === APPOINTMENT_STATUS.CANCELLED);
  const reminders = upcoming.filter((item) => item.reminder && item.reminder !== APPOINTMENT_REMINDER.NONE);

  return {
    appointments: mapped,
    upcoming,
    today: todayItems,
    past: past.sort((a, b) => bySoonest(b, a)),
    cancelled,
    reminders,
    practitioners: practitionerOptions(members),
    canManage,
    calendar: monthGrid(yearMonth, mapped, selectedDay, now),
    selectedDay,
    counts: {
      upcoming: upcoming.length,
      today: todayItems.length,
      cancelled: cancelled.length,
      reminders: reminders.length,
    },
  };
}

export async function saveAppointment(input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  assertCanManage(ctx);
  const existing = input.id || input.appointmentId
    ? await readAppointmentById(input.id || input.appointmentId)
    : null;
  if (existing && existing.seniorId !== ctx.senior.id) {
    throw new Error("That appointment could not be found.");
  }
  if (existing && existing.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new Error("A cancelled appointment cannot be edited. Create a new one instead.");
  }
  const patch = normalizeInput(input, existing);
  const withPractitioner = applyPractitioner({
    ...(existing ?? createAppointment({
      id: usesLiveAuth() ? "" : newId("appt"),
      seniorId: ctx.senior.id,
      createdBy: ctx.session.id,
      createdByName: ctx.session.displayName || "",
      createdAt: nowIso(),
    })),
    ...patch,
    seniorId: ctx.senior.id,
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
    cancelledAt: existing?.cancelledAt ?? null,
    cancelledBy: existing?.cancelledBy ?? "",
    cancelledByName: existing?.cancelledByName ?? "",
    cancelReason: existing?.cancelReason ?? "",
  }, input.practitionerId ?? existing?.practitionerId, ctx.members);

  const saved = await saveAppointmentRecord(withPractitioner);
  const name = ctx.senior.preferredName || ctx.senior.displayName;
  await logAppointmentActivity(
    existing ? "Appointment updated" : "Appointment created",
    `${saved.title} for ${name} · ${appointmentWhenLabel(saved)}${saved.practitionerName ? ` · ${saved.practitionerName}` : ""}.`,
    ctx.session,
    {
      seniorId: ctx.senior.id,
      source: "appointment",
      sourceId: `${saved.id}:${existing ? "updated" : "created"}`,
      relatedId: saved.id,
    },
  );
  return saved;
}

export async function cancelAppointment(appointmentId, reason = "", session = getSession()) {
  const ctx = await loadContext(session);
  const existing = await readAppointmentById(appointmentId);
  if (!existing || existing.seniorId !== ctx.senior.id) {
    throw new Error("That appointment could not be found.");
  }
  assertCanManage(ctx);
  if (existing.status === APPOINTMENT_STATUS.CANCELLED) return existing;
  if (existing.status === APPOINTMENT_STATUS.COMPLETED) {
    throw new Error("A completed appointment cannot be cancelled.");
  }
  const saved = await saveAppointmentRecord({
    ...existing,
    status: APPOINTMENT_STATUS.CANCELLED,
    reminderSent: true,
    cancelledAt: nowIso(),
    cancelledBy: ctx.session.id,
    cancelledByName: ctx.session.displayName || "",
    cancelReason: String(reason || "").trim(),
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  });
  const name = ctx.senior.preferredName || ctx.senior.displayName;
  await logAppointmentActivity(
    "Appointment cancelled",
    `${saved.title} for ${name} was cancelled${saved.cancelReason ? ` · ${saved.cancelReason}` : ""}.`,
    ctx.session,
    {
      seniorId: ctx.senior.id,
      source: "appointment",
      sourceId: `${saved.id}:cancelled`,
      relatedId: saved.id,
      occurredAt: saved.cancelledAt,
    },
  );
  try {
    await notifyQuietly([
      ...ctx.members,
      { userId: saved.practitionerUserId, email: saved.practitionerEmail },
    ], {
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGED,
      title: `${saved.title} cancelled`,
      body: `${name}’s appointment was cancelled${saved.cancelReason ? `: ${saved.cancelReason}` : "."}`,
      seniorId: ctx.senior.id,
      appointmentId: saved.id,
    }, ctx.session);
  } catch {
    // The cancellation still stands if the notice cannot be stored.
  }
  return saved;
}

export async function updateAppointmentStatus(appointmentId, status, session = getSession()) {
  const ctx = await loadContext(session);
  const existing = await readAppointmentById(appointmentId);
  if (!existing || existing.seniorId !== ctx.senior.id) {
    throw new Error("That appointment could not be found.");
  }
  assertCanAct(ctx, existing);
  if (!Object.values(APPOINTMENT_STATUS).includes(status)) {
    throw new Error("Choose a valid appointment status.");
  }
  if (status === APPOINTMENT_STATUS.CANCELLED) {
    return cancelAppointment(appointmentId, "", session);
  }
  if (existing.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new Error("A cancelled appointment cannot change status.");
  }
  const saved = await saveAppointmentRecord({
    ...existing,
    status,
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  });
  const label = appointmentStatusLabel(status).toLowerCase();
  await logAppointmentActivity(
    `Appointment ${label}`,
    `${saved.title} is now ${label}.`,
    ctx.session,
    {
      seniorId: ctx.senior.id,
      source: "appointment",
      sourceId: `${saved.id}:${status}`,
      relatedId: saved.id,
    },
  );
  return saved;
}

export async function dispatchDueAppointmentReminders(records, now = new Date()) {
  const due = (records || await readAppointments()).filter((item) => {
    if (item.reminderSent) return false;
    if (!item.reminderAt) return false;
    if (item.status === APPOINTMENT_STATUS.CANCELLED) return false;
    if (item.status === APPOINTMENT_STATUS.COMPLETED) return false;
    return String(item.reminderAt) <= now.toISOString();
  });

  for (const item of due) {
    try {
      const members = item.seniorId ? await listCareCircle(item.seniorId) : [];
      await notifyQuietly([
        ...members,
        { userId: item.practitionerUserId, email: item.practitionerEmail },
      ], {
        type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER,
        title: `Reminder · ${item.title}`,
        body: `${appointmentWhenLabel(item, now)}${item.location ? ` · ${item.location}` : ""}${item.practitionerName ? ` · ${item.practitionerName}` : ""}`,
        seniorId: item.seniorId,
        appointmentId: item.id,
      });
      await saveAppointmentRecord({ ...item, reminderSent: true });
    } catch {
      // Keep trying on the next load if a reminder cannot be stored.
    }
  }
}

export { canActOnAppointment, canManageAppointments };
