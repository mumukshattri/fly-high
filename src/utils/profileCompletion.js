/**
 * utils/profileCompletion.js
 * ---------------------------------------------------------------------------
 * Calculates the "Profile completion %" shown on the profile card and in the
 * profile page header. Each item below is worth an equal share of 100%.
 *
 * We keep this as a pure function (data in -> number out) so it is easy to
 * explain and easy to unit test.
 */

const PROFILE_FIELDS = [
  { key: 'name', label: 'Full name' },
  { key: 'email', label: 'Email address' },
  { key: 'phone', label: 'Phone number' },
  { key: 'rollNumber', label: 'Roll number' },
  { key: 'university', label: 'University' },
  { key: 'branch', label: 'Branch' },
  { key: 'semester', label: 'Semester' },
  { key: 'cgpa', label: 'CGPA' },
  { key: 'graduationYear', label: 'Graduation year' },
  { key: 'about', label: 'About / bio' },
];

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  return true;
};

/**
 * @returns {{ percent: number, missing: string[] }}
 *   percent -> 0..100 (rounded)
 *   missing -> friendly labels of the fields still to be filled
 */
export function getProfileCompletion(student) {
  if (!student) return { percent: 0, missing: ['Profile not loaded'] };

  const missing = PROFILE_FIELDS.filter((field) => !hasValue(student[field.key])).map((f) => f.label);

  const skills = student.skills || [];
  if (skills.length < 3) missing.push('At least 3 skills');
  if (!student.resume || !student.resume.fileName) missing.push('Resume upload');

  // Weight: the 10 fixed fields + 2 extra items (skills, resume) = 12 items
  const totalItems = PROFILE_FIELDS.length + 2;
  const completedItems = totalItems - missing.length;

  return {
    percent: Math.round((completedItems / totalItems) * 100),
    missing,
  };
}
