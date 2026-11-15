/**
 * server/email/webhook.js
 * ===========================================================================
 * RESEND DELIVERY WEBHOOK
 * ===========================================================================
 * `sent` only means Resend accepted the request. This endpoint records the
 * provider's later delivery/bounce/complaint events after verifying the Svix
 * signature against the RAW request body.
 *
 * Signature verification is the authentication boundary. Once verified, the
 * event is written to the durable webhook inbox before the outbox is touched.
 */

import { Resend } from 'resend';

import { RESEND_API_KEY, RESEND_WEBHOOK_SECRET } from './config.js';
import { emailError, safeError } from './log.js';
import {
  WEBHOOK_STATUS,
  applyEmailWebhookEvent,
  recordEmailWebhookEvent,
} from './webhook-events.js';

function providerEventTime(event, headerTimestamp) {
  const created = event?.created_at;
  if (created) {
    const date = new Date(created);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const seconds = Number(headerTimestamp);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000);
  return new Date();
}

export async function emailWebhookHandler(req, res) {
  if (!RESEND_WEBHOOK_SECRET || !RESEND_API_KEY) {
    res.status(503).json({ error: 'Resend webhooks are not configured.' });
    return;
  }

  const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const headers = {
    id: String(req.headers['svix-id'] || ''),
    timestamp: String(req.headers['svix-timestamp'] || ''),
    signature: String(req.headers['svix-signature'] || ''),
  };

  let event;
  try {
    const resend = new Resend(RESEND_API_KEY);
    event = resend.webhooks.verify({
      payload,
      headers,
      webhookSecret: RESEND_WEBHOOK_SECRET,
    });
  } catch {
    res.status(400).json({ error: 'Invalid webhook signature.' });
    return;
  }

  const svixId = headers.id;
  const emailId = String(event?.data?.email_id || '');
  const type = String(event?.type || '');
  const providerStatus = WEBHOOK_STATUS[type] || '';
  const providerEventAt = providerEventTime(event, headers.timestamp);

  let record;
  try {
    record = await recordEmailWebhookEvent({
      svixId,
      type,
      emailId,
      providerStatus,
      providerEventAt,
    });
  } catch (error) {
    emailError('webhook could not be recorded', { type, error: safeError(error) });
    res.status(500).json({ error: 'Webhook could not be recorded.' });
    return;
  }

  const outcome = await applyEmailWebhookEvent(record);
  if (outcome.duplicate) {
    res.json({ ok: true, duplicate: true });
    return;
  }

  console.log('[email] webhook received', {
    type,
    emailId: emailId ? '[provider-id]' : '',
    status: outcome.pending ? 'pending' : outcome.stale ? 'stale' : 'processed',
  });
  res.json({ ok: true, ...(outcome.pending ? { pending: true } : {}) });
}
