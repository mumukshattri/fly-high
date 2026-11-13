/**
 * tests/resume-fixture.test.js
 * ===========================================================================
 * END-TO-END: THE REAL UPLOADED PDF POPULATES THE STUDENT PROFILE
 * ===========================================================================
 *
 * Uses the actual `JOB_N_JOB_Test_Resume.pdf` a student uploaded, through the
 * real API, storage and MongoDB - not a stubbed parser. It proves the whole
 * chain: upload -> decode page content -> parse sections -> fill blank profile
 * fields -> review rejection removes an auto-filled value.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'test-resumes-fixture');

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_test_resume_fixture';
process.env.NODE_ENV = 'test';
process.env.RESUME_STORAGE_DIR = STORAGE_DIR;

const { rm } = await import('node:fs/promises');
const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const { Student } = await import('../server/models/index.js');

const RESUME_PDF = readFileSync(new URL('./fixtures/JOB_N_JOB_Test_Resume.pdf', import.meta.url));

let server;
let base;

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
      /* binary */
    }
    return { status: response.status, body: json, raw, headers: response.headers };
  }

  return {
    get: (pathName) => call('GET', pathName),
    patch: (pathName, body) => call('PATCH', pathName, body),
    capture(response) {
      const setCookie = response.headers.getSetCookie?.()?.[0];
      if (setCookie) cookie = setCookie.split(';')[0];
      return response;
    },
    async upload(buffer, fileName = 'JOB_N_JOB_Test_Resume.pdf') {
      const response = await fetch(`${base}/api/students/me/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/pdf',
          'x-file-name': encodeURIComponent(fileName),
          ...(cookie ? { cookie } : {}),
        },
        body: buffer,
      });
      const raw = await response.text();
      return { status: response.status, body: raw ? JSON.parse(raw) : null, raw };
    },
  };
}

/* The client above only exposes what these tests need, so registration is a
 * plain fetch that keeps the session cookie. */
async function newStudent(label) {
  const browser = client();
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.local`;

  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role: 'student',
      name: 'Aarav Sharma',
      email,
      password: 'studentpass123',
      rollNumber: '2023CSE0200',
      // Registration wants a CGPA; 0 is the "not known yet" value and is the
      // blank field the extraction is expected to fill.
      cgpa: 0,
    }),
  });

  const raw = await response.text();
  assert.equal(response.status, 201, raw);
  browser.capture(response);
  const body = raw ? JSON.parse(raw) : null;
  return { browser, email, user: body.user };
}

before(async () => {
  await rm(STORAGE_DIR, { recursive: true, force: true });

  const connection = await connectDatabase();
  await connection.db.dropDatabase();

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  await rm(STORAGE_DIR, { recursive: true, force: true });
});

describe('the real uploaded PDF', () => {
  test('is decoded, parsed and used to populate the blank profile automatically', async () => {
    const { browser, user } = await newStudent('fixture');

    const upload = await browser.upload(RESUME_PDF);
    assert.equal(upload.status, 201, upload.raw);
    assert.equal(upload.body.resume.hasText, true);
    assert.equal(upload.body.resume.fileName, 'JOB_N_JOB_Test_Resume.pdf');

    const extraction = upload.body.extraction.extract;
    assert.equal(extraction.education.degree, 'B.Tech');
    assert.equal(extraction.education.department, 'Computer Science and Engineering');
    assert.equal(extraction.education.cgpa, 8.4);
    assert.equal(extraction.education.graduationYear, 2027);
    assert.equal(extraction.education.university, 'SRM University, Delhi-NCR');
    assert.equal(extraction.contact.name, 'AARAV SHARMA');
    assert.equal(extraction.contact.email, 'aarav.sharma@example.com');
    assert.ok(extraction.skills.includes('Docker'));
    assert.equal(extraction.skills.includes('C'), false);
    assert.equal(extraction.skills.includes('R'), false);

    const profile = await browser.get('/api/students/me/profile');
    assert.equal(profile.status, 200);
    const student = profile.body.profile;

    // Education, straight from the PDF.
    assert.equal(student.degree, 'B.Tech');
    assert.equal(student.department, 'Computer Science and Engineering');
    assert.equal(student.branch, 'CSE');
    assert.equal(student.cgpa, 8.4);
    assert.equal(student.graduationYear, 2027);
    assert.equal(student.currentYear, 4);

    // Skills.
    for (const skill of [
      'Python',
      'Java',
      'JavaScript',
      'React',
      'Node.js',
      'MongoDB',
      'Docker',
    ]) {
      assert.ok(student.skills.includes(skill), `${skill} should be in the profile`);
    }
    assert.equal(student.skills.includes('C'), false);
    assert.equal(student.skills.includes('R'), false);

    // Lists.
    assert.deepEqual(
      student.projects.map((project) => project.title),
      [
        'Campus Recruitment Management Portal',
        'Task Tracker Web Application',
        'Containerized Notes API',
      ],
    );
    assert.equal(student.experiences.length, 1);
    assert.equal(student.experiences[0].role, 'Software Development Intern (Academic Simulation)');
    assert.equal(student.experiences[0].company, 'DemoTech Labs');
    assert.equal(student.certifications.length, 2);

    // The fill is recorded so the review step can undo it.
    const stored = await Student.findById(user.id).lean();
    assert.ok(stored.resumeExtract.applied.fields.includes('degree'));
    assert.ok(stored.resumeExtract.applied.projectTitles.length === 3);
    assert.equal(stored.resumeExtract.confirmedAt, '');
    assert.equal(
      existsSync(path.join(STORAGE_DIR, ...stored.resume.storedName.split('/'))),
      true,
    );
  });

  test('the review step can reject individual extracted values', async () => {
    const { browser, user } = await newStudent('reject');
    await browser.upload(RESUME_PDF);

    const confirm = await browser.patch('/api/students/me/resume/confirm', {
      rejected: {
        skills: ['Docker'],
        projectTitles: ['Containerized Notes API'],
        certificationNames: ['Introduction to Cloud Computing'],
      },
    });

    assert.equal(confirm.status, 200, confirm.raw);
    const profile = confirm.body.profile;

    assert.equal(profile.skills.includes('Docker'), false, 'the rejected skill is removed');
    assert.ok(profile.skills.includes('Python'), 'other skills stay');
    assert.deepEqual(
      profile.projects.map((project) => project.title),
      ['Campus Recruitment Management Portal', 'Task Tracker Web Application'],
    );
    assert.equal(profile.certifications.length, 1);
    assert.equal(profile.certifications[0].name, 'Python Programming Fundamentals');

    const stored = await Student.findById(user.id).lean();
    assert.ok(stored.resumeExtract.confirmedAt, 'the review is recorded');
  });
});
