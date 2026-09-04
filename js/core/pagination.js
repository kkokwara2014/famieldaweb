import { PAGE_SIZE, clampQueryLimit } from "../config/performance.js";
import { escapeHtml } from "./dom.js";

export function emptyPage(limit = PAGE_SIZE) {
  return {
    items: [],
    snapshots: [],
    lastDoc: null,
    cursor: null,
    hasMore: false,
    limit: clampQueryLimit(limit),
  };
}

export function paginateItems(items = [], { limit = PAGE_SIZE, offset = 0, cursor } = {}) {
  const list = Array.isArray(items) ? items : [];
  const size = clampQueryLimit(limit);
  let start = Math.max(0, Number(offset) || 0);
  if (cursor) {
    const index = list.findIndex((item) => (item?.id || item) === cursor);
    start = index >= 0 ? index + 1 : start;
  }
  const slice = list.slice(start, start + size);
  const last = slice[slice.length - 1];
  return {
    items: slice,
    hasMore: start + slice.length < list.length,
    cursor: last?.id || (slice.length ? String(start + slice.length) : null),
    offset: start,
    nextOffset: start + slice.length,
    total: list.length,
    limit: size,
  };
}

export function pagerHtml({
  hasMore = false,
  loaded = 0,
  limit = PAGE_SIZE,
  loading = false,
  label = "Load more",
} = {}) {
  if (!loaded) return "";
  if (!hasMore && loaded < limit) return "";
  const meta = hasMore
    ? `Showing ${loaded}. Load the next ${limit} when you need them.`
    : `Showing ${loaded} most recent.`;
  return `
    <div class="pager" data-pager>
      <p class="pager__meta">${escapeHtml(meta)}</p>
      ${hasMore ? `
        <button class="btn btn--ghost" type="button" data-load-more${loading ? " disabled" : ""}>
          ${escapeHtml(label)}
        </button>
      ` : ""}
    </div>
  `;
}
