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
 *   - exposes a Server-Sent Events subscriber for live updates
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

/**
 * Subscribe to server-sent change events.
 *
 * The stream is authenticated by the same session cookie as the REST API, so
 * no ticket is needed and no token ever appears in a URL.
 *
 * EventSource reconnects on its own while the connection is merely interrupted
 * (readyState CONNECTING). We only take over when it gives up (CLOSED), which
 * happens on a 401 or after the browser exhausts its retries.
 *
 * @param {(event: {resource: string, action?: string}) => void} onChange
 * @param {{onStatus?: (connected: boolean) => void}} [options]
 * @returns {() => void} unsubscribe
 */
export function subscribeRealtime(onChange, { onStatus } = {}) {
  let closed = false;
  let source = null;
  let timer = null;
  let backoff = 1500;

  const scheduleReconnect = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(connect, backoff);
    backoff = Math.min(Math.round(backoff * 1.7), 20000);
  };

  function connect() {
    if (closed) return;

    source = new EventSource(`${API_BASE}/realtime/events`, { withCredentials: true });

    source.addEventListener('ready', () => {
      backoff = 1500;
      onStatus?.(true);
    });

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
      if (source && source.readyState === EventSource.CLOSED) {
        source.close();
        source = null;
        scheduleReconnect();
      }
    });
  }

  connect();

  return () => {
    closed = true;
    clearTimeout(timer);
    if (source) source.close();
  };
}
