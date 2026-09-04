export function toMinutes(hhmm) {
  const [hours, minutes] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return null;
  const mins = Number.isFinite(minutes) ? minutes : 0;
  if (mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

export function fromMinutes(total) {
  const clamped = Math.max(0, Math.min(24 * 60, Number(total) || 0));
  const hours = Math.floor(clamped / 60) % 24;
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function addMinutesToTime(hhmm, delta) {
  const start = toMinutes(hhmm);
  if (start == null) return "";
  return fromMinutes(start + Number(delta || 0));
}

export function durationMinutes(startTime, endTime) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start == null || end == null) return 0;
  return end - start;
}

export function formatTime(hhmm) {
  const minutes = toMinutes(hhmm);
  if (minutes == null) return "";
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatRange(startTime, endTime) {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

export function parseIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isoDate(value = new Date()) {
  const date = value instanceof Date ? value : parseIsoDate(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function weekdayFromIso(value) {
  const date = parseIsoDate(value);
  return date ? date.getDay() : 0;
}

export function formatDateLabel(value, { weekday = true } = {}) {
  const date = parseIsoDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    weekday: weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
  });
}

export function formatWhen(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  return `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

export function todayIso(now = new Date()) {
  return isoDate(now);
}
