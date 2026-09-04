import { DOCUMENT_CATEGORIES, DOCUMENT_STATUS, DOCUMENT_VISIBILITY } from "../config/constants.js";

export function createDocument(data = {}) {
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    title: data.title ?? "",
    category: data.category ?? DOCUMENT_CATEGORIES.OTHER,
    visibility: data.visibility ?? DOCUMENT_VISIBILITY.CIRCLE,
    status: data.status ?? DOCUMENT_STATUS.ON_FILE,
    notes: data.notes ?? "",
    fileName: data.fileName ?? "",
    contentType: data.contentType ?? "",
    size: Number(data.size) || 0,
    storagePath: data.storagePath ?? "",
    uploadedBy: data.uploadedBy ?? "",
    uploadedByName: data.uploadedByName ?? "",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}
