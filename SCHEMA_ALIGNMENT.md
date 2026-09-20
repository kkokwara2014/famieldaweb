# Famielda — Unified Schema & Backend Decisions

Status: **locked for implementation** (owner approved web + Firebase changes, 2026).
Scope: **data schema and collection sync only.** No new features are added to either
app; mobile and web feature sets remain as they are. This document is the single
contract both apps and all Cloud Functions follow.

Owner decisions to be reported at completion are marked **[REPORT]**.

---

## 1. Guiding principles

1. **One canonical collection/field per concept.** No two human-writable fields
   meaning the same thing.
2. **Web names for shared collections and fields** (web's naming is more
   descriptive and the web repo now owns Firestore config). **Mobile's nesting
   for placement**: senior-scoped data lives in subcollections under the senior.
3. **Derived data is server-written only** (`memberIds`, usage counts, rating
   aggregates). Clients never write derived fields.
4. **One writer per state machine.** A state transition is performed by exactly
   one function, called by both apps.
5. **Additive, never lossy.** Mobile-only fields/collections are kept as
   additive; no status is collapsed to another (e.g. `archived` is never mapped
   to `removed`).
6. **Idempotent, deterministic IDs** for any scripted writes.

---

## 2. Canonical schema

### Identity & grouping
```
users/{uid}
  ├─ devices/{deviceId}                 # single push-token registry (retire fcmTokens)
  └─ notifications/{notificationId}     # canonical per-user inbox
families/{familyId}
  ├─ members/{uid}
  ├─ usage/current                      # server-written plan counters
  ├─ subscription/current               # family-scoped billing (canonical)
  └─ payments/{paymentId}
```

### Core entity
```
seniors/{seniorId}                      # TOP-LEVEL, has familyId + ownerId + memberIds
```
`ownerId`/`memberIds` are **server-maintained projections** derived from the
family + circle; clients never write them.

### Senior-owned subcollections
```
seniors/{seniorId}/circleMembers/{uid}          # per-senior access boundary
seniors/{seniorId}/scheduleVisits/{visitId}
seniors/{seniorId}/carePlans/{planId}
seniors/{seniorId}/carePlanTasks/{taskId}
seniors/{seniorId}/carePlanCompletions/{completionId}
seniors/{seniorId}/medications/{medicationId}
seniors/{seniorId}/medicationDoses/{doseId}
seniors/{seniorId}/vitalReadings/{readingId}    # mobile-only, additive
seniors/{seniorId}/visitReports/{reportId}      # mobile-only, additive
seniors/{seniorId}/appointments/{appointmentId}
seniors/{seniorId}/emergencyAlerts/{alertId}    # mobile-only, additive
seniors/{seniorId}/documents/{documentId}       # web document vault
seniors/{seniorId}/activities/{activityId}      # web activity feed
seniors/{seniorId}/careSummary/current          # mobile-only, additive
```

### Cross-cutting top-level
```
conversations/{conversationId}                   # circle + direct chat
messages/{messageId}                             # message rows (top-level)
careCircleInvites/{inviteId}
caregiverScheduleLocks/{professionalId}          # server-only
professionalDiscovery/{professionalId}           # mobile-only
professionalRatingSummaries/{professionalId}     # mobile-only
professionalPublicRatings/{ratingId}             # mobile-only
professionalRatings/{ratingId}                   # mobile-only
reviewReports/{reportId}                         # mobile-only
ratingAbuseControls/{userId}                     # mobile-only
professionalVerifications/{userId}               # web model (canonical)
professionalVerificationDocuments/{documentId}   # web model (canonical)
familyReferrals/{referralId}
familyReferralCodes/{userId}
familyReferralCodeIndex/{code}
referralConfig/current                           # mobile-only
referralStats/platform                           # mobile-only
supportTickets/{ticketId}                        # web-only
adminAuditLogs/{logId}                           # web-only
auditLogs/{logId}                                # web-only
monitoringEvents/{eventId}                       # web-only
analyticsEvents/{eventId}                        # web-only
rateLimits/{limitId}                             # web-only
platformEvents/{eventId}                         # server-only
stripeWebhookEvents/{eventId}                    # server-only
stripeCustomers/{customerId}                     # server-only
stripeEvents/{eventId}                           # server-only
```

**Dropped:** `scheduleEvents` (vestigial), `users/{uid}/fcmTokens`,
top-level `notifications`, top-level `subscriptions`, `referrals`,
`referralCodes`, `careInvitations`, `shifts`, `dailyTasks`, `circleMembers`
(top-level), `professionalScheduleLocks`, `caregiverAvailability` (embedded on
the caregiver circle member), `activities` top-level.

---

## 3. Naming rules

| Concept | Canonical |
|---|---|
| Care circle member | `seniors/{id}/circleMembers/{uid}` |
| Invite | `careCircleInvites` |
| Schedule/visit | `scheduleVisits` |
| Care plan / task / completion | `carePlans` / `carePlanTasks` / `carePlanCompletions` |
| Referrals | `familyReferrals` / `familyReferralCodes` / `familyReferralCodeIndex` |
| Lock | `caregiverScheduleLocks` |
| Chat | `conversations` + top-level `messages` |
| Verification | `professionalVerifications` + `professionalVerificationDocuments` |
| Push tokens | `users/{uid}/devices` |
| Inbox | `users/{uid}/notifications` |
| Role value (family) | `family_member` |
| Role value (practitioner) | `health_practitioner` |
| Avatar field | `photoUrl` |
| Preferences field | `notificationPreferences` |

---

## 4. Field shapes for shared entities (canonical + additive)

Only deltas from the current web shape are listed; web fields are the base.

### `seniors/{id}`
- Base (web): `ownerId`, `memberIds`, `displayName`, `dateOfBirth` (**Timestamp**),
  `gender`, `phone`, `address` (**map**: street, city, state, country, postalCode,
  latitude, longitude), `photoUrl`, `conditions[]`, `allergies[]`,
  `emergencyContacts[]`, `carePreferences` (**map**), `importantInfo` (**map**),
  `care` (map), timestamps.
- Additive (mobile): `familyId`, `linkedUserId`, `status` (`active|archived`),
  `archivedAt`, `archivedBy`, `mobilityInfo`, `dietaryRequirements`, `notes`,
  `primaryCaregiverUserId`, `primaryCaregiverName`, `emergencyInformation`.
- Server-derived: `memberIds`.

### `seniors/{id}/circleMembers/{uid}`
- Base (web): `seniorId`, `userId`, `name`, `email`, `phone`, `role`
  (`owner|coordinator|member|viewer`), `permissions[]`, `kind`
  (`family|caregiver|practitioner`), `professionalType`, `status`
  (`active|invited|declined|removed|archived`), `availability`, `lastSeenAt`,
  `nextVisit`, `notes`, `invitedBy`, timestamps.
- Additive (mobile): `familyId`, `permission` (legacy singular),
  `isPrimaryCaregiver`, `isEmergencyContact`, `seniorName`, `relationship`,
  `invitationId`, `joinedAt`, `startedAt`, `endedAt`, `careStatus`,
  `qualifications`, `certifications`, `experienceNotes`, `yearsOfExperience`,
  `assignedSeniors[]`.
- `archived` is an **additive status** (senior archive); web must render it.

### `careCircleInvites/{id}`
- Base (web): `token`, `seniorId`, `seniorName`, `email`, `phone`, `channel`,
  `inviteeUserId`, `kind`, `role`, `permissions[]`, `status`
  (`pending|accepted|declined|revoked`), `invitedBy`, `invitedByName`,
  `memberId`, timestamps.
- Additive (mobile): `familyId`, `permission` (legacy), `expiresAt`,
  `isPrimaryCaregiver`, `isEmergencyContact`, `caregiverId`, `acceptedBy`.
- `cancelled` (mobile) → **`revoked`**.

### `seniors/{id}/scheduleVisits/{id}`
- Base (web): `seniorId`, `seniorName`, `familyId`, `caregiverUserId`,
  `caregiverEmail`, `caregiverMemberId`, `date` (YYYY-MM-DD),
  `startTime`/`endTime` (HH:mm), `startsAt`/`endsAt` (epoch ms), `timeZone`,
  `status` (`requested|accepted|declined|checked_in|checked_out|cancelled|expired`),
  `requestedBy`, `requestedByName`, timestamps, `report` (map).
- Additive (mobile): `startAt`/`endAt` (Timestamp), `careLocation`,
  `careInstructions`, `tasks[]`, `recurrence`, `seriesId`, `professionalId`,
  `professionalRole`, `checkInAt`/`checkInLocation`/`checkInBy`,
  `checkOutAt`/`checkOutLocation`/`checkOutBy`, `completedTasks`,
  `visitDurationMinutes`, `notifiedAt`, `notificationStatus`.
- Status map: `pending→requested`, `scheduled→accepted`, `inProgress→checked_in`,
  `completed→checked_out`, `declined→declined`, `cancelled→cancelled`,
  `expired→expired` (additive).
- Conflict engine: half-open overlap on `startsAt`/`endsAt`; blocking =
  `accepted|checked_in`. **Logic unchanged.**

### `seniors/{id}/carePlans` + `carePlanTasks` + `carePlanCompletions`
- One real default plan per senior: `carePlans/{seniorId}_default`.
- `carePlanTasks` base (web): `planId`, `seniorId`, `title`, `notes`, `category`,
  `priority`, `frequency`, `dueDate`, `dueTime`, `weekday`, `repeatUntil`,
  `assignedCaregiverId`/`UserId`/`Email`/`Name`, `status`, `lastCompletedAt/By`,
  `completionCount`, `createdBy`, timestamps.
- Additive (mobile): `familyId`, `recurrence` (`none|daily|weekdays|weekly`),
  `seriesId`, `description`, `scheduledAt`, `assignedUserId`,
  `assignedDisplayName`, `completedAt`, `statusUpdatedBy`, `statusUpdatedAt`.
- Current state = task fields; `carePlanCompletions` = append-only history;
  both written atomically by the same writer.

### `seniors/{id}/appointments/{id}`
- Base (web): `seniorId`, `title`, `date`, `time`, `endTime`, `location`,
  `notes`, `status` (`scheduled|confirmed|completed|cancelled|missed|rescheduled`),
  `practitionerId`, `practitionerUserId`, `practitionerEmail`,
  `practitionerName`, `reminder`, `reminderAt`, `reminderSent`, timestamps.
- Additive (mobile): `familyId`, `clinic`, `type`, `scheduledAt` (Timestamp),
  `doctor`, `transportation`, `notifyEnabled`, `assignedUserId`,
  `assignedDisplayName`, `assignmentStatus` (`pending|accepted|declined`),
  `durationMinutes`, `assignmentUpdatedBy`, `assignmentRespondedAt`.
- `upcoming`→`scheduled`; `rescheduled` is additive.
- `practitionerUserId` (clinician the visit is with) and `assignedUserId`
  (practitioner who accepted) are **both kept**; they are different roles.

### `medications` / `medicationDoses`
- Base (web): `medications`: `seniorId`, `name`, `dosage`, `frequency`,
  `time`/`secondTime`/`thirdTime`, `weekday`, `startDate`/`endDate`, `reminder`,
  `status` (`active|paused|ended`), `responsibleUserId`, `clinicianUserId`,
  timestamps. `medicationDoses`: `medicationId`, `seniorId`, `name`, `dosage`,
  `date`, `time`, `slotKey`, `outcome` (`taken|skipped|missed`), `recordedBy`,
  `recordedAt`.
- Additive (mobile): `familyId`, `route`, `scheduleTimes[]` (hour/minute),
  `isActive`, `notifyEnabled`, `prescribingDoctor`, `pharmacy`, `instructions`,
  `scheduledAt` (Timestamp), `status` (`scheduled|taken|skipped|missed`),
  `instructions`, `takenAt`, `statusUpdatedBy`.

### `users/{uid}`
- Role: `family_member` | `caregiver` | `health_practitioner` | `senior` |
  `unassigned` | `admin`.
- `photoUrl`, `notificationPreferences`, `discoverable`, `professionalProfile`,
  `liveAvailability`, `fcmTokens` (array, server-maintained legacy),
  `activeProfessionalFamilyIds` (server), `plan` (`free|plus`),
  `subscriptionStatus`, Stripe ids, `currentPeriodEnd`, `cancelAtPeriodEnd`,
  referral fields.
- Verification lives in `professionalVerifications/{uid}` +
  `professionalVerificationDocuments/{docId}` (not embedded).

### `families/{familyId}`
- Base (mobile): `name`, `createdBy`, `createdAt`, `updatedAt`,
  `primaryCaregiverUserId`, `primaryCaregiverName`.
- `members/{uid}`: `userId`, `role` (`admin|member`), `joinedAt`.

---

## 5. Functions management [REPORT]

- **Two codebases, one Firebase project (`famielda`):**
  - `mobile` — deployed from `famielda/functions`.
  - `web` — deployed from `famieldaweb/firebase/functions`.
  - Deploying one never deletes the other.
- **One owner per shared feature**; both clients call the same canonical
  function name. Proposed owners:
  | Feature | Owner |
  |---|---|
  | Care circle invites + accept/decline/remove | mobile |
  | Scheduling (`scheduleVisits`) + conflict engine | mobile |
  | Appointments (incl. assignment accept/decline) | mobile |
  | Care circle membership + senior create/archive | mobile |
  | Discovery projection | mobile |
  | Ratings / reviews | mobile |
  | Care history | mobile |
  | Referrals | mobile |
  | Family billing / Stripe (family-scoped) | mobile |
  | Verification lifecycle | web |
  | Admin console / support / monitoring / analytics | web |
  | Notifications fan-out + reminder schedulers | mobile |
- **Single owner** for the Stripe webhook, all scheduled reminders, and all
  Firestore/Auth event triggers (no duplicate side effects).
- **Consolidation status (as built — complete):**
  - Exact name collisions resolved: web's `stripeWebhook` and
    `acceptCareCircleInvite` are removed from deployment; mobile's survive.
  - Web client billing calls repointed to mobile (`createSubscriptionCheckout`,
    `createBillingPortalSession`, `resumeFamilySubscription`,
    `getSubscriptionCatalog`); `previewScheduleConflict` repointed to
    `checkProfessionalAvailability`.
  - Web's care-circle/scheduling/appointments/medications/care-plans functions
    were retired; the web client now calls mobile's callables where they exist
    (`sendCareCircleInvite`, `saveCareShift`, `respondToCareShift`) and otherwise
    performs **direct writes governed by the unified rules** (decline/revoke
    invite, remove/update member, cancel, check-in/out, visit reports, notes) —
    the same path mobile uses. One code path per operation.
- Retired web duplicates (removed from deploy): see `firebase/functions/index.js`
  — care-circle invite/accept/decline/remove/update/revoke/resend,
  scheduling request/accept/decline/cancel/modify/extend/check-in/check-out,
  appointments save/cancel/status, medications save/log, care-plans
  save/assign/complete/note, and the billing functions above.

### 5.1 Stripe & billing (single shared account) — CRITICAL

- Both apps charge through **one Stripe account** and **one webhook endpoint**.
- **The only `stripeWebhook` in the project is mobile's.** Web exports no Stripe
  function at all, so deploying web can never create or change a webhook URL.
- Deployed mobile webhook URL (stable per function name + region):
  `https://stripewebhook-odscsorula-uc.a.run.app`
- All subscription state is **family-scoped**:
  `families/{familyId}/subscription/current` (+ `families/{familyId}/payments`).
  Web's per-user `subscriptions/{uid}` is retired.
- Web's billing buttons call mobile's billing functions; every event (from either
  app) lands at the one endpoint and is processed **once** — no double-processing.
- **Manual step:** the Stripe Dashboard → Developers → Webhooks endpoint URL must
  point at the mobile `stripeWebhook` URL above. Editing an existing endpoint's
  URL keeps its signing secret; creating a new endpoint yields a new `whsec_…`
  which must be set via `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`.

### 5.2 Deployed function codebases

- `mobile` — deployed from `famielda/functions` (first successful deploy under
  this codebase; pre-existing functions were updated in place, no conflicts).
- `web` — deployed from `famieldaweb/firebase/functions`.
- Required Secret Manager secrets (project-level, shared): `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `MAIL_SMTP_USER`, `MAIL_SMTP_PASS`.
- Non-secret params live in `famielda/functions/.env.famielda` (mobile) and
  `famieldaweb/firebase/functions/.env` (web).

---

## 6. Rules & indexes ownership [REPORT]

- Canonical rules: `famieldaweb/firebase/firestore.rules`.
- Canonical indexes: `famieldaweb/firebase/firestore.indexes.json`.
- `famieldaweb/firebase/firebase.json` already points at both.
- **Remove the `"firestore"` block from `famielda/firebase.json`** so the mobile
  repo can never overwrite rules/indexes. Mobile deploys only its functions.
- Consequence: all rules/index changes flow through the web repo.

---

## 7. Data handling [REPORT]

- **Export before wipe** (read-only). Recommended: per-collection JSON dump via
  the Admin SDK (no bucket needed) or `gcloud firestore export gs://<bucket>`.
- **Wipe test data** after the export is verified. Manual, owner-run.
- **No reseeding.** Collections are created implicitly by real usage.
- I do not export, wipe, or deploy; the owner performs these.

---

## 8. Locked defaults (override only if you disagree)

1. **Billing is family-scoped** (`families/{familyId}/subscription/current`),
   not per-user. Web's `subscriptions/{uid}` is retired. *(Largest web effort.)*
2. **Chat uses web's model** (`conversations` + top-level `messages`), which
   covers both care-circle group chat and direct messages. Mobile's
   senior-scoped `messages` is retired and mobile adapts.
3. **Notifications are per-user** (`users/{uid}/notifications`). Web's top-level
   `notifications` is retired.
4. **Verification uses separate collections** (web model), not the embedded map.

---

## 9. Feature preservation guarantees

These mobile features are preserved as additive fields/collections and are
covered by the unified rules:
appointment assignment/accept-decline (`assignmentStatus`), discovery
(`professionalDiscovery`), vitals (`vitalReadings`), ratings/reviews,
professional-type-scoped writes, senior archive (`archived`), care summary,
emergency alerts, and family-scoped billing.
