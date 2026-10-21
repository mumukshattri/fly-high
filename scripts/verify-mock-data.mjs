/**
 * scripts/verify-mock-data.mjs
 * ---------------------------------------------------------------------------
 * A tiny developer check (run with `npm run verify:data`).
 *
 * It proves that the demo data is SELF-CONSISTENT, which matters during a viva:
 * an examiner will notice if a student who is "not eligible" somehow already
 * has an application for that drive.
 *
 * It verifies:
 *   1. every application points to an existing student and drive
 *   2. no student applied twice to the same drive
 *   3. every seeded application was made by an ELIGIBLE student
 *   4. the statusHistory of every application ends with its current status
 *   5. deadline / status dates are ordered sensibly
 */

import { students } from '../src/data/mockStudents.js';
import { companies } from '../src/data/mockCompanies.js';
import { drives } from '../src/data/mockDrives.js';
import { applications } from '../src/data/mockApplications.js';
import { checkEligibility } from '../src/utils/eligibility.js';

const problems = [];
const note = (message) => problems.push(message);

/* 1 + 2 + 4: referential integrity and no duplicates */
const seen = new Set();
for (const application of applications) {
  const student = students.find((item) => item.id === application.studentId);
  const drive = drives.find((item) => item.id === application.driveId);

  if (!student) note(`Application ${application.id}: unknown student ${application.studentId}`);
  if (!drive) note(`Application ${application.id}: unknown drive ${application.driveId}`);

  const key = `${application.studentId}:${application.driveId}`;
  if (seen.has(key)) note(`Duplicate application: ${student?.name || application.studentId} -> ${drive?.role}`);
  seen.add(key);

  if (drive) {
    const company = companies.find((item) => item.id === drive.companyId);
    if (!company) note(`Drive ${drive.id} references unknown company ${drive.companyId}`);
  }

  const last = application.statusHistory[application.statusHistory.length - 1];
  if (!last || last.status !== application.status) {
    note(`Application ${application.id}: history ends with "${last?.status}" but status is "${application.status}"`);
  }
}

/* 3: eligibility must hold for every seeded application.
   A drive that has since been closed is still a valid HISTORICAL application,
   so for existing records we only enforce the profile-based rules
   (CGPA / branch / skills) and ignore the two time-based rules. */
const TIME_BASED_RULES = ['Drive status', 'Application deadline'];

for (const application of applications) {
  const student = students.find((item) => item.id === application.studentId);
  const drive = drives.find((item) => item.id === application.driveId);
  if (!student || !drive) continue;

  const result = checkEligibility(student, drive);
  const failed = result.checks.filter(
    (check) => !check.passed && !TIME_BASED_RULES.includes(check.label),
  );

  if (failed.length > 0) {
    note(
      `NOT ELIGIBLE but applied: ${student.name} (${student.branch}, CGPA ${student.cgpa}) -> ` +
        `${drive.id} ${drive.role}. ` +
        failed.map((check) => `${check.label}: ${check.detail}`).join(' '),
    );
  }
}

/* 5: dates */
for (const application of applications) {
  if (application.lastUpdated < application.appliedOn) {
    note(`Application ${application.id}: lastUpdated is before appliedOn`);
  }
  let previous = application.appliedOn;
  for (const step of application.statusHistory) {
    if (step.date < previous) {
      note(`Application ${application.id}: history dates go backwards`);
    }
    previous = step.date;
  }
}

/* Summary */
console.log(`Students: ${students.length}  Companies: ${companies.length}  Drives: ${drives.length}  Applications: ${applications.length}`);
console.log('Status funnel:');
for (const status of ['Applied', 'Under Review', 'Shortlisted', 'Selected', 'Rejected']) {
  console.log(`  ${status.padEnd(14)} ${applications.filter((a) => a.status === status).length}`);
}

if (problems.length === 0) {
  console.log('\n✅ Mock data is consistent - no problems found.');
  process.exit(0);
}

console.log(`\n❌ ${problems.length} problem(s) found:`);
problems.forEach((problem) => console.log(`  - ${problem}`));
process.exit(1);
