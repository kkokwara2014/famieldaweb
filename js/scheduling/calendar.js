import { isoDate } from "./time.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayLabel(weekday, { long = false } = {}) {
  return (long ? DAYS_LONG : DAYS)[weekday] ?? "";
}

export function startOfWeek(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function weekDays(date = new Date()) {
  const start = startOfWeek(date);
  return DAYS.map((label, weekday) => {
    const day = new Date(start);
    day.setDate(start.getDate() + weekday);
    return {
      weekday,
      label,
      date: isoDate(day),
      day,
    };
  });
}

export function dateForWeekday(weekday, now = new Date()) {
  const start = startOfWeek(now);
  const day = new Date(start);
  day.setDate(start.getDate() + Number(weekday || 0));
  return isoDate(day);
}

export function groupEventsByWeekday(events, now = new Date()) {
  const days = weekDays(now);
  return days.map((day) => ({
    ...day,
    events: events.filter((event) => {
      if (event.date) return event.date === day.date;
      return event.weekday === day.weekday;
    }),
  }));
}
