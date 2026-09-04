const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const notifications = require("./notifications");
const engine = require("./availability-engine");
const verification = require("./verification");
const analytics = require("./analytics");

const USERS = "users";
const SENIORS = "seniors";
const MEMBERS = "careCircleMembers";
const VISITS = "scheduleVisits";

const MANAGE_SCHEDULE = "manage_schedule";

function db() {
  return getFirestore();
}

function requireUid(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
}

function emailOf(request) {
  return String(request.auth?.token?.email || "").trim().toLowerCase();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return null;
}

function toClient(visit) {
  if (!visit) return visit;
  const notes = Array.isArray(visit.notes)
    ? visit.notes.map((note) => ({ ...note, createdAt: toIso(note.createdAt) }))
    : [];
  const report = visit.report
    ? { ...visit.report, submittedAt: toIso(visit.report.submittedAt) }
    : null;
  return {
    ...visit,
    notes,
    report,
    requestedAt: toIso(visit.requestedAt),
    respondedAt: toIso(visit.respondedAt),
    checkedInAt: toIso(visit.checkedInAt),
    checkedOutAt: toIso(visit.checkedOutAt),
    modifiedAt: toIso(visit.modifiedAt),
    createdAt: toIso(visit.createdAt),
    updatedAt: toIso(visit.updatedAt),
  };
}

async function loadUser(uid) {
  const snap = await db().doc(`${USERS}/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { id: snap.id, ...snap.data() };
}

async function loadSenior(seniorId) {
  const snap = await db().doc(`${SENIORS}/${seniorId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Senior profile not found.");
  return { id: snap.id, ...snap.data() };
}

async function loadVisit(visitId) {
  if (!visitId) throw new HttpsError("invalid-argument", "visitId is required.");
  const snap = await db().doc(`${VISITS}/${visitId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That visit could not be found.");
  return { id: snap.id, ...snap.data() };
}

async function listMembers(seniorId) {
  const snap = await db().collection(MEMBERS).where("seniorId", "==", seniorId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function isSeniorMember(senior, uid) {
  return senior.ownerId === uid || (Array.isArray(senior.memberIds) && senior.memberIds.includes(uid));
}

function isAssigned(visit, uid, email) {
  return visit.caregiverUserId === uid || engine.emailsEqual(visit.caregiverEmail, email);
}

function canManageSchedule(user, senior, members) {
  if (user.role === "admin") return true;
  if (senior.ownerId === user.id) return true;
  const actor = members.find((member) => (
    member.userId === user.id || engine.emailsEqual(member.email, user.email)
  ));
  return Array.isArray(actor?.permissions) && actor.permissions.includes(MANAGE_SCHEDULE);
}

function assertCanRequest(user, senior, members) {
  if (user.role === "caregiver") {
    throw new HttpsError("permission-denied", "Families request visits. You can accept or decline them here.");
  }
  if (user.role === "health_practitioner") {
    throw new HttpsError("permission-denied", "Families request appointments. You can accept or decline them here.");
  }
  if (!canManageSchedule(user, senior, members)) {
    throw new HttpsError("permission-denied", "You need permission to change this household’s schedule.");
  }
}

function assertCanChangeSlot(user, visit, senior, members, uid, email) {
  if (isAssigned(visit, uid, email)) return;
  if (senior && canManageSchedule(user, senior, members)) return;
  throw new HttpsError("permission-denied", "You cannot change this visit.");
}

function findProfessional(members, idOrEmail, kind) {
  const needle = String(idOrEmail || "").trim().toLowerCase();
  return members.find((member) => (
    member.status === "active"
    && (!kind || member.kind === kind)
    && (member.kind === "caregiver" || member.kind === "practitioner")
    && (
      member.id === idOrEmail
      || member.userId === idOrEmail
      || engine.emailsEqual(member.email, needle)
    )
  )) ?? null;
}

async function householdForVisit(uid, visit) {
  const [user, senior, members] = await Promise.all([
    loadUser(uid),
    loadSenior(visit.seniorId),
    listMembers(visit.seniorId),
  ]);
  if (!isSeniorMember(senior, uid) && !isAssigned(visit, uid, user.email)) {
    throw new HttpsError("permission-denied", "You are not on this household.");
  }
  return { user, senior, members };
}

async function noticeVisit(visit, payload, actorId) {
  await notifications.notifyPeople([
    { userId: visit.caregiverUserId, email: visit.caregiverEmail },
    { userId: visit.requestedBy },
    { userId: visit.familyId },
  ], {
    seniorId: visit.seniorId,
    visitId: visit.id,
    entityType: "visit",
    entityId: visit.id,
    ...payload,
  }, actorId);
}

async function commit(visit, options) {
  const saved = await engine.commitEngagement(visit, options);
  return toClient(saved);
}

async function withAvailability(candidate) {
  const windows = await engine.loadAvailability(candidate.caregiverUserId, candidate.caregiverEmail);
  engine.assertFitsAvailability(candidate, windows);
}

exports.previewScheduleConflict = async (request) => {
  requireUid(request);
  const input = request.data || {};
  const timeZone = await engine.resolveProfessionalTimeZone(
    input.caregiverUserId,
    input.caregiverEmail,
    input.timeZone,
  );
  return engine.previewConflict({
    visitId: input.visitId || "",
    caregiverUserId: input.caregiverUserId || "",
    caregiverEmail: String(input.caregiverEmail || "").trim().toLowerCase(),
    caregiverName: input.caregiverName || "",
    professionalKind: input.professionalKind === "practitioner" ? "practitioner" : "caregiver",
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    timeZone,
  });
};

exports.requestScheduleVisit = async (request) => {
  const uid = requireUid(request);
  const input = request.data || {};
  const user = await loadUser(uid);
  const seniorId = input.seniorId || user.seniorId;
  if (!seniorId) throw new HttpsError("failed-precondition", "Create a senior profile before requesting a visit.");
  const [senior, members] = await Promise.all([loadSenior(seniorId), listMembers(seniorId)]);
  if (!isSeniorMember(senior, uid)) {
    throw new HttpsError("permission-denied", "You are not on this household.");
  }
  assertCanRequest(user, senior, members);

  const kind = input.professionalKind === "practitioner" ? "practitioner" : "caregiver";
  const professional = findProfessional(
    members,
    input.caregiverId || input.practitionerId || input.caregiverEmail,
    kind,
  );
  if (!professional) {
    throw new HttpsError(
      "invalid-argument",
      kind === "practitioner" ? "Choose a health practitioner on this circle." : "Choose a caregiver on this circle.",
    );
  }
  await verification.assertEligibleForVisits(professional.userId, professional.email);

  const timeZone = await engine.resolveProfessionalTimeZone(
    professional.userId,
    professional.email,
    input.timeZone,
  );
  const draft = {
    professionalKind: kind,
    seniorId: senior.id,
    seniorName: senior.displayName || "",
    familyId: senior.ownerId || uid,
    familyName: user.displayName || "",
    caregiverUserId: professional.userId || "",
    caregiverEmail: String(professional.email || "").trim().toLowerCase(),
    caregiverName: professional.name || "",
    caregiverMemberId: professional.id,
    title: String(input.title || (kind === "practitioner" ? "Appointment" : "Care visit")).trim()
      || (kind === "practitioner" ? "Appointment" : "Care visit"),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    originalEndTime: input.endTime,
    extensionMinutes: 0,
    timeZone,
    status: engine.STATUS.REQUESTED,
    requestedBy: uid,
    requestedByName: user.displayName || "",
    requestedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  engine.assertValidWindow(draft);
  await withAvailability(draft);
  const preview = await engine.previewConflict(draft);
  if (!preview.ok && preview.overlap) {
    throw new HttpsError("failed-precondition", preview.message);
  }
  if (!preview.ok) {
    throw new HttpsError("failed-precondition", preview.message);
  }

  const saved = await commit(draft);
  await noticeVisit(saved, {
    type: notifications.TYPES.SCHEDULE_REQUEST,
    title: `${saved.title} requested`,
    body: `${user.displayName || "A family member"} requested ${saved.title} for ${senior.displayName || "this senior"} on ${saved.date}.`,
  }, uid);
  const actor = await analytics.actorFields(uid);
  await analytics.trackQuietly({
    name: analytics.NAMES.SCHEDULE_CREATED,
    ...actor,
    visitId: saved.id,
    seniorId: saved.seniorId || "",
    professionalKind: saved.professionalKind || "",
    platform: "server",
    dedupeKey: `schedule_created:${saved.id}`,
  });
  return saved;
};

exports.acceptScheduleVisit = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  if (!isAssigned(visit, uid, email)) {
    throw new HttpsError("permission-denied", "That visit is not assigned to you.");
  }
  await verification.assertEligibleForVisits(uid, email);
  if (visit.status !== engine.STATUS.REQUESTED) {
    throw new HttpsError("failed-precondition", "Only requested visits can be accepted.");
  }
  const timeZone = visit.timeZone || await engine.resolveProfessionalTimeZone(visit.caregiverUserId, visit.caregiverEmail);
  const next = { ...visit, timeZone, status: engine.STATUS.ACCEPTED, respondedAt: new Date(), updatedAt: new Date() };
  engine.assertValidWindow(next);
  await withAvailability(next);
  const saved = await commit(next);
  await noticeVisit(saved, {
    type: notifications.TYPES.SCHEDULE_ACCEPTED,
    title: `${saved.title || "Visit"} accepted`,
    body: `The requested time on ${saved.date} was accepted.`,
  }, uid);
  return saved;
};

exports.declineScheduleVisit = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  if (!isAssigned(visit, uid, email)) {
    throw new HttpsError("permission-denied", "That visit is not assigned to you.");
  }
  if (visit.status !== engine.STATUS.REQUESTED) {
    throw new HttpsError("failed-precondition", "Only requested visits can be declined.");
  }
  const saved = await commit({
    ...visit,
    status: engine.STATUS.DECLINED,
    declineReason: String(request.data?.reason || "").trim(),
    respondedAt: new Date(),
    updatedAt: new Date(),
  });
  await noticeVisit(saved, {
    type: notifications.TYPES.SCHEDULE_CHANGED,
    title: `${saved.title || "Visit"} declined`,
    body: saved.declineReason || "The requested time was declined.",
  }, uid);
  return saved;
};

exports.cancelScheduleVisit = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  const { user, senior, members } = await householdForVisit(uid, visit);
  assertCanChangeSlot(user, visit, senior, members, uid, email);
  if (![engine.STATUS.REQUESTED, engine.STATUS.ACCEPTED].includes(visit.status)) {
    throw new HttpsError("failed-precondition", "That visit can no longer be cancelled.");
  }
  const saved = await commit({
    ...visit,
    status: engine.STATUS.CANCELLED,
    respondedAt: new Date(),
    updatedAt: new Date(),
  });
  await noticeVisit(saved, {
    type: notifications.TYPES.SCHEDULE_CHANGED,
    title: `${saved.title || "Visit"} cancelled`,
    body: `${user.displayName || "Someone"} cancelled ${saved.title || "the visit"} on ${saved.date}.`,
  }, uid);
  return saved;
};

exports.modifyScheduleVisit = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const input = request.data || {};
  const visit = await loadVisit(input.visitId);
  const { user, senior, members } = await householdForVisit(uid, visit);
  const practitionerOwn = isAssigned(visit, uid, email)
    && visit.professionalKind === "practitioner"
    && user.role === "health_practitioner";
  if (!practitionerOwn) assertCanChangeSlot(user, visit, senior, members, uid, email);
  if (![engine.STATUS.REQUESTED, engine.STATUS.ACCEPTED].includes(visit.status)) {
    throw new HttpsError("failed-precondition", "Only upcoming visits can be changed. Extend a visit that is already under way.");
  }

  const timeZone = visit.timeZone || await engine.resolveProfessionalTimeZone(visit.caregiverUserId, visit.caregiverEmail);
  const next = {
    ...visit,
    title: String(input.title || visit.title).trim() || visit.title,
    date: input.date || visit.date,
    startTime: input.startTime || visit.startTime,
    endTime: input.endTime || visit.endTime,
    originalEndTime: visit.originalEndTime || visit.endTime,
    extensionMinutes: 0,
    timeZone,
    modifiedAt: new Date(),
    modifiedBy: user.displayName || "",
    updatedAt: new Date(),
  };
  engine.assertValidWindow(next);
  await withAvailability(next);
  const saved = await commit(next, { ignoreVisitId: visit.id });
  await noticeVisit(saved, {
    type: notifications.TYPES.SCHEDULE_CHANGED,
    title: `${saved.title || "Visit"} was changed`,
    body: `${user.displayName || "Someone"} moved ${saved.title || "the visit"} to ${saved.date} · ${saved.startTime}–${saved.endTime}.`,
  }, uid);
  return saved;
};

exports.extendScheduleVisit = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  const minutes = Number(request.data?.minutes);
  if (!Number.isFinite(minutes) || minutes < engine.MIN_EXTENSION) {
    throw new HttpsError("invalid-argument", "Extend the visit by at least 15 minutes.");
  }
  const { user, senior, members } = await householdForVisit(uid, visit);
  assertCanChangeSlot(user, visit, senior, members, uid, email);
  if (![engine.STATUS.ACCEPTED, engine.STATUS.CHECKED_IN].includes(visit.status)) {
    throw new HttpsError("failed-precondition", "Only an accepted or in-progress visit can be extended.");
  }

  const endTime = engine.extendEndTime(visit.endTime, minutes);
  if (!endTime) {
    throw new HttpsError("failed-precondition", "That extension would run past midnight. Split it into a new visit instead.");
  }

  const timeZone = visit.timeZone || await engine.resolveProfessionalTimeZone(visit.caregiverUserId, visit.caregiverEmail);
  const next = {
    ...visit,
    endTime,
    originalEndTime: visit.originalEndTime || visit.endTime,
    extensionMinutes: Number(visit.extensionMinutes || 0) + minutes,
    timeZone,
    modifiedAt: new Date(),
    modifiedBy: user.displayName || "",
    updatedAt: new Date(),
  };
  engine.assertValidWindow(next);
  await withAvailability(next);
  const saved = await commit(next, { ignoreVisitId: visit.id });
  await noticeVisit(saved, {
    type: notifications.TYPES.SCHEDULE_CHANGED,
    title: `${saved.title || "Visit"} was extended`,
    body: `${user.displayName || "Someone"} extended ${saved.title || "the visit"} by ${minutes} minutes.`,
  }, uid);
  return saved;
};

exports.checkInVisit = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  if (!isAssigned(visit, uid, email)) {
    throw new HttpsError("permission-denied", "That visit is not assigned to you.");
  }
  if (visit.status !== engine.STATUS.ACCEPTED) {
    throw new HttpsError("failed-precondition", "Accept the visit before checking in.");
  }
  const timeZone = visit.timeZone || await engine.resolveProfessionalTimeZone(visit.caregiverUserId, visit.caregiverEmail);
  const today = engine.civilDateInZone(Date.now(), timeZone);
  if (visit.date !== today) {
    throw new HttpsError("failed-precondition", "Check in on the day of the visit.");
  }
  return commit({
    ...visit,
    timeZone,
    status: engine.STATUS.CHECKED_IN,
    checkedInAt: new Date(),
    updatedAt: new Date(),
  });
};

exports.checkOutVisit = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  if (!isAssigned(visit, uid, email)) {
    throw new HttpsError("permission-denied", "That visit is not assigned to you.");
  }
  if (visit.status !== engine.STATUS.CHECKED_IN) {
    throw new HttpsError("failed-precondition", "Check in before you check out.");
  }
  const notes = Array.isArray(visit.notes) ? [...visit.notes] : [];
  const body = String(request.data?.note || "").trim();
  if (body) {
    notes.push({
      id: `note-${Date.now().toString(36)}`,
      body,
      author: (await loadUser(uid)).displayName || "",
      authorId: uid,
      createdAt: new Date(),
    });
  }
  const saved = await commit({
    ...visit,
    status: engine.STATUS.CHECKED_OUT,
    checkedOutAt: new Date(),
    notes,
    updatedAt: new Date(),
  });
  const actor = await analytics.actorFields(uid);
  await analytics.trackQuietly({
    name: analytics.NAMES.VISIT_COMPLETED,
    ...actor,
    visitId: saved.id,
    seniorId: saved.seniorId || "",
    professionalKind: saved.professionalKind || "",
    platform: "server",
    dedupeKey: `visit_completed:${saved.id}`,
  });
  return saved;
};

exports.addVisitNote = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  const { user, senior, members } = await householdForVisit(uid, visit);
  if (!isAssigned(visit, uid, email) && !canManageSchedule(user, senior, members)) {
    throw new HttpsError("permission-denied", "You cannot add a note to this visit.");
  }
  if (![engine.STATUS.ACCEPTED, engine.STATUS.CHECKED_IN, engine.STATUS.CHECKED_OUT].includes(visit.status)) {
    throw new HttpsError("failed-precondition", "Notes can be added after the visit is accepted.");
  }
  const text = String(request.data?.body || "").trim();
  if (!text) throw new HttpsError("invalid-argument", "Write a visit note.");
  const notes = Array.isArray(visit.notes) ? [...visit.notes] : [];
  notes.push({
    id: `note-${Date.now().toString(36)}`,
    body: text,
    author: user.displayName || "",
    authorId: uid,
    createdAt: new Date(),
  });
  const saved = await commit({ ...visit, notes, updatedAt: new Date() });
  return saved;
};

exports.submitVisitReport = async (request) => {
  const uid = requireUid(request);
  const email = emailOf(request);
  const visit = await loadVisit(request.data?.visitId);
  if (!isAssigned(visit, uid, email)) {
    throw new HttpsError("permission-denied", "That visit is not assigned to you.");
  }
  if (visit.status !== engine.STATUS.CHECKED_OUT && visit.status !== engine.STATUS.CHECKED_IN) {
    throw new HttpsError("failed-precondition", "Write the visit report after you have been with them.");
  }
  const input = request.data || {};
  const summary = String(input.summary || "").trim();
  if (!summary) throw new HttpsError("invalid-argument", "Add a short summary for the family.");
  const user = await loadUser(uid);
  const submittedAt = new Date();
  const saved = await commit({
    ...visit,
    report: {
      summary,
      mood: input.mood || "typical",
      meals: String(input.meals || "").trim(),
      mobility: String(input.mobility || "").trim(),
      concerns: String(input.concerns || "").trim(),
      followUp: String(input.followUp || "").trim(),
      submittedAt,
      submittedBy: user.displayName || "",
      submittedById: uid,
    },
    updatedAt: new Date(),
  });
  const urgent = saved.report?.mood === "unwell" || Boolean(saved.report?.concerns);
  await noticeVisit(saved, {
    type: urgent ? notifications.TYPES.EMERGENCY_ALERT : notifications.TYPES.CARE_UPDATE,
    title: urgent ? `${saved.caregiverName || user.displayName} flagged ${saved.seniorName}` : "Visit report submitted",
    body: summary,
  }, uid);
  return saved;
};

async function saveAvailability(request) {
  const uid = requireUid(request);
  const email = emailOf(request);
  const user = await loadUser(uid);
  if (user.role !== "caregiver" && user.role !== "health_practitioner" && user.role !== "admin") {
    throw new HttpsError("permission-denied", "Only the assigned professional can set this availability.");
  }
  const kind = user.role === "health_practitioner" ? "practitioner" : "caregiver";
  return engine.saveAvailability({
    uid,
    email,
    name: user.displayName || "",
    kind,
    timeZone: request.data?.timeZone,
    weekly: request.data?.weekly,
    block: request.data?.block,
  });
}

exports.saveProfessionalAvailability = saveAvailability;
exports.saveCaregiverAvailability = saveAvailability;
exports.savePractitionerAvailability = saveAvailability;
