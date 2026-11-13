/**
 * server/models/session.js
 * ===========================================================================
 * SERVER-SIDE SESSION
 * ===========================================================================
 *
 * The browser holds a random 32-byte token in an HttpOnly cookie. Only the
 * SHA-256 hash of that token is stored here, so a leaked database dump cannot
 * be replayed as a login.
 *
 * Sessions are server-managed rather than stateless JWTs for one reason:
 * logout and "revoke all sessions" have to actually work.
 *
 * `expiresAt` carries a TTL index, so MongoDB deletes dead sessions by itself.
 */

import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    role: {
      type: String,
      required: true,
      enum: ['student', 'company', 'admin'],
    },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export default Session;
