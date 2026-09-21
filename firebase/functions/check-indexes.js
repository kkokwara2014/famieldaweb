/**
 * Tier B runtime index smoke (definitive; USER-RUN, needs credentials).
 *
 * The Firestore emulator does not enforce composite/collection-group indexes,
 * so Tier A (`npm run test:indexes` in famielda/functions) can only verify the
 * static config. This script executes each manifest query READ-ONLY
 * (`.limit(1).get()`) against a REAL project and reports queries that fail
 * with a missing-index error. This is the ONLY check that reflects the
 * production index state — run it after any index change or new query.
 *
 * Read-only: every query uses `.limit(1).get()`; nothing is written. It never
 * prints credentials — only query ids, ok/missing verdicts, and the
 * missing-index error text (which contains a console link to create it).
 *
 * Usage (user runs; deploy/data rules: this performs reads only):
 *   gcloud auth application-default login
 *   node check-indexes.js --project famielda
 *   # or: GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node check-indexes.js --project famielda
 *
 * Exit 0 when all queries succeed; exit 1 when any query reports a missing
 * index (or another error — those are reported distinctly).
 */

const admin = require("firebase-admin");

const SMOKE_STR = "__index_smoke__";
const SMOKE_EMAIL = "index-smoke@example.com";
const EPOCH = new Date(0);

function parseProject() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--project=")) return argv[i].slice("--project=".length);
    if (argv[i] === "--project" && i + 1 < argv.length) return argv[i + 1];
  }
  if (argv.length === 1 && !argv[0].startsWith("--")) return argv[0];
  return process.env.FIRESTORE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
}

/** Mirrors Tier A MANIFEST entries that require a custom index. */
function smokeQueries(db) {
  const cg = (collection) => db.collectionGroup(collection);
  const col = (collection) => db.collection(collection);
  const q = (id, ref) => ({id, ref: ref.limit(1)});
  return [
    q("locks.professional", cg("scheduleVisits").where("professionalId", "==", SMOKE_STR)),
    q("locks.caregiver", cg("scheduleVisits").where("caregiverId", "==", SMOKE_STR)),
    q("locks.appt-assignee", cg("appointments").where("assignedUserId", "==", SMOKE_STR)),
    q("shifts.resolve-professional", cg("caregivers").where("userId", "==", SMOKE_STR)),
    q("shifts.resolve-professional-by-email", cg("caregivers").where("email", "==", SMOKE_EMAIL)),
    q("limits.circle-by-user", cg("circleMembers").where("userId", "==", SMOKE_STR).where("status", "==", "active")),
    q("limits.circle-by-email", cg("circleMembers").where("email", "==", SMOKE_EMAIL).where("status", "==", "active")),
    q("invites.dup-email", col("careCircleInvites").where("familyId", "==", SMOKE_STR).where("seniorId", "==", SMOKE_STR).where("email", "==", SMOKE_EMAIL).where("status", "==", "pending")),
    q("invites.dup-phone", col("careCircleInvites").where("familyId", "==", SMOKE_STR).where("seniorId", "==", SMOKE_STR).where("phone", "==", SMOKE_STR).where("status", "==", "pending")),
    q("triggers.pending-by-email", col("careCircleInvites").where("email", "==", SMOKE_EMAIL).where("status", "==", "pending")),
    q("triggers.task-sweep", cg("carePlanTasks").where("status", "==", SMOKE_STR).where("dueDate", ">=", EPOCH).where("dueDate", "<=", new Date())),
    q("triggers.dose-sweep", cg("medicationDoses").where("status", "==", "scheduled").where("notifyEnabled", "==", true).where("scheduledAt", ">=", EPOCH).where("scheduledAt", "<=", new Date())),
    q("triggers.appt-sweep", cg("appointments").where("status", "==", "upcoming").where("notifyEnabled", "==", true).where("scheduledAt", ">=", EPOCH).where("scheduledAt", "<", new Date())),
    q("referrals.referrer-window", col("familyReferrals").where("referrerId", "==", SMOKE_STR).where("createdAt", ">=", EPOCH)),
    q("referrals.referrer-legacy-window", col("familyReferrals").where("referrerUserId", "==", SMOKE_STR).where("createdAt", ">=", EPOCH)),
    q("referrals.legacy-window", col("referrals").where("referrerUserId", "==", SMOKE_STR).where("createdAt", ">=", EPOCH)),
    q("claims.circle", cg("circleMembers").where("userId", "==", SMOKE_STR).where("status", "==", "active")),
    q("claims.members", cg("members").where("userId", "==", SMOKE_STR)),
    q("stripe.sub-by-customer", cg("subscription").where("stripeCustomerId", "==", SMOKE_STR)),
    q("entitlements.pending-invites", col("careCircleInvites").where("familyId", "==", SMOKE_STR).where("seniorId", "==", SMOKE_STR).where("status", "==", "pending")),
    q("archive.invites-by-senior", col("careCircleInvites").where("familyId", "==", SMOKE_STR).where("seniorId", "==", SMOKE_STR)),
    q("avail.by-userid", cg("scheduleVisits").where("caregiverUserId", "==", SMOKE_STR)),
    q("avail.by-email", cg("scheduleVisits").where("caregiverEmail", "==", SMOKE_EMAIL)),
    q("meds.reminder-sweep", cg("medications").where("reminderSent", "==", false).where("reminderAt", "<=", new Date())),
    q("appts.reminder-sweep", cg("appointments").where("reminderSent", "==", false).where("reminderAt", "<=", new Date())),
    q("web.members-by-user", cg("circleMembers").where("userId", "==", SMOKE_STR)),
    q("admin.notif-list", cg("notifications").orderBy("createdAt", "desc")),
    q("admin.tickets-filtered", col("supportTickets").where("status", "==", SMOKE_STR).orderBy("createdAt", "desc")),
    q("admin.tickets-by-user", col("supportTickets").where("userId", "==", SMOKE_STR).orderBy("createdAt", "desc")),
    q("web.stripe.member-lookup", cg("members").where("userId", "==", SMOKE_STR)),
    q("web.referrals.code-pending", col("familyReferrals").where("code", "==", SMOKE_STR).where("status", "==", "pending")),
    q("verification.list", col("professionalVerifications").where("status", "==", SMOKE_STR).where("role", "==", SMOKE_STR)),
  ];
}

function isMissingIndex(error) {
  const message = (error && error.message) || String(error);
  return (error && error.code === 9) || /requires an index|failed-precondition/i.test(message);
}

async function main() {
  const projectId = parseProject();
  if (!projectId) {
    console.error("Usage: node check-indexes.js --project <projectId>  (reads only, no writes)");
    process.exitCode = 2;
    return;
  }
  admin.initializeApp({projectId});
  const db = admin.firestore();
  console.log(`Index smoke against project "${projectId}" (read-only, limit(1) each):`);

  let missing = 0;
  let errors = 0;
  for (const {id, ref} of smokeQueries(db)) {
    try {
      await ref.get();
      console.log(`[ok] ${id}`);
    } catch (error) {
      const message = ((error && error.message) || String(error)).split("\n")[0];
      if (isMissingIndex(error)) {
        missing += 1;
        console.log(`[MISSING-INDEX] ${id} :: ${message}`);
      } else {
        errors += 1;
        console.log(`[ERROR] ${id} :: ${message}`);
      }
    }
  }
  console.log(`\n${missing === 0 && errors === 0 ? "all queries served" : `${missing} missing-index, ${errors} other errors`}`);
  console.log("Note: add missing indexes to firestore.indexes.json (web-owned) and deploy with `firebase deploy --only firestore:indexes`.");
  if (missing > 0 || errors > 0) process.exitCode = 1;
  await admin.app().delete().catch(() => {});
}

main().catch((error) => {
  console.error(`fatal: ${(error && error.message) || error}`);
  process.exitCode = 2;
});
