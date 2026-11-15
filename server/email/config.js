/**
 * server/email/config.js
 * ===========================================================================
 * EMAIL CONFIGURATION
 * ===========================================================================
 * Everything here is server-only. No email variable is prefixed with VITE_,
 * so Vite can never inline it into the browser bundle.
 */

import { isEmail } from '../http.js';

const truthy = (value) => String(value || '').trim().toLowerCase() === 'true';

const eventList = (raw) =>
  String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

function positiveInt(raw, fallback, { min = 1, max = 100 } = {}) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

function firstAppOrigin(raw) {
  return String(raw || '')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
}

const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
const fromEmail = from.match(/<([^>]+)>/)?.[1] || from;

export const EMAIL_ENABLED = truthy(process.env.EMAIL_ENABLED);
export const EMAIL_MODE = String(process.env.EMAIL_MODE || 'live').trim().toLowerCase() === 'test' ? 'test' : 'live';
export const EMAIL_TEST_RECIPIENT = String(process.env.EMAIL_TEST_RECIPIENT || '').trim().toLowerCase();
export const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
export const RESEND_FROM_EMAIL = from;
export const RESEND_REPLY_TO = String(process.env.RESEND_REPLY_TO || '').trim();
export const EMAIL_APP_URL =
  String(process.env.EMAIL_APP_URL || '').trim().replace(/\/+$/, '') ||
  firstAppOrigin(process.env.APP_ORIGIN);
export const EMAIL_MAX_ATTEMPTS = positiveInt(process.env.EMAIL_MAX_ATTEMPTS, 6, { min: 1, max: 10 });
export const EMAIL_BATCH_SIZE = positiveInt(process.env.EMAIL_BATCH_SIZE, 10, { min: 1, max: 25 });
// Worker-only by default. Inline best-effort draining must be explicitly enabled.
export const EMAIL_INLINE_DISPATCH =
  String(process.env.EMAIL_INLINE_DISPATCH ?? 'false').trim().toLowerCase() === 'true';
export const EMAIL_DRIVE_ANNOUNCEMENTS = truthy(process.env.EMAIL_DRIVE_ANNOUNCEMENTS);
/**
 * Explicit event allowlist. Empty means no email event is allowed; it never
 * means "all". Production rollout should start with the two welcome events.
 */
export const EMAIL_ALLOWED_EVENTS = Object.freeze([
  ...new Set(eventList(process.env.EMAIL_ALLOWED_EVENTS)),
]);
const EMAIL_ALLOWED_EVENT_SET = new Set(EMAIL_ALLOWED_EVENTS);

export function emailEventAllowed(eventType) {
  return EMAIL_ALLOWED_EVENT_SET.has(String(eventType || '').trim());
}
export const EMAIL_WORKER_SECRET = String(process.env.EMAIL_WORKER_SECRET || '').trim();
export const RESEND_WEBHOOK_SECRET = String(process.env.RESEND_WEBHOOK_SECRET || '').trim();

export const EMAIL_LEASE_MS = 10 * 60 * 1000;
// Keep the whole retry window below Resend's 24-hour idempotency-key lifetime.
export const EMAIL_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

/**
 * Bounds for the durable intent journal and the drive-announcement fan-out.
 * Every value is clamped so a mistyped environment variable cannot turn one
 * request into an unbounded database scan or an unbounded email burst.
 */
export const EMAIL_WORKER_TIME_BUDGET_MS = positiveInt(process.env.EMAIL_WORKER_TIME_BUDGET_MS, 20_000, {
  min: 1_000,
  max: 50_000,
});
export const EMAIL_INTENT_BATCH_SIZE = positiveInt(process.env.EMAIL_INTENT_BATCH_SIZE, 25, {
  min: 1,
  max: 100,
});
export const EMAIL_INTENT_GRACE_MS = positiveInt(process.env.EMAIL_INTENT_GRACE_MS, 30_000, {
  min: 1_000,
  max: 10 * 60_000,
});
export const EMAIL_INTENT_LEASE_MS = positiveInt(process.env.EMAIL_INTENT_LEASE_MS, 60_000, {
  min: 5_000,
  max: 10 * 60_000,
});
export const EMAIL_FANOUT_BATCH_SIZE = positiveInt(process.env.EMAIL_FANOUT_BATCH_SIZE, 100, {
  min: 1,
  max: 500,
});
export const EMAIL_FANOUT_MAX_BATCHES = positiveInt(process.env.EMAIL_FANOUT_MAX_BATCHES, 4, {
  min: 1,
  max: 20,
});
export const EMAIL_FANOUT_MAX_RECIPIENTS = positiveInt(process.env.EMAIL_FANOUT_MAX_RECIPIENTS, 5_000, {
  min: 1,
  max: 50_000,
});
export const EMAIL_FANOUT_COMPANY_DAILY_LIMIT = positiveInt(
  process.env.EMAIL_FANOUT_COMPANY_DAILY_LIMIT,
  20,
  { min: 1, max: 1_000 },
);
export const EMAIL_FANOUT_MAX_FAILURES = positiveInt(process.env.EMAIL_FANOUT_MAX_FAILURES, 8, {
  min: 1,
  max: 50,
});
export const EMAIL_FANOUT_LEASE_MS = positiveInt(process.env.EMAIL_FANOUT_LEASE_MS, 60_000, {
  min: 10_000,
  max: 10 * 60_000,
});
export const EMAIL_WORKER_RATE_LIMIT_MS = positiveInt(process.env.EMAIL_WORKER_RATE_LIMIT_MS, 1_000, {
  min: 0,
  max: 60_000,
});
export const EMAIL_WEBHOOK_MAX_ATTEMPTS = positiveInt(process.env.EMAIL_WEBHOOK_MAX_ATTEMPTS, 12, {
  min: 1,
  max: 50,
});
export const EMAIL_WEBHOOK_BATCH_SIZE = positiveInt(process.env.EMAIL_WEBHOOK_BATCH_SIZE, 50, {
  min: 1,
  max: 200,
});

/** A short, safe list for diagnostics. Never include values. */
export function emailConfigState() {
  const missing = [];
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!RESEND_FROM_EMAIL) missing.push('RESEND_FROM_EMAIL');
  if (!EMAIL_APP_URL) missing.push('EMAIL_APP_URL');
  if (!isEmail(fromEmail)) missing.push('RESEND_FROM_EMAIL');
  if (EMAIL_MODE === 'test' && !isEmail(EMAIL_TEST_RECIPIENT)) missing.push('EMAIL_TEST_RECIPIENT');
  return {
    enabled: EMAIL_ENABLED,
    configured: missing.length === 0,
    mode: EMAIL_MODE,
    missing: [...new Set(missing)],
    fromEmail: fromEmail || '',
    appUrl: EMAIL_APP_URL,
    batchSize: EMAIL_BATCH_SIZE,
    maxAttempts: EMAIL_MAX_ATTEMPTS,
    workerTimeBudgetMs: EMAIL_WORKER_TIME_BUDGET_MS,
    intentBatchSize: EMAIL_INTENT_BATCH_SIZE,
    fanoutBatchSize: EMAIL_FANOUT_BATCH_SIZE,
    fanoutMaxRecipients: EMAIL_FANOUT_MAX_RECIPIENTS,
    fanoutCompanyDailyLimit: EMAIL_FANOUT_COMPANY_DAILY_LIMIT,
    fanoutMaxFailures: EMAIL_FANOUT_MAX_FAILURES,
    driveAnnouncements: EMAIL_DRIVE_ANNOUNCEMENTS,
    allowedEvents: EMAIL_ALLOWED_EVENTS,
  };
}

export function emailIsReady() {
  return EMAIL_ENABLED && emailConfigState().configured;
}
