const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const USERS = "users";
const SENIORS = "seniors";
const PLANS = "carePlans";
const TASKS = "carePlanTasks";
const COMPLETIONS = "carePlanCompletions";
const notifications = require("./notifications");
const analytics = require("./analytics");

const PLAN_STATUS = ["draft", "active", "paused", "completed", "archived"];
const FREQUENCIES = ["once", "daily", "weekly", "monthly", "as_needed"];
const PRIORITIES = ["urgent", "high", "medium", "low"];
const TASK_STATUS = {
  OPEN: "open",
  COMPLETED: "completed",
  SKIPPED: "skipped",
};

function db() {
  return getFirestore();
}

function requireUid(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
}

function todayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(iso, days) {
  const [year, month, day] = String(iso || todayIso()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + Number(days || 0));
  return todayIso(date);
}

function addMonths(iso, months) {
  const [year, month, day] = String(iso || todayIso()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + Number(months || 0), day || 1);
  return todayIso(date);
}

function isRecurring(frequency) {
  return frequency === "daily" || frequency === "weekly" || frequency === "monthly";
}

function nextDueDate(task, now = new Date()) {
  const today = todayIso(now);
  let due = task.dueDate || today;
  if (task.frequency === "once" || task.frequency === "as_needed") return due;
  do {
    if (task.frequency === "monthly") due = addMonths(due, 1);
    else due = addDays(due, task.frequency === "weekly" ? 7 : 1);
  } while (due <= today);
  return due;
}

async function loadUser(uid) {
  const snap = await db().doc(`${USERS}/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { id: snap.id, ...snap.data() };
}

async function loadSenior(seniorId) {
  const snap = await db().doc(`${SENIORS}/${seniorId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Senior record not found.");
  return { id: snap.id, ...snap.data() };
}

function isMember(senior, uid) {
  return senior.ownerId === uid || (Array.isArray(senior.memberIds) && senior.memberIds.includes(uid));
}

function canManage(user, senior) {
  if (user.role === "admin" || user.role === "family" || user.role === "health_practitioner") return true;
  return senior.ownerId === user.id;
}

async function requireHousehold(request, seniorId) {
  const uid = requireUid(request);
  const [user, senior] = await Promise.all([loadUser(uid), loadSenior(seniorId)]);
  if (!isMember(senior, uid)) {
    throw new HttpsError("permission-denied", "You are not on this household.");
  }
  return { uid, user, senior };
}

exports.saveCarePlan = async (request) => {
  const input = request.data || {};
  const { uid, user, senior } = await requireHousehold(request, input.seniorId);
  if (!canManage(user, senior)) {
    throw new HttpsError("permission-denied", "You need permission to change this care plan.");
  }
  const title = String(input.title || "").trim();
  if (!title) throw new HttpsError("invalid-argument", "Give this care plan a name.");
  const status = PLAN_STATUS.includes(input.status) ? input.status : "active";
  const ref = input.planId ? db().doc(`${PLANS}/${input.planId}`) : db().collection(PLANS).doc();
  const existing = input.planId ? await ref.get() : null;
  if (input.planId && (!existing.exists || existing.data().seniorId !== senior.id)) {
    throw new HttpsError("not-found", "That care plan could not be found.");
  }
  const payload = {
    seniorId: senior.id,
    title,
    goal: String(input.goal || "").trim(),
    notes: String(input.notes || "").trim(),
    status,
    startDate: input.startDate || todayIso(),
    endDate: input.endDate || null,
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing?.exists) {
    payload.createdBy = uid;
    payload.createdByName = user.displayName || "";
    payload.createdAt = FieldValue.serverTimestamp();
  }
  await ref.set(payload, { merge: true });
  const snap = await ref.get();
  return { id: ref.id, ...snap.data() };
};

exports.assignCarePlanTask = async (request) => {
  const input = request.data || {};
  const { uid, user, senior } = await requireHousehold(request, input.seniorId);
  if (!canManage(user, senior)) {
    throw new HttpsError("permission-denied", "You need permission to assign care tasks.");
  }
  const title = String(input.title || "").trim();
  if (!title) throw new HttpsError("invalid-argument", "Give this task a name.");
  const planSnap = await db().doc(`${PLANS}/${input.planId}`).get();
  if (!planSnap.exists || planSnap.data().seniorId !== senior.id) {
    throw new HttpsError("not-found", "Choose a care plan before assigning a task.");
  }
  const frequency = FREQUENCIES.includes(input.frequency) ? input.frequency : "daily";
  const dueDate = input.dueDate || (frequency === "as_needed" ? null : todayIso());
  const priority = PRIORITIES.includes(input.priority) ? input.priority : "medium";
  const ref = input.taskId ? db().doc(`${TASKS}/${input.taskId}`) : db().collection(TASKS).doc();
  const existing = input.taskId ? await ref.get() : null;
  if (input.taskId && (!existing.exists || existing.data().seniorId !== senior.id)) {
    throw new HttpsError("not-found", "That care task could not be found.");
  }
  const payload = {
    planId: planSnap.id,
    seniorId: senior.id,
    title,
    notes: String(input.notes || "").trim(),
    category: input.category || "other",
    priority,
    frequency,
    dueDate,
    dueTime: String(input.dueTime || "").trim(),
    weekday: frequency === "weekly" ? Number(input.weekday ?? 0) : null,
    repeatUntil: isRecurring(frequency) ? (input.repeatUntil || null) : null,
    assignedCaregiverId: input.assignedCaregiverId || "",
    assignedCaregiverUserId: input.assignedCaregiverUserId || "",
    assignedCaregiverEmail: String(input.assignedCaregiverEmail || "").trim().toLowerCase(),
    assignedCaregiverName: input.assignedCaregiverName || "",
    status: TASK_STATUS.OPEN,
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing?.exists) {
    payload.createdBy = uid;
    payload.createdByName = user.displayName || "";
    payload.createdAt = FieldValue.serverTimestamp();
    payload.notesLog = [];
    payload.completionCount = 0;
  }
  await ref.set(payload, { merge: true });
  const snap = await ref.get();
  const task = { id: ref.id, ...snap.data() };
  if (task.assignedCaregiverUserId || task.assignedCaregiverEmail) {
    await notifications.notifyPeople([{
      userId: task.assignedCaregiverUserId,
      email: task.assignedCaregiverEmail,
    }], {
      type: notifications.TYPES.TASK_ASSIGNED,
      title: `${task.title} assigned to you`,
      body: `${task.assignedCaregiverName || "You"} have a care task for this household.`,
      seniorId: senior.id,
      taskId: task.id,
      actorId: uid,
      actorName: user.displayName || "",
    }, uid);
  }
  return task;
};

exports.completeCarePlanTask = async (request) => {
  const input = request.data || {};
  const uid = requireUid(request);
  const user = await loadUser(uid);
  const taskRef = db().doc(`${TASKS}/${input.taskId}`);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new HttpsError("not-found", "That care task could not be found.");
  const task = { id: taskSnap.id, ...taskSnap.data() };
  const senior = await loadSenior(task.seniorId);
  const assigned = task.assignedCaregiverUserId === uid
    || String(task.assignedCaregiverEmail || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase();
  if (!isMember(senior, uid) && !assigned) {
    throw new HttpsError("permission-denied", "You can only complete tasks assigned to you.");
  }
  const outcome = input.outcome === TASK_STATUS.SKIPPED ? TASK_STATUS.SKIPPED : TASK_STATUS.COMPLETED;
  const completionRef = db().collection(COMPLETIONS).doc();
  const now = new Date();
  const next = {
    lastCompletedAt: FieldValue.serverTimestamp(),
    lastCompletedBy: uid,
    lastCompletedByName: user.displayName || "",
    completionCount: Number(task.completionCount || 0) + 1,
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (outcome === TASK_STATUS.SKIPPED && !isRecurring(task.frequency)) {
    next.status = TASK_STATUS.SKIPPED;
  } else if (isRecurring(task.frequency) || task.frequency === "as_needed") {
    next.status = TASK_STATUS.OPEN;
    if (isRecurring(task.frequency)) {
      const upcoming = nextDueDate(task, now);
      if (task.repeatUntil && upcoming > task.repeatUntil) {
        next.status = TASK_STATUS.COMPLETED;
      } else {
        next.dueDate = upcoming;
      }
    }
  } else {
    next.status = TASK_STATUS.COMPLETED;
  }

  await db().runTransaction(async (tx) => {
    tx.set(completionRef, {
      taskId: task.id,
      planId: task.planId,
      seniorId: task.seniorId,
      outcome,
      notes: String(input.notes || "").trim(),
      dueDate: task.dueDate || todayIso(now),
      completedAt: FieldValue.serverTimestamp(),
      completedBy: uid,
      completedByName: user.displayName || "",
    });
    tx.update(taskRef, next);
  });

  const snap = await taskRef.get();
  if (outcome === TASK_STATUS.COMPLETED) {
    const actor = await analytics.actorFields(uid);
    await analytics.trackQuietly({
      name: analytics.NAMES.TASK_COMPLETED,
      ...actor,
      taskId: task.id,
      completionId: completionRef.id,
      seniorId: task.seniorId || "",
      platform: "server",
      dedupeKey: `task_completed:${completionRef.id}`,
    });
  }
  return { id: snap.id, ...snap.data() };
};

exports.addCareTaskNote = async (request) => {
  const input = request.data || {};
  const uid = requireUid(request);
  const user = await loadUser(uid);
  const taskRef = db().doc(`${TASKS}/${input.taskId}`);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new HttpsError("not-found", "That care task could not be found.");
  const task = { id: taskSnap.id, ...taskSnap.data() };
  const senior = await loadSenior(task.seniorId);
  const assigned = task.assignedCaregiverUserId === uid
    || String(task.assignedCaregiverEmail || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase();
  if (!isMember(senior, uid) && !assigned) {
    throw new HttpsError("permission-denied", "You need permission to add a note on this task.");
  }
  const body = String(input.body || "").trim();
  if (!body) throw new HttpsError("invalid-argument", "Write a short note before saving.");
  const note = {
    id: db().collection(TASKS).doc().id,
    body,
    createdAt: new Date().toISOString(),
    createdBy: uid,
    createdByName: user.displayName || "",
  };
  await taskRef.update({
    notesLog: FieldValue.arrayUnion(note),
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  });
  const snap = await taskRef.get();
  return { id: snap.id, ...snap.data() };
};
