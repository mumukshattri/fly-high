/**
 * tests/email-disabled.test.js
 * ===========================================================================
 * EMAIL_ENABLED=false IS A SAFE PAUSE
 * ===========================================================================
 * Turning email off must never delete queued work, mark it failed, consume a
 * retry attempt, or block a business operation. These tests run in their own
 * process because the email configuration is read once at import time.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_email_disabled_test';
process.env.NODE_ENV = 'test';
process.env.EMAIL_ENABLED = 'false';
process.env.EMAIL_MODE = 'live';
process.env.RESEND_API_KEY = 're_test_key_not_real';
process.env.RESEND_FROM_EMAIL = 'JOB N JOB <notifications@test.local>';
process.env.EMAIL_APP_URL = 'https://portal.test';
process.env.EMAIL_INLINE_DISPATCH = 'false';
process.env.EMAIL_DRIVE_ANNOUNCEMENTS = 'true';
process.env.EMAIL_ALLOWED_EVENTS = 'student.welcome,company.welcome';
process.env.EMAIL_WORKER_SECRET = 'worker-disabled-secret';
process.env.EMAIL_WORKER_RATE_LIMIT_MS = '0';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const mongoose = (await import('mongoose')).default;
const {
  EmailOutbox,
  EmailIntent,
  EmailFanoutJob,
  EmailWebhookEvent,
  Student,
} = await import('../server/models/index.js');
const { drainEmailOutbox } = await import('../server/email/worker.js');
const { flushEmailIntents } = await import('../server/email/intents.js');
const { processEmailFanoutJobs } = await import('../server/email/fanout.js');
const { sendEmail, setEmailTransportForTests } = await import('../server/email/service.js');

const WORKER_AUTH = { authorization: 'Bearer worker-disabled-secret' };

let server;
let base;

async function createPendingOutboxRow() {
  return EmailOutbox.create({
    eventId: randomUUID(),
    idempotencyKey: `disabled-test/${randomUUID()}`,
    eventType: 'student.welcome',
    templateId: 'student-welcome',
    recipient: { email: 'disabled-student@test.local', name: 'Disabled Student', role: 'student' },
    subject: 'Queued while disabled',
    html: '<p>Queued while disabled</p>',
    text: 'Queued while disabled',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1_000),
  });
}

async function createReadyIntent() {
  const studentId = new mongoose.Types.ObjectId();
  return EmailIntent.create({
    intentId: randomUUID(),
    eventType: 'student.welcome',
    templateId: 'student-welcome',
    recipient: { email: 'disabled-intent@test.local', name: 'Disabled Intent', role: 'student' },
    related: { student: studentId },
    data: { studentName: 'Disabled Intent' },
    idempotencyKey: `student-welcome/${studentId}`,
    state: 'ready',
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1_000),
  });
}

async function createPendingFanoutJob() {
  const driveId = new mongoose.Types.ObjectId();
  const jobId = `drive-announcements/${driveId}`;
  return EmailFanoutJob.create({
    jobId,
    drive: driveId,
    status: 'pending',
    maxRecipients: 10,
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1_000),
  });
}

before(async () => {
  const connection = await connectDatabase();
  await connection.db.dropDatabase();

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await EmailOutbox.deleteMany({});
  await EmailIntent.deleteMany({});
  await EmailFanoutJob.deleteMany({});
  await EmailWebhookEvent.deleteMany({});
  await Student.deleteMany({});
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

describe('disabled email subsystem', () => {
  test('queued outbox rows, ready intents and fan-out jobs are preserved untouched', async () => {
    const row = await createPendingOutboxRow();
    const intent = await createReadyIntent();
    const job = await createPendingFanoutJob();

    const email = await drainEmailOutbox();
    assert.equal(email.skipped, 'disabled');
    assert.equal(email.sent, 0);
    assert.equal(email.processed, 0);

    const intents = await flushEmailIntents();
    assert.equal(intents.skipped, 'disabled');
    assert.equal(intents.processed, 0);

    const fanout = await processEmailFanoutJobs();
    assert.equal(fanout.skipped, 'not_enabled');
    assert.equal(fanout.processed, 0);

    const storedRow = await EmailOutbox.findById(row._id).lean();
    assert.equal(storedRow.status, 'pending');
    assert.equal(storedRow.attempts, 0);
    assert.equal(storedRow.lockId, '');
    assert.equal(storedRow.lastError.code, '');

    const storedIntent = await EmailIntent.findById(intent._id).lean();
    assert.equal(storedIntent.state, 'ready');
    assert.equal(storedIntent.attempts, 0);
    assert.equal(storedIntent.lockId, '');

    const storedJob = await EmailFanoutJob.findById(job._id).lean();
    assert.equal(storedJob.status, 'pending');
    assert.equal(storedJob.attempts, 0);
    assert.equal(storedJob.lockId, '');
  });

  test('the provider boundary refuses to send without calling the transport', async () => {
    let called = false;
    setEmailTransportForTests(async () => {
      called = true;
      return { id: 'must-not-be-used' };
    });

    const result = await sendEmail({
      to: 'disabled-student@test.local',
      subject: 'Should not send',
      html: '<p>No</p>',
      text: 'No',
      idempotencyKey: `disabled/${randomUUID()}`,
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, 'not_configured');
    assert.equal(called, false);
  });

  test('the authenticated worker reports disabled and leaves the queue intact', async () => {
    const row = await createPendingOutboxRow();

    const response = await fetch(`${base}/api/internal/email/worker`, {
      headers: WORKER_AUTH,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      skipped: 'disabled',
      queuedPreserved: true,
    });

    const storedRow = await EmailOutbox.findById(row._id).lean();
    assert.equal(storedRow.status, 'pending');
    assert.equal(storedRow.attempts, 0);
  });

  test('the worker endpoint still rejects an unauthenticated caller', async () => {
    const response = await fetch(`${base}/api/internal/email/worker`, {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    assert.equal(response.status, 401);
  });

  test('registration still succeeds and writes no email work while disabled', async () => {
    const email = `disabled-register-${randomUUID()}@test.local`;
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'student',
        name: 'Disabled Mode Student',
        email,
        password: 'studentpass123',
        cgpa: 8,
      }),
    });

    assert.equal(response.status, 201);
    assert.ok(await Student.exists({ email }));
    assert.equal(await EmailOutbox.countDocuments({}), 0);
    assert.equal(await EmailIntent.countDocuments({}), 0);
  });
});
