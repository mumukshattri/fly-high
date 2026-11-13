/**
 * tests/match-presentation.test.js
 * ===========================================================================
 * THE CARD'S VIEW MODEL - pure tests
 * ===========================================================================
 * The recommendation card must display exactly what the server's matching
 * engine produced. These tests feed the real `scoreJob()` output through the
 * presentation helpers and assert that:
 *
 *   - the percentage, category and factor scores are the API's values
 *   - every factor row carries its real weight and the documented 40/20/15/10/10/5
 *     split is shown, not recalculated
 *   - a factor the listing never described is "Not scored", not zero
 *   - the four relevance rows (education, experience/projects, location,
 *     employment) reflect the engine's own relevance fields
 *   - the short explanation is taken from the engine's reasons
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_WEIGHTS, scoreJob } from '../server/matching.js';
import {
  factorRows,
  matchCategory,
  relevanceRows,
  scoredFactorText,
  whyReasons,
} from '../src/utils/matchPresentation.js';

const student = {
  name: 'Priya Nair',
  department: 'Computer Science and Engineering',
  branch: 'CSE',
  degree: 'B.Tech',
  cgpa: 8.4,
  graduationYear: 2027,
  skills: ['Python', 'React', 'SQL'],
  programmingLanguages: ['Python'],
  frameworks: ['React'],
  databases: ['SQL'],
  projects: [
    {
      title: 'Attendance system',
      description: 'A React and Python app used by 400 students.',
      techStack: ['React', 'Python'],
    },
  ],
  experiences: [],
  certifications: [],
  preferences: {
    roles: ['Backend Developer'],
    industries: [],
    locations: ['Pune'],
    workMode: 'Any',
    employmentType: 'Full Time',
  },
};

const job = {
  id: 'adzuna-1',
  title: 'Backend Developer',
  company: 'Nimbus Analytics',
  location: 'Pune, Maharashtra',
  description:
    'We are hiring a backend developer. Python, React and SQL are used daily; Docker is a plus. Bachelor degree in computer science preferred.',
  employmentType: 'Full time',
  category: 'IT Jobs',
  salary: null,
  postedAt: '2026-11-01T00:00:00.000Z',
  url: 'https://www.adzuna.in/land/ad/1',
  source: 'Adzuna',
};

describe('match card view model', () => {
  test('the category label and tone come from the API level', () => {
    assert.deepEqual(matchCategory('Strong Match'), { label: 'Strong Match', tone: 'strong' });
    assert.deepEqual(matchCategory('Excellent Match'), {
      label: 'Excellent Match',
      tone: 'excellent',
    });
    assert.deepEqual(matchCategory('Moderate Match'), { label: 'Moderate Match', tone: 'moderate' });
    assert.deepEqual(matchCategory('Explore'), { label: 'Explore', tone: 'explore' });
    assert.deepEqual(matchCategory(undefined), { label: 'Explore', tone: 'explore' });
  });

  test('the factor breakdown mirrors the engine, including the real weights', () => {
    const match = scoreJob(student, job);
    const rows = factorRows(match);

    assert.equal(rows.length, 6);
    assert.deepEqual(
      rows.map((row) => row.key),
      ['skills', 'education', 'experience', 'location', 'role', 'employment'],
    );

    for (const row of rows) {
      assert.ok(row.label, `${row.key} has a label`);
      assert.equal(row.weight, Math.round(DEFAULT_WEIGHTS[row.key] * 100));
      const api = match.factors.find((factor) => factor.key === row.key);
      assert.equal(row.score, api.score, `${row.key} score is the API's score`);
      assert.equal(row.scored, typeof api.score === 'number');
      assert.ok(row.detail.length > 0, `${row.key} explains itself`);
    }

    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    assert.equal(totalWeight, 100, 'the displayed weights add up to 100%');
  });

  test('the four relevance rows reflect the engine, not a re-computation', () => {
    const match = scoreJob(student, job);
    const rows = relevanceRows(match);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));

    assert.deepEqual(Object.keys(byKey), ['education', 'experience', 'location', 'employment']);

    assert.equal(byKey.education.value, 'High relevance');
    assert.equal(byKey.education.score, match.factors.find((f) => f.key === 'education').score);
    assert.notEqual(byKey.experience.value, 'Not stated in the listing');
    assert.equal(byKey.location.value, 'Matches your preference');
    assert.equal(byKey.location.tone, 'good');
    assert.equal(byKey.employment.value, 'Matches your preference');
  });

  test('a factor the listing never described is shown as unscored, never as zero', () => {
    const empty = {
      id: 'adzuna-empty',
      // No intern/trainee wording: employment type is genuinely unstated here.
      title: 'Graduate Analyst',
      company: null,
      location: null,
      description: null,
      employmentType: null,
      category: null,
      salary: null,
      postedAt: null,
      url: 'https://www.adzuna.in/land/ad/empty',
      source: 'Adzuna',
    };

    const match = scoreJob(student, empty);
    const rows = relevanceRows(match);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));

    assert.equal(byKey.education.value, 'Not stated in the listing');
    assert.equal(byKey.location.value, 'Not stated in the listing');
    assert.equal(byKey.employment.value, 'Not stated in the listing');

    const skillsRow = factorRows(match).find((row) => row.key === 'skills');
    assert.equal(skillsRow.scored, false);
    assert.equal(skillsRow.score, null);
    assert.match(scoredFactorText(match), /^\d of 6 factors scored$/);
    assert.ok(match.unknownFactors.length > 0, 'the card can list what was not stated');
  });

  test('the short explanation is the engine’s own reasons', () => {
    const match = scoreJob(student, job);
    const reasons = whyReasons(match);

    assert.ok(reasons.length >= 1 && reasons.length <= 2);
    assert.deepEqual(reasons, match.reasons.slice(0, 2));
    assert.ok(reasons.some((reason) => /Python/.test(reason)));
    for (const reason of reasons) assert.ok(reason.trim().length > 10);
  });

  test('matched and missing skills are disjoint and complete', () => {
    const match = scoreJob(student, job);
    const rows = relevanceRows(match);

    assert.ok(match.matchedSkills.includes('Python'));
    assert.ok(match.missingSkills.includes('Docker'));
    for (const skill of match.matchedSkills) {
      assert.equal(match.missingSkills.includes(skill), false);
    }
    assert.equal(rows.length, 4);
  });

  test('a job outside the preferred location is presented as outside, not as ineligible', () => {
    const farJob = {
      ...job,
      id: 'adzuna-far',
      location: 'Bengaluru, Karnataka',
      description: 'Python and SQL. Bachelor degree in computer science.',
    };

    const match = scoreJob(student, farJob);
    const location = relevanceRows(match).find((row) => row.key === 'location');

    assert.equal(location.value, 'Outside your preference');
    assert.equal(location.tone, 'warn');
    assert.equal(match.eligibility, 'unknown');
  });
});
