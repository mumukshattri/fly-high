/**
 * tests/email-allowlist.test.js
 * ===========================================================================
 * WELCOME-ONLY EVENT ALLOWLIST
 * ===========================================================================
 * This file runs in its own process with a deliberately narrow allowlist. It
 * proves that the allowlist blocks intent creation, intent flushing, and the
 * outbox worker, while leaving historical non-welcome rows untouched.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_email_allowlist_test';
process.env.NODE_ENV = 'test';
process.env.EMAIL_ENABLED = 'true';
process.env.EMAIL_MODE = 'live';
process.env.RESEND_API_KEY = 're_test_key_not_real';
process.env.RESEND_FROM_EMAIL = 'JOB N JOB <notifications@test.local>';
process.env.EMAIL_APP_URL = 'https://portal.test';
process.env.EMAIL_INLINE_DISPATCH = 'false';
process.env.EMAIL_DRIVE_ANNOUNCEMENTS = 'false';
process.env.EMAIL_ALLOWED_EVENTS = 'student.welcome,company.welcome';

const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const {
  EmailOutbox,
  EmailIntent,
  Student,
  Company,
} = await import('../server/models/index.js');
const {
  commitEmailIntent,
  flushEmailIntents,
  prepareEmailIntent,
} = await import('../server/email/intents.js');
const { drainEmailOutbox } = await import('../server/email/worker.js');
const { setEmailTransportForTests, resetEmailTransportForTests } = await import(
  '../server/email/service.js'
);
const {
  companyWelcomeSpec,
  studentWelcomeSpec,
} = await import('../server/email/events.js');
const { ensureEmailIndexes } = await import('../server/email/indexes.js');

let sent = [];

before(async () => {
  const connection = await connectDatabase();
  await connection.db.dropDatabase();
  await ensureEmailIndexes();
  setEmailTransportForTests(async (payload) => {
    sent.push(payload);
    return { id: `allowlist-message-${sent.length}` };
  });
});

after(async () => {
  resetEmailTransportForTests();
  await disconnectDatabase();
});

beforeEach(async () => {
  await EmailOutbox.deleteMany({});
  await EmailIntent.deleteMany({});
  await Student.deleteMany({});
  await Company.deleteMany({});
  sent = [];
});

function blockedSpec(eventType, role = 'student') {
  return {
    eventType,
    templateId: 'student-welcome',
    recipient: {
      email: `${eventType.replace(/\W+/g, '-')}@test.local`,
      name: 'Blocked Event',
      role,
    },
    related: {},
    data: {},
    idempotencyKey: `${eventType}/${randomUUID()}`,
  };
}

async function student() {
  return Student.create({
    name: 'Allowlist Student',
    email: `allowlist-student-${randomUUID()}@test.local`,
    passwordHash: 'unused',
    emailNotifications: true,
  });
}

describe('welcome-only allowlist', () => {
  test('allows a student welcome intent to be queued and sent', async () => {
    const studentDoc = await student();
    const intent = await prepareEmailIntent(studentWelcomeSpec(studentDoc));
    assert.ok(intent);
    assert.equal(intent.eventType, 'student.welcome');

    const committed = await commitEmailIntent(intent);
    assert.equal(committed.queued, true);

    const drained = await drainEmailOutbox();
    assert.equal(drained.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Welcome to JOB N JOB/);
  });

  test('allows a recruiter/company welcome intent to be queued and sent', async () => {
    const company = await Company.create({
      name: 'Allowlist Recruiter',
      hrEmail: `allowlist-company-${randomUUID()}@test.local`,
      passwordHash: 'unused',
      emailNotifications: true,
    });
    const intent = await prepareEmailIntent(companyWelcomeSpec(company));
    assert.ok(intent);
    assert.equal(intent.eventType, 'company.welcome');

    const committed = await commitEmailIntent(intent);
    assert.equal(committed.queued, true);

    const drained = await drainEmailOutbox();
    assert.equal(drained.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /recruiter account is ready/i);
  });

  test('blocks admin new-company, application, and drive intents at creation', async () => {
    for (const eventType of [
      'admin.new-company',
      'application.submitted',
      'application.shortlisted',
      'application.rejected',
      'drive.published',
      'drive.closed',
      'drive.deadline',
      'drive.announcement',
    ]) {
      const role = eventType.startsWith('admin.') ? 'admin' : 'student';
      assert.equal(
        await prepareEmailIntent(blockedSpec(eventType, role)),
        null,
        `${eventType} must not create an intent`,
      );
    }
    assert.equal(await EmailIntent.countDocuments({}), 0);
  });

  test('a worker cannot claim a disallowed event and leaves it untouched', async () => {
    const studentDoc = await student();
    const row = await EmailOutbox.create({
      eventId: randomUUID(),
      idempotencyKey: `old-application/${randomUUID()}`,
      eventType: 'application.submitted',
      templateId: 'application-submitted',
      recipient: { email: studentDoc.email, name: studentDoc.name, role: 'student' },
      related: { student: studentDoc._id },
      subject: 'Old application email',
      html: '<p>Old application email</p>',
      text: 'Old application email',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1_000),
    });

    const drained = await drainEmailOutbox();
    assert.equal(drained.processed, 0);
    assert.equal(drained.sent, 0);
    assert.equal(sent.length, 0);

    const stored = await EmailOutbox.findById(row._id).lean();
    assert.equal(stored.status, 'pending');
    assert.equal(stored.attempts, 0);
    assert.equal(stored.lockId, '');
  });

  test('a ready disallowed intent is not flushed into the outbox', async () => {
    const studentDoc = await student();
    const intent = await EmailIntent.create({
      intentId: randomUUID(),
      eventType: 'application.submitted',
      templateId: 'application-submitted',
      recipient: { email: studentDoc.email, name: studentDoc.name, role: 'student' },
      related: { student: studentDoc._id },
      data: {},
      idempotencyKey: `old-intent/${randomUUID()}`,
      state: 'ready',
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1_000),
    });

    const flushed = await flushEmailIntents({ limit: 10, timeBudgetMs: 10_000 });
    assert.equal(flushed.processed, 0);
    assert.equal(flushed.queued, 0);
    assert.equal(await EmailOutbox.countDocuments({}), 0);

    const stored = await EmailIntent.findById(intent._id).lean();
    assert.equal(stored.state, 'ready');
    assert.equal(stored.attempts, 0);
    assert.equal(stored.lockId, '');

    // A stale disallowed dispatch lease is not recovered either; it remains
    // preserved until an operator expands the allowlist.
    const dispatching = await EmailIntent.create({
      intentId: randomUUID(),
      eventType: 'application.submitted',
      templateId: 'application-submitted',
      recipient: { email: studentDoc.email, name: studentDoc.name, role: 'student' },
      related: { student: studentDoc._id },
      data: {},
      idempotencyKey: `old-dispatching/${randomUUID()}`,
      state: 'dispatching',
      attempts: 1,
      lockId: 'old-lock',
      lockedUntil: new Date(Date.now() - 60_000),
    });
    await flushEmailIntents({ limit: 10, timeBudgetMs: 10_000 });
    const storedDispatching = await EmailIntent.findById(dispatching._id).lean();
    assert.equal(storedDispatching.state, 'dispatching');
    assert.equal(storedDispatching.lockId, 'old-lock');
    assert.equal(storedDispatching.attempts, 1);
  });
});
