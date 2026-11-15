# JOB N JOB — Transactional Email (Resend)

The portal remains fully functional when Resend is unavailable or email is
disabled. Email is an additional notification channel; every business write and
every in-app notification is committed first.

The subsystem is currently **local-only**. It is not deployed to production and
must stay disabled until a deliberate deployment and domain verification.

## Flow

```text
Business route
  → prepare a durable EmailIntent (state: pending)
  → perform the normal business write
      student/company created, drive created/closed,
      application created, status transition,
      company approved
  → commit the intent (state: ready)
  → best-effort outbox insert (unique idempotency key)
  → bounded worker/cron:
      reconcile pending intents against the business document
      flush ready intents into the outbox
      drain the outbox through Resend
  → Resend SDK (idempotency key per event)
  → verified webhook inbox
  → delivered / delayed / bounced / complained
```

`sent` in the outbox means **Resend accepted the request**. It does not mean the
message was delivered. Delivery is only recorded by the signed webhook.

MongoDB transactions are deliberately not required. The local test database and
many small deployments run a standalone MongoDB server, which does not support
transactions. The intent journal plus business-state verification closes the same
crash windows without a replica set:

| Crash point | Recovery |
|---|---|
| Before the business write | Intent stays `pending`; reconciliation checks the business document and eventually skips it if the write never happened. |
| After the business write, before commit | Reconciliation verifies the document (and the exact status-transition id) and marks the intent `ready`. |
| After commit, before outbox insert | The worker flushes the ready intent and the outbox unique key makes a replay harmless. |
| After `sent` but before the database update | Resend's idempotency key plus the worker lease/fencing make a replay safe. |

## Files

| File | Purpose |
|---|---|
| `server/models/email-intent.js` | Durable intent journal and unique indexes |
| `server/models/email-outbox.js` | Durable outbox, provider status and indexes |
| `server/models/email-webhook-event.js` | Durable webhook inbox, retry fields and TTL |
| `server/models/email-fanout-job.js` | One bounded drive-announcement job per drive |
| `server/email/intents.js` | Prepare/commit/skip/reconcile/flush intents |
| `server/email/fanout.js` | Cursor-paginated, bounded drive announcements |
| `server/email/worker.js` | Fenced outbox worker and retry policy |
| `server/email/webhook-events.js` | Webhook inbox processing and ordering |
| `server/email/webhook.js` | Raw-body Svix signature verification |
| `server/email/preferences.js` | Send-time recipient preference recheck |
| `server/email/indexes.js` | Explicit index build and live verification |
| `server/email/log.js` | Email/secret/token redaction for logs and errors |
| `server/email/config.js` | Server-only configuration and safe diagnostics |
| `server/email/templates.js` | Responsive HTML + plain-text templates |
| `server/email/service.js` | Resend SDK boundary, validation, error normalisation |
| `server/email/events.js` | Pure event-spec builders and compatibility helpers |
| `server/email/routes.js` | Authenticated, rate-limited internal worker endpoint |

## Supported events

- Student welcome
- Recruiter welcome
- Company verification approval
- Application submitted (student)
- New applicant received (recruiter, with relevant profile details)
- Application shortlisted
- Application rejected
- Generic application status update
- New eligible drive announcement
- Drive publication confirmation (recruiter)
- Drive closed (recruiter)
- Deadline approaching (recruiter, 3 days)
- New recruiter registration requiring verification (every admin)

Company verification rejection is **not** emitted because the current admin
workflow only has a boolean `verified` field and a “Revoke verification” action.
Treating revocation as a rejection would be misleading. Adding a real rejection
requires a separate workflow with a reason and an explicit admin action.

## Status transitions are unique per transition

`application.statusHistory[]` now carries an `eventId`. The status route performs
one atomic update (`findOneAndUpdate` with `$push`) and uses:

```text
application-status/<applicationId>/<transitionId>
```

as the email idempotency key. Two legitimate moves to the same status at
different times therefore produce two emails, while a retry of the same move
cannot duplicate one. Two concurrent transitions preserve both `$push` entries;
only an exact duplicate target status is skipped.

## Send-time preferences

Preferences are checked when the business event is queued **and again**
immediately before the provider call, using the related document id where
available:

- student `emailNotifications === false` → suppressed
- drive announcement with `driveAnnouncements === false` → suppressed
- announcement recipient no longer `placementStatus: "Active"` or still
  invitation-pending → suppressed
- company `emailNotifications === false` → suppressed
- deleted recipient → suppressed
- temporary preference lookup failure → retry, never treated as an opt-out

A suppressed row remains visible in the outbox with status `suppressed` and a
safe reason code.

## Environment variables

```env
EMAIL_ENABLED=false
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_REPLY_TO=
RESEND_WEBHOOK_SECRET=

EMAIL_MODE=live              # live | test
EMAIL_TEST_RECIPIENT=        # required in test mode; all mail is redirected here
EMAIL_APP_URL=https://job-n-job.vercel.app
EMAIL_WORKER_SECRET=
# CRON_SECRET=               # alternative accepted for Vercel Cron

EMAIL_MAX_ATTEMPTS=6
EMAIL_BATCH_SIZE=10
EMAIL_INLINE_DISPATCH=false
EMAIL_DRIVE_ANNOUNCEMENTS=false
# Explicit allowlist. Empty means no events are allowed, never "all".
EMAIL_ALLOWED_EVENTS=student.welcome,company.welcome

EMAIL_WORKER_TIME_BUDGET_MS=20000
EMAIL_INTENT_BATCH_SIZE=25
EMAIL_INTENT_GRACE_MS=30000
EMAIL_INTENT_LEASE_MS=60000
EMAIL_FANOUT_BATCH_SIZE=100
EMAIL_FANOUT_MAX_BATCHES=4
EMAIL_FANOUT_MAX_RECIPIENTS=5000
EMAIL_FANOUT_COMPANY_DAILY_LIMIT=20
EMAIL_FANOUT_MAX_FAILURES=8
EMAIL_FANOUT_LEASE_MS=60000
EMAIL_WORKER_RATE_LIMIT_MS=1000
EMAIL_WEBHOOK_MAX_ATTEMPTS=12
EMAIL_WEBHOOK_BATCH_SIZE=50
```

All are server-only. None is prefixed with `VITE_`, so Vite cannot inline them
into the browser build. Do not commit a real `RESEND_API_KEY` or webhook secret.
Numeric values are clamped in `server/email/config.js`; a mistyped value cannot
turn one worker call into an unbounded scan or an unbounded email burst.

## Event allowlist

`EMAIL_ALLOWED_EVENTS` is a comma-separated list of exact internal event names.
An empty or missing value allows **nothing**; it never means "all". The gate is
enforced when an intent is created, when a ready intent is flushed into the
outbox, and when the outbox worker claims a row. Non-allowed existing rows are
left untouched, not deleted or marked failed, so they can be handled later.

Welcome-only production rollout:

```env
EMAIL_ENABLED=false
EMAIL_ALLOWED_EVENTS=student.welcome,company.welcome
EMAIL_DRIVE_ANNOUNCEMENTS=false
```

The allowed names are deliberately narrow:

- `student.welcome` — student registration welcome
- `company.welcome` — recruiter/company registration welcome

`admin.new-company` (the alert sent to admins when a recruiter registers),
application confirmations and status changes, and every drive event remain
blocked even though the code can generate them. Do not add those names until a
later, separately approved rollout.

## Disabled mode (`EMAIL_ENABLED=false`)

This is a safe pause, not a failure:

- No new intents or outbox rows are created.
- Existing outbox rows, ready intents and fan-out jobs are preserved.
- The worker returns `skipped: "disabled"` and does not consume attempts, set
  locks, mark rows failed, or delete anything.
- Registration, login, drives, applications, status changes, eligibility,
  matching, in-app notifications and all reads continue normally.
- The authenticated worker endpoint returns
  `{ "ok": true, "skipped": "disabled", "queuedPreserved": true }`.
- Verified webhooks may still record delivery state for messages that were sent
  before the pause; they never send mail.

## Worker and scheduling

The internal endpoint is:

```text
GET|POST /api/internal/email/worker?task=<task>
Authorization: Bearer <EMAIL_WORKER_SECRET or CRON_SECRET>
```

Tasks:

| Task | Work |
|---|---|
| `all` | Deadline scan, intent reconciliation, fan-out recovery + one batch, webhook retries, intent flush, outbox drain. Never use this for the welcome-only rollout. |
| `email` (default) | Intent reconciliation, intent flush, outbox drain |
| `deadline` | Queue 3-day deadline reminders only |
| `fanout` | Recover missing jobs and process one bounded fan-out batch |
| `webhook` | Retry pending webhook inbox rows |
| `reconcile` | Recover/reconcile intents only |
| `diagnostics` | Index report, intent counts, webhook counts, safe config summary |

Abuse and overload protection:

- constant-time shared-secret comparison; unauthenticated calls get `401`;
- per-process minimum interval (`EMAIL_WORKER_RATE_LIMIT_MS`), excess calls get
  `429` with `Retry-After`;
- one wall-clock budget shared by every task in the invocation;
- bounded row, intent, webhook and fan-out batch sizes;
- a hard per-drive recipient ceiling.

Vercel Hobby permits a daily cron. `vercel.json` schedules the welcome-only
task at 02:00 UTC:

```text
/api/internal/email/worker?task=email
```

Never schedule the default `all` task for this rollout: it also scans deadlines
and runs fan-out work. For timely retries, point an external scheduler at the
same `?task=email` endpoint every five minutes with the bearer secret, plus a
separate `?task=webhook` schedule if you want pending webhook inbox retries. The
worker is safe to run concurrently: claims are atomic, every
completion/retry/failure update is fenced by `lockId` and `status: "processing"`,
and Resend receives the same idempotency key on retries.

## Retry, webhook and fan-out details

### Outbox retries

- Unique `idempotencyKey` prevents the same business event being queued twice.
- Resend receives the same idempotency key on retries.
- Attempts use exponential backoff with jitter: 1m, 5m, 15m, 1h, 6h.
- Maximum six attempts by default; the retry window stays below Resend's
  24-hour idempotency-key lifetime.
- Invalid recipients, unverified domains, auth errors and other permanent 4xx
  errors fail immediately.
- 408/425/429/5xx/network errors are retryable.
- A processing lease lasts ten minutes. A later worker recovers abandoned rows.
- A stale worker that wakes after its lease expired cannot overwrite a newer
  worker's result; it logs `lease lost` and exits.

### Webhook inbox

A verified webhook is written to `emailwebhookevents` **before** the outbox is
updated, so an outbox failure is never acknowledged and lost. The row is retried
by the worker. Events are applied with a timestamp and monotonic-status guard:

- a late `email.delivery_delayed` cannot regress a `delivered` row;
- a stale `email.sent` cannot overwrite a later delivery state;
- a bounce/complaint/failure cannot be overwritten by a non-terminal event;
- an early webhook that arrives before the worker stored `providerMessageId`
  stays pending and is applied immediately after a successful send, or by the
  next worker run.

### Drive announcements

Drive creation writes `announcementJobId` on the drive and one deterministic job
(`drive-announcements/<driveId>`) **only when announcements are enabled and the
email config is ready**. Disabled deployments therefore do not leave historical
drive handles that could be replayed by a later rollout. It does **not**
enumerate students in the request. The worker walks active, opted-in students
with an `_id` cursor in bounded batches, skips students who already applied or
are ineligible, and stops at `EMAIL_FANOUT_MAX_BATCHES` or
`EMAIL_FANOUT_MAX_RECIPIENTS`. The cursor only advances after a batch is written;
unique outbox keys make a replay harmless. A missing job is recreated from the
durable handle on the drive.

New jobs are also capped per company per rolling 24 hours
(`EMAIL_FANOUT_COMPANY_DAILY_LIMIT`, default 20). A company at the cap can still
create drives; only the optional announcement fan-out is skipped. Failed batches
stop retrying after `EMAIL_FANOUT_MAX_FAILURES` consecutive failures and leave a
`failed` job with a safe `lastError`; successful batches reset the failure count.

## Indexes and migration requirements

The email subsystem relies on unique indexes for correctness, not only speed:

| Collection | Required indexes |
|---|---|
| `emailoutboxes` | `eventId` unique; `idempotencyKey` unique; `(status, nextAttemptAt, createdAt)`; `(status, lockedUntil)`; `providerMessageId` |
| `emailintents` | `intentId` unique; `idempotencyKey` unique; `(state, nextAttemptAt, createdAt)`; `(state, lockedUntil)` |
| `emailwebhookevents` | `svixId` unique; `(status, nextAttemptAt, createdAt)`; `(emailId, status)`; TTL on `createdAt` (30 days) |
| `emailfanoutjobs` | `jobId` unique; `(status, nextAttemptAt, createdAt)`; `(status, lockedUntil)` |
| `drives` | `announcementJobId` (recovery lookup) |

Production boot does **not** create indexes. The Vercel entry and the local
server do not call the index builder, and Mongoose runs with `autoIndex: false`
when `NODE_ENV=production`. The authenticated worker verifies the live database
with `emailIndexReport()` and refuses to run (`503`) if a required index is
missing. It never creates one.

Use the explicit operator command after approval:

```bash
# Read-only check; no indexes are created.
NODE_ENV=production npm run email:indexes -- --check

# Additive creation; explicitly approved, never run automatically.
NODE_ENV=production npm run email:indexes -- --approve
```

The command only calls `createIndexes()`. It never drops an index or collection.
It uses the existing `MONGODB_URI`; do not paste the URI or any secret into chat.
For a large existing deployment, run this with a privileged migration user
during an approved maintenance window. If duplicate documents already violate a
unique index, creation fails safely; no documents are deleted.

Migration notes:

- The new collections are `emailintents` and `emailfanoutjobs`; the other three
  email collections already existed in the local subsystem.
- The explicit index command also creates the additive `drives.announcementJobId`
  lookup index.
- New fields are additive and optional: `applications.statusHistory[].eventId`,
  `drives.announcementJobId`, `emailoutboxes.providerEventAt`,
  `emailoutboxes.status: "suppressed"`, and the webhook-inbox retry fields.
- No data backfill is required. Existing application history entries simply
  have no `eventId`; the next transition writes one.
- On a large existing deployment, create these indexes with a privileged
  migration user during a maintenance window. The current email collections are
  empty/local, so index creation is effectively immediate. No destructive
  schema migration is required.
- If the application's MongoDB user cannot create indexes, run the index
  creation out of band and verify with `?task=diagnostics`. The worker will stay
  at `503` until the required indexes exist; business routes are unaffected.

## Resend setup

1. Create a Resend API key at <https://resend.com/api-keys>.
2. Add a sending domain under **Domains**.
3. Add the exact SPF and DKIM DNS records Resend provides. Do not invent values.
4. Add a DMARC record for the domain (start with monitoring, e.g. `p=none`, using
   an address the institution controls).
5. Wait for the domain to verify.
6. Set `RESEND_FROM_EMAIL` to an address on that verified domain, for example
   `JOB N JOB <notifications@your-verified-domain.example>`.
7. Create a webhook to `https://<production-domain>/api/webhooks/resend` for
   delivered, delayed, bounced and complained events. Put its signing secret in
   `RESEND_WEBHOOK_SECRET`.
8. Never use `onboarding@resend.dev` as the production sender; it is test-only.

## Safe testing

Use Resend's test addresses and a controlled recipient:

- `delivered@resend.dev`
- `bounced@resend.dev`
- `complained@resend.dev`
- `suppressed@resend.dev`

With `EMAIL_MODE=test` and `EMAIL_TEST_RECIPIENT=delivered@resend.dev`, every
event is redirected to that address. Do not enable real production sending until
the domain is verified and the test recipient flow has been checked.

The automated tests make **no network call**: `setEmailTransportForTests`
replaces the Resend transport before any worker drains a row.

## Deployment

1. Run `npm test`.
2. Run `NODE_ENV=production npm run build`.
3. Confirm the bundle does not contain the Resend key or any server variable.
4. Add the environment variables in Vercel with `EMAIL_ENABLED=false`.
5. Deploy manually only when approved.
6. After explicit approval, run `NODE_ENV=production npm run email:indexes -- --check`;
   if anything is missing, run `-- --approve`. Do not let deployment create them.
7. Configure `RESEND_WEBHOOK_SECRET` and either `EMAIL_WORKER_SECRET` or
   `CRON_SECRET`.
8. Set `EMAIL_ALLOWED_EVENTS=student.welcome,company.welcome` and keep
   `EMAIL_DRIVE_ANNOUNCEMENTS=false`.
9. Test with `EMAIL_MODE=test` and a Resend test recipient.
10. Enable `EMAIL_ENABLED=true` only after the allowlist, worker indexes and
    scheduler have been verified. Keep all non-welcome events out of the
    allowlist; do not enable drive announcements in this rollout.

## Rollback

Set `EMAIL_ENABLED=false` and redeploy/restart. No new intents or outbox rows are
created, the worker becomes a no-op, queued work is preserved, and all existing
placement operations and in-app notifications continue. No schema rollback is
needed.

## Known limitations

- Delivery is not guaranteed; `sent` is provider acceptance, not delivery.
- The current admin UI has no explicit company rejection reason/action.
- Company email preference is available as a dashboard toggle, backed by
  `PATCH /api/companies/me`.
- Drive announcements are globally gated by `EMAIL_DRIVE_ANNOUNCEMENTS` and
  must be enabled deliberately after domain/testing.
- The welcome allowlist is an explicit list, not a role or template wildcard.
  Any future event needs both code support and an approved allowlist change.
- Production index creation is manual. A deployment does not create indexes;
  the worker will return `503` until the operator procedure succeeds.
- The per-drive recipient ceiling and per-company rolling daily job cap protect
  against accidental mass mail. A legitimate drive over the recipient ceiling
  stops with `stopReason: "recipient_limit"`; a company over its daily job cap
  simply does not receive a new announcement job and can be handled explicitly.
- A drive created while email announcements are disabled has no durable
  announcement handle, so enabling the feature later does not retroactively
  announce old drives.
- Worker rate limiting and the `lastWorkerRunAt` interval are per process, not
  global across serverless instances. The shared secret remains the primary
  gate; use a trusted scheduler.
- Resumes are never attached to email; links go to the authenticated portal.
- Vercel Hobby's daily cron is not sufficient for timely retries by itself; use
  the external five-minute scheduler or Vercel Pro cron.
- The subsystem is not deployed to production. Do not claim real email delivery
  in the review.
