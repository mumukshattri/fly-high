/**
 * tests/resume-parsing.test.js
 * ===========================================================================
 * RESUME TEXT EXTRACTION + STRUCTURED PARSING
 * ===========================================================================
 *
 * The first fixture is the real `JOB_N_JOB_Test_Resume.pdf` a student uploaded.
 * It is the file that exposed the bug: its page content uses
 * `/Filter [ /ASCII85Decode /FlateDecode ]` and the document also embeds a
 * C2PA signature file, so the old parser decoded neither the page nor skipped
 * the embedded file - it read the signature as "text" and found "C" and "R".
 *
 * The second fixture is a different layout with different headings, built here
 * without compression, to prove the parser is not hardcoded to one PDF.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { extractResumeText, parseResumeText } = await import('../server/extract.js');

const FIXTURE = new URL('./fixtures/JOB_N_JOB_Test_Resume.pdf', import.meta.url);

/* ------------------------------- fixtures -------------------------------- */

/** A minimal, uncompressed PDF with a real page -> /Contents relationship. */
function makePdf(lines) {
  const content = [
    'BT /F1 11 Tf 12 TL 72 760 Td',
    ...lines.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`])),
    'ET',
  ].join('\n');

  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Catalog /Pages 2 0 R >>',
      'endobj',
      '2 0 obj',
      '<< /Type /Pages /Kids [ 5 0 R ] /Count 1 >>',
      'endobj',
      '3 0 obj',
      `<< /Length ${content.length} >>`,
      'stream',
      content,
      'endstream',
      'endobj',
      '4 0 obj',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      'endobj',
      '5 0 obj',
      '<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 595 842 ] /Contents 3 0 R >>',
      'endobj',
      'trailer',
      '<< /Root 1 0 R >>',
      '%%EOF',
    ].join('\n'),
    'latin1',
  );
}

const SECOND_RESUME = makePdf([
  'AMAN VERMA',
  'aman.verma@example.com | +91-98765-43210',
  'ACADEMIC QUALIFICATIONS',
  'B.E. in Information Technology',
  'Pune Institute of Technology | Expected Graduation: 2026',
  'CGPA: 7.6/10',
  'TECHNICAL SKILLS',
  'Languages: Java, Python',
  'Frameworks: Spring Boot, React',
  'Databases: MySQL',
  'KEY PROJECTS',
  'Library Management System | Java, Spring Boot, MySQL',
  'Built the catalogue and lending workflow for a college library.',
  'COURSES',
  'Java Programming Masterclass - Online Academy, 2025',
]);

/* --------------------------- the real fixture ---------------------------- */

describe('JOB_N_JOB_Test_Resume.pdf', () => {
  const buffer = readFileSync(FIXTURE);
  const extracted = extractResumeText(buffer, 'pdf');
  const parsed = parseResumeText(extracted.text);

  test('reads the page text instead of the embedded signature file', () => {
    assert.equal(extracted.hasText, true);
    assert.match(extracted.text, /AARAV SHARMA/);
    assert.match(extracted.text, /PROFESSIONAL SUMMARY/);
    assert.equal(/OpenAI TSA|sigTst|jumb/i.test(extracted.text), false);
    assert.ok(extracted.text.length < 8000, 'no binary noise in the text');
  });

  test('extracts the contact details', () => {
    assert.equal(parsed.name, 'AARAV SHARMA');
    assert.equal(parsed.email, 'aarav.sharma@example.com');
    assert.match(parsed.phone, /90000/);
  });

  test('extracts degree, department, university, CGPA and graduation year', () => {
    assert.equal(parsed.education.degree, 'B.Tech');
    assert.equal(parsed.education.department, 'Computer Science and Engineering');
    assert.equal(parsed.education.university, 'SRM University, Delhi-NCR');
    assert.equal(parsed.education.cgpa, 8.4);
    assert.equal(parsed.education.graduationYear, 2027);
    assert.equal(parsed.education.semester, 7);
    assert.equal(parsed.education.backlogs, 0);
  });

  test('detects the listed skills, and never C or R', () => {
    for (const skill of [
      'Python',
      'Java',
      'JavaScript',
      'React',
      'Node.js',
      'MongoDB',
      'MySQL',
      'Docker',
      'SQL',
      'HTML',
      'CSS',
    ]) {
      assert.ok(parsed.skills.includes(skill), `${skill} should be detected`);
    }

    assert.equal(parsed.skills.includes('C'), false, 'C must not come from "CSE"');
    assert.equal(parsed.skills.includes('R'), false, 'R must not come from ordinary words');
  });

  test('extracts all three projects with their technologies', () => {
    const titles = parsed.projects.map((project) => project.title);
    assert.deepEqual(titles, [
      'Campus Recruitment Management Portal',
      'Task Tracker Web Application',
      'Containerized Notes API',
    ]);
    assert.ok(parsed.projects[0].techStack.includes('React'));
    assert.ok(parsed.projects[0].techStack.includes('MongoDB'));
    assert.match(parsed.projects[0].description, /role-based recruitment portal/i);
    assert.match(parsed.projects[2].description, /CRUD API/i);
  });

  test('extracts the internship as one entry with company and dates', () => {
    assert.equal(parsed.experience.length, 1);
    const [internship] = parsed.experience;
    assert.equal(internship.type, 'Internship');
    assert.equal(internship.role, 'Software Development Intern (Academic Simulation)');
    assert.equal(internship.company, 'DemoTech Labs');
    assert.match(internship.startDate, /May 2026/);
    assert.match(internship.endDate, /July 2026/);
    assert.match(internship.description, /Python-based API endpoints/i);
  });

  test('extracts both certifications and the achievement separately', () => {
    const names = parsed.certifications.map((item) => item.name);
    assert.equal(names.length, 2);
    assert.ok(names.includes('Python Programming Fundamentals'));
    assert.ok(names.includes('Introduction to Cloud Computing'));
    assert.equal(parsed.certifications[0].year, '2025');
    assert.equal(parsed.certifications[0].issuer, 'Sample Learning Program');
    assert.ok(parsed.achievements.some((item) => /project showcase/i.test(item)));
  });

  test('keeps the summary out of the skills and the profile', () => {
    assert.match(parsed.summary, /Full-stack development|Final-year B\.Tech/i);
  });
});

/* ------------------------ a different resume layout ---------------------- */

describe('a different resume format', () => {
  const extracted = extractResumeText(SECOND_RESUME, 'pdf');
  const parsed = parseResumeText(extracted.text);

  test('reads the uncompressed content stream', () => {
    assert.equal(extracted.hasText, true);
    assert.match(extracted.text, /AMAN VERMA/);
  });

  test('handles title-case and alternative headings', () => {
    assert.equal(parsed.education.degree, 'B.E.');
    assert.equal(parsed.education.department, 'Information Technology');
    assert.equal(parsed.education.cgpa, 7.6);
    assert.equal(parsed.education.graduationYear, 2026);
    assert.equal(parsed.education.university, 'Pune Institute of Technology');

    assert.ok(parsed.skills.includes('Java'));
    assert.ok(parsed.skills.includes('Python'));
    assert.ok(parsed.skills.includes('Spring Boot'));
    assert.ok(parsed.skills.includes('MySQL'));

    assert.equal(parsed.projects.length, 1);
    assert.equal(parsed.projects[0].title, 'Library Management System');
    assert.equal(parsed.certifications.length, 1);
    assert.equal(parsed.certifications[0].name, 'Java Programming Masterclass');
  });

  test('does not invent projects or internships that are not there', () => {
    assert.equal(parsed.experience.length, 0);
  });
});

/* --------------------------- skill boundaries ---------------------------- */

describe('skill matching boundaries', () => {
  test('single letters only match when they are actually listed', () => {
    const prose = parseResumeText(
      [
        'Ravi Kumar',
        'B.Tech Computer Science and Engineering, CGPA: 8.4/10, Graduating 2027',
        'A CSE student interested in R&D and research. Comfortable with React.',
      ].join('\n'),
    );

    assert.equal(prose.skills.includes('C'), false);
    assert.equal(prose.skills.includes('R'), false);
    assert.ok(prose.skills.includes('React'));
  });

  test('a listed "C, C++, Java, R" line is detected', () => {
    const listed = parseResumeText(
      [
        'Ravi Kumar',
        'B.Tech Computer Science and Engineering, CGPA: 8.4/10, Graduating 2027',
        'Skills: C, C++, Java, R',
      ].join('\n'),
    );

    assert.ok(listed.skills.includes('C'));
    assert.ok(listed.skills.includes('C++'));
    assert.ok(listed.skills.includes('Java'));
    assert.ok(listed.skills.includes('R'));
  });
});
