/**
 * utils/profileCompletion.js
 * ---------------------------------------------------------------------------
 * Profile completion, shared by the browser and the Express server.
 *
 * The server imports this exact module (`server/api.js` already imports the
 * eligibility engine from src/utils), so the percentage a student sees and the
 * percentage an administrator filters on can never disagree.
 *
 * Each section carries a weight and its own checklist. `percent` is the
 * weighted total, rounded.
 */

export const PROFILE_SECTIONS = [
  {
    key: 'personal',
    label: 'Personal information',
    weight: 15,
    items: [
      { key: 'name', label: 'Full name' },
      { key: 'email', label: 'Email address' },
      { key: 'phone', label: 'Phone number' },
      { key: 'university', label: 'University / institution' },
      { key: 'rollNumber', label: 'Roll number' },
    ],
  },
  {
    key: 'academic',
    label: 'Academic information',
    weight: 25,
    items: [
      { key: 'department', label: 'Department' },
      { key: 'degree', label: 'Degree / programme' },
      { key: 'currentYear', label: 'Current academic year', numeric: true },
      { key: 'graduationYear', label: 'Graduation year', numeric: true },
      { key: 'cgpa', label: 'CGPA', numeric: true },
    ],
  },
  {
    key: 'skills',
    label: 'Technical skills',
    weight: 20,
    items: [{ key: 'atLeastThreeSkills', label: 'At least 3 technical skills' }],
  },
  {
    key: 'projects',
    label: 'Projects & experience',
    weight: 10,
    items: [{ key: 'projectsOrExperience', label: 'A project or an internship' }],
  },
  {
    key: 'preferences',
    label: 'Career preferences',
    weight: 15,
    items: [
      { key: 'preferredRoles', label: 'Preferred job roles' },
      { key: 'preferredLocations', label: 'Preferred locations' },
    ],
  },
  {
    key: 'resume',
    label: 'Resume',
    weight: 15,
    items: [{ key: 'resume', label: 'Resume upload' }],
  },
];

const filled = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/** Every distinct skill on the profile, across all four skill buckets. */
export function collectStudentSkills(student = {}) {
  return [
    ...(student.skills || []),
    ...(student.programmingLanguages || []),
    ...(student.frameworks || []),
    ...(student.databases || []),
    ...(student.tools || []),
    ...(student.resumeExtract?.skills || []),
  ]
    .map((skill) => String(skill || '').trim())
    .filter(Boolean);
}

/** A student document / serialized student -> one boolean per checklist item. */
function evaluate(student = {}) {
  const skills = collectStudentSkills(student);
  const distinctSkills = new Set(skills.map((skill) => skill.toLowerCase()));
  const preferences = student.preferences || {};

  return {
    name: filled(student.name),
    email: filled(student.email),
    phone: filled(student.phone),
    university: filled(student.university) && student.university !== 'Not specified',
    rollNumber: filled(student.rollNumber) || filled(student.enrollmentNumber),

    // `branch` predates `department`, so a legacy profile that only has a
    // branch still counts as having given its department.
    department: filled(student.department) || filled(student.branch),
    degree: filled(student.degree),
    currentYear: filled(student.currentYear) || filled(student.semester),
    graduationYear: filled(student.graduationYear),
    cgpa: filled(student.cgpa),

    atLeastThreeSkills: distinctSkills.size >= 3,
    projectsOrExperience: (student.projects || []).length > 0 || (student.experiences || []).length > 0,

    preferredRoles: (preferences.roles || []).length > 0,
    preferredLocations: (preferences.locations || []).length > 0,

    resume: Boolean(student.resume && student.resume.fileName),
  };
}

/**
 * @returns {{
 *   percent: number,
 *   missing: string[],
 *   resumeUploaded: boolean,
 *   sections: Array<{key, label, weight, percent, missing: string[]}>
 * }}
 */
export function getProfileCompletion(student) {
  if (!student) {
    return {
      percent: 0,
      missing: ['Profile not loaded'],
      resumeUploaded: false,
      sections: [],
    };
  }

  const state = evaluate(student);
  const missing = [];
  let total = 0;

  const sections = PROFILE_SECTIONS.map((section) => {
    const sectionMissing = section.items.filter((item) => !state[item.key]).map((item) => item.label);
    const done = section.items.length - sectionMissing.length;
    const ratio = section.items.length === 0 ? 1 : done / section.items.length;
    total += ratio * section.weight;

    missing.push(...sectionMissing);

    return {
      key: section.key,
      label: section.label,
      weight: section.weight,
      percent: Math.round(ratio * 100),
      missing: sectionMissing,
    };
  });

  return {
    percent: Math.round(total),
    missing,
    resumeUploaded: state.resume,
    sections,
  };
}

export default getProfileCompletion;
