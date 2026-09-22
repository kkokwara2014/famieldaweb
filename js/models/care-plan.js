import {
  CARE_PLAN_STATUS,
  CARE_TASK_CATEGORY,
  CARE_TASK_FREQUENCY,
  CARE_TASK_PRIORITY,
  CARE_TASK_STATUS,
} from "../config/constants.js";

const RECURRENCE_FROM_FREQUENCY = {
  [CARE_TASK_FREQUENCY.ONCE]: "none",
  [CARE_TASK_FREQUENCY.DAILY]: "daily",
  [CARE_TASK_FREQUENCY.WEEKLY]: "weekly",
  [CARE_TASK_FREQUENCY.MONTHLY]: "weekly",
  [CARE_TASK_FREQUENCY.AS_NEEDED]: "none",
};

export function createCarePlan(data = {}) {
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    // Mobile-canonical field (the mobile app reads this name).
    familyId: data.familyId ?? "",
    title: data.title ?? "",
    goal: data.goal ?? "",
    notes: data.notes ?? "",
    status: data.status ?? CARE_PLAN_STATUS.ACTIVE,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    createdBy: data.createdBy ?? "",
    createdByName: data.createdByName ?? "",
    updatedBy: data.updatedBy ?? "",
    updatedByName: data.updatedByName ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

export function createCarePlanTask(data = {}) {
  const title = data.title ?? "";
  const notes = data.notes ?? "";
  const status = data.status ?? CARE_TASK_STATUS.OPEN;
  const frequency = data.frequency ?? CARE_TASK_FREQUENCY.DAILY;
  const dueDate = data.dueDate ?? null;
  const assignedCaregiverUserId = data.assignedCaregiverUserId ?? data.assignedUserId ?? "";
  const assignedCaregiverName = data.assignedCaregiverName ?? data.assignedDisplayName ?? "";
  return {
    id: data.id ?? "",
    // Mobile-canonical fields (the mobile app reads these names).
    familyId: data.familyId ?? "",
    seniorId: data.seniorId ?? "",
    planId: data.planId ?? "",
    title,
    notes,
    name: data.name ?? title,
    description: data.description ?? notes,
    scheduledAt: data.scheduledAt ?? dueDate,
    recurrence: data.recurrence ?? RECURRENCE_FROM_FREQUENCY[frequency] ?? "daily",
    frequency,
    status,
    mobileStatus: data.mobileStatus ?? (status === CARE_TASK_STATUS.OPEN ? "pending" : status),
    priority: data.priority ?? CARE_TASK_PRIORITY.MEDIUM,
    seriesId: data.seriesId ?? "",
    assignedUserId: data.assignedUserId ?? assignedCaregiverUserId,
    assignedDisplayName: data.assignedDisplayName ?? assignedCaregiverName,
    completedAt: data.completedAt ?? null,
    statusUpdatedBy: data.statusUpdatedBy ?? "",
    // Web fields (kept; aliases of the canonical ones above).
    category: data.category ?? CARE_TASK_CATEGORY.OTHER,
    dueDate,
    dueTime: data.dueTime ?? "",
    weekday: data.weekday ?? null,
    repeatUntil: data.repeatUntil ?? null,
    notesLog: Array.isArray(data.notesLog) ? data.notesLog.map((item) => createCareTaskNote(item)) : [],
    assignedCaregiverId: data.assignedCaregiverId ?? "",
    assignedCaregiverUserId,
    assignedCaregiverEmail: data.assignedCaregiverEmail ?? "",
    assignedCaregiverName,
    lastCompletedAt: data.lastCompletedAt ?? null,
    lastCompletedBy: data.lastCompletedBy ?? "",
    lastCompletedByName: data.lastCompletedByName ?? "",
    completionCount: Number(data.completionCount) || 0,
    createdBy: data.createdBy ?? "",
    createdByName: data.createdByName ?? "",
    updatedBy: data.updatedBy ?? "",
    updatedByName: data.updatedByName ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

export function createCareTaskNote(data = {}) {
  return {
    id: data.id ?? "",
    body: data.body ?? "",
    createdAt: data.createdAt ?? null,
    createdBy: data.createdBy ?? "",
    createdByName: data.createdByName ?? "",
  };
}

export function createCarePlanCompletion(data = {}) {
  return {
    id: data.id ?? "",
    taskId: data.taskId ?? "",
    planId: data.planId ?? "",
    seniorId: data.seniorId ?? "",
    outcome: data.outcome ?? CARE_TASK_STATUS.COMPLETED,
    notes: data.notes ?? "",
    dueDate: data.dueDate ?? null,
    completedAt: data.completedAt ?? null,
    completedBy: data.completedBy ?? "",
    completedByName: data.completedByName ?? "",
  };
}
