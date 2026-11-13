/**
 * tests/origin.test.js
 * ===========================================================================
 * ORIGIN / CSRF GUARD REGRESSION TESTS (development configuration)
 * ===========================================================================
 *
 * The bug these tests pin down: a write request from a legitimate browser
 * origin was answered with 403 "Cross-site request blocked." because the guard
 * compared `Origin` against the Host header *after* the Vite dev proxy had
 * rewritten it to the upstream API address, and then only accepted four
 * hardcoded origins.
 *
 * No database is needed: every request here uses an intentionally invalid
 * registration body, so 400 means "the origin guard let it through" and 403
 * means "it was blocked". Nothing is written.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/app.js');

let server;
let base;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function register(origin, extraHeaders = {}) {
  return fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({}),
  });
}

/** 400 = the request reached the route (guard accepted the origin). */
function assertAccepted(response, origin) {
  assert.equal(response.status, 400, `expected origin ${origin} to be accepted`);
}

function assertBlocked(response, origin) {
  assert.equal(response.status, 403, `expected origin ${origin} to be blocked`);
}

/* --------------------------- accepted origins ---------------------------- */

test('accepts the Vite dev origin', async () => {
  const response = await register('http://localhost:5173');
  assertAccepted(response, 'http://localhost:5173');
});

test('accepts the 127.0.0.1 dev origin', async () => {
  const response = await register('http://127.0.0.1:5173');
  assertAccepted(response, 'http://127.0.0.1:5173');
});

test('accepts a dev server that fell back to another port', async () => {
  const response = await register('http://localhost:5174');
  assertAccepted(response, 'http://localhost:5174');
});

test('accepts the IPv6 loopback spelling', async () => {
  const response = await register('http://[::1]:5173');
  assertAccepted(response, 'http://[::1]:5173');
});

test('accepts a same-origin write (Origin matches the Host header)', async () => {
  const response = await register(new URL(base).origin);
  assertAccepted(response, new URL(base).origin);
});

test('accepts a proxy-forwarded host', async () => {
  const response = await register('https://portal.example.com', {
    'x-forwarded-host': 'portal.example.com',
  });
  assertAccepted(response, 'https://portal.example.com');
});

test('accepts a request with no Origin header (non-browser client)', async () => {
  const response = await register(null);
  assertAccepted(response, 'no origin');
});

/* --------------------------- rejected origins ---------------------------- */

test('rejects a foreign origin', async () => {
  const response = await register('https://evil.example');
  assertBlocked(response, 'https://evil.example');
  assert.equal((await response.json()).error, 'Cross-site request blocked.');
});

test('rejects a LAN origin', async () => {
  const response = await register('http://192.168.1.20:5173');
  assertBlocked(response, 'http://192.168.1.20:5173');
});

test('rejects a lookalike host that only starts with localhost', async () => {
  const response = await register('http://localhost.evil.example');
  assertBlocked(response, 'http://localhost.evil.example');
});

test('rejects an opaque origin', async () => {
  const response = await register('null');
  assertBlocked(response, 'null');
});

test('reads are never blocked by the write guard', async () => {
  const response = await fetch(`${base}/api/health`, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(response.status, 200);
});

/* ------------------------------- CORS ------------------------------------ */

test('answers preflight with credentials for an allowed origin', async () => {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'OPTIONS',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-allow-headers'), /x-file-name/i);
});

test('never echoes a foreign origin back', async () => {
  const response = await fetch(`${base}/api/health`, {
    headers: { origin: 'https://evil.example' },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});
