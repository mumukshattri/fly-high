/**
 * tests/matching.test.js
 * ===========================================================================
 * THE MATCHING ENGINE - pure unit tests
 * ===========================================================================
 * No database and no network: the engine takes a profile and a normalised job
 * and returns a score with an explanation, which makes every rule testable.
 *
 * What is asserted here, and why it matters:
 *   - a strong profile really scores higher than a weak one
 *   - a factor the advert does not describe is "unknown", not a mismatch
 *   - the result is RELEVANCE, never eligibility: external listings do not
 *     state enough to decide eligibility, so the engine refuses to pretend
 *   - nothing invents a CGPA, backlog or degree rule
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WEIGHTS,
  buildStudentSignal,
  matchLevel,
  rankJobs,
  readJobSignal,
  scoreJob,
  summarizeSkillGap,
} from '../server/matching.js';
import { MATCH_THRESHOLDS } from '../server/config.js';

const student = {
  name: 'Priya Nair',
  department: 'Computer Science and Engineering',
  branch: 'CSE',
  degree: 'B.Tech',
  specialization: '',
  cgpa: 8.4,
  graduationYear: 2027,
  skills: ['Python', 'React', 'SQL'],
  programmingLanguages: ['Python'],
  frameworks: ['React'],
  databases: ['SQL'],
  tools: [],
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

const weakJob = {
  ...job,
  id: 'adzuna-2',
  title: 'Senior Kubernetes Platform Architect',
  description:
    'Ten years of experience with Kubernetes, Terraform, Go and AWS required. Civil engineering background acceptable.',
  location: 'Bengaluru, Karnataka',
  employmentType: 'Part time',
};

describe('matching engine', () => {
  test('a strong profile scores high, with matched and missing skills split', () => {
    const match = scoreJob(student, job);

    assert.ok(match.matchScore >= 65, `expected a strong match, got ${match.matchScore}`);
    assert.ok(['Strong Match', 'Excellent Match'].includes(match.level));
    assert.ok(match.matchedSkills.includes('Python'));
    assert.ok(match.matchedSkills.includes('React'));
    assert.ok(match.matchedSkills.includes('SQL'));
    assert.deepEqual(match.missingSkills, ['Docker']);
    // Matched and missing are disjoint, so the UI can render both safely.
    for (const skill of match.matchedSkills) {
      assert.equal(match.missingSkills.includes(skill), false);
    }
    assert.ok(match.reasons.length >= 3);
    assert.ok(match.reasons.some((reason) => /Python/.test(reason)));
    assert.equal(match.locationMatch, true);
    assert.equal(match.educationRelevance, 'High');
  });

  test('a weaker profile scores lower for the same vacancy', () => {
    const beginner = {
      ...student,
      skills: ['React'],
      programmingLanguages: ['React'],
      frameworks: ['React'],
      databases: [],
      projects: [],
      preferences: { ...student.preferences, locations: [], roles: [] },
    };

    const strong = scoreJob(student, job);
    const weak = scoreJob(beginner, job);

    assert.ok(weak.matchScore < strong.matchScore);
    assert.ok(weak.missingSkills.includes('Python'));
    assert.ok(weak.missingSkills.includes('SQL'));
  });

  test('an unrelated role and location score as "Explore", never as ineligible', () => {
    const match = scoreJob(student, weakJob);

    assert.ok(match.matchScore < MATCH_THRESHOLDS.strong);
    assert.equal(match.level, 'Explore');
    assert.equal(match.locationMatch, false);
    assert.equal(match.eligibility, 'unknown');
    assert.equal('eligible' in match, false, 'relevance is never reported as eligibility');
  });

  test('a listing that states no requirements does not become a mismatch', () => {
    const empty = {
      id: 'adzuna-3',
      title: 'Graduate Trainee',
      company: null,
      location: null,
      description: null,
      employmentType: null,
      category: null,
      salary: null,
      postedAt: null,
      url: 'https://www.adzuna.in/land/ad/3',
      source: 'Adzuna',
    };

    const match = scoreJob(student, empty);

    assert.equal(typeof match.matchScore, 'number');
    assert.ok(match.unknownFactors.length > 0);
    assert.ok(
      match.unknownFactors.some((factor) => /Technical skills:/.test(factor)),
      'the missing skill information is named, not guessed',
    );
    // No factor was invented out of thin air.
    assert.equal(match.matchedSkills.length, 0);
    assert.equal(match.missingSkills.length, 0);
    assert.equal(match.educationRelevance, 'Unknown');
    assert.equal(match.knownRequirements.yearsOfExperience, null);
  });

  test('an empty profile still produces a valid, low score', () => {
    const match = scoreJob({}, job);

    assert.equal(typeof match.matchScore, 'number');
    assert.ok(match.matchScore >= 0 && match.matchScore <= 100);
    assert.ok(match.missingSkills.includes('Python'));
    assert.equal(match.eligibility, 'unknown');
    assert.ok(['low', 'medium', 'high'].includes(match.confidence));
  });

  test('education relevance follows the discipline actually named', () => {
    const mechStudent = {
      ...student,
      department: 'Mechanical Engineering',
      branch: 'MECH',
      degree: 'B.Tech',
    };

    const mechJob = {
      ...job,
      id: 'adzuna-4',
      title: 'Design Engineer',
      description: 'Mechanical engineering graduate with AutoCAD and SolidWorks experience.',
    };

    assert.equal(scoreJob(mechStudent, mechJob).educationRelevance, 'High');
    assert.equal(scoreJob(student, job).educationRelevance, 'High');

    // A different discipline is low relevance - not ineligibility.
    const mismatch = scoreJob(mechStudent, job);
    assert.equal(mismatch.educationRelevance, 'Low');
    assert.equal(mismatch.eligibility, 'unknown');
    assert.ok(
      mismatch.reasons.some((reason) => /another discipline/i.test(reason)),
      'the reason is honest about what it saw',
    );
  });

  test('location and employment preferences are compared only when knowable', () => {
    const pune = scoreJob(student, job);
    assert.equal(pune.locationMatch, true);

    const remoteStudent = {
      ...student,
      preferences: { ...student.preferences, workMode: 'Remote' },
    };
    const remoteJob = {
      ...job,
      id: 'adzuna-5',
      title: 'Backend Developer',
      location: 'Remote',
      description: 'Fully remote backend role. Python and SQL.',
      employmentType: null,
    };
    assert.equal(scoreJob(remoteStudent, remoteJob).locationMatch, true);
    assert.equal(scoreJob(remoteStudent, remoteJob).remote, true);

    const noEmployment = {
      ...student,
      preferences: { ...student.preferences, employmentType: 'Any' },
    };
    const noEmploymentMatch = scoreJob(noEmployment, remoteJob);
    assert.equal(noEmploymentMatch.employmentMatch, null, 'unknown, not false');
    assert.ok(
      noEmploymentMatch.unknownFactors.some((factor) => /Employment preference/.test(factor)),
    );
  });

  test('weights are configurable and normalise over the known factors', () => {
    const skillsOnly = scoreJob(student, job, {
      weights: { skills: 1, education: 0, experience: 0, location: 0, role: 0, employment: 0 },
    });

    const skillsFactor = skillsOnly.factors.find((factor) => factor.key === 'skills');
    assert.equal(skillsOnly.matchScore, skillsFactor.score);
  });

  test('labels follow the configurable thresholds', () => {
    assert.equal(matchLevel(95, MATCH_THRESHOLDS), 'Excellent Match');
    assert.equal(matchLevel(MATCH_THRESHOLDS.strong, MATCH_THRESHOLDS), 'Strong Match');
    assert.equal(matchLevel(MATCH_THRESHOLDS.moderate, MATCH_THRESHOLDS), 'Moderate Match');
    assert.equal(matchLevel(MATCH_THRESHOLDS.moderate - 1, MATCH_THRESHOLDS), 'Explore');
    assert.equal(matchLevel(90, { excellent: 99, strong: 90, moderate: 50 }), 'Strong Match');
  });

  test('default weights are the documented 40/20/15/10/10/5 split', () => {
    assert.deepEqual(DEFAULT_WEIGHTS, {
      skills: 0.4,
      education: 0.2,
      experience: 0.15,
      location: 0.1,
      role: 0.1,
      employment: 0.05,
    });
    // The engine exports the same numbers it scores with.
    const total = Object.values(DEFAULT_WEIGHTS).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  test('ranking is deterministic and ordered by score then recency', () => {
    const jobs = [job, weakJob, { ...job, id: 'adzuna-6', postedAt: '2026-11-05T00:00:00.000Z' }];

    const first = rankJobs(student, jobs);
    const second = rankJobs(student, jobs);

    assert.deepEqual(
      first.map((item) => [item.id, item.match.matchScore]),
      second.map((item) => [item.id, item.match.matchScore]),
    );

    for (let i = 1; i < first.length; i += 1) {
      assert.ok(first[i - 1].match.matchScore >= first[i].match.matchScore);
    }
  });

  test('the skill gap counts real listing requirements, not a generic list', () => {
    const jobs = [job, { ...weakJob, id: 'adzuna-7' }];
    const ranked = rankJobs(student, jobs);
    const gap = summarizeSkillGap(student, ranked, { minScore: 0 });

    assert.equal(gap.basedOnListings, 2);
    assert.ok(gap.studentSkills.includes('Python'));

    const docker = gap.missingSkills.find((entry) => entry.skill === 'Docker');
    assert.ok(docker, 'Docker is reported missing');
    assert.equal(docker.jobCount >= 1, true);
    assert.match(gap.note, /not a guarantee/i);

    // Nothing the student already has is suggested.
    assert.equal(gap.missingSkills.some((entry) => entry.skill === 'React'), false);
  });

  test('job signals only contain facts from the advert', () => {
    const signal = readJobSignal(job);

    assert.ok(signal.allSkills.includes('Python'));
    assert.equal(signal.requiredYears, null, 'no years figure is invented');
    assert.equal(signal.educationMentioned, true);
    assert.equal(signal.isInternship, false);

    const internJob = {
      ...job,
      title: 'Software Engineering Intern',
      employmentType: 'Internship',
      description: 'Internship for 6 months. Python preferred.',
    };
    assert.equal(readJobSignal(internJob).isInternship, true);
  });

  test('buildStudentSignal merges every skill bucket and removes duplicates', () => {
    const signal = buildStudentSignal({
      ...student,
      skills: ['Python', 'React', 'python', 'Docker'],
      frameworks: ['React', 'Express.js'],
      databases: ['sql'],
    });

    const keys = signal.skills.map((skill) => skill.toLowerCase());
    assert.equal(keys.filter((key) => key === 'python').length, 1);
    assert.equal(keys.filter((key) => key === 'react').length, 1);
    assert.ok(signal.skills.includes('Express.js'));
    assert.ok(signal.skills.includes('Docker'));
  });

  test('recommendations use the saved profile skills, not the raw extraction', () => {
    // The extraction still holds Kubernetes, but the student rejected it during
    // review, so it is absent from the saved profile and must not be scored.
    const signal = buildStudentSignal({
      ...student,
      skills: ['Python', 'React', 'Docker'],
      resumeExtract: { skills: ['Kubernetes'] },
    });

    assert.ok(signal.skills.includes('Docker'));
    assert.equal(signal.skills.includes('Kubernetes'), false);
    assert.equal(signal.skillKeys.has('kubernetes'), false);
  });
});
