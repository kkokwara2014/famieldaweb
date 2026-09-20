const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const notifications = require("./notifications");

const USERS = "users";
const SENIORS = "seniors";
const APPOINTMENTS = "appointments";

const STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "missed", "rescheduled"];
const REMINDERS = {
  none: null,
  at_time: 0,
  "15min": 15,
  "1hour": 60,
  "1day": 1440,
  "2days": 2880,
};

function db() {
  return getFirestore();
}

// Canonical placement is seniors/{seniorId}/appointments. Falls back to the
// pre-migration top-level collection when no senior id is known.
function appointmentsCol(seniorId) {
  return seniorId
    ? db().collection(`${SENIORS}/${seniorId}/${APPOINTMENTS}`)
    : db().collection(APPOINTMENTS);
}

function appointmentDoc(seniorId, appointmentId) {
  return seniorId
    ? db().doc(`${SENIORS}/${seniorId}/${APPOINTMENTS}/${appointmentId}`)
    : db().doc(`${APPOINTMENTS}/${appointmentId}`);
}

async function loadAppointment(appointmentId) {
  if (!appointmentId) return null;
  const group = await db().collectionGroup(APPOINTMENTS)
    .where(FieldPath.documentId(), "==", appointmentId)
    .limit(1)
    .get();
  if (!group.empty) {
    const doc = group.docs[0];
    return { id: doc.id, ...doc.data(), ref: doc.ref };
  }
  // Backward-compatible: pre-migration top-level appointments.
  const legacy = await db().doc(`${APPOINTMENTS}/${appointmentId}`).get();
  if (legacy.exists) return { id: legacy.id, ...legacy.data(), ref: legacy.ref };
  return null;
}

function requireUid(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
}

function reminderAt(date, time, reminder) {
  const offset = REMINDERS[reminder];
  if (offset == null) return null;
  const [year, month, day] = String(date || "").split("-").map(Number);
  const [hours, minutes] = String(time || "09:00").split(":").map(Number);
  if (!year || !month || !day) return null;
  const start = new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0);
  return new Date(start.getTime() - offset * 60_000).toISOString();
}

async function loadUser(uid) {
  const snap = await db().doc(`${USERS}/${uid}`).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { id: snap.id, ...snap.data() };
}

async function loadSenior(seniorId) {
  const snap = await db().doc(`${SENIORS}/${seniorId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Senior record not found.");
  return { id: snap.id, ...snap.data() };
}

function isMember(senior, uid) {
  return senior.ownerId === uid || (Array.isArray(senior.memberIds) && senior.memberIds.includes(uid));
}

function canManage(user, senior) {
  if (user.role === "admin" || user.role === "family" || user.role === "health_practitioner") return true;
  return senior.ownerId === user.id;
}

function canAct(user, appointment) {
  if (canManage(user, { ownerId: appointment.createdBy })) return true;
  if (appointment.practitionerUserId && appointment.practitionerUserId === user.id) return true;
  return String(appointment.practitionerEmail || "").toLowerCase() === String(user.email || "").toLowerCase();
}

async function requireHousehold(request, seniorId) {
  const uid = requireUid(request);
  const [user, senior] = await Promise.all([loadUser(uid), loadSenior(seniorId)]);
  if (!isMember(senior, uid)) {
    throw new HttpsError("permission-denied", "You are not on this household.");
  }
  return { uid, user, senior };
}

exports.saveAppointment = async (request) => {
  const input = request.data || {};
  const { uid, user, senior } = await requireHousehold(request, input.seniorId);
  if (!canManage(user, senior)) {
    throw new HttpsError("permission-denied", "You need permission to change appointments.");
  }
  const title = String(input.title || "").trim();
  if (!title) throw new HttpsError("invalid-argument", "Give this appointment a name.");
  const date = String(input.date || "").trim();
  const time = String(input.time || "").trim();
  if (!date || !time) throw new HttpsError("invalid-argument", "Set a date and time for this appointment.");
  const reminder = Object.prototype.hasOwnProperty.call(REMINDERS, input.reminder) ? input.reminder : "1day";
  const status = STATUSES.includes(input.status) ? input.status : "scheduled";
  const ref = input.appointmentId
    ? appointmentDoc(senior.id, input.appointmentId)
    : appointmentsCol(senior.id).doc();
  const existing = input.appointmentId ? await ref.get() : null;
  if (input.appointmentId && (!existing.exists || existing.data().seniorId !== senior.id)) {
    // Backward-compatible: accept a pre-migration top-level appointment, then
    // migrate it into the canonical subcollection on write.
    const legacy = await db().doc(`${APPOINTMENTS}/${input.appointmentId}`).get();
    if (!legacy.exists || legacy.data().seniorId !== senior.id) {
      throw new HttpsError("not-found", "That appointment could not be found.");
    }
  }
  const payload = {
    seniorId: senior.id,
    title,
    date,
    time,
    endTime: String(input.endTime || "").trim(),
    location: String(input.location || "").trim(),
    notes: String(input.notes || "").trim(),
    status: status === "cancelled" ? "cancelled" : status,
    practitionerId: input.practitionerId || "",
    practitionerUserId: input.practitionerUserId || "",
    practitionerEmail: String(input.practitionerEmail || "").trim().toLowerCase(),
    practitionerName: input.practitionerName || "",
    reminder,
    reminderAt: reminderAt(date, time, reminder),
    reminderSent: false,
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing?.exists) {
    payload.createdBy = uid;
    payload.createdByName = user.displayName || "";
    payload.createdAt = FieldValue.serverTimestamp();
  }
  await ref.set(payload, { merge: true });
  const snap = await ref.get();
  return { id: ref.id, ...snap.data() };
};

exports.cancelAppointment = async (request) => {
  const input = request.data || {};
  const uid = requireUid(request);
  const appointment = await loadAppointment(input.appointmentId);
  if (!appointment) throw new HttpsError("not-found", "That appointment could not be found.");
  const { user, senior } = await requireHousehold(request, appointment.seniorId);
  if (!canManage(user, senior)) {
    throw new HttpsError("permission-denied", "You need permission to cancel appointments.");
  }
  if (appointment.status === "completed") {
    throw new HttpsError("failed-precondition", "A completed appointment cannot be cancelled.");
  }
  const ref = appointmentDoc(appointment.seniorId, appointment.id);
  await ref.set({
    status: "cancelled",
    reminderSent: true,
    cancelReason: String(input.reason || "").trim(),
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledBy: uid,
    cancelledByName: user.displayName || "",
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const next = await ref.get();
  return { id: ref.id, ...next.data() };
};

exports.updateAppointmentStatus = async (request) => {
  const input = request.data || {};
  const uid = requireUid(request);
  const appointment = await loadAppointment(input.appointmentId);
  if (!appointment) throw new HttpsError("not-found", "That appointment could not be found.");
  const { user } = await requireHousehold(request, appointment.seniorId);
  if (!canAct(user, appointment) && !canManage(user, { ownerId: appointment.createdBy })) {
    throw new HttpsError("permission-denied", "You can only update appointments assigned to you.");
  }
  const status = STATUSES.includes(input.status) ? input.status : "";
  if (!status) throw new HttpsError("invalid-argument", "Choose a valid appointment status.");
  if (appointment.status === "cancelled") {
    throw new HttpsError("failed-precondition", "A cancelled appointment cannot change status.");
  }
  const ref = appointmentDoc(appointment.seniorId, appointment.id);
  await ref.set({
    status,
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const next = await ref.get();
  return { id: ref.id, ...next.data() };
};

exports.dispatchAppointmentReminders = async () => {
  const now = new Date().toISOString();
  const due = await db().collectionGroup(APPOINTMENTS)
    .where("reminderSent", "==", false)
    .where("reminderAt", "<=", now)
    .limit(50)
    .get();
  const docs = [...due.docs];
  // Backward-compatible: pre-migration top-level appointments.
  try {
    const legacy = await db().collection(APPOINTMENTS)
      .where("reminderSent", "==", false)
      .where("reminderAt", "<=", now)
      .limit(50)
      .get();
    const seen = new Set(docs.map((doc) => doc.ref.path));
    for (const doc of legacy.docs) {
      if (!seen.has(doc.ref.path)) docs.push(doc);
    }
  } catch (error) {
    // Legacy collection may be absent; canonical data is authoritative.
  }

  let sent = 0;
  for (const doc of docs) {
    const item = { id: doc.id, ...doc.data() };
    if (item.status === "cancelled" || item.status === "completed") {
      await doc.ref.set({ reminderSent: true }, { merge: true });
      continue;
    }
    await notifications.notifyHousehold(item.seniorId, {
      type: notifications.TYPES.APPOINTMENT_REMINDER,
      title: `Reminder · ${item.title}`,
      body: [item.date, item.time, item.location, item.practitionerName].filter(Boolean).join(" · "),
      appointmentId: item.id,
      entityType: "appointment",
      entityId: item.id,
    });
    await doc.ref.set({ reminderSent: true }, { merge: true });
    sent += 1;
  }
  return { scanned: docs.length, sent };
};
