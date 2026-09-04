export const DEFAULT_TIME_ZONE = "America/New_York";

export const SCHEDULE_TIME_ZONES = [
  { id: "America/New_York", label: "Eastern Time" },
  { id: "America/Chicago", label: "Central Time" },
  { id: "America/Denver", label: "Mountain Time" },
  { id: "America/Los_Angeles", label: "Pacific Time" },
  { id: "America/Phoenix", label: "Arizona" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "America/Toronto", label: "Eastern Time — Toronto" },
  { id: "America/Vancouver", label: "Pacific Time — Vancouver" },
  { id: "UTC", label: "UTC" },
];

export function isValidTimeZone(value) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: String(value || "") });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function resolveTimeZone(value) {
  const candidate = String(value || "").trim();
  if (candidate && isValidTimeZone(candidate)) return candidate;
  return browserTimeZone();
}

export function timeZoneOptions(current) {
  const resolved = resolveTimeZone(current);
  const options = SCHEDULE_TIME_ZONES.map((item) => ({ ...item }));
  if (!options.some((item) => item.id === resolved)) {
    options.unshift({ id: resolved, label: resolved.replace(/_/g, " ") });
  }
  return options;
}

export function timeZoneLabel(timeZone) {
  const id = resolveTimeZone(timeZone);
  return SCHEDULE_TIME_ZONES.find((item) => item.id === id)?.label || id.replace(/_/g, " ");
}

export function timeZoneAbbr(timeZone, at = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    timeZoneName: "short",
  }).formatToParts(new Date(at));
  return parts.find((part) => part.type === "timeZoneName")?.value || resolveTimeZone(timeZone);
}

function tzOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - utcMs;
}

export function zonedTimeToUtc(dateYmd, hhmm, timeZone) {
  const [year, month, day] = String(dateYmd || "").split("-").map(Number);
  const [hours, minutes] = String(hhmm || "").split(":").map(Number);
  if (!year || !month || !day || !Number.isFinite(hours)) return null;
  const mins = Number.isFinite(minutes) ? minutes : 0;
  const guess = Date.UTC(year, month - 1, day, hours, mins, 0);
  const zone = resolveTimeZone(timeZone);
  const offset1 = tzOffsetMs(guess, zone);
  const instant = guess - offset1;
  const offset2 = tzOffsetMs(instant, zone);
  return guess - offset2;
}

export function windowInstants(date, startTime, endTime, timeZone) {
  const startsAt = zonedTimeToUtc(date, startTime, timeZone);
  const endsAt = zonedTimeToUtc(date, endTime, timeZone);
  if (startsAt == null || endsAt == null) return null;
  return { startsAt, endsAt, timeZone: resolveTimeZone(timeZone) };
}

export function instantsOverlap(aStart, aEnd, bStart, bEnd) {
  return Number(aStart) < Number(bEnd) && Number(bStart) < Number(aEnd);
}

export function civilDateInZone(utcMs = Date.now(), timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}
