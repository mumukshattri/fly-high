/**
 * server/models/email-outbox.js
 * ===========================================================================
 * DURABLE EMAIL OUTBOX
 * ===========================================================================
 *
 * An email is a side effect, never the source of truth. Every event is written
 * here first with a deterministic idempotency key, then a worker (or the
 * immediate best-effort drain) sends it through Resend.
 *
 * `sent` means Resend ACCEPTED the request. It does not mean delivered; the
 * webhook updates `providerStatus` when Resend reports delivery, bounce or
 * complaint.
 */

import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 160 },
    name: { type: String, default: '', trim: true, maxlength: 160 },
    role: {
      type: String,
      enum: ['student', 'company', 'admin'],
      required: true,
    },
  },
  { _id: false },
);

const relatedSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    drive: { type: mongoose.Schema.Types.ObjectId, ref: 'Drive', default: null },
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', default: null },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { _id: false },
);

const lastErrorSchema = new mongoose.Schema(
  {
    code: { type: String, default: '', maxlength: 80 },
    statusCode: { type: Number, default: null },
    message: { type: String, default: '', maxlength: 300 },
  },
  { _id: false },
);

const emailOutboxSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true, maxlength: 256 },
    eventType: { type: String, required: true, trim: true, maxlength: 80, index: true },
    templateId: { type: String, required: true, trim: true, maxlength: 80 },

    recipient: { type: recipientSchema, required: true },
    related: { type: relatedSchema, default: () => ({}) },

    subject: { type: String, required: true, maxlength: 300 },
    html: { type: String, required: true, maxlength: 80_000 },
    text: { type: String, required: true, maxlength: 20_000 },

    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed', 'suppressed', 'retry_scheduled'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    lockedUntil: { type: Date, default: null },
    lockId: { type: String, default: '', maxlength: 80 },

    providerMessageId: { type: String, default: '', maxlength: 160, index: true },
    providerStatus: {
      type: String,
      enum: ['', 'accepted', 'delivered', 'delayed', 'bounced', 'complained', 'failed'],
      default: '',
    },
    /**
     * Timestamp of the provider event currently reflected in providerStatus.
     * Webhooks use it to reject an older event that arrives after a newer one.
     */
    providerEventAt: { type: Date, default: null },
    lastError: { type: lastErrorSchema, default: () => ({}) },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The worker always asks for the oldest due row; this index makes that cheap.
emailOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
// Stale lease recovery.
emailOutboxSchema.index({ status: 1, lockedUntil: 1 });

export const EmailOutbox =
  mongoose.models.EmailOutbox || mongoose.model('EmailOutbox', emailOutboxSchema);

export default EmailOutbox;
