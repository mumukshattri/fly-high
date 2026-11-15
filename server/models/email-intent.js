/**
 * server/models/email-intent.js
 * ===========================================================================
 * DURABLE EMAIL INTENT
 * ===========================================================================
 * The business document and the outbox row cannot share a MongoDB transaction
 * on every deployment (standalone MongoDB, including the local test database,
 * does not support transactions). An intent is therefore written BEFORE the
 * business write and marked `ready` AFTER it succeeds.
 *
 * Crash windows:
 *   - crash before the business write: the intent stays `pending`; recovery
 *     checks the business document and skips it if the write never happened.
 *   - crash after the business write: recovery verifies the document and turns
 *     the intent into an outbox row.
 *   - crash after `ready`: the next worker invocation creates the outbox row.
 *
 * Intents contain a description of the event, never a sent message. The
 * outbox row is still the single source of truth for delivery.
 */

import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 160 },
    name: { type: String, default: '', trim: true, maxlength: 160 },
    role: { type: String, enum: ['student', 'company', 'admin'], required: true },
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

const emailIntentSchema = new mongoose.Schema(
  {
    intentId: { type: String, required: true, unique: true, maxlength: 100 },
    eventType: { type: String, required: true, maxlength: 80, index: true },
    templateId: { type: String, required: true, maxlength: 80 },

    recipient: { type: recipientSchema, required: true },
    related: { type: relatedSchema, default: () => ({}) },
    /** Template variables. Never contains a rendered body or provider secret. */
    data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    idempotencyKey: { type: String, required: true, unique: true, maxlength: 256 },

    /**
     * pending      created before the business write
     * ready        business write verified/committed; outbox row not yet made
     * dispatching  a worker is turning it into an outbox row
     * queued       the outbox row exists (or already existed)
     * skipped      deliberately not applicable / business write never happened
     * failed       permanent template or validation problem, needs attention
     */
    state: {
      type: String,
      enum: ['pending', 'ready', 'dispatching', 'queued', 'skipped', 'failed'],
      default: 'pending',
      index: true,
    },

    /**
     * How to prove the business write succeeded. Example:
     *   { kind: 'application-transition', id, eventId }
     * A missing verifier means the intent is self-contained (scheduled mail).
     */
    verify: { type: mongoose.Schema.Types.Mixed, default: null },

    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    lockedUntil: { type: Date, default: null },
    lockId: { type: String, default: '', maxlength: 80 },

    lastError: { type: lastErrorSchema, default: () => ({}) },
    committedAt: { type: Date, default: null },
    queuedAt: { type: Date, default: null },
    skippedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Worker claim order.
emailIntentSchema.index({ state: 1, nextAttemptAt: 1, createdAt: 1 });
// Stale dispatch-lease recovery.
emailIntentSchema.index({ state: 1, lockedUntil: 1 });

export const EmailIntent =
  mongoose.models.EmailIntent || mongoose.model('EmailIntent', emailIntentSchema);

export default EmailIntent;
