/**
 * mockApplications.js
 * ---------------------------------------------------------------------------
 * DEMO DATA ONLY. Mirrors the `applications` collection
 * (GET /api/applications, POST /api/applications, GET /api/applications/:id).
 *
 * An application links ONE student to ONE drive. The company then moves it
 * through the hiring pipeline:
 *
 *   Applied -> Under Review -> Shortlisted -> Selected
 *                (or Rejected at any stage)
 *
 * `statusHistory` is what the progress tracker on the application details page
 * renders. A real backend would keep this in the same document (or in a
 * separate `application_status_history` collection).
 */

export const APPLICATION_STATUSES = [
  'Applied',
  'Under Review',
  'Shortlisted',
  'Selected',
  'Rejected',
];

/** The happy-path pipeline shown in the progress tracker (Rejected is off-path). */
export const PIPELINE_STAGES = ['Applied', 'Under Review', 'Shortlisted', 'Selected'];

/**
 * Helper that builds a status timeline.
 * @param {string} appliedOn ISO date of the first application
 * @param {Array}  later     subsequent status changes, oldest first
 */
const buildHistory = (appliedOn, later = []) => [
  { status: 'Applied', date: appliedOn, note: 'Application submitted by the student.' },
  ...later,
];

export const applications = [
  /* ------------------------- Demo student: Aarav Sharma (stu-101) ------------------------- */
  {
    id: 'app-2001',
    driveId: 'drv-02',
    studentId: 'stu-101',
    status: 'Shortlisted',
    appliedOn: '2026-09-28',
    lastUpdated: '2026-10-03',
    recruiterNote: 'Good aptitude score. Scheduled for technical interview on 12 Oct.',
    statusHistory: buildHistory('2026-09-28', [
      { status: 'Under Review', date: '2026-10-01', note: 'Resume screened by the recruiter.' },
      { status: 'Shortlisted', date: '2026-10-03', note: 'Shortlisted after the online assessment.' },
    ]),
  },
  {
    id: 'app-2002',
    driveId: 'drv-06',
    studentId: 'stu-101',
    status: 'Under Review',
    appliedOn: '2026-10-02',
    lastUpdated: '2026-10-04',
    recruiterNote: 'Written programming round score pending.',
    statusHistory: buildHistory('2026-10-02', [
      { status: 'Under Review', date: '2026-10-04', note: 'Application opened by the recruiter.' },
    ]),
  },
  {
    id: 'app-2003',
    driveId: 'drv-03',
    studentId: 'stu-101',
    status: 'Applied',
    appliedOn: '2026-10-01',
    lastUpdated: '2026-10-01',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-01'),
  },
  {
    id: 'app-2004',
    driveId: 'drv-07',
    studentId: 'stu-101',
    status: 'Rejected',
    appliedOn: '2026-09-25',
    lastUpdated: '2026-10-05',
    recruiterNote: 'Not moving ahead - automation testing experience not demonstrated.',
    statusHistory: buildHistory('2026-09-25', [
      { status: 'Under Review', date: '2026-09-30', note: 'Resume screened.' },
      { status: 'Rejected', date: '2026-10-05', note: 'Profile did not match the QA automation requirement.' },
    ]),
  },

  /* ------------------------ TechNova SDE applicants (recruiter demo) ------------------------ */
  {
    id: 'app-2010',
    driveId: 'drv-01',
    studentId: 'stu-103',
    status: 'Shortlisted',
    appliedOn: '2026-09-25',
    lastUpdated: '2026-10-02',
    recruiterNote: 'Strong DSA performance, 600+ problems solved.',
    statusHistory: buildHistory('2026-09-25', [
      { status: 'Under Review', date: '2026-09-30', note: 'Coding assessment cleared.' },
      { status: 'Shortlisted', date: '2026-10-02', note: 'Shortlisted for technical interview.' },
    ]),
  },
  {
    id: 'app-2011',
    driveId: 'drv-01',
    studentId: 'stu-112',
    status: 'Under Review',
    appliedOn: '2026-09-26',
    lastUpdated: '2026-10-01',
    recruiterNote: '',
    statusHistory: buildHistory('2026-09-26', [
      { status: 'Under Review', date: '2026-10-01', note: 'Resume under screening.' },
    ]),
  },
  {
    id: 'app-2012',
    driveId: 'drv-01',
    studentId: 'stu-104',
    status: 'Applied',
    appliedOn: '2026-09-30',
    lastUpdated: '2026-09-30',
    recruiterNote: '',
    statusHistory: buildHistory('2026-09-30'),
  },
  {
    id: 'app-2013',
    driveId: 'drv-01',
    studentId: 'stu-106',
    status: 'Applied',
    appliedOn: '2026-10-01',
    lastUpdated: '2026-10-01',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-01'),
  },
  {
    id: 'app-2014',
    driveId: 'drv-01',
    studentId: 'stu-110',
    status: 'Applied',
    appliedOn: '2026-10-02',
    lastUpdated: '2026-10-02',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-02'),
  },

  /* ---------------------------------- Infosys (drv-02) ---------------------------------- */
  {
    id: 'app-2020',
    driveId: 'drv-02',
    studentId: 'stu-110',
    status: 'Under Review',
    appliedOn: '2026-09-29',
    lastUpdated: '2026-10-02',
    recruiterNote: '',
    statusHistory: buildHistory('2026-09-29', [
      { status: 'Under Review', date: '2026-10-02', note: 'Online test score verified.' },
    ]),
  },
  {
    id: 'app-2021',
    driveId: 'drv-02',
    studentId: 'stu-107',
    status: 'Rejected',
    appliedOn: '2026-09-27',
    lastUpdated: '2026-10-01',
    recruiterNote: 'Aptitude cut-off not cleared.',
    statusHistory: buildHistory('2026-09-27', [
      { status: 'Rejected', date: '2026-10-01', note: 'Aptitude cut-off not cleared.' },
    ]),
  },

  /* ----------------------------------- TCS (drv-03) ----------------------------------- */
  {
    id: 'app-2030',
    driveId: 'drv-03',
    studentId: 'stu-105',
    status: 'Applied',
    appliedOn: '2026-10-01',
    lastUpdated: '2026-10-01',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-01'),
  },
  {
    id: 'app-2031',
    driveId: 'drv-03',
    studentId: 'stu-108',
    status: 'Applied',
    appliedOn: '2026-10-02',
    lastUpdated: '2026-10-02',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-02'),
  },

  /* -------------------------------- Deloitte (drv-05) -------------------------------- */
  {
    id: 'app-2040',
    driveId: 'drv-05',
    studentId: 'stu-112',
    status: 'Shortlisted',
    appliedOn: '2026-10-02',
    lastUpdated: '2026-10-05',
    recruiterNote: 'Case study round cleared with distinction.',
    statusHistory: buildHistory('2026-10-02', [
      { status: 'Under Review', date: '2026-10-03', note: 'Resume shortlisted.' },
      { status: 'Shortlisted', date: '2026-10-05', note: 'Case study round cleared.' },
    ]),
  },
  {
    id: 'app-2041',
    driveId: 'drv-05',
    studentId: 'stu-103',
    status: 'Under Review',
    appliedOn: '2026-10-03',
    lastUpdated: '2026-10-04',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-03', [
      { status: 'Under Review', date: '2026-10-04', note: 'Resume under review.' },
    ]),
  },
  {
    id: 'app-2042',
    driveId: 'drv-05',
    studentId: 'stu-106',
    status: 'Applied',
    appliedOn: '2026-10-04',
    lastUpdated: '2026-10-04',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-04'),
  },

  /* --------------------------------- Zoho (drv-06) --------------------------------- */
  {
    id: 'app-2050',
    driveId: 'drv-06',
    studentId: 'stu-105',
    status: 'Applied',
    appliedOn: '2026-10-03',
    lastUpdated: '2026-10-03',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-03'),
  },

  /* ------------------------- Persistent QA Automation (drv-07) ------------------------- */
  {
    id: 'app-2060',
    driveId: 'drv-07',
    studentId: 'stu-105',
    status: 'Shortlisted',
    appliedOn: '2026-09-26',
    lastUpdated: '2026-10-03',
    recruiterNote: 'Selenium basics verified in the screening call.',
    statusHistory: buildHistory('2026-09-26', [
      { status: 'Under Review', date: '2026-09-29', note: 'Online assessment cleared.' },
      { status: 'Shortlisted', date: '2026-10-03', note: 'Shortlisted for technical round.' },
    ]),
  },
  {
    id: 'app-2061',
    driveId: 'drv-07',
    studentId: 'stu-107',
    status: 'Selected',
    appliedOn: '2026-09-26',
    lastUpdated: '2026-10-05',
    recruiterNote: 'Offer released. Joining in July 2027.',
    statusHistory: buildHistory('2026-09-26', [
      { status: 'Under Review', date: '2026-09-29', note: 'Assessment cleared.' },
      { status: 'Shortlisted', date: '2026-10-02', note: 'Cleared technical interview.' },
      { status: 'Selected', date: '2026-10-05', note: 'Offer letter released.' },
    ]),
  },

  /* ---------------------- Luminar Analytics internship (drv-08) ---------------------- */
  {
    id: 'app-2070',
    driveId: 'drv-08',
    studentId: 'stu-104',
    status: 'Selected',
    appliedOn: '2026-09-24',
    lastUpdated: '2026-10-01',
    recruiterNote: 'Portfolio review cleared. Internship offer sent.',
    statusHistory: buildHistory('2026-09-24', [
      { status: 'Under Review', date: '2026-09-27', note: 'GitHub reviewed.' },
      { status: 'Shortlisted', date: '2026-09-29', note: 'Founder round cleared.' },
      { status: 'Selected', date: '2026-10-01', note: 'Internship offer released.' },
    ]),
  },
  {
    id: 'app-2071',
    driveId: 'drv-08',
    studentId: 'stu-110',
    status: 'Applied',
    appliedOn: '2026-10-04',
    lastUpdated: '2026-10-04',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-04'),
  },

  /* ---------------------------- TechNova Data Analyst (drv-09) ---------------------------- */
  {
    id: 'app-2080',
    driveId: 'drv-09',
    studentId: 'stu-106',
    status: 'Applied',
    appliedOn: '2026-10-05',
    lastUpdated: '2026-10-05',
    recruiterNote: '',
    statusHistory: buildHistory('2026-10-05'),
  },

  /* --------------------------- Closed drive (historical record) --------------------------- */
  {
    id: 'app-2090',
    driveId: 'drv-10',
    studentId: 'stu-105',
    status: 'Rejected',
    appliedOn: '2026-09-10',
    lastUpdated: '2026-09-22',
    recruiterNote: 'Not selected in the Digital round.',
    statusHistory: buildHistory('2026-09-10', [
      { status: 'Under Review', date: '2026-09-15', note: 'NQT score verified.' },
      { status: 'Rejected', date: '2026-09-22', note: 'Not selected in the Digital round.' },
    ]),
  },
];
