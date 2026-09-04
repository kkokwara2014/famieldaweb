export function createScheduleEvent(data = {}) {
  return {
    id: data.id ?? "",
    title: data.title ?? "",
    weekday: data.weekday ?? 0,
    time: data.time ?? "",
    type: data.type ?? "care",
    assignee: data.assignee ?? "",
    status: data.status ?? "scheduled",
    notes: data.notes ?? "",
    date: data.date ?? "",
    endTime: data.endTime ?? "",
    visitId: data.visitId ?? "",
    visitStatus: data.visitStatus ?? "",
    seniorId: data.seniorId ?? "",
    seniorName: data.seniorName ?? "",
    practitionerId: data.practitionerId ?? "",
    practitionerUserId: data.practitionerUserId ?? "",
    practitionerEmail: data.practitionerEmail ?? "",
    appointmentStatus: data.appointmentStatus ?? "",
  };
}
