import { mockEvents } from "./mock-data.js";
import { listVisits, visitToEvent } from "./caregiver-schedule-service.js";
import { listAppointmentEvents } from "./appointment-service.js";
import { listMedicationEvents } from "./medication-service.js";
import { VISIT_STATUS } from "../config/constants.js";
import { getSession } from "../auth/session.js";
import { weekDays } from "../scheduling/calendar.js";

export async function listHouseholdEvents() {
  return mockEvents;
}

export async function listScheduleEvents(now = new Date()) {
  const session = getSession();
  const days = new Set(weekDays(now).map((day) => day.date));
  const [household, visits, appointments, medications] = await Promise.all([
    listHouseholdEvents(),
    listVisits({ seniorId: session?.seniorId }, session),
    listAppointmentEvents({ seniorId: session?.seniorId }, now),
    listMedicationEvents({ seniorId: session?.seniorId }, now),
  ]);
  const visitEvents = visits
    .filter((visit) => (
      days.has(visit.date)
      && visit.status !== VISIT_STATUS.DECLINED
      && visit.status !== VISIT_STATUS.CANCELLED
    ))
    .map(visitToEvent);
  const appointmentEvents = appointments.filter((event) => days.has(event.date));
  const medicationEvents = medications.filter((event) => days.has(event.date));
  const householdEvents = medicationEvents.length
    ? household.filter((event) => event.type !== "meds")
    : household;
  return [...householdEvents, ...visitEvents, ...appointmentEvents, ...medicationEvents];
}

export async function listTodaysTasks(now = new Date()) {
  const weekday = now.getDay();
  return (await listScheduleEvents(now))
    .filter((event) => event.weekday === weekday)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export async function listUpcomingAppointments(now = new Date()) {
  const today = now.getDay();
  return (await listScheduleEvents(now))
    .filter((event) => event.type === "appointment")
    .sort((a, b) => {
      const aDelta = (a.weekday - today + 7) % 7;
      const bDelta = (b.weekday - today + 7) % 7;
      return aDelta - bDelta || String(a.time).localeCompare(String(b.time));
    });
}
