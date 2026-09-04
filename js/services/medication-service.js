import {
  AUTH,
  ACTIVITY_TYPES,
  CARE_HISTORY_KINDS,
  CIRCLE_STATUS,
  MEDICATION_DOSE_OUTCOME,
  MEDICATION_FREQUENCY,
  MEDICATION_REMINDER,
  MEDICATION_STATUS,
  NOTIFICATION_TYPES,
} from "../config/constants.js";
import { CirclePlanError } from "../config/care-circle.js";
import { canUseMedication, householdContext } from "./entitlement-service.js";
import {
  MEDICATION_PLUS_MESSAGE,
  canLogMedicationDose,
  canManageMedications,
  clinicianOptions,
  doseOutcomeBadge,
  doseOutcomeLabel,
  doseSlotKey,
  doseTimes,
  dueSlots,
  isOpenMedication,
  liveDoseOutcome,
  liveMedicationStatus,
  medicationFrequencyLabel,
  medicationMeta,
  medicationReminderAt,
  medicationReminderLabel,
  medicationStatusBadge,
  medicationStatusLabel,
  nextDoseAt,
  occursOnDate,
  responsibleOptions,
  scheduleLabel,
  windowLabel,
} from "../config/medication.js";
import { createMedication, createMedicationDose } from "../models/medication.js";
import { createScheduleEvent } from "../models/schedule-event.js";
import { mockMedicationDoses, mockMedications } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { getQueryDocs } from "../core/query.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSession } from "../auth/session.js";
import { getSeniorForUser, updateSeniorProfile } from "./senior-service.js";
import { listCareCircle } from "./care-circle-service.js";
import { postActivity } from "./activity-service.js";
import { notifyQuietly } from "./notification-service.js";
import { formatTime, formatWhen, todayIso } from "../scheduling/time.js";
import { weekDays } from "../scheduling/calendar.js";

const MEDICATIONS_KEY = "medications";
const DOSES_KEY = "medicationDoses";

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

function medicationFrom(data) {
  return createMedication({
    ...data,
    reminderSent: Boolean(data.reminderSent),
    reminderAt: toIso(data.reminderAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    endedAt: toIso(data.endedAt),
    weekday: data.weekday == null || data.weekday === "" ? null : Number(data.weekday),
  });
}

function doseFrom(data) {
  return createMedicationDose({
    ...data,
    recordedAt: toIso(data.recordedAt),
    slotKey: data.slotKey || doseSlotKey(data.date, data.time),
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
  seedMap(MEDICATIONS_KEY, mockMedications);
  seedMap(DOSES_KEY, mockMedicationDoses);
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

function localMedications(filter = {}) {
  return Object.values(readLocalMap(MEDICATIONS_KEY))
    .map((item) => medicationFrom(item))
    .filter((item) => !filter.seniorId || item.seniorId === filter.seniorId);
}

function localDoses(filter = {}) {
  return Object.values(readLocalMap(DOSES_KEY))
    .map((item) => doseFrom(item))
    .filter((item) => {
      if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
      if (filter.medicationId && item.medicationId !== filter.medicationId) return false;
      return true;
    });
}

async function collectionDocs(collection, constraints = [], options = {}) {
  return getQueryDocs(collection, constraints, { limit: QUERY_LIMITS.WORKSPACE, ...options });
}

async function readMedications(filter = {}) {
  if (!usesLiveAuth()) return localMedications(filter);
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  const docs = await collectionDocs(AUTH.MEDICATIONS_COLLECTION, constraints);
  return docs.map((item) => medicationFrom(item));
}

async function readDoses(filter = {}) {
  if (!usesLiveAuth()) return localDoses(filter);
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.medicationId) constraints.push(sdk.where("medicationId", "==", filter.medicationId));
  else if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  const docs = await collectionDocs(AUTH.MEDICATION_DOSES_COLLECTION, constraints);
  return docs
    .map((item) => doseFrom(item))
    .filter((item) => {
      if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
      if (filter.medicationId && item.medicationId !== filter.medicationId) return false;
      return true;
    });
}

async function readMedicationById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) return localMedications().find((item) => item.id === id) ?? null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.MEDICATIONS_COLLECTION, id));
  if (!snap.exists()) return null;
  return medicationFrom({ id: snap.id, ...snap.data() });
}

async function saveMedicationRecord(medication) {
  const record = medicationFrom({ ...medication, updatedAt: nowIso() });
  if (!usesLiveAuth()) return medicationFrom(writeLocalRecord(MEDICATIONS_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.MEDICATIONS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.MEDICATIONS_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = { ...payload, updatedAt: sdk.serverTimestamp() };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return medicationFrom({ ...record, id: ref.id });
}

async function saveDoseRecord(dose) {
  const record = doseFrom({ ...dose, recordedAt: dose.recordedAt || nowIso() });
  if (!usesLiveAuth()) return doseFrom(writeLocalRecord(DOSES_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.MEDICATION_DOSES_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.MEDICATION_DOSES_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = { ...payload };
  if (!payload.recordedAt) data.recordedAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return doseFrom({ ...record, id: ref.id });
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

function applyMember(fields, memberId, members, prefix) {
  if (!memberId) {
    return {
      [`${prefix}Id`]: "",
      [`${prefix}UserId`]: "",
      [`${prefix}Email`]: "",
      [`${prefix}Name`]: "",
    };
  }
  const member = members.find((item) => item.id === memberId);
  if (!member) {
    throw new Error(prefix === "clinician"
      ? "Choose a practitioner on this circle, or leave the clinician unassigned."
      : "Choose someone on this circle, or leave coverage unassigned.");
  }
  return {
    [`${prefix}Id`]: member.id,
    [`${prefix}UserId`]: member.userId || "",
    [`${prefix}Email`]: member.email || "",
    [`${prefix}Name`]: member.name,
  };
}

function normalizeInput(input = {}, existing = null) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Give this medication a name.");
  const dosage = String(input.dosage ?? existing?.dosage ?? "").trim();
  if (!dosage) throw new Error("Add the dosage the circle is coordinating — for example 10mg or 1 tablet.");
  const frequency = Object.values(MEDICATION_FREQUENCY).includes(input.frequency)
    ? input.frequency
    : (existing?.frequency ?? MEDICATION_FREQUENCY.DAILY);
  const startDate = String(input.startDate ?? existing?.startDate ?? "").trim();
  if (!startDate && frequency !== MEDICATION_FREQUENCY.AS_NEEDED) {
    throw new Error("Set a start date so the circle knows when this list item begins.");
  }
  const endDate = String(input.endDate ?? existing?.endDate ?? "").trim();
  if (endDate && startDate && endDate < startDate) {
    throw new Error("The end date needs to be on or after the start date.");
  }
  const reminder = Object.values(MEDICATION_REMINDER).includes(input.reminder)
    ? input.reminder
    : (existing?.reminder ?? MEDICATION_REMINDER.MINUTES_15);
  const requestedStatus = Object.values(MEDICATION_STATUS).includes(input.status)
    ? input.status
    : (existing?.status ?? MEDICATION_STATUS.ACTIVE);
  const time = String(input.time ?? existing?.time ?? "").trim();
  const secondTime = String(input.secondTime ?? existing?.secondTime ?? "").trim();
  const thirdTime = String(input.thirdTime ?? existing?.thirdTime ?? "").trim();
  if (frequency !== MEDICATION_FREQUENCY.AS_NEEDED && !time) {
    throw new Error("Set a time so reminders and the day’s list have something to follow.");
  }
  const weekday = frequency === MEDICATION_FREQUENCY.WEEKLY
    ? Number(input.weekday ?? existing?.weekday ?? new Date().getDay())
    : null;
  const draft = {
    name,
    dosage,
    frequency,
    time,
    secondTime: frequency === MEDICATION_FREQUENCY.TWICE_DAILY || frequency === MEDICATION_FREQUENCY.THREE_TIMES
      ? secondTime
      : "",
    thirdTime: frequency === MEDICATION_FREQUENCY.THREE_TIMES ? thirdTime : "",
    weekday: Number.isInteger(weekday) ? weekday : null,
    startDate,
    endDate,
    reminder,
    notes: String(input.notes ?? existing?.notes ?? "").trim(),
    status: requestedStatus === MEDICATION_STATUS.PAUSED
      ? MEDICATION_STATUS.PAUSED
      : (requestedStatus === MEDICATION_STATUS.ENDED ? MEDICATION_STATUS.ENDED : MEDICATION_STATUS.ACTIVE),
  };
  const reminderAt = medicationReminderAt(draft);
  const reminderChanged = reminder !== existing?.reminder
    || time !== existing?.time
    || secondTime !== existing?.secondTime
    || thirdTime !== existing?.thirdTime
    || frequency !== existing?.frequency
    || startDate !== existing?.startDate
    || endDate !== existing?.endDate
    || String(weekday) !== String(existing?.weekday);
  return {
    ...draft,
    reminderAt,
    reminderSent: reminderChanged ? false : Boolean(existing?.reminderSent),
  };
}

async function loadContext(session = getSession()) {
  if (!session) throw new Error("Sign in to manage medications.");
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("A senior record is needed before a medication can be saved.");
  const members = await listCareCircle(senior.id);
  const actor = findActor(members, session, senior);
  const household = await householdContext({ session, senior, members });
  return { session, senior, members, actor, ...household };
}

function assertCanManage(ctx) {
  if (!canManageMedications(ctx.session, ctx.actor, ctx.senior)) {
    throw new Error("You need permission to change the medication list.");
  }
}

function assertPlus(ctx) {
  if (canUseMedication(ctx)) return;
  throw new CirclePlanError(MEDICATION_PLUS_MESSAGE, { code: "plus", upgrade: true });
}

function assertCanLog(ctx, medication) {
  if (!canLogMedicationDose(medication, ctx.session, ctx.actor)) {
    throw new Error("You can log what the circle covered, not change the list.");
  }
}

function logsBySlot(doses, medicationId) {
  const map = new Map();
  for (const dose of doses) {
    if (dose.medicationId !== medicationId) continue;
    map.set(dose.slotKey || doseSlotKey(dose.date, dose.time), dose);
  }
  return map;
}

function mapDoseView(dose, now = new Date()) {
  return {
    ...dose,
    outcomeLabel: doseOutcomeLabel(dose.outcome),
    badge: doseOutcomeBadge(dose.outcome),
    when: dose.recordedAt ? formatWhen(dose.recordedAt, now) : [dose.date, formatTime(dose.time)].filter(Boolean).join(" · "),
    timeLabel: formatTime(dose.time) || "As needed",
    sortKey: `${dose.date || ""}-${dose.time || ""}-${dose.recordedAt || ""}`,
  };
}

function mapMedicationView(medication, { now, session, actor, senior, canManage, doses = [] } = {}) {
  const liveStatus = liveMedicationStatus(medication, now);
  const open = liveStatus === MEDICATION_STATUS.ACTIVE;
  const logs = logsBySlot(doses, medication.id);
  const slots = dueSlots(medication, now).map((slot) => {
    const log = logs.get(slot.key);
    const outcome = liveDoseOutcome(slot, log, now);
    return {
      ...slot,
      timeLabel: formatTime(slot.time),
      outcome,
      outcomeLabel: outcome ? doseOutcomeLabel(outcome) : "Due",
      badge: outcome ? doseOutcomeBadge(outcome) : "badge--brand",
      log,
      canLog: open && canLogMedicationDose(medication, session, actor) && outcome !== MEDICATION_DOSE_OUTCOME.TAKEN && outcome !== MEDICATION_DOSE_OUTCOME.SKIPPED,
    };
  });
  const dueOpen = slots.filter((slot) => !slot.outcome || slot.outcome === MEDICATION_DOSE_OUTCOME.MISSED);
  const history = doses
    .filter((item) => item.medicationId === medication.id)
    .map((item) => mapDoseView(item, now))
    .sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));

  return {
    ...medication,
    liveStatus,
    statusLabel: medicationStatusLabel(liveStatus),
    badge: medicationStatusBadge(liveStatus),
    frequencyLabel: medicationFrequencyLabel(medication.frequency),
    reminderLabel: medicationReminderLabel(medication.reminder),
    scheduleLabel: scheduleLabel(medication),
    windowLabel: windowLabel(medication),
    meta: medicationMeta(medication),
    responsibleLabel: medication.responsibleName || "Household covering",
    clinicianLabel: medication.clinicianName || "",
    slots,
    dueOpen,
    history,
    lastLogged: history[0] || null,
    canEdit: Boolean(canManage) && liveStatus !== MEDICATION_STATUS.ENDED,
    canPause: Boolean(canManage) && open,
    canResume: Boolean(canManage) && liveStatus === MEDICATION_STATUS.PAUSED,
    canEnd: Boolean(canManage) && liveStatus !== MEDICATION_STATUS.ENDED,
    canLog: open && canLogMedicationDose(medication, session, actor),
    nextDose: nextDoseAt(medication, now),
    sortKey: `${medication.name || ""}-${medication.time || ""}`,
  };
}

function byName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""))
    || String(a.time || "").localeCompare(String(b.time || ""));
}

async function logMedicationActivity(title, body, session, extra = {}) {
  try {
    await postActivity({
      type: extra.type || ACTIVITY_TYPES.CARE,
      kind: extra.kind || CARE_HISTORY_KINDS.MEDICATION,
      title,
      body,
      seniorId: extra.seniorId,
      source: extra.source || "activity",
      sourceId: extra.sourceId || "",
      relatedId: extra.relatedId || "",
      occurredAt: extra.occurredAt,
    }, session);
  } catch {
    // History is helpful, not required to save the medication.
  }
}

async function syncSeniorMedicationNames(senior, records) {
  if (!senior?.id) return;
  const names = records
    .filter((item) => liveMedicationStatus(item) === MEDICATION_STATUS.ACTIVE)
    .map((item) => [item.name, item.dosage].filter(Boolean).join(" ").trim())
    .filter(Boolean);
  const current = (senior.medications || []).map((item) => String(item).trim()).filter(Boolean);
  if (names.join("|") === current.join("|")) return;
  try {
    await updateSeniorProfile(senior.id, { medications: names });
  } catch {
    // The structured list is the source of truth even if the profile snapshot cannot update.
  }
}

export function medicationToEvents(medication, now = new Date()) {
  if (!isOpenMedication(medication, now)) return [];
  const days = weekDays(now);
  const events = [];
  for (const day of days) {
    if (!occursOnDate(medication, day.date)) continue;
    for (const time of doseTimes(medication)) {
      events.push(createScheduleEvent({
        id: `${medication.id}-${day.date}-${time}`,
        title: `${medication.name} ${medication.dosage}`.trim(),
        weekday: day.weekday,
        time,
        type: "meds",
        assignee: medication.responsibleName || "Household",
        status: "scheduled",
        notes: medication.notes || "",
        date: day.date,
        seniorId: medication.seniorId,
      }));
    }
  }
  return events;
}

export async function listMedications(filter = {}) {
  return (await readMedications(filter)).sort(byName);
}

export async function listMedicationDoses(filter = {}) {
  return (await readDoses(filter)).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
}

export async function listMedicationEvents(filter = {}, now = new Date()) {
  const records = await readMedications(filter);
  return records.flatMap((item) => medicationToEvents(item, now));
}

export async function getMedicationWorkspace(senior, session = getSession(), now = new Date()) {
  const seniorId = senior?.id || session?.seniorId;
  const empty = {
    isPlus: canUseMedication({ session, senior }),
    canManage: false,
    canLog: false,
    medications: [],
    active: [],
    dueToday: [],
    reminders: [],
    paused: [],
    ended: [],
    history: [],
    assignees: [],
    clinicians: [],
    counts: { active: 0, dueToday: 0, reminders: 0, history: 0 },
    profileNames: senior?.medications ?? [],
  };
  if (!seniorId) return empty;

  const members = await listCareCircle(seniorId);
  const actor = findActor(members, session, senior);
  const household = await householdContext({ session, senior, members });
  const canManage = canManageMedications(session, actor, senior);
  const records = await readMedications({ seniorId });
  await dispatchDueMedicationReminders(records, now);
  const latest = await readMedications({ seniorId });
  const doses = await readDoses({ seniorId });
  const mapped = latest
    .map((item) => mapMedicationView(item, { now, session, actor, senior, canManage, doses }))
    .sort(byName);
  const active = mapped.filter((item) => item.liveStatus === MEDICATION_STATUS.ACTIVE);
  const paused = mapped.filter((item) => item.liveStatus === MEDICATION_STATUS.PAUSED);
  const ended = mapped.filter((item) => item.liveStatus === MEDICATION_STATUS.ENDED);
  const dueToday = active.flatMap((item) => item.slots.map((slot) => ({
    ...slot,
    medicationId: item.id,
    name: item.name,
    dosage: item.dosage,
    notes: item.notes,
    responsibleName: item.responsibleName,
    canLog: slot.canLog,
    title: `${item.name} ${item.dosage}`.trim(),
    meta: [slot.timeLabel, item.responsibleLabel].filter(Boolean).join(" · "),
  })));
  const reminders = active.filter((item) => item.reminder && item.reminder !== MEDICATION_REMINDER.NONE);
  const history = doses
    .map((item) => mapDoseView(item, now))
    .sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));

  return {
    isPlus: canUseMedication(household),
    canManage,
    canLog: active.some((item) => item.canLog),
    medications: mapped,
    active,
    dueToday,
    reminders,
    paused,
    ended,
    history,
    assignees: responsibleOptions(members),
    clinicians: clinicianOptions(members),
    counts: {
      active: active.length,
      dueToday: dueToday.filter((item) => !item.outcome || item.outcome === MEDICATION_DOSE_OUTCOME.MISSED).length,
      reminders: reminders.length,
      history: history.length,
    },
    profileNames: senior?.medications ?? [],
  };
}

export async function saveMedication(input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  assertCanManage(ctx);
  assertPlus(ctx);
  const existing = input.id || input.medicationId
    ? await readMedicationById(input.id || input.medicationId)
    : null;
  if (existing && existing.seniorId !== ctx.senior.id) {
    throw new Error("That medication could not be found.");
  }
  const patch = normalizeInput(input, existing);
  const withPeople = {
    ...(existing ?? createMedication({
      id: usesLiveAuth() ? "" : newId("med"),
      seniorId: ctx.senior.id,
      createdBy: ctx.session.id,
      createdByName: ctx.session.displayName || "",
      createdAt: nowIso(),
    })),
    ...patch,
    seniorId: ctx.senior.id,
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
    ...applyMember({}, input.responsibleId ?? existing?.responsibleId, ctx.members, "responsible"),
    ...applyMember({}, input.clinicianId ?? existing?.clinicianId, ctx.members, "clinician"),
  };
  if (patch.status === MEDICATION_STATUS.ENDED && existing?.status !== MEDICATION_STATUS.ENDED) {
    withPeople.endedAt = nowIso();
    withPeople.endedBy = ctx.session.id;
    withPeople.endedByName = ctx.session.displayName || "";
  }
  const saved = await saveMedicationRecord(withPeople);
  const records = await readMedications({ seniorId: ctx.senior.id });
  await syncSeniorMedicationNames(ctx.senior, records);
  const name = ctx.senior.preferredName || ctx.senior.displayName;
  await logMedicationActivity(
    existing ? "Medication list updated" : "Medication added to the record",
    `${saved.name} ${saved.dosage} for ${name} · ${scheduleLabel(saved)}. This is a shared care list, not a prescription.`,
    ctx.session,
    {
      seniorId: ctx.senior.id,
      source: "medication",
      sourceId: `${saved.id}:${existing ? "updated" : "created"}`,
      relatedId: saved.id,
    },
  );
  return saved;
}

export async function updateMedicationStatus(medicationId, status, session = getSession()) {
  const ctx = await loadContext(session);
  assertCanManage(ctx);
  assertPlus(ctx);
  const existing = await readMedicationById(medicationId);
  if (!existing || existing.seniorId !== ctx.senior.id) {
    throw new Error("That medication could not be found.");
  }
  if (!Object.values(MEDICATION_STATUS).includes(status)) {
    throw new Error("Choose a valid medication status.");
  }
  const saved = await saveMedicationRecord({
    ...existing,
    status,
    reminderSent: status !== MEDICATION_STATUS.ACTIVE,
    reminderAt: status === MEDICATION_STATUS.ACTIVE ? medicationReminderAt({ ...existing, status }) : existing.reminderAt,
    endedAt: status === MEDICATION_STATUS.ENDED ? nowIso() : existing.endedAt,
    endedBy: status === MEDICATION_STATUS.ENDED ? ctx.session.id : existing.endedBy,
    endedByName: status === MEDICATION_STATUS.ENDED ? ctx.session.displayName || "" : existing.endedByName,
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  });
  const records = await readMedications({ seniorId: ctx.senior.id });
  await syncSeniorMedicationNames(ctx.senior, records);
  const label = medicationStatusLabel(status).toLowerCase();
  await logMedicationActivity(
    `Medication ${label}`,
    `${saved.name} is now ${label} on the shared list.`,
    ctx.session,
    {
      seniorId: ctx.senior.id,
      source: "medication",
      sourceId: `${saved.id}:status:${status}`,
      relatedId: saved.id,
    },
  );
  return saved;
}

export async function logMedicationDose(medicationId, input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  const existing = await readMedicationById(medicationId);
  if (!existing || existing.seniorId !== ctx.senior.id) {
    throw new Error("That medication could not be found.");
  }
  assertCanLog(ctx, existing);
  const outcome = Object.values(MEDICATION_DOSE_OUTCOME).includes(input.outcome)
    ? input.outcome
    : MEDICATION_DOSE_OUTCOME.TAKEN;
  if (outcome === MEDICATION_DOSE_OUTCOME.MISSED) {
    throw new Error("Missed doses are recorded when the time passes. Log taken or skipped instead.");
  }
  const date = String(input.date || todayIso()).trim();
  const time = String(input.time || existing.time || "").trim();
  const slotKey = doseSlotKey(date, time);
  const doses = await readDoses({ medicationId: existing.id });
  const prior = doses.find((item) => item.slotKey === slotKey);
  const saved = await saveDoseRecord({
    ...(prior ?? createMedicationDose({
      id: usesLiveAuth() ? "" : newId("dose"),
      medicationId: existing.id,
      seniorId: ctx.senior.id,
    })),
    name: existing.name,
    dosage: existing.dosage,
    date,
    time,
    slotKey,
    outcome,
    notes: String(input.notes || "").trim(),
    recordedBy: ctx.session.id,
    recordedByName: ctx.session.displayName || "",
    recordedAt: nowIso(),
  });
  const nextReminder = medicationReminderAt(existing, new Date());
  await saveMedicationRecord({
    ...existing,
    reminderAt: nextReminder,
    reminderSent: !nextReminder,
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  });
  const label = doseOutcomeLabel(outcome).toLowerCase();
  await logMedicationActivity(
    outcome === MEDICATION_DOSE_OUTCOME.TAKEN ? "Medication recorded" : `${existing.name} ${label}`,
    `${existing.name} ${existing.dosage} was logged as ${label}${saved.notes ? ` · ${saved.notes}` : ""}.`,
    ctx.session,
    {
      seniorId: ctx.senior.id,
      source: "dose",
      sourceId: saved.id,
      relatedId: existing.id,
      occurredAt: saved.recordedAt,
    },
  );
  return saved;
}

export async function dispatchDueMedicationReminders(records, now = new Date()) {
  const due = (records || await readMedications()).filter((item) => {
    if (item.reminderSent) return false;
    if (!item.reminderAt) return false;
    if (liveMedicationStatus(item, now) !== MEDICATION_STATUS.ACTIVE) return false;
    return String(item.reminderAt) <= now.toISOString();
  });

  for (const item of due) {
    try {
      const members = item.seniorId ? await listCareCircle(item.seniorId) : [];
      await notifyQuietly([
        ...members,
        { userId: item.responsibleUserId, email: item.responsibleEmail },
      ], {
        type: NOTIFICATION_TYPES.MEDICATION_REMINDER,
        title: `Reminder · ${item.name}`,
        body: `${item.dosage} · ${scheduleLabel(item)}${item.responsibleName ? ` · ${item.responsibleName}` : ""}. This is a care reminder, not medical advice.`,
        seniorId: item.seniorId,
        medicationId: item.id,
      });
      await saveMedicationRecord({
        ...item,
        reminderAt: medicationReminderAt(item, new Date(now.getTime() + 60_000)),
        reminderSent: false,
      });
    } catch {
      // Keep trying on the next load if a reminder cannot be stored.
    }
  }
}

export { canLogMedicationDose, canManageMedications };
