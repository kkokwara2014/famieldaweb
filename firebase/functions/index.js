/**
 * Famielda Cloud Functions
 *
 * Domain entrypoints live here as thin exports.
 * Authorization, rate limits, and audit wrapping are applied here so
 * handlers cannot be reached without server-side checks.
 */

const { onCall, onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const functionsV1 = require("firebase-functions/v1");
const careCircle = require("./care-circle");
const scheduling = require("./scheduling");
const carePlans = require("./care-plans");
const appointments = require("./appointments");
const medications = require("./medications");
const documents = require("./documents");
const messages = require("./messages");
const notifications = require("./notifications");
const stripeBilling = require("./stripe");
const adminConsole = require("./admin");
const analytics = require("./analytics");
const verification = require("./verification");
const referrals = require("./referrals");
const security = require("./security");
const monitoring = require("./monitoring");
const mail = require("./mail");

initializeApp();
getFirestore().settings({ ignoreUndefinedProperties: true });

const protect = security.protect;

exports.health = onCall({ invoker: "public" }, async () => ({
  ok: true,
  service: "famielda-functions",
  at: new Date().toISOString(),
}));

exports.resolveCareCircleInvite = onCall({ invoker: "public" }, protect(careCircle.resolveCareCircleInvite, {
  public: true,
  rateLimit: "invitePreview",
}));

exports.saveProfessionalAvailability = onCall(protect(scheduling.saveProfessionalAvailability, {
  rateLimit: "schedule",
}));
exports.saveCaregiverAvailability = onCall(protect(scheduling.saveCaregiverAvailability, {
  rateLimit: "schedule",
}));
exports.savePractitionerAvailability = onCall(protect(scheduling.savePractitionerAvailability, {
  rateLimit: "schedule",
}));

exports.onCareDocumentDeleted = documents.onCareDocumentDeleted;
exports.onCareMessageCreated = messages.onCareMessageCreated;

exports.ensureProfessionalVerification = onCall(protect(verification.ensureProfessionalVerification, {
  rateLimit: "verification",
}));
exports.getMyVerification = onCall(protect(verification.getMyVerification, {
  rateLimit: "verification",
}));
exports.saveVerificationProfile = onCall(protect(verification.saveVerificationProfile, {
  rateLimit: "verification",
  audit: "verification.profile",
}));
exports.addVerificationDocument = onCall(protect(verification.addVerificationDocument, {
  rateLimit: "verification",
  audit: "verification.document.add",
  sensitive: true,
}));
exports.removeVerificationDocument = onCall(protect(verification.removeVerificationDocument, {
  rateLimit: "verification",
  audit: "verification.document.remove",
  sensitive: true,
}));
exports.submitProfessionalVerification = onCall(protect(verification.submitProfessionalVerification, {
  rateLimit: "verification",
  audit: "verification.submit",
  sensitive: true,
}));
exports.listProfessionalVerifications = onCall(protect(verification.listProfessionalVerifications, {
  admin: true,
  rateLimit: "admin",
}));
exports.getProfessionalVerificationCase = onCall(protect(verification.getProfessionalVerificationCase, {
  admin: true,
  rateLimit: "admin",
}));
exports.reviewProfessionalVerification = onCall(protect(verification.reviewProfessionalVerification, {
  admin: true,
  rateLimit: "admin",
  audit: "verification.review",
  sensitive: true,
}));
exports.onVerificationDocumentDeleted = verification.onVerificationDocumentDeleted;

exports.getFamilyReferralWorkspace = onCall(protect(referrals.getFamilyReferralWorkspace, {
  rateLimit: "default",
}));
exports.resolveFamilyReferralCode = onCall({ invoker: "public" }, protect(referrals.resolveFamilyReferralCode, {
  public: true,
  rateLimit: false,
}));
exports.inviteFamilyRelative = onCall(protect(referrals.inviteFamilyRelative, {
  rateLimit: "referral",
  audit: "referral.invite",
  sensitive: true,
  targetType: "family_referral",
  includeInput: true,
}));
exports.resendFamilyReferral = onCall(protect(referrals.resendFamilyReferral, {
  rateLimit: "referral",
  audit: "referral.invite",
  targetType: "family_referral",
}));
exports.revokeFamilyReferral = onCall(protect(referrals.revokeFamilyReferral, {
  rateLimit: "referral",
  audit: "referral.revoke",
  sensitive: true,
  targetType: "family_referral",
}));
exports.claimFamilyReferral = onCall(protect(referrals.claimFamilyReferral, {
  rateLimit: "referral",
  audit: "referral.claim",
  sensitive: true,
  targetType: "family_referral",
}));
exports.completeFamilyReferral = onCall(protect(referrals.completeFamilyReferral, {
  rateLimit: "default",
  audit: "referral.complete",
  sensitive: true,
  targetType: "family_referral",
}));

exports.onNotificationCreated = onDocumentCreated(
  "users/{userId}/notifications/{notificationId}",
  notifications.onNotificationCreated
);

exports.dispatchDueReminders = onSchedule("every 15 minutes", async () => {
  const started = Date.now();
  try {
    const appointmentsDue = await appointments.dispatchAppointmentReminders();
    const medicationsDue = await medications.dispatchMedicationReminders();
    const durationMs = Date.now() - started;
    logger.info("Due reminders scanned", {
      appointments: appointmentsDue,
      medications: medicationsDue,
      durationMs,
    });
    if (durationMs >= 2500) {
      monitoring.recordFunctionLog({
        name: "dispatchDueReminders",
        ok: true,
        durationMs,
      });
    }
  } catch (error) {
    monitoring.recordFunctionLog({
      name: "dispatchDueReminders",
      ok: false,
      durationMs: Date.now() - started,
      code: error.code || "internal",
      message: error.message || "Reminder dispatch failed",
    });
    logger.error("Due reminders failed", { message: error.message });
    throw error;
  }
});

const adminProtect = (handler, extra = {}) => protect(handler, { admin: true, rateLimit: "admin", ...extra });

exports.adminGetOverview = onCall(adminProtect(adminConsole.adminGetOverview));
exports.adminListUsers = onCall(adminProtect(adminConsole.adminListUsers));
exports.adminGetUser = onCall(adminProtect(adminConsole.adminGetUser));
exports.adminUpdateUser = onCall(adminProtect(adminConsole.adminUpdateUser, { sensitive: true }));
exports.adminSetUserSuspended = onCall(adminProtect(adminConsole.adminSetUserSuspended, { sensitive: true }));
exports.adminListFamilies = onCall(adminProtect(adminConsole.adminListFamilies));
exports.adminListSeniors = onCall(adminProtect(adminConsole.adminListSeniors));
exports.adminGetSenior = onCall(adminProtect(adminConsole.adminGetSenior));
exports.adminListProfessionals = onCall(adminProtect(adminConsole.adminListProfessionals));
exports.adminListSubscriptions = onCall(adminProtect(adminConsole.adminListSubscriptions));
exports.adminSetPlanGrant = onCall(adminProtect(adminConsole.adminSetPlanGrant, { sensitive: true }));
exports.adminGetPayments = onCall(stripeBilling.checkoutOptions, adminProtect(async (request) => {
  await adminConsole.requireAdmin(request);
  return stripeBilling.listPlatformPayments();
}, { name: "adminGetPayments" }));
exports.adminListInvites = onCall(adminProtect(adminConsole.adminListInvites));
exports.adminRevokeInvite = onCall(adminProtect(adminConsole.adminRevokeInvite, { sensitive: true }));
exports.adminListFamilyReferrals = onCall(adminProtect(referrals.adminListFamilyReferrals));
exports.adminGetReports = onCall(adminProtect(adminConsole.adminGetReports));
exports.adminGetProductAnalytics = onCall(adminProtect(analytics.adminGetProductAnalytics));
exports.adminGetHealthOverview = onCall(adminProtect(monitoring.adminGetHealthOverview));
exports.reportMonitoringEvent = onCall({ invoker: "public" }, protect(monitoring.reportMonitoringEvent, {
  public: true,
  rateLimit: "monitor",
  monitor: false,
}));
exports.adminListNotifications = onCall(adminProtect(adminConsole.adminListNotifications));
exports.adminSendNotification = onCall(adminProtect(adminConsole.adminSendNotification, {
  rateLimit: "notice",
  sensitive: true,
}));
exports.adminListSupportTickets = onCall(adminProtect(adminConsole.adminListSupportTickets));
exports.adminCreateSupportTicket = onCall(adminProtect(adminConsole.adminCreateSupportTicket));
exports.adminUpdateSupportTicket = onCall(adminProtect(adminConsole.adminUpdateSupportTicket));
exports.adminListAuditLogs = onCall(adminProtect(adminConsole.adminListAuditLogs));
exports.createSupportTicket = onCall(protect(adminConsole.createSupportTicket, {
  rateLimit: "ticket",
  audit: "support.created",
}));
exports.submitPublicContact = onCall(mail.contactOptions, protect(adminConsole.submitPublicContact, {
  public: true,
  rateLimit: "contact",
}));

exports.onAuthUserCreated = functionsV1.auth.user().onCreate(async (user) => {
  await analytics.trackQuietly({
    name: analytics.NAMES.REGISTRATION,
    userId: user.uid,
    platform: "server",
    dedupeKey: `registration:${user.uid}`,
  });
  await monitoring.recordQuiet({
    kind: monitoring.KINDS.AUTH,
    name: "register",
    ok: true,
    status: "ok",
    userId: user.uid,
  });
});

exports.onAuthUserDeleted = functionsV1.auth.user().onDelete(async (user) => {
  const db = getFirestore();
  await Promise.all([
    db.doc(`users/${user.uid}`).delete(),
    db.doc(`subscriptions/${user.uid}`).delete(),
  ]);
  await security.writeSystemAudit("user.deleted", { targetId: user.uid, sensitive: true });
  logger.info("Removed Famielda profile for deleted Auth user", { uid: user.uid });
});

exports.saveCarePlan = onCall(protect(carePlans.saveCarePlan, {
  rateLimit: "care",
  audit: "care.plan.save",
}));
exports.assignCarePlanTask = onCall(protect(carePlans.assignCarePlanTask, {
  rateLimit: "care",
  audit: "care.task.assign",
}));
exports.completeCarePlanTask = onCall(protect(carePlans.completeCarePlanTask, {
  rateLimit: "care",
  audit: "care.task.complete",
}));
exports.addCareTaskNote = onCall(protect(carePlans.addCareTaskNote, {
  rateLimit: "care",
}));
exports.saveAppointment = onCall(protect(appointments.saveAppointment, {
  rateLimit: "care",
  audit: "care.appointment.save",
}));
exports.cancelAppointment = onCall(protect(appointments.cancelAppointment, {
  rateLimit: "care",
  audit: "care.appointment.cancel",
  sensitive: true,
}));
exports.updateAppointmentStatus = onCall(protect(appointments.updateAppointmentStatus, {
  rateLimit: "care",
}));
exports.saveMedication = onCall(protect(medications.saveMedication, {
  rateLimit: "care",
  audit: "care.medication.save",
  sensitive: true,
}));
exports.logMedicationDose = onCall(protect(medications.logMedicationDose, {
  rateLimit: "care",
  audit: "care.medication.dose",
}));
exports.createPlusCheckout = onCall(
  stripeBilling.checkoutOptions,
  protect(stripeBilling.createPlusCheckout, { rateLimit: "billing", audit: "billing.checkout", sensitive: true }),
);
exports.createBillingPortal = onCall(
  stripeBilling.checkoutOptions,
  protect(stripeBilling.createBillingPortal, { rateLimit: "billing", audit: "billing.portal", sensitive: true }),
);
exports.resumePlusSubscription = onCall(
  stripeBilling.checkoutOptions,
  protect(stripeBilling.resumePlusSubscription, { rateLimit: "billing", audit: "billing.resume", sensitive: true }),
);
exports.getBillingSnapshot = onCall(
  stripeBilling.checkoutOptions,
  protect(stripeBilling.getBillingSnapshot, { rateLimit: "billing" }),
);
exports.finalizePlusCheckout = onCall(
  stripeBilling.checkoutOptions,
  protect(stripeBilling.finalizePlusCheckout, { rateLimit: "billing", audit: "billing.finalize" }),
);
