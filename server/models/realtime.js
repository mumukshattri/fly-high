/**
 * server/models/realtime.js
 * ===========================================================================
 * REALTIME REVISION CURSOR
 * ===========================================================================
 * Serverless deployments (Vercel) cannot keep an SSE connection open across
 * invocations, so browsers ask "has anything changed since revision N?".
 *
 * This is a single document, not a change log: `broadcast()` increments
 * `revision` atomically, and a client only needs to know whether the number it
 * last saw differs. The actual data is still fetched from the normal REST
 * endpoints, which scope every response to the signed-in user - the counter
 * carries no information about what changed or for whom.
 */

import mongoose from 'mongoose';

const realtimeSchema = new mongoose.Schema(
  {
    _id: { type: String },
    revision: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

export const RealtimeState =
  mongoose.models.RealtimeState || mongoose.model('RealtimeState', realtimeSchema);

export default RealtimeState;
