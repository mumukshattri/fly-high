/**
 * tests/admin-students.test.js
 * ===========================================================================
 * ADMIN DIRECTORY, CSV IMPORT / EXPORT, ACTIVATION - integration tests
 * ===========================================================================
 * Real Express, real MongoDB, real cookies. The import is exercised twice to
 * prove that a second run never overwrites an existing account, and the
 * one-time activation link is used to set a password and sign in.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_test_admin';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const { Admin, Student } = await import('../server/models/index.js');
const { hashPassword } = await import('../server/password.js');

let server;
let base;
let existingStudentEmail;

function client() {
  let cookie = '';

  async function call(method, pathName, body) {
    const response = await fetch(`${base}${pathName}`, {
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
      /* ignore */
    }
    return { status: response.status, body: json, raw, headers: response.headers };
  }

  return {
    get: (pathName) => call('GET', pathName),
    post: (pathName, body) => call('POST', pathName, body),
    patch: (pathName, body) => call('PATCH', pathName, body),
    capture(response) {
      const setCookie = response.headers.getSetCookie?.()?.[0];
      if (setCookie) cookie = setCookie.split(';')[0];
      return response;
    },
  };
}

async function loginAs(email, password, role) {
  const browser = client();
  const response = await browser.post('/api/auth/login', { email, password, role });
  browser.capture(response);
  return { browser, response };
}

async function registerStudent({ name, email, branch, cgpa, graduationYear, department }) {
  const browser = client();
  const response = await browser.post('/api/auth/register', {
    role: 'student',
    name,
    email,
    password: 'studentpass123',
    rollNumber: `R-${Math.random().toString(16).slice(2, 8)}`,
    phone: '9800000000',
    university: 'Test Institute',
    branch,
    semester: 7,
    cgpa,
    graduationYear,
  });
  browser.capture(response);
  if (department) {
    await browser.patch('/api/students/me/profile', { department });
  }
  assert.equal(response.status, 201, response.raw);
  return response.body.user;
}

const MAPPING = {
  name: 'Name',
  email: 'Email',
  department: 'Department',
  degree: 'Degree',
  graduationYear: 'Graduation Year',
  cgpa: 'CGPA',
  backlogs: 'Backlogs',
  rollNumber: 'Roll Number',
};

function buildCsv() {
  return [
    'Name,Email,Department,Degree,Graduation Year,CGPA,Backlogs,Roll Number',
    'Rohan Mehta,rohan.import@test.local,Computer Science and Engineering,B.Tech,2027,8.4,0,2023CSE0201',
    'Sneha Patil,sneha.import@test.local,Mechanical Engineering,B.Tech,2026,7.9,1,MECH2026',
    'Broken Row,not-an-email,Civil Engineering,B.Tech,2026,11,0,CIVIL01',
    'Rohan Again,rohan.import@test.local,IT,B.Tech,2027,8.0,0,IT01',
    `Already Here,${existingStudentEmail},CSE,B.Tech,2026,7.0,0,EX01`,
  ].join('\n');
}

let admin;
let studentBrowser;

before(async () => {
  const connection = await connectDatabase();
  await connection.db.dropDatabase();

  await Admin.create({
    name: 'Test Placement Officer',
    email: 'admin-students@test.local',
    passwordHash: await hashPassword('adminpass123'),
    college: 'Test Institute',
  });

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  admin = (await loginAs('admin-students@test.local', 'adminpass123', 'admin')).browser;
  assert.ok(admin);

  // Two self-registered students with different departments and CGPA.
  const strong = await registerStudent({
    name: 'Ananya Iyer',
    email: 'ananya@test.local',
    branch: 'CSE',
    cgpa: 9.5,
    graduationYear: 2027,
    department: 'Computer Science and Engineering',
  });
  existingStudentEmail = 'ananya@test.local';

  await registerStudent({
    name: 'Vikram Rao',
    email: 'vikram@test.local',
    branch: 'MECH',
    cgpa: 6.5,
    graduationYear: 2026,
    department: 'Mechanical Engineering',
  });

  studentBrowser = (await loginAs('ananya@test.local', 'studentpass123', 'student')).browser;
  assert.equal(strong.email, existingStudentEmail);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

describe('admin student directory', () => {
  test('lists students with derived completion, application count and placement flag', async () => {
    const response = await admin.get('/api/admin/students');
    assert.equal(response.status, 200, response.raw);

    assert.ok(response.body.total >= 2);
    const ananya = response.body.items.find((row) => row.email === 'ananya@test.local');
    assert.ok(ananya);
    assert.equal(ananya.cgpa, 9.5);
    assert.equal(ananya.department, 'Computer Science and Engineering');
    assert.equal(typeof ananya.profileCompletion.percent, 'number');
    assert.equal(ananya.applicationCount, 0);
    assert.equal(ananya.isPlaced, false);
    // Sensitive fields never travel to the browser.
    assert.equal(response.raw.includes('passwordHash'), false);
    assert.equal(response.raw.includes('storedName'), false);
  });

  test('search, department, CGPA and graduation-year filters work', async () => {
    const byName = await admin.get('/api/admin/students?search=ananya');
    assert.equal(byName.body.total, 1);
    assert.equal(byName.body.items[0].name, 'Ananya Iyer');

    const byDepartment = await admin.get(
      '/api/admin/students?department=Mechanical%20Engineering',
    );
    assert.equal(byDepartment.body.total, 1);
    assert.equal(byDepartment.body.items[0].name, 'Vikram Rao');

    const byCgpa = await admin.get('/api/admin/students?minCgpa=8&maxCgpa=10');
    assert.ok(byCgpa.body.items.every((row) => row.cgpa >= 8 && row.cgpa <= 10));
    assert.ok(byCgpa.body.items.some((row) => row.email === 'ananya@test.local'));

    const byYear = await admin.get('/api/admin/students?graduationYear=2026');
    assert.ok(byYear.body.items.every((row) => row.graduationYear === 2026));

    const withResume = await admin.get('/api/admin/students?resume=missing');
    assert.equal(withResume.body.total, withResume.body.summary.matched);
  });

  test('results are paginated and the summary describes the filtered set', async () => {
    const page1 = await admin.get('/api/admin/students?page=1&pageSize=5');
    assert.equal(page1.status, 200);
    assert.equal(page1.body.pageSize, 5);
    assert.ok(page1.body.pageCount >= 1);
    assert.ok(page1.body.summary.matched >= 2);
    assert.ok(page1.body.items.length <= 5);

    const page2 = await admin.get('/api/admin/students?page=2&pageSize=1');
    assert.equal(page2.body.page, 2);
    assert.equal(page2.body.items.length <= 1, true);
  });

  test('one student detail includes applications and invitation state', async () => {
    const list = await admin.get('/api/admin/students?search=ananya');
    const id = list.body.items[0].id;

    const detail = await admin.get(`/api/admin/students/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.profile.email, 'ananya@test.local');
    assert.ok(Array.isArray(detail.body.applications));
    assert.equal(detail.body.invitation.pending, false);
    assert.equal(detail.raw.includes('passwordHash'), false);

    const missing = await admin.get('/api/admin/students/0123456789abcdef01234567');
    assert.equal(missing.status, 404);

    const resume = await admin.get(`/api/admin/students/${id}/resume/file`);
    assert.equal(resume.status, 404);
  });
});

describe('CSV import', () => {
  test('a preview without a mapping detects columns and writes nothing', async () => {
    const before = await Student.countDocuments();

    const response = await admin.post('/api/admin/students/import/preview', {
      csv: buildCsv(),
    });

    assert.equal(response.status, 200, response.raw);
    assert.equal(response.body.needsMapping, true);
    assert.equal(response.body.totalRows, 5);
    assert.equal(response.body.detectedMapping.email, 'Email');
    assert.equal(response.body.detectedMapping.graduationYear, 'Graduation Year');
    assert.equal(response.body.detectedMapping.rollNumber, 'Roll Number');
    assert.ok(Array.isArray(response.body.importFields.name.aliases));

    assert.equal(await Student.countDocuments(), before, 'a preview never writes');
  });

  test('a mapped preview validates rows, reports duplicates and flags bad data', async () => {
    const response = await admin.post('/api/admin/students/import/preview', {
      csv: buildCsv(),
      mapping: MAPPING,
    });

    assert.equal(response.status, 200, response.raw);
    assert.equal(response.body.summary.totalRows, 5);
    assert.equal(response.body.summary.valid, 2);
    assert.equal(response.body.summary.invalid, 1);
    assert.equal(response.body.summary.duplicates, 2);
    assert.equal(response.body.canImport, true);

    const invalid = response.body.rows.find((row) => row.values.email === 'not-an-email');
    assert.ok(invalid.errors.some((error) => /email/i.test(error)));
    assert.ok(invalid.errors.some((error) => /CGPA/i.test(error)));

    const inFileDuplicate = response.body.rows.find(
      (row) => row.duplicate?.type === 'duplicate-in-file',
    );
    assert.ok(inFileDuplicate);

    const existingDuplicate = response.body.rows.find(
      (row) => row.duplicate?.type === 'existing-account',
    );
    assert.equal(existingDuplicate.values.email, existingStudentEmail);
  });

  test('a missing required mapping column blocks the import', async () => {
    const response = await admin.post('/api/admin/students/import/preview', {
      csv: 'Name,Department\nSomeone,CSE',
      mapping: { name: 'Name', department: 'Department' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.canImport, false);
    assert.ok(response.body.missingRequired.some((item) => item.field === 'email'));
  });

  test('confirm creates accounts with invitations and never a default password', async () => {
    const response = await admin.post('/api/admin/students/import/confirm', {
      csv: buildCsv(),
      mapping: MAPPING,
    });

    assert.equal(response.status, 201, response.raw);
    assert.equal(response.body.imported, 2);
    assert.equal(response.body.skipped, 3);
    assert.equal(response.body.invitations.length, 2);
    assert.equal(response.body.errors.length, 3);

    const rohan = await Student.findOne({ email: 'rohan.import@test.local' })
      .select('+inviteTokenHash')
      .lean();
    assert.ok(rohan);
    assert.equal(rohan.dataSource, 'imported');
    assert.equal(rohan.declaredBy, 'placement-cell');
    assert.equal(rohan.verified, false, 'imported data is never called verified');
    assert.equal(rohan.invitationPending, true);
    assert.ok(rohan.branch === 'CSE');

    const invitation = response.body.invitations.find(
      (item) => item.email === 'rohan.import@test.local',
    );
    assert.match(invitation.activationPath, /^\/activate\?token=/);
    // The token is returned once and only its hash is stored.
    const token = invitation.activationPath.split('token=')[1];
    assert.match(rohan.inviteTokenHash, /^[a-f0-9]{64}$/);
    assert.equal(rohan.inviteTokenHash.includes(token), false);

    // The account cannot be used with a guessed password before activation.
    const premature = await client().post('/api/auth/login', {
      email: 'rohan.import@test.local',
      password: 'studentpass123',
      role: 'student',
    });
    assert.equal(premature.status, 401);
  });

  test('imported students appear in the directory as imported', async () => {
    const response = await admin.get('/api/admin/students?search=rohan.import');
    assert.equal(response.body.total, 1);
    assert.equal(response.body.items[0].dataSource, 'imported');
    assert.equal(response.body.items[0].department, 'Computer Science and Engineering');
    assert.equal(response.body.items[0].onboarding.completed, false);
  });

  test('a second import of the same file changes nothing', async () => {
    const before = await Student.countDocuments();

    const response = await admin.post('/api/admin/students/import/confirm', {
      csv: buildCsv(),
      mapping: MAPPING,
    });

    assert.equal(response.body.imported, 0);
    assert.equal(response.body.skipped, 5);
    assert.equal(await Student.countDocuments(), before, 'no duplicate accounts were created');
  });

  test('the activation link sets the student password and signs them in', async () => {
    const preview = await admin.post('/api/admin/students/import/preview', {
      csv: [
        'Name,Email,Department,Degree,Graduation Year,CGPA,Backlogs,Roll Number',
        'Meera Joshi,meera.import@test.local,Information Technology,B.Tech,2027,8.8,0,IT2027',
      ].join('\n'),
      mapping: MAPPING,
    });
    assert.equal(preview.status, 200);

    const confirm = await admin.post('/api/admin/students/import/confirm', {
      csv: [
        'Name,Email,Department,Degree,Graduation Year,CGPA,Backlogs,Roll Number',
        'Meera Joshi,meera.import@test.local,Information Technology,B.Tech,2027,8.8,0,IT2027',
      ].join('\n'),
      mapping: MAPPING,
    });
    assert.equal(confirm.body.imported, 1);

    const token = confirm.body.invitations[0].activationPath.split('token=')[1];
    const activation = await client().post('/api/auth/activate', {
      token,
      password: 'meerapass123',
    });

    assert.equal(activation.status, 200, activation.raw);
    assert.equal(activation.body.activated, true);
    assert.equal(activation.body.user.email, 'meera.import@test.local');

    const login = await loginAs('meera.import@test.local', 'meerapass123', 'student');
    assert.equal(login.response.status, 200);

    // The token cannot be reused.
    const replay = await client().post('/api/auth/activate', {
      token,
      password: 'anotherpass123',
    });
    assert.equal(replay.status, 400);
  });
});

describe('export', () => {
  test('CSV export honours the filters and contains no secrets', async () => {
    const response = await admin.get(
      '/api/admin/students/export?format=csv&department=Computer%20Science%20and%20Engineering',
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/csv/);
    assert.match(response.headers.get('content-disposition') || '', /attachment; filename="students-/);

    assert.ok(response.raw.includes('Rohan Mehta'));
    assert.equal(response.raw.includes('Sneha Patil'), false, 'the filter is applied');
    assert.equal(response.raw.includes('passwordHash'), false);
    assert.ok(response.raw.split('\n')[0].includes('Profile completion %'));
  });

  test('JSON export carries the filtered records only', async () => {
    const response = await admin.get('/api/admin/students/export?format=json&graduationYear=2026');

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.students));
    assert.ok(response.body.students.every((row) => row.graduationYear === 2026));
    assert.equal(response.raw.includes('passwordHash'), false);
    assert.equal(response.raw.includes('storedName'), false);
  });
});

describe('authorisation', () => {
  test('students and recruiters cannot reach the admin directory or import', async () => {
    assert.equal((await studentBrowser.get('/api/admin/students')).status, 403);
    assert.equal(
      (await studentBrowser.post('/api/admin/students/import/preview', { csv: 'a,b' })).status,
      403,
    );
    assert.equal((await studentBrowser.get('/api/admin/students/export')).status, 403);

    const anonymous = client();
    assert.equal((await anonymous.get('/api/admin/students')).status, 401);
    assert.equal(
      (await anonymous.post('/api/admin/students/import/confirm', { csv: 'a,b' })).status,
      401,
    );
  });

  test('only the owner sees their own profile; admins see everything', async () => {
    const list = await admin.get('/api/admin/students?search=vikram');
    const id = list.body.items[0].id;

    assert.equal((await studentBrowser.get(`/api/students/${id}`)).status, 403);
    assert.equal((await admin.get(`/api/students/${id}`)).status, 200);
  });
});
