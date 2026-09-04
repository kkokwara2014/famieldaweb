import {
  CARE_HISTORY_KINDS,
  CARE_TASK_STATUS,
  MEDICATION_DOSE_OUTCOME,
  VISIT_STATUS,
} from "../config/constants.js";
import {
  eachReportDay,
  formatReportHours,
  inReportRange,
  mapReportCompletion,
  mapReportDose,
  mapReportVisit,
  percentLabel,
  reportGeneratedLabel,
  reportRangeWindow,
  toCsv,
  visitMinutes,
} from "../config/reports.js";
import { getSession } from "../auth/session.js";
import { canUseAdvancedReports } from "./entitlement-service.js";
import { listCareCircle } from "./care-circle-service.js";
import { listVisits } from "./caregiver-schedule-service.js";
import { listCarePlanCompletions, listCarePlanTasks } from "./care-plan-service.js";
import { listMedicationDoses } from "./medication-service.js";
import { getCareHistoryWorkspace } from "./care-history-service.js";

export function buildReportsWorkspace({
  senior,
  session = getSession(),
  now = new Date(),
  rangeId = "7d",
  visits = [],
  tasks = [],
  completions = [],
  overdue = [],
  historyEvents = [],
  doses = [],
  caregivers = [],
  members = [],
  ownerPlan,
  appointments = [],
  careStatus = {},
  todaysTasks = [],
  careProgress = null,
  counts = {},
} = {}) {
  const range = reportRangeWindow(rangeId, now);
  const isPlus = canUseAdvancedReports({ session, senior, members, ownerPlan });
  const sources = {
    senior,
    visits,
    tasks,
    completions,
    overdue,
    historyEvents,
    doses,
    caregivers,
    members,
    ownerPlan,
    appointments,
    careStatus,
    todaysTasks,
    careProgress,
    counts,
  };

  const openToday = todaysTasks.filter((task) => task.status !== "completed").length;
  const doneToday = Math.max(0, todaysTasks.length - openToday);
  const onDuty = caregivers.find((person) => person.availability === "On duty");
  const nextAppointment = appointments[0] || null;

  const summary = {
    status: careStatus.status || "stable",
    statusLabel: careStatus.label || "Stable",
    statusBadge: careStatus.badge || "badge--success",
    statusSummary: careStatus.summary || "The household has not logged a care update yet.",
    coverageNote: careStatus.coverageNote || "No coverage note for today.",
    updatedLabel: careStatus.updatedLabel || "Not updated",
    onDutyName: onDuty?.name || "Not assigned",
    tasksDone: doneToday,
    tasksTotal: todaysTasks.length,
    tasksOpen: openToday,
    careProgress: careProgress
      ? `${careProgress.done} of ${careProgress.total} complete`
      : "None yet",
    overdue: overdue.length,
    nextAppointment,
    weekAppointments: counts.appointments || 0,
    weekCaregivers: counts.caregivers || 0,
    weekPractitioners: counts.practitioners || 0,
    weekMedications: counts.medications || 0,
    unread: counts.unread || 0,
    historyToday: counts.history || 0,
  };

  const rangedVisits = visits.filter((visit) => (
    visit.status !== VISIT_STATUS.CANCELLED
    && visit.status !== VISIT_STATUS.DECLINED
    && inReportRange(visit.date || visit.checkedOutAt || visit.checkedInAt, range)
  ));
  const completedVisits = rangedVisits
    .filter((visit) => visit.status === VISIT_STATUS.CHECKED_OUT || visit.report)
    .map((visit) => mapReportVisit(visit, now))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.when).localeCompare(String(a.when)));
  const rangedCompletions = completions
    .filter((item) => inReportRange(item.completedAt || item.dueDate, range))
    .map((item) => mapReportCompletion(item, tasks, now));
  const rangedDoses = doses
    .filter((item) => inReportRange(item.date || item.recordedAt, range))
    .map((item) => mapReportDose(item, now));
  const rangedHistory = historyEvents.filter((item) => inReportRange(item.occurredAt || item.createdAt, range));
  const checkIns = rangedHistory.filter((item) => item.kind === CARE_HISTORY_KINDS.CHECK_IN);
  const doneTasks = rangedCompletions.filter((item) => item.outcome !== CARE_TASK_STATUS.SKIPPED);
  const skippedTasks = rangedCompletions.filter((item) => item.outcome === CARE_TASK_STATUS.SKIPPED);
  const takenDoses = rangedDoses.filter((item) => item.outcome === MEDICATION_DOSE_OUTCOME.TAKEN);
  const skippedDoses = rangedDoses.filter((item) => item.outcome !== MEDICATION_DOSE_OUTCOME.TAKEN);
  const visitHours = completedVisits.reduce((sum, visit) => sum + (visit.minutes || 0), 0);
  const reportsFiled = completedVisits.filter((visit) => visit.hasReport).length;
  const taskDenom = doneTasks.length + skippedTasks.length;

  const caregiverRows = buildCaregiverActivity({
    caregivers,
    visits: rangedVisits,
    completions: rangedCompletions,
    checkIns,
  });

  const byAssignee = tallyBy(doneTasks, (item) => item.actor || "Household", (item) => item.actor);
  const byCategory = tallyBy(
    rangedCompletions,
    (item) => item.category || "other",
    (item) => item.categoryLabel,
  ).map((row) => ({
    ...row,
    done: rangedCompletions.filter((item) => (item.category || "other") === row.id && item.outcome !== CARE_TASK_STATUS.SKIPPED).length,
    skipped: rangedCompletions.filter((item) => (item.category || "other") === row.id && item.outcome === CARE_TASK_STATUS.SKIPPED).length,
  }));

  const trends = eachReportDay(range).map((day) => {
    const visitsCount = completedVisits.filter((item) => item.date === day.date).length;
    const tasksCount = doneTasks.filter((item) => item.date === day.date).length;
    const medications = takenDoses.filter((item) => item.date === day.date).length;
    const dayCheckIns = checkIns.filter((item) => (
      item.dayKey === day.date || inReportRange(item.occurredAt || item.createdAt, { startIso: day.date, endIso: day.date })
    )).length;
    return {
      ...day,
      visits: visitsCount,
      tasks: tasksCount,
      medications,
      checkIns: dayCheckIns,
      total: visitsCount + tasksCount + medications + dayCheckIns,
    };
  });
  const trendPeak = Math.max(1, ...trends.map((day) => day.total));

  const advanced = {
    totals: {
      visitsCompleted: completedVisits.length,
      visitHours,
      visitHoursLabel: formatReportHours(visitHours),
      checkIns: checkIns.length,
      reports: reportsFiled,
      tasksCompleted: doneTasks.length,
      tasksSkipped: skippedTasks.length,
      taskRate: percentLabel(doneTasks.length, taskDenom),
      medicationsTaken: takenDoses.length,
      medicationsLogged: rangedDoses.length,
      events: rangedHistory.length,
    },
    caregivers: caregiverRows,
    tasks: {
      completed: doneTasks.length,
      skipped: skippedTasks.length,
      overdue: overdue.length,
      rate: percentLabel(doneTasks.length, taskDenom),
      recent: rangedCompletions.slice(0, 8),
      byAssignee,
      byCategory: byCategory.length
        ? byCategory
        : [{ id: "none", label: "No completions in this range", count: 0, done: 0, skipped: 0 }],
    },
    visits: completedVisits,
    trends: trends.map((day) => ({
      ...day,
      percent: Math.round((day.total / trendPeak) * 100),
    })),
    csv: toCsv(buildCsvRows({
      senior,
      range,
      summary,
      caregiverRows,
      completions: rangedCompletions,
      visits: completedVisits,
      doses: rangedDoses,
      overdue,
    })),
  };

  return {
    senior,
    isPlus,
    range,
    generatedAt: now.toISOString(),
    generatedLabel: reportGeneratedLabel(now),
    summary,
    advanced,
    sources,
    canExport: isPlus,
  };
}

export function rebuildReports(workspace, rangeId, session, now = new Date()) {
  if (!workspace?.sources) {
    return buildReportsWorkspace({ session, now, rangeId });
  }
  return buildReportsWorkspace({
    ...workspace.sources,
    senior: workspace.senior || workspace.sources.senior,
    session,
    now,
    rangeId,
  });
}

export async function getReportsWorkspace(senior, session = getSession(), now = new Date(), extras = {}) {
  const seniorId = senior?.id || session?.seniorId;
  if (!seniorId) {
    return buildReportsWorkspace({ senior, session, now, rangeId: extras.rangeId });
  }

  const [members, visits, tasks, completions, doses, history] = await Promise.all([
    extras.members ? Promise.resolve(extras.members) : listCareCircle(seniorId),
    extras.visits ? Promise.resolve(extras.visits) : listVisits({ seniorId }, session),
    extras.tasks ? Promise.resolve(extras.tasks) : listCarePlanTasks({ seniorId }),
    extras.completions ? Promise.resolve(extras.completions) : listCarePlanCompletions({ seniorId }),
    extras.doses ? Promise.resolve(extras.doses) : listMedicationDoses({ seniorId }),
    extras.historyEvents
      ? Promise.resolve({ events: extras.historyEvents })
      : getCareHistoryWorkspace(senior, session, now),
  ]);

  return buildReportsWorkspace({
    senior,
    session,
    now,
    rangeId: extras.rangeId,
    visits,
    tasks,
    completions,
    overdue: extras.overdue || [],
    historyEvents: extras.historyEvents || history.events || [],
    doses,
    caregivers: extras.caregivers || members.filter((member) => member.kind === "caregiver"),
    members,
    appointments: extras.appointments || [],
    careStatus: extras.careStatus,
    todaysTasks: extras.todaysTasks || [],
    careProgress: extras.careProgress,
    counts: extras.counts || {},
  });
}

function activityPersonKey(name, id, caregivers = []) {
  const match = caregivers.find((person) => (
    (id && (person.id === id || person.userId === id))
    || (name && person.name === name)
  ));
  return match?.id || id || name || "household";
}

function buildCaregiverActivity({ caregivers, visits, completions, checkIns }) {
  const rows = new Map();

  const ensure = (key, seed = {}) => {
    if (!rows.has(key)) {
      rows.set(key, {
        id: key,
        name: seed.name || "Caregiver",
        visits: 0,
        minutes: 0,
        checkIns: 0,
        reports: 0,
        tasks: 0,
        notes: 0,
      });
    }
    const row = rows.get(key);
    if (seed.name && row.name === "Caregiver") row.name = seed.name;
    return row;
  };

  for (const person of caregivers) {
    ensure(person.id || person.name, { name: person.name });
  }

  for (const visit of visits) {
    const row = ensure(
      activityPersonKey(visit.caregiverName, visit.caregiverMemberId || visit.caregiverUserId, caregivers),
      { name: visit.caregiverName },
    );
    if (visit.status === VISIT_STATUS.CHECKED_OUT || visit.report) {
      row.visits += 1;
      row.minutes += visit.status === VISIT_STATUS.CHECKED_OUT ? visitMinutes(visit) : 0;
    }
    if (visit.report) row.reports += 1;
    row.notes += Array.isArray(visit.notes) ? visit.notes.length : 0;
  }

  for (const item of checkIns) {
    const row = ensure(
      activityPersonKey(item.actor, item.actorId, caregivers),
      { name: item.actor || "Caregiver" },
    );
    row.checkIns += 1;
  }

  for (const item of completions) {
    if (item.outcome === CARE_TASK_STATUS.SKIPPED) continue;
    const row = ensure(
      activityPersonKey(item.actor, item.actorId, caregivers),
      { name: item.actor },
    );
    row.tasks += 1;
  }

  return [...rows.values()]
    .filter((row) => row.visits || row.checkIns || row.tasks || row.reports)
    .map((row) => ({
      ...row,
      hoursLabel: formatReportHours(row.minutes),
      lastSeen: caregivers.find((person) => person.id === row.id || person.name === row.name)?.lastSeen || "",
    }))
    .sort((a, b) => b.visits - a.visits || b.tasks - a.tasks || a.name.localeCompare(b.name));
}

function tallyBy(items, idFn, labelFn) {
  const map = new Map();
  for (const item of items) {
    const id = idFn(item) || "other";
    if (!map.has(id)) {
      map.set(id, { id, label: labelFn(item) || id, count: 0 });
    }
    map.get(id).count += 1;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildCsvRows({ senior, range, summary, caregiverRows, completions, visits, doses, overdue }) {
  const name = senior?.preferredName || senior?.displayName || "Senior";
  return [
    ["Famielda care report", name],
    ["Range", `${range.label} · ${range.startLabel} – ${range.endLabel}`],
    ["Generated", reportGeneratedLabel()],
    ["Care status", summary.statusLabel, summary.statusSummary],
    [],
    ["Caregiver activity"],
    ["Caregiver", "Visits", "Hours", "Check-ins", "Reports", "Tasks completed"],
    ...caregiverRows.map((row) => [row.name, row.visits, row.hoursLabel, row.checkIns, row.reports, row.tasks]),
    [],
    ["Task completion"],
    ["Task", "Outcome", "Who", "When", "Notes"],
    ...completions.map((item) => [item.title, item.outcomeLabel, item.actor, item.when, item.notes]),
    ...(overdue.length ? [["Currently overdue", overdue.length]] : []),
    [],
    ["Visit history"],
    ["Visit", "Date", "Caregiver", "Hours", "Mood", "Summary"],
    ...visits.map((visit) => [visit.title, visit.dateLabel, visit.caregiver, visit.hoursLabel, visit.moodLabel, visit.summary]),
    [],
    ["Medications logged"],
    ["Medication", "Outcome", "Who", "When"],
    ...doses.map((dose) => [dose.title, dose.outcomeLabel, dose.actor, dose.when]),
  ];
}

export { sessionHasReportsPlus } from "../config/reports.js";
