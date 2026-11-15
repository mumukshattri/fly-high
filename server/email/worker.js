/**
 * server/email/worker.js
 * ===========================================================================
 * DURABLE EMAIL WORKER
 * ===========================================================================
 * The worker is deliberately boring: claim one row atomically, send it, and
 * record exactly what happened. It never relies on an in-memory queue, so a
 * Vercel function restart cannot lose an event.
 *
 * Every completion/retry/failure update is fenced by `lockId` AND the
 * `processing` status. A stale worker that wakes up after its lease expired can
 * therefore never overwrite a newer worker's result.
 */

import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';

import {
  EMAIL_ALLOWED_EVENTS,
  EMAIL_BATCH_SIZE,
  EMAIL_ENABLED,
  EMAIL_INLINE_DISPATCH,
  EMAIL_LEASE_MS,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_DELAYS_MS,
  EMAIL_WORKER_TIME_BUDGET_MS,
  emailIsReady,
} from './config.js';
import { emailLog, safeError, sanitizeErrorText } from './log.js';
import { recipientAllowsEmail } from './preferences.js';
import { sendEmail } from './service.js';
import { processWebhookEventsForEmail } from './webhook-events.js';
import { EmailOutbox } from '../models/email-outbox.js';

const EMPTY_ERROR = { code: '', statusCode: null, message: '' };

const log = emailLog;

/** Reclaim rows whose worker died after claiming but before finishing. */
async function recoverAbandoned(now = new Date()) {
  await EmailOutbox.updateMany(
    {
      status: 'processing',
      eventType: { $in: EMAIL_ALLOWED_EVENTS },
      lockedUntil: { $lt: now },
      attempts: { $lt: EMAIL_MAX_ATTEMPTS },
    },
    {
      $set: {
        status: 'retry_scheduled',
        nextAttemptAt: now,
        lockedUntil: null,
        lockId: '',
        lastError: {
          code: 'worker_lease_expired',
          statusCode: null,
          message: 'The worker stopped before finishing this message.',
        },
      },
    },
  );

  await EmailOutbox.updateMany(
    {
      status: 'processing',
      eventType: { $in: EMAIL_ALLOWED_EVENTS },
      lockedUntil: { $lt: now },
      attempts: { $gte: EMAIL_MAX_ATTEMPTS },
    },
    {
      $set: {
        status: 'failed',
        nextAttemptAt: null,
        lockedUntil: null,
        lockId: '',
        lastError: {
          code: 'max_attempts',
          statusCode: null,
          message: 'The message exhausted its retry attempts.',
        },
      },
    },
  );
}

async function claimNext(now = new Date()) {
  return EmailOutbox.findOneAndUpdate(
    {
      status: { $in: ['pending', 'retry_scheduled'] },
      eventType: { $in: EMAIL_ALLOWED_EVENTS },
      nextAttemptAt: { $lte: now },
    },
    {
      $set: {
        status: 'processing',
        lockedUntil: new Date(now.getTime() + EMAIL_LEASE_MS),
        lockId: randomUUID(),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
  );
}

function retryDelay(attempts) {
  const base = EMAIL_RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), EMAIL_RETRY_DELAYS_MS.length - 1)];
  // Jitter avoids every failed message waking at the same second.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Fenced update: the row must still be processing under this exact lock. */
async function fencedUpdate(row, set, extra = {}) {
  const result = await EmailOutbox.updateOne(
    { _id: row._id, status: 'processing', lockId: row.lockId },
    { $set: set, ...extra },
  );
  if (result.matchedCount === 0) {
    log('lease lost; another worker owns this message', {
      outboxId: String(row._id),
      eventType: row.eventType,
    });
    return false;
  }
  return true;
}

async function releaseRow(row, { delayMs = 0, code = 'worker_released', message = '' } = {}) {
  const result = await EmailOutbox.updateOne(
    { _id: row._id, status: 'processing', lockId: row.lockId },
    {
      $set: {
        status: 'pending',
        nextAttemptAt: new Date(Date.now() + delayMs),
        lockedUntil: null,
        lockId: '',
        lastError: {
          code: String(code).slice(0, 80),
          statusCode: null,
          message: sanitizeErrorText(message || 'The worker released this message.', 300),
        },
      },
      $inc: { attempts: -1 },
    },
  );
  if (result.matchedCount === 0) {
    log('lease lost while releasing message', {
      outboxId: String(row._id),
      eventType: row.eventType,
    });
    return 'lease_lost';
  }
  return 'released';
}

async function failRow(row, { code, message, statusCode = null, status = 'failed' }) {
  return fencedUpdate(row, {
    status,
    nextAttemptAt: null,
    lockedUntil: null,
    lockId: '',
    lastError: {
      code: String(code || 'permanent_failure').slice(0, 80),
      statusCode: statusCode || null,
      message: sanitizeErrorText(message || 'The message could not be sent.', 300),
    },
  });
}

async function scheduleRetry(row, { code, message, statusCode = null }) {
  return fencedUpdate(row, {
    status: 'retry_scheduled',
    nextAttemptAt: new Date(Date.now() + retryDelay(row.attempts)),
    lockedUntil: null,
    lockId: '',
    lastError: {
      code: String(code || 'provider_error').slice(0, 80),
      statusCode: statusCode || null,
      message: sanitizeErrorText(message || 'Email provider request failed.', 300),
    },
  });
}

async function processRow(row) {
  // EMAIL_ENABLED=false is a safe pause, not a failure. Preserve the row and
  // release it without consuming an attempt.
  if (!EMAIL_ENABLED) {
    return releaseRow(row, {
      code: 'email_disabled',
      message: 'Email is disabled; this message remains queued.',
    });
  }

  if (!emailIsReady()) {
    return releaseRow(row, {
      delayMs: 5 * 60_000,
      code: 'not_configured',
      message: 'Email configuration is incomplete; this message remains queued.',
    });
  }

  // Preferences are rechecked at send time: a user may have opted out after
  // the business event was queued.
  const preference = await recipientAllowsEmail(row);
  if (!preference.allowed) {
    if (preference.retryable) {
      const updated = await scheduleRetry(row, {
        code: preference.reason || 'preference_check_failed',
        message: 'The recipient preference could not be checked; retrying.',
      });
      return updated ? 'retry_scheduled' : 'lease_lost';
    }
    const updated = await failRow(row, {
      status: 'suppressed',
      code: preference.reason || 'recipient_opted_out',
      message: 'The recipient no longer accepts this email.',
    });
    return updated ? 'suppressed' : 'lease_lost';
  }

  let result;
  try {
    result = await sendEmail({
      to: row.recipient.email,
      subject: row.subject,
      html: row.html,
      text: row.text,
      idempotencyKey: row.idempotencyKey,
    });
  } catch (error) {
    const updated = await scheduleRetry(row, {
      code: 'provider_exception',
      message: error?.message || 'Email provider request failed.',
    });
    return updated ? 'retry_scheduled' : 'lease_lost';
  }

  if (result.ok) {
    const updated = await fencedUpdate(row, {
      status: 'sent',
      providerStatus: result.providerStatus || 'accepted',
      providerMessageId: result.messageId || '',
      sentAt: new Date(),
      nextAttemptAt: null,
      lockedUntil: null,
      lockId: '',
      lastError: EMPTY_ERROR,
    });
    if (!updated) return 'lease_lost';

    // A webhook can arrive in the tiny window between provider acceptance and
    // this database write. Apply any early events now.
    try {
      await processWebhookEventsForEmail(result.messageId);
    } catch (error) {
      log('early webhook reconciliation failed', { error: safeError(error) });
    }
    return 'sent';
  }

  if (result.skipped === 'not_configured' || result.error?.code === 'not_configured') {
    return releaseRow(row, {
      delayMs: 5 * 60_000,
      code: 'not_configured',
      message: 'Email configuration is incomplete; this message remains queued.',
    });
  }

  const error = result.error || {
    code: 'unknown',
    statusCode: null,
    message: 'Email provider failed.',
    retryable: true,
  };
  const exhausted = row.attempts >= EMAIL_MAX_ATTEMPTS;

  if (error.retryable && !exhausted) {
    const updated = await scheduleRetry(row, {
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
    });
    return updated ? 'retry_scheduled' : 'lease_lost';
  }

  const updated = await failRow(row, {
    code: error.code || (exhausted ? 'max_attempts' : 'permanent_failure'),
    statusCode: error.statusCode,
    message: exhausted
      ? 'The message exhausted its retry attempts.'
      : error.message || 'Email provider rejected the message.',
  });
  if (!updated) return 'lease_lost';

  log('message failed permanently', {
    outboxId: String(row._id),
    eventType: row.eventType,
    code: error.code,
    statusCode: error.statusCode,
  });
  return 'failed';
}

/**
 * Drain a bounded batch. Safe to call concurrently: the atomic claim is the
 * concurrency boundary, fencing protects the result write, and Resend's
 * idempotency key covers a crash between provider acceptance and the database
 * write.
 */
export async function drainEmailOutbox({
  limit = EMAIL_BATCH_SIZE,
  timeBudgetMs = EMAIL_WORKER_TIME_BUDGET_MS,
} = {}) {
  const empty = {
    skipped: null,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
    released: 0,
    leaseLost: 0,
    errors: 0,
    processed: 0,
  };

  if (!EMAIL_ENABLED) {
    return { ...empty, skipped: 'disabled' };
  }
  if (!emailIsReady()) {
    return { ...empty, skipped: 'not_configured' };
  }

  const started = Date.now();
  const budget = Math.min(Math.max(1_000, timeBudgetMs), EMAIL_WORKER_TIME_BUDGET_MS);
  const maxRows = Math.min(Math.max(1, limit), EMAIL_BATCH_SIZE);

  await recoverAbandoned();

  const summary = { ...empty };
  for (let index = 0; index < maxRows; index += 1) {
    if (Date.now() - started > budget) break;
    const row = await claimNext();
    if (!row) break;

    summary.processed += 1;
    let outcome;
    try {
      outcome = await processRow(row);
    } catch (error) {
      summary.errors += 1;
      log('worker update failed; lease will be recovered', {
        outboxId: String(row._id),
        eventType: row.eventType,
        error: safeError(error),
      });
      break;
    }

    if (outcome === 'sent') summary.sent += 1;
    else if (outcome === 'retry_scheduled') summary.retried += 1;
    else if (outcome === 'failed') summary.failed += 1;
    else if (outcome === 'suppressed') summary.suppressed += 1;
    else if (outcome === 'released') summary.released += 1;
    else if (outcome === 'lease_lost') summary.leaseLost += 1;
  }

  return summary;
}

/**
 * Best-effort immediate drain after enqueueing. The durable cron/external
 * worker is still the guarantee if Vercel ends this invocation.
 */
export function scheduleEmailDrain() {
  if (!EMAIL_INLINE_DISPATCH || !EMAIL_ENABLED) return;
  const task = drainEmailOutbox({ limit: 3, timeBudgetMs: 8_000 }).catch((error) => {
    log('inline drain failed', { error: safeError(error) });
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
