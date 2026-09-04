const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { logger } = require("firebase-functions");

const USERS = "users";
const NOTICES = "notifications";
const TOKENS = "fcmTokens";

const TYPES = {
  NEW_USER_JOINED: "new_user_joined",
  FAMILY_INVITATION: "family_invitation",
  CAREGIVER_INVITATION: "caregiver_invitation",
  PRACTITIONER_INVITATION: "practitioner_invitation",
  INVITATION_ACCEPTED: "invitation_accepted",
  INVITATION_DECLINED: "invitation_declined",
  SCHEDULE_REQUEST: "schedule_request",
  SCHEDULE_ACCEPTED: "schedule_accepted",
  SCHEDULE_CHANGED: "schedule_changed",
  TASK_ASSIGNED: "task_assigned",
  APPOINTMENT_REMINDER: "appointment_reminder",
  MEDICATION_REMINDER: "medication_reminder",
  CARE_UPDATE: "care_update",
  EMERGENCY_ALERT: "emergency_alert",
  MESSAGE: "message",
  VERIFICATION: "verification",
  FAMILY_REFERRAL: "family_referral",
  FAMILY_REFERRAL_JOINED: "family_referral_joined",
  FAMILY_REFERRAL_SUCCESS: "family_referral_success",
};

function db() {
  return getFirestore();
}

function invitationTypeForKind(kind) {
  if (kind === "caregiver") return TYPES.CAREGIVER_INVITATION;
  if (kind === "practitioner") return TYPES.PRACTITIONER_INVITATION;
  return TYPES.FAMILY_INVITATION;
}

function noticeHref(type, data = {}) {
  switch (type) {
    case TYPES.NEW_USER_JOINED:
    case TYPES.FAMILY_INVITATION:
    case TYPES.CAREGIVER_INVITATION:
    case TYPES.PRACTITIONER_INVITATION:
    case TYPES.INVITATION_ACCEPTED:
    case TYPES.INVITATION_DECLINED:
      return data.inviteToken || data.inviteId
        ? `/app/care-circle.html?invite=${encodeURIComponent(data.inviteToken || data.inviteId)}`
        : "/app/care-circle.html";
    case TYPES.SCHEDULE_REQUEST:
    case TYPES.SCHEDULE_ACCEPTED:
    case TYPES.SCHEDULE_CHANGED:
      return data.visitId ? `/app/schedule.html?visit=${encodeURIComponent(data.visitId)}` : "/app/schedule.html";
    case TYPES.TASK_ASSIGNED:
      return data.taskId
        ? `/app/senior.html?section=tasks&task=${encodeURIComponent(data.taskId)}`
        : "/app/senior.html?section=tasks";
    case TYPES.APPOINTMENT_REMINDER:
      return data.appointmentId
        ? `/app/senior.html?section=appointments&appointment=${encodeURIComponent(data.appointmentId)}`
        : "/app/senior.html?section=appointments";
    case TYPES.MEDICATION_REMINDER:
      return data.medicationId
        ? `/app/senior.html?section=medications&medication=${encodeURIComponent(data.medicationId)}`
        : "/app/senior.html?section=medications";
    case TYPES.CARE_UPDATE:
      return "/app/senior.html";
    case TYPES.EMERGENCY_ALERT:
      return "/app/dashboard.html";
    case TYPES.MESSAGE:
      return data.conversationId
        ? `/app/messages.html?thread=${encodeURIComponent(data.conversationId)}`
        : "/app/messages.html";
    case TYPES.VERIFICATION:
      return data.href || (data.admin
        ? `/admin/index.html?section=verification${data.entityId ? `&id=${encodeURIComponent(data.entityId)}` : ""}`
        : "/app/verification.html");
    case TYPES.FAMILY_REFERRAL:
    case TYPES.FAMILY_REFERRAL_JOINED:
    case TYPES.FAMILY_REFERRAL_SUCCESS:
      return data.href || "/app/referrals.html";
    default:
      return "/app/notifications.html";
  }
}

function asRecipients(people = []) {
  const seen = new Set();
  return (Array.isArray(people) ? people : [people]).filter(Boolean).map((person) => {
    if (typeof person === "string") return { userId: person, email: "" };
    return {
      userId: person.userId || person.id || "",
      email: String(person.email || "").trim().toLowerCase(),
    };
  }).filter((person) => {
    const key = `${person.userId}|${person.email}`;
    if ((!person.userId && !person.email) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prefsAllow(prefs = {}, type) {
  if (type === TYPES.EMERGENCY_ALERT) return true;
  if (prefs.pushEnabled === false) return false;
  if (prefs.types && prefs.types[type] === false) return false;
  return true;
}

async function createNotice(payload = {}) {
  const type = payload.type || "system";
  const title = String(payload.title || "").trim();
  if (!title) return null;
  const href = payload.href || noticeHref(type, payload);
  const ref = db().collection(NOTICES).doc();
  const record = {
    type,
    title,
    body: String(payload.body || "").trim(),
    userId: payload.userId || "",
    email: String(payload.email || "").trim().toLowerCase(),
    seniorId: payload.seniorId || "",
    href,
    actorId: payload.actorId || "",
    actorName: payload.actorName || "",
    visitId: payload.visitId || "",
    inviteId: payload.inviteId || "",
    inviteToken: payload.inviteToken || "",
    taskId: payload.taskId || "",
    appointmentId: payload.appointmentId || "",
    medicationId: payload.medicationId || "",
    conversationId: payload.conversationId || "",
    entityType: payload.entityType || "",
    entityId: payload.entityId || "",
    priority: type === TYPES.EMERGENCY_ALERT ? "emergency" : (payload.priority || "normal"),
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(record);
  return { id: ref.id, ...record, href };
}

async function notifyHousehold(seniorId, payload = {}, actorId = "") {
  if (!seniorId) return [];
  const snap = await db().doc(`seniors/${seniorId}`).get();
  const data = snap.exists ? snap.data() : {};
  const ids = new Set([data.ownerId, ...(Array.isArray(data.memberIds) ? data.memberIds : [])].filter(Boolean));
  return notifyPeople([...ids].map((userId) => ({ userId })), { ...payload, seniorId }, actorId);
}

async function notifyPeople(people, payload = {}, actorId = "") {
  const recipients = asRecipients(people).filter((person) => !(actorId && person.userId && person.userId === actorId));
  const saved = [];
  for (const recipient of recipients) {
    const notice = await createNotice({ ...payload, userId: recipient.userId, email: recipient.email });
    if (notice) saved.push(notice);
  }
  return saved;
}

async function loadUserPrefs(userId) {
  if (!userId) return {};
  const snap = await db().doc(`${USERS}/${userId}`).get();
  return snap.exists ? (snap.data().notificationPrefs || {}) : {};
}

async function listTokens(userId) {
  if (!userId) return [];
  const snap = await db().collection(USERS).doc(userId).collection(TOKENS).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.token);
}

async function pruneToken(userId, tokenId) {
  await db().doc(`${USERS}/${userId}/${TOKENS}/${tokenId}`).delete().catch(() => {});
}

async function sendPush(notice) {
  const monitoring = require("./monitoring");
  if (!notice?.userId) {
    await monitoring.recordNotificationDelivery({
      type: notice?.type,
      skipped: true,
      code: "missing_user",
    });
    return { sent: 0 };
  }
  const prefs = await loadUserPrefs(notice.userId);
  if (!prefsAllow(prefs, notice.type)) {
    logger.info("Push skipped by preference", { type: notice.type, userId: notice.userId });
    await monitoring.recordNotificationDelivery({
      type: notice.type,
      skipped: true,
      code: "preference",
      userId: notice.userId,
    });
    return { sent: 0 };
  }
  const tokens = await listTokens(notice.userId);
  if (!tokens.length) {
    await monitoring.recordNotificationDelivery({
      type: notice.type,
      skipped: true,
      code: "no_token",
      userId: notice.userId,
    });
    return { sent: 0 };
  }

  try {
    const href = notice.href || noticeHref(notice.type, notice);
    const emergency = notice.type === TYPES.EMERGENCY_ALERT;
  const response = await getMessaging().sendEachForMulticast({
    tokens: tokens.map((item) => item.token),
    notification: {
      title: notice.title,
      body: notice.body || "",
    },
    data: {
      type: String(notice.type || ""),
      href,
      notificationId: String(notice.id || ""),
      seniorId: String(notice.seniorId || ""),
    },
    webpush: {
      fcmOptions: { link: href },
      notification: {
        icon: "/assets/favicon.png",
        requireInteraction: emergency,
      },
      headers: { Urgency: emergency ? "high" : "normal" },
    },
    android: {
      priority: emergency ? "high" : "normal",
    },
  });

  await Promise.all(response.responses.map((item, index) => {
    if (item.success) return null;
    const code = item.error?.code || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
      return pruneToken(notice.userId, tokens[index].id);
    }
    return null;
  }));

  const failCode = response.responses.find((item) => !item.success)?.error?.code || "";
  logger.info("FCM dispatched", {
    id: notice.id,
    type: notice.type,
    success: response.successCount,
    failure: response.failureCount,
  });
  await monitoring.recordNotificationDelivery({
    type: notice.type,
    sent: response.successCount,
    failed: response.failureCount,
    code: failCode,
    userId: notice.userId,
  });
  return { sent: response.successCount, failed: response.failureCount };
} catch (error) {
  await monitoring.recordNotificationDelivery({
    type: notice?.type,
    failed: 1,
    code: error.code || "messaging/unknown",
    userId: notice?.userId || "",
  });
  throw error;
}
}

exports.onNotificationCreated = async (event) => {
  const data = event.data?.data();
  if (!data) return;
  await sendPush({ id: event.params.notificationId, ...data });
};

exports.notifyPeople = notifyPeople;
exports.notifyHousehold = notifyHousehold;
exports.createNotice = createNotice;
exports.invitationTypeForKind = invitationTypeForKind;
exports.TYPES = TYPES;
exports.noticeHref = noticeHref;
