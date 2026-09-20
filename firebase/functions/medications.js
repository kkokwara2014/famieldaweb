const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const notifications = require("./notifications");
const entitlements = require("./entitlements");

const USERS = "users";
const SENIORS = "seniors";
const MEDICATIONS = "medications";
const MEDICATION_DOSES = "medicationDoses";

const STATUSES = ["active", "paused", "ended"];
const FREQUENCIES = ["once", "daily", "twice_daily", "three_times", "weekly", "every_other", "as_needed"];
const OUTCOMES = ["taken", "skipped", "missed"];
const REMINDERS = {
  none: null,
  at_time: 0,
  "15min": 15,
  "1hour": 60,
};

function db() {
  return getFirestore();
}

// Canonical placement is seniors/{seniorId}/medications and medicationDoses.
function medicationsCol(seniorId) {
  return seniorId
    ? db().collection(`${SENIORS}/${seniorId}/${MEDICATIONS}`)
    : db().collection(MEDICATIONS);
}

function medicationDoc(seniorId, medicationId) {
  return seniorId
    ? db().doc(`${SENIORS}/${seniorId}/${MEDICATIONS}/${medicationId}`)
    : db().doc(`${MEDICATIONS}/${medicationId}`);
}

function medicationDosesCol(seniorId) {
  return seniorId
    ? db().collection(`${SENIORS}/${seniorId}/${MEDICATION_DOSES}`)
    : db().collection(MEDICATION_DOSES);
}

async function loadMedication(medicationId) {
  if (!medicationId) return null;
  const group = await db().collectionGroup(MEDICATIONS)
    .where(FieldPath.documentId(), "==", medicationId)
    .limit(1)
    .get();
  if (!group.empty) {
    const doc = group.docs[0];
    return { id: doc.id, ...doc.data(), ref: doc.ref };
  }
  // Backward-compatible: pre-migration top-level medications.
  const legacy = await db().doc(`${MEDICATIONS}/${medicationId}`).get();
  if (legacy.exists) return { id: legacy.id, ...legacy.data(), ref: legacy.ref };
  return null;
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
  const ref = input.medicationId
    ? medicationDoc(senior.id, input.medicationId)
    : medicationsCol(senior.id).doc();
  const existing = input.medicationId ? await ref.get() : null;
  if (input.medicationId && (!existing.exists || existing.data().seniorId !== senior.id)) {
    // Backward-compatible: accept a pre-migration top-level medication, then
    // migrate it into the canonical subcollection on write.
    const legacy = await db().doc(`${MEDICATIONS}/${input.medicationId}`).get();
    if (!legacy.exists || legacy.data().seniorId !== senior.id) {
      throw new HttpsError("not-found", "That medication could not be found.");
    }
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
  const medication = await loadMedication(input.medicationId);
  if (!medication) throw new HttpsError("not-found", "That medication could not be found.");
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
  const ref = medicationDosesCol(senior.id).doc();
  await ref.set(payload);
  const next = await ref.get();
  return { id: ref.id, ...next.data() };
};

exports.dispatchMedicationReminders = async () => {
  const now = new Date().toISOString();
  const due = await db().collectionGroup(MEDICATIONS)
    .where("reminderSent", "==", false)
    .where("reminderAt", "<=", now)
    .limit(50)
    .get();
  const docs = [...due.docs];
  // Backward-compatible: pre-migration top-level medications.
  try {
    const legacy = await db().collection(MEDICATIONS)
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
  return { scanned: docs.length, sent };
};
