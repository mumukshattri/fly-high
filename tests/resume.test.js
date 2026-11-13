/**
 * tests/resume.test.js
 * ===========================================================================
 * REAL RESUME UPLOAD, PRIVATE STORAGE AND TEXT EXTRACTION
 * ===========================================================================
 * The fixtures are genuine file formats built in the test itself:
 *   - a PDF with an uncompressed content stream
 *   - a DOCX (ZIP with word/document.xml, stored with no compression)
 *
 * The binary is POSTed to the real API with the real session cookie, written to
 * the private storage directory, read back through the owner-only download
 * route, and finally deleted - so every one of the requirements is exercised
 * end to end, not mocked.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'test-resumes');

process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/jobnjob_test_resume';
process.env.NODE_ENV = 'test';
process.env.RESUME_STORAGE_DIR = STORAGE_DIR;
// Small limit so the oversize test does not need a real 5 MB payload.
process.env.RESUME_MAX_BYTES = '4096';

const { createApp } = await import('../server/app.js');
const { connectDatabase, disconnectDatabase } = await import('../server/db.js');
const { Student } = await import('../server/models/index.js');
const { skillKey } = await import('../server/skills.js');

let server;
let base;

/* ------------------------------- fixtures -------------------------------- */

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

/** Minimal ZIP writer (stored entries) - enough for a real DOCX container. */
function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // compression: stored
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);

    chunks.push(local, nameBuffer, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt32LE(offset, 42);

    central.push(entry, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, directory, eocd]);
}

function makeDocx(paragraphs) {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  return makeZip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    [
      'word/document.xml',
      `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
    ],
  ]);
}

const RESUME_PDF = makePdf([
  'Priya Nair',
  'B.Tech Computer Science and Engineering',
  'CGPA: 8.4/10',
  'Graduating 2027',
  'Skills: Python, React, Node.js, SQL, Docker, AWS',
  'Projects',
  'Smart Attendance System | React, Node.js, MongoDB',
  'Internship',
  'Backend Intern at Nimbus Analytics - Python, Flask',
]);

/* -------------------------------- helpers -------------------------------- */

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
    patch: (pathName, body) => call('PATCH', pathName, body),
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

async function registerStudent(label = 'student') {
  const browser = client();
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.local`;
  const response = await browser.post('/api/auth/register', {
    role: 'student',
    name: 'Priya Nair',
    email,
    password: 'studentpass123',
    rollNumber: '2023CSE0199',
    phone: '9876500000',
    university: 'Test Institute of Technology',
    branch: 'CSE',
    semester: 7,
    cgpa: 8.1,
    graduationYear: 2027,
  });
  browser.capture(response);
  assert.equal(response.status, 201, response.raw);
  return { browser, user: response.body.user, email };
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

describe('resume upload and extraction', () => {
  test('a real PDF is stored privately and its text is extracted', async () => {
    const { browser, user } = await registerStudent('pdf');

    const upload = await browser.upload(RESUME_PDF, { fileName: 'Priya_Nair_Resume.pdf' });
    assert.equal(upload.status, 201, upload.raw);

    assert.equal(upload.body.resume.fileName, 'Priya_Nair_Resume.pdf');
    assert.equal(upload.body.resume.mimeType, 'application/pdf');
    assert.equal(upload.body.resume.hasText, true);

    const extraction = upload.body.extraction.extract;
    assert.ok(extraction.skills.includes('Python'), 'Python is recognised');
    assert.ok(extraction.skills.includes('React'), 'React is recognised');
    assert.ok(extraction.skills.includes('Docker'), 'Docker is recognised');
    assert.match(extraction.textPreview, /Priya Nair/);
    assert.equal(extraction.education.degree, 'B.Tech');
    assert.equal(extraction.education.department, 'Computer Science and Engineering');
    assert.equal(extraction.education.cgpa, 8.4);
    assert.equal(extraction.education.graduationYear, 2027);
    assert.ok(extraction.projects.length > 0, 'projects are proposed');

    // Blank fields are populated automatically; nothing is confirmed yet, and
    // values the student already had (cgpa 8.1, branch CSE) are untouched.
    const stored = await Student.findById(user.id).lean();
    assert.ok(stored.skills.includes('Python'), 'skills were filled from the resume');
    assert.ok(stored.projects.length > 0, 'projects were filled from the resume');
    assert.equal(stored.degree, 'B.Tech');
    assert.equal(stored.cgpa, 8.1, 'an existing CGPA is never overwritten');
    assert.ok(stored.resumeExtract.applied.fields.includes('degree'));
    assert.equal(stored.resume.storedName.includes(String(user.id)), true);
    assert.equal(stored.resumeExtract.skills.length > 0, true);
    assert.equal(stored.resumeExtract.confirmedAt, '');

    // The binary really is on disk, in private storage outside dist/.
    const absolute = path.join(STORAGE_DIR, ...stored.resume.storedName.split('/'));
    assert.equal(existsSync(absolute), true);

    // ...and never appears in an ordinary profile response.
    const profile = await browser.get('/api/students/me/profile');
    assert.equal(profile.raw.includes('storedName'), false);
    assert.equal(profile.raw.includes('BASE64'), false);
  });

  test('the owner can download their own resume, with the stored content type', async () => {
    const { browser } = await registerStudent('download');
    await browser.upload(RESUME_PDF);

    const download = await browser.download();
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.match(download.headers.get('content-disposition') || '', /attachment; filename="/);
    assert.equal(download.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(download.buffer.length > 100);
  });

  test('confirming the extraction copies only what the student accepted', async () => {
    const { browser, user } = await registerStudent('confirm');
    const upload = await browser.upload(RESUME_PDF);
    const extraction = upload.body.extraction.extract;

    const confirm = await browser.patch('/api/students/me/resume/confirm', {
      // "AWS" was auto-filled from the resume; the student rejected it.
      rejected: { skills: ['AWS'] },
      education: extraction.education,
    });

    assert.equal(confirm.status, 200, confirm.raw);
    const profile = confirm.body.profile;

    assert.ok(profile.skills.includes('Python'));
    assert.equal(profile.skills.includes('AWS'), false, 'a removed skill is not applied');
    assert.equal(profile.degree, 'B.Tech');
    assert.equal(profile.branch, 'CSE');
    assert.equal(profile.graduationYear, 2027);
    // The registration already had a CGPA, so confirmation must not replace it.
    assert.equal(profile.cgpa, 8.1);
    assert.ok(profile.projects.length > 0);
    assert.ok(profile.experiences.length > 0);

    const stored = await Student.findById(user.id).lean();
    assert.ok(stored.resumeExtract.confirmedAt, 'the confirmation is recorded');
    assert.ok(stored.resume.extractConfirmedAt);
  });

  test('confirming never silently overwrites values the student already edited', async () => {
    const { browser } = await registerStudent('overwrite');

    await browser.patch('/api/students/me/profile', {
      degree: 'B.E.',
      cgpa: 9.1,
    });

    await browser.upload(RESUME_PDF);
    const confirm = await browser.patch('/api/students/me/resume/confirm', {
      education: { degree: 'B.Tech', department: 'Computer Science and Engineering', cgpa: 8.4, graduationYear: 2027 },
    });

    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.profile.degree, 'B.E.', 'existing degree kept');
    assert.equal(confirm.body.profile.cgpa, 9.1, 'existing CGPA kept');
    // A blank field is filled, which is the whole point of the extraction.
    assert.equal(confirm.body.profile.graduationYear, 2027);
  });

  test('a DOCX resume is parsed from word/document.xml', async () => {
    const { browser } = await registerStudent('docx');
    const docx = makeDocx([
      'Rahul Deshmukh',
      'B.Tech Information Technology',
      'CGPA: 7.8/10',
      'Graduating 2026',
      'Skills: Java, Spring Boot, MySQL, Docker',
      'Projects',
      'Library Management System | Java, Spring Boot',
    ]);

    const upload = await browser.upload(docx, {
      fileName: 'rahul.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    assert.equal(upload.status, 201, upload.raw);
    assert.equal(upload.body.resume.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(upload.body.resume.hasText, true);
    assert.match(upload.body.extraction.extract.textPreview, /Rahul Deshmukh/);
    assert.ok(upload.body.extraction.extract.skills.includes('Spring Boot'));
    assert.equal(upload.body.extraction.extract.education.department, 'Information Technology');
  });

  test('an invalid file is rejected by its bytes, not its name', async () => {
    const { browser, user } = await registerStudent('invalid');

    // An HTML/script file renamed to .pdf - the classic upload attack.
    const upload = await browser.upload(Buffer.from('<html><script>alert(1)</script></html>'), {
      fileName: 'totally-a-resume.pdf',
      mimeType: 'application/pdf',
    });

    assert.equal(upload.status, 400);
    assert.match(upload.body.error, /not a PDF or DOCX/i);

    const stored = await Student.findById(user.id).lean();
    assert.equal(stored.resume, null, 'nothing was stored');
  });

  test('legacy .doc files get an actionable message', async () => {
    const { browser } = await registerStudent('doc');
    const oleHeader = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(600, 0),
    ]);

    const upload = await browser.upload(oleHeader, {
      fileName: 'resume.doc',
      mimeType: 'application/msword',
    });

    assert.equal(upload.status, 400);
    assert.match(upload.body.error, /\.docx/i);
  });

  test('a file over the configured limit is refused with 413', async () => {
    const { browser } = await registerStudent('big');
    const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5000, 0x20)]);

    const upload = await browser.upload(huge, { fileName: 'big.pdf' });
    assert.equal(upload.status, 413);
  });

  test('a scanned PDF is stored but reported as having no text', async () => {
    const { browser } = await registerStudent('scanned');
    // Valid PDF header, but the content stream holds no text operators.
    const scanned = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Length 4 >>\nstream\nq Q\nendstream\nendobj\ntrailer\n<<>>\n%%EOF',
      'latin1',
    );

    const upload = await browser.upload(scanned, { fileName: 'scan.pdf' });
    assert.equal(upload.status, 201, upload.raw);
    assert.equal(upload.body.resume.hasText, false);
    assert.ok(
      upload.body.extraction.extract.notes.some((note) => /scanned|no selectable text/i.test(note)),
      'the student is told the PDF has no text layer',
    );
  });

  test('uploading again replaces the file and removes the old one', async () => {
    const { browser, user } = await registerStudent('replace');

    await browser.upload(RESUME_PDF);
    const first = await Student.findById(user.id).lean();
    const firstPath = path.join(STORAGE_DIR, ...first.resume.storedName.split('/'));
    assert.equal(existsSync(firstPath), true);

    await browser.upload(RESUME_PDF, { fileName: 'newer.pdf' });
    const second = await Student.findById(user.id).lean();

    assert.notEqual(second.resume.storedName, first.resume.storedName);
    assert.equal(existsSync(firstPath), false, 'the superseded file is deleted');
    assert.equal(
      existsSync(path.join(STORAGE_DIR, ...second.resume.storedName.split('/'))),
      true,
    );
  });

  test('deleting a resume removes the row and the file', async () => {
    const { browser, user } = await registerStudent('delete');

    await browser.upload(RESUME_PDF);
    const before = await Student.findById(user.id).lean();
    const absolute = path.join(STORAGE_DIR, ...before.resume.storedName.split('/'));

    const removed = await browser.delete('/api/students/me/resume');
    assert.equal(removed.status, 200);
    assert.equal(removed.body.resume, null);

    const afterDelete = await Student.findById(user.id).lean();
    assert.equal(afterDelete.resume, null);
    assert.equal(afterDelete.resumeExtract, null);
    assert.equal(existsSync(absolute), false);

    const download = await browser.download();
    assert.equal(download.status, 404);
  });

  test('re-parsing a stored resume refreshes the proposal', async () => {
    const { browser } = await registerStudent('reparse');
    await browser.upload(RESUME_PDF);

    const response = await browser.post('/api/students/me/resume/parse', {});
    assert.equal(response.status, 200);
    assert.ok(response.body.extraction.extract.skills.length > 0);
    assert.ok(response.body.extraction.extract.extractedAt);
  });

  test('resumes are private: no session, wrong role and no cross-student access', async () => {
    const { browser } = await registerStudent('private');
    await browser.upload(RESUME_PDF);

    const anonymous = client();
    assert.equal((await anonymous.download()).status, 401);
    assert.equal((await anonymous.get('/api/students/me/resume')).status, 401);

    const company = client();
    const registration = await company.post('/api/auth/register', {
      role: 'company',
      name: 'Resume Snoop Ltd',
      contactPerson: 'Snoop',
      email: `snoop-${Date.now()}@test.local`,
      password: 'companypass123',
    });
    company.capture(registration);

    assert.equal((await company.get('/api/students/me/resume')).status, 403);
    const attempt = await company.download();
    assert.equal(attempt.status, 403);
  });

  test('a request without a file body is rejected clearly', async () => {
    const { browser } = await registerStudent('nobody');
    const response = await browser.post('/api/students/me/resume', {});
    assert.equal(response.status, 400);
    assert.match(response.body.error, /request body/i);
  });

  test('GET /api/students/me/resume returns metadata and the proposal, never bytes', async () => {
    const { browser } = await registerStudent('meta');
    await browser.upload(RESUME_PDF);

    const response = await browser.get('/api/students/me/resume');
    assert.equal(response.status, 200);
    assert.equal(response.body.resume.fileName, 'resume.pdf');
    assert.ok(response.body.extraction.skills.length > 0);
    assert.equal(typeof response.body.extraction.textPreview, 'string');
    assert.equal(response.raw.includes('storedName'), false);
  });

  test('ten extracted skills are saved to the profile automatically', async () => {
    const { browser } = await registerStudent('skills-ten');
    const resume = makePdf([
      'Ananya Rao',
      'B.Tech Computer Science and Engineering',
      'CGPA: 8.2/10',
      'Graduating 2027',
      'Skills: Python, Java, React, Node.js, SQL, Docker, AWS, Git, MongoDB, Kubernetes',
    ]);

    const upload = await browser.upload(resume, { fileName: 'ananya.pdf' });
    assert.equal(upload.status, 201, upload.raw);

    const detected = upload.body.extraction.extract.skills;
    const expected = ['Python', 'Java', 'React', 'Node.js', 'SQL', 'Docker', 'AWS', 'Git', 'MongoDB', 'Kubernetes'];
    for (const skill of expected) {
      assert.ok(detected.includes(skill), `${skill} was detected in the resume`);
    }

    // Persisted on the profile, not only in the extraction proposal.
    const profile = await browser.get('/api/students/me/profile');
    for (const skill of expected) {
      assert.ok(profile.body.profile.skills.includes(skill), `${skill} is on the profile`);
    }
    assert.equal(profile.body.profile.resumeExtract.applied.skills.length >= 10, true);
  });

  test('a second resume merges new skills without duplicating aliases or touching manual ones', async () => {
    const { browser } = await registerStudent('skills-merge');

    // A skill the student typed themselves, in their own spelling.
    const manual = await browser.patch('/api/students/me/profile', {
      skills: ['MyOwnSkill', 'reactjs'],
    });
    assert.equal(manual.status, 200, manual.raw);

    const first = makePdf([
      'Ananya Rao',
      'B.Tech Computer Science and Engineering',
      'Skills: Python, Java, React, Node.js, SQL, Docker, AWS, Git, MongoDB, Kubernetes',
    ]);
    assert.equal((await browser.upload(first, { fileName: 'first.pdf' })).status, 201);

    const second = makePdf([
      'Ananya Rao',
      'B.Tech Computer Science and Engineering',
      'Skills: ReactJS, Python, Java, SQL, Docker, AWS, TypeScript, Flask, MySQL',
    ]);
    assert.equal((await browser.upload(second, { fileName: 'second.pdf' })).status, 201);

    const profile = (await browser.get('/api/students/me/profile')).body.profile;
    const skills = profile.skills;

    assert.ok(skills.includes('MyOwnSkill'), 'a manually entered skill is kept');
    assert.ok(skills.includes('reactjs'), 'the manual spelling is not renamed');
    assert.ok(skills.includes('TypeScript'), 'a new skill from the second resume is added');
    assert.ok(skills.includes('Flask'));
    assert.ok(skills.includes('MySQL'));

    const keys = skills.map(skillKey);
    assert.equal(new Set(keys).size, keys.length, 'no skill is stored twice');
    assert.equal(keys.filter((key) => key === 'react').length, 1, 'React and ReactJS are one skill');
    assert.equal(keys.filter((key) => key === 'python').length, 1);
  });

  test('a rejected skill stays out of the profile when the same resume is parsed again', async () => {
    const { browser } = await registerStudent('skills-reject');

    await browser.patch('/api/students/me/profile', { skills: ['ManualSkill'] });

    const resume = makePdf([
      'Ananya Rao',
      'B.Tech Computer Science and Engineering',
      'Skills: Python, React, Docker, Kubernetes, AWS',
    ]);
    await browser.upload(resume, { fileName: 'reject.pdf' });

    const confirm = await browser.patch('/api/students/me/resume/confirm', {
      rejected: { skills: ['Kubernetes'] },
    });
    assert.equal(confirm.status, 200, confirm.raw);
    assert.equal(confirm.body.profile.skills.includes('Kubernetes'), false);
    assert.ok(confirm.body.profile.skills.includes('Python'));
    assert.ok(confirm.body.profile.skills.includes('ManualSkill'));

    // Re-parsing the stored file proposes Kubernetes again, but must not put it
    // back on the profile.
    const reparse = await browser.post('/api/students/me/resume/parse', {});
    assert.equal(reparse.status, 200, reparse.raw);
    assert.ok(reparse.body.extraction.extract.skills.includes('Kubernetes'));

    const profile = (await browser.get('/api/students/me/profile')).body.profile;
    assert.equal(profile.skills.includes('Kubernetes'), false);
    assert.ok(profile.skills.includes('ManualSkill'));
  });
});
