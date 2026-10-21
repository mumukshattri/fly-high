/**
 * config/constants.js
 * ---------------------------------------------------------------------------
 * Options shared by several forms (register, profile, create-drive). Keeping
 * them in one place means the branch list can never disagree between pages.
 *
 * In the real system these lists would come from the backend
 * (GET /api/meta/branches) so the college can change them without a redeploy.
 */

export const BRANCHES = ['CSE', 'IT', 'ENTC', 'ECE', 'MECH', 'CIVIL'];

export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

export const JOB_TYPES = ['Full Time', 'Internship', 'Internship + PPO', 'Part Time'];

export const COMPANY_TIERS = ['Super Dream', 'Dream', 'Standard'];

export const SKILL_MATCH_MODES = [
  { value: 'any', label: 'Any one of the listed skills' },
  { value: 'all', label: 'All of the listed skills' },
];

export const SKILL_SUGGESTIONS = [
  'Java',
  'Python',
  'React',
  'JavaScript',
  'Node.js',
  'SQL',
  'Data Structures',
  'Spring Boot',
  'Git',
  'Selenium',
  'AWS',
  'MongoDB',
];
