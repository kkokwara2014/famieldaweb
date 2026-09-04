const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { getStorage } = require("firebase-admin/storage");
const { logger } = require("firebase-functions");
const security = require("./security");

exports.onCareDocumentDeleted = onDocumentDeleted(
  "documents/{documentId}",
  async (event) => {
    const data = event.data?.data();
    const path = data?.storagePath;
    if (!path || String(path).startsWith("local/")) return;
    try {
      await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
    } catch (error) {
      logger.warn("Could not remove private document object", {
        id: event.params.documentId,
        path,
        message: error.message,
      });
    }
    await security.writeSystemAudit("document.deleted", {
      targetId: event.params.documentId,
      seniorId: data?.seniorId,
      sensitive: true,
      targetType: "document",
    }).catch((error) => {
      logger.warn("Could not audit document delete", { message: error.message });
    });
  }
);
