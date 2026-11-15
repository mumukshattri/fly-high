/**
 * server/email/webhook-events.js
 * ===========================================================================
 * DURABLE WEBHOOK INBOX
 * ===========================================================================
 * A verified webhook is written to `emailwebhookevents` before the outbox is
 * touched. Processing is retried by the worker, so a temporary outbox failure
 * is not acknowledged and lost.
 *
 * Events are applied with a timestamp/rank guard. A late `email.delivery_delayed`
 * cannot move a `delivered` row backwards, and a bounce cannot be overwritten by
 * a later non-terminal event.
 */

import {
  EMAIL_WEBHOOK_BATCH_SIZE,
  EMAIL_WEBHOOK_MAX_ATTEMPTS,
  EMAIL_WORKER_TIME_BUDGET_MS,
} from './config.js';
import { emailLog, safeError, sanitizeErrorText } from './log.js';
import { EmailOutbox } from '../models/email-outbox.js';
import { EmailWebhookEvent } from '../models/email-webhook-event.js';

const EMPTY_ERROR = { code: '', statusCode: null, message: '' };
const WEBHOOK_LEASE_MS = 60_000;

export const WEBHOOK_STATUS = {
  'email.sent': 'accepted',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'failed',
};

export const PROVIDER_STATUS_RANK = {
  '': 0,
  accepted: 1,
  delayed: 2,
  delivered: 3,
  bounced: 4,
  complained: 4,
  failed: 4,
};

function retryDelay(attempts) {
  const base = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function eventDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Persist a verified event. Duplicate svix ids return the existing row. */
export async function recordEmailWebhookEvent({
  svixId,
  type,
  emailId,
  providerStatus,
  providerEventAt,
}) {
  const id = String(svixId || '').slice(0, 200);
  if (!id) throw new Error('Missing webhook id.');

  try {
    return await EmailWebhookEvent.create({
      svixId: id,
      type: String(type || '').slice(0, 80),
      emailId: String(emailId || '').slice(0, 160),
      providerStatus: String(providerStatus || '').slice(0, 40),
      providerEventAt: eventDate(providerEventAt),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: EMPTY_ERROR,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return EmailWebhookEvent.findOne({ svixId: id });
    }
    throw error;
  }
}

async function finishEvent(event, fields) {
  const filter = { _id: event._id };
  if (event.lockId) filter.lockId = event.lockId;
  const result = await EmailWebhookEvent.updateOne(filter, { $set: fields });
  return result.matchedCount > 0;
}

async function markEventPending(event, code, message) {
  const attempts = Number(event.attempts || 0) + 1;
  const failed = attempts >= EMAIL_WEBHOOK_MAX_ATTEMPTS;
  return finishEvent(event, {
    status: failed ? 'failed' : 'pending',
    nextAttemptAt: new Date(Date.now() + retryDelay(attempts)),
    lockedUntil: null,
    lockId: '',
    lastError: {
      code: String(code || 'webhook_retry').slice(0, 80),
      statusCode: null,
      message: sanitizeErrorText(message || 'The webhook could not be applied yet.', 300),
    },
  });
}

/**
 * Apply one durable webhook event to its outbox row.
 * @returns {Promise<{ok:boolean, duplicate?:boolean, pending?:boolean, stale?:boolean, failed?:boolean}>}
 */
export async function applyEmailWebhookEvent(event, { force = false } = {}) {
  if (!event) return { ok: true, duplicate: true };
  if (event.status === 'processed' && !force) return { ok: true, duplicate: true };

  if (!event.emailId || !event.providerStatus) {
    await finishEvent(event, {
      status: 'processed',
      processedAt: new Date(),
      lockedUntil: null,
      lockId: '',
      lastError: {
        code: 'event_ignored',
        statusCode: null,
        message: 'This event does not carry a provider message status.',
      },
    });
    return { ok: true, ignored: true };
  }

  let outbox;
  try {
    outbox = await EmailOutbox.findOne({ providerMessageId: event.emailId }).lean();
  } catch (error) {
    await markEventPending(event, 'outbox_lookup_failed', error?.message);
    return { ok: true, pending: true };
  }

  if (!outbox) {
    // Expected when Resend reports delivery before our sent-update stored the
    // provider message id. The event stays durable until the worker links it.
    await markEventPending(
      event,
      'provider_message_not_found',
      'Waiting for the outbox to store the provider message id.',
    );
    return { ok: true, pending: true };
  }

  const incomingAt = eventDate(event.providerEventAt) || eventDate(event.receivedAt) || new Date();
  const currentAt = eventDate(outbox.providerEventAt);
  const incomingRank = PROVIDER_STATUS_RANK[event.providerStatus] ?? 0;
  const currentRank = PROVIDER_STATUS_RANK[outbox.providerStatus] ?? 0;

  const terminal = (status) => ['bounced', 'complained', 'failed'].includes(status);
  const staleByTime = currentAt && incomingAt.getTime() < currentAt.getTime();
  // Status rank is monotonic: a later `accepted` must not overwrite a
  // `delivered`, and a later non-terminal event must not overwrite a bounce.
  const staleByRank = incomingRank < currentRank;
  const staleByTerminal = terminal(outbox.providerStatus) && incomingRank < 4;

  if (staleByTime || staleByRank || staleByTerminal) {
    await finishEvent(event, {
      status: 'processed',
      processedAt: new Date(),
      lockedUntil: null,
      lockId: '',
      lastError: {
        code: 'stale_event',
        statusCode: null,
        message: 'A newer provider event was already applied.',
      },
    });
    return { ok: true, stale: true };
  }

  const update = {
    providerStatus: event.providerStatus,
    providerEventAt: incomingAt,
  };
  if (terminal(event.providerStatus)) {
    update.status = 'failed';
    update.nextAttemptAt = null;
    update.lockedUntil = null;
    update.lockId = '';
    update.lastError = {
      code: `provider_${event.providerStatus}`,
      statusCode: null,
      message: `Resend reported ${event.providerStatus}.`,
    };
  }

  try {
    const result = await EmailOutbox.updateOne({ _id: outbox._id }, { $set: update });
    if (!result.matchedCount) {
      await markEventPending(event, 'outbox_update_missed', 'The outbox row disappeared.');
      return { ok: true, pending: true };
    }
  } catch (error) {
    await markEventPending(event, 'outbox_update_failed', error?.message);
    emailLog('webhook outbox update failed; will retry', { error: safeError(error) });
    return { ok: true, pending: true };
  }

  await finishEvent(event, {
    status: 'processed',
    processedAt: new Date(),
    lockedUntil: null,
    lockId: '',
    lastError: EMPTY_ERROR,
  });
  return { ok: true, applied: true };
}

/**
 * Retry pending webhook rows. Bounded by count and wall-clock time.
 */
export async function processPendingWebhookEvents({
  limit = EMAIL_WEBHOOK_BATCH_SIZE,
  timeBudgetMs = EMAIL_WORKER_TIME_BUDGET_MS,
} = {}) {
  const started = Date.now();
  const now = new Date();
  try {
    await EmailWebhookEvent.updateMany(
      { status: 'processing', lockedUntil: { $lt: now } },
      {
        $set: {
          status: 'pending',
          nextAttemptAt: now,
          lockedUntil: null,
          lockId: '',
        },
      },
    );
  } catch (error) {
    emailLog('webhook lease recovery failed', { error: safeError(error) });
  }

  const summary = { processed: 0, applied: 0, pending: 0, stale: 0, failed: 0 };
  const seen = new Set();

  for (let index = 0; index < Math.max(1, limit); index += 1) {
    if (Date.now() - started > timeBudgetMs) break;

    let event;
    try {
      event = await EmailWebhookEvent.findOneAndUpdate(
        { _id: { $nin: [...seen] }, status: 'pending', nextAttemptAt: { $lte: new Date() } },
        {
          $set: {
            status: 'processing',
            lockId: `webhook-${Date.now()}-${index}`,
            lockedUntil: new Date(Date.now() + WEBHOOK_LEASE_MS),
            lastError: EMPTY_ERROR,
          },
          $inc: { attempts: 1 },
        },
        { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
      );
    } catch (error) {
      emailLog('webhook claim failed', { error: safeError(error) });
      break;
    }
    if (!event) break;
    seen.add(event._id);

    summary.processed += 1;
    const outcome = await applyEmailWebhookEvent(event);
    if (outcome.applied) summary.applied += 1;
    else if (outcome.stale) summary.stale += 1;
    else if (outcome.pending) summary.pending += 1;
    else if (outcome.ignored) summary.failed += 1;
  }

  return summary;
}

/**
 * Apply events that arrived before the outbox stored its provider message id.
 * Called immediately after a successful send, and available to the worker.
 */
export async function processWebhookEventsForEmail(emailId, { limit = 25 } = {}) {
  if (!emailId) return { applied: 0 };
  let events = [];
  try {
    events = await EmailWebhookEvent.find({
      emailId: String(emailId),
      status: 'pending',
    })
      .sort({ providerEventAt: 1, createdAt: 1 })
      .limit(limit);
  } catch (error) {
    emailLog('early webhook lookup failed', { error: safeError(error) });
    return { applied: 0 };
  }

  let applied = 0;
  for (const event of events) {
    const outcome = await applyEmailWebhookEvent(event, { force: true });
    if (outcome.applied || outcome.stale) applied += 1;
  }
  return { applied };
}

export async function webhookEventState() {
  try {
    const rows = await EmailWebhookEvent.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  } catch {
    return {};
  }
}
