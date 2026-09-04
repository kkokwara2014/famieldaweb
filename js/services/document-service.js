import {
  AUTH,
  ACTIVITY_TYPES,
  CARE_HISTORY_KINDS,
  CIRCLE_STATUS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUS,
  DOCUMENT_VISIBILITY,
} from "../config/constants.js";
import { CirclePlanError } from "../config/care-circle.js";
import { canUploadDocuments, householdContext } from "./entitlement-service.js";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_PLUS_MESSAGE,
  canDeleteDocument,
  canManageDocuments,
  canViewDocument,
  defaultVisibilityFor,
  documentCategoryLabel,
  documentStatusBadge,
  documentStatusLabel,
  documentStoragePath,
  documentVisibilityLabel,
  formatFileSize,
  householdHasDocumentsPlus,
  isAllowedDocumentFile,
  isImageDocument,
  isPdfDocument,
  isPreviewableDocument,
  sanitizeFileName,
  sessionHasDocumentsPlus,
  visibilitiesFor,
  contentTypeForFile,
} from "../config/document.js";
import { createDocument } from "../models/document.js";
import { mockDocuments } from "./mock-data.js";
import { storage } from "../core/storage.js";
import {
  ensureFirebaseStorage,
  getFirebaseDb,
  getFirebaseStorage,
  getFirestoreSdk,
  getStorageSdk,
  usesLiveAuth,
} from "../core/firebase.js";
import { getSession } from "../auth/session.js";
import { getQueryDocs } from "../core/query.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { getSeniorForUser } from "./senior-service.js";
import { listCareCircle } from "./care-circle-service.js";
import { postActivity } from "./activity-service.js";
import { formatWhen } from "../scheduling/time.js";

const DOCUMENTS_KEY = "documents";
const IDB_NAME = "famielda-documents";
const IDB_STORE = "files";

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function emailsEqual(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function documentFrom(data) {
  return createDocument({
    ...data,
    size: Number(data.size) || 0,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  });
}

function toDoc(record) {
  const { id: _id, ...rest } = record;
  return rest;
}

function seedMap(key, records) {
  const map = storage.get(key, null) ?? {};
  let changed = false;
  for (const record of records) {
    if (!map[record.id]) {
      map[record.id] = record;
      changed = true;
    }
  }
  if (changed) storage.set(key, map);
  return map;
}

function seedLocal() {
  const map = seedMap(DOCUMENTS_KEY, mockDocuments);
  let changed = false;
  for (const record of mockDocuments) {
    const current = map[record.id];
    if (current && !current.visibility && record.visibility) {
      map[record.id] = { ...current, visibility: record.visibility };
      changed = true;
    }
  }
  if (changed) storage.set(DOCUMENTS_KEY, map);
}

function readLocalMap() {
  seedLocal();
  return storage.get(DOCUMENTS_KEY, {}) ?? {};
}

function writeLocalRecord(record) {
  const map = readLocalMap();
  map[record.id] = record;
  storage.set(DOCUMENTS_KEY, map);
  return record;
}

function removeLocalRecord(id) {
  const map = readLocalMap();
  delete map[id];
  storage.set(DOCUMENTS_KEY, map);
}

function localDocuments(filter = {}) {
  return Object.values(readLocalMap())
    .map((item) => documentFrom(item))
    .filter((item) => !filter.seniorId || item.seniorId === filter.seniorId);
}

function openFileDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser cannot keep a private local copy of that file."));
      return;
    }
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the private document store."));
  });
}

async function putLocalFile(id, blob) {
  const db = await openFileDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save that file privately."));
      tx.objectStore(IDB_STORE).put(blob, id);
    });
  } finally {
    db.close();
  }
}

async function getLocalFile(id) {
  const db = await openFileDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const request = tx.objectStore(IDB_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not open that file."));
    });
  } finally {
    db.close();
  }
}

async function deleteLocalFile(id) {
  const db = await openFileDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not remove that file."));
      tx.objectStore(IDB_STORE).delete(id);
    });
  } catch {
    // Local cleanup is best-effort.
  } finally {
    db.close();
  }
}

async function collectionDocs(collection, constraints = [], options = {}) {
  return getQueryDocs(collection, constraints, { limit: QUERY_LIMITS.PAGE, ...options });
}

async function readDocuments(filter = {}, allowedVisibilities = null) {
  const visibilities = allowedVisibilities?.length
    ? allowedVisibilities
    : Object.values(DOCUMENT_VISIBILITY);
  if (!usesLiveAuth()) {
    return localDocuments(filter).filter((item) => visibilities.includes(item.visibility));
  }
  const sdk = getFirestoreSdk();
  const constraints = [];
  if (filter.seniorId) constraints.push(sdk.where("seniorId", "==", filter.seniorId));
  if (visibilities.length && visibilities.length < Object.values(DOCUMENT_VISIBILITY).length) {
    constraints.push(sdk.where("visibility", "in", visibilities));
  }
  try {
    const docs = await collectionDocs(AUTH.DOCUMENTS_COLLECTION, [...constraints, sdk.orderBy("updatedAt", "desc")]);
    return docs.map((item) => documentFrom(item)).filter((item) => visibilities.includes(item.visibility));
  } catch {
    const docs = await collectionDocs(AUTH.DOCUMENTS_COLLECTION, constraints);
    return docs
      .map((item) => documentFrom(item))
      .filter((item) => {
        if (filter.seniorId && item.seniorId !== filter.seniorId) return false;
        return visibilities.includes(item.visibility);
      });
  }
}

async function readDocumentById(id) {
  if (!id) return null;
  if (!usesLiveAuth()) return localDocuments().find((item) => item.id === id) ?? null;
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const snap = await sdk.getDoc(sdk.doc(db, AUTH.DOCUMENTS_COLLECTION, id));
  if (!snap.exists()) return null;
  return documentFrom({ id: snap.id, ...snap.data() });
}

async function saveDocumentRecord(document) {
  const record = documentFrom({ ...document, updatedAt: nowIso() });
  if (!usesLiveAuth()) return documentFrom(writeLocalRecord(record));

  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const ref = record.id
    ? sdk.doc(db, AUTH.DOCUMENTS_COLLECTION, record.id)
    : sdk.doc(sdk.collection(db, AUTH.DOCUMENTS_COLLECTION));
  const payload = toDoc({ ...record, id: ref.id });
  const data = { ...payload, updatedAt: sdk.serverTimestamp() };
  if (!payload.createdAt) data.createdAt = sdk.serverTimestamp();
  await sdk.setDoc(ref, data, { merge: true });
  return documentFrom({ ...record, id: ref.id });
}

async function deleteDocumentRecord(id) {
  if (!usesLiveAuth()) {
    removeLocalRecord(id);
    return;
  }
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  await sdk.deleteDoc(sdk.doc(db, AUTH.DOCUMENTS_COLLECTION, id));
}

async function uploadPrivateFile(path, file) {
  await ensureFirebaseStorage();
  const bucket = getFirebaseStorage();
  const sdk = getStorageSdk();
  if (!bucket || !sdk) throw new Error("Private document storage is not ready.");
  const ref = sdk.ref(bucket, path);
  await sdk.uploadBytes(ref, file, {
    contentType: contentTypeForFile(file) || "application/pdf",
    cacheControl: "private, max-age=0, no-transform",
    customMetadata: {
      visibility: "private",
      household: "famielda",
    },
  });
  return path;
}

async function deletePrivateFile(path) {
  if (!path) return;
  await ensureFirebaseStorage();
  const bucket = getFirebaseStorage();
  const sdk = getStorageSdk();
  if (!bucket || !sdk) return;
  try {
    await sdk.deleteObject(sdk.ref(bucket, path));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") throw error;
  }
}

async function downloadPrivateFile(path) {
  await ensureFirebaseStorage();
  const bucket = getFirebaseStorage();
  const sdk = getStorageSdk();
  if (!bucket || !sdk) throw new Error("Private document storage is not ready.");
  return sdk.getBlob(sdk.ref(bucket, path));
}

function findActor(members, session, senior) {
  if (!session) return null;
  return members.find((member) => (
    member.status !== CIRCLE_STATUS.REMOVED
    && (member.userId === session.id || emailsEqual(member.email, session.email))
  )) ?? (senior?.ownerId === session.id
    ? members.find((member) => member.role === "owner")
    : null);
}

async function loadContext(session = getSession()) {
  if (!session) throw new Error("Sign in to manage documents.");
  const senior = await getSeniorForUser(session);
  if (!senior) throw new Error("A senior record is needed before a document can be saved.");
  const members = await listCareCircle(senior.id);
  const actor = findActor(members, session, senior);
  const household = await householdContext({ session, senior, members });
  return { session, senior, members, actor, ...household, isPlus: canUploadDocuments(household) };
}

function assertPlus(ctx) {
  if (ctx.isPlus) return;
  throw new CirclePlanError(DOCUMENT_PLUS_MESSAGE, { code: "plus", upgrade: true });
}

function assertCanManage(ctx) {
  if (!canManageDocuments(ctx.session, ctx.actor, ctx.senior)) {
    throw new Error("You need permission to change documents for this household.");
  }
}

function assertCanView(ctx, doc) {
  if (!canViewDocument(doc, ctx.session, ctx.actor, ctx.senior)) {
    throw new Error("You do not have permission to open this document.");
  }
}

function normalizeInput(input = {}, existing = null) {
  const title = String(input.title ?? existing?.title ?? "").trim();
  if (!title) throw new Error("Give this document a title.");
  const category = Object.values(DOCUMENT_CATEGORIES).includes(input.category)
    ? input.category
    : (existing?.category ?? DOCUMENT_CATEGORIES.OTHER);
  const visibility = Object.values(DOCUMENT_VISIBILITY).includes(input.visibility)
    ? input.visibility
    : (existing?.visibility ?? defaultVisibilityFor(category));
  const status = Object.values(DOCUMENT_STATUS).includes(input.status)
    ? input.status
    : (existing?.status ?? DOCUMENT_STATUS.ON_FILE);
  return {
    title,
    category,
    visibility,
    status,
    notes: String(input.notes ?? existing?.notes ?? "").trim(),
  };
}

function assertFile(file, { required = false } = {}) {
  if (!file) {
    if (required) throw new Error("Choose a file to upload.");
    return;
  }
  if (!isAllowedDocumentFile(file)) {
    throw new Error("Use a PDF, image, Word document, or text file.");
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new Error("Keep files under 12 MB.");
  }
}

function mapDocumentView(item, { now, session, actor, senior, canManage, isPlus } = {}) {
  const canView = Boolean(isPlus) && canViewDocument(item, session, actor, senior);
  const hasFile = Boolean(item.storagePath || item.fileName);
  return {
    ...item,
    categoryLabel: documentCategoryLabel(item.category),
    visibilityLabel: documentVisibilityLabel(item.visibility),
    statusLabel: documentStatusLabel(item.status),
    badge: documentStatusBadge(item.status),
    updatedLabel: item.updatedAt ? formatWhen(item.updatedAt, now) : "No date",
    sizeLabel: item.size ? formatFileSize(item.size) : "",
    uploadedByLabel: item.uploadedByName || "Household",
    hasFile,
    canPreview: canView && hasFile && isPreviewableDocument(item),
    canDownload: canView && hasFile,
    canEdit: Boolean(canManage) && Boolean(isPlus) && canView,
    canDelete: Boolean(isPlus) && canDeleteDocument(item, session, actor, senior),
    isImage: isImageDocument(item),
    isPdf: isPdfDocument(item),
    sortKey: String(item.updatedAt || item.createdAt || ""),
  };
}

function byNewest(a, b) {
  return String(b.sortKey || b.updatedAt || "").localeCompare(String(a.sortKey || a.updatedAt || ""));
}

async function logDocumentActivity(title, body, session, extra = {}) {
  try {
    await postActivity({
      type: extra.type || ACTIVITY_TYPES.CARE,
      kind: extra.kind || CARE_HISTORY_KINDS.DOCUMENT,
      title,
      body,
      seniorId: extra.seniorId,
      source: extra.source || "document",
      sourceId: extra.sourceId || "",
      relatedId: extra.relatedId || "",
      href: extra.href || "senior.html?section=documents",
    }, session);
  } catch {
    // History is helpful, not required to keep the vault.
  }
}

export async function listDocuments(seniorId, session = getSession()) {
  const senior = seniorId ? { id: seniorId } : await getSeniorForUser(session);
  const members = senior?.id ? await listCareCircle(senior.id) : [];
  const actor = findActor(members, session, senior);
  const allowed = visibilitiesFor(session, actor, senior);
  return (await readDocuments({ seniorId: senior?.id || seniorId }, allowed))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function getDocumentWorkspace(senior, session = getSession(), now = new Date()) {
  const seniorId = senior?.id || session?.seniorId;
  const empty = {
    isPlus: canUploadDocuments({ session, senior }),
    canManage: false,
    documents: [],
    byCategory: {},
    counts: { total: 0, needsReview: 0, files: 0 },
  };
  if (!seniorId) return empty;

  const members = await listCareCircle(seniorId);
  const actor = findActor(members, session, senior);
  const household = await householdContext({ session, senior, members });
  const isPlus = canUploadDocuments(household);
  const canManage = canManageDocuments(session, actor, senior);
  const allowed = visibilitiesFor(session, actor, senior);
  const records = isPlus
    ? await readDocuments({ seniorId }, allowed)
    : [];
  const mapped = records
    .map((item) => mapDocumentView(item, { now, session, actor, senior, canManage, isPlus }))
    .sort(byNewest);
  const byCategory = {};
  for (const item of mapped) {
    const key = item.category || DOCUMENT_CATEGORIES.OTHER;
    if (!byCategory[key]) byCategory[key] = [];
    byCategory[key].push(item);
  }

  return {
    isPlus,
    canManage,
    documents: mapped,
    byCategory,
    counts: {
      total: mapped.length,
      needsReview: mapped.filter((item) => item.status === DOCUMENT_STATUS.NEEDS_REVIEW).length,
      files: mapped.filter((item) => item.hasFile).length,
      legal: (byCategory[DOCUMENT_CATEGORIES.LEGAL] || []).length,
      insurance: (byCategory[DOCUMENT_CATEGORIES.INSURANCE] || []).length,
      clinical: (byCategory[DOCUMENT_CATEGORIES.CLINICAL] || []).length,
    },
  };
}

export async function saveDocument(input = {}, session = getSession()) {
  const ctx = await loadContext(session);
  assertPlus(ctx);
  assertCanManage(ctx);

  const existing = input.documentId || input.id
    ? await readDocumentById(input.documentId || input.id)
    : null;
  if ((input.documentId || input.id) && !existing) {
    throw new Error("That document is no longer on file.");
  }
  if (existing && existing.seniorId !== ctx.senior.id) {
    throw new Error("That document belongs to another household.");
  }
  if (existing) assertCanView(ctx, existing);

  const fields = normalizeInput(input, existing);
  const file = input.file instanceof File ? input.file : null;
  assertFile(file, { required: !existing });

  const id = existing?.id || (usesLiveAuth() ? "" : newId("doc"));
  const fileName = file ? sanitizeFileName(file.name) : (existing?.fileName || "");
  let storagePath = existing?.storagePath || "";
  let contentType = existing?.contentType || "";
  let size = existing?.size || 0;

  const draft = await saveDocumentRecord({
    ...(existing || {}),
    id,
    seniorId: ctx.senior.id,
    ...fields,
    fileName: fileName || existing?.fileName || "",
    contentType,
    size,
    storagePath,
    uploadedBy: existing?.uploadedBy || ctx.session.id,
    uploadedByName: existing?.uploadedByName || ctx.session.displayName || ctx.session.email || "Household",
    createdAt: existing?.createdAt || nowIso(),
  });

  if (file) {
    const nextPath = documentStoragePath(ctx.senior.id, draft.id, fileName);
    if (usesLiveAuth()) {
      await uploadPrivateFile(nextPath, file);
      if (existing?.storagePath && existing.storagePath !== nextPath) {
        await deletePrivateFile(existing.storagePath);
      }
    } else {
      await putLocalFile(draft.id, file);
    }
    storagePath = usesLiveAuth() ? nextPath : `local/${draft.id}/${fileName}`;
    contentType = contentTypeForFile(file) || existing?.contentType || "";
    size = file.size || 0;
  }

  const saved = await saveDocumentRecord({
    ...draft,
    fileName: fileName || draft.fileName,
    contentType,
    size,
    storagePath,
  });

  await logDocumentActivity(
    existing ? "Document updated" : "Document uploaded",
    existing
      ? `${saved.title} was updated in the household vault.`
      : `${saved.title} was added to the household vault.`,
    ctx.session,
    { seniorId: ctx.senior.id, sourceId: saved.id, relatedId: saved.id },
  );

  return saved;
}

export async function deleteDocument(documentId, session = getSession()) {
  const ctx = await loadContext(session);
  assertPlus(ctx);
  const existing = await readDocumentById(documentId);
  if (!existing) throw new Error("That document is no longer on file.");
  if (existing.seniorId !== ctx.senior.id) {
    throw new Error("That document belongs to another household.");
  }
  if (!canDeleteDocument(existing, ctx.session, ctx.actor, ctx.senior)) {
    throw new Error("You need permission to remove this document.");
  }

  if (usesLiveAuth()) {
    await deletePrivateFile(existing.storagePath);
  } else {
    await deleteLocalFile(existing.id);
  }
  await deleteDocumentRecord(existing.id);

  await logDocumentActivity(
    "Document removed",
    `${existing.title} was removed from the household vault.`,
    ctx.session,
    { seniorId: ctx.senior.id, sourceId: existing.id },
  );
}

export async function getDocumentBlob(documentId, session = getSession()) {
  const ctx = await loadContext(session);
  assertPlus(ctx);
  const existing = await readDocumentById(documentId);
  if (!existing) throw new Error("That document is no longer on file.");
  if (existing.seniorId !== ctx.senior.id) {
    throw new Error("That document belongs to another household.");
  }
  assertCanView(ctx, existing);
  if (!existing.storagePath && usesLiveAuth()) {
    throw new Error("No file is attached to this record yet.");
  }

  if (usesLiveAuth()) {
    const blob = await downloadPrivateFile(existing.storagePath);
    return { blob, document: existing };
  }

  const local = await getLocalFile(existing.id);
  if (!local) {
    throw new Error("No file is attached to this record yet. Mock papers stay on the household list until someone uploads a copy.");
  }
  const blob = local instanceof Blob
    ? local
    : new Blob([local], { type: existing.contentType || "application/octet-stream" });
  return { blob, document: existing };
}

export { DOCUMENT_PLUS_MESSAGE, sessionHasDocumentsPlus, householdHasDocumentsPlus };
