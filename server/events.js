/**
 * server/events.js
 * ===========================================================================
 * REAL-TIME UPDATES (Server-Sent Events)
 * ===========================================================================
 *
 * SSE is used instead of WebSockets because the traffic is one-directional
 * ("something changed, refetch it") and SSE reconnects automatically in every
 * modern browser - no client library, no extra dependency.
 *
 * Security:
 *   - The stream is authenticated with the same HttpOnly session cookie as the
 *     rest of the API. EventSource sends cookies for a same-origin URL, so no
 *     token ever appears in a query string (where it would be logged).
 *   - Events carry NO personal data - only a resource name and an id. The
 *     browser then refetches through the REST API, which scopes the response to
 *     the caller. A leaked broadcast therefore reveals nothing.
 *   - Each connected client is tagged with its user, so we can avoid waking up
 *     every browser for an event that cannot concern it.
 *
 * SERVERLESS (VERCEL)
 * -------------------
 * A Vercel function cannot hold a stream open between invocations, so the same
 * notifications are also recorded as a monotonic revision in MongoDB. Browsers
 * poll `GET /api/realtime/version` (through the normal authenticated API) and
 * refetch when the number moves. The counter lives in the database the app
 * already uses, so every warm instance and every region sees the same value.
 * SSE remains the transport for a long-running process.
 */

import { RealtimeState } from './models/index.js';

const clients = new Set(); // { res, userId, role }

/** 'sse' for a normal server process, 'poll' when running on Vercel. */
export function realtimeTransport() {
  const explicit = String(process.env.REALTIME_TRANSPORT || '').trim().toLowerCase();
  if (explicit === 'poll' || explicit === 'sse') return explicit;
  return process.env.VERCEL ? 'poll' : 'sse';
}

/** Current global revision. 0 when nothing has been announced yet. */
export async function currentRevision() {
  try {
    const doc = await RealtimeState.findById('global').lean();
    return Number(doc?.revision) || 0;
  } catch {
    // A read must never make the realtime endpoint fail.
    return 0;
  }
}

/**
 * Advance the revision. Called for every broadcast, cannot be awaited by the
 * routes (they should not pay for it), so failures are swallowed: a missed
 * tick only means a client notices on the next change instead.
 */
async function bumpRevision() {
  try {
    await RealtimeState.findOneAndUpdate(
      { _id: 'global' },
      { $inc: { revision: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch {
    /* database unavailable: SSE clients still get the in-process event */
  }
}

export function addClient(res, user) {
  const client = { res, userId: String(user.id), role: user.role };
  clients.add(client);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      /* the close handler cleans up */
    }
  }, 25_000);

  // Never hold the process open just for the heartbeat.
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  const close = () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };

  res.on('close', close);
  res.on('error', close);

  return client;
}

/**
 * Broadcast a change notification.
 *
 * @param {string} resource - 'drives' | 'applications' | 'notifications' | 'students' | 'companies'
 * @param {object} meta     - non-sensitive context ({ action, driveId, studentId, ... })
 */
export function broadcast(resource, meta = {}) {
  const payload = `event: change\ndata: ${JSON.stringify({ resource, ...meta, at: Date.now() })}\n\n`;

  // Durable cursor for polling clients (serverless deployments).
  bumpRevision();

  for (const client of clients) {
    // A student's notification change is irrelevant to everyone else, and a
    // drive change is irrelevant to the company that did not post it. Filtering
    // here keeps the fan-out honest without sending any payload data.
    if (meta.studentId && client.role === 'student' && client.userId !== String(meta.studentId)) {
      continue;
    }

    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function connectionCount() {
  return clients.size;
}
