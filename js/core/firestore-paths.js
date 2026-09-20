// Canonical Firestore paths for the unified mobile + web schema.
// Contract: famieldaweb/SCHEMA_ALIGNMENT.md
//
// Entities (users, families, seniors) are top-level. Senior-scoped care data
// lives in subcollections under seniors/{seniorId}. All web services must build
// references through this module so the schema is defined in one place.

import { getFirebaseDb, getFirestoreSdk } from "./firebase.js";

function s() {
  return getFirestoreSdk();
}

function d() {
  return getFirebaseDb();
}

// ------------------------------------------------------------------- users

export function usersCol() {
  return s().collection(d(), "users");
}

export function userDoc(uid) {
  return s().doc(d(), "users", uid);
}

export function userNotificationsCol(uid) {
  return s().collection(d(), "users", uid, "notifications");
}

export function userDevicesCol(uid) {
  return s().collection(d(), "users", uid, "devices");
}

// ---------------------------------------------------------------- families

export function familiesCol() {
  return s().collection(d(), "families");
}

export function familyDoc(familyId) {
  return s().doc(d(), "families", familyId);
}

export function familyMembersCol(familyId) {
  return s().collection(d(), "families", familyId, "members");
}

export function familyUsageDoc(familyId) {
  return s().doc(d(), "families", familyId, "usage", "current");
}

export function familySubscriptionDoc(familyId) {
  return s().doc(d(), "families", familyId, "subscription", "current");
}

export function familyPaymentsCol(familyId) {
  return s().collection(d(), "families", familyId, "payments");
}

// Retained additive caregiver roster (mobile). Web resolves a caregiver's
// roster profile id from here so mobile's saveCareShift can assign the shift.
export function familyCaregiversCol(familyId) {
  return s().collection(d(), "families", familyId, "caregivers");
}

// ----------------------------------------------------------------- seniors

export function seniorsCol() {
  return s().collection(d(), "seniors");
}

export function seniorDoc(seniorId) {
  return s().doc(d(), "seniors", seniorId);
}

export function circleMembersCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "circleMembers");
}

export function circleMemberDoc(seniorId, memberId) {
  return s().doc(d(), "seniors", seniorId, "circleMembers", memberId);
}

export function scheduleVisitsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "scheduleVisits");
}

export function carePlansCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "carePlans");
}

export function carePlanTasksCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "carePlanTasks");
}

export function carePlanCompletionsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "carePlanCompletions");
}

export function medicationsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "medications");
}

export function medicationDosesCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "medicationDoses");
}

export function vitalReadingsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "vitalReadings");
}

export function visitReportsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "visitReports");
}

export function appointmentsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "appointments");
}

export function emergencyAlertsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "emergencyAlerts");
}

export function documentsCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "documents");
}

export function activitiesCol(seniorId) {
  return s().collection(d(), "seniors", seniorId, "activities");
}

export function careSummaryDoc(seniorId) {
  return s().doc(d(), "seniors", seniorId, "careSummary", "current");
}

// ------------------------------------------------------- cross-cutting

export function careCircleInvitesCol() {
  return s().collection(d(), "careCircleInvites");
}

export function caregiverScheduleLocksCol() {
  return s().collection(d(), "caregiverScheduleLocks");
}

export function conversationsCol() {
  return s().collection(d(), "conversations");
}

export function messagesCol() {
  return s().collection(d(), "messages");
}

export function professionalDiscoveryCol() {
  return s().collection(d(), "professionalDiscovery");
}

export function professionalRatingsCol() {
  return s().collection(d(), "professionalRatings");
}

export function professionalPublicRatingsCol() {
  return s().collection(d(), "professionalPublicRatings");
}

export function professionalRatingSummariesCol() {
  return s().collection(d(), "professionalRatingSummaries");
}

export function reviewReportsCol() {
  return s().collection(d(), "reviewReports");
}

export function professionalVerificationsCol() {
  return s().collection(d(), "professionalVerifications");
}

export function professionalVerificationDoc(userId) {
  return s().doc(d(), "professionalVerifications", userId);
}

export function professionalVerificationDocumentsCol() {
  return s().collection(d(), "professionalVerificationDocuments");
}

export function familyReferralsCol() {
  return s().collection(d(), "familyReferrals");
}

export function familyReferralCodesCol() {
  return s().collection(d(), "familyReferralCodes");
}

export function familyReferralCodeIndexCol() {
  return s().collection(d(), "familyReferralCodeIndex");
}

export function referralConfigDoc() {
  return s().doc(d(), "referralConfig", "current");
}

export function referralStatsDoc() {
  return s().doc(d(), "referralStats", "platform");
}

export function supportTicketsCol() {
  return s().collection(d(), "supportTickets");
}

export function analyticsEventsCol() {
  return s().collection(d(), "analyticsEvents");
}

export function monitoringEventsCol() {
  return s().collection(d(), "monitoringEvents");
}
