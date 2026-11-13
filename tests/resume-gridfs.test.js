/**
 * tests/resume-gridfs.test.js
 * ===========================================================================
 * RESUME STORAGE IN MONGODB GRIDFS (the Vercel backend)
 * ===========================================================================
 * Vercel's filesystem is read-only apart from /tmp, so the server stores resume
 * bytes in a GridFS bucket on the same MongoDB connection when
 * RESUME_STORAGE_DRIVER=gridfs (or when it detects VERCEL).
 *
 * These tests exercise the real routes: upload, extraction, download bytes,
 * replacement, re-parse and deletion, with no filesystem involved.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_test_resume_gridfs';
process.env.NODE_ENV = 'test';
process.env.RESUME_STORAGE_DRIVER = 'gridfs';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const { Student } = await import('../server/models/index.js');
const mongoose = (await import('../server/db.js')).default;

let server;
let base;

/** Same uncompressed-content-stream PDF used by the other resume tests. */
function makePdf(lines) {
  const content = [
    'BT /F1 12 Tf 72 720 Td',
    ...lines.flatMap((line, index) =>
      index === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`],
    ),
    'ET',
  ].join('\n');

  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Catalog /Pages 2 0 R >>',
      'endobj',
      '2 0 obj',
      '<< /Type /Pages /Kids [] /Count 0 >>',
      'endobj',
      '3 0 obj',
      '<< /Length ' + content.length + ' >>',
      'stream',
      content,
      'endstream',
      'endobj',
      'trailer',
      '<< /Root 1 0 R >>',
      '%%EOF',
    ].join('\n'),
    'latin1',
  );
}

const RESUME_PDF = makePdf([
  'Priya Nair',
  'B.Tech Computer Science and Engineering',
  'CGPA: 8.4/10',
  'Graduating 2027',
  'Skills: Python, React, Node.js, SQL, Docker',
  'Projects',
  'Smart Attendance System | React, Node.js, MongoDB',
]);

function client() {
  let cookie = '';

  async function call(method, pathName, body) {
    const response = await fetch(`${base}${pathName}`, {
      method,
      headers: {
        ...(body && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: Buffer.isBuffer(body) || body === undefined ? body : JSON.stringify(body),
    });

    const raw = await response.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* binary or non-JSON */
    }
    return { status: response.status, body: json, raw, headers: response.headers };
  }

  return {
    get: (pathName) => call('GET', pathName),
    post: (pathName, body) => call('POST', pathName, body),
    delete: (pathName) => call('DELETE', pathName),
    capture(response) {
      const setCookie = response.headers.getSetCookie?.()?.[0];
      if (setCookie) cookie = setCookie.split(';')[0];
      return response;
    },
    async upload(buffer, { fileName = 'resume.pdf', mimeType = 'application/pdf' } = {}) {
      const response = await fetch(`${base}/api/students/me/resume`, {
        method: 'POST',
        headers: {
          'content-type': mimeType,
          'x-file-name': encodeURIComponent(fileName),
          ...(cookie ? { cookie } : {}),
        },
        body: buffer,
      });
      const raw = await response.text();
      let json = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        /* ignore */
      }
      return { status: response.status, body: json, raw, headers: response.headers };
    },
    async download() {
      const response = await fetch(`${base}/api/students/me/resume/file`, { headers: { cookie } });
      return {
        status: response.status,
        headers: response.headers,
        buffer: Buffer.from(await response.arrayBuffer()),
      };
    },
  };
}

async function registerStudent(label = 'gridfs') {
  const browser = client();
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.local`;
  const response = await browser.post('/api/auth/register', {
    role: 'student',
    name: 'Priya Nair',
    email,
    password: 'studentpass123',
    rollNumber: '2023CSE0300',
    phone: '9876500001',
    university: 'Test Institute of Technology',
    branch: 'CSE',
    semester: 7,
    cgpa: 8.1,
    graduationYear: 2027,
  });
  browser.capture(response);
  assert.equal(response.status, 201, response.raw);
  return { browser, user: response.body.user };
}

const fileCount = () => mongoose.connection.db.collection('resumes.files').countDocuments();

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

/** Start each test with an empty bucket so counts are unambiguous. */
beforeEach(async () => {
  await mongoose.connection.db.collection('resumes.files').deleteMany({});
  await mongoose.connection.db.collection('resumes.chunks').deleteMany({});
});

describe('resume storage in GridFS', () => {
  test('an uploaded resume is stored in MongoDB and extracts normally', async () => {
    const { browser, user } = await registerStudent('upload');

    const upload = await browser.upload(RESUME_PDF, { fileName: 'Priya_Nair.pdf' });
    assert.equal(upload.status, 201, upload.raw);
    assert.equal(upload.body.resume.hasText, true);
    assert.ok(upload.body.extraction.extract.skills.includes('Python'));

    const stored = await Student.findById(user.id).lean();
    assert.match(stored.resume.storedName, /^gridfs:[a-f0-9]{24}$/);
    assert.equal(await fileCount(), 1);
    assert.ok(
      (await mongoose.connection.db.collection('resumes.chunks').countDocuments()) > 0,
      'the bytes are chunked into GridFS',
    );

    // The profile never exposes the storage handle.
    const profile = await browser.get('/api/students/me/profile');
    assert.equal(profile.raw.includes('storedName'), false);
  });

  test('the owner downloads the exact bytes back from GridFS', async () => {
    const { browser } = await registerStudent('download');
    await browser.upload(RESUME_PDF);

    const download = await browser.download();
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(download.buffer.equals(RESUME_PDF), true);
  });

  test('replacing a resume deletes the previous GridFS file', async () => {
    const { browser, user } = await registerStudent('replace');

    await browser.upload(RESUME_PDF);
    const first = await Student.findById(user.id).lean();
    assert.equal(await fileCount(), 1);

    await browser.upload(RESUME_PDF, { fileName: 'newer.pdf' });
    const second = await Student.findById(user.id).lean();

    assert.notEqual(second.resume.storedName, first.resume.storedName);
    assert.equal(await fileCount(), 1, 'the superseded file is removed');
  });

  test('re-parsing reads the stored bytes from GridFS', async () => {
    const { browser } = await registerStudent('reparse');
    await browser.upload(RESUME_PDF);

    const response = await browser.post('/api/students/me/resume/parse', {});
    assert.equal(response.status, 200, response.raw);
    assert.ok(response.body.extraction.extract.skills.length > 0);
    assert.ok(response.body.extraction.extract.extractedAt);
  });

  test('deleting a resume removes the file and every chunk', async () => {
    const { browser, user } = await registerStudent('delete');
    await browser.upload(RESUME_PDF);

    const removed = await browser.delete('/api/students/me/resume');
    assert.equal(removed.status, 200);

    const stored = await Student.findById(user.id).lean();
    assert.equal(stored.resume, null);
    assert.equal(stored.resumeExtract, null);
    assert.equal(await fileCount(), 0);
    assert.equal(
      await mongoose.connection.db.collection('resumes.chunks').countDocuments(),
      0,
    );
    assert.equal((await browser.download()).status, 404);
  });

  test('an invalid file never reaches GridFS', async () => {
    const { browser } = await registerStudent('invalid');

    const beforeCount = await fileCount();
    const upload = await browser.upload(Buffer.from('<html>not a resume</html>'), {
      fileName: 'fake.pdf',
      mimeType: 'application/pdf',
    });

    assert.equal(upload.status, 400);
    assert.equal(await fileCount(), beforeCount);
  });
});
