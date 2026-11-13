/**
 * services/api.js
 * ===========================================================================
 * THE HTTP CLIENT
 * ===========================================================================
 *
 * One place that knows how to talk to the Job N Job backend:
 *
 *   - sends the session as an HttpOnly cookie (credentials: 'include'), so
 *     there is NO token in localStorage for a script to steal
 *   - parses JSON and turns HTTP errors into `ApiError` with a readable message
 *   - exposes a live-update subscriber (SSE in a long-running server, revision
 *     polling on serverless deployments such as Vercel)
 *   - exposes a raw-body file upload for resumes (no multipart dependency)
 *
 * If the browser cannot reach the API the error is normalised to status 0, so
 * the UI can say "the server is not running" instead of showing a blank page.
 */

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(message, status = 0, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Perform an API request.
 * @param {string} path - e.g. '/drives'
 * @param {{method?: string, body?: object}} options
 */
export async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      // The session cookie travels automatically; nothing to add here.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      'Cannot reach the Job N Job server. Start it with `npm run server` and try again.',
      0,
    );
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error || `Request failed (${response.status}).`,
      response.status,
      payload?.details,
    );
  }

  return payload;
}

export const api = {
  get: (path) => request(path),
  post: (path, body = {}) => request(path, { method: 'POST', body }),
  put: (path, body = {}) => request(path, { method: 'PUT', body }),
  patch: (path, body = {}) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

/**
 * Upload one file as the raw request body.
 *
 * We deliberately do NOT use FormData/multipart: the server validates the
 * bytes anyway, and a raw body keeps the API dependency-free on both sides.
 * The session cookie rides along exactly like every other request.
 */
export async function uploadFile(path, file) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name || 'resume'),
      },
      credentials: 'include',
      body: file,
    });
  } catch {
    throw new ApiError(
      'Cannot reach the Job N Job server. Start it with `npm run server` and try again.',
      0,
    );
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error || `Upload failed (${response.status}).`,
      response.status,
      payload?.details,
    );
  }

  return payload;
}

/** How often a serverless deployment is asked whether anything changed. */
const REALTIME_POLL_MS = 4000;

/**
 * Subscribe to live change notifications.
 *
 * Two transports, picked by the server so neither side has to be told which
 * platform it is running on:
 *
 *   - SSE (`/api/realtime/events`) for a long-running process - instant, and
 *     authenticated by the session cookie like every other request
 *   - polling (`/api/realtime/version`) on Vercel, where a function cannot keep
 *     a stream open. The endpoint returns a revision number that every
 *     `broadcast()` advances, so the browser refetches when it moves.
 *
 * If SSE closes for any reason the subscriber falls back to polling instead of
 * retrying forever, so live updates keep working on any deployment.
 *
 * @param {(event: {resource: string, action?: string}) => void} onChange
 * @param {{onStatus?: (connected: boolean) => void}} [options]
 * @returns {() => void} unsubscribe
 */
export function subscribeRealtime(onChange, { onStatus } = {}) {
  let closed = false;
  let source = null;
  let pollTimer = null;
  let lastRevision = null;
  let mode = 'sse';

  const notify = () => {
    try {
      onChange({ resource: 'all', action: 'refresh' });
    } catch {
      /* a throwing listener must not stop later notifications */
    }
  };

  const poll = async () => {
    if (closed || mode !== 'poll') return;

    try {
      const info = await request('/realtime/version');
      if (closed) return;
      if (lastRevision !== null && info.revision !== lastRevision) notify();
      lastRevision = info.revision;
      onStatus?.(true);
    } catch (error) {
      if (closed) return;
      onStatus?.(false);
      // Signed out: there is nothing to watch until the session returns.
      if (error?.status === 401) return;
    }

    if (!closed && mode === 'poll') pollTimer = setTimeout(poll, REALTIME_POLL_MS);
  };

  const startPolling = () => {
    if (closed || mode === 'poll') return;
    mode = 'poll';
    if (source) {
      source.close();
      source = null;
    }
    clearTimeout(pollTimer);
    poll();
  };

  const startSse = () => {
    if (closed) return;
    mode = 'sse';
    source = new EventSource(`${API_BASE}/realtime/events`, { withCredentials: true });

    source.addEventListener('ready', () => onStatus?.(true));

    source.addEventListener('change', (event) => {
      try {
        onChange(JSON.parse(event.data));
      } catch {
        /* ignore a malformed event rather than breaking the stream */
      }
    });

    source.addEventListener('error', () => {
      onStatus?.(false);
      // CONNECTING means the browser is already retrying; leave it alone.
      // CLOSED means it gave up - polling works on every deployment.
      if (source && source.readyState === EventSource.CLOSED) {
        source.close();
        source = null;
        startPolling();
      }
    });
  };

  (async () => {
    try {
      const info = await request('/realtime/version');
      if (closed) return;
      lastRevision = typeof info.revision === 'number' ? info.revision : null;
      if (info.transport === 'poll') startPolling();
      else startSse();
    } catch (error) {
      if (closed) return;
      if (error?.status === 401) {
        onStatus?.(false);
        return;
      }
      // A server without the version endpoint: keep the original SSE path.
      startSse();
    }
  })();

  /** A backgrounded tab resumes with an immediate check, not a stale wait. */
  const onVisible = () => {
    if (!closed && mode === 'poll' && document.visibilityState === 'visible') {
      clearTimeout(pollTimer);
      poll();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  return () => {
    closed = true;
    clearTimeout(pollTimer);
    if (source) source.close();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}
