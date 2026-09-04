import {
  CARE_CIRCLE_ROLES,
  CARE_TASK_STATUS,
  VISIT_STATUS,
} from "./constants.js";
import { ENTITLEMENT_MESSAGES, hasPlusAccess } from "./entitlements.js";
import { categoryLabel } from "./care-plan.js";
import { moodLabel, visitStatusBadge, visitStatusLabel } from "./scheduling.js";
import { doseOutcomeLabel } from "./medication.js";
import { durationMinutes, formatDateLabel, formatWhen, isoDate, parseIsoDate } from "../scheduling/time.js";
import { seniorHubHref } from "./senior-hub.js";

export const REPORTS_PLUS_MESSAGE = ENTITLEMENT_MESSAGES.reports;

export const REPORT_RANGES = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "14d", label: "Last 14 days", days: 14 },
  { id: "30d", label: "Last 30 days", days: 30 },
];

export const REPORT_PLUS_FEATURES = [
  {
    id: "advanced",
    label: "Advanced reports",
    body: "A period view of coverage, not only today’s snapshot.",
  },
  {
    id: "caregivers",
    label: "Caregiver activity",
    body: "Visits, hours, check-ins, and reports by person.",
  },
  {
    id: "tasks",
    label: "Task completion",
    body: "What was finished, skipped, or still overdue.",
  },
  {
    id: "visits",
    label: "Visit history",
    body: "Completed visits with mood and follow-up notes.",
  },
  {
    id: "trends",
    label: "Care trends",
    body: "A day-by-day picture of activity around them.",
  },
  {
    id: "export",
    label: "Export",
    body: "Download a CSV the household can share or archive.",
  },
  {
    id: "pdf",
    label: "PDF generation",
    body: "Print or save a branded care report as a PDF.",
  },
];

export function sessionHasReportsPlus(session) {
  return hasPlusAccess(session);
}

export function householdHasReportsPlus(session, senior, members = [], ownerPlan) {
  if (session?.role === "admin") return true;
  if (ownerPlan) return hasPlusAccess({ plan: ownerPlan });
  if (senior?.ownerId && senior.ownerId === session?.id) return sessionHasReportsPlus(session);
  const owner = members.find((member) => member.role === CARE_CIRCLE_ROLES.OWNER);
  return Boolean(owner && hasPlusAccess(owner));
}

export function reportRangeMeta(rangeId = "7d") {
  return REPORT_RANGES.find((item) => item.id === rangeId) ?? REPORT_RANGES[0];
}

export function reportRangeWindow(rangeId = "7d", now = new Date()) {
  const meta = reportRangeMeta(rangeId);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (meta.days - 1));
  return {
    ...meta,
    start,
    end,
    startIso: isoDate(start),
    endIso: isoDate(end),
    startLabel: formatDateLabel(isoDate(start), { weekday: true }),
    endLabel: formatDateLabel(isoDate(end), { weekday: true }),
  };
}

export function inReportRange(value, range) {
  if (!value || !range) return false;
  const iso = normalizeReportDate(value);
  if (!iso) return false;
  return iso >= range.startIso && iso <= range.endIso;
}

export function normalizeReportDate(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return isoDate(date);
}

export function eachReportDay(range) {
  const days = [];
  const cursor = parseIsoDate(range.startIso);
  const end = parseIsoDate(range.endIso);
  if (!cursor || !end) return days;
  while (cursor <= end) {
    const iso = isoDate(cursor);
    days.push({
      date: iso,
      label: formatDateLabel(iso, { weekday: true }),
      shortLabel: range.days <= 7
        ? cursor.toLocaleDateString("en-US", { weekday: "narrow" })
        : String(cursor.getDate()),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function visitMinutes(visit) {
  if (visit?.checkedInAt && visit?.checkedOutAt) {
    const start = new Date(visit.checkedInAt);
    const end = new Date(visit.checkedOutAt);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    }
  }
  return durationMinutes(visit?.startTime, visit?.endTime);
}

export function formatReportHours(minutes) {
  const total = Number(minutes) || 0;
  if (total <= 0) return "0h";
  const hours = total / 60;
  if (hours >= 10) return `${Math.round(hours)}h`;
  if (hours >= 1) {
    const rounded = hours.toFixed(1).replace(/\.0$/, "");
    return `${rounded}h`;
  }
  return `${total}m`;
}

export function percentLabel(part, whole) {
  if (!whole) return "—";
  return `${Math.round((Number(part) / Number(whole)) * 100)}%`;
}

export function reportGeneratedLabel(now = new Date()) {
  return now.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function caregiverKey(visit) {
  return visit?.caregiverUserId
    || String(visit?.caregiverEmail || "").toLowerCase()
    || visit?.caregiverMemberId
    || visit?.caregiverName
    || "household";
}

export function mapReportVisit(visit, now = new Date()) {
  const minutes = visit.status === VISIT_STATUS.CHECKED_OUT ? visitMinutes(visit) : 0;
  return {
    id: visit.id,
    title: visit.title || "Care visit",
    date: visit.date,
    dateLabel: formatDateLabel(visit.date),
    when: visit.checkedOutAt
      ? formatWhen(visit.checkedOutAt, now)
      : (visit.checkedInAt ? formatWhen(visit.checkedInAt, now) : formatDateLabel(visit.date)),
    caregiver: visit.caregiverName || "Caregiver",
    caregiverId: caregiverKey(visit),
    status: visit.status,
    statusLabel: visitStatusLabel(visit.status),
    badge: visitStatusBadge(visit.status),
    minutes,
    hoursLabel: formatReportHours(minutes),
    mood: visit.report?.mood || "",
    moodLabel: visit.report?.mood ? moodLabel(visit.report.mood) : "",
    summary: visit.report?.summary || visit.notes?.[visit.notes.length - 1]?.body || "",
    followUp: visit.report?.followUp || "",
    hasReport: Boolean(visit.report),
    href: seniorHubHref("schedule"),
  };
}

export function mapReportCompletion(item, tasks = [], now = new Date()) {
  const task = tasks.find((entry) => entry.id === item.taskId);
  const outcome = item.outcome || CARE_TASK_STATUS.COMPLETED;
  return {
    id: item.id,
    taskId: item.taskId,
    title: item.taskTitle || task?.title || "Care task",
    notes: item.notes || "",
    outcome,
    outcomeLabel: outcome === CARE_TASK_STATUS.SKIPPED ? "Skipped" : "Done",
    badge: outcome === CARE_TASK_STATUS.SKIPPED ? "badge--neutral" : "badge--success",
    category: task?.category || "",
    categoryLabel: categoryLabel(task?.category),
    actor: item.completedByName || "Household",
    actorId: item.completedBy || "",
    completedAt: item.completedAt,
    when: item.completedAt ? formatWhen(item.completedAt, now) : "",
    date: normalizeReportDate(item.completedAt || item.dueDate),
  };
}

export function mapReportDose(dose, now = new Date()) {
  return {
    id: dose.id,
    title: `${dose.name || "Medication"} ${dose.dosage || ""}`.trim(),
    outcome: dose.outcome,
    outcomeLabel: doseOutcomeLabel(dose.outcome),
    actor: dose.recordedByName || "Household",
    date: dose.date || normalizeReportDate(dose.recordedAt),
    when: dose.recordedAt ? formatWhen(dose.recordedAt, now) : formatDateLabel(dose.date),
  };
}

export function reportsFileStem(name, now = new Date()) {
  const slug = String(name || "care")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "care";
  return `${slug}-care-report-${isoDate(now)}`;
}

export function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(rows = []) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadTextFile(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printCareReport(html, root = document.getElementById("care-report-print")) {
  if (!root) throw new Error("The printable report could not be prepared.");
  root.innerHTML = html;
  root.hidden = false;
  document.body.classList.add("is-printing-report");

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("is-printing-report");
    root.hidden = true;
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.requestAnimationFrame(() => {
    window.print();
    window.setTimeout(cleanup, 60_000);
  });
}
