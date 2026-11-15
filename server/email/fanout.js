/**
 * server/email/fanout.js
 * ===========================================================================
 * BOUNDED DRIVE-ANNOUNCEMENT FAN-OUT
 * ===========================================================================
 * Drive creation writes one deterministic job row. The worker then walks the
 * eligible students with an `_id` cursor, in small batches. It never loads the
 * whole student collection and never holds a request open for thousands of
 * outbox inserts.
 */

import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';

import {
  EMAIL_APP_URL,
  EMAIL_DRIVE_ANNOUNCEMENTS,
  EMAIL_FANOUT_BATCH_SIZE,
  EMAIL_FANOUT_LEASE_MS,
  EMAIL_FANOUT_COMPANY_DAILY_LIMIT,
  EMAIL_FANOUT_MAX_BATCHES,
  EMAIL_FANOUT_MAX_FAILURES,
  EMAIL_FANOUT_MAX_RECIPIENTS,
  EMAIL_INLINE_DISPATCH,
  EMAIL_WORKER_TIME_BUDGET_MS,
  emailIsReady,
} from './config.js';
import { emailLog, safeError, sanitizeErrorText } from './log.js';
import { buildEmail } from './templates.js';
import { Application, Company, Drive, Student } from '../models/index.js';
import { EmailFanoutJob } from '../models/email-fanout-job.js';
import { EmailOutbox } from '../models/email-outbox.js';
import { serializeDrive, serializeStudent } from '../serialize.js';
import { checkEligibility } from '../../src/utils/eligibility.js';

const idOf = (value) => (value?._id ? String(value._id) : value ? String(value) : null);

const EMPTY_ERROR = { code: '', statusCode: null, message: '' };

export function driveAnnouncementJobId(driveOrId) {
  return `drive-announcements/${idOf(driveOrId)}`;
}

/**
 * Idempotently create the one job for a drive. Called during drive creation;
 * the write is tiny and never waits for the student scan.
 */
export async function ensureDriveAnnouncementJob(
  drive,
  { company = null, maxRecipients = EMAIL_FANOUT_MAX_RECIPIENTS } = {},
) {
  if (!EMAIL_DRIVE_ANNOUNCEMENTS || !emailIsReady()) return null;
  const driveId = idOf(drive);
  if (!driveId) return null;

  const jobId = drive?.announcementJobId || driveAnnouncementJobId(driveId);
  const companyId = idOf(company) || idOf(drive?.company);
  try {
    // An existing job is always returned. The quota below only limits new
    // jobs, so a retry of the same drive is never blocked by its own row.
    const existing = await EmailFanoutJob.findOne({ jobId }).lean();
    if (existing) return existing;

    if (companyId) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentJobs = await EmailFanoutJob.countDocuments({
        company: companyId,
        createdAt: { $gte: since },
      });
      if (recentJobs >= EMAIL_FANOUT_COMPANY_DAILY_LIMIT) {
        emailLog('company drive-announcement limit reached', {
          companyId,
          recentJobs,
          limit: EMAIL_FANOUT_COMPANY_DAILY_LIMIT,
        });
        return null;
      }
    }

    return await EmailFanoutJob.findOneAndUpdate(
      { jobId },
      {
        $setOnInsert: {
          jobId,
          type: 'drive-announcements',
          drive: driveId,
          company: companyId || null,
          status: 'pending',
          cursor: null,
          processed: 0,
          queued: 0,
          skipped: 0,
          maxRecipients: Math.max(1, Number(maxRecipients) || EMAIL_FANOUT_MAX_RECIPIENTS),
          attempts: 0,
          failureCount: 0,
          nextAttemptAt: new Date(),
          lastError: EMPTY_ERROR,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error?.code === 11000) {
      return EmailFanoutJob.findOne({ jobId }).lean();
    }
    emailLog('drive fan-out job could not be created', {
      driveId,
      error: safeError(error),
    });
    return null;
  }
}

/**
 * Recover a missing job from the durable handle stored on the drive. This
 * closes the crash window between Drive.create and the job insert.
 */
export async function reconcileDriveAnnouncementJobs({ limit = 20 } = {}) {
  if (!EMAIL_DRIVE_ANNOUNCEMENTS || !emailIsReady()) return { checked: 0, created: 0 };

  let drives = [];
  try {
    drives = await Drive.find({
      announcementJobId: { $nin: ['', null] },
      status: 'Open',
    })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, limit))
      .lean();
  } catch (error) {
    emailLog('drive fan-out reconciliation query failed', { error: safeError(error) });
    return { checked: 0, created: 0 };
  }

  let created = 0;
  if (drives.length) {
    const jobIds = drives.map((drive) => drive.announcementJobId);
    let existing = [];
    try {
      existing = await EmailFanoutJob.distinct('jobId', { jobId: { $in: jobIds } });
    } catch (error) {
      emailLog('drive fan-out reconciliation lookup failed', { error: safeError(error) });
      return { checked: drives.length, created: 0 };
    }
    const known = new Set(existing);
    for (const drive of drives) {
      if (known.has(drive.announcementJobId)) continue;
      const job = await ensureDriveAnnouncementJob(drive, { company: drive.company });
      if (job) created += 1;
    }
  }

  return { checked: drives.length, created };
}

function retryDelay(attempts) {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

async function fencedJobUpdate(job, update) {
  const result = await EmailFanoutJob.updateOne(
    { _id: job._id, status: 'processing', lockId: job.lockId },
    update,
  );
  if (result.matchedCount === 0) {
    emailLog('fan-out lease lost', { jobId: job.jobId });
    return false;
  }
  return true;
}

async function completeJob(job, reason = '') {
  return fencedJobUpdate(job, {
    $set: {
      status: 'completed',
      completedAt: new Date(),
      stopReason: String(reason || '').slice(0, 80),
      lockedUntil: null,
      lockId: '',
      failureCount: 0,
      nextAttemptAt: new Date(),
    },
  });
}

async function failJob(job, code, error) {
  return fencedJobUpdate(job, {
    $set: {
      status: 'failed',
      lockedUntil: null,
      lockId: '',
      failureCount: Number(job.failureCount || 0),
      lastError: {
        code: String(code || 'fanout_failed').slice(0, 80),
        statusCode: Number(error?.statusCode || 0) || null,
        message: sanitizeErrorText(error?.message || 'The drive announcement job failed.', 300),
      },
    },
  });
}

async function releaseJob(job, error = null) {
  const failureCount = error ? Number(job.failureCount || 0) + 1 : Number(job.failureCount || 0);
  const exhausted = Boolean(error) && failureCount >= EMAIL_FANOUT_MAX_FAILURES;
  const updated = await fencedJobUpdate(job, {
    $set: {
      status: exhausted ? 'failed' : 'pending',
      nextAttemptAt: exhausted ? new Date() : new Date(Date.now() + retryDelay(job.attempts)),
      lockedUntil: null,
      lockId: '',
      failureCount,
      lastError: {
        code: exhausted ? 'fanout_max_failures' : error ? 'fanout_retry' : 'fanout_batch_budget',
        statusCode: Number(error?.statusCode || 0) || null,
        message: sanitizeErrorText(
          error?.message || 'The batch budget was reached; the next worker run continues.',
          300,
        ),
      },
    },
  });
  if (!updated) return 'lease_lost';
  return exhausted ? 'failed' : 'pending';
}

async function writeAnnouncementBatch({ drive, company, students, remaining }) {
  const applied = new Set(
    (await Application.distinct('student', {
      drive: drive._id,
      student: { $in: students.map((student) => student._id) },
    })).map(String),
  );

  const eligible = [];
  let skipped = 0;
  for (const student of students) {
    if (applied.has(String(student._id))) {
      skipped += 1;
      continue;
    }
    try {
      if (checkEligibility(serializeStudent(student), serializeDrive(drive)).eligible) {
        eligible.push(student);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  // The per-drive ceiling is enforced before any row is written, never after.
  const selected = eligible.slice(0, Math.max(0, Number(remaining) || 0));
  const rows = selected.map((student) => {
    const message = buildEmail(
      'drive-announcement',
      {
        studentName: student.name,
        companyName: company.name,
        role: drive.role,
        location: drive.location,
        package: drive.package,
        minimumCGPA: drive.minimumCGPA,
        branches: drive.branches,
        deadline: drive.deadline,
        driveId: idOf(drive),
      },
      EMAIL_APP_URL,
    );
    return {
      eventId: randomUUID(),
      idempotencyKey: `drive-announcement/${idOf(drive)}/${String(student._id)}`,
      eventType: 'drive.announcement',
      templateId: 'drive-announcement',
      recipient: { email: student.email, name: student.name, role: 'student' },
      related: { drive: drive._id, company: company._id, student: student._id },
      subject: message.subject,
      html: message.html,
      text: message.text,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
    };
  });

  let queued = 0;
  if (rows.length) {
    try {
      const result = await EmailOutbox.bulkWrite(
        rows.map((row) => ({
          updateOne: {
            filter: { idempotencyKey: row.idempotencyKey },
            update: { $setOnInsert: row },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      queued = Number(result.upsertedCount || 0);
    } catch (error) {
      const writeErrors = error?.writeErrors || error?.result?.result?.writeErrors || [];
      const nonDuplicate = writeErrors.filter((item) => item?.code !== 11000);
      if (nonDuplicate.length || (!writeErrors.length && error?.code !== 11000)) throw error;
      // Duplicate keys are an idempotent replay, not a batch failure.
    }
  }

  return { queued, skipped };
}

async function processJob(job, { timeBudgetMs = EMAIL_WORKER_TIME_BUDGET_MS } = {}) {
  const started = Date.now();
  const drive = await Drive.findById(job.drive).lean();
  if (!drive) {
    await failJob(job, 'drive_missing', null);
    return { status: 'failed', queued: 0 };
  }
  if (drive.status !== 'Open') {
    await completeJob(job, 'drive_not_open');
    return { status: 'completed', queued: 0 };
  }

  const company =
    (job.company && (await Company.findById(job.company).lean())) ||
    (await Company.findById(drive.company).lean());
  if (!company) {
    await failJob(job, 'company_missing', null);
    return { status: 'failed', queued: 0 };
  }

  let cursor = job.cursor || null;
  let processed = Number(job.processed || 0);
  let queued = Number(job.queued || 0);
  let skipped = Number(job.skipped || 0);
  let queuedThisRun = 0;
  // A job row may be old or hand-edited. The environment ceiling is the hard
  // upper bound; a job can request a lower ceiling but never a higher one.
  const requestedRecipients = Number(job.maxRecipients) || EMAIL_FANOUT_MAX_RECIPIENTS;
  const maxRecipients = Math.min(
    Math.max(1, requestedRecipients),
    EMAIL_FANOUT_MAX_RECIPIENTS,
  );

  for (let batch = 0; batch < EMAIL_FANOUT_MAX_BATCHES; batch += 1) {
    if (Date.now() - started > timeBudgetMs) break;

    const query = {
      placementStatus: 'Active',
      invitationPending: { $ne: true },
      emailNotifications: { $ne: false },
      driveAnnouncements: { $ne: false },
    };
    if (cursor) query._id = { $gt: cursor };

    let students = [];
    try {
      students = await Student.find(query).sort({ _id: 1 }).limit(EMAIL_FANOUT_BATCH_SIZE).lean();
    } catch (error) {
      const released = await releaseJob(job, error);
      return {
        status: released === 'failed' ? 'failed' : released === 'lease_lost' ? 'lease_lost' : 'pending',
        queued: queuedThisRun,
      };
    }

    if (!students.length) {
      await completeJob(job, 'all_students_scanned');
      return { status: 'completed', queued: queuedThisRun };
    }

    let batchResult;
    try {
      batchResult = await writeAnnouncementBatch({
        drive,
        company,
        students,
        remaining: Math.max(0, maxRecipients - queued),
      });
    } catch (error) {
      emailLog('drive announcement batch failed', {
        jobId: job.jobId,
        error: safeError(error),
      });
      const released = await releaseJob(job, error);
      return {
        status: released === 'failed' ? 'failed' : released === 'lease_lost' ? 'lease_lost' : 'pending',
        queued: queuedThisRun,
      };
    }

    processed += students.length;
    queued += batchResult.queued;
    queuedThisRun += batchResult.queued;
    skipped += batchResult.skipped;
    cursor = students[students.length - 1]._id;

    if (queued >= maxRecipients) {
      await fencedJobUpdate(job, {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          stopReason: 'recipient_limit',
          cursor,
          processed,
          queued,
          skipped,
          failureCount: 0,
          lockedUntil: null,
          lockId: '',
        },
      });
      emailLog('drive announcement recipient limit reached', {
        jobId: job.jobId,
        queued,
        limit: maxRecipients,
      });
      return { status: 'completed', queued: queuedThisRun };
    }

    const updated = await fencedJobUpdate(job, {
      $set: { cursor, processed, queued, skipped, failureCount: 0, lastError: EMPTY_ERROR },
    });
    if (!updated) return { status: 'lease_lost', queued: queuedThisRun };

    if (students.length < EMAIL_FANOUT_BATCH_SIZE) {
      await completeJob(job, 'all_students_scanned');
      return { status: 'completed', queued: queuedThisRun };
    }
  }

  const released = await releaseJob(job);
  return { status: released === 'lease_lost' ? 'lease_lost' : 'pending', queued: queuedThisRun };
}

/**
 * Drain a bounded number of fan-out jobs. Safe to call concurrently: the job
 * lease is fenced with lockId, and outbox idempotency keys cover a stale replay.
 */
export async function processEmailFanoutJobs({
  limit = 1,
  timeBudgetMs = EMAIL_WORKER_TIME_BUDGET_MS,
} = {}) {
  if (!EMAIL_DRIVE_ANNOUNCEMENTS || !emailIsReady()) {
    return { skipped: 'not_enabled', processed: 0, queued: 0 };
  }

  const started = Date.now();
  const now = new Date();
  try {
    await EmailFanoutJob.updateMany(
      { status: 'processing', lockedUntil: { $lt: now } },
      {
        $set: {
          status: 'pending',
          nextAttemptAt: now,
          lockedUntil: null,
          lockId: '',
          lastError: {
            code: 'fanout_lease_expired',
            statusCode: null,
            message: 'The worker stopped before finishing this fan-out job.',
          },
        },
      },
    );
  } catch (error) {
    emailLog('fan-out lease recovery failed', { error: safeError(error) });
  }

  const summary = { processed: 0, queued: 0, completed: 0, failed: 0, pending: 0 };
  const seen = new Set();

  for (let index = 0; index < Math.max(1, limit); index += 1) {
    if (Date.now() - started > timeBudgetMs) break;

    let job;
    try {
      job = await EmailFanoutJob.findOneAndUpdate(
        { _id: { $nin: [...seen] }, status: 'pending', nextAttemptAt: { $lte: new Date() } },
        {
          $set: {
            status: 'processing',
            lockId: randomUUID(),
            lockedUntil: new Date(Date.now() + EMAIL_FANOUT_LEASE_MS),
            lastError: EMPTY_ERROR,
          },
          $inc: { attempts: 1 },
        },
        { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
      );
    } catch (error) {
      emailLog('fan-out job claim failed', { error: safeError(error) });
      break;
    }
    if (!job) break;
    seen.add(job._id);

    summary.processed += 1;
    const outcome = await processJob(job, {
      timeBudgetMs: Math.max(1_000, timeBudgetMs - (Date.now() - started)),
    });
    summary.queued += outcome.queued || 0;
    if (outcome.status === 'completed') summary.completed += 1;
    else if (outcome.status === 'failed') summary.failed += 1;
    else summary.pending += 1;
  }

  return summary;
}

/**
 * Start one bounded fan-out batch after drive creation without holding the
 * response open. The durable cron remains the guarantee if the invocation ends.
 */
export function scheduleEmailFanout() {
  if (!EMAIL_INLINE_DISPATCH || !EMAIL_DRIVE_ANNOUNCEMENTS || !emailIsReady()) return;
  const task = processEmailFanoutJobs({ limit: 1, timeBudgetMs: 8_000 }).catch((error) => {
    emailLog('inline fan-out failed', { error: safeError(error) });
  });

  if (process.env.VERCEL) {
    try {
      waitUntil(task);
      return;
    } catch {
      /* not in a request context; fall through */
    }
  }
  void task;
}
