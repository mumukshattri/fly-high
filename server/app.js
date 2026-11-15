/**
 * server/app.js
 * ===========================================================================
 * THE EXPRESS APPLICATION
 * ===========================================================================
 *
 * Exported as a factory so the tests can build an app without binding a port
 * and without any of the startup side effects in index.js.
 *
 * Middleware order matters:
 *   1. security headers   - always, including on errors
 *   2. CORS               - answers preflight and allows the session cookie
 *   3. JSON body parser   - with a size cap
 *   4. same-site guard    - rejects cross-origin writes (CSRF defence in depth)
 *   5. /api router
 *   6. static SPA         - with a history fallback
 *   7. error handler      - the single place that turns errors into JSON
 */

import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { isAllowedOrigin, IS_PRODUCTION, ROOT_DIR } from './config.js';
import { apiRouter } from './api.js';
import { HttpError } from './http.js';
import { emailWebhookHandler } from './email/webhook.js';
import { sanitizeErrorText } from './email/log.js';

const DIST_DIR = path.join(ROOT_DIR, 'dist');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function cors(req, res, next) {
  const origin = req.headers.origin;

  // Echo back only a known origin; never "*", because a wildcard and
  // credentials cannot coexist (the browser rejects that combination anyway).
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    // Required so the browser stores and sends the HttpOnly session cookie.
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  // X-File-Name carries the resume filename on the raw-body upload.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Every host this request was legitimately addressed to.
 *
 * `Host` is the direct one; `X-Forwarded-Host` is what a reverse proxy or
 * tunnel reports. Comparing only against `Host` is what broke writes behind
 * the Vite dev proxy, which rewrites Host to the upstream API address.
 */
function requestHosts(req) {
  const hosts = new Set();
  if (req.headers.host) hosts.add(String(req.headers.host).toLowerCase());
  const forwarded = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwarded) hosts.add(forwarded);
  return hosts;
}

/**
 * Reject cross-site writes.
 *
 * The session cookie is SameSite=Lax, which already stops it on cross-site
 * POSTs. This is the second lock on the same door: a write is accepted only
 * when its Origin is the origin the request was addressed to (directly or via
 * a proxy), an origin on the allow-list (APP_ORIGIN in production), or - in
 * development only - a loopback origin on any port.
 */
function sameSiteGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin fetch or a non-browser client

  let originHost = null;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    originHost = null; // malformed Origin: fall through to the allow-list
  }

  if (originHost && requestHosts(req).has(originHost)) return next();
  if (isAllowedOrigin(origin)) return next();

  console.warn(
    `[csrf] blocked ${req.method} ${req.path} from origin ${origin} ` +
      `(host ${req.headers.host || 'unknown'})`,
  );
  next(new HttpError(403, 'Cross-site request blocked.'));
}

/** Serve index.html for any non-API GET so React Router can own the URL. */
function serveSpa(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const indexFile = path.join(DIST_DIR, 'index.html');
  if (!existsSync(indexFile)) {
    res.status(404).json({
      error:
        'The API is running, but the frontend has not been built yet. Run `npm run build`, or use `npm run dev` for the Vite dev server.',
    });
    return undefined;
  }

  res.sendFile(indexFile);
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    res.end();
    return;
  }

  // Malformed JSON body from express.json()
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    res.status(400).json({ error: 'Request body must be valid JSON.' });
    return;
  }

  // body-parser refuses a body over the route's limit (resume upload, CSV import)
  if (error?.type === 'entity.too.large') {
    res.status(413).json({
      error:
        'That upload is too large. Resumes must be 5 MB or smaller and a CSV import 2 MB or smaller.',
    });
    return;
  }

  if (error?.name === 'ValidationError') {
    const first = Object.values(error.errors || {})[0];
    res.status(400).json({ error: first?.message || 'The submitted data is not valid.' });
    return;
  }

  if (error?.code === 11000) {
    res.status(409).json({ error: 'That record already exists.' });
    return;
  }

  const status = error instanceof HttpError ? error.status : error?.status || 500;
  if (status >= 500) {
    console.error('[api] unhandled', {
      name: String(error?.name || 'Error').slice(0, 80),
      message: sanitizeErrorText(error?.message || 'unknown error'),
    });
  }

  // An HttpError's message is written by us and is safe (and useful) to show;
  // an unexpected 5xx is masked so internals never leak.
  const isDeliberate = error instanceof HttpError;

  res.status(status).json({
    error: status >= 500 && !isDeliberate ? 'Something went wrong on the server.' : error.message,
    ...(error instanceof HttpError && error.details ? { details: error.details } : {}),
  });
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(cors);

  // CSV imports are the one place that legitimately posts more than a few
  // hundred kilobytes, so they get their own parser instead of raising the
  // limit for every endpoint. Exactly one parser sees each request.
  const importJson = express.json({ limit: '2mb' });
  app.use((req, res, next) => {
    if (
      req.path === '/api/admin/students/import/preview' ||
      req.path === '/api/admin/students/import/confirm'
    ) {
      importJson(req, res, next);
      return;
    }
    next();
  });

  // Resend signs the RAW request body, so this route must run before the JSON
  // parser. Signature verification is the authentication boundary.
  app.post(
    '/api/webhooks/resend',
    express.raw({ type: 'application/json', limit: '512kb' }),
    emailWebhookHandler,
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(sameSiteGuard);

  app.use('/api', apiRouter);

  app.use(express.static(DIST_DIR, { index: false, maxAge: 0 }));
  app.use(serveSpa);

  app.use(errorHandler);

  return app;
}

export { errorHandler, sameSiteGuard };
