/**
 * utils/applicationTimeline.js
 * ===========================================================================
 * APPLICATION TIMELINE - built only from records we actually have
 * ===========================================================================
 * The tracker must never invent a step or a date. Every stage is derived from:
 *
 *   - `application.statusHistory`  the audit trail the server appends to on
 *                                  every recruiter status change
 *   - `application.status`         the current status
 *   - `application.appliedOn`      the date the application was created
 *   - `drive.driveDate`            the date the company published for the drive
 *                                  (used only for the interview stage, and only
 *                                  once the student was shortlisted)
 *
 * A stage with no record gets `date: ''` and a "Not recorded" / "Pending" label
 * in the UI. An interview stage is only added when `drive.driveDate` exists and
 * the application has actually reached Shortlisted (or beyond).
 */

export const STAGE_ICONS = {
  Applied: 'send',
  'Under Review': 'clock',
  Shortlisted: 'star',
  Interview: 'calendar',
  Selected: 'check-circle',
  Rejected: 'x',
};

/** Pipeline order. Rejected is off-path; Interview is conditional. */
export const BASE_STAGES = [
  { key: 'Applied', label: 'Applied' },
  { key: 'Under Review', label: 'Application reviewed' },
  { key: 'Shortlisted', label: 'Shortlisted' },
  { key: 'Selected', label: 'Selected' },
];

const lastEntryFor = (history, status) =>
  [...history].reverse().find((entry) => entry && entry.status === status) || null;

/**
 * @param {object} application - serialized application (statusHistory, status, appliedOn)
 * @param {object|null} drive  - the drive, when the caller has it
 * @returns {{stages: Array, currentStatus: string, isRejected: boolean,
 *            hasHistory: boolean, interviewDate: string}}
 */
export function buildApplicationTimeline(application = {}, drive = null) {
  const history = Array.isArray(application.statusHistory)
    ? application.statusHistory.filter((entry) => entry && entry.status)
    : [];

  const currentStatus = application.status || 'Applied';
  const isRejected = currentStatus === 'Rejected';
  const reached = new Set([...history.map((entry) => entry.status), currentStatus]);

  const interviewDate = String(drive?.driveDate || '').trim();
  const interviewSupported =
    interviewDate.length > 0 && (reached.has('Shortlisted') || reached.has('Selected'));

  const stages = BASE_STAGES.map((stage) => ({ ...stage })).filter(
    (stage) => !(isRejected && stage.key === 'Selected'),
  );

  if (interviewSupported) {
    stages.splice(3, 0, {
      key: 'Interview',
      label: 'Interview scheduled',
      isInterview: true,
    });
  }

  if (isRejected) {
    stages.push({ key: 'Rejected', label: 'Rejected' });
  }

  const currentIndex = stages.findIndex((stage) => stage.key === currentStatus);

  const rows = stages.map((stage, index) => {
    const entry = stage.key === 'Interview' ? null : lastEntryFor(history, stage.key);
    const isCurrent = stage.key === currentStatus;

    let state;
    if (stage.key === 'Rejected') state = 'rejected';
    else if (isCurrent) state = 'current';
    else if (entry) state = 'done';
    else if (!isRejected && currentIndex > -1 && index < currentIndex) state = 'done';
    else if (currentIndex > -1 && index < currentIndex) state = 'skipped';
    else state = 'pending';

    const date =
      stage.key === 'Interview'
        ? interviewDate
        : entry?.date || (stage.key === 'Applied' ? application.appliedOn || '' : '');

    const note =
      stage.key === 'Interview'
        ? 'Date published by the company for this drive. Confirm the details with the placement cell.'
        : entry?.note || '';

    return {
      key: stage.key,
      label: stage.label,
      icon: STAGE_ICONS[stage.key] || 'circle',
      state,
      date,
      note,
      isInterview: Boolean(stage.isInterview),
      isCurrent,
    };
  });

  return {
    stages: rows,
    currentStatus,
    isRejected,
    hasHistory: history.length > 0,
    interviewDate: interviewSupported ? interviewDate : '',
  };
}

/** A short, honest label for "where is this application now". */
export function currentStageLabel(application = {}) {
  const status = application.status || 'Applied';
  if (status === 'Under Review') return 'Application reviewed';
  return status;
}
