/**
 * server/email/intents.js
 * ===========================================================================
 * DURABLE INTENT JOURNAL AND RECONCILIATION
 * ===========================================================================
 * This module is the crash-safe bridge between a business write and the email
 * outbox. It deliberately does NOT require MongoDB transactions: the local
 * test database and many small deployments are standalone servers.
 *
 * A business route prepares an intent first, performs its normal business
 * write, then commits the intent. If the process dies anywhere in between, the
 * worker reconciles the pending intent by checking the business document.
 */

import { randomUUID } from 'node:crypto';

import {
  EMAIL_APP_URL,
  EMAIL_ALLOWED_EVENTS,
  EMAIL_ENABLED,
  EMAIL_INTENT_BATCH_SIZE,
  EMAIL_INTENT_GRACE_MS,
  EMAIL_INTENT_LEASE_MS,
  EMAIL_WORKER_TIME_BUDGET_MS,
  emailEventAllowed,
  emailIsReady,
} from './config.js';
import { emailLog, safeError, sanitizeErrorText } from './log.js';
import { recipientAllowsEmail } from './preferences.js';
import { buildEmail } from './templates.js';
import { Admin, Application, Company, Drive, Student } from '../models/index.js';
import { EmailIntent } from '../models/email-intent.js';
import { EmailOutbox } from '../models/email-outbox.js';
import { isEmail } from '../http.js';

const EMPTY_ERROR = { code: '', statusCode: null, message: '' };
const RECONCILE_MAX_ATTEMPTS = 12;
const RECONCILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const idOf = (value) => (value?._id ? String(value._id) : value ? String(value) : null);

function relatedIds({ student, company, drive, application, admin } = {}) {
  return {
    student: idOf(student),
    company: idOf(company),
    drive: idOf(drive),
    application: idOf(application),
    admin: idOf(admin),
  };
}

function intentKeyDelay(attempts) {
  const base = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export function emailIntentsEnabled() {
  return EMAIL_ENABLED && emailIsReady();
}

/**
 * Persist a pending intent before the business write. Duplicate keys return the
 * existing intent, which makes retries and concurrent requests harmless.
 *
 * Never throws: an email problem must not block the business operation. A
 * failure is logged with a safe error shape so it is observable.
 */
export async function prepareEmailIntent(spec) {
  if (!emailIntentsEnabled() || !spec) return null;
  if (!emailEventAllowed(spec.eventType)) {
    emailLog('intent skipped event not allowed', {
      eventType: spec.eventType,
      templateId: spec.templateId,
    });
    return null;
  }

  const email = String(spec.recipient?.email || '').trim().toLowerCase();
  if (!isEmail(email)) {
    emailLog('intent skipped invalid recipient', {
      eventType: spec.eventType,
      templateId: spec.templateId,
    });
    return null;
  }

  const role = spec.recipient?.role;
  if (!['student', 'company', 'admin'].includes(role)) {
    emailLog('intent skipped invalid recipient role', {
      eventType: spec.eventType,
      templateId: spec.templateId,
    });
    return null;
  }

  const idempotencyKey = String(spec.idempotencyKey || '').trim().slice(0, 256);
  if (!idempotencyKey) {
    emailLog('intent skipped missing idempotency key', {
      eventType: spec.eventType,
      templateId: spec.templateId,
    });
    return null;
  }

  try {
    const existing = await EmailIntent.findOne({ idempotencyKey }).lean();
    if (existing) return existing;

    return await EmailIntent.create({
      intentId: randomUUID(),
      eventType: spec.eventType,
      templateId: spec.templateId,
      recipient: {
        email,
        name: String(spec.recipient.name || '').slice(0, 160),
        role,
      },
      related: relatedIds(spec.related),
      data: spec.data || {},
      idempotencyKey,
      state: 'pending',
      verify: spec.verify || null,
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: EMPTY_ERROR,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return EmailIntent.findOne({ idempotencyKey }).lean();
    }
    emailLog('intent could not be persisted', {
      eventType: spec.eventType,
      templateId: spec.templateId,
      error: safeError(error),
    });
    return null;
  }
}

/** Mark a pending intent as not applicable (business write failed or opted out). */
export async function skipEmailIntent(intent, reason = 'not_applicable') {
  const id = intent?._id || intent;
  if (!id) return false;
  try {
    const result = await EmailIntent.updateOne(
      { _id: id, state: { $in: ['pending', 'ready', 'dispatching'] } },
      {
        $set: {
          state: 'skipped',
          skippedAt: new Date(),
          lockedUntil: null,
          lockId: '',
          lastError: {
            code: 'intent_skipped',
            statusCode: null,
            message: sanitizeErrorText(reason, 300),
          },
        },
      },
    );
    return result.matchedCount > 0;
  } catch (error) {
    emailLog('intent could not be skipped', {
      error: safeError(error),
      eventType: intent?.eventType || '',
    });
    return false;
  }
}

export async function skipEmailIntents(intents, reason) {
  const list = Array.isArray(intents) ? intents : [intents];
  await Promise.all(list.filter(Boolean).map((intent) => skipEmailIntent(intent, reason)));
}

/**
 * Commit an intent after its business write succeeded. The outbox insert is
 * attempted immediately so normal requests keep their current behaviour, but a
 * failure leaves the intent `ready` for the worker instead of losing the event.
 */
export async function commitEmailIntent(intent, { flush = true } = {}) {
  const id = intent?._id || intent;
  if (!id) return null;

  try {
    const updated = await EmailIntent.findOneAndUpdate(
      { _id: id, state: { $in: ['pending', 'ready'] } },
      {
        $set: {
          state: 'ready',
          committedAt: new Date(),
          nextAttemptAt: new Date(),
          lockedUntil: null,
          lockId: '',
          lastError: EMPTY_ERROR,
        },
      },
      { new: true },
    );

    if (!updated) {
      const current = await EmailIntent.findById(id).lean();
      if (current?.state === 'queued') {
        return { queued: true, duplicate: true, idempotencyKey: current.idempotencyKey };
      }
      if (current?.state === 'skipped' || current?.state === 'failed') {
        return { queued: false, skipped: true, idempotencyKey: current.idempotencyKey };
      }
      return { queued: false, pending: true, idempotencyKey: current?.idempotencyKey };
    }

    if (!flush) {
      return { queued: false, ready: true, idempotencyKey: updated.idempotencyKey };
    }
    return await flushEmailIntent(updated);
  } catch (error) {
    emailLog('intent commit failed; worker will recover it', {
      eventType: intent?.eventType || '',
      error: safeError(error),
    });
    return { queued: false, pending: true, idempotencyKey: intent?.idempotencyKey };
  }
}

/** Prepare + commit for self-contained mail with no preceding business write. */
export async function enqueueIntentNow(spec) {
  const intent = await prepareEmailIntent(spec);
  if (!intent) return null;
  return commitEmailIntent(intent);
}

async function scheduleFlushRetry(intent, code, error) {
  const result = await EmailIntent.updateOne(
    { _id: intent._id, state: 'dispatching', lockId: intent.lockId },
    {
      $set: {
        state: 'ready',
        nextAttemptAt: new Date(Date.now() + intentKeyDelay(intent.attempts)),
        lockedUntil: null,
        lockId: '',
        lastError: {
          code: String(code || 'intent_dispatch_failed').slice(0, 80),
          statusCode: Number(error?.statusCode || 0) || null,
          message: sanitizeErrorText(error?.message || 'The intent could not be queued.', 300),
        },
      },
    },
  );
  return result.matchedCount > 0;
}

async function markIntentFenced(intent, state, { code, message } = {}) {
  const set = {
    state,
    lockedUntil: null,
    lockId: '',
    lastError: code
      ? {
          code: String(code).slice(0, 80),
          statusCode: null,
          message: sanitizeErrorText(message || '', 300),
        }
      : EMPTY_ERROR,
  };
  if (state === 'queued') set.queuedAt = new Date();
  if (state === 'skipped') set.skippedAt = new Date();

  const result = await EmailIntent.updateOne(
    { _id: intent._id, state: 'dispatching', lockId: intent.lockId },
    { $set: set },
  );
  if (result.matchedCount === 0) {
    emailLog('intent lease lost', { intentId: String(intent._id), eventType: intent.eventType });
    return false;
  }
  return true;
}

/**
 * Turn one ready intent into one outbox row. The outbox's unique
 * idempotencyKey makes a duplicate insert harmless.
 */
export async function flushEmailIntent(intent) {
  if (!emailIntentsEnabled()) {
    return { queued: false, pending: true, idempotencyKey: intent?.idempotencyKey };
  }
  if (!emailEventAllowed(intent?.eventType)) {
    return { queued: false, blocked: true, idempotencyKey: intent?.idempotencyKey };
  }
  const id = intent?._id || intent;
  if (!id) return { queued: false, pending: true };

  const now = new Date();
  let claimed;
  try {
    claimed = await EmailIntent.findOneAndUpdate(
      { _id: id, state: 'ready', nextAttemptAt: { $lte: now } },
      {
        $set: {
          state: 'dispatching',
          lockId: randomUUID(),
          lockedUntil: new Date(now.getTime() + EMAIL_INTENT_LEASE_MS),
          lastError: EMPTY_ERROR,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    );
  } catch (error) {
    emailLog('intent claim failed', { eventType: intent?.eventType || '', error: safeError(error) });
    return { queued: false, pending: true, idempotencyKey: intent?.idempotencyKey };
  }

  if (!claimed) {
    let current = null;
    try {
      current = await EmailIntent.findById(id).lean();
    } catch {
      /* treated as a pending intent below */
    }
    if (current?.state === 'queued') {
      return { queued: true, duplicate: true, idempotencyKey: current.idempotencyKey };
    }
    return { queued: false, pending: true, idempotencyKey: current?.idempotencyKey };
  }

  const preference = await recipientAllowsEmail(claimed);
  if (!preference.allowed) {
    if (preference.retryable) {
      await scheduleFlushRetry(claimed, preference.reason, null);
      return { queued: false, pending: true, idempotencyKey: claimed.idempotencyKey };
    }
    await markIntentFenced(claimed, 'skipped', {
      code: preference.reason || 'recipient_preference',
      message: 'The recipient no longer accepts this email.',
    });
    return { queued: false, skipped: true, idempotencyKey: claimed.idempotencyKey };
  }

  let message;
  try {
    message = buildEmail(claimed.templateId, claimed.data, EMAIL_APP_URL);
  } catch (error) {
    await markIntentFenced(claimed, 'failed', {
      code: 'template_render_failed',
      message: error?.message || 'The email template could not be rendered.',
    });
    emailLog('intent template failed', {
      eventType: claimed.eventType,
      templateId: claimed.templateId,
      error: safeError(error),
    });
    return { queued: false, failed: true, idempotencyKey: claimed.idempotencyKey };
  }

  try {
    await EmailOutbox.create({
      eventId: claimed.intentId,
      idempotencyKey: claimed.idempotencyKey,
      eventType: claimed.eventType,
      templateId: claimed.templateId,
      recipient: {
        email: claimed.recipient.email,
        name: claimed.recipient.name,
        role: claimed.recipient.role,
      },
      related: claimed.related,
      subject: message.subject,
      html: message.html,
      text: message.text,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
    });
  } catch (error) {
    if (error?.code !== 11000) {
      await scheduleFlushRetry(claimed, 'outbox_write_failed', error);
      emailLog('intent outbox write failed; will retry', {
        eventType: claimed.eventType,
        error: safeError(error),
      });
      return { queued: false, pending: true, idempotencyKey: claimed.idempotencyKey };
    }
  }

  await markIntentFenced(claimed, 'queued');
  return { queued: true, idempotencyKey: claimed.idempotencyKey };
}

async function verifyBusinessState(intent) {
  const verify = intent?.verify;
  if (!verify || !verify.kind) return true;

  try {
    switch (verify.kind) {
      case 'student-created':
        return Boolean(await Student.exists({ _id: verify.id }));
      case 'company-created':
        return Boolean(await Company.exists({ _id: verify.id }));
      case 'company-approved':
        return Boolean(await Company.exists({ _id: verify.id, verified: true }));
      case 'application-created':
        return Boolean(await Application.exists({ _id: verify.id }));
      case 'application-transition':
        if (!verify.eventId) return false;
        return Boolean(
          await Application.exists({
            _id: verify.id,
            statusHistory: { $elemMatch: { eventId: String(verify.eventId) } },
          }),
        );
      case 'drive-created':
        return Boolean(await Drive.exists({ _id: verify.id }));
      case 'drive-closed':
        return Boolean(await Drive.exists({ _id: verify.id, status: 'Closed' }));
      case 'drive-deadline':
        return Boolean(
          await Drive.exists({ _id: verify.id, status: 'Open', deadline: verify.deadline }),
        );
      case 'entity-exists': {
        const model = verify.model === 'student'
          ? Student
          : verify.model === 'company'
            ? Company
            : verify.model === 'drive'
              ? Drive
              : verify.model === 'application'
                ? Application
                : verify.model === 'admin'
                  ? Admin
                  : null;
        return model ? Boolean(await model.exists({ _id: verify.id })) : false;
      }
      default:
        return false;
    }
  } catch (error) {
    emailLog('intent verification failed', {
      eventType: intent.eventType,
      error: safeError(error),
    });
    return false;
  }
}

async function recoverAbandonedIntentDispatches(now = new Date()) {
  try {
    await EmailIntent.updateMany(
      {
        state: 'dispatching',
        eventType: { $in: EMAIL_ALLOWED_EVENTS },
        lockedUntil: { $lt: now },
      },
      {
        $set: {
          state: 'ready',
          nextAttemptAt: now,
          lockedUntil: null,
          lockId: '',
          lastError: {
            code: 'intent_lease_expired',
            statusCode: null,
            message: 'The worker stopped before committing this intent.',
          },
        },
      },
    );
  } catch (error) {
    emailLog('intent lease recovery failed', { error: safeError(error) });
  }
}

/**
 * Prove or abandon pending intents. A pending intent is not blindly sent: the
 * related business document must exist (and, for status transitions, contain
 * the exact transition id written with the change).
 */
export async function reconcileEmailIntents({
  limit = EMAIL_INTENT_BATCH_SIZE,
  now = new Date(),
} = {}) {
  if (!emailIntentsEnabled()) {
    return { skipped: EMAIL_ENABLED ? 'not_configured' : 'disabled', checked: 0, ready: 0, skippedCount: 0 };
  }

  await recoverAbandonedIntentDispatches(now);

  let pending = [];
  try {
    pending = await EmailIntent.find({
      state: 'pending',
      eventType: { $in: EMAIL_ALLOWED_EVENTS },
      createdAt: { $lte: new Date(now.getTime() - EMAIL_INTENT_GRACE_MS) },
      nextAttemptAt: { $lte: now },
    })
      .sort({ createdAt: 1 })
      .limit(Math.max(1, limit));
  } catch (error) {
    emailLog('intent reconciliation query failed', { error: safeError(error) });
    return { checked: 0, ready: 0, skippedCount: 0 };
  }

  const summary = { checked: pending.length, ready: 0, skippedCount: 0 };
  for (const intent of pending) {
    const verified = await verifyBusinessState(intent);
    if (verified) {
      const updated = await EmailIntent.findOneAndUpdate(
        { _id: intent._id, state: 'pending' },
        {
          $set: {
            state: 'ready',
            committedAt: new Date(),
            nextAttemptAt: new Date(),
            lastError: EMPTY_ERROR,
          },
        },
        { new: true },
      );
      if (updated) {
        summary.ready += 1;
        await flushEmailIntent(updated);
      }
      continue;
    }

    const age = now.getTime() - new Date(intent.createdAt).getTime();
    const attempts = Number(intent.attempts || 0) + 1;
    const abandon = attempts >= RECONCILE_MAX_ATTEMPTS || age >= RECONCILE_MAX_AGE_MS;
    await EmailIntent.updateOne(
      { _id: intent._id, state: 'pending' },
      abandon
        ? {
            $set: {
              state: 'skipped',
              skippedAt: new Date(),
              nextAttemptAt: new Date(),
              lastError: {
                code: 'business_state_not_confirmed',
                statusCode: null,
                message: 'The business write this email belongs to was never confirmed.',
              },
            },
            $inc: { attempts: 1 },
          }
        : {
            $set: {
              nextAttemptAt: new Date(Date.now() + intentKeyDelay(attempts)),
              lastError: {
                code: 'business_state_unconfirmed',
                statusCode: null,
                message: 'Waiting for the related business write to be visible.',
              },
            },
            $inc: { attempts: 1 },
          },
    );
    if (abandon) summary.skippedCount += 1;
  }

  return summary;
}

/** Drain ready intents into the outbox, bounded by count and wall-clock time. */
export async function flushEmailIntents({
  limit = EMAIL_INTENT_BATCH_SIZE,
  timeBudgetMs = EMAIL_WORKER_TIME_BUDGET_MS,
} = {}) {
  if (!emailIntentsEnabled()) {
    return {
      skipped: EMAIL_ENABLED ? 'not_configured' : 'disabled',
      processed: 0,
      queued: 0,
      pending: 0,
      failed: 0,
    };
  }

  const started = Date.now();
  await recoverAbandonedIntentDispatches();

  const summary = { processed: 0, queued: 0, pending: 0, failed: 0, skippedCount: 0 };
  const seen = new Set();

  for (let index = 0; index < Math.max(1, limit); index += 1) {
    if (Date.now() - started > timeBudgetMs) break;

    let intent = null;
    try {
      intent = await EmailIntent.findOne({
        _id: { $nin: [...seen] },
        state: 'ready',
        eventType: { $in: EMAIL_ALLOWED_EVENTS },
        nextAttemptAt: { $lte: new Date() },
      })
        .sort({ nextAttemptAt: 1, createdAt: 1 })
        .lean();
    } catch (error) {
      emailLog('intent drain query failed', { error: safeError(error) });
      break;
    }
    if (!intent) break;
    seen.add(intent._id);

    summary.processed += 1;
    const result = await flushEmailIntent(intent);
    if (result.queued) summary.queued += 1;
    else if (result.failed) summary.failed += 1;
    else if (result.skipped) summary.skippedCount += 1;
    else summary.pending += 1;
  }

  return summary;
}

/** Small, safe diagnostics for the authenticated worker endpoint. */
export async function emailIntentState() {
  try {
    const rows = await EmailIntent.aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  } catch {
    return {};
  }
}
