const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const notifications = require("./notifications");
const entitlements = require("./entitlements");

const USERS = "users";
const SENIORS = "seniors";
const MEDICATIONS = "medications";
const MEDICATION_DOSES = "medicationDoses";

const STATUSES = ["active", "paused", "ended"];
const FREQUENCIES = ["once", "daily", "twice_daily", "three_times", "weekly", "every_other", "as_needed"];
const OUTCOMES = ["taken", "skipped"];
const REMINDERS = {
  none: null,
  at_time: 0,
  "15min": 15,
  "1hour": 60,
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

async function requireHousehold(request, seniorId) {
  const uid = requireUid(request);
  const [user, senior] = await Promise.all([loadUser(uid), loadSenior(seniorId)]);
  if (!isMember(senior, uid)) {
    throw new HttpsError("permission-denied", "You are not on this household.");
  }
  return { uid, user, senior };
}

function reminderAt(date, time, reminder) {
  const offset = REMINDERS[reminder];
  if (offset == null) return null;
  const [year, month, day] = String(date || "").split("-").map(Number);
  const [hours, minutes] = String(time || "08:00").split(":").map(Number);
  if (!year || !month || !day) return null;
  const start = new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0);
  return new Date(start.getTime() - offset * 60_000).toISOString();
}

exports.saveMedication = async (request) => {
  const input = request.data || {};
  const { uid, user, senior } = await requireHousehold(request, input.seniorId);
  if (!canManage(user, senior)) {
    throw new HttpsError("permission-denied", "You need permission to change the medication list.");
  }
  if (!entitlements.canUseMedication({ user, owner: senior.ownerId === user.id ? user : await loadUser(senior.ownerId).catch(() => user) })) {
    throw new HttpsError("failed-precondition", entitlements.message("medication"));
  }
  const name = String(input.name || "").trim();
  if (!name) throw new HttpsError("invalid-argument", "Give this medication a name.");
  const dosage = String(input.dosage || "").trim();
  if (!dosage) throw new HttpsError("invalid-argument", "Add the dosage the circle is coordinating.");
  const frequency = FREQUENCIES.includes(input.frequency) ? input.frequency : "daily";
  const reminder = Object.prototype.hasOwnProperty.call(REMINDERS, input.reminder) ? input.reminder : "15min";
  const status = STATUSES.includes(input.status) ? input.status : "active";
  const startDate = String(input.startDate || "").trim();
  const time = String(input.time || "").trim();
  const ref = input.medicationId ? db().doc(`${MEDICATIONS}/${input.medicationId}`) : db().collection(MEDICATIONS).doc();
  const existing = input.medicationId ? await ref.get() : null;
  if (input.medicationId && (!existing.exists || existing.data().seniorId !== senior.id)) {
    throw new HttpsError("not-found", "That medication could not be found.");
  }
  const payload = {
    seniorId: senior.id,
    name,
    dosage,
    frequency,
    time,
    secondTime: String(input.secondTime || "").trim(),
    thirdTime: String(input.thirdTime || "").trim(),
    weekday: input.weekday == null || input.weekday === "" ? null : Number(input.weekday),
    startDate,
    endDate: String(input.endDate || "").trim(),
    reminder,
    reminderAt: reminderAt(startDate || input.date, time, reminder),
    reminderSent: false,
    notes: String(input.notes || "").trim(),
    status,
    responsibleId: input.responsibleId || "",
    responsibleUserId: input.responsibleUserId || "",
    responsibleEmail: String(input.responsibleEmail || "").trim().toLowerCase(),
    responsibleName: input.responsibleName || "",
    clinicianId: input.clinicianId || "",
    clinicianUserId: input.clinicianUserId || "",
    clinicianEmail: String(input.clinicianEmail || "").trim().toLowerCase(),
    clinicianName: input.clinicianName || "",
    updatedBy: uid,
    updatedByName: user.displayName || "",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing?.exists) {
    payload.createdBy = uid;
    payload.createdByName = user.displayName || "";
    payload.createdAt = FieldValue.serverTimestamp();
  }
  if (status === "ended" && existing?.data()?.status !== "ended") {
    payload.endedAt = FieldValue.serverTimestamp();
    payload.endedBy = uid;
    payload.endedByName = user.displayName || "";
  }
  await ref.set(payload, { merge: true });
  const snap = await ref.get();
  return { id: ref.id, ...snap.data() };
};

exports.logMedicationDose = async (request) => {
  const input = request.data || {};
  const uid = requireUid(request);
  const medRef = db().doc(`${MEDICATIONS}/${input.medicationId}`);
  const snap = await medRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "That medication could not be found.");
  const medication = { id: snap.id, ...snap.data() };
  const { user, senior } = await requireHousehold(request, medication.seniorId);
  if (medication.status === "paused" || medication.status === "ended") {
    throw new HttpsError("failed-precondition", "Only active medications on the shared list can be logged.");
  }
  const outcome = OUTCOMES.includes(input.outcome) ? input.outcome : "taken";
  const date = String(input.date || "").trim();
  const time = String(input.time || medication.time || "").trim();
  const slotKey = `${date}|${time || "as-needed"}`;
  const payload = {
    medicationId: medication.id,
    seniorId: senior.id,
    name: medication.name,
    dosage: medication.dosage,
    date,
    time,
    slotKey,
    outcome,
    notes: String(input.notes || "").trim(),
    recordedBy: uid,
    recordedByName: user.displayName || "",
    recordedAt: FieldValue.serverTimestamp(),
  };
  const ref = db().collection(MEDICATION_DOSES).doc();
  await ref.set(payload);
  const next = await ref.get();
  return { id: ref.id, ...next.data() };
};

exports.dispatchMedicationReminders = async () => {
  const now = new Date().toISOString();
  const due = await db().collection(MEDICATIONS)
    .where("reminderSent", "==", false)
    .where("reminderAt", "<=", now)
    .limit(50)
    .get();

  let sent = 0;
  for (const doc of due.docs) {
    const item = { id: doc.id, ...doc.data() };
    if (item.status === "paused" || item.status === "ended") {
      await doc.ref.set({ reminderSent: true }, { merge: true });
      continue;
    }
    await notifications.notifyHousehold(item.seniorId, {
      type: notifications.TYPES.MEDICATION_REMINDER,
      title: `Reminder · ${item.name}`,
      body: [item.dosage, item.time, item.responsibleName].filter(Boolean).join(" · "),
      medicationId: item.id,
      entityType: "medication",
      entityId: item.id,
    });
    await doc.ref.set({ reminderSent: true }, { merge: true });
    sent += 1;
  }
  return { scanned: due.size, sent };
};
