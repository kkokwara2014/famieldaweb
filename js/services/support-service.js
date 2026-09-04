import { AUTH } from "../config/constants.js";
import { createSupportTicket } from "../models/support-ticket.js";
import { getSession } from "../auth/session.js";
import { getFirebaseDb, getFirestoreSdk, usesLiveAuth } from "../core/firebase.js";
import { QUERY_LIMITS } from "../config/performance.js";
import { createSupportTicketRequest, listLocalSupportTickets } from "./admin-service.js";

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function publicTicket(ticket) {
  const next = createSupportTicket({
    ...ticket,
    createdAt: toIso(ticket.createdAt) || ticket.createdAt,
    updatedAt: toIso(ticket.updatedAt) || ticket.updatedAt,
    resolvedAt: toIso(ticket.resolvedAt) || ticket.resolvedAt,
  });
  next.replies = (next.replies || []).filter((reply) => !reply.internal);
  return next;
}

function belongsToSession(ticket, session) {
  if (!session) return false;
  if (ticket.userId && ticket.userId === session.id) return true;
  return Boolean(ticket.email && session.email
    && String(ticket.email).toLowerCase() === String(session.email).toLowerCase());
}

async function listLiveTickets(session) {
  const db = getFirebaseDb();
  const sdk = getFirestoreSdk();
  if (!db || !sdk || !session?.id) return [];
  const run = (constraints) => sdk.getDocs(sdk.query(
    sdk.collection(db, AUTH.SUPPORT_TICKETS_COLLECTION),
    ...constraints,
    sdk.limit(QUERY_LIMITS.PAGE),
  ));
  const snap = await run([
    sdk.where("userId", "==", session.id),
    sdk.orderBy("createdAt", "desc"),
  ]).catch(() => run([sdk.where("userId", "==", session.id)]));
  return snap.docs
    .map((doc) => publicTicket({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export async function listMySupportTickets(session = getSession()) {
  if (!usesLiveAuth()) {
    return listLocalSupportTickets()
      .filter((item) => belongsToSession(item, session))
      .map(publicTicket)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }
  return listLiveTickets(session);
}

export async function submitSupportTicket(data = {}, session = getSession()) {
  const subject = String(data.subject || "").trim();
  const body = String(data.body || "").trim();
  if (!subject) throw new Error("A subject is required.");
  if (subject.length < 4) throw new Error("Give the request a short subject.");
  if (!body) throw new Error("Describe what you need help with.");
  if (body.length < 12) throw new Error("Add a bit more detail so we can help.");

  const result = await createSupportTicketRequest({
    subject,
    body,
    category: data.category || "general",
    priority: data.priority || "normal",
    kind: data.kind || "contact",
    pageUrl: data.pageUrl || "",
    userAgent: data.userAgent || "",
    userName: session?.displayName,
    email: session?.email,
    userId: session?.id,
  });
  return result?.ticket ? publicTicket(result.ticket) : result;
}

export function formatSupportWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
