import { ACTIVITY_TYPES, CARE_HISTORY_KINDS } from "../config/constants.js";

export function createActivity(data = {}) {
  const type = data.type ?? ACTIVITY_TYPES.CARE;
  return {
    id: data.id ?? "",
    seniorId: data.seniorId ?? "",
    kind: data.kind ?? kindFromType(type),
    type,
    title: data.title ?? "",
    body: data.body ?? "",
    actor: data.actor ?? "",
    actorId: data.actorId ?? "",
    occurredAt: data.occurredAt ?? data.createdAt ?? new Date().toISOString(),
    createdAt: data.createdAt ?? data.occurredAt ?? new Date().toISOString(),
    source: data.source ?? "activity",
    sourceId: data.sourceId ?? "",
    relatedId: data.relatedId ?? "",
    href: data.href ?? "",
  };
}

export function activitySourceKey(source, sourceId) {
  if (!sourceId) return "";
  return `${source || "activity"}:${sourceId}`;
}

function kindFromType(type) {
  if (type === ACTIVITY_TYPES.CLINICAL) return CARE_HISTORY_KINDS.CLINICAL;
  if (type === ACTIVITY_TYPES.SCHEDULE) return CARE_HISTORY_KINDS.SCHEDULE;
  if (type === ACTIVITY_TYPES.CIRCLE) return CARE_HISTORY_KINDS.CIRCLE;
  if (type === ACTIVITY_TYPES.SYSTEM) return CARE_HISTORY_KINDS.SYSTEM;
  return CARE_HISTORY_KINDS.CARE;
}
