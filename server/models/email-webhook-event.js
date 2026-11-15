/**
 * server/models/email-webhook-event.js
 * ===========================================================================
 * WEBHOOK INBOX / DEDUPLICATION
 * ===========================================================================
 * Resend/Svix retries webhook deliveries. The `svix-id` header is unique per
 * event; a unique index on it makes replay handling idempotent.
 *
 * The row is written BEFORE the outbox is updated. If the outbox update fails,
 * or the webhook arrives before the worker has stored `providerMessageId`, the
 * row stays pending and the worker retries it. A webhook is therefore never
 * acknowledged and lost just because the first database update failed.
 */

import mongoose from 'mongoose';

const lastErrorSchema = new mongoose.Schema(
  {
    code: { type: String, default: '', maxlength: 80 },
    statusCode: { type: Number, default: null },
    message: { type: String, default: '', maxlength: 300 },
  },
  { _id: false },
);

const emailWebhookEventSchema = new mongoose.Schema(
  {
    svixId: { type: String, required: true, unique: true, maxlength: 200 },
    type: { type: String, default: '', maxlength: 80 },
    emailId: { type: String, default: '', maxlength: 160, index: true },
    providerStatus: { type: String, default: '', maxlength: 40 },
    /** Resend event time, used to reject out-of-order delivery events. */
    providerEventAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ['pending', 'processing', 'processed', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    lockedUntil: { type: Date, default: null },
    lockId: { type: String, default: '', maxlength: 80 },
    lastError: { type: lastErrorSchema, default: () => ({}) },
    processedAt: { type: Date, default: null },

    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

emailWebhookEventSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
emailWebhookEventSchema.index({ emailId: 1, status: 1 });
// Webhook audit rows are operational data, not permanent records.
emailWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const EmailWebhookEvent =
  mongoose.models.EmailWebhookEvent || mongoose.model('EmailWebhookEvent', emailWebhookEventSchema);

export default EmailWebhookEvent;
