/**
 * server/matching.js
 * ===========================================================================
 * INTELLIGENT JOB MATCHING ENGINE
 * ===========================================================================
 *
 * Compares a student profile with a genuine Adzuna vacancy and produces a
 * RELEVANCE score with a written explanation. It is deterministic: the same
 * profile and the same listing always produce the same number, which is what
 * makes it testable and explainable in a viva.
 *
 * THIS IS NOT AN ELIGIBILITY ENGINE
 * ---------------------------------
 * An external listing rarely states its full requirements, and inventing a
 * minimum CGPA or an "only CSE" rule from a job advert would be dishonest (and
 * could tell a student they cannot apply when they can). So:
 *
 *   - every factor that the listing does not describe is marked "unknown" and
 *     its weight is redistributed over the factors we do know
 *   - missing information never becomes a mismatch
 *   - `eligibility` is always 'unknown' for external jobs; the student applies
 *     on the employer's own site, where the employer decides
 *
 * Internal campus drives keep using src/utils/eligibility.js, untouched. A
 * match score can never unlock a drive a student is not eligible for.
 *
 * FACTORS AND DEFAULT WEIGHTS
 * ---------------------------
 *   technical skills          40%
 *   education / department    20%
 *   projects & experience     15%
 *   location preference       10%
 *   preferred role            10%
 *   employment preference      5%
 *
 * Both the weights and the label thresholds can be overridden with
 * MATCH_WEIGHTS / MATCH_THRESHOLDS in the environment (see server/config.js).
 */

import { DEFAULT_MATCH_WEIGHTS, MATCH_THRESHOLDS, MATCH_WEIGHTS } from './config.js';
import { extractSkillsFromText, skillKey, uniqueSkills } from './skills.js';

export const FACTOR_LABELS = {
  skills: 'Technical skills',
  education: 'Education & department',
  experience: 'Projects & experience',
  location: 'Location preference',
  role: 'Preferred role',
  employment: 'Employment preference',
};

/** Words that carry no meaning when comparing a role title with a job title. */
const STOP_WORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'for', 'in', 'at', 'to', 'with', 'on', 'de',
  'job', 'jobs', 'role', 'position', 'opening', 'vacancy', 'hiring', 'urgent', 'required',
  'engineer', 'developer', 'intern', 'internship', 'fresher', 'candidate', 'apply', 'now',
]);

const tokens = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/\.$/, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

const overlap = (left, right) => {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token));
};

/* -------------------------------------------------------------------------- */
/* PROFILE                                                                    */
/* -------------------------------------------------------------------------- */

export const WORK_MODE_KEYWORDS = {
  Remote: /\bremote\b|\bwork from home\b|\bwfh\b/i,
  Hybrid: /\bhybrid\b/i,
  Onsite: /\bon-?site\b|\bin office\b/i,
};

export const DEPARTMENT_TOKENS = {
  'Computer Science and Engineering': ['computer science', 'cse', 'cs', 'software'],
  'Information Technology': ['information technology', 'it', 'software'],
  'Artificial Intelligence and Machine Learning': ['artificial intelligence', 'machine learning', 'ai', 'ml', 'data'],
  'Data Science': ['data science', 'data', 'analytics', 'machine learning'],
  'Electronics and Communication Engineering': ['electronics', 'communication', 'ece', 'entc', 'embedded', 'vlsi'],
  'Electrical Engineering': ['electrical', 'power', 'eee'],
  'Mechanical Engineering': ['mechanical', 'mech', 'automobile', 'manufacturing'],
  'Civil Engineering': ['civil', 'construction', 'structural'],
  'Chemical Engineering': ['chemical', 'process'],
  'Instrumentation Engineering': ['instrumentation', 'control systems'],
};

/** Everything a student's profile says about them, in a shape the engine uses. */
export function buildStudentSignal(student = {}) {
  const preferences = student.preferences || {};
  const skillList = uniqueSkills([
    ...(student.skills || []),
    ...(student.programmingLanguages || []),
    ...(student.frameworks || []),
    ...(student.databases || []),
    ...(student.tools || []),
    // Only the saved profile counts. The raw resume extraction may contain
    // skills the student rejected during review, so reading it here would score
    // skills that are not on their profile.
  ]);

  return {
    skills: skillList,
    skillKeys: new Set(skillList.map(skillKey)),
    departmentTokens: [
      ...(DEPARTMENT_TOKENS[student.department] || []),
      ...tokens(student.department),
      ...tokens(student.branch),
      ...tokens(student.specialization),
    ],
    degree: String(student.degree || '').trim(),
    degreeTokens: tokens(student.degree),
    graduationYear: Number(student.graduationYear) || null,
    experiences: student.experiences || [],
    projects: student.projects || [],
    certifications: student.certifications || [],
    preferences: {
      roles: preferences.roles || [],
      locations: preferences.locations || [],
      industries: preferences.industries || [],
      workMode: preferences.workMode || 'Any',
      employmentType: preferences.employmentType || 'Any',
    },
  };
}

/* -------------------------------------------------------------------------- */
/* JOB                                                                        */
/* -------------------------------------------------------------------------- */

/** Facts about a vacancy that we can read from its own text. */
export function readJobSignal(job = {}) {
  const title = String(job.title || '');
  const description = String(job.description || '');
  const category = String(job.category || '');
  const location = String(job.location || '');
  const employment = String(job.employmentType || '');
  const text = `${title}\n${description}\n${category}`;

  const titleSkills = extractSkillsFromText(title, { limit: 12 });
  const allSkills = extractSkillsFromText(text, { limit: 24 });

  // A technology named in the title is what the employer is hiring for; the
  // rest are mentioned somewhere in the advert.
  const requiredSkills = titleSkills;
  const mentionedSkills = allSkills.filter((skill) => !requiredSkills.includes(skill));

  const yearsMatch = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+experience/i.exec(description);
  const requiredYears = yearsMatch ? Number(yearsMatch[1]) : null;

  // Only the body of the advert counts: a title like "Graduate Trainee" is a job
  // label, not a stated education requirement, and must not be scored as one.
  const educationMentioned =
    /\b(b\.?tech|b\.?e\b|bachelor|graduate|degree|bca|mca|b\.?sc|m\.?tech|diploma)\b/i.test(
      description,
    );
  // Disciplines are matched as phrases ("computer science") and as single
  // words ("mechanical"), from the title and the body, so a listing that says
  // "Bachelor of Engineering (Mechanical)" is still understood.
  const departmentPhrases = Object.values(DEPARTMENT_TOKENS).flat();
  const singleWordDisciplines = new Set(departmentPhrases.filter((phrase) => !phrase.includes(' ')));
  const textTokens = tokens(text);
  const departmentTokens = [
    ...textTokens.filter((token) => singleWordDisciplines.has(token)),
    ...departmentPhrases.filter(
      (phrase) => phrase.includes(' ') && text.toLowerCase().includes(phrase),
    ),
  ];

  const workModes = Object.entries(WORK_MODE_KEYWORDS)
    .filter(([, pattern]) => pattern.test(`${location}\n${description}\n${title}`))
    .map(([mode]) => mode);

  const isInternship = /\bintern\b|\binternship\b|\btrainee\b/i.test(`${title}\n${employment}`);
  const isPartTime = /\bpart[- ]time\b/i.test(employment);

  return {
    title,
    description,
    category,
    location,
    employment,
    text,
    requiredSkills,
    mentionedSkills,
    allSkills,
    requiredYears,
    educationMentioned,
    departmentTokens,
    workModes,
    isInternship,
    isPartTime,
  };
}

/* -------------------------------------------------------------------------- */
/* FACTOR SCORERS                                                             */
/* -------------------------------------------------------------------------- */

function scoreSkills(student, job) {
  const considered = job.allSkills.slice(0, 20);
  if (considered.length === 0) {
    return {
      available: false,
      score: null,
      matchedSkills: [],
      missingSkills: [],
      detail: 'The listing does not name a specific technology, so skills were not scored.',
    };
  }

  const matched = considered.filter((skill) => student.skillKeys.has(skillKey(skill)));
  const missing = considered.filter((skill) => !student.skillKeys.has(skillKey(skill)));

  return {
    available: true,
    score: matched.length / considered.length,
    matchedSkills: matched,
    missingSkills: missing,
    detail: `${matched.length} of the ${considered.length} technologies this listing mentions are on your profile.`,
  };
}

function scoreEducation(student, job) {
  const hasProfileField = student.departmentTokens.length > 0 || student.degree;
  if (!job.educationMentioned && job.departmentTokens.length === 0) {
    return {
      available: false,
      score: null,
      relevance: 'Unknown',
      detail: 'The listing does not state an education requirement, so education was not scored.',
    };
  }
  if (!hasProfileField) {
    return {
      available: false,
      score: null,
      relevance: 'Unknown',
      detail: 'Your profile has no department or degree yet, so education was not scored.',
    };
  }

  const sharedTokens = overlap(student.departmentTokens, job.departmentTokens);

  if (sharedTokens.length > 0) {
    return {
      available: true,
      score: 1,
      relevance: 'High',
      detail: `Your field (${student.department || student.branch}) is named in this listing.`,
    };
  }

  if (job.departmentTokens.length > 0) {
    // The listing asks for a different engineering discipline. That is a
    // relevance signal, never a statement that the student cannot apply.
    return {
      available: true,
      score: 0.35,
      relevance: 'Low',
      detail: 'The listing mentions another discipline than yours; read the full advert before applying.',
    };
  }

  return {
    available: true,
    score: 0.8,
    relevance: 'Medium',
    detail: 'The listing asks for a degree but does not name a discipline.',
  };
}

function scoreExperience(student, job) {
  const projectTokens = tokens(
    [
      ...(student.projects || []).map((project) => `${project.title} ${project.description} ${(project.techStack || []).join(' ')}`),
      ...(student.experiences || []).map((item) => `${item.role} ${item.company} ${item.description} ${(item.technologies || []).join(' ')}`),
      ...(student.certifications || []).map((item) => `${item.name} ${item.issuer}`),
    ].join(' '),
  );

  const jobTokens = tokens(job.text);
  const relevant = overlap([...new Set(projectTokens)], jobTokens).slice(0, 8);

  const experienceCount = (student.experiences || []).length;
  const projectCount = (student.projects || []).length;

  if (job.requiredYears !== null) {
    // A rough, deliberately generous estimate - this is a relevance score, not
    // a hiring decision, and we never treat it as a hard requirement.
    const estimatedYears = Math.min(4, experienceCount + (projectCount > 0 ? 0.5 : 0));
    const ratio = Math.min(1, estimatedYears / Math.max(1, job.requiredYears));
    return {
      available: true,
      score: Math.max(0.15, ratio),
      relevance: ratio >= 0.99 ? 'High' : ratio >= 0.5 ? 'Medium' : 'Low',
      detail: `The listing mentions ${job.requiredYears}+ year(s) of experience; your profile shows ${experienceCount} internship/work entry(ies) and ${projectCount} project(s).`,
      relevantProjects: relevant,
    };
  }

  if (experienceCount + projectCount === 0) {
    return {
      available: false,
      score: null,
      relevance: 'Unknown',
      detail: 'The listing states no experience requirement and your profile has no projects yet.',
    };
  }

  const score = relevant.length > 0 ? 0.9 : 0.6;
  return {
    available: true,
    score,
    relevance: relevant.length > 0 ? 'High' : 'Medium',
    detail:
      relevant.length > 0
        ? 'Your projects or internships mention technologies this listing also asks for.'
        : 'The listing states no explicit experience requirement; your projects were considered generally relevant.',
    relevantProjects: relevant,
  };
}

function scoreLocation(student, job) {
  const preferences = student.preferences;
  const location = job.location || '';
  const remote = job.workModes.includes('Remote');

  // A remote preference is satisfied by any remote role.
  if (preferences.workMode === 'Remote') {
    if (remote) {
      return { available: true, score: 1, match: true, detail: 'This role is remote, which is what you asked for.' };
    }
    if (!location) {
      return { available: false, score: null, match: null, detail: 'The listing does not state a location.' };
    }
    return {
      available: true,
      score: 0.25,
      match: false,
      detail: 'You prefer remote work and this listing names a location without saying it is remote.',
    };
  }

  if (!preferences.locations.length) {
    return {
      available: false,
      score: null,
      match: null,
      detail: 'You have not chosen preferred locations yet, so location was not scored.',
    };
  }

  if (!location) {
    return { available: false, score: null, match: null, detail: 'The listing does not state a location.' };
  }

  const jobLocation = location.toLowerCase();
  const preferred = preferences.locations.map((value) => value.toLowerCase());

  const exact = preferred.find((city) => city && jobLocation.includes(city));
  if (exact) {
    return {
      available: true,
      score: 1,
      match: true,
      detail: `This role is in ${location}, which matches your preferred location.`,
    };
  }

  if (remote && ['Any', 'Hybrid', 'Remote'].includes(preferences.workMode)) {
    return { available: true, score: 0.85, match: true, detail: 'This role is remote, which fits your preference.' };
  }

  return {
    available: true,
    score: 0.25,
    match: false,
    detail: `This role is in ${location}, outside your preferred locations (${preferences.locations.join(', ')}).`,
  };
}

function scoreRole(student, job) {
  const roles = student.preferences.roles;
  if (!roles.length) {
    return {
      available: false,
      score: null,
      detail: 'You have not chosen preferred roles yet, so role was not scored.',
    };
  }

  const jobTitleTokens = tokens(job.title);
  let best = { score: 0, role: '' };

  for (const role of roles) {
    const roleTokens = tokens(role);
    if (!roleTokens.length) continue;
    const shared = overlap(roleTokens, jobTitleTokens);
    const score = shared.length / roleTokens.length;
    if (score > best.score) best = { score, role, shared };
  }

  if (best.score === 0) {
    return {
      available: true,
      score: 0.2,
      detail: `The title "${job.title}" does not overlap with your preferred roles.`,
    };
  }

  return {
    available: true,
    score: Math.min(1, 0.55 + best.score * 0.45),
    detail: `The title "${job.title}" matches your preferred role "${best.role}".`,
  };
}

function scoreEmployment(student, job) {
  const preference = student.preferences.employmentType;
  if (preference === 'Any') {
    return {
      available: false,
      score: null,
      detail: 'You accept any employment type, so this preference was not scored.',
    };
  }

  if (!job.employment && !job.isInternship) {
    return {
      available: false,
      score: null,
      detail: 'The listing does not state an employment type.',
    };
  }

  if (preference === 'Internship') {
    return job.isInternship
      ? { available: true, score: 1, detail: 'This is an internship, which is what you are looking for.' }
      : { available: true, score: 0.25, detail: 'You prefer internships and this listing is not one.' };
  }

  if (preference === 'Full Time') {
    return job.isInternship || job.isPartTime
      ? { available: true, score: 0.25, detail: 'You prefer full-time roles and this listing is not full time.' }
      : { available: true, score: 1, detail: 'This is a full-time role, which matches your preference.' };
  }

  return { available: false, score: null, detail: 'Employment type could not be compared.' };
}

/* -------------------------------------------------------------------------- */
/* MAIN ENTRY POINT                                                           */
/* -------------------------------------------------------------------------- */

const WEIGHTS = MATCH_WEIGHTS;

export function matchLevel(score, thresholds = MATCH_THRESHOLDS) {
  if (score >= thresholds.excellent) return 'Excellent Match';
  if (score >= thresholds.strong) return 'Strong Match';
  if (score >= thresholds.moderate) return 'Moderate Match';
  return 'Explore';
}

/**
 * Score one vacancy against one student profile.
 *
 * @param {object} student - serialized student (with preferences and resume extract)
 * @param {object} job     - normalized Adzuna job
 * @returns {object} structured, explainable match
 */
export function scoreJob(student, job, { weights = WEIGHTS, thresholds = MATCH_THRESHOLDS } = {}) {
  const studentSignal = buildStudentSignal(student);
  const jobSignal = readJobSignal(job);

  const skills = scoreSkills(studentSignal, jobSignal);
  const education = scoreEducation(studentSignal, jobSignal);
  const experience = scoreExperience(studentSignal, jobSignal);
  const location = scoreLocation(studentSignal, jobSignal);
  const role = scoreRole(studentSignal, jobSignal);
  const employment = scoreEmployment(studentSignal, jobSignal);

  const factors = [
    { key: 'skills', ...skills },
    { key: 'education', ...education },
    { key: 'experience', ...experience },
    { key: 'location', ...location },
    { key: 'role', ...role },
    { key: 'employment', ...employment },
  ];

  const available = factors.filter((factor) => factor.available && factor.score !== null);
  const totalWeight = available.reduce((sum, factor) => sum + (weights[factor.key] || 0), 0);

  const raw = totalWeight > 0
    ? available.reduce((sum, factor) => sum + factor.score * (weights[factor.key] || 0), 0) / totalWeight
    : 0;

  const matchScore = Math.round(Math.max(0, Math.min(1, raw)) * 100);

  const reasons = [];
  if (skills.available) {
    if (skills.matchedSkills.length > 0) {
      reasons.push(`Your ${formatList(skills.matchedSkills.slice(0, 4))} skill${skills.matchedSkills.length > 1 ? 's appear' : ' appears'} in this job description.`);
    }
    if (skills.missingSkills.length > 0) {
      reasons.push(`Not on your profile yet: ${formatList(skills.missingSkills.slice(0, 4))}.`);
    }
  }
  if (education.available) reasons.push(education.detail);
  if (experience.available) reasons.push(experience.detail);
  if (location.available) reasons.push(location.detail);
  if (role.available) reasons.push(role.detail);
  if (employment.available) reasons.push(employment.detail);

  const unknownFactors = factors
    .filter((factor) => !factor.available || factor.score === null)
    .map((factor) => `${FACTOR_LABELS[factor.key]}: ${factor.detail}`);

  return {
    matchScore,
    level: matchLevel(matchScore, thresholds),
    // Relevance only. The employer decides eligibility, and the listing rarely
    // states every requirement.
    eligibility: 'unknown',
    matchedSkills: skills.matchedSkills,
    missingSkills: skills.missingSkills,
    requiredSkills: jobSignal.requiredSkills,
    mentionedSkills: jobSignal.mentionedSkills,
    educationRelevance: education.relevance,
    experienceRelevance: experience.relevance,
    locationMatch: location.match ?? null,
    employmentMatch: employment.available
      ? employment.score >= 0.7
      : null,
    remote: jobSignal.workModes.includes('Remote'),
    knownRequirements: {
      skills: jobSignal.requiredSkills,
      yearsOfExperience: jobSignal.requiredYears,
      degreeMentioned: jobSignal.educationMentioned,
    },
    reasons,
    unknownFactors,
    confidence:
      available.length >= 5 ? 'high' : available.length >= 3 ? 'medium' : 'low',
    availableFactors: available.map((factor) => factor.key),
    factors: factors.map((factor) => ({
      key: factor.key,
      label: FACTOR_LABELS[factor.key],
      weight: weights[factor.key] || 0,
      score: factor.available && factor.score !== null ? Math.round(factor.score * 100) : null,
      detail: factor.detail,
    })),
  };
}

function formatList(values) {
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/** Score and rank a list of normalized jobs. */
export function rankJobs(student, jobs = [], options = {}) {
  return jobs
    .map((job) => ({ ...job, match: scoreJob(student, job, options) }))
    .sort((a, b) => {
      if (b.match.matchScore !== a.match.matchScore) return b.match.matchScore - a.match.matchScore;
      const aDate = a.postedAt ? Date.parse(a.postedAt) : 0;
      const bDate = b.postedAt ? Date.parse(b.postedAt) : 0;
      return bDate - aDate;
    });
}

/**
 * Skills that the most relevant listings ask for and the student does not have.
 * Derived from real listings, never from a generic "learn these" list.
 */
export function summarizeSkillGap(student, rankedJobs = [], { limit = 8, minScore = 40 } = {}) {
  const studentSignal = buildStudentSignal(student);
  const relevant = rankedJobs.filter((job) => job.match.matchScore >= minScore);
  const counts = new Map();
  const examples = new Map();

  for (const job of relevant) {
    for (const skill of job.match.missingSkills) {
      counts.set(skill, (counts.get(skill) || 0) + 1);
      if (!examples.has(skill)) examples.set(skill, job.title);
    }
  }

  const total = relevant.length || 0;

  return {
    basedOnListings: total,
    studentSkills: studentSignal.skills.slice(0, 40),
    missingSkills: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([skill, jobCount]) => ({
        skill,
        jobCount,
        shareOfListings: total ? Math.round((jobCount / total) * 100) : 0,
        exampleJobTitle: examples.get(skill) || null,
      })),
    note:
      'These counts come from the requirements named in the listings above. Learning a skill is not a guarantee of employment.',
  };
}

/** The documented defaults, for tests and for explaining the algorithm. */
export const DEFAULT_WEIGHTS = DEFAULT_MATCH_WEIGHTS;

export { MATCH_WEIGHTS, MATCH_THRESHOLDS };
