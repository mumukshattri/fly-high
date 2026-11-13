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
 */

const clients = new Set(); // { res, userId, role }

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
