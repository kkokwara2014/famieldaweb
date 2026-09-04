import { CIRCLE_KINDS, VISIT_STATUS } from "./constants.js";

export { VISIT_STATUS };

export const PROFESSIONAL_KIND = {
  CAREGIVER: CIRCLE_KINDS.CAREGIVER,
  PRACTITIONER: CIRCLE_KINDS.PRACTITIONER,
};

export const AVAILABILITY_KIND = {
  WEEKLY: "weekly",
  BLOCK: "block",
};

export const VISIT_MOODS = [
  { id: "good", label: "Good day" },
  { id: "typical", label: "Typical" },
  { id: "tired", label: "Tired" },
  { id: "unwell", label: "Unwell" },
];

export const VISIT_STATUS_LABEL = {
  [VISIT_STATUS.REQUESTED]: "Requested",
  [VISIT_STATUS.ACCEPTED]: "Accepted",
  [VISIT_STATUS.DECLINED]: "Declined",
  [VISIT_STATUS.CHECKED_IN]: "Checked in",
  [VISIT_STATUS.CHECKED_OUT]: "Checked out",
  [VISIT_STATUS.CANCELLED]: "Cancelled",
};

export const VISIT_STATUS_BADGE = {
  [VISIT_STATUS.REQUESTED]: "badge--warning",
  [VISIT_STATUS.ACCEPTED]: "badge--brand",
  [VISIT_STATUS.DECLINED]: "badge--danger",
  [VISIT_STATUS.CHECKED_IN]: "badge--success",
  [VISIT_STATUS.CHECKED_OUT]: "badge--neutral",
  [VISIT_STATUS.CANCELLED]: "badge--neutral",
};

export function visitStatusLabel(status) {
  return VISIT_STATUS_LABEL[status] ?? "Scheduled";
}

export function visitStatusBadge(status) {
  return VISIT_STATUS_BADGE[status] ?? "badge--brand";
}

export function moodLabel(id) {
  return VISIT_MOODS.find((item) => item.id === id)?.label ?? "Typical";
}

export function isPractitionerVisit(visit) {
  return visit?.professionalKind === PROFESSIONAL_KIND.PRACTITIONER;
}

export function professionalNoun(kind, { plural = false } = {}) {
  if (kind === PROFESSIONAL_KIND.PRACTITIONER) return plural ? "Clinicians" : "clinician";
  return plural ? "Caregivers" : "caregiver";
}

export function bookingNoun(kind, { plural = false } = {}) {
  if (kind === PROFESSIONAL_KIND.PRACTITIONER) return plural ? "appointments" : "appointment";
  return plural ? "visits" : "visit";
}

export class ScheduleOverlapError extends Error {
  constructor(message, conflict = null) {
    super(message);
    this.name = "ScheduleOverlapError";
    this.code = "overlap";
    this.conflict = conflict;
  }
}
