import {
  AUTH,
  ACTIVITY_TYPES,
  CARE_HISTORY_KINDS,
  CARE_PLAN_STATUS,
  CARE_TASK_FREQUENCY,
  CARE_TASK_PRIORITY,
  CARE_TASK_STATUS,
  CIRCLE_STATUS,
  NOTIFICATION_TYPES,
} from "../config/constants.js";
import {
  canCompleteCareTask,
  canManageCarePlan,
  dueDateLabel,
  frequencyLabel,
  isRecurringFrequency,
  liveCareTaskStatus,
  nextDueDate,
  overdueLabel,
  planProgress,
  planStatusBadge,
  planStatusLabel,
  priorityBadge,
  priorityLabel,
  priorityRank,
  recurrenceEnded,
  taskMeta,
  taskStatusBadge,
  taskStatusLabel,
  weekdayFromDueDate,
} from "../config/care-plan.js";
import { createCarePlan, createCarePlanCompletion, createCarePlanTask, createCareTaskNote } from "../models/care-plan.js";
import { mockCarePlanCompletions, mockCarePlans, mockCarePlanTasks } from "./mock-data.js";
import { storage } from "../core/storage.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { getQueryDocs } from "../core/query.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSession } from "../auth/session.js";
import { getSeniorForUser } from "./senior-service.js";
import { listCareCircle } from "./care-circle-service.js";
import { postActivity } from "./activity-service.js";
import { notifyQuietly } from "./notification-service.js";
import { PRODUCT_EVENTS, trackProductEvent } from "./analytics-service.js";
import { formatWhen, isoDate, todayIso } from "../scheduling/time.js";

const PLANS_KEY = "carePlans";
const TASKS_KEY = "carePlanTasks";
const COMPLETIONS_KEY = "carePlanCompletions";

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

function planFrom(data) {
  return createCarePlan({
    ...data,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  });
}

function taskFrom(data) {
  return createCarePlanTask({
    ...data,
    lastCompletedAt: toIso(data.lastCompletedAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    weekday: data.weekday == null || data.weekday === "" ? null : Number(data.weekday),
    notesLog: Array.isArray(data.notesLog)
      ? data.notesLog.map((item) => createCareTaskNote({ ...item, createdAt: toIso(item.createdAt) }))
      : [],
  });
}

function completionFrom(data) {
  return createCarePlanCompletion({
    ...data,
    completedAt: toIso(data.completedAt),
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
  seedMap(PLANS_KEY, mockCarePlans);
  seedMap(TASKS_KEY, mockCarePlanTasks);
  seedMap(COMPLETIONS_KEY, mockCarePlanCompletions);
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

function localPlans(seniorId) {
  return Object.values(readLocalMap(PLANS_KEY))
    .map((item) => planFrom(item))
    .filter((item) => !seniorId || item.seniorId === seniorId);
}

function localTasks({ seniorId, planId, assignee } = {}) {
  return Object.values(readLocalMap(TASKS_KEY))
    .map((item) => taskFrom(item))
    .filter((item) => matchesTaskFilter(item, { seniorId, planId, assignee }));
}

function localCompletions({ seniorId, taskId, planId } = {}) {
  return Object.values(readLocalMap(COMPLETIONS_KEY))
    .map((item) => completionFrom(item))
    .filter((item) => {
      if (seniorId && item.seniorId !== seniorId) return false;
      if (taskId && item.taskId !== taskId) return false;
      if (planId && item.planId !== planId) return false;
      return true;
    });
}

function matchesTaskFilter(item, { seniorId, planId, assignee } = {}) {
  if (seniorId && item.seniorId !== seniorId) return false;
  if (planId && item.planId !== planId) return false;
  if (assignee && !matchesAssignee(item, assignee)) return false;
  return true;
}

function matchesAssignee(task, assignee) {
  if (!assignee) return true;
  if (assignee.id && task.assignedCaregiverId === assignee.id) return true;
  if (assignee.userId && task.assignedCaregiverUserId === assignee.userId) return true;
  if (assignee.email && emailsEqual(task.assignedCaregiverEmail, assignee.email)) return true;
  return false;
}

async function collectionDocs(collection, constraints = [], options = {}) {
  return getQueryDocs(collection, constraints, { limit: QUERY_LIMITS.WORKSPACE, ...options });
}

async function readPlans(seniorId) {
  if (!usesLiveAuth()) return localPlans(seniorId);
  if (!seniorId) return [];
  const sdk = getFirestoreSdk();
  const docs = await collectionDocs(AUTH.CARE_PLANS_COLLECTION, [
    sdk.where("seniorId", "==", seniorId),
  ]);
  return docs.map((item) => planFrom(item));
}

async function readTasks(filter = {}) {
  if (!usesLiveAuth()) return localTasks(filter);
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  else if (filter.planId) constraints.push(sdk.where("planId", "==", filter.planId));
  else if (filter.assignee?.userId) constraints.push(sdk.where("assignedCaregiverUserId", "==", filter.assignee.userId));
  else if (filter.assignee?.email) {
    constraints.push(sdk.where("assignedCaregiverEmail", "==", String(filter.assignee.email).trim().toLowerCase()));
  }
  const docs = await collectionDocs(AUTH.CARE_PLAN_TASKS_COLLECTION, constraints);
  return docs
    .map((item) => taskFrom(item))
    .filter((item) => matchesTaskFilter(item, filter));
}

async function readCompletions(filter = {}) {
  if (!usesLiveAuth()) return localCompletions(filter);
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.taskId) constraints.push(sdk.where("taskId", "==", filter.taskId));
  else if (filter.planId) constraints.push(sdk.where("planId", "==", filter.planId));
  else if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  const docs = await collectionDocs(AUTH.CARE_PLAN_COMPLETIONS_COLLECTION, constraints);
  return docs
    .map((item) => completionFrom(item))
    .filter((item) => {
      if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
      if (filter.taskId && item.taskId !== filter.taskId) return false;
      if (filter.planId && item.planId !== filter.planId) return false;
      return true;
    });
}

async function readPlanById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) return localPlans().find((item) => item.id === id) ?? null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.CARE_PLANS_COLLECTION, id));
  if (!snap.exists()) return null;
  return planFrom({ id: snap.id, ...snap.data() });
}

async function readTaskById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) return localTasks().find((item) => item.id === id) ?? null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.CARE_PLAN_TASKS_COLLECTION, id));
  if (!snap.exists()) return null;
  return taskFrom({ id: snap.id, ...snap.data() });
}

async function savePlan(plan) {
  const record = planFrom({ ...plan, updatedAt: nowIso() });
  if (!usesLiveAuth()) return planFrom(writeLocalRecord(PLANS_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.CARE_PLANS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.CARE_PLANS_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = { ...payload, updatedAt: sdk.serverTimestamp() };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return planFrom({ ...record, id: ref.id });
}

async function saveTask(task) {
  const record = taskFrom({ ...task, updatedAt: nowIso() });
  if (!usesLiveAuth()) return taskFrom(writeLocalRecord(TASKS_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.CARE_PLAN_TASKS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.CARE_PLAN_TASKS_COLLECTION));
  const payload = toDoc({
    ...record,
    id: ref.id,
    assignedCaregiverEmail: String(record.assignedCaregiverEmail || "").trim().toLowerCase(),
  });
  const data = { ...payload, updatedAt: sdk.serverTimestamp() };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return taskFrom({ ...record, id: ref.id });
}

async function saveCompletion(completion) {
  const record = completionFrom(completion);
  if (!usesLiveAuth()) return completionFrom(writeLocalRecord(COMPLETIONS_KEY, record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.CARE_PLAN_COMPLETIONS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.CARE_PLAN_COMPLETIONS_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = {
    ...payload,
    completedAt: payload.completedAt ? payload.completedAt : sdk.serverTimestamp(),
  };
  await sdk.setDoc(ref, data, { merge: true });
  return completionFrom({ ...record, id: ref.id });
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

function assigneeOptions(members = []) {
  return members
    .filter((member) => member.status === CIRCLE_STATUS.ACTIVE)
    .map((member) => ({
      id: member.id,
      userId: member.userId || "",
      email: member.email || "",
      name: member.name,
      kind: member.kind,
      relationship: member.relationship,
      label: member.kind === "caregiver"
        ? `${member.name} · Caregiver`
        : `${member.name} · ${member.relationship || "Circle"}`,
    }));
}

function applyAssignee(task, assigneeId, members) {
  if (!assigneeId) {
    return {
      ...task,
      assignedCaregiverId: "",
      assignedCaregiverUserId: "",
      assignedCaregiverEmail: "",
      assignedCaregiverName: "",
    };
  }
  const member = members.find((item) => item.id === assigneeId);
  if (!member) {
    throw new Error("Choose someone on this circle to assign the task.");
  }
  return {
    ...task,
    assignedCaregiverId: member.id,
    assignedCaregiverUserId: member.userId || "",
    assignedCaregiverEmail: member.email || "",
    assignedCaregiverName: member.name,
  };
}

function normalizePlanInput(input = {}, session, existing = null) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("Give this care plan a name.");
  const status = Object.values(CARE_PLAN_STATUS).includes(input.status)
    ? input.status
    : (existing?.status ?? CARE_PLAN_STATUS.ACTIVE);
  return {
    title,
    goal: String(input.goal ?? "").trim(),
    notes: String(input.notes ?? "").trim(),
    status,
    startDate: input.startDate || existing?.startDate || todayIso(),
    endDate: input.endDate || null,
    updatedBy: session?.id || "",
    updatedByName: session?.displayName || "",
  };
}

function normalizeTaskInput(input = {}, existing = null) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("Give this task a name.");
  const frequency = Object.values(CARE_TASK_FREQUENCY).includes(input.frequency)
    ? input.frequency
    : (existing?.frequency ?? CARE_TASK_FREQUENCY.DAILY);
  const dueDate = input.dueDate || existing?.dueDate || (frequency === CARE_TASK_FREQUENCY.AS_NEEDED ? null : todayIso());
  if (frequency !== CARE_TASK_FREQUENCY.AS_NEEDED && !dueDate) {
    throw new Error("Set a due date for this task.");
  }
  const weekday = frequency === CARE_TASK_FREQUENCY.WEEKLY
    ? (input.weekday === "" || input.weekday == null ? weekdayFromDueDate(dueDate, new Date().getDay()) : Number(input.weekday))
    : null;
  const priority = Object.values(CARE_TASK_PRIORITY).includes(input.priority)
    ? input.priority
    : (existing?.priority ?? CARE_TASK_PRIORITY.MEDIUM);
  const repeatUntil = isRecurringFrequency(frequency)
    ? (input.repeatUntil || existing?.repeatUntil || null)
    : null;
  if (repeatUntil && dueDate && repeatUntil < dueDate) {
    throw new Error("The repeat-until date must be on or after the first due date.");
  }
  return {
    title,
    notes: String(input.notes ?? "").trim(),
    category: input.category || existing?.category || "other",
    priority,
    frequency,
    dueDate,
    dueTime: String(input.dueTime ?? existing?.dueTime ?? "").trim(),
    weekday,
    repeatUntil,
    status: existing?.status ?? CARE_TASK_STATUS.OPEN,
  };
}

async function loadContext(session = getSession()) {
  if (!session) throw new Error("Sign in to manage the care plan.");
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("A senior record is needed before a care plan can be saved.");
  const members = await listCareCircle(senior.id);
  const actor = findActor(members, session, senior);
  return { session, senior, members, actor };
}

function assertCanManage(ctx) {
  if (!canManageCarePlan(ctx.session, ctx.actor, ctx.senior)) {
    throw new Error("You need permission to change this care plan.");
  }
}

function assertCanComplete(ctx, task) {
  if (!canCompleteCareTask(task, ctx.session, ctx.actor)) {
    throw new Error("You can only complete tasks assigned to you.");
  }
}

function mapTaskView(task, { now, session, actor, canManage, completions = [] } = {}) {
  const liveStatus = liveCareTaskStatus(task, now);
  const canComplete = canCompleteCareTask(task, session, actor)
    && liveStatus !== CARE_TASK_STATUS.COMPLETED
    && (isRecurringFrequency(task.frequency) || liveStatus !== CARE_TASK_STATUS.SKIPPED);
  const notesLog = (task.notesLog || [])
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    ...task,
    liveStatus,
    statusLabel: taskStatusLabel(liveStatus),
    badge: taskStatusBadge(liveStatus),
    priorityLabel: priorityLabel(task.priority),
    priorityBadge: priorityBadge(task.priority),
    isOverdue: liveStatus === CARE_TASK_STATUS.MISSED,
    overdueLabel: overdueLabel(task, now),
    isRecurring: isRecurringFrequency(task.frequency),
    frequencyLabel: frequencyLabel(task.frequency),
    dueLabel: dueDateLabel(task, now),
    meta: taskMeta(task, now),
    assigneeName: task.assignedCaregiverName || "Unassigned",
    lastCompletedLabel: task.lastCompletedAt ? formatWhen(task.lastCompletedAt, now) : "",
    latestNote: notesLog[0] || null,
    notesLog: notesLog.map((item) => ({
      ...item,
      when: item.createdAt ? formatWhen(item.createdAt, now) : "",
    })),
    canComplete,
    canEdit: Boolean(canManage),
    canNote: Boolean(canManage || canCompleteCareTask(task, session, actor)),
    completions: completions
      .filter((item) => item.taskId === task.id)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))),
  };
}

function mapPlanView(plan, tasks, completions, extras) {
  const progress = planProgress(tasks, extras.now);
  return {
    ...plan,
    statusLabel: planStatusLabel(plan.status),
    badge: planStatusBadge(plan.status),
    progress,
    tasks: tasks
      .map((task) => mapTaskView(task, { ...extras, completions }))
      .sort(byTaskDue),
    completions: completions
      .filter((item) => item.planId === plan.id)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))),
  };
}

function byTaskDue(a, b) {
  const aLive = a.liveStatus || liveCareTaskStatus(a);
  const bLive = b.liveStatus || liveCareTaskStatus(b);
  const aDone = aLive === CARE_TASK_STATUS.COMPLETED || aLive === CARE_TASK_STATUS.SKIPPED ? 1 : 0;
  const bDone = bLive === CARE_TASK_STATUS.COMPLETED || bLive === CARE_TASK_STATUS.SKIPPED ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;
  const aOverdue = aLive === CARE_TASK_STATUS.MISSED ? 0 : 1;
  const bOverdue = bLive === CARE_TASK_STATUS.MISSED ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority) return byPriority;
  return String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"))
    || String(a.dueTime || "").localeCompare(String(b.dueTime || ""))
    || String(a.title).localeCompare(String(b.title));
}

async function logCareActivity(title, body, session, extra = {}) {
  try {
    await postActivity({
      type: extra.type || ACTIVITY_TYPES.CARE,
      kind: extra.kind || CARE_HISTORY_KINDS.CARE,
      title,
      body,
      seniorId: extra.seniorId,
      source: extra.source || "activity",
      sourceId: extra.sourceId || "",
      relatedId: extra.relatedId || "",
      occurredAt: extra.occurredAt,
    }, session);
  } catch {
    // Activity history is helpful, not required to save the plan.
  }
}

export async function listCarePlans(seniorId = getSession()?.seniorId) {
  return (await readPlans(seniorId)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function listCarePlanTasks(filter = {}) {
  return (await readTasks(filter)).sort(byTaskDue);
}

export async function listCarePlanCompletions(filter = {}) {
  return (await readCompletions(filter))
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
}

export async function getCarePlanWorkspace(senior, session = getSession(), now = new Date()) {
  const seniorId = senior?.id || session?.seniorId;
  if (!seniorId) {
    return {
      plans: [],
      tasks: [],
      dueToday: [],
      overdue: [],
      recurring: [],
      completed: [],
      recentCompletions: [],
      completions: [],
      assignees: [],
      canManage: false,
      progress: planProgress([]),
    };
  }

  const members = await listCareCircle(seniorId);
  const actor = findActor(members, session, senior);
  const canManage = canManageCarePlan(session, actor, senior);
  const [plans, tasks, completions] = await Promise.all([
    readPlans(seniorId),
    readTasks({ seniorId }),
    readCompletions({ seniorId }),
  ]);
  const extras = { now, session, actor, canManage };
  const mappedTasks = tasks.map((task) => mapTaskView(task, { ...extras, completions }));
  const today = todayIso(now);
  const visiblePlans = plans.filter((plan) => plan.status !== CARE_PLAN_STATUS.ARCHIVED);

  return {
    plans: visiblePlans
      .sort((a, b) => Number(b.status === CARE_PLAN_STATUS.ACTIVE) - Number(a.status === CARE_PLAN_STATUS.ACTIVE)
        || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((plan) => mapPlanView(
        plan,
        tasks.filter((task) => task.planId === plan.id),
        completions,
        extras,
      )),
    tasks: mappedTasks.sort(byTaskDue),
    dueToday: mappedTasks.filter((task) => (
      task.liveStatus !== CARE_TASK_STATUS.COMPLETED
      && task.liveStatus !== CARE_TASK_STATUS.SKIPPED
      && (task.dueDate === today || (task.frequency === CARE_TASK_FREQUENCY.AS_NEEDED && task.liveStatus === CARE_TASK_STATUS.OPEN))
    )),
    overdue: mappedTasks.filter((task) => task.liveStatus === CARE_TASK_STATUS.MISSED),
    recurring: mappedTasks.filter((task) => task.isRecurring && task.liveStatus !== CARE_TASK_STATUS.COMPLETED),
    completed: mappedTasks.filter((task) => task.liveStatus === CARE_TASK_STATUS.COMPLETED || task.liveStatus === CARE_TASK_STATUS.SKIPPED),
    recentCompletions: completions
      .slice()
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, 8)
      .map((item) => ({
        ...item,
        when: item.completedAt ? formatWhen(item.completedAt, now) : "",
        taskTitle: tasks.find((task) => task.id === item.taskId)?.title || "Care task",
      })),
    completions,
    assignees: assigneeOptions(members),
    canManage,
    progress: planProgress(tasks, now),
  };
}

export async function createCarePlanForSenior(input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  assertCanManage(ctx);
  const patch = normalizePlanInput(input, ctx.session);
  const plan = await savePlan(createCarePlan({
    id: usesLiveAuth() ? "" : newId("plan"),
    seniorId: ctx.senior.id,
    ...patch,
    createdBy: ctx.session.id,
    createdByName: ctx.session.displayName || "",
    createdAt: nowIso(),
  }));
  await logCareActivity(
    "Care plan created",
    `${plan.title} is now on ${ctx.senior.preferredName || ctx.senior.displayName}’s record.`,
    ctx.session,
    { kind: CARE_HISTORY_KINDS.CARE, seniorId: ctx.senior.id, source: "plan", sourceId: `${plan.id}:created` },
  );
  return plan;
}

export async function updateCarePlanRecord(planId, input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  assertCanManage(ctx);
  const existing = await readPlanById(planId);
  if (!existing || existing.seniorId !== ctx.senior.id) {
    throw new Error("That care plan could not be found.");
  }
  const patch = normalizePlanInput(input, ctx.session, existing);
  const plan = await savePlan({ ...existing, ...patch });
  await logCareActivity(
    "Care plan updated",
    `${plan.title} was updated.`,
    ctx.session,
    { kind: CARE_HISTORY_KINDS.CARE, seniorId: ctx.senior.id, source: "plan", sourceId: `${plan.id}:updated:${plan.updatedAt || ""}` },
  );
  await notifyQuietly(ctx.members.filter((item) => item.status === CIRCLE_STATUS.ACTIVE), {
    type: NOTIFICATION_TYPES.CARE_UPDATE,
    title: `${plan.title} was updated`,
    body: `${ctx.session.displayName} updated the care plan for ${ctx.senior.preferredName || ctx.senior.displayName}.`,
    seniorId: ctx.senior.id,
  }, ctx.session);
  return plan;
}

export async function assignCarePlanTask(input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  assertCanManage(ctx);
  const plan = await resolvePlanForTask(ctx, input.planId || input.id);
  const existing = input.taskId ? await readTaskById(input.taskId) : null;
  if (existing && existing.seniorId !== ctx.senior.id) {
    throw new Error("That task could not be found.");
  }
  const patch = normalizeTaskInput(input, existing);
  const withAssignee = applyAssignee({
    ...(existing ?? createCarePlanTask({
      id: usesLiveAuth() ? "" : newId("task"),
      planId: plan.id,
      seniorId: ctx.senior.id,
      createdBy: ctx.session.id,
      createdByName: ctx.session.displayName || "",
      createdAt: nowIso(),
    })),
    ...patch,
    planId: plan.id,
    seniorId: ctx.senior.id,
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  }, input.assignedCaregiverId ?? existing?.assignedCaregiverId, ctx.members);

  const task = await saveTask(withAssignee);
  await logCareActivity(
    existing ? "Care task updated" : "Care task created",
    `${task.title} · ${priorityLabel(task.priority)} · ${frequencyLabel(task.frequency)} · ${task.assignedCaregiverName || "Unassigned"}.`,
    ctx.session,
    {
      kind: CARE_HISTORY_KINDS.TASK,
      seniorId: ctx.senior.id,
      source: "task",
      sourceId: `${task.id}:${existing ? "updated" : "created"}`,
      relatedId: task.id,
    },
  );
  const assigneeChanged = !existing || existing.assignedCaregiverUserId !== task.assignedCaregiverUserId || existing.assignedCaregiverEmail !== task.assignedCaregiverEmail;
  if (assigneeChanged && (task.assignedCaregiverUserId || task.assignedCaregiverEmail)) {
    await notifyQuietly([{ userId: task.assignedCaregiverUserId, email: task.assignedCaregiverEmail }], {
      type: NOTIFICATION_TYPES.TASK_ASSIGNED,
      title: `${task.title} assigned to you`,
      body: `${priorityLabel(task.priority)} · ${frequencyLabel(task.frequency)} · ${ctx.senior.preferredName || ctx.senior.displayName}.`,
      seniorId: ctx.senior.id,
      taskId: task.id,
      entityType: "task",
      entityId: task.id,
    }, ctx.session);
  }
  if (task.priority === CARE_TASK_PRIORITY.URGENT) {
    await notifyQuietly(ctx.members.filter((item) => item.status === CIRCLE_STATUS.ACTIVE), {
      type: NOTIFICATION_TYPES.CARE_UPDATE,
      title: `Urgent task · ${task.title}`,
      body: `${task.assignedCaregiverName || "Someone"} has an urgent task on ${ctx.senior.preferredName || ctx.senior.displayName}’s plan.`,
      seniorId: ctx.senior.id,
      taskId: task.id,
    }, ctx.session);
  }
  return task;
}

async function resolvePlanForTask(ctx, planId) {
  if (planId) {
    const plan = await readPlanById(planId);
    if (!plan || plan.seniorId !== ctx.senior.id) {
      throw new Error("Choose a care plan before assigning a task.");
    }
    return plan;
  }
  const plans = (await readPlans(ctx.senior.id))
    .filter((item) => item.status !== CARE_PLAN_STATUS.ARCHIVED);
  const active = plans.find((item) => item.status === CARE_PLAN_STATUS.ACTIVE) || plans[0];
  if (active) return active;
  return createCarePlanForSenior({
    title: "Daily support plan",
    goal: "Assigned care work for this household.",
    status: CARE_PLAN_STATUS.ACTIVE,
  }, ctx.session);
}

export async function completeCarePlanTask(taskId, input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  const task = await readTaskById(taskId);
  if (!task || task.seniorId !== ctx.senior.id) {
    throw new Error("That care task could not be found.");
  }
  assertCanComplete(ctx, task);
  const now = new Date();
  const outcome = input.outcome === CARE_TASK_STATUS.SKIPPED ? CARE_TASK_STATUS.SKIPPED : CARE_TASK_STATUS.COMPLETED;
  const completion = await saveCompletion(createCarePlanCompletion({
    id: usesLiveAuth() ? "" : newId("done"),
    taskId: task.id,
    planId: task.planId,
    seniorId: task.seniorId,
    outcome,
    notes: String(input.notes ?? "").trim(),
    dueDate: task.dueDate || isoDate(now),
    completedAt: nowIso(),
    completedBy: ctx.session.id,
    completedByName: ctx.session.displayName || "",
  }));

  const next = {
    ...task,
    lastCompletedAt: completion.completedAt,
    lastCompletedBy: ctx.session.id,
    lastCompletedByName: ctx.session.displayName || "",
    completionCount: (Number(task.completionCount) || 0) + 1,
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  };

  if (outcome === CARE_TASK_STATUS.SKIPPED && !isRecurringFrequency(task.frequency)) {
    next.status = CARE_TASK_STATUS.SKIPPED;
  } else if (isRecurringFrequency(task.frequency) || task.frequency === CARE_TASK_FREQUENCY.AS_NEEDED) {
    next.status = CARE_TASK_STATUS.OPEN;
    if (isRecurringFrequency(task.frequency)) {
      const upcoming = nextDueDate(task, now);
      if (recurrenceEnded(task, upcoming)) {
        next.status = CARE_TASK_STATUS.COMPLETED;
      } else {
        next.dueDate = upcoming;
      }
    }
  } else {
    next.status = CARE_TASK_STATUS.COMPLETED;
  }

  const saved = await saveTask(next);
  await logCareActivity(
    outcome === CARE_TASK_STATUS.SKIPPED ? `${saved.title} skipped` : `${saved.title} completed`,
    `${saved.title} · ${saved.assignedCaregiverName || ctx.session.displayName}.`,
    ctx.session,
    {
      kind: CARE_HISTORY_KINDS.TASK,
      seniorId: ctx.senior.id,
      source: "completion",
      sourceId: completion.id,
      relatedId: saved.id,
      occurredAt: completion.completedAt,
    },
  );
  if (outcome === CARE_TASK_STATUS.COMPLETED) {
    trackProductEvent(PRODUCT_EVENTS.TASK_COMPLETED, {
      dedupeKey: `task_completed:${completion.id || `${task.id}:${completion.completedAt}`}`,
      taskId: saved.id,
      completionId: completion.id,
      seniorId: ctx.senior.id,
    }, ctx.session);
  }
  return saved;
}

export async function skipCarePlanTask(taskId, input = {}, session = getSession()) {
  return completeCarePlanTask(taskId, { ...input, outcome: CARE_TASK_STATUS.SKIPPED }, session);
}

export async function addCareTaskNote(taskId, body, session = getSession()) {
  const ctx = await loadContext(session);
  const task = await readTaskById(taskId);
  if (!task || task.seniorId !== ctx.senior.id) {
    throw new Error("That care task could not be found.");
  }
  if (!canManageCarePlan(ctx.session, ctx.actor, ctx.senior) && !canCompleteCareTask(task, ctx.session, ctx.actor)) {
    throw new Error("You need permission to add a note on this task.");
  }
  const text = String(body ?? "").trim();
  if (!text) throw new Error("Write a short note before saving.");
  const note = createCareTaskNote({
    id: newId("note"),
    body: text,
    createdAt: nowIso(),
    createdBy: ctx.session.id,
    createdByName: ctx.session.displayName || "",
  });
  const saved = await saveTask({
    ...task,
    notesLog: [...(task.notesLog || []), note],
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  });
  await logCareActivity(
    "Care task note added",
    `${task.title} · ${ctx.session.displayName}.`,
    ctx.session,
    {
      kind: CARE_HISTORY_KINDS.NOTE,
      seniorId: ctx.senior.id,
      source: "task",
      sourceId: `${task.id}:note:${note.id}`,
      relatedId: task.id,
    },
  );
  return saved;
}

export async function reopenCarePlanTask(taskId, session = getSession()) {
  const ctx = await loadContext(session);
  assertCanManage(ctx);
  const task = await readTaskById(taskId);
  if (!task || task.seniorId !== ctx.senior.id) {
    throw new Error("That care task could not be found.");
  }
  return saveTask({
    ...task,
    status: CARE_TASK_STATUS.OPEN,
    dueDate: task.dueDate || todayIso(),
    updatedBy: ctx.session.id,
    updatedByName: ctx.session.displayName || "",
  });
}

export { canCompleteCareTask, canManageCarePlan };
