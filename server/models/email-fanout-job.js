/**
 * server/models/email-fanout-job.js
 * ===========================================================================
 * BOUNDED BACKGROUND FAN-OUT
 * ===========================================================================
 * Publishing a drive must not enumerate every student before responding. A
 * durable job is created instead and a worker advances a cursor through the
 * eligible students in small, bounded batches.
 *
 * The cursor is only advanced after a batch has been written, so a crash simply
 * replays the batch. Unique outbox idempotency keys make the replay harmless.
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

const emailFanoutJobSchema = new mongoose.Schema(
  {
    /** Deterministic: drive-announcements/<driveId>. One job per drive. */
    jobId: { type: String, required: true, unique: true, maxlength: 160 },
    type: {
      type: String,
      enum: ['drive-announcements'],
      default: 'drive-announcements',
      index: true,
    },
    drive: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Drive',
      required: true,
      index: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
    },

    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    /** Last student _id included in a completed batch. */
    cursor: { type: mongoose.Schema.Types.ObjectId, default: null },

    processed: { type: Number, default: 0, min: 0 },
    queued: { type: Number, default: 0, min: 0 },
    skipped: { type: Number, default: 0, min: 0 },

    /** Hard per-drive ceiling, independent of the batch size. */
    maxRecipients: { type: Number, default: 0, min: 0 },

    attempts: { type: Number, default: 0, min: 0 },
    /** Consecutive failed batches; reset after a successful batch. */
    failureCount: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    lockedUntil: { type: Date, default: null },
    lockId: { type: String, default: '', maxlength: 80 },

    stopReason: { type: String, default: '', maxlength: 80 },
    lastError: { type: lastErrorSchema, default: () => ({}) },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Worker claim order.
emailFanoutJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
// Stale lease recovery.
emailFanoutJobSchema.index({ status: 1, lockedUntil: 1 });

export const EmailFanoutJob =
  mongoose.models.EmailFanoutJob || mongoose.model('EmailFanoutJob', emailFanoutJobSchema);

export default EmailFanoutJob;
