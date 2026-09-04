/**
 * Security labels for the admin audit console.
 * Access is enforced by Firestore rules, Storage rules, and Cloud Functions —
 * never by this file.
 */

export const AUDIT_ACTION_LABELS = {
  "circle.invite": "Care-circle invitation",
  "circle.accept": "Invitation accepted",
  "circle.decline": "Invitation declined",
  "circle.remove": "Member removed",
  "circle.update": "Member permissions changed",
  "circle.revoke": "Invitation revoked",
  "circle.resend": "Invitation resent",
  "user.updated": "User updated",
  "user.suspended": "Account suspended",
  "user.restored": "Account restored",
  "user.deleted": "Account deleted",
  "plan.granted": "Plan grant",
  "billing.checkout": "Plus checkout",
  "billing.portal": "Billing portal",
  "billing.resume": "Subscription resumed",
  "billing.finalize": "Checkout finalized",
  "verification.submit": "Verification submitted",
  "verification.review": "Verification reviewed",
  "verification.profile": "Verification profile saved",
  "verification.document.add": "Verification document added",
  "verification.document.remove": "Verification document removed",
  "schedule.request": "Visit requested",
  "schedule.cancel": "Visit cancelled",
  "schedule.accept": "Visit accepted",
  "schedule.decline": "Visit declined",
  "schedule.checkin": "Visit check-in",
  "schedule.checkout": "Visit check-out",
  "care.medication.save": "Medication saved",
  "care.appointment.cancel": "Appointment cancelled",
  "care.plan.save": "Care plan saved",
  "document.deleted": "Document deleted",
  "referral.invite": "Family referral sent",
  "referral.revoke": "Family referral revoked",
  "referral.claim": "Family referral claimed",
  "support.created": "Support ticket created",
  "support.updated": "Support ticket updated",
  "overview.viewed": "Admin overview",
};

export const AUDIT_ACTION_FILTERS = [
  { id: "all", label: "All actions" },
  { id: "circle", label: "Care circle" },
  { id: "user", label: "Accounts" },
  { id: "billing", label: "Billing" },
  { id: "verification", label: "Verification" },
  { id: "schedule", label: "Schedule" },
  { id: "care", label: "Care record" },
  { id: "referral", label: "Referrals" },
  { id: "support", label: "Support" },
];

export function auditActionLabel(action) {
  if (!action) return "Unknown";
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  const base = action.replace(/\.denied$/, "");
  if (AUDIT_ACTION_LABELS[base]) {
    return action.endsWith(".denied") ? `${AUDIT_ACTION_LABELS[base]} (denied)` : AUDIT_ACTION_LABELS[base];
  }
  return String(action).replaceAll(".", " · ");
}

export function auditResultBadge(ok) {
  return ok === false ? "badge--danger" : "badge--success";
}

export function auditResultLabel(ok) {
  return ok === false ? "Denied" : "Recorded";
}
