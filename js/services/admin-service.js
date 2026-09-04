import {
  ACCOUNT_STATUS,
  INVITE_STATUS,
  ROLES,
  SUBSCRIPTION_PLANS,
  SUPPORT_STATUS,
} from "../config/constants.js";
import { formatInvoiceAmount } from "../config/subscription.js";
import { createUser } from "../models/user.js";
import { createSupportTicket } from "../models/support-ticket.js";
import { listMockUsers, updateMockUser } from "../auth/auth-service.js";
import { storage } from "../core/storage.js";
import { usesLiveAuth } from "../core/firebase.js";
import { callCloudFunction } from "../core/functions.js";
import { mockCircle, mockInvites, mockNotifications, mockSenior, mockVisits } from "./mock-data.js";
import { getLocalProductAnalytics } from "./analytics-service.js";
import { getLocalHealthOverview } from "./monitoring-service.js";

const TICKETS_KEY = "famielda.admin.tickets";

function seedTickets() {
  return [
    createSupportTicket({
      id: "ticket-billing",
      userId: "user-family",
      userName: "Sarah Walsh",
      email: "family@famielda.test",
      subject: "Plus renewal date looks off",
      body: "The household sees Plus as active, but the renewal date in Settings is blank after checkout.",
      category: "billing",
      priority: "high",
      status: SUPPORT_STATUS.OPEN,
      createdAt: "2026-09-02T14:10:00.000Z",
      updatedAt: "2026-09-02T14:10:00.000Z",
    }),
    createSupportTicket({
      id: "ticket-invite",
      userId: "user-caregiver",
      userName: "Maya Chen",
      email: "caregiver@famielda.test",
      subject: "Cannot accept a second household",
      body: "A second family invited me and the app says Free only allows one active relationship.",
      category: "account",
      priority: "normal",
      status: SUPPORT_STATUS.PENDING,
      replies: [{
        id: "reply-1",
        authorId: "user-admin",
        authorName: "Jordan Hale",
        body: "That’s expected on Free. I can grant operational Plus if this cover is time-sensitive.",
        createdAt: "2026-09-02T16:40:00.000Z",
      }],
      createdAt: "2026-09-01T11:05:00.000Z",
      updatedAt: "2026-09-02T16:40:00.000Z",
    }),
  ];
}

function loadTickets() {
  const stored = storage.get(TICKETS_KEY);
  if (Array.isArray(stored) && stored.length) return stored.map((item) => createSupportTicket(item));
  const seeded = seedTickets();
  storage.set(TICKETS_KEY, seeded);
  return seeded;
}

function saveTickets(tickets) {
  storage.set(TICKETS_KEY, tickets);
  return tickets;
}

function effectivePlus(user) {
  if (user?.adminGrant?.active) return true;
  return user?.plan === SUBSCRIPTION_PLANS.PLUS
    || user?.plan === SUBSCRIPTION_PLANS.FAMILY
    || user?.plan === SUBSCRIPTION_PLANS.CIRCLE;
}

function mapMockUser(user) {
  return createUser(user);
}

function householdsFor(user) {
  return mockCircle
    .filter((member) => member.userId === user.id || String(member.email || "").toLowerCase() === String(user.email || "").toLowerCase())
    .map((member) => ({
      id: member.id,
      seniorId: member.seniorId,
      seniorName: member.seniorId === mockSenior.id ? mockSenior.displayName : member.seniorName || "",
      kind: member.kind,
      role: member.role,
      relationship: member.relationship,
      status: member.status,
      professionalType: member.professionalType || "",
    }));
}

function mockOverview() {
  const users = listMockUsers().map(mapMockUser);
  const tickets = loadTickets();
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      users: users.length,
      families: users.filter((item) => item.role === ROLES.FAMILY).length,
      caregivers: users.filter((item) => item.role === ROLES.CAREGIVER).length,
      practitioners: users.filter((item) => item.role === ROLES.HEALTH_PRACTITIONER).length,
      admins: users.filter((item) => item.role === ROLES.ADMIN).length,
      seniors: 1,
      plus: users.filter(effectivePlus).length,
      free: users.filter((item) => !effectivePlus(item)).length,
      suspended: users.filter((item) => item.status === ACCOUNT_STATUS.SUSPENDED).length,
      pendingInvites: mockInvites.filter((item) => item.status === INVITE_STATUS.PENDING).length,
      openTickets: tickets.filter((item) => item.status === SUPPORT_STATUS.OPEN || item.status === SUPPORT_STATUS.PENDING).length,
      visits: mockVisits.length,
    },
    byRole: {
      family: users.filter((item) => item.role === ROLES.FAMILY).length,
      caregiver: users.filter((item) => item.role === ROLES.CAREGIVER).length,
      practitioner: users.filter((item) => item.role === ROLES.HEALTH_PRACTITIONER).length,
      admin: users.filter((item) => item.role === ROLES.ADMIN).length,
      unset: users.filter((item) => !item.role).length,
    },
    recentUsers: users.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 6),
    recentTickets: tickets.slice(0, 5),
  };
}

function filterUsers(users, { role = "all", status = "all", query = "" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  return users.filter((user) => {
    if (role && role !== "all" && user.role !== role) return false;
    if (status && status !== "all" && (user.status || ACCOUNT_STATUS.ACTIVE) !== status) return false;
    if (!needle) return true;
    return `${user.displayName} ${user.email} ${user.id}`.toLowerCase().includes(needle);
  });
}

const mockApi = {
  async adminGetOverview() {
    return mockOverview();
  },
  async adminListUsers(data = {}) {
    const users = filterUsers(listMockUsers().map(mapMockUser), data);
    users.sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
    const limit = Math.min(Number(data.limit) || 20, 100);
    return { users: users.slice(0, limit), total: users.length, hasMore: users.length > limit };
  },
  async adminGetUser({ userId } = {}) {
    const user = mapMockUser(listMockUsers().find((item) => item.id === userId) || {});
    if (!user.id) throw new Error("User not found.");
    return {
      user,
      subscription: {
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        plan: user.plan,
        status: user.subscriptionStatus,
        periodEnd: user.subscriptionPeriodEnd,
        cancelAtPeriodEnd: user.subscriptionCancelAtPeriodEnd,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
        adminGrant: user.adminGrant?.active ? user.adminGrant : null,
        effectivePlus: effectivePlus(user),
      },
      memberships: householdsFor(user),
      seniors: householdsFor(user).some((item) => item.seniorId === mockSenior.id) ? [{
        id: mockSenior.id,
        displayName: mockSenior.displayName,
        preferredName: mockSenior.preferredName,
        location: mockSenior.location,
        ownerId: mockSenior.ownerId,
        memberCount: mockSenior.memberIds.length,
        careStatus: mockSenior.care?.status || "stable",
      }] : [],
    };
  },
  async adminUpdateUser({ userId, displayName, role, professionalType } = {}) {
    const current = listMockUsers().find((item) => item.id === userId);
    if (!current) throw new Error("User not found.");
    const next = updateMockUser({
      ...current,
      displayName: displayName ?? current.displayName,
      role: role ?? current.role,
      professionalType: professionalType === undefined ? current.professionalType : professionalType,
    });
    return { ok: true, user: mapMockUser(next) };
  },
  async adminSetUserSuspended({ userId, suspended, reason } = {}) {
    const current = listMockUsers().find((item) => item.id === userId);
    if (!current) throw new Error("User not found.");
    if (current.role === ROLES.ADMIN && suspended) {
      const remaining = listMockUsers().filter((item) => item.role === ROLES.ADMIN && item.id !== userId && item.status !== ACCOUNT_STATUS.SUSPENDED);
      if (!remaining.length) throw new Error("Famielda needs at least one active admin.");
    }
    const next = updateMockUser({
      ...current,
      status: suspended ? ACCOUNT_STATUS.SUSPENDED : ACCOUNT_STATUS.ACTIVE,
      suspendedAt: suspended ? new Date().toISOString() : null,
      suspendedBy: suspended ? "user-admin" : null,
      suspendedReason: suspended ? reason : "",
    });
    return { ok: true, user: mapMockUser(next) };
  },
  async adminListFamilies() {
    const families = listMockUsers()
      .map(mapMockUser)
      .filter((item) => item.role === ROLES.FAMILY)
      .map((user) => {
        const owned = user.id === mockSenior.ownerId ? [mockSenior] : [];
        const memberOf = householdsFor(user).length && !owned.length ? [mockSenior] : owned;
        const households = (owned.length ? owned : memberOf).map((senior) => ({
          id: senior.id,
          displayName: senior.displayName,
          preferredName: senior.preferredName,
          location: senior.location,
          ownerId: senior.ownerId,
          memberCount: senior.memberIds?.length || 0,
        }));
        return { ...user, households, seniorCount: households.length };
      });
    return { families, total: families.length };
  },
  async adminListSeniors({ query = "" } = {}) {
    const needle = String(query || "").toLowerCase();
    const owner = listMockUsers().find((item) => item.id === mockSenior.ownerId);
    const seniors = [{
      id: mockSenior.id,
      displayName: mockSenior.displayName,
      preferredName: mockSenior.preferredName,
      location: mockSenior.location,
      ownerId: mockSenior.ownerId,
      memberCount: mockSenior.memberIds.length,
      careStatus: mockSenior.care?.status || "stable",
      ownerName: owner?.displayName || "",
      ownerEmail: owner?.email || "",
    }].filter((item) => `${item.displayName} ${item.location}`.toLowerCase().includes(needle));
    return { seniors, total: seniors.length };
  },
  async adminGetSenior({ seniorId } = {}) {
    if (seniorId && seniorId !== mockSenior.id) throw new Error("Senior profile not found.");
    const owner = listMockUsers().find((item) => item.id === mockSenior.ownerId);
    return {
      senior: {
        id: mockSenior.id,
        displayName: mockSenior.displayName,
        preferredName: mockSenior.preferredName,
        location: mockSenior.location,
        ownerId: mockSenior.ownerId,
        memberCount: mockSenior.memberIds.length,
        careStatus: mockSenior.care?.status || "stable",
      },
      owner: owner ? mapMockUser(owner) : null,
      members: mockCircle.map((member) => ({
        id: member.id,
        userId: member.userId || "",
        name: member.name,
        email: member.email,
        kind: member.kind,
        role: member.role,
        relationship: member.relationship,
        status: member.status,
        professionalType: member.professionalType || "",
      })),
    };
  },
  async adminListProfessionals({ role = ROLES.CAREGIVER } = {}) {
    const professionals = listMockUsers()
      .map(mapMockUser)
      .filter((item) => item.role === role)
      .map((user) => ({ ...user, households: householdsFor(user).filter((item) => item.status === "active" || item.status === "invited") }));
    return { professionals, total: professionals.length, role };
  },
  async adminListSubscriptions() {
    const subscriptions = listMockUsers().map(mapMockUser).map((user) => ({
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      plan: user.plan,
      status: user.subscriptionStatus,
      periodEnd: user.subscriptionPeriodEnd,
      cancelAtPeriodEnd: user.subscriptionCancelAtPeriodEnd,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      adminGrant: user.adminGrant?.active ? user.adminGrant : null,
      effectivePlus: effectivePlus(user),
    }));
    return { subscriptions, total: subscriptions.length, plus: subscriptions.filter((item) => item.effectivePlus).length };
  },
  async adminSetPlanGrant({ userId, grant, reason } = {}) {
    const current = listMockUsers().find((item) => item.id === userId);
    if (!current) throw new Error("User not found.");
    const next = updateMockUser({
      ...current,
      adminGrant: {
        plan: SUBSCRIPTION_PLANS.PLUS,
        active: Boolean(grant),
        reason: reason || "",
        grantedBy: "user-admin",
        grantedByName: "Jordan Hale",
        grantedAt: new Date().toISOString(),
      },
    });
    return { ok: true, user: mapMockUser(next) };
  },
  async adminGetPayments() {
    const created = new Date();
    created.setDate(created.getDate() - 4);
    return {
      generatedAt: new Date().toISOString(),
      invoices: [{
        id: "in_mock_plus",
        number: "MOCK-0001",
        status: "paid",
        amountPaid: 999,
        amountDue: 0,
        currency: "USD",
        createdAt: created.toISOString(),
        customerEmail: "family@famielda.test",
        customerName: "Sarah Walsh",
        hostedInvoiceUrl: "",
      }],
      totals: {
        invoices: 1,
        paid: 1,
        open: 0,
        failed: 0,
        revenueCents: 999,
        monthCents: 999,
      },
    };
  },
  async adminListInvites({ status = "all", query = "" } = {}) {
    const needle = String(query || "").toLowerCase();
    let invites = mockInvites.map((item) => ({ ...item }));
    const overlay = storage.get("famielda.admin.invites") || {};
    invites = invites.map((item) => overlay[item.id] ? { ...item, ...overlay[item.id] } : item);
    if (status !== "all") invites = invites.filter((item) => item.status === status);
    if (needle) {
      invites = invites.filter((item) => `${item.email} ${item.name} ${item.seniorName}`.toLowerCase().includes(needle));
    }
    return { invites, total: invites.length };
  },
  async adminRevokeInvite({ inviteId } = {}) {
    const overlay = storage.get("famielda.admin.invites") || {};
    overlay[inviteId] = { status: INVITE_STATUS.REVOKED, updatedAt: new Date().toISOString() };
    storage.set("famielda.admin.invites", overlay);
    return { ok: true };
  },
  async adminListFamilyReferrals({ status = "all", query = "" } = {}) {
    const { createFamilyReferral } = await import("../models/referral.js");
    const { countsFromReferrals } = await import("../config/referrals.js");
    let referrals = (storage.get("familyReferrals", []) || []).map((item) => createFamilyReferral(item));
    if (status !== "all") referrals = referrals.filter((item) => item.status === status);
    if (query) {
      const needle = String(query).toLowerCase();
      referrals = referrals.filter((item) => `${item.email} ${item.name} ${item.referrerName} ${item.code}`.toLowerCase().includes(needle));
    }
    referrals.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return { referrals, total: referrals.length, counts: countsFromReferrals(referrals) };
  },
  async adminGetProductAnalytics() {
    return getLocalProductAnalytics();
  },
  async adminGetHealthOverview() {
    return getLocalHealthOverview();
  },
  async adminGetReports() {
    const overview = mockOverview();
    return {
      generatedAt: overview.generatedAt,
      users: {
        total: overview.counts.users,
        family: overview.counts.families,
        caregiver: overview.counts.caregivers,
        practitioner: overview.counts.practitioners,
        admin: overview.counts.admins,
        verified: listMockUsers().filter((item) => item.emailVerified).length,
        suspended: overview.counts.suspended,
      },
      households: {
        seniors: overview.counts.seniors,
        pendingInvites: overview.counts.pendingInvites,
        acceptedInvites: mockInvites.filter((item) => item.status === INVITE_STATUS.ACCEPTED).length,
      },
      billing: { plus: overview.counts.plus, free: overview.counts.free },
      activity: {
        visits: overview.counts.visits,
        notifications: mockNotifications.length,
        openTickets: overview.counts.openTickets,
      },
    };
  },
  async adminListNotifications() {
    return { notifications: mockNotifications.slice(0, 40), total: mockNotifications.length };
  },
  async adminSendNotification() {
    return { ok: true, sent: 1 };
  },
  async adminListSupportTickets({ status = "all" } = {}) {
    let tickets = loadTickets();
    if (status !== "all") tickets = tickets.filter((item) => item.status === status);
    return { tickets, total: tickets.length };
  },
  async adminListAuditLogs({ query = "", action = "all" } = {}) {
    const logs = [
      {
        id: "audit-invite",
        action: "circle.invite",
        actorId: "user-family",
        actorName: "Sarah Walsh",
        actorEmail: "family@famielda.test",
        actorRole: "family",
        seniorId: mockSenior.id,
        targetId: "inv-maya",
        ok: true,
        createdAt: "2026-09-02T15:10:00.000Z",
      },
      {
        id: "audit-suspend",
        action: "user.suspended",
        actorId: "user-admin",
        actorName: "Jordan Hale",
        actorEmail: "admin@famielda.test",
        actorRole: "admin",
        targetId: "user-caregiver",
        ok: true,
        createdAt: "2026-09-01T11:40:00.000Z",
        message: "Operational hold",
      },
      {
        id: "audit-billing",
        action: "billing.checkout",
        actorId: "user-family",
        actorName: "Sarah Walsh",
        actorEmail: "family@famielda.test",
        actorRole: "family",
        ok: true,
        createdAt: "2026-08-28T09:05:00.000Z",
      },
    ].filter((item) => {
      if (action && action !== "all" && !item.action.startsWith(action)) return false;
      if (!query) return true;
      const hay = `${item.actorName} ${item.actorEmail} ${item.action} ${item.targetId}`.toLowerCase();
      return hay.includes(String(query).toLowerCase());
    });
    return { logs, total: logs.length };
  },
  async adminCreateSupportTicket(data = {}) {
    const tickets = loadTickets();
    const ticket = createSupportTicket({
      ...data,
      id: `ticket-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: SUPPORT_STATUS.OPEN,
      replies: [],
    });
    tickets.unshift(ticket);
    saveTickets(tickets);
    return { ok: true, ticket };
  },
  async adminUpdateSupportTicket({ ticketId, status, reply, internal } = {}) {
    const tickets = loadTickets();
    const index = tickets.findIndex((item) => item.id === ticketId);
    if (index < 0) throw new Error("Ticket not found.");
    const current = tickets[index];
    const now = new Date().toISOString();
    const replies = [...(current.replies || [])];
    if (reply) {
      replies.push({
        id: `reply-${Date.now()}`,
        authorId: "user-admin",
        authorName: "Jordan Hale",
        body: reply,
        internal: Boolean(internal),
        createdAt: now,
      });
    }
    const next = createSupportTicket({
      ...current,
      status: status || current.status,
      replies,
      updatedAt: now,
      resolvedAt: status === SUPPORT_STATUS.RESOLVED || status === SUPPORT_STATUS.CLOSED ? now : current.resolvedAt,
    });
    tickets[index] = next;
    saveTickets(tickets);
    return { ok: true, ticket: next };
  },
  async createSupportTicket(data = {}) {
    const session = (await import("../auth/session.js")).getSession();
    const tickets = loadTickets();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = tickets.filter((item) => (
      item.userId === (session?.id || data.userId)
      && new Date(item.createdAt || 0).getTime() >= cutoff
    ));
    if (recent.length >= 8) {
      throw new Error("You already sent several support requests today. Wait for a reply, or try again tomorrow.");
    }
    return mockApi.adminCreateSupportTicket({
      ...data,
      userId: session?.id || data.userId,
      userName: session?.displayName || data.userName,
      email: session?.email || data.email,
    });
  },
  async submitPublicContact(data = {}) {
    if (String(data.website || "").trim()) return { ok: true };
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const subject = String(data.subject || "").trim();
    const body = String(data.body || "").trim();
    if (!name) throw new Error("Your name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email so we can reply.");
    if (subject.length < 4) throw new Error("Give the message a short subject.");
    if (body.length < 12) throw new Error("Add a bit more detail so we can help.");
    const tickets = loadTickets();
    const cutoff = Date.now() - 60 * 60 * 1000;
    const recent = tickets.filter((item) => item.source === "website" && Date.parse(item.createdAt || 0) >= cutoff);
    if (recent.length >= 5) throw new Error("Too many messages. Try again later.");
    return mockApi.adminCreateSupportTicket({
      userName: name,
      email,
      subject,
      body,
      category: data.category || "general",
      kind: "contact",
      source: "website",
      audience: data.role || "",
      pageUrl: data.pageUrl || "",
      userAgent: data.userAgent || "",
    });
  },
};

export function listLocalSupportTickets() {
  return loadTickets();
}

async function invoke(name, data = {}) {
  if (!usesLiveAuth()) return mockApi[name](data);
  return callCloudFunction(name, data);
}

export function paymentAmountLabel(cents, currency = "USD") {
  return formatInvoiceAmount(cents, currency) || "$0.00";
}

export const getAdminOverview = (data) => invoke("adminGetOverview", data);
export const listAdminUsers = (data) => invoke("adminListUsers", data);
export const getAdminUser = (data) => invoke("adminGetUser", data);
export const updateAdminUser = (data) => invoke("adminUpdateUser", data);
export const setAdminUserSuspended = (data) => invoke("adminSetUserSuspended", data);
export const listAdminFamilies = (data) => invoke("adminListFamilies", data);
export const listAdminSeniors = (data) => invoke("adminListSeniors", data);
export const getAdminSenior = (data) => invoke("adminGetSenior", data);
export const listAdminProfessionals = (data) => invoke("adminListProfessionals", data);
export const listAdminSubscriptions = (data) => invoke("adminListSubscriptions", data);
export const setAdminPlanGrant = (data) => invoke("adminSetPlanGrant", data);
export const getAdminPayments = (data) => invoke("adminGetPayments", data);
export const listAdminInvites = (data) => invoke("adminListInvites", data);
export const revokeAdminInvite = (data) => invoke("adminRevokeInvite", data);
export const listAdminFamilyReferrals = (data) => invoke("adminListFamilyReferrals", data);
export const getAdminReports = (data) => invoke("adminGetReports", data);
export const getAdminProductAnalytics = (data) => invoke("adminGetProductAnalytics", data);
export const getAdminHealthOverview = (data) => invoke("adminGetHealthOverview", data);
export const listAdminNotifications = (data) => invoke("adminListNotifications", data);
export const sendAdminNotification = (data) => invoke("adminSendNotification", data);
export const listAdminSupportTickets = (data) => invoke("adminListSupportTickets", data);
export const createAdminSupportTicket = (data) => invoke("adminCreateSupportTicket", data);
export const updateAdminSupportTicket = (data) => invoke("adminUpdateSupportTicket", data);
export const listAdminAuditLogs = (data) => invoke("adminListAuditLogs", data);
export const createSupportTicketRequest = (data) => invoke("createSupportTicket", data);
export const submitPublicContactRequest = (data) => invoke("submitPublicContact", data);
