/**
 * server/models/application.js
 * ===========================================================================
 * APPLICATION (student -> drive)
 * ===========================================================================
 *
 * The compound unique index on (drive, student) is what actually prevents
 * double applications under concurrency. The API checks first so the user gets
 * a friendly message, but the database is the guarantee: two simultaneous
 * clicks cannot both insert.
 */

import mongoose from 'mongoose';

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    date: { type: String, required: true },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false },
);

const applicationSchema = new mongoose.Schema(
  {
    drive: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Drive',
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['Applied', 'Under Review', 'Shortlisted', 'Selected', 'Rejected'],
      default: 'Applied',
    },
    appliedOn: { type: String, required: true },
    lastUpdated: { type: String, required: true },
    recruiterNote: { type: String, default: '', maxlength: 500 },
    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true },
);

applicationSchema.index({ drive: 1, student: 1 }, { unique: true });

export const Application =
  mongoose.models.Application || mongoose.model('Application', applicationSchema);
export default Application;
