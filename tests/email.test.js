/**
 * tests/email.test.js
 * ===========================================================================
 * EMAIL OUTBOX, TEMPLATES, WORKER, WEBHOOK AND API INTEGRATION TESTS
 * ===========================================================================
 * No network call is made. `setEmailTransportForTests` replaces the Resend
 * transport before any worker drains a row.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_email_test';
process.env.NODE_ENV = 'test';
process.env.EMAIL_ENABLED = 'true';
process.env.EMAIL_MODE = 'live';
process.env.RESEND_API_KEY = 're_test_key_not_real';
process.env.RESEND_FROM_EMAIL = 'JOB N JOB <notifications@test.local>';
process.env.EMAIL_APP_URL = 'https://portal.test';
process.env.EMAIL_INLINE_DISPATCH = 'false';
process.env.EMAIL_DRIVE_ANNOUNCEMENTS = 'true';
process.env.EMAIL_ALLOWED_EVENTS = [
  'student.welcome',
  'company.welcome',
  'admin.new-company',
  'company.approved',
  'application.submitted',
  'application.new-applicant',
  'application.under-review',
  'application.shortlisted',
  'application.selected',
  'application.rejected',
  'drive.published',
  'drive.closed',
  'drive.deadline',
  'drive.announcement',
  'test.event',
].join(',');
process.env.EMAIL_MAX_ATTEMPTS = '3';
process.env.EMAIL_WORKER_SECRET = 'worker-test-secret';
process.env.RESEND_WEBHOOK_SECRET = 'whsec_test';
process.env.EMAIL_WORKER_RATE_LIMIT_MS = '0';
process.env.EMAIL_INTENT_GRACE_MS = '1';
process.env.EMAIL_FANOUT_BATCH_SIZE = '2';
process.env.EMAIL_FANOUT_MAX_BATCHES = '1';
process.env.EMAIL_FANOUT_COMPANY_DAILY_LIMIT = '2';
process.env.EMAIL_FANOUT_MAX_FAILURES = '2';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const mongoose = (await import('mongoose')).default;
const {
  EmailOutbox,
  EmailIntent,
  EmailFanoutJob,
  EmailWebhookEvent,
  Admin,
  Student,
  Company,
  Drive,
  Application,
  Notification,
} = await import('../server/models/index.js');
const { hashPassword } = await import('../server/password.js');
const { setEmailTransportForTests, resetEmailTransportForTests } = await import('../server/email/service.js');
const { drainEmailOutbox } = await import('../server/email/worker.js');
const {
  enqueueEmail,
  prepareEmailSpecs,
  queueApplicationStatus,
  queueStudentWelcome,
  studentWelcomeSpec,
} = await import('../server/email/events.js');
const {
  commitEmailIntent,
  flushEmailIntents,
  prepareEmailIntent,
  reconcileEmailIntents,
} = await import('../server/email/intents.js');
const {
  ensureDriveAnnouncementJob,
  processEmailFanoutJobs,
  reconcileDriveAnnouncementJobs,
} = await import('../server/email/fanout.js');
const {
  processPendingWebhookEvents,
  processWebhookEventsForEmail,
} = await import('../server/email/webhook-events.js');
const { emailIndexReport, ensureEmailIndexes } = await import('../server/email/indexes.js');
const { sanitizeErrorText } = await import('../server/email/log.js');
const { Webhook } = await import('standardwebhooks');
const { buildEmail } = await import('../server/email/templates.js');

let server;
let base;
let sent = [];
let nextFailure = null;

function client() {
  let cookie = '';
  async function call(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await response.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON */
    }
    return { status: response.status, body: json, raw, headers: response.headers };
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    capture(response) {
      const setCookie = response.headers.getSetCookie?.()?.[0];
      if (setCookie) cookie = setCookie.split(';')[0];
      return response;
    },
    setCookie(value) {
      cookie = value;
    },
    get cookie() {
      return cookie;
    },
  };
}

function futureDate(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function outboxRow(overrides = {}) {
  return EmailOutbox.create({
    eventId: randomUUID(),
    idempotencyKey: `test/${randomUUID()}`,
    eventType: 'test.event',
    templateId: 'student-welcome',
    recipient: { email: 'student@test.local', name: 'Test Student', role: 'student' },
    subject: 'Test subject',
    html: '<p>Test</p>',
    text: 'Test',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1000),
    ...overrides,
  });
}

async function testTransport(payload) {
  if (nextFailure) {
    const failure = nextFailure;
    nextFailure = null;
    throw failure;
  }
  sent.push(payload);
  return { id: `test-message-${sent.length}` };
}

async function waitFor(predicate, { timeoutMs = 5_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

function signedWebhook({ type, emailId, createdAt, svixId }) {
  const id = svixId || `evt_${randomUUID()}`;
  const body = JSON.stringify({
    type,
    created_at: createdAt || new Date().toISOString(),
    data: { email_id: emailId || '' },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = new Webhook(process.env.RESEND_WEBHOOK_SECRET).sign(
    id,
    new Date(timestamp * 1000),
    body,
  );
  return {
    id,
    body,
    send: () =>
      fetch(`${base}/api/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': id,
          'svix-timestamp': String(timestamp),
          'svix-signature': signature,
        },
        body,
      }),
  };
}

before(async () => {
  const connection = await connectDatabase();
  await connection.db.dropDatabase();
  await ensureEmailIndexes();
  await Admin.create({
    name: 'Email Test Admin',
    email: 'admin@email.test',
    passwordHash: await hashPassword('adminpass123'),
  });

  setEmailTransportForTests(testTransport);

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  resetEmailTransportForTests();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

beforeEach(async () => {
  await EmailOutbox.deleteMany({});
  await EmailIntent.deleteMany({});
  await EmailFanoutJob.deleteMany({});
  await EmailWebhookEvent.deleteMany({});
  setEmailTransportForTests(testTransport);
  sent = [];
  nextFailure = null;
});

describe('templates', () => {
  test('renders HTML and text with escaped user values and a CTA', () => {
    const message = buildEmail(
      'student-welcome',
      { studentName: '<img src=x onerror=alert(1)>' },
      'https://portal.test',
    );
    assert.match(message.subject, /Welcome to JOB N JOB/);
    assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(message.html, /<img src=x/);
    assert.match(message.html, /https:\/\/portal\.test\/student\/profile/);
    assert.match(message.text, /student\/profile/);
  });

  test('all public templates produce a subject, HTML and text fallback', () => {
    const templates = {
      'student-welcome': { studentName: 'A' },
      'company-welcome': { companyName: 'C' },
      'company-approved': { companyName: 'C' },
      'application-submitted': { studentName: 'A', companyName: 'C', role: 'Dev', appliedOn: '2026-01-01' },
      'new-application': { studentName: 'A', companyName: 'C', role: 'Dev', branch: 'CSE', cgpa: 8 },
      'application-shortlisted': { studentName: 'A', companyName: 'C', role: 'Dev' },
      'application-rejected': { studentName: 'A', companyName: 'C', role: 'Dev' },
      'application-status': { studentName: 'A', companyName: 'C', role: 'Dev', status: 'Under Review' },
      'drive-published': { role: 'Dev', location: 'Pune', package: '10 LPA', deadline: '2026-01-01' },
      'drive-announcement': { studentName: 'A', companyName: 'C', role: 'Dev', driveId: 'abc', deadline: '2026-01-01' },
      'drive-closed': { role: 'Dev' },
      'drive-deadline': { role: 'Dev', deadline: '2026-01-01', days: 3 },
      'admin-new-company': { companyName: 'C', hrEmail: 'hr@c.test' },
    };
    for (const [templateId, data] of Object.entries(templates)) {
      const message = buildEmail(templateId, data, 'https://portal.test');
      assert.ok(message.subject.length > 0, `${templateId} subject`);
      assert.ok(message.html.includes('<!doctype html>'), `${templateId} html`);
      assert.ok(message.text.length > 0, `${templateId} text`);
    }
  });

  test('rejects an unknown template', () => {
    assert.throws(() => buildEmail('does-not-exist', {}, 'https://portal.test'), /Unknown email template/);
  });
});

describe('outbox and registration integration', () => {
  test('registration succeeds and queues one welcome email without sending inline', async () => {
    const student = client();
    const created = student.capture(
      await student.post('/api/auth/register', {
        role: 'student',
        name: 'Email Test Student',
        email: `student-${randomUUID()}@test.local`,
        password: 'studentpass123',
        branch: 'CSE',
        semester: 7,
        cgpa: 8.2,
        skills: ['Node.js'],
      }),
    );
    assert.equal(created.status, 201);
    assert.equal(await Notification.countDocuments({ student: created.body.user.id }), 1);
    const rows = await EmailOutbox.find({ 'recipient.email': created.body.user.email }).lean();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eventType, 'student.welcome');
    assert.equal(rows[0].status, 'pending');
    assert.equal(sent.length, 0, 'inline dispatch is disabled in tests');
  });

  test('company registration queues both a recruiter welcome and an admin verification alert', async () => {
    const company = client();
    const email = `company-${randomUUID()}@test.local`;
    const created = company.capture(
      await company.post('/api/auth/register', {
        role: 'company',
        name: 'Email Test Corp',
        contactPerson: 'HR Lead',
        email,
        password: 'companypass123',
      }),
    );
    assert.equal(created.status, 201);
    const rows = await EmailOutbox.find({ 'related.company': created.body.user.id }).lean();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.eventType).sort(), ['admin.new-company', 'company.welcome']);
    const adminRow = rows.find((row) => row.recipient.role === 'admin');
    assert.equal(adminRow.recipient.email, 'admin@email.test');
  });

  test('duplicate enqueue is a no-op through the unique idempotency key', async () => {
    const student = await Student.create({
      name: 'Duplicate Student',
      email: `duplicate-${randomUUID()}@test.local`,
      passwordHash: 'unused',
    });
    await queueStudentWelcome(student);
    await queueStudentWelcome(student);
    assert.equal(await EmailOutbox.countDocuments({ related: { $exists: true } }), 1);
    assert.equal(await EmailOutbox.countDocuments({ eventType: 'student.welcome' }), 1);
  });

  test('admin approval queues exactly one approved email on false -> true', async () => {
    const admin = client();
    admin.capture(
      await admin.post('/api/auth/login', {
        email: 'admin@email.test',
        password: 'adminpass123',
        role: 'admin',
      }),
    );
    const company = await Company.create({
      name: 'Approval Corp',
      hrEmail: `approval-${randomUUID()}@test.local`,
      passwordHash: 'unused',
      verified: false,
    });

    const first = await admin.patch(`/api/admin/companies/${company._id}`, { verified: true });
    assert.equal(first.status, 200);
    const second = await admin.patch(`/api/admin/companies/${company._id}`, { verified: true });
    assert.equal(second.status, 200);

    const rows = await EmailOutbox.find({ eventType: 'company.approved' }).lean();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipient.email, company.hrEmail);
  });
});

describe('worker retries and leases', () => {
  test('a transient failure schedules a retry and a later drain sends once', async () => {
    const row = await outboxRow();
    nextFailure = Object.assign(new Error('provider unavailable'), {
      name: 'internal_server_error',
      statusCode: 503,
    });

    const first = await drainEmailOutbox();
    assert.equal(first.retried, 1);
    const retried = await EmailOutbox.findById(row._id).lean();
    assert.equal(retried.status, 'retry_scheduled');
    assert.equal(retried.attempts, 1);
    assert.ok(retried.nextAttemptAt.getTime() > Date.now());

    await EmailOutbox.updateOne({ _id: row._id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const second = await drainEmailOutbox();
    assert.equal(second.sent, 1);

    const sentRow = await EmailOutbox.findById(row._id).lean();
    assert.equal(sentRow.status, 'sent');
    assert.equal(sentRow.providerStatus, 'accepted');
    assert.ok(sentRow.providerMessageId.startsWith('test-message-'));
    assert.equal(sent.length, 1);
  });

  test('an invalid recipient becomes a permanent failure, not an infinite retry', async () => {
    const row = await outboxRow({
      recipient: { email: 'not-an-email', name: 'Bad', role: 'student' },
    });
    const result = await drainEmailOutbox();
    assert.equal(result.failed, 1);
    const failed = await EmailOutbox.findById(row._id).lean();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.attempts, 1);
    assert.equal(failed.lastError.code, 'invalid_recipient');
    assert.equal(sent.length, 0);
  });

  test('a stale processing lease is recovered and sent exactly once', async () => {
    const row = await outboxRow({
      status: 'processing',
      attempts: 1,
      lockId: 'dead-worker',
      lockedUntil: new Date(Date.now() - 60_000),
    });
    const result = await drainEmailOutbox();
    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
    const sentRow = await EmailOutbox.findById(row._id).lean();
    assert.equal(sentRow.status, 'sent');
  });

  test('concurrent workers cannot send the same row twice', async () => {
    const row = await outboxRow();
    const results = await Promise.all([drainEmailOutbox(), drainEmailOutbox()]);
    assert.equal(results.reduce((sum, item) => sum + item.sent, 0), 1);
    assert.equal(sent.length, 1);
    assert.equal((await EmailOutbox.findById(row._id).lean()).status, 'sent');
  });

  test('a drain honours the requested batch limit and leaves the rest queued', async () => {
    await outboxRow();
    await outboxRow();

    const result = await drainEmailOutbox({ limit: 1, timeBudgetMs: 10_000 });
    assert.equal(result.sent, 1);
    assert.equal(result.processed, 1);
    assert.equal(sent.length, 1);
    assert.equal(await EmailOutbox.countDocuments({ status: 'sent' }), 1);
    assert.equal(await EmailOutbox.countDocuments({ status: 'pending' }), 1);
  });
});

describe('application and drive events', () => {
  test('drive publication, application submission and shortlist queue the right emails', async () => {
    const admin = client();
    admin.capture(
      await admin.post('/api/auth/login', {
        email: 'admin@email.test',
        password: 'adminpass123',
        role: 'admin',
      }),
    );

    const company = client();
    const companyEmail = `flow-company-${randomUUID()}@test.local`;
    const companyCreated = company.capture(
      await company.post('/api/auth/register', {
        role: 'company',
        name: 'Flow Corp',
        contactPerson: 'Flow HR',
        email: companyEmail,
        password: 'companypass123',
      }),
    );
    assert.equal(companyCreated.status, 201);
    await admin.patch(`/api/admin/companies/${companyCreated.body.user.id}`, { verified: true });

    company.capture(
      await company.post('/api/auth/login', {
        email: companyEmail,
        password: 'companypass123',
        role: 'company',
      }),
    );
    const drive = await company.post('/api/drives', {
      role: 'Flow Developer',
      deadline: futureDate(20),
      minimumCGPA: 7,
      branches: ['CSE'],
      requiredSkills: ['Node.js'],
      package: '12 LPA',
      description: 'Build placement services.',
    });
    assert.equal(drive.status, 201);

    const student = client();
    const studentEmail = `flow-student-${randomUUID()}@test.local`;
    const studentCreated = student.capture(
      await student.post('/api/auth/register', {
        role: 'student',
        name: 'Flow Student',
        email: studentEmail,
        password: 'studentpass123',
        branch: 'CSE',
        semester: 7,
        cgpa: 8.4,
        skills: ['Node.js'],
      }),
    );
    assert.equal(studentCreated.status, 201);

    const application = await student.post('/api/applications', { driveId: drive.body.id });
    assert.equal(application.status, 201);

    const afterApply = await EmailOutbox.find({ 'related.drive': drive.body.id }).lean();
    const afterApplyTypes = afterApply.map((row) => row.eventType);
    assert.ok(afterApplyTypes.includes('drive.published'));
    assert.ok(afterApplyTypes.includes('application.submitted'));
    assert.ok(afterApplyTypes.includes('application.new-applicant'));

    const moved = await company.patch(`/api/applications/${application.body.id}`, { status: 'Shortlisted' });
    assert.equal(moved.status, 200);
    const shortlisted = await EmailOutbox.find({
      'related.application': application.body.id,
      eventType: 'application.shortlisted',
    }).lean();
    assert.equal(shortlisted.length, 1);

    const duplicate = await company.patch(`/api/applications/${application.body.id}`, { status: 'Shortlisted' });
    assert.equal(duplicate.status, 200);
    assert.equal(
      await EmailOutbox.countDocuments({
        'related.application': application.body.id,
        eventType: 'application.shortlisted',
      }),
      1,
    );
  });

  test('drive announcements only target eligible opted-in students and are idempotent', async () => {
    const company = client();
    const companyEmail = `announce-company-${randomUUID()}@test.local`;
    const companyCreated = company.capture(
      await company.post('/api/auth/register', {
        role: 'company',
        name: 'Announce Corp',
        contactPerson: 'Announce HR',
        email: companyEmail,
        password: 'companypass123',
      }),
    );
    assert.equal(companyCreated.status, 201);

    // Verify directly to keep this test focused on the announcement event.
    const admin = await Admin.findOne({ email: 'admin@email.test' });
    await Company.updateOne({ _id: companyCreated.body.user.id }, { $set: { verified: true } });
    assert.ok(admin);

    // The fan-out scans students in `_id` order. Earlier tests leave students
    // behind, so isolate this test's recipient population to keep the bounded
    // first batch deterministic.
    await Student.deleteMany({});

    const eligible = client();
    const eligibleEmail = `eligible-${randomUUID()}@test.local`;
    eligible.capture(
      await eligible.post('/api/auth/register', {
        role: 'student',
        name: 'Eligible Student',
        email: eligibleEmail,
        password: 'studentpass123',
        branch: 'CSE',
        cgpa: 8.5,
        skills: ['Node.js'],
      }),
    );
    const ineligible = client();
    const ineligibleEmail = `ineligible-${randomUUID()}@test.local`;
    ineligible.capture(
      await ineligible.post('/api/auth/register', {
        role: 'student',
        name: 'Ineligible Student',
        email: ineligibleEmail,
        password: 'studentpass123',
        branch: 'CSE',
        cgpa: 5,
        skills: ['Node.js'],
      }),
    );

    company.capture(
      await company.post('/api/auth/login', {
        email: companyEmail,
        password: 'companypass123',
        role: 'company',
      }),
    );
    const drive = await company.post('/api/drives', {
      role: 'Eligible Role',
      deadline: futureDate(20),
      minimumCGPA: 7,
      branches: ['CSE'],
      requiredSkills: ['Node.js'],
      description: 'Eligible announcement test.',
    });
    assert.equal(drive.status, 201);

    // Drive creation writes only the job; it must not enumerate students.
    assert.equal(
      await EmailOutbox.countDocuments({ 'related.drive': drive.body.id, eventType: 'drive.announcement' }),
      0,
    );
    assert.ok(
      await EmailFanoutJob.exists({ jobId: `drive-announcements/${drive.body.id}` }),
      'one durable fan-out job should exist',
    );

    // Drive creation only writes the job. The test runs one bounded fan-out
    // batch explicitly because inline dispatch is disabled in the suite.
    const fanout = await processEmailFanoutJobs({ limit: 5, timeBudgetMs: 10_000 });
    assert.ok(fanout.queued >= 1, 'the fan-out should queue the eligible student');

    const rows = await EmailOutbox.find({
      'related.drive': drive.body.id,
      eventType: 'drive.announcement',
    }).lean();
    assert.ok(rows.some((row) => row.recipient.email === eligibleEmail));
    assert.equal(rows.some((row) => row.recipient.email === ineligibleEmail), false);
  });
});

describe('API resilience', () => {
  test('email failure never removes the in-app notification or breaks registration', async () => {
    nextFailure = Object.assign(new Error('network down'), { name: 'network_error' });
    const student = client();
    const email = `resilient-${randomUUID()}@test.local`;
    const created = student.capture(
      await student.post('/api/auth/register', {
        role: 'student',
        name: 'Resilient Student',
        email,
        password: 'studentpass123',
        cgpa: 8,
      }),
    );
    assert.equal(created.status, 201);
    const drain = await drainEmailOutbox();
    assert.equal(drain.retried, 1);

    const notifications = await student.get('/api/notifications');
    assert.equal(notifications.status, 200);
    assert.equal(notifications.body.length, 1);
    assert.equal(notifications.body[0].title, 'Welcome to Job N Job');
  });

  test('the internal worker endpoint requires its secret', async () => {
    const anonymous = await fetch(`${base}/api/internal/email/worker`);
    assert.equal(anonymous.status, 401);

    const authorized = await fetch(`${base}/api/internal/email/worker`, {
      headers: { authorization: 'Bearer worker-test-secret' },
    });
    assert.equal(authorized.status, 200);
  });

  test('the Resend webhook rejects an invalid signature', async () => {
    const response = await fetch(`${base}/api/webhooks/resend`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'evt_test',
        'svix-timestamp': '1',
        'svix-signature': 'invalid',
      },
      body: JSON.stringify({ type: 'email.delivered', data: { email_id: 'test' } }),
    });
    assert.equal(response.status, 400);
  });

  test('an in-app notification failure does not undo registration', async () => {
    const originalCreate = Notification.create;
    Notification.create = async () => {
      throw Object.assign(new Error('notification store unavailable'), { name: 'MongoServerError' });
    };
    try {
      const student = client();
      const email = `notification-failure-${randomUUID()}@test.local`;
      const created = student.capture(
        await student.post('/api/auth/register', {
          role: 'student',
          name: 'Notification Failure Student',
          email,
          password: 'studentpass123',
          cgpa: 8,
        }),
      );
      assert.equal(created.status, 201);
      assert.ok(await Student.exists({ email }));
      assert.equal(await EmailOutbox.countDocuments({ 'recipient.email': email }), 1);
    } finally {
      Notification.create = originalCreate;
    }
  });

  test('an in-app notification failure does not undo an application submission', async () => {
    const company = client();
    const companyEmail = `notification-company-${randomUUID()}@test.local`;
    const companyCreated = company.capture(
      await company.post('/api/auth/register', {
        role: 'company',
        name: 'Notification Corp',
        contactPerson: 'Notification HR',
        email: companyEmail,
        password: 'companypass123',
      }),
    );
    assert.equal(companyCreated.status, 201);
    await Company.updateOne(
      { _id: companyCreated.body.user.id },
      { $set: { verified: true } },
    );
    company.capture(
      await company.post('/api/auth/login', {
        email: companyEmail,
        password: 'companypass123',
        role: 'company',
      }),
    );
    const drive = await company.post('/api/drives', {
      role: 'Notification Role',
      deadline: futureDate(20),
      minimumCGPA: 7,
      branches: ['CSE'],
      description: 'Notification resilience test.',
    });
    assert.equal(drive.status, 201);

    const student = client();
    const created = student.capture(
      await student.post('/api/auth/register', {
        role: 'student',
        name: 'Notification Applicant',
        email: `notification-applicant-${randomUUID()}@test.local`,
        password: 'studentpass123',
        branch: 'CSE',
        cgpa: 8,
      }),
    );
    assert.equal(created.status, 201);

    const originalCreate = Notification.create;
    Notification.create = async () => {
      throw Object.assign(new Error('notification store unavailable'), { name: 'MongoServerError' });
    };
    let application;
    try {
      application = await student.post('/api/applications', { driveId: drive.body.id });
    } finally {
      Notification.create = originalCreate;
    }

    assert.equal(application.status, 201);
    assert.ok(await Application.exists({ _id: application.body.id }));
    assert.equal(
      await EmailOutbox.countDocuments({
        'related.application': application.body.id,
        eventType: 'application.submitted',
      }),
      1,
    );
    assert.equal(
      await EmailOutbox.countDocuments({
        'related.application': application.body.id,
        eventType: 'application.new-applicant',
      }),
      1,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* REGRESSION TESTS FOR THE RELIABILITY AUDIT                                 */
/* -------------------------------------------------------------------------- */

async function backdateIntent(intent, { ageMs = 60_000, dueMs = 1_000 } = {}) {
  await EmailIntent.collection.updateOne(
    { _id: intent._id },
    {
      $set: {
        createdAt: new Date(Date.now() - ageMs),
        nextAttemptAt: new Date(Date.now() - dueMs),
      },
    },
  );
}

describe('indexes and safe logging', () => {
  test('all required unique and worker indexes exist', async () => {
    const report = await emailIndexReport();
    assert.equal(report.ok, true, `missing indexes: ${report.missing.join(', ')}`);
  });

  test('error text redacts addresses and provider secrets', () => {
    const text = sanitizeErrorText(
      'Delivery for student@test.local failed with re_abcdef123456 and Bearer abcdefghijklmnop',
    );
    assert.doesNotMatch(text, /student@test\.local/);
    assert.doesNotMatch(text, /re_abcdef123456/);
    assert.doesNotMatch(text, /Bearer abcdefghijklmnop/);
    assert.match(text, /\[email\]/);
    assert.match(text, /\[secret\]/);
  });
});

describe('durable email intents', () => {
  test('a pending intent is recovered after the business write commits', async () => {
    const studentId = new mongoose.Types.ObjectId();
    const email = `crash-window-${randomUUID()}@test.local`;
    const draft = { _id: studentId, name: 'Crash Window Student', email };
    const intent = await prepareEmailIntent(studentWelcomeSpec(draft, { studentId }));
    assert.equal(intent.state, 'pending');
    assert.equal(await EmailOutbox.countDocuments({ idempotencyKey: `student-welcome/${studentId}` }), 0);

    await Student.create({
      _id: studentId,
      name: draft.name,
      email,
      passwordHash: 'unused',
    });
    await backdateIntent(intent);

    const result = await reconcileEmailIntents({ limit: 10 });
    assert.ok(result.ready >= 1);

    const recovered = await EmailIntent.findById(intent._id).lean();
    assert.equal(recovered.state, 'queued');
    const row = await EmailOutbox.findOne({ idempotencyKey: `student-welcome/${studentId}` }).lean();
    assert.ok(row, 'the recovered intent must create an outbox row');
    assert.equal(row.eventType, 'student.welcome');
  });

  test('a pending intent whose business write never happened is skipped', async () => {
    const missingId = new mongoose.Types.ObjectId();
    const email = `never-created-${randomUUID()}@test.local`;
    const intent = await prepareEmailIntent(
      studentWelcomeSpec({ _id: missingId, name: 'Never Created', email }, { studentId: missingId }),
    );
    await backdateIntent(intent, { ageMs: 25 * 60 * 60 * 1000 });

    await reconcileEmailIntents({ limit: 10 });

    const abandoned = await EmailIntent.findById(intent._id).lean();
    assert.equal(abandoned.state, 'skipped');
    assert.equal(abandoned.lastError.code, 'business_state_not_confirmed');
    assert.equal(await EmailOutbox.countDocuments({ idempotencyKey: `student-welcome/${missingId}` }), 0);
  });

  test('an outbox write failure leaves a recoverable ready intent', async () => {
    const student = await Student.create({
      name: 'Outbox Failure Student',
      email: `outbox-failure-${randomUUID()}@test.local`,
      passwordHash: 'unused',
    });
    const intent = await prepareEmailIntent(studentWelcomeSpec(student));
    const originalCreate = EmailOutbox.create;
    EmailOutbox.create = async () => {
      throw Object.assign(new Error('outbox store unavailable'), { name: 'MongoServerError' });
    };
    try {
      const result = await commitEmailIntent(intent);
      assert.equal(result.queued, false);
      assert.equal(result.pending, true);
    } finally {
      EmailOutbox.create = originalCreate;
    }

    const ready = await EmailIntent.findById(intent._id).lean();
    assert.equal(ready.state, 'ready');
    assert.ok(ready.attempts >= 1);

    await EmailIntent.collection.updateOne(
      { _id: intent._id },
      { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
    );
    await flushEmailIntents({ limit: 10 });

    const queued = await EmailIntent.findById(intent._id).lean();
    assert.equal(queued.state, 'queued');
    assert.equal(
      await EmailOutbox.countDocuments({ idempotencyKey: `student-welcome/${student._id}` }),
      1,
    );
  });
});

describe('worker lease fencing', () => {
  test('a stale worker cannot overwrite a newer lock result', async () => {
    const row = await outboxRow();
    let releaseTransport;
    const blockedTransport = async () => {
      await new Promise((resolve) => {
        releaseTransport = resolve;
      });
      return { id: 'fenced-message' };
    };
    setEmailTransportForTests(blockedTransport);

    const drain = drainEmailOutbox({ limit: 1, timeBudgetMs: 5_000 });
    try {
      await waitFor(async () => {
        const current = await EmailOutbox.findById(row._id).lean();
        return current?.status === 'processing' && Boolean(current.lockId);
      });

      // Simulate lease expiry followed by a newer worker claiming the row.
      await EmailOutbox.updateOne(
        { _id: row._id },
        { $set: { lockId: 'newer-worker-lock', lockedUntil: new Date(Date.now() + 60_000) } },
      );

      releaseTransport();
      const result = await drain;
      const after = await EmailOutbox.findById(row._id).lean();
      assert.equal(result.sent, 0);
      assert.equal(result.leaseLost, 1);
      assert.equal(after.status, 'processing');
      assert.equal(after.lockId, 'newer-worker-lock');
    } finally {
      if (releaseTransport) releaseTransport();
      setEmailTransportForTests(testTransport);
    }
  });
});

describe('application status idempotency', () => {
  async function applicationFixture() {
    const student = await Student.create({
      name: 'Status Student',
      email: `status-student-${randomUUID()}@test.local`,
      passwordHash: 'unused',
      branch: 'CSE',
      cgpa: 8,
    });
    const company = await Company.create({
      name: 'Status Corp',
      hrEmail: `status-company-${randomUUID()}@test.local`,
      passwordHash: 'unused',
    });
    const drive = await Drive.create({
      company: company._id,
      role: 'Status Role',
      deadline: futureDate(20),
      minimumCGPA: 7,
      branches: ['CSE'],
      status: 'Open',
    });
    const date = new Date().toISOString().slice(0, 10);
    const application = await Application.create({
      drive: drive._id,
      student: student._id,
      status: 'Applied',
      appliedOn: date,
      lastUpdated: date,
      statusHistory: [{ status: 'Applied', date, eventId: randomUUID() }],
    });
    return { student, company, drive, application };
  }

  test('two legitimate transitions to the same status use different keys', async () => {
    const { student, company, drive, application } = await applicationFixture();
    await queueApplicationStatus({
      application,
      student,
      drive,
      company,
      status: 'Shortlisted',
      transitionId: 'transition-one',
    });
    await queueApplicationStatus({
      application,
      student,
      drive,
      company,
      status: 'Shortlisted',
      transitionId: 'transition-two',
    });

    const rows = await EmailOutbox.find({
      'related.application': application._id,
      eventType: 'application.shortlisted',
    }).lean();
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.idempotencyKey).sort(),
      [
        `application-status/${application._id}/transition-one`,
        `application-status/${application._id}/transition-two`,
      ].sort(),
    );
  });

  test('concurrent atomic status updates preserve both transition ids', async () => {
    const { student, company, drive, application } = await applicationFixture();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const date = new Date().toISOString().slice(0, 10);
    const update = (status, eventId) =>
      Application.findOneAndUpdate(
        { _id: application._id, status: { $ne: status } },
        {
          $set: { status, lastUpdated: date },
          $push: { statusHistory: { status, date, eventId } },
        },
        { new: true },
      );

    const [first, second] = await Promise.all([
      update('Shortlisted', firstId),
      update('Under Review', secondId),
    ]);
    assert.ok(first);
    assert.ok(second);

    const fresh = await Application.findById(application._id).lean();
    const eventIds = fresh.statusHistory.map((entry) => entry.eventId);
    assert.ok(eventIds.includes(firstId));
    assert.ok(eventIds.includes(secondId));

    await queueApplicationStatus({
      application: fresh,
      student,
      drive,
      company,
      status: 'Shortlisted',
      transitionId: firstId,
    });
    await queueApplicationStatus({
      application: fresh,
      student,
      drive,
      company,
      status: 'Under Review',
      transitionId: secondId,
    });
    assert.equal(
      await EmailOutbox.countDocuments({
        'related.application': application._id,
        eventType: { $in: ['application.shortlisted', 'application.under-review'] },
      }),
      2,
    );
  });
});

describe('webhook inbox and ordering', () => {
  test('accepts a valid signature and applies delivery once', async () => {
    const row = await outboxRow({
      status: 'sent',
      providerStatus: 'accepted',
      providerMessageId: 'msg-delivered',
      sentAt: new Date(),
    });
    const hook = signedWebhook({
      type: 'email.delivered',
      emailId: 'msg-delivered',
      createdAt: new Date().toISOString(),
    });
    const response = await hook.send();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);

    const updated = await EmailOutbox.findById(row._id).lean();
    assert.equal(updated.providerStatus, 'delivered');
    const event = await EmailWebhookEvent.findOne({ svixId: hook.id }).lean();
    assert.equal(event.status, 'processed');
  });

  test('a duplicate svix event is acknowledged without a second row', async () => {
    await outboxRow({
      status: 'sent',
      providerStatus: 'accepted',
      providerMessageId: 'msg-duplicate',
    });
    const hook = signedWebhook({
      type: 'email.delivered',
      emailId: 'msg-duplicate',
      createdAt: new Date().toISOString(),
    });
    assert.equal((await hook.send()).status, 200);
    const duplicate = await hook.send();
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(await EmailWebhookEvent.countDocuments({ svixId: hook.id }), 1);
  });

  test('an out-of-order or lower-rank webhook cannot regress provider status', async () => {
    const row = await outboxRow({
      status: 'sent',
      providerStatus: 'delivered',
      providerEventAt: new Date('2026-01-02T00:00:00Z'),
      providerMessageId: 'msg-ordered',
    });

    const delayed = signedWebhook({
      type: 'email.delivery_delayed',
      emailId: 'msg-ordered',
      createdAt: '2026-01-01T00:00:00Z',
    });
    assert.equal((await delayed.send()).status, 200);

    const accepted = signedWebhook({
      type: 'email.sent',
      emailId: 'msg-ordered',
      createdAt: '2026-01-03T00:00:00Z',
    });
    assert.equal((await accepted.send()).status, 200);

    const updated = await EmailOutbox.findById(row._id).lean();
    assert.equal(updated.providerStatus, 'delivered');
    const stale = await EmailWebhookEvent.findOne({ svixId: delayed.id }).lean();
    assert.equal(stale.status, 'processed');
    assert.equal(stale.lastError.code, 'stale_event');
  });

  test('an early webhook is retained until providerMessageId is stored', async () => {
    const row = await outboxRow({
      status: 'processing',
      providerMessageId: '',
      lockId: 'in-flight',
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const hook = signedWebhook({
      type: 'email.delivered',
      emailId: 'msg-early',
      createdAt: new Date().toISOString(),
    });
    const response = await hook.send();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pending, true);

    let event = await EmailWebhookEvent.findOne({ svixId: hook.id }).lean();
    assert.equal(event.status, 'pending');
    assert.equal(event.lastError.code, 'provider_message_not_found');

    await EmailOutbox.updateOne(
      { _id: row._id },
      {
        $set: {
          status: 'sent',
          providerMessageId: 'msg-early',
          providerStatus: 'accepted',
          sentAt: new Date(),
        },
      },
    );
    const applied = await processWebhookEventsForEmail('msg-early');
    assert.equal(applied.applied, 1);

    const updated = await EmailOutbox.findById(row._id).lean();
    assert.equal(updated.providerStatus, 'delivered');
    event = await EmailWebhookEvent.findOne({ svixId: hook.id }).lean();
    assert.equal(event.status, 'processed');
  });

  test('a failed outbox update stays pending and is retried by the worker', async () => {
    const row = await outboxRow({
      status: 'sent',
      providerStatus: 'accepted',
      providerMessageId: 'msg-retry',
    });
    const hook = signedWebhook({
      type: 'email.delivered',
      emailId: 'msg-retry',
      createdAt: new Date().toISOString(),
    });

    const originalUpdate = EmailOutbox.updateOne;
    EmailOutbox.updateOne = async () => {
      throw Object.assign(new Error('outbox store unavailable'), { name: 'MongoNetworkError' });
    };
    let response;
    try {
      response = await hook.send();
    } finally {
      EmailOutbox.updateOne = originalUpdate;
    }
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pending, true);

    let event = await EmailWebhookEvent.findOne({ svixId: hook.id }).lean();
    assert.equal(event.status, 'pending');

    await EmailWebhookEvent.collection.updateOne(
      { _id: event._id },
      { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
    );
    const drained = await processPendingWebhookEvents({ limit: 5, timeBudgetMs: 10_000 });
    assert.ok(drained.applied >= 1);

    const updated = await EmailOutbox.findById(row._id).lean();
    assert.equal(updated.providerStatus, 'delivered');
    event = await EmailWebhookEvent.findOne({ svixId: hook.id }).lean();
    assert.equal(event.status, 'processed');
  });
});

describe('bounded drive announcement fan-out', () => {
  async function fanoutFixture({ count = 5, maxRecipients = 3 } = {}) {
    // Keep the scan population deterministic: the fan-out walks all students,
    // not just the ones created by this test.
    await Student.deleteMany({});

    const company = await Company.create({
      name: 'Fanout Corp',
      hrEmail: `fanout-company-${randomUUID()}@test.local`,
      passwordHash: 'unused',
    });
    const drive = await Drive.create({
      company: company._id,
      role: 'Fanout Role',
      deadline: futureDate(20),
      minimumCGPA: 7,
      branches: ['CSE'],
      status: 'Open',
      announcementJobId: `drive-announcements/${randomUUID()}`,
    });
    await EmailFanoutJob.create({
      jobId: drive.announcementJobId,
      drive: drive._id,
      company: company._id,
      status: 'pending',
      maxRecipients,
      nextAttemptAt: new Date(Date.now() - 1000),
    });
    for (let index = 0; index < count; index += 1) {
      await Student.create({
        name: `Fanout Student ${index}`,
        email: `fanout-student-${index}-${randomUUID()}@test.local`,
        passwordHash: 'unused',
        branch: 'CSE',
        cgpa: 8,
        placementStatus: 'Active',
        emailNotifications: true,
        driveAnnouncements: true,
      });
    }
    return { company, drive };
  }

  test('processes small batches, honours the per-drive ceiling and is idempotent', async () => {
    const { drive } = await fanoutFixture({ count: 5, maxRecipients: 3 });

    const first = await processEmailFanoutJobs({ limit: 1, timeBudgetMs: 10_000 });
    assert.equal(first.queued, 2, 'the first batch is capped at EMAIL_FANOUT_BATCH_SIZE');
    assert.equal(
      await EmailOutbox.countDocuments({ 'related.drive': drive._id, eventType: 'drive.announcement' }),
      2,
    );

    // A released job respects its retry delay. Simulate the next cron tick.
    await EmailFanoutJob.updateOne(
      { jobId: drive.announcementJobId },
      { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
    );
    const second = await processEmailFanoutJobs({ limit: 1, timeBudgetMs: 10_000 });
    assert.equal(second.queued, 1, 'the per-drive recipient ceiling stops the next batch');
    assert.equal(
      await EmailOutbox.countDocuments({ 'related.drive': drive._id, eventType: 'drive.announcement' }),
      3,
    );

    const job = await EmailFanoutJob.findOne({ jobId: drive.announcementJobId }).lean();
    assert.equal(job.status, 'completed');
    assert.equal(job.stopReason, 'recipient_limit');

    const third = await processEmailFanoutJobs({ limit: 1, timeBudgetMs: 10_000 });
    assert.equal(third.queued, 0);
    assert.equal(
      await EmailOutbox.countDocuments({ 'related.drive': drive._id, eventType: 'drive.announcement' }),
      3,
    );
  });

  test('stops retrying after consecutive batch failures', async () => {
    const { drive } = await fanoutFixture({ count: 1, maxRecipients: 3 });
    const originalBulkWrite = EmailOutbox.bulkWrite;
    EmailOutbox.bulkWrite = async () => {
      throw Object.assign(new Error('temporary outbox outage'), { name: 'MongoNetworkError' });
    };

    try {
      const first = await processEmailFanoutJobs({ limit: 1, timeBudgetMs: 10_000 });
      assert.equal(first.pending, 1);
      let job = await EmailFanoutJob.findOne({ jobId: drive.announcementJobId }).lean();
      assert.equal(job.status, 'pending');
      assert.equal(job.failureCount, 1);

      await EmailFanoutJob.updateOne(
        { jobId: drive.announcementJobId },
        { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
      );
      const second = await processEmailFanoutJobs({ limit: 1, timeBudgetMs: 10_000 });
      assert.equal(second.failed, 1);
      job = await EmailFanoutJob.findOne({ jobId: drive.announcementJobId }).lean();
      assert.equal(job.status, 'failed');
      assert.equal(job.failureCount, 2);
      assert.equal(job.lastError.code, 'fanout_max_failures');
    } finally {
      EmailOutbox.bulkWrite = originalBulkWrite;
    }
  });

  test('rejects a new announcement job when the company daily quota is exhausted', async () => {
    const company = await Company.create({
      name: 'Quota Corp',
      hrEmail: `quota-company-${randomUUID()}@test.local`,
      passwordHash: 'unused',
    });

    for (let index = 0; index < 2; index += 1) {
      const drive = await Drive.create({
        company: company._id,
        role: `Quota Role ${index}`,
        deadline: futureDate(20),
        status: 'Open',
        announcementJobId: `drive-announcements/${randomUUID()}`,
      });
      await EmailFanoutJob.create({
        jobId: drive.announcementJobId,
        drive: drive._id,
        company: company._id,
        status: 'completed',
      });
    }

    const thirdDrive = await Drive.create({
      company: company._id,
      role: 'Quota Role 3',
      deadline: futureDate(20),
      status: 'Open',
      announcementJobId: `drive-announcements/${randomUUID()}`,
    });
    const job = await ensureDriveAnnouncementJob(thirdDrive, { company });
    assert.equal(job, null);
    assert.equal(await EmailFanoutJob.exists({ jobId: thirdDrive.announcementJobId }), null);
  });

  test('recreates a missing job from the durable handle on the drive', async () => {
    const company = await Company.create({
      name: 'Recovery Corp',
      hrEmail: `recovery-company-${randomUUID()}@test.local`,
      passwordHash: 'unused',
    });
    const drive = await Drive.create({
      company: company._id,
      role: 'Recovery Role',
      deadline: futureDate(20),
      status: 'Open',
      announcementJobId: `drive-announcements/${randomUUID()}`,
    });
    assert.equal(await EmailFanoutJob.exists({ jobId: drive.announcementJobId }), null);

    const result = await reconcileDriveAnnouncementJobs({ limit: 50 });
    assert.ok(result.created >= 1);
    assert.ok(await EmailFanoutJob.exists({ jobId: drive.announcementJobId }));
  });
});

describe('send-time preference checks', () => {
  test('a student who opts out after queueing is suppressed at send time', async () => {
    const student = await Student.create({
      name: 'Opt Out Student',
      email: `opt-out-${randomUUID()}@test.local`,
      passwordHash: 'unused',
      emailNotifications: true,
      driveAnnouncements: true,
    });
    const row = await outboxRow({
      eventType: 'student.welcome',
      related: { student: student._id },
    });
    await Student.updateOne({ _id: student._id }, { $set: { emailNotifications: false } });

    const result = await drainEmailOutbox();
    assert.equal(result.suppressed, 1);
    assert.equal(sent.length, 0);

    const updated = await EmailOutbox.findById(row._id).lean();
    assert.equal(updated.status, 'suppressed');
    assert.equal(updated.lastError.code, 'email_opted_out');
  });

  test('a student who disables drive announcements is suppressed at send time', async () => {
    const student = await Student.create({
      name: 'Announcement Opt Out',
      email: `announcement-opt-out-${randomUUID()}@test.local`,
      passwordHash: 'unused',
      emailNotifications: true,
      driveAnnouncements: true,
    });
    const row = await outboxRow({
      eventType: 'drive.announcement',
      related: { student: student._id },
    });
    await Student.updateOne({ _id: student._id }, { $set: { driveAnnouncements: false } });

    const result = await drainEmailOutbox();
    assert.equal(result.suppressed, 1);
    assert.equal(sent.length, 0);

    const updated = await EmailOutbox.findById(row._id).lean();
    assert.equal(updated.status, 'suppressed');
    assert.equal(updated.lastError.code, 'announcement_opted_out');
  });
});
