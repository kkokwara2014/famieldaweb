import { bootApp } from "../core/bootstrap.js";
import { qs } from "../core/dom.js";
import { delegate, on } from "../core/events.js";
import { debounce } from "../core/debounce.js";
import { pagerHtml } from "../core/pagination.js";
import { DEBOUNCE_MS, PAGE_SIZE } from "../config/performance.js";
import { ROLES } from "../config/constants.js";
import {
  currentAdminSection,
} from "../config/admin.js";
import { toCsv, downloadTextFile } from "../config/reports.js";
import { PRODUCT_EVENT_META } from "../config/analytics.js";
import { confirmDialog, promptDialog } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { loaderBlock, setButtonLoading } from "../components/loader.js";
import { errorState } from "../components/error-state.js";
import {
  getAdminOverview,
  listAdminUsers,
  getAdminUser,
  updateAdminUser,
  setAdminUserSuspended,
  listAdminFamilies,
  listAdminSeniors,
  getAdminSenior,
  listAdminProfessionals,
  listAdminSubscriptions,
  setAdminPlanGrant,
  getAdminPayments,
  listAdminInvites,
  revokeAdminInvite,
  listAdminFamilyReferrals,
  getAdminReports,
  getAdminProductAnalytics,
  listAdminNotifications,
  sendAdminNotification,
  listAdminSupportTickets,
  createAdminSupportTicket,
  updateAdminSupportTicket,
  listAdminAuditLogs,
  getAdminHealthOverview,
} from "../services/admin-service.js";
import {
  adminNavHtml,
  adminPageHead,
  overviewHtml,
  usersHtml,
  familiesHtml,
  seniorsHtml,
  professionalsHtml,
  subscriptionsHtml,
  paymentsHtml,
  invitationsHtml,
  familyReferralsHtml,
  reportsHtml,
  analyticsHtml,
  healthHtml,
  notificationsHtml,
  supportHtml,
  suspensionHtml,
  verificationQueueHtml,
  auditLogsHtml,
} from "./admin-views.js";
import {
  downloadVerificationFile,
  getVerificationCase,
  listVerificationQueue,
  reviewVerification,
} from "../services/verification-service.js";
import { VERIFICATION_REVIEW_ACTIONS } from "../config/constants.js";

const params = new URLSearchParams(window.location.search);
const section = currentAdminSection();
const session = await bootApp({
  page: "admin",
  requiredRole: ROLES.ADMIN,
  title: section.label,
});

const root = qs("[data-admin-root]");
root.innerHTML = `
  ${adminNavHtml(section.id)}
  ${adminPageHead({ section, session })}
  <div data-admin-body>${loaderBlock("Loading the admin console…")}</div>
`;

const body = qs("[data-admin-body]", root);
let reportCache = null;
let analyticsCache = null;

try {
  body.innerHTML = await renderSection(section.id, params);
} catch (error) {
  body.innerHTML = errorState({
    title: "Admin console could not load",
    body: error.message || "Try again in a moment.",
    actionLabel: "Reload",
    actionHref: window.location.pathname + window.location.search,
  });
}

bindAdmin(root);

function withPager(html, { loaded = 0 } = {}) {
  return `${html}${pagerHtml({ hasMore: false, loaded, limit: PAGE_SIZE })}`;
}

async function renderSection(id, search) {
  const query = search.get("query") || "";
  const role = search.get("role") || "all";
  const status = search.get("status") || "all";
  const selectedId = search.get("id") || "";

  if (id === "overview") {
    const [overview, queue, health] = await Promise.all([
      getAdminOverview(),
      listVerificationQueue().catch(() => ({ counts: {} })),
      getAdminHealthOverview().catch(() => null),
    ]);
    return overviewHtml({ ...overview, verificationCounts: queue.counts || {}, health });
  }

  if (id === "users") {
    const [{ users, hasMore }, selected] = await Promise.all([
      listAdminUsers({ query, role, status, limit: PAGE_SIZE }),
      selectedId ? getAdminUser({ userId: selectedId }).catch(() => null) : null,
    ]);
    return withPager(usersHtml({ users, query, role, status, selected }), { hasMore, loaded: users.length });
  }

  if (id === "families") {
    const { families, hasMore } = await listAdminFamilies({ query, limit: PAGE_SIZE });
    const filtered = query
      ? families.filter((item) => `${item.displayName} ${item.email}`.toLowerCase().includes(query.toLowerCase()))
      : families;
    return withPager(familiesHtml({ families: filtered, query }), { hasMore, loaded: filtered.length });
  }

  if (id === "seniors") {
    const [{ seniors, hasMore }, selected] = await Promise.all([
      listAdminSeniors({ query, limit: PAGE_SIZE }),
      selectedId ? getAdminSenior({ seniorId: selectedId }).catch(() => null) : null,
    ]);
    return withPager(seniorsHtml({ seniors, query, selected }), { hasMore, loaded: seniors.length });
  }

  if (id === "caregivers" || id === "practitioners") {
    const professionalRole = id === "caregivers" ? ROLES.CAREGIVER : ROLES.HEALTH_PRACTITIONER;
    const { professionals, hasMore } = await listAdminProfessionals({ role: professionalRole, limit: PAGE_SIZE });
    const filtered = query
      ? professionals.filter((item) => `${item.displayName} ${item.email}`.toLowerCase().includes(query.toLowerCase()))
      : professionals;
    return withPager(professionalsHtml({ professionals: filtered, role: professionalRole, query }), {
      hasMore,
      loaded: filtered.length,
    });
  }

  if (id === "subscriptions") {
    const { subscriptions, hasMore } = await listAdminSubscriptions({ limit: PAGE_SIZE });
    const filtered = query
      ? subscriptions.filter((item) => `${item.displayName} ${item.email}`.toLowerCase().includes(query.toLowerCase()))
      : subscriptions;
    return withPager(subscriptionsHtml({ subscriptions: filtered, query }), { hasMore, loaded: filtered.length });
  }

  if (id === "payments") {
    return paymentsHtml(await getAdminPayments());
  }

  if (id === "invitations") {
    const { invites, hasMore } = await listAdminInvites({ status, query, limit: PAGE_SIZE });
    return withPager(invitationsHtml({ invites, status, query }), { hasMore, loaded: invites.length });
  }

  if (id === "referrals") {
    const { referrals, hasMore } = await listAdminFamilyReferrals({ status, query, limit: PAGE_SIZE });
    return withPager(familyReferralsHtml({ referrals, status, query }), { hasMore, loaded: referrals.length });
  }

  if (id === "reports") {
    reportCache = await getAdminReports();
    return reportsHtml(reportCache);
  }

  if (id === "analytics") {
    analyticsCache = await getAdminProductAnalytics();
    return analyticsHtml(analyticsCache);
  }

  if (id === "health") {
    const kind = search.get("kind") || "all";
    return healthHtml(await getAdminHealthOverview(), { kind });
  }

  if (id === "notifications") {
    const { notifications, hasMore } = await listAdminNotifications({ limit: PAGE_SIZE });
    return withPager(notificationsHtml({ notifications }), { hasMore, loaded: notifications.length });
  }

  if (id === "support") {
    const { tickets, hasMore } = await listAdminSupportTickets({ status, limit: PAGE_SIZE });
    const selected = selectedId ? tickets.find((item) => item.id === selectedId) || null : null;
    return withPager(supportHtml({ tickets, status, selected }), { hasMore, loaded: tickets.length });
  }

  if (id === "verification") {
    const [{ verifications, counts }, selected] = await Promise.all([
      listVerificationQueue({ status, query, limit: PAGE_SIZE }),
      selectedId ? getVerificationCase(selectedId) : null,
    ]);
    return withPager(verificationQueueHtml({ verifications, counts, status, query, selected }), {
      hasMore: verifications.length >= PAGE_SIZE,
      loaded: verifications.length,
    });
  }

  if (id === "audit") {
    const action = search.get("action") || "all";
    const { logs, hasMore } = await listAdminAuditLogs({ query, action, limit: PAGE_SIZE });
    return withPager(auditLogsHtml({ logs, query, action }), { hasMore, loaded: logs.length });
  }

  if (id === "suspension") {
    const { users, hasMore } = await listAdminUsers({ query, status: "all", limit: PAGE_SIZE });
    return withPager(suspensionHtml({ users, query }), { hasMore, loaded: users.length });
  }

  return overviewHtml(await getAdminOverview());
}

function bindAdmin(host) {
  const submitSearch = debounce((form) => form?.requestSubmit(), DEBOUNCE_MS.SEARCH);
  on(host, "input", (event) => {
    const input = event.target.closest("[data-admin-filter] input[type='search']");
    if (!input) return;
    submitSearch(input.form);
  });

  on(host, "submit", async (event) => {
    const filter = event.target.closest("[data-admin-filter]");
    if (filter) {
      event.preventDefault();
      const next = new URL(window.location.href);
      const form = new FormData(filter);
      ["query", "role", "status", "action", "kind"].forEach((key) => {
        const value = String(form.get(key) || "").trim();
        if (value && value !== "all") next.searchParams.set(key, value);
        else next.searchParams.delete(key);
      });
      next.searchParams.delete("id");
      window.location.assign(`${next.pathname}?${next.searchParams.toString()}${next.hash}`);
      return;
    }

    const userForm = event.target.closest("[data-user-form]");
    if (userForm) {
      event.preventDefault();
      const submit = userForm.querySelector("[type='submit']");
      setButtonLoading(submit, true);
      try {
        await updateAdminUser({
          userId: userForm.dataset.userId,
          displayName: userForm.displayName.value.trim(),
          role: userForm.role.value,
        });
        toast("Account updated.", { type: "success" });
        window.location.reload();
      } catch (error) {
        toast(error.message, { type: "error" });
        setButtonLoading(submit, false);
      }
      return;
    }

    const noticeForm = event.target.closest("[data-notice-form]");
    if (noticeForm) {
      event.preventDefault();
      const submit = noticeForm.querySelector("[type='submit']");
      setButtonLoading(submit, true);
      try {
        const result = await sendAdminNotification({
          title: noticeForm.title.value.trim(),
          body: noticeForm.body.value.trim(),
          role: noticeForm.role.value,
          type: "system",
        });
        toast(`Sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}.`, { type: "success" });
        noticeForm.reset();
      } catch (error) {
        toast(error.message, { type: "error" });
      }
      setButtonLoading(submit, false);
      return;
    }

    const createForm = event.target.closest("[data-ticket-create-form]");
    if (createForm) {
      event.preventDefault();
      const submit = createForm.querySelector("[type='submit']");
      setButtonLoading(submit, true);
      try {
        await createAdminSupportTicket({
          email: createForm.email.value.trim(),
          subject: createForm.subject.value.trim(),
          body: createForm.body.value.trim(),
          category: createForm.category.value,
          priority: createForm.priority.value,
        });
        toast("Ticket logged.", { type: "success" });
        window.location.reload();
      } catch (error) {
        toast(error.message, { type: "error" });
        setButtonLoading(submit, false);
      }
      return;
    }

    const replyForm = event.target.closest("[data-ticket-reply-form]");
    if (replyForm) {
      event.preventDefault();
      const submit = replyForm.querySelector("[type='submit']");
      setButtonLoading(submit, true);
      try {
        await updateAdminSupportTicket({
          ticketId: replyForm.dataset.ticketId,
          status: replyForm.status.value,
          reply: replyForm.reply.value.trim(),
          internal: Boolean(replyForm.internal?.checked),
        });
        toast("Ticket updated.", { type: "success" });
        window.location.reload();
      } catch (error) {
        toast(error.message, { type: "error" });
        setButtonLoading(submit, false);
      }
    }
  });

  delegate(host, "click", "[data-suspend-user]", async (_event, button) => {
    const suspend = button.dataset.suspended === "1";
    let reason = "";
    if (suspend) {
      reason = await promptDialog({
        title: "Suspend this account?",
        body: "They will not be able to sign in on web or mobile until you restore access.",
        label: "Reason",
        placeholder: "Why is this account being suspended?",
        confirmLabel: "Suspend",
        required: true,
      });
      if (reason == null) return;
    } else {
      const confirmed = await confirmDialog({
        title: "Restore this account?",
        body: "They will be able to sign in again immediately.",
        confirmLabel: "Restore access",
      });
      if (!confirmed) return;
    }

    setButtonLoading(button, true);
    try {
      await setAdminUserSuspended({
        userId: button.dataset.userId,
        suspended: suspend,
        reason,
      });
      toast(suspend ? "Account suspended." : "Access restored.", { type: "success" });
      window.location.reload();
    } catch (error) {
      toast(error.message, { type: "error" });
      setButtonLoading(button, false);
    }
  });

  delegate(host, "click", "[data-grant-plus]", async (_event, button) => {
    const grant = button.dataset.grant === "1";
    const reason = grant
      ? await promptDialog({
        title: "Grant Famielda Plus?",
        body: "This is an operational grant. It does not create a Stripe charge.",
        label: "Reason",
        placeholder: "Why is Plus being granted?",
        confirmLabel: "Grant Plus",
      })
      : "";
    if (grant && reason == null) return;
    if (!grant) {
      const confirmed = await confirmDialog({
        title: "Revoke the Plus grant?",
        body: "Stripe billing is unchanged. The household returns to whatever plan Checkout last activated.",
        confirmLabel: "Revoke grant",
        danger: true,
      });
      if (!confirmed) return;
    }

    setButtonLoading(button, true);
    try {
      await setAdminPlanGrant({
        userId: button.dataset.userId,
        grant,
        reason: reason || "",
      });
      toast(grant ? "Plus granted." : "Grant revoked.", { type: "success" });
      window.location.reload();
    } catch (error) {
      toast(error.message, { type: "error" });
      setButtonLoading(button, false);
    }
  });

  delegate(host, "click", "[data-revoke-invite]", async (_event, button) => {
    const confirmed = await confirmDialog({
      title: "Revoke this invitation?",
      body: "The invitee will no longer be able to join this household with this link.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!confirmed) return;
    setButtonLoading(button, true);
    try {
      await revokeAdminInvite({ inviteId: button.dataset.inviteId });
      toast("Invitation revoked.", { type: "success" });
      window.location.reload();
    } catch (error) {
      toast(error.message, { type: "error" });
      setButtonLoading(button, false);
    }
  });

  delegate(host, "click", "[data-export-report]", () => {
    const report = reportCache;
    if (!report) return;
    const rows = [
      ["Metric", "Value"],
      ["Generated", report.generatedAt || ""],
      ["Users", report.users?.total ?? 0],
      ["Family", report.users?.family ?? 0],
      ["Caregivers", report.users?.caregiver ?? 0],
      ["Practitioners", report.users?.practitioner ?? 0],
      ["Suspended", report.users?.suspended ?? 0],
      ["Seniors", report.households?.seniors ?? 0],
      ["Plus", report.billing?.plus ?? 0],
      ["Free", report.billing?.free ?? 0],
      ["Visits", report.activity?.visits ?? 0],
      ["Open tickets", report.activity?.openTickets ?? 0],
    ];
    downloadTextFile(`famielda-admin-report.csv`, toCsv(rows));
    toast("Report downloaded.", { type: "success" });
  });

  delegate(host, "click", "[data-export-analytics]", () => {
    const report = analyticsCache;
    if (!report) return;
    const rows = [
      ["Event", "All time", "Last 7 days", "Last 30 days"],
      ...PRODUCT_EVENT_META.map((item) => [
        item.label,
        report.totals?.[item.id] ?? 0,
        report.last7?.[item.id] ?? 0,
        report.last30?.[item.id] ?? 0,
      ]),
    ];
    downloadTextFile("famielda-product-analytics.csv", toCsv(rows));
    toast("Analytics downloaded.", { type: "success" });
  });

  delegate(host, "click", "[data-open-ticket]", () => {
    qs("[data-ticket-create]")?.scrollIntoView({ behavior: "smooth", block: "start" });
    qs("[data-ticket-create-form] [name='subject']")?.focus();
  });

  delegate(host, "click", "[data-download-vdoc]", async (_event, button) => {
    try {
      const blob = await downloadVerificationFile(button.dataset.downloadVdoc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = button.dataset.fileName || "document";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error.message, { type: "error" });
    }
  });

  delegate(host, "click", "[data-review-verification]", async (_event, button) => {
    const action = button.dataset.reviewAction;
    const userId = button.dataset.reviewVerification;
    const needsNotes = action === VERIFICATION_REVIEW_ACTIONS.REJECT || action === VERIFICATION_REVIEW_ACTIONS.SUSPEND;
    let notes = "";
    if (needsNotes) {
      notes = await promptDialog({
        title: action === VERIFICATION_REVIEW_ACTIONS.SUSPEND ? "Suspend this professional?" : "Reject this file?",
        body: action === VERIFICATION_REVIEW_ACTIONS.SUSPEND
          ? "They will not be able to accept new visits until the file is restored."
          : "They can upload clearer documents and submit again.",
        confirmLabel: action === VERIFICATION_REVIEW_ACTIONS.SUSPEND ? "Suspend" : "Reject",
        label: "Reason",
        placeholder: action === VERIFICATION_REVIEW_ACTIONS.SUSPEND
          ? "License lapsed, complaint, or other reason."
          : "What should they fix?",
        required: true,
        danger: true,
      });
      if (notes == null) return;
    } else if (action === VERIFICATION_REVIEW_ACTIONS.VERIFY) {
      const confirmed = await confirmDialog({
        title: "Verify this professional?",
        body: "Families will see a verified badge on this caregiver or practitioner.",
        confirmLabel: "Verify",
      });
      if (!confirmed) return;
    } else if (action === VERIFICATION_REVIEW_ACTIONS.RESTORE) {
      const confirmed = await confirmDialog({
        title: "Restore this professional?",
        body: "They will be verified again and can accept visits.",
        confirmLabel: "Restore",
      });
      if (!confirmed) return;
    } else if (action === VERIFICATION_REVIEW_ACTIONS.START_REVIEW) {
      const confirmed = await confirmDialog({
        title: "Move this file under review?",
        body: "The professional will see that an admin is looking at their documents.",
        confirmLabel: "Start review",
      });
      if (!confirmed) return;
    }

    setButtonLoading(button, true);
    try {
      await reviewVerification({ userId, action, notes });
      toast("Verification updated.", { type: "success" });
      window.location.reload();
    } catch (error) {
      toast(error.message, { type: "error" });
      setButtonLoading(button, false);
    }
  });
}
