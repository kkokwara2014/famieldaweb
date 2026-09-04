import { CACHE_TTL_MS, PAGE_SIZE, clampQueryLimit } from "../config/performance.js";
import { remember } from "./cache.js";
import { emptyPage } from "./pagination.js";
import { getFirebaseDb, getFirestoreSdk } from "./firebase.js";

function cacheKey(collection, constraints, options) {
  const limit = clampQueryLimit(options.limit ?? PAGE_SIZE);
  const cursor = options.cursor || options.startAfter?.id || "";
  const hint = options.cacheKey || constraints.map((item) => item?.type || "c").join("|");
  return `fs:${collection}:${hint}:${limit}:${cursor}`;
}

export async function queryPage(collection, constraints = [], options = {}) {
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  const limit = clampQueryLimit(options.limit ?? PAGE_SIZE);
  if (!db || !sdk || !collection) return emptyPage(limit);

  const run = async () => {
    const parts = [...constraints];
    if (options.startAfter) parts.push(sdk.startAfter(options.startAfter));
    parts.push(sdk.limit(limit));
    const query = sdk.query(sdk.collection(db, collection), ...parts);
    const snap = await sdk.getDocs(query);
    const snapshots = snap.docs;
    const items = snapshots.map((doc) => ({ id: doc.id, ...doc.data() }));
    const lastDoc = snapshots[snapshots.length - 1] || null;
    return {
      items,
      snapshots,
      lastDoc,
      cursor: lastDoc?.id || null,
      hasMore: snapshots.length >= limit,
      limit,
    };
  };

  if (options.cache !== true) return run();
  return remember(cacheKey(collection, constraints, options), options.ttl ?? CACHE_TTL_MS.MEMORY, run);
}

export async function getQueryDocs(collection, constraints = [], options = {}) {
  const page = await queryPage(collection, constraints, options);
  return page.items;
}

export function queryConstraints(sdk, { where = [], orderBy } = {}) {
  const parts = [];
  where.forEach((clause) => {
    if (!clause) return;
    const [field, op, value] = clause;
    parts.push(sdk.where(field, op, value));
  });
  if (orderBy) {
    const [field, dir = "asc"] = Array.isArray(orderBy) ? orderBy : [orderBy, "asc"];
    parts.push(sdk.orderBy(field, dir));
  }
  return parts;
}
