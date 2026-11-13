/**
 * tests/origin-production.test.js
 * ===========================================================================
 * ORIGIN / CSRF GUARD REGRESSION TESTS (production configuration)
 * ===========================================================================
 *
 * Runs in its own process (the test command forces --test-concurrency=1), so
 * NODE_ENV and APP_ORIGIN can be set before server/config.js is imported.
 *
 * This file proves two things that the development suite cannot:
 *   1. a configured production origin works - including a value written with a
 *      trailing slash or as a comma-separated list of several deployments;
 *   2. the development loopback exemption does NOT leak into production.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.NODE_ENV = 'production';
// Deliberately sloppy, exactly as a human types it into a host's dashboard.
process.env.APP_ORIGIN = 'https://jobs.example.com/, https://www.jobs.example.com';

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

function register(origin) {
  return fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({}),
  });
}

test('accepts the configured origin even with a trailing slash in APP_ORIGIN', async () => {
  const response = await register('https://jobs.example.com');
  assert.equal(response.status, 400);
});

test('accepts the second origin of a comma-separated APP_ORIGIN', async () => {
  const response = await register('https://www.jobs.example.com');
  assert.equal(response.status, 400);
});

test('accepts the production SPA calling its own origin', async () => {
  const response = await register(new URL(base).origin);
  assert.equal(response.status, 400);
});

test('does not exempt loopback origins in production', async () => {
  const response = await register('http://localhost:5174');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Cross-site request blocked.');
});

test('rejects an unknown https origin in production', async () => {
  const response = await register('https://evil.example');
  assert.equal(response.status, 403);
});

test('never signs an unlisted origin into CORS in production', async () => {
  const response = await fetch(`${base}/api/health`, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
