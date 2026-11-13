/**
 * server/models/notification.js
 * ===========================================================================
 * IN-APP NOTIFICATION (always owned by exactly one student)
 * ===========================================================================
 *
 * Every notification has an owner. There is no such thing as a "broadcast"
 * notification here, which is why GET /api/notifications can always be scoped
 * to the signed-in student.
 */

import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['info', 'success', 'warning', 'danger'],
      default: 'info',
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, maxlength: 1000 },
    date: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ student: 1, date: -1, createdAt: -1 });

export const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export default Notification;
