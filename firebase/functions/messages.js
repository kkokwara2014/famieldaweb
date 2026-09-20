const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const notifications = require("./notifications");

const MEMBERS = "careCircleMembers";
const CIRCLE_CONVERSATION_SUFFIX = "_circle";

function db() {
  return getFirestore();
}

function seniorIdFor(message = {}) {
  if (message.seniorId) return message.seniorId;
  const conversationId = String(message.conversationId || "");
  if (conversationId.endsWith(CIRCLE_CONVERSATION_SUFFIX)) {
    return conversationId.slice(0, -CIRCLE_CONVERSATION_SUFFIX.length);
  }
  return "";
}

async function activeMembers(seniorId) {
  const snap = await db().collection(MEMBERS).where("seniorId", "==", seniorId).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((member) => member.status === "active");
}

function isFamily(member) {
  return member?.kind === "family";
}

function isProfessional(member) {
  return member?.kind === "caregiver" || member?.kind === "practitioner";
}

function memberForAuthor(members, message) {
  return members.find((member) => (
    (message.authorId && member.userId === message.authorId)
    || (message.authorKey && (
      member.userId === message.authorKey
      || `email:${String(member.email || "").toLowerCase()}` === message.authorKey
    ))
  )) ?? null;
}

exports.onCareMessageCreated = onDocumentCreated(
  "messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    const seniorId = seniorIdFor(message || {});
    if (!seniorId || !message?.body) return;

    const messageType = message.messageType || message.type || "";
    const members = await activeMembers(seniorId);
    const author = memberForAuthor(members, message);

    if (messageType === "direct") {
      const keys = Array.isArray(message.participantKeys) ? message.participantKeys : [];
      const authorKey = message.authorKey || message.authorId;
      const otherKey = keys.find((key) => key && key !== authorKey);
      const other = members.find((member) => (
        member.userId === otherKey
        || `email:${String(member.email || "").toLowerCase()}` === otherKey
        || `member:${member.id}` === otherKey
      ));

      if (author && other && !((isFamily(author) && isProfessional(other)) || (isProfessional(author) && isFamily(other)))) {
        logger.warn("Blocked unrelated Famielda message recipients from notice", {
          id: event.params.messageId,
          seniorId,
        });
        return;
      }

      if (!other) return;
      await notifications.createNotice({
        type: "message",
        title: `${message.authorName || message.author || "Someone"} sent a message`,
        body: String(message.body).slice(0, 160),
        recipientUserId: other.userId || "",
        email: other.email || "",
        seniorId,
        conversationId: message.conversationId || "",
        href: message.conversationId ? `/app/messages.html?thread=${message.conversationId}` : "/app/messages.html",
      });
      return;
    }

    logger.info("Circle message posted", {
      id: event.params.messageId,
      seniorId,
      messageType: messageType || "circle",
    });
  },
);
