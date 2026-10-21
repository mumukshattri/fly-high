/**
 * utils/selectors.js
 * ===========================================================================
 * PURE FUNCTIONS THAT JOIN OUR COLLECTIONS TOGETHER
 * ===========================================================================
 *
 * React components should not contain loops and lookup logic. Instead the
 * components call these small functions:
 *
 *   <DriveCard drive={enrichDrive(drive, companies)} />
 *
 * A MongoDB backend would do this joining with `$lookup` in an aggregation
 * pipeline; here we do it in JavaScript so the components stay readable.
 */

import { checkEligibility } from './eligibility';

/** Find the company that posted a drive. */
export function getCompanyForDrive(drive, companies) {
  if (!drive) return null;
  return companies.find((company) => company.id === drive.companyId) || null;
}

/** Drive + its company, ready for DriveCard / DriveDetails. */
export function enrichDrive(drive, companies) {
  const company = getCompanyForDrive(drive, companies);
  return { ...drive, company, companyName: company ? company.name : 'Unknown company' };
}

/** Application + student + drive + company, ready for the tracker pages. */
export function enrichApplication(application, { students, companies, drives }) {
  const student = students.find((item) => item.id === application.studentId) || null;
  const drive = drives.find((item) => item.id === application.driveId) || null;
  const company = drive ? getCompanyForDrive(drive, companies) : null;

  return {
    ...application,
    student,
    studentName: student ? student.name : 'Unknown student',
    drive,
    company,
    companyName: company ? company.name : 'Unknown company',
    role: drive ? drive.role : '—',
  };
}

/** All applications of one student, newest first. */
export function getStudentApplications(studentId, state) {
  return state.applications
    .filter((application) => application.studentId === studentId)
    .map((application) => enrichApplication(application, state))
    .sort((a, b) => (a.appliedOn < b.appliedOn ? 1 : -1));
}

/** All applications received by one company (across all of its drives). */
export function getCompanyApplications(companyId, state) {
  const driveIds = state.drives
    .filter((drive) => drive.companyId === companyId)
    .map((drive) => drive.id);

  return state.applications
    .filter((application) => driveIds.includes(application.driveId))
    .map((application) => enrichApplication(application, state));
}

/** The drives posted by one company, with applicant counts attached. */
export function getCompanyDrives(companyId, state) {
  return state.drives
    .filter((drive) => drive.companyId === companyId)
    .map((drive) => ({
      ...drive,
      applicantCount: state.applications.filter((application) => application.driveId === drive.id).length,
    }))
    .sort((a, b) => (a.postedOn < b.postedOn ? 1 : -1));
}

/**
 * The four numbers on the student dashboard:
 * eligible drives, applications, shortlisted, selected.
 */
export function getStudentDashboardStats(student, state) {
  if (!student) {
    return { eligibleDrives: 0, openDrives: 0, applications: 0, shortlisted: 0, selected: 0 };
  }

  const myApplications = state.applications.filter(
    (application) => application.studentId === student.id,
  );

  // Drives that are still open AND pass every eligibility rule.
  const eligibleDrives = state.drives.filter(
    (drive) => drive.status === 'Open' && checkEligibility(student, drive).eligible,
  ).length;

  return {
    eligibleDrives,
    openDrives: state.drives.filter((drive) => drive.status === 'Open').length,
    applications: myApplications.length,
    shortlisted: myApplications.filter((application) => application.status === 'Shortlisted').length,
    selected: myApplications.filter((application) => application.status === 'Selected').length,
  };
}

/**
 * The "recommended drives" list on the dashboard: open drives the student is
 * eligible for and has not applied to yet, sorted by nearest deadline.
 */
export function getRecommendedDrives(student, state, limit = 4) {
  if (!student) return [];

  const appliedDriveIds = state.applications
    .filter((application) => application.studentId === student.id)
    .map((application) => application.driveId);

  return state.drives
    .filter(
      (drive) =>
        drive.status === 'Open' &&
        !appliedDriveIds.includes(drive.id) &&
        checkEligibility(student, drive).eligible,
    )
    // Attach the company AND the eligibility result so <DriveCard /> can render
    // both the company name and the green/red eligibility strip.
    .map((drive) => ({
      ...enrichDrive(drive, state.companies),
      eligibility: checkEligibility(student, drive),
    }))
    .sort((a, b) => (a.deadline > b.deadline ? 1 : -1)) // nearest deadline first
    .slice(0, limit);
}

/**
 * Filter helper used by the Recruitment Drives page.
 * @param {Array} drives   enriched drives (already contain `company` + `eligibility`)
 * @param {object} filters { search, branch, minCgpa, skill, status, deadlineWithinDays, onlyEligible }
 */
export function filterDrives(drives, filters = {}) {
  const search = (filters.search || '').trim().toLowerCase();

  return drives.filter((drive) => {
    // 1. Free-text search across company name, role, location and skills.
    if (search) {
      const haystack = `${drive.companyName} ${drive.role} ${drive.location} ${(drive.requiredSkills || []).join(' ')}`;
      if (!haystack.toLowerCase().includes(search)) return false;
    }

    // 2. Branch: the drive must be open to the selected branch.
    if (filters.branch && !(drive.branches || []).includes(filters.branch)) return false;

    // 3. Only keep drives whose minimum CGPA is not above the filtered value.
    if (filters.minCgpa && Number(drive.minimumCGPA) > Number(filters.minCgpa)) return false;

    // 4. Skill filter.
    if (filters.skill) {
      const skills = (drive.requiredSkills || []).map((skill) => skill.toLowerCase());
      if (!skills.includes(filters.skill.toLowerCase())) return false;
    }

    // 5. Drive status (Open / Closed).
    if (filters.status && drive.status !== filters.status) return false;

    // 6. Deadline window - only show drives closing within N days.
    if (filters.deadlineWithinDays) {
      const closing = new Date(`${drive.deadline}T23:59:59`).getTime();
      const limit = Date.now() + Number(filters.deadlineWithinDays) * 24 * 60 * 60 * 1000;
      if (closing > limit) return false;
    }

    // 7. "Only show drives I am eligible for".
    if (filters.onlyEligible && !(drive.eligibility && drive.eligibility.eligible)) return false;

    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* ADMIN AGGREGATES (Placement cell views)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every aggregate number the admin dashboard and statistics page need.
 * This is the frontend equivalent of GET /api/admin/statistics: on MongoDB the
 * same object would be produced by an aggregation pipeline with $group/$lookup.
 */
export function getPlacementStatistics(state) {
  const { students, companies, drives, applications } = state;

  const countByStatus = (status) => applications.filter((item) => item.status === status).length;

  // A student is PLACED when at least one of their applications is Selected.
  const placedStudentIds = new Set(
    applications.filter((item) => item.status === 'Selected').map((item) => item.studentId),
  );

  const branches = [...new Set(students.map((student) => student.branch))].sort();

  const branchWise = branches.map((branch) => {
    const inBranch = students.filter((student) => student.branch === branch);
    const ids = inBranch.map((student) => student.id);
    const placed = applications.filter(
      (item) => ids.includes(item.studentId) && item.status === 'Selected',
    ).length;
    const shortlisted = applications.filter(
      (item) => ids.includes(item.studentId) && item.status === 'Shortlisted',
    ).length;

    return {
      branch,
      students: inBranch.length,
      shortlisted,
      placed,
      avgCgpa: inBranch.length
        ? (inBranch.reduce((sum, student) => sum + Number(student.cgpa || 0), 0) / inBranch.length).toFixed(2)
        : '0.00',
      rate: inBranch.length ? Math.round((placed / inBranch.length) * 100) : 0,
    };
  });

  const companyWise = companies
    .map((company) => {
      const companyDriveIds = drives.filter((drive) => drive.companyId === company.id).map((drive) => drive.id);
      const applied = applications.filter((item) => companyDriveIds.includes(item.driveId));
      const selected = applied.filter((item) => item.status === 'Selected').length;

      return {
        company,
        drives: companyDriveIds.length,
        applications: applied.length,
        shortlisted: applied.filter((item) => item.status === 'Shortlisted').length,
        selected,
        conversion: applied.length ? Math.round((selected / applied.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.applications - a.applications);

  // Highest / average package: parse '18.0 LPA' -> 18
  const packages = drives
    .map((drive) => parseFloat(String(drive.package).replace(/[^0-9.]/g, '')))
    .filter((value) => !Number.isNaN(value));

  const totalStudents = students.length;
  const placedStudents = placedStudentIds.size;

  return {
    totalStudents,
    totalCompanies: companies.length,
    totalDrives: drives.length,
    activeDrives: drives.filter((drive) => drive.status === 'Open').length,
    totalApplications: applications.length,
    applied: countByStatus('Applied'),
    underReview: countByStatus('Under Review'),
    shortlisted: countByStatus('Shortlisted'),
    selected: countByStatus('Selected'),
    rejected: countByStatus('Rejected'),
    placedStudents,
    placementRate: totalStudents ? Math.round((placedStudents / totalStudents) * 100) : 0,
    averageCgpa: totalStudents
      ? (students.reduce((sum, student) => sum + Number(student.cgpa || 0), 0) / totalStudents).toFixed(2)
      : '0.00',
    highestPackage: packages.length ? Math.max(...packages).toFixed(1) + ' LPA' : '-',
    averagePackage: packages.length
      ? (packages.reduce((sum, value) => sum + value, 0) / packages.length).toFixed(1) + ' LPA'
      : '-',
    funnel: ['Applied', 'Under Review', 'Shortlisted', 'Selected', 'Rejected'].map((status) => ({
      status,
      count: countByStatus(status),
      percent: applications.length
        ? Math.round((countByStatus(status) / applications.length) * 100)
        : 0,
    })),
    branchWise,
    companyWise,
  };
}

/** Rows for the admin "Students" table: student + derived placement info. */
export function getStudentRows(state) {
  return state.students.map((student) => {
    const mine = state.applications.filter((item) => item.studentId === student.id);
    return {
      ...student,
      applicationCount: mine.length,
      shortlistedCount: mine.filter((item) => item.status === 'Shortlisted').length,
      isPlaced: mine.some((item) => item.status === 'Selected'),
    };
  });
}

/** Rows for the admin "Companies" cards. */
export function getCompanyRows(state) {
  return state.companies.map((company) => {
    const companyDrives = state.drives.filter((drive) => drive.companyId === company.id);
    const applied = state.applications.filter((item) =>
      companyDrives.some((drive) => drive.id === item.driveId),
    );
    return {
      ...company,
      totalDrives: companyDrives.length,
      activeDrives: companyDrives.filter((drive) => drive.status === 'Open').length,
      totalApplications: applied.length,
      selected: applied.filter((item) => item.status === 'Selected').length,
    };
  });
}

/** Rows for the admin "All drives" table. */
export function getDriveRows(state) {
  return state.drives.map((drive) => {
    const applied = state.applications.filter((item) => item.driveId === drive.id);
    return {
      ...enrichDrive(drive, state.companies),
      applicantCount: applied.length,
      shortlistedCount: applied.filter((item) => item.status === 'Shortlisted').length,
      selectedCount: applied.filter((item) => item.status === 'Selected').length,
    };
  });
}

/** Every distinct skill mentioned by any drive - used to fill the Skills filter. */
export function getAllRequiredSkills(drives) {
  return [...new Set(drives.flatMap((drive) => drive.requiredSkills || []))].sort();
}

/** Every distinct branch appearing on any drive - used to fill the Branch filter. */
export function getAllDriveBranches(drives) {
  return [...new Set(drives.flatMap((drive) => drive.branches || []))].sort();
}
