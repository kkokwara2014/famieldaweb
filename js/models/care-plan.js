import {
  CARE_PLAN_STATUS,
  CARE_TASK_CATEGORY,
  CARE_TASK_FREQUENCY,
  CARE_TASK_PRIORITY,
  CARE_TASK_STATUS,
} from "../config/constants.js";

export function createCarePlan(data = {}) {
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
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
  return {
    id: data.id ?? "",
    planId: data.planId ?? "",
    seniorId: data.seniorId ?? "",
    title: data.title ?? "",
    notes: data.notes ?? "",
    category: data.category ?? CARE_TASK_CATEGORY.OTHER,
    priority: data.priority ?? CARE_TASK_PRIORITY.MEDIUM,
    frequency: data.frequency ?? CARE_TASK_FREQUENCY.DAILY,
    dueDate: data.dueDate ?? null,
    dueTime: data.dueTime ?? "",
    weekday: data.weekday ?? null,
    repeatUntil: data.repeatUntil ?? null,
    notesLog: Array.isArray(data.notesLog) ? data.notesLog.map((item) => createCareTaskNote(item)) : [],
    assignedCaregiverId: data.assignedCaregiverId ?? "",
    assignedCaregiverUserId: data.assignedCaregiverUserId ?? "",
    assignedCaregiverEmail: data.assignedCaregiverEmail ?? "",
    assignedCaregiverName: data.assignedCaregiverName ?? "",
    status: data.status ?? CARE_TASK_STATUS.OPEN,
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
