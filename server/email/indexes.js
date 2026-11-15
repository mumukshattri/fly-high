/**
 * server/email/indexes.js
 * ===========================================================================
 * EXPLICIT EMAIL INDEX VERIFICATION
 * ===========================================================================
 * The email subsystem relies on unique indexes for correctness, not only for
 * speed:
 *   - emailoutboxes.idempotencyKey / eventId prevent duplicate sends.
 *   - emailintents.idempotencyKey prevents duplicate durable intents.
 *   - emailwebhookevents.svixId makes webhook replay idempotent.
 *   - emailfanoutjobs.jobId makes the fan-out one job per drive.
 *
 * `createIndexes()` never drops an index. It is deliberately not called on
 * production boot or by the worker: only the explicit operator command
 * (`server/email/create-indexes.js --approve`) creates indexes.
 */

import { Drive } from '../models/drive.js';
import { EmailFanoutJob } from '../models/email-fanout-job.js';
import { EmailIntent } from '../models/email-intent.js';
import { EmailOutbox } from '../models/email-outbox.js';
import { EmailWebhookEvent } from '../models/email-webhook-event.js';
import { emailError } from './log.js';

let buildPromise = null;

const MODELS = [
  ['emailoutboxes', EmailOutbox],
  ['emailintents', EmailIntent],
  ['emailwebhookevents', EmailWebhookEvent],
  ['emailfanoutjobs', EmailFanoutJob],
  ['drives', Drive],
];

const EXPECTED = [
  ['emailoutboxes', ['eventId'], { unique: true }],
  ['emailoutboxes', ['idempotencyKey'], { unique: true }],
  ['emailoutboxes', ['status', 'nextAttemptAt', 'createdAt'], {}],
  ['emailoutboxes', ['status', 'lockedUntil'], {}],
  ['emailoutboxes', ['providerMessageId'], {}],
  ['emailintents', ['intentId'], { unique: true }],
  ['emailintents', ['idempotencyKey'], { unique: true }],
  ['emailintents', ['state', 'nextAttemptAt', 'createdAt'], {}],
  ['emailintents', ['state', 'lockedUntil'], {}],
  ['emailwebhookevents', ['svixId'], { unique: true }],
  ['emailwebhookevents', ['status', 'nextAttemptAt', 'createdAt'], {}],
  ['emailwebhookevents', ['emailId', 'status'], {}],
  ['emailfanoutjobs', ['jobId'], { unique: true }],
  ['emailfanoutjobs', ['status', 'nextAttemptAt', 'createdAt'], {}],
  ['emailfanoutjobs', ['status', 'lockedUntil'], {}],
  ['drives', ['announcementJobId'], {}],
];

/** Build every declared email index exactly once per process. */
export function ensureEmailIndexes() {
  if (!buildPromise) {
    buildPromise = Promise.all(MODELS.map(([, model]) => model.createIndexes())).catch((error) => {
      buildPromise = null;
      emailError('index build failed', { error: error?.name || 'error' });
      throw error;
    });
  }
  return buildPromise;
}

function matches(index, keys, { unique }) {
  const actual = Object.keys(index.key || {});
  if (actual.length !== keys.length) return false;
  if (!keys.every((key, position) => actual[position] === key)) return false;
  return unique ? Boolean(index.unique) : true;
}

/**
 * Check the live database, not just the schema. Returns a short report that is
 * safe to expose on the authenticated worker endpoint.
 */
export async function emailIndexReport() {
  const report = { ok: true, missing: [] };
  const indexesByCollection = {};
  for (const [name, model] of MODELS) {
    try {
      indexesByCollection[name] = await model.collection.indexes();
    } catch {
      indexesByCollection[name] = [];
    }
  }
  for (const [collection, keys, options] of EXPECTED) {
    const found = (indexesByCollection[collection] || []).some((index) =>
      matches(index, keys, options),
    );
    if (!found) {
      report.ok = false;
      report.missing.push(`${collection}:${keys.join('+')}${options.unique ? ':unique' : ''}`);
    }
  }
  return report;
}
