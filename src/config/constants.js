/**
 * config/constants.js
 * ---------------------------------------------------------------------------
 * Options shared by several forms (register, onboarding, profile, admin
 * filters). Keeping them in one place means a list can never disagree between
 * pages, and the server can import the same module (it already imports
 * src/utils/eligibility.js), so the department chosen in the browser maps onto
 * the same branch code the eligibility engine compares.
 *
 * In a real deployment these lists would come from an endpoint so the college
 * could edit them without a redeploy; they are data, not rules.
 */

export const BRANCHES = ['CSE', 'IT', 'ENTC', 'ECE', 'MECH', 'CIVIL'];

export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

export const JOB_TYPES = ['Full Time', 'Internship', 'Internship + PPO', 'Part Time'];

export const COMPANY_TIERS = ['Super Dream', 'Dream', 'Standard'];

export const SKILL_MATCH_MODES = [
  { value: 'any', label: 'Any one of the listed skills' },
  { value: 'all', label: 'All of the listed skills' },
];

/**
 * Departments with the short branch code drives already use. `other` lets a
 * college add something we did not anticipate without a code change.
 */
export const DEPARTMENTS = [
  { label: 'Computer Science and Engineering', branch: 'CSE' },
  { label: 'Information Technology', branch: 'IT' },
  { label: 'Electronics and Telecommunication Engineering', branch: 'ENTC' },
  { label: 'Electronics and Communication Engineering', branch: 'ECE' },
  { label: 'Electrical Engineering', branch: 'EE' },
  { label: 'Mechanical Engineering', branch: 'MECH' },
  { label: 'Civil Engineering', branch: 'CIVIL' },
  { label: 'Artificial Intelligence and Machine Learning', branch: 'CSE' },
  { label: 'Data Science', branch: 'CSE' },
  { label: 'Chemical Engineering', branch: 'CHEM' },
  { label: 'Instrumentation Engineering', branch: 'INST' },
  { label: 'Other', branch: 'OTHER' },
];

export const DEPARTMENT_LABELS = DEPARTMENTS.map((item) => item.label);

/** Map a full department name onto the short code a drive compares against. */
export function departmentToBranch(department) {
  const value = String(department || '').trim().toLowerCase();
  if (!value) return '';
  const exact = DEPARTMENTS.find((item) => item.label.toLowerCase() === value);
  if (exact) return exact.branch;

  // Free-text departments ("Computer Science", "IT dept") still map sensibly.
  if (/computer science|cse|software/.test(value)) return 'CSE';
  if (/information technology|^it$|\bit\b/.test(value)) return 'IT';
  if (/electronics.*telecommunication|entc|e&tc/.test(value)) return 'ENTC';
  if (/electronics|ece/.test(value)) return 'ECE';
  if (/electrical|eee/.test(value)) return 'EE';
  if (/mechanical|mech/.test(value)) return 'MECH';
  if (/civil/.test(value)) return 'CIVIL';
  if (/chemical/.test(value)) return 'CHEM';
  if (/instrumentation/.test(value)) return 'INST';
  return 'OTHER';
}

/** The readable department for a legacy branch code. */
export function branchToDepartment(branch) {
  const value = String(branch || '').trim().toUpperCase();
  return DEPARTMENTS.find((item) => item.branch === value && item.label !== 'Other')?.label || '';
}

export const DEGREES = ['B.Tech', 'B.E.', 'M.Tech', 'M.E.', 'BCA', 'MCA', 'B.Sc', 'M.Sc', 'MBA', 'B.Com', 'Ph.D', 'Other'];

export const ACADEMIC_YEARS = [1, 2, 3, 4, 5];

export const WORK_MODES = [
  { value: 'Any', label: 'No preference' },
  { value: 'Onsite', label: 'On-site' },
  { value: 'Hybrid', label: 'Hybrid' },
  { value: 'Remote', label: 'Remote' },
];

export const EMPLOYMENT_PREFERENCES = [
  { value: 'Any', label: 'Open to both' },
  { value: 'Full Time', label: 'Full time' },
  { value: 'Internship', label: 'Internship' },
];

export const SKILL_GROUPS = [
  { key: 'skills', label: 'Technical skills', placeholder: 'e.g. Data Structures' },
  { key: 'programmingLanguages', label: 'Programming languages', placeholder: 'e.g. Python' },
  { key: 'frameworks', label: 'Frameworks & libraries', placeholder: 'e.g. React' },
  { key: 'databases', label: 'Databases', placeholder: 'e.g. MongoDB' },
  { key: 'tools', label: 'Tools & platforms', placeholder: 'e.g. Docker' },
];

export const ROLE_SUGGESTIONS = [
  'Software Engineer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'Data Analyst',
  'Data Scientist',
  'DevOps Engineer',
  'QA Engineer',
  'Business Analyst',
  'Mechanical Design Engineer',
  'Electrical Engineer',
  'Civil Site Engineer',
];

export const LOCATION_SUGGESTIONS = [
  'Pune',
  'Mumbai',
  'Bengaluru',
  'Hyderabad',
  'Chennai',
  'Delhi NCR',
  'Noida',
  'Gurugram',
  'Ahmedabad',
  'Kolkata',
  'Remote',
];

export const INDUSTRY_SUGGESTIONS = [
  'Information Technology',
  'Product Engineering',
  'Financial Services',
  'Consulting',
  'Manufacturing',
  'Automotive',
  'Healthcare',
  'E-commerce',
  'Education',
  'Energy',
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

/** Onboarding wizard steps, shared by the wizard and the progress indicator. */
export const ONBOARDING_STEPS = [
  { key: 'personal', title: 'Personal information', hint: 'Who you are and where you study' },
  { key: 'academic', title: 'Academic information', hint: 'Your course, department and marks' },
  { key: 'professional', title: 'Skills & experience', hint: 'What you can actually do' },
  { key: 'preferences', title: 'Career preferences', hint: 'The roles and places you want' },
  { key: 'resume', title: 'Resume', hint: 'Upload a PDF or DOCX (optional for now)' },
  { key: 'review', title: 'Review & finish', hint: 'Check everything before saving' },
];
