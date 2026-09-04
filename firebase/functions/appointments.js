const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const notifications = require("./notifications");

const USERS = "users";
const SENIORS = "seniors";
const APPOINTMENTS = "appointments";

const STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "missed"];
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
  const ref = input.appointmentId ? db().doc(`${APPOINTMENTS}/${input.appointmentId}`) : db().collection(APPOINTMENTS).doc();
  const existing = input.appointmentId ? await ref.get() : null;
  if (input.appointmentId && (!existing.exists || existing.data().seniorId !== senior.id)) {
    throw new HttpsError("not-found", "That appointment could not be found.");
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
  const ref = db().doc(`${APPOINTMENTS}/${input.appointmentId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That appointment could not be found.");
  const appointment = { id: snap.id, ...snap.data() };
  const { user, senior } = await requireHousehold(request, appointment.seniorId);
  if (!canManage(user, senior)) {
    throw new HttpsError("permission-denied", "You need permission to cancel appointments.");
  }
  if (appointment.status === "completed") {
    throw new HttpsError("failed-precondition", "A completed appointment cannot be cancelled.");
  }
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
  const ref = db().doc(`${APPOINTMENTS}/${input.appointmentId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That appointment could not be found.");
  const appointment = { id: snap.id, ...snap.data() };
  const { user } = await requireHousehold(request, appointment.seniorId);
  if (!canAct(user, appointment) && !canManage(user, { ownerId: appointment.createdBy })) {
    throw new HttpsError("permission-denied", "You can only update appointments assigned to you.");
  }
  const status = STATUSES.includes(input.status) ? input.status : "";
  if (!status) throw new HttpsError("invalid-argument", "Choose a valid appointment status.");
  if (appointment.status === "cancelled") {
    throw new HttpsError("failed-precondition", "A cancelled appointment cannot change status.");
  }
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
  const due = await db().collection(APPOINTMENTS)
    .where("reminderSent", "==", false)
    .where("reminderAt", "<=", now)
    .limit(50)
    .get();

  let sent = 0;
  for (const doc of due.docs) {
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
  return { scanned: due.size, sent };
};
