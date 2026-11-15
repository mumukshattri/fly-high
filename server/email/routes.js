/**
 * server/email/routes.js
 * ===========================================================================
 * INTERNAL EMAIL WORKER ENDPOINT
 * ===========================================================================
 * This endpoint is for Vercel Cron or a trusted external scheduler only. It is
 * not a user endpoint and never accepts a recipient or message body.
 *
 * Abuse protection is layered:
 *   - a shared secret compared in constant time;
 *   - a per-process minimum interval between worker runs;
 *   - a wall-clock budget shared by every task in the invocation;
 *   - bounded batch sizes and per-drive recipient ceilings.
 */

import { timingSafeEqual } from 'node:crypto';

import {
  EMAIL_WORKER_RATE_LIMIT_MS,
  EMAIL_WORKER_TIME_BUDGET_MS,
  EMAIL_WORKER_SECRET,
  emailConfigState,
} from './config.js';
import { emailLog, safeError } from './log.js';
import { drainEmailOutbox } from './worker.js';
import { queueDeadlineReminders } from './events.js';
import {
  emailIntentState,
  flushEmailIntents,
  reconcileEmailIntents,
} from './intents.js';
import {
  processEmailFanoutJobs,
  reconcileDriveAnnouncementJobs,
} from './fanout.js';
import { processPendingWebhookEvents, webhookEventState } from './webhook-events.js';
import { emailIndexReport } from './indexes.js';

function secretMatches(req, secret) {
  const header = String(req.headers.authorization || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !secret) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

let lastWorkerRunAt = 0;

function rateLimited() {
  if (!EMAIL_WORKER_RATE_LIMIT_MS) return false;
  const now = Date.now();
  if (now - lastWorkerRunAt < EMAIL_WORKER_RATE_LIMIT_MS) return true;
  lastWorkerRunAt = now;
  return false;
}

function remaining(deadline) {
  return Math.max(1_000, deadline - Date.now());
}

async function handleWorker(req, res) {
  const secret = EMAIL_WORKER_SECRET || String(process.env.CRON_SECRET || '').trim();
  if (!secret) {
    res.status(503).json({ error: 'Email worker authentication is not configured.' });
    return;
  }
  if (!secretMatches(req, secret)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  if (rateLimited()) {
    res.setHeader('Retry-After', String(Math.ceil(EMAIL_WORKER_RATE_LIMIT_MS / 1000) || 1));
    res.status(429).json({ error: 'The email worker was called too recently.' });
    return;
  }

  const state = emailConfigState();
  if (!state.enabled) {
    // Never mark existing rows failed or delete them while the subsystem is
    // switched off. They resume when it is enabled again.
    res.json({ ok: true, skipped: 'disabled', queuedPreserved: true });
    return;
  }
  if (!state.configured) {
    res.json({
      ok: true,
      skipped: 'not_configured',
      queuedPreserved: true,
      state: { enabled: state.enabled, missing: state.missing },
    });
    return;
  }

  let indexes;
  try {
    indexes = await emailIndexReport();
  } catch (error) {
    emailLog('worker refused to verify required indexes', { error: safeError(error) });
    res.status(503).json({ error: 'Required email indexes could not be verified.' });
    return;
  }
  if (!indexes.ok) {
    emailLog('worker refused to run without required indexes', { error: 'missing_indexes' });
    res.status(503).json({
      error: 'Required email indexes are not available.',
      missing: indexes.missing,
    });
    return;
  }

  // Default to the conservative email-only task. The broad `all` task must be
  // requested explicitly and is never used by the production cron.
  const task = String(req.query.task || 'email');
  const allowed = new Set(['all', 'email', 'deadline', 'fanout', 'webhook', 'reconcile', 'diagnostics']);
  if (!allowed.has(task)) {
    res.status(400).json({ error: 'Unknown worker task.' });
    return;
  }

  if (task === 'diagnostics') {
    res.json({
      ok: true,
      indexes,
      intents: await emailIntentState(),
      webhooks: await webhookEventState(),
      state: { batchSize: state.batchSize, maxAttempts: state.maxAttempts, driveAnnouncements: state.driveAnnouncements },
    });
    return;
  }

  const deadline = Date.now() + EMAIL_WORKER_TIME_BUDGET_MS;
  const result = { ok: true, task };

  if (task === 'deadline' || task === 'all') {
    result.deadline = await queueDeadlineReminders(3);
  }

  if (task === 'reconcile' || task === 'all' || task === 'email') {
    result.intentsReconciled = await reconcileEmailIntents({
      limit: state.intentBatchSize,
      now: new Date(),
    });
  }

  if (task === 'fanout' || task === 'all') {
    result.fanoutRecovery = await reconcileDriveAnnouncementJobs();
    result.fanout = await processEmailFanoutJobs({
      limit: 1,
      timeBudgetMs: remaining(deadline),
    });
  }

  if (task === 'webhook' || task === 'all') {
    result.webhooks = await processPendingWebhookEvents({
      limit: state.batchSize,
      timeBudgetMs: remaining(deadline),
    });
  }

  if (task !== 'deadline' && task !== 'fanout' && task !== 'webhook') {
    result.intentsFlushed = await flushEmailIntents({
      limit: state.intentBatchSize,
      timeBudgetMs: remaining(deadline),
    });
    result.email = await drainEmailOutbox({
      limit: state.batchSize,
      timeBudgetMs: remaining(deadline),
    });
  }

  res.json(result);
}

export function registerEmailRoutes(router) {
  router.get('/internal/email/worker', handleWorker);
  router.post('/internal/email/worker', handleWorker);
}
