/**
 * tests/api.test.js
 * ===========================================================================
 * INTEGRATION TESTS - real Express app, real MongoDB, real cookies.
 * ===========================================================================
 *
 * These tests are not unit tests with stubs. They boot the same `createApp()`
 * factory that `server/index.js` uses, listen on an ephemeral port, and talk to
 * it over HTTP exactly like the browser does. Every assertion about data reads
 * it back out of MongoDB, so a passing run proves the database layer works.
 *
 * The database is a throwaway one (`jobnjob_test` by default) that is dropped
 * before the run, so your development data is never touched.
 *
 *   npm test
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/jobnjob_test npm test
 *
 * Requires MongoDB to be running. If it is not, the suite fails with a clear
 * message instead of pretending to pass.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

// Must be set BEFORE server/config.js is imported, because configuration is
// read at module load time.
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_test';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const { Admin } = await import('../server/models/index.js');
const { hashPassword } = await import('../server/password.js');

let server;
let base;
let connection;

/* ------------------------------ tiny helpers ------------------------------ */

/** A client with its own cookie jar, like a separate browser profile. */
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
      /* SSE streams and HTML are not JSON */
    }
    return { status: response.status, body: json, raw, headers: response.headers };
  }

  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    put: (path, body) => call('PUT', path, body),
    /** Remember the session cookie the server just set. */
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

/* --------------------------------- setup ---------------------------------- */

before(async () => {
  connection = await connectDatabase();
  await connection.db.dropDatabase(); // start from nothing, every run

  await Admin.create({
    name: 'Test Placement Officer',
    email: 'admin@test.local',
    passwordHash: await hashPassword('adminpass123'),
    designation: 'Placement Officer',
    college: 'Test Institute',
  });

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

/* ------------------------------- the suite -------------------------------- */

describe('health and access control', () => {
  test('health reports a live database', async () => {
    const { status, body } = await client().get('/api/health');
    assert.equal(status, 200);
    assert.equal(body.database, 'connected');
  });

  test('every data endpoint rejects an anonymous caller', async () => {
    const anonymous = client();
    for (const path of ['/api/students', '/api/drives', '/api/applications', '/api/notifications']) {
      const { status } = await anonymous.get(path);
      assert.equal(status, 401, `${path} should be 401 without a session`);
    }
  });

  test('the realtime stream rejects an anonymous caller', async () => {
    const { status } = await client().get('/api/realtime/events');
    assert.equal(status, 401);
  });
});

describe('registration and login', () => {
  const company = client();
  const student = client();

  test('a company registers unverified and cannot publish a drive yet', async () => {
    const created = company.capture(
      await company.post('/api/auth/register', {
        role: 'company',
        name: 'Integration Corp',
        contactPerson: 'HR Lead',
        email: 'hr@integration.test',
        password: 'companypass123',
        industry: 'Software',
        location: 'Pune',
      }),
    );

    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'company');
    assert.equal(created.body.user.verified, false);

    const drive = await company.post('/api/drives', {
      role: 'Backend Engineer',
      deadline: futureDate(),
      minimumCGPA: 7,
      branches: ['CSE'],
      requiredSkills: ['Node.js'],
    });
    assert.equal(drive.status, 403, 'unverified companies must be blocked');
    assert.match(drive.body.error, /verification/i);
  });

  test('a student registers and lands with an HttpOnly session cookie', async () => {
    const created = student.capture(
      await student.post('/api/auth/register', {
        role: 'student',
        name: 'Integration Student',
        email: 'student@integration.test',
        password: 'studentpass123',
        branch: 'CSE',
        semester: 7,
        cgpa: 8.4,
        rollNumber: 'INT-001',
        university: 'Test Institute',
      }),
    );

    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'student');

    const rawCookie = created.headers.getSetCookie()[0];
    assert.match(rawCookie, /HttpOnly/i, 'session cookie must be HttpOnly');
    assert.match(rawCookie, /SameSite=Lax/i);

    const me = await student.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'student@integration.test');
  });

  test('duplicate email is rejected with 409', async () => {
    const { status } = await client().post('/api/auth/register', {
      role: 'student',
      name: 'Someone Else',
      email: 'student@integration.test',
      password: 'whatever123',
      cgpa: 7,
    });
    assert.equal(status, 409);
  });

  test('a wrong password and a wrong role both fail with 401', async () => {
    const wrongPassword = await client().post('/api/auth/login', {
      email: 'student@integration.test',
      password: 'not-the-password',
      role: 'student',
    });
    assert.equal(wrongPassword.status, 401);

    const wrongRole = await client().post('/api/auth/login', {
      email: 'student@integration.test',
      password: 'studentpass123',
      role: 'admin',
    });
    assert.equal(wrongRole.status, 401);
  });
});

describe('company verification gate and the hiring pipeline', () => {
  const admin = client();
  const company = client();
  const student = client();
  const outsider = client();

  let driveId;
  let applicationId;

  test('the admin approves the company', async () => {
    const login = admin.capture(
      await admin.post('/api/auth/login', {
        email: 'admin@test.local',
        password: 'adminpass123',
        role: 'admin',
      }),
    );
    assert.equal(login.status, 200);

    const companies = await admin.get('/api/companies');
    const target = companies.body.find((row) => row.name === 'Integration Corp');
    assert.ok(target, 'the registered company should be visible');
    assert.equal(target.verified, false);

    const approved = await admin.patch(`/api/admin/companies/${target.id}`, { verified: true });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.verified, true);

    // Persisted, not just echoed back.
    const reread = await admin.get('/api/companies');
    assert.equal(
      reread.body.find((row) => row.id === target.id).verified,
      true,
      'verification must be stored in MongoDB',
    );
  });

  test('the verified company publishes a drive', async () => {
    company.capture(
      await company.post('/api/auth/login', {
        email: 'hr@integration.test',
        password: 'companypass123',
        role: 'company',
      }),
    );

    const created = await company.post('/api/drives', {
      role: 'Backend Engineer',
      deadline: futureDate(),
      minimumCGPA: 7,
      branches: ['CSE'],
      requiredSkills: ['Node.js'],
      package: '12 LPA',
      description: 'Build and maintain the placement platform APIs.',
    });

    assert.equal(created.status, 201);
    driveId = created.body.id;
    assert.equal(created.body.status, 'Open');
  });

  test('an ineligible student is blocked with a reason', async () => {
    const low = client();
    low.capture(
      await low.post('/api/auth/register', {
        role: 'student',
        name: 'Low CGPA Student',
        email: 'low@integration.test',
        password: 'lowpass123',
        branch: 'CSE',
        semester: 5,
        cgpa: 4.1,
        skills: ['Node.js'],
      }),
    );

    const attempt = await low.post('/api/applications', { driveId });
    assert.equal(attempt.status, 403);
    assert.match(attempt.body.error, /not eligible/i);
    assert.match(attempt.body.error, /CGPA/i);
  });

  test('an eligible student applies twice and the second is a conflict', async () => {
    student.capture(
      await student.post('/api/auth/login', {
        email: 'student@integration.test',
        password: 'studentpass123',
        role: 'student',
      }),
    );
    // Skills decide eligibility, so add what the drive asks for.
    const profile = await student.put('/api/students/profile', {
      skills: ['Node.js', 'MongoDB'],
      about: 'Backend-focused final year student.',
    });
    assert.equal(profile.status, 200);

    const created = await student.post('/api/applications', { driveId });
    assert.equal(created.status, 201);
    applicationId = created.body.id;
    assert.equal(created.body.status, 'Applied');

    const duplicate = await student.post('/api/applications', { driveId });
    assert.equal(duplicate.status, 409);
  });

  test('a student cannot move their own application forward', async () => {
    const { status } = await student.patch(`/api/applications/${applicationId}`, {
      status: 'Selected',
    });
    assert.equal(status, 403);
  });

  test('a student cannot reach admin endpoints', async () => {
    const stats = await student.get('/api/admin/statistics');
    assert.equal(stats.status, 403);
    const exportAttempt = await student.get('/api/admin/export');
    assert.equal(exportAttempt.status, 403);
  });

  test('the recruiter shortlists, and the student is notified', async () => {
    const before = await student.get('/api/notifications');
    const beforeCount = before.body.length;

    const moved = await company.patch(`/api/applications/${applicationId}`, {
      status: 'Shortlisted',
      note: 'Strong fundamentals, moving to the interview round.',
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.status, 'Shortlisted');

    const after = await student.get('/api/notifications');
    assert.equal(after.body.length, beforeCount + 1);
    assert.equal(after.body[0].title, 'Application Shortlisted');
    assert.match(after.body[0].message, /Integration Corp/);
  });

  test('another company cannot touch this application', async () => {
    outsider.capture(
      await outsider.post('/api/auth/register', {
        role: 'company',
        name: 'Rival Corp',
        email: 'hr@rival.test',
        password: 'rivalpass123',
      }),
    );

    const attempt = await outsider.patch(`/api/applications/${applicationId}`, {
      status: 'Rejected',
    });
    assert.equal(attempt.status, 403);
  });

  test('the admin statistics reflect the live database', async () => {
    const { status, body } = await admin.get('/api/admin/statistics');
    assert.equal(status, 200);
    assert.equal(body.totalStudents, 2);
    assert.equal(body.shortlisted, 1);
    assert.equal(body.totalApplications, 1);
  });
});

describe('realtime', () => {
  const student = client();
  const admin = client();
  const company = client();

  test('a status change reaches the student over SSE', async () => {
    student.capture(
      await student.post('/api/auth/login', {
        email: 'student@integration.test',
        password: 'studentpass123',
        role: 'student',
      }),
    );
    company.capture(
      await company.post('/api/auth/login', {
        email: 'hr@integration.test',
        password: 'companypass123',
        role: 'company',
      }),
    );

    const controller = new AbortController();
    const stream = await fetch(`${base}/api/realtime/events`, {
      headers: { cookie: student.cookie },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type') || '', /text\/event-stream/);

    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let received = '';

    const readUntil = (needle, timeoutMs = 5000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${needle}`)), timeoutMs);
        (async () => {
          try {
            while (!received.includes(needle)) {
              const { value, done } = await reader.read();
              if (done) break;
              received += decoder.decode(value, { stream: true });
            }
            clearTimeout(timer);
            resolve();
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        })();
      });

    await readUntil('ready');

    const applications = await company.get('/api/applications');
    const applicationId = applications.body[0].id;

    await company.patch(`/api/applications/${applicationId}`, { status: 'Selected' });
    await readUntil('status-changed');

    assert.match(received, /event: change/);

    controller.abort();
    admin.setCookie('');
  });

  test('the revision cursor advances so polling clients can detect changes', async () => {
    assert.equal((await client().get('/api/realtime/version')).status, 401);

    const before = await student.get('/api/realtime/version');
    assert.equal(before.status, 200);
    assert.equal(before.body.transport, 'sse', 'a normal server process uses SSE');
    assert.equal(typeof before.body.revision, 'number');

    const applications = await company.get('/api/applications');
    const applicationId = applications.body[0].id;
    const moved = await company.patch(`/api/applications/${applicationId}`, {
      status: 'Shortlisted',
      note: 'Moved for the interview round.',
    });
    assert.equal(moved.status, 200);

    // The broadcast advances the counter asynchronously.
    let revision = before.body.revision;
    for (let attempt = 0; attempt < 20 && revision === before.body.revision; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      revision = (await student.get('/api/realtime/version')).body.revision;
    }

    assert.ok(revision > before.body.revision, 'a status change moves the revision forward');
  });

  test('a Vercel deployment answers with the polling transport instead of a stream', async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';

    try {
      const info = await student.get('/api/realtime/version');
      assert.equal(info.status, 200);
      assert.equal(info.body.transport, 'poll');

      // EventSource must not be left hanging by a serverless invocation.
      const stream = await student.get('/api/realtime/events');
      assert.equal(stream.status, 204);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });
});

describe('external jobs (Adzuna)', () => {
  const student = client();
  const company = client();

  test('the endpoint requires a signed-in student', async () => {
    assert.equal((await client().get('/api/external-jobs')).status, 401);

    company.capture(
      await company.post('/api/auth/login', {
        email: 'hr@integration.test',
        password: 'companypass123',
        role: 'company',
      }),
    );
    const asRecruiter = await company.get('/api/external-jobs');
    assert.equal(asRecruiter.status, 403, 'only students may use external job search');

    student.capture(
      await student.post('/api/auth/login', {
        email: 'student@integration.test',
        password: 'studentpass123',
        role: 'student',
      }),
    );
  });

  test('bad query parameters are rejected before any provider call', async () => {
    for (const query of ['page=abc', 'page=0x1', 'category=../etc', 'sortBy=cheapest', 'sortBy=1']) {
      const response = await student.get(`/api/external-jobs?${query}`);
      assert.equal(response.status, 400, `${query} should be a 400`);
    }
  });

  // The "no credentials" shape is covered in tests/external-jobs-unconfigured
  // .test.js, which runs in its own process with the variables removed. That
  // keeps this file honest whether or not a real .env supplies credentials.
  test('the status endpoint exposes configuration state but no values', async () => {
    const { status, body } = await student.get('/api/external-jobs/status');

    assert.equal(status, 200);
    assert.equal(typeof body.configured, 'boolean');
    assert.ok(Array.isArray(body.missing));
    assert.equal(body.source.name, 'Adzuna');
    // Only these three keys exist: no credential value is ever echoed back.
    assert.deepEqual(Object.keys(body).sort(), ['configured', 'missing', 'source']);

    const serialized = JSON.stringify(body);
    for (const secret of [process.env.ADZUNA_APP_ID, process.env.ADZUNA_APP_KEY]) {
      if (secret) {
        assert.equal(serialized.includes(secret), false, 'a credential value must never be returned');
      }
    }
  });
});

describe('sessions', () => {
  test('"Keep me signed in" decides whether the cookie survives a browser restart', async () => {
    const persistent = client();
    const remembered = persistent.capture(
      await persistent.post('/api/auth/login', {
        email: 'student@integration.test',
        password: 'studentpass123',
        role: 'student',
        remember: true,
      }),
    );
    assert.equal(remembered.status, 200);
    assert.match(remembered.headers.getSetCookie()[0], /Expires=/i, 'remembered sessions persist');

    const temporary = client();
    const sessionOnly = temporary.capture(
      await temporary.post('/api/auth/login', {
        email: 'student@integration.test',
        password: 'studentpass123',
        role: 'student',
        remember: false,
      }),
    );
    assert.equal(sessionOnly.status, 200);
    const raw = sessionOnly.headers.getSetCookie()[0];
    assert.doesNotMatch(raw, /Expires=/i, 'unchecked means a browser-session cookie');
    assert.doesNotMatch(raw, /Max-Age=/i);
    assert.ok(temporary.cookie, 'but it still works for this browser session');
  });


  test('deleting the session row signs the user out', async () => {
    const student = client();
    student.capture(
      await student.post('/api/auth/login', {
        email: 'student@integration.test',
        password: 'studentpass123',
        role: 'student',
      }),
    );

    assert.equal((await student.get('/api/auth/me')).status, 200);

    await connection.db.collection('sessions').deleteMany({});

    const after = await student.get('/api/auth/me');
    assert.equal(after.status, 401, 'a revoked session must be rejected');
  });

  test('logging out revokes the session server-side', async () => {
    const student = client();
    student.capture(
      await student.post('/api/auth/login', {
        email: 'student@integration.test',
        password: 'studentpass123',
        role: 'student',
      }),
    );

    const stolen = student.cookie;
    const logout = await student.post('/api/auth/logout');
    assert.equal(logout.status, 200);
    assert.equal(logout.body.success, true);

    const replay = client();
    replay.setCookie(stolen);
    assert.equal((await replay.get('/api/auth/me')).status, 401);
  });
});
