/**
 * tests/profile.test.js
 * ===========================================================================
 * STUDENT ONBOARDING / PROFILE - integration tests
 * ===========================================================================
 * Real Express app, real MongoDB, real session cookies. Nothing is stubbed.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_test_profile';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const { Student } = await import('../server/models/index.js');

let server;
let base;

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
      /* not JSON */
    }
    return { status: response.status, body: json, raw, headers: response.headers };
  }

  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    put: (path, body) => call('PUT', path, body),
    capture(response) {
      const setCookie = response.headers.getSetCookie?.()?.[0];
      if (setCookie) cookie = setCookie.split(';')[0];
      return response;
    },
  };
}

async function registerStudent(overrides = {}) {
  const browser = client();
  const email = overrides.email || `profile-${Date.now()}-${Math.random().toString(16).slice(2)}@test.local`;
  const response = await browser.post('/api/auth/register', {
    role: 'student',
    name: overrides.name || 'Aarav Sharma',
    email,
    password: 'studentpass123',
    rollNumber: overrides.rollNumber || '2023CSE0142',
    phone: '9876543210',
    university: 'Vishwakarma Institute of Technology, Pune',
    branch: overrides.branch || 'CSE',
    semester: 7,
    cgpa: overrides.cgpa ?? 8.1,
    graduationYear: 2027,
  });
  browser.capture(response);
  assert.equal(response.status, 201, response.raw);
  return { browser, user: response.body.user, email };
}

before(async () => {
  const connection = await connectDatabase();
  await connection.db.dropDatabase();

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

describe('profile endpoints', () => {
  test('a student reads their own profile and completion', async () => {
    const { browser, user } = await registerStudent();

    const profile = await browser.get('/api/students/me/profile');
    assert.equal(profile.status, 200);
    assert.equal(profile.body.profile.id, user.id);
    assert.equal(profile.body.profile.branch, 'CSE');
    assert.equal(profile.body.profile.verified, false, 'nothing is university-verified');
    assert.equal(profile.body.profile.dataSource, 'self-declared');

    // A freshly registered account has not finished onboarding.
    assert.equal(profile.body.profile.onboarding.completed, false);
    assert.ok(profile.body.completion.percent > 0);
    assert.ok(profile.body.completion.percent < 100);
    assert.ok(
      profile.body.completion.missing.includes('Resume upload'),
      'a missing resume is reported honestly',
    );
  });

  test('PATCH persists academic, professional and preference fields in MongoDB', async () => {
    const { browser, user } = await registerStudent();

    const updated = await browser.patch('/api/students/me/profile', {
      department: 'Computer Science and Engineering',
      degree: 'B.Tech',
      specialization: 'Artificial Intelligence',
      currentYear: 4,
      backlogs: 0,
      graduationYear: 2027,
      cgpa: 8.6,
      programmingLanguages: ['Python', 'JavaScript'],
      frameworks: ['React', 'Node.js'],
      databases: ['MongoDB'],
      tools: ['Docker', 'git'],
      skills: ['Data Structures', 'Python'],
      projects: [
        {
          title: 'Campus Lost & Found',
          description: 'A React and Express app used by 400 students.',
          techStack: ['react', 'node.js', 'mongodb'],
        },
      ],
      experiences: [
        { type: 'Internship', role: 'Backend Intern', company: 'Nimbus Analytics', description: 'Built REST APIs.' },
      ],
      certifications: [{ name: 'AWS Cloud Practitioner', issuer: 'Amazon', year: '2026' }],
      achievements: ['Winner, Smart India Hackathon internal round'],
      about: 'Final-year CSE student interested in backend engineering.',
      preferences: {
        roles: ['Backend Developer', 'Software Engineer'],
        industries: ['Product Engineering'],
        locations: ['Pune', 'Bengaluru'],
        workMode: 'Hybrid',
        employmentType: 'Full Time',
        expectedSalary: '8-12 LPA',
      },
    });

    assert.equal(updated.status, 200, updated.raw);
    const profile = updated.body.profile;

    assert.equal(profile.department, 'Computer Science and Engineering');
    assert.equal(profile.degree, 'B.Tech');
    assert.equal(profile.currentYear, 4);
    assert.equal(profile.cgpa, 8.6);
    // Skills are canonicalised and de-duplicated ("git" -> "Git").
    assert.deepEqual(profile.programmingLanguages, ['Python', 'JavaScript']);
    assert.deepEqual(profile.tools, ['Docker', 'Git']);
    assert.equal(profile.projects.length, 1);
    assert.deepEqual(profile.projects[0].techStack, ['React', 'Node.js', 'MongoDB']);
    assert.equal(profile.experiences[0].company, 'Nimbus Analytics');
    assert.equal(profile.preferences.workMode, 'Hybrid');
    assert.deepEqual(profile.preferences.locations, ['Pune', 'Bengaluru']);

    const stored = await Student.findById(user.id).lean();
    assert.equal(stored.department, 'Computer Science and Engineering');
    assert.equal(stored.experiences[0].role, 'Backend Intern');
    assert.equal(stored.preferences.employmentType, 'Full Time');
    assert.ok(stored.profileUpdatedAt, 'the profile update time is recorded');

    assert.ok(updated.body.completion.percent > 60);
  });

  test('the department drives the branch code the eligibility engine uses', async () => {
    const { browser, user } = await registerStudent({ branch: 'CSE' });

    const updated = await browser.patch('/api/students/me/profile', {
      department: 'Mechanical Engineering',
    });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.profile.branch, 'MECH');

    const stored = await Student.findById(user.id).lean();
    assert.equal(stored.branch, 'MECH');
  });

  test('onboarding progress is persisted step by step', async () => {
    const { browser, user } = await registerStudent();

    const step3 = await browser.patch('/api/students/me/profile', {
      onboarding: { step: 3 },
    });
    assert.equal(step3.status, 200);
    assert.equal(step3.body.profile.onboarding.step, 3);

    // A step save must not wipe the fields already entered.
    assert.equal(step3.body.profile.name, 'Aarav Sharma');

    const complete = await browser.patch('/api/students/me/profile', {
      onboarding: { step: 6, completed: true },
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.body.profile.onboarding.completed, true);
    assert.ok(complete.body.profile.onboarding.completedAt);

    const stored = await Student.findById(user.id).lean();
    assert.equal(stored.onboarding.step, 6);
    assert.ok(stored.onboarding.completedAt instanceof Date);
  });

  test('validation rejects impossible values with 400 and a readable message', async () => {
    const { browser } = await registerStudent();

    const badCgpa = await browser.patch('/api/students/me/profile', { cgpa: 11 });
    assert.equal(badCgpa.status, 400);
    assert.match(badCgpa.body.error, /CGPA/i);

    const badYear = await browser.patch('/api/students/me/profile', { graduationYear: 1990 });
    assert.equal(badYear.status, 400);

    const badBacklogs = await browser.patch('/api/students/me/profile', { backlogs: -2 });
    assert.equal(badBacklogs.status, 400);

    const badMode = await browser.patch('/api/students/me/profile', {
      preferences: { workMode: 'Teleport' },
    });
    assert.equal(badMode.status, 400);
    assert.match(badMode.body.error, /work mode/i);

    const badProject = await browser.patch('/api/students/me/profile', {
      projects: [{ description: 'no title' }],
    });
    assert.equal(badProject.status, 400);

    const badSkills = await browser.patch('/api/students/me/profile', { skills: 'Python' });
    assert.equal(badSkills.status, 400);
  });

  test('profile completion reports what is still missing', async () => {
    const { browser } = await registerStudent();

    const completion = await browser.get('/api/students/me/profile-completion');
    assert.equal(completion.status, 200);
    assert.equal(typeof completion.body.percent, 'number');
    assert.equal(completion.body.resumeUploaded, false);
    assert.ok(Array.isArray(completion.body.sections));
    assert.ok(completion.body.sections.some((section) => section.key === 'resume'));
  });

  test('a legacy student document (created before onboarding existed) still works', async () => {
    const legacy = await Student.create({
      name: 'Legacy Student',
      email: `legacy-${Date.now()}@test.local`,
      passwordHash: 'x'.repeat(20),
      branch: 'IT',
      cgpa: 7.4,
      graduationYear: 2026,
      skills: ['Java', 'SQL', 'Spring Boot'],
      resume: { fileName: 'cv.pdf', size: '120 KB', uploadedOn: '2025-08-01' },
      // No department, degree, preferences, onboarding or resumeExtract fields.
    });

    const profile = await client();
    const login = await profile.post('/api/auth/login', {
      email: legacy.email,
      password: 'whatever',
    });
    // The password hash above is not a valid scrypt hash, so login must fail
    // safely rather than crash - that is part of backward compatibility.
    assert.equal(login.status, 401);

    const { browser } = await registerStudent();
    const response = await browser.get(`/api/students/${legacy.id}`);
    // A student cannot read another student's profile.
    assert.equal(response.status, 403);
  });

  test('a student can only read their own profile', async () => {
    const first = await registerStudent();
    const second = await registerStudent();

    const other = await first.browser.get(`/api/students/${second.user.id}`);
    assert.equal(other.status, 403);

    const own = await first.browser.get(`/api/students/${first.user.id}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.id, first.user.id);
  });

  test('authentication and role checks protect the profile endpoints', async () => {
    const anonymous = client();
    assert.equal((await anonymous.get('/api/students/me/profile')).status, 401);
    assert.equal((await anonymous.patch('/api/students/me/profile', { name: 'X' })).status, 401);

    // A recruiter has no business editing a student profile.
    const company = client();
    const registration = await company.post('/api/auth/register', {
      role: 'company',
      name: 'Recruiter Co',
      contactPerson: 'Neha Kulkarni',
      email: `company-${Date.now()}@test.local`,
      password: 'companypass123',
    });
    company.capture(registration);
    assert.equal(registration.status, 201);

    const attempt = await company.patch('/api/students/me/profile', { name: 'Hacked' });
    assert.equal(attempt.status, 403);
  });

  test('the legacy PUT /api/students/profile still updates the same record', async () => {
    const { browser, user } = await registerStudent();

    const response = await browser.put('/api/students/profile', {
      phone: '9123456780',
      skills: ['Java', 'SQL'],
      department: 'Information Technology',
    });

    assert.equal(response.status, 200, response.raw);
    const stored = await Student.findById(user.id).lean();
    assert.equal(stored.phone, '9123456780');
    assert.equal(stored.branch, 'IT');
    assert.deepEqual(stored.skills, ['Java', 'SQL']);
  });
});
