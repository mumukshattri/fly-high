import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApplicationTimeline,
  currentStageLabel,
} from '../src/utils/applicationTimeline.js';

/** The shape the API returns for an application (see server/serialize.js). */
const makeApplication = (overrides = {}) => ({
  id: 'app-1',
  status: 'Applied',
  appliedOn: '2026-11-01',
  lastUpdated: '2026-11-01',
  recruiterNote: '',
  statusHistory: [
    { status: 'Applied', date: '2026-11-01', note: 'Application submitted by the student.' },
  ],
  ...overrides,
});

const byKey = (timeline) =>
  Object.fromEntries(timeline.stages.map((stage) => [stage.key, stage]));

test('a fresh application shows the pipeline with only Applied recorded', () => {
  const timeline = buildApplicationTimeline(makeApplication(), null);
  assert.deepEqual(
    timeline.stages.map((stage) => stage.key),
    ['Applied', 'Under Review', 'Shortlisted', 'Selected'],
  );

  const stages = byKey(timeline);
  assert.equal(stages.Applied.state, 'current');
  assert.equal(stages.Applied.date, '2026-11-01');

  for (const key of ['Under Review', 'Shortlisted', 'Selected']) {
    assert.equal(stages[key].state, 'pending');
    assert.equal(stages[key].date, '', 'no date is invented for a stage that has not happened');
  }
});

test('recruiter updates become done stages with their own timestamps and notes', () => {
  const timeline = buildApplicationTimeline(
    makeApplication({
      status: 'Shortlisted',
      lastUpdated: '2026-11-08',
      statusHistory: [
        { status: 'Applied', date: '2026-11-01', note: 'Application submitted by the student.' },
        { status: 'Under Review', date: '2026-11-04', note: 'Profile opened by the recruiter.' },
        { status: 'Shortlisted', date: '2026-11-08', note: 'Shortlisted for the technical round.' },
      ],
    }),
    null,
  );

  const stages = byKey(timeline);
  assert.equal(stages.Applied.state, 'done');
  assert.equal(stages.Applied.date, '2026-11-01');

  assert.equal(stages['Under Review'].state, 'done');
  assert.equal(stages['Under Review'].date, '2026-11-04');
  assert.equal(stages['Under Review'].note, 'Profile opened by the recruiter.');
  assert.equal(stages['Under Review'].label, 'Application reviewed');

  assert.equal(stages.Shortlisted.state, 'current');
  assert.equal(stages.Shortlisted.date, '2026-11-08');
  assert.equal(stages.Selected.state, 'pending');
  assert.equal(stages.Selected.date, '');
  assert.equal(timeline.currentStatus, 'Shortlisted');
});

test('the current status label uses the readable wording without changing the value', () => {
  assert.equal(currentStageLabel({ status: 'Under Review' }), 'Application reviewed');
  assert.equal(currentStageLabel({ status: 'Shortlisted' }), 'Shortlisted');
  assert.equal(currentStageLabel({}), 'Applied');
});

test('no interview stage is added when the drive has no published date', () => {
  const timeline = buildApplicationTimeline(
    makeApplication({ status: 'Shortlisted' }),
    { driveDate: '' },
  );
  assert.equal(byKey(timeline).Interview, undefined);
  assert.equal(timeline.interviewDate, '');
});

test('an interview stage appears only after shortlisting and uses the drive date', () => {
  const application = makeApplication({ status: 'Shortlisted' });

  const shortlisted = buildApplicationTimeline(application, { driveDate: '2026-11-20' });
  assert.deepEqual(
    shortlisted.stages.map((stage) => stage.key),
    ['Applied', 'Under Review', 'Shortlisted', 'Interview', 'Selected'],
  );
  assert.equal(byKey(shortlisted).Interview.date, '2026-11-20');
  assert.equal(byKey(shortlisted).Interview.label, 'Interview scheduled');
  assert.equal(shortlisted.interviewDate, '2026-11-20');

  // Same drive date, but the application has not reached Shortlisted yet.
  const underReview = buildApplicationTimeline(makeApplication({ status: 'Under Review' }), {
    driveDate: '2026-11-20',
  });
  assert.equal(byKey(underReview).Interview, undefined);
});

test('a rejected application ends with Rejected and never shows a Selected step', () => {
  const timeline = buildApplicationTimeline(
    makeApplication({
      status: 'Rejected',
      lastUpdated: '2026-11-10',
      statusHistory: [
        { status: 'Applied', date: '2026-11-01', note: 'Application submitted by the student.' },
        { status: 'Under Review', date: '2026-11-04', note: 'Profile reviewed.' },
        { status: 'Rejected', date: '2026-11-10', note: 'Not enough openings for this branch.' },
      ],
    }),
    { driveDate: '2026-11-20' },
  );

  const keys = timeline.stages.map((stage) => stage.key);
  assert.deepEqual(keys, ['Applied', 'Under Review', 'Shortlisted', 'Rejected']);
  assert.ok(!keys.includes('Selected'));

  const stages = byKey(timeline);
  assert.equal(stages.Rejected.state, 'rejected');
  assert.equal(stages.Rejected.date, '2026-11-10');
  assert.equal(stages.Rejected.note, 'Not enough openings for this branch.');
  assert.equal(stages.Shortlisted.state, 'skipped');
  assert.equal(stages.Shortlisted.date, '', 'skipped stage keeps no date');
  assert.equal(timeline.isRejected, true);
});

test('legacy applications without a history fall back only to their real applied date', () => {
  const timeline = buildApplicationTimeline(
    makeApplication({ status: 'Applied', statusHistory: [] }),
    null,
  );

  const stages = byKey(timeline);
  assert.equal(stages.Applied.date, '2026-11-01');
  assert.equal(stages.Applied.state, 'current');
  assert.equal(stages['Under Review'].date, '');
  assert.equal(stages.Shortlisted.date, '');
  assert.equal(stages.Selected.date, '');
  assert.equal(timeline.hasHistory, false);
});

test('a selected application marks the earlier stages done from the audit trail', () => {
  const timeline = buildApplicationTimeline(
    makeApplication({
      status: 'Selected',
      statusHistory: [
        { status: 'Applied', date: '2026-11-01', note: '' },
        { status: 'Under Review', date: '2026-11-04', note: '' },
        { status: 'Shortlisted', date: '2026-11-08', note: '' },
        { status: 'Selected', date: '2026-11-12', note: 'Offer letter shared.' },
      ],
    }),
    { driveDate: '2026-11-20' },
  );

  const stages = byKey(timeline);
  assert.equal(stages.Selected.state, 'current');
  assert.equal(stages.Selected.date, '2026-11-12');
  assert.equal(stages.Interview.state, 'done');
  assert.equal(stages.Interview.date, '2026-11-20');
  assert.equal(stages.Shortlisted.state, 'done');
});
