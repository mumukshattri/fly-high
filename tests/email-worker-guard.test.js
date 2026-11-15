/**
 * tests/email-worker-guard.test.js
 * ===========================================================================
 * AUTHENTICATED WORKER ABUSE PROTECTION
 * ===========================================================================
 * The worker endpoint is a privileged, potentially expensive route. It must
 * reject unauthenticated callers, require the bearer secret, and refuse rapid
 * repeated invocations. This file uses a short rate-limit window so the test is
 * fast; the production default is one second.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_email_guard_test';
process.env.NODE_ENV = 'test';
process.env.EMAIL_ENABLED = 'true';
process.env.EMAIL_MODE = 'live';
process.env.RESEND_API_KEY = 're_test_key_not_real';
process.env.RESEND_FROM_EMAIL = 'JOB N JOB <notifications@test.local>';
process.env.EMAIL_APP_URL = 'https://portal.test';
process.env.EMAIL_INLINE_DISPATCH = 'false';
process.env.EMAIL_DRIVE_ANNOUNCEMENTS = 'false';
process.env.EMAIL_ALLOWED_EVENTS = 'student.welcome,company.welcome';
process.env.EMAIL_WORKER_SECRET = 'guard-test-secret';
process.env.EMAIL_WORKER_RATE_LIMIT_MS = '400';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const { ensureEmailIndexes } = await import('../server/email/indexes.js');

const AUTH = { authorization: 'Bearer guard-test-secret' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server;
let base;

before(async () => {
  const connection = await connectDatabase();
  await connection.db.dropDatabase();
  await ensureEmailIndexes();

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

describe('worker endpoint guard', () => {
  test('rejects an unauthenticated caller before doing any work', async () => {
    const response = await fetch(`${base}/api/internal/email/worker?task=diagnostics`);
    assert.equal(response.status, 401);
  });

  test('accepts the bearer secret, then rate-limits a rapid repeat', async () => {
    const first = await fetch(`${base}/api/internal/email/worker?task=diagnostics`, {
      headers: AUTH,
    });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.ok, true);
    assert.equal(body.indexes.ok, true);

    const second = await fetch(`${base}/api/internal/email/worker?task=diagnostics`, {
      headers: AUTH,
    });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get('retry-after')) >= 1);

    await sleep(700);
    const third = await fetch(`${base}/api/internal/email/worker?task=diagnostics`, {
      headers: AUTH,
    });
    assert.equal(third.status, 200);
  });
});
