/**
 * utils/eligibility.js
 * ===========================================================================
 * THE ELIGIBILITY ENGINE  (one of the core features of this project)
 * ===========================================================================
 *
 * This file is the ONLY place that decides whether a student is eligible for a
 * recruitment drive. No React component contains an `if (cgpa > 7.5)` rule - the
 * components just call `checkEligibility(student, drive)` and render the result.
 *
 * Why does that matter?
 *  - If the rules change (e.g. "also check backlogs"), you edit ONE file.
 *  - When the Node + Express backend is ready, the college can move this exact
 *    logic to the server and expose it as:
 *         GET /api/drives/:driveId/eligibility?studentId=...
 *    The frontend then only has to swap the import in `services/driveService.js`
 *    from `checkEligibility(...)` to an `await api.get(...)` call. The UI does
 *    not change at all.
 *
 * A drive declares its own rules as data:
 *   minimumCGPA, branches, requiredSkills, skillMatchMode ('all' | 'any'),
 *   deadline, status
 */

/** Normalise a skill so "reactjs" and "React JS" still match if needed. */
export const normaliseSkill = (skill) => String(skill || '').trim().toLowerCase();

/** True when the student's skill list contains the given skill. */
export function hasSkill(studentSkills = [], skill) {
  const target = normaliseSkill(skill);
  return studentSkills.some((studentSkill) => normaliseSkill(studentSkill) === target);
}

/** Skills the drive asks for that the student does not have. */
export function getMissingSkills(studentSkills = [], requiredSkills = []) {
  return requiredSkills.filter((skill) => !hasSkill(studentSkills, skill));
}

/** Deadline has passed when today's date is after the closing date (inclusive). */
export function isDeadlinePassed(deadline) {
  if (!deadline) return false;
  const closing = new Date(`${deadline}T23:59:59`);
  return new Date() > closing;
}

/**
 * MAIN FUNCTION
 * ---------------------------------------------------------------------------
 * @param {object} student - e.g. { cgpa: 8.1, branch: 'CSE', skills: ['Java'] }
 * @param {object} drive   - e.g. { minimumCGPA: 7.5, branches: ['CSE','IT'], ... }
 * @returns {{
 *   eligible: boolean,
 *   reasons: string[],            // human readable reasons for rejection
 *   checks: Array<{label, required, actual, passed, detail}>
 * }}
 */
export function checkEligibility(student, drive) {
  // Fail safely when data is still loading.
  if (!student || !drive) {
    return {
      eligible: false,
      reasons: ['Student or drive details are not available yet.'],
      checks: [],
    };
  }

  const reasons = [];
  const checks = [];

  /* --------------------------- Rule 1: drive is open --------------------------- */
  const isOpen = drive.status === 'Open';
  checks.push({
    label: 'Drive status',
    required: 'Open',
    actual: drive.status,
    passed: isOpen,
    detail: isOpen ? 'Applications are open.' : 'This drive has been closed by the company.',
  });
  if (!isOpen) reasons.push('This drive is no longer accepting applications.');

  /* ------------------------------ Rule 2: deadline ----------------------------- */
  const deadlinePassed = isDeadlinePassed(drive.deadline);
  checks.push({
    label: 'Application deadline',
    required: 'On or before deadline',
    actual: deadlinePassed ? 'Passed' : 'Within deadline',
    passed: !deadlinePassed,
    detail: deadlinePassed
      ? 'The application deadline has passed.'
      : 'You can still apply for this drive.',
  });
  if (deadlinePassed) reasons.push('The application deadline has passed.');

  /* -------------------------------- Rule 3: CGPA ------------------------------- */
  const cgpaOk = Number(student.cgpa) >= Number(drive.minimumCGPA);
  checks.push({
    label: 'Minimum CGPA',
    required: `${drive.minimumCGPA}+`,
    actual: String(student.cgpa),
    passed: cgpaOk,
    detail: cgpaOk
      ? 'Your CGPA meets the requirement.'
      : 'CGPA is below the required minimum.',
  });
  if (!cgpaOk) reasons.push(`CGPA is below the required minimum of ${drive.minimumCGPA}.`);

  /* ------------------------------- Rule 4: branch ------------------------------ */
  const branches = drive.branches || [];
  const branchOk = branches.length === 0 || branches.includes(student.branch);
  checks.push({
    label: 'Eligible branches',
    required: branches.length ? branches.join(' / ') : 'All branches',
    actual: student.branch,
    passed: branchOk,
    detail: branchOk
      ? 'Your branch is allowed for this drive.'
      : `This drive is open to ${branches.join(' / ')} students only.`,
  });
  if (!branchOk) reasons.push(`Your branch (${student.branch}) is not in the eligible branch list.`);

  /* ------------------------------- Rule 5: skills ------------------------------ */
  const required = drive.requiredSkills || [];
  const missing = getMissingSkills(student.skills, required);
  // 'all' -> every required skill needed;  'any' -> at least one of them
  const skillOk =
    required.length === 0 ||
    (drive.skillMatchMode === 'any' ? missing.length < required.length : missing.length === 0);

  checks.push({
    label: 'Required skills',
    required: required.length
      ? `${required.join(' / ')}${drive.skillMatchMode === 'any' ? ' (any one)' : ' (all)'}`
      : 'No specific skills',
    actual: (student.skills || []).join(', ') || 'No skills added',
    passed: skillOk,
    detail: skillOk
      ? 'Your skills match the requirement.'
      : `Missing required skill${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
  });
  if (!skillOk) reasons.push(`Missing required skill${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);

  /* --------------------------------- Result --------------------------------- */
  // The student is eligible only when every single rule passed.
  const eligible = checks.every((check) => check.passed);

  return {
    eligible,
    reasons,
    // Short summary used on cards ("Eligible" / "Not eligible").
    summary: eligible ? 'Eligible' : 'Not eligible',
    checks,
  };
}

/**
 * Small wrapper used by list pages: adds the result to the drive object so the
 * card components do not have to call checkEligibility themselves.
 */
export function withEligibility(student, drive) {
  return { ...drive, eligibility: checkEligibility(student, drive) };
}
