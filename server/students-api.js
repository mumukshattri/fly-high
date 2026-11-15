/**
 * server/students-api.js
 * ===========================================================================
 * STUDENT PROFILE, RESUME AND RECOMMENDATION ROUTES
 * ===========================================================================
 *
 * Mounted by server/api.js, so the routes keep the `/api` prefix and the same
 * session-cookie authentication as everything else.
 *
 *   GET    /api/students/me/profile
 *   PATCH  /api/students/me/profile
 *   GET    /api/students/me/profile-completion
 *
 *   POST   /api/students/me/resume              (binary body)
 *   GET    /api/students/me/resume
 *   GET    /api/students/me/resume/file
 *   DELETE /api/students/me/resume
 *   POST   /api/students/me/resume/parse
 *   PATCH  /api/students/me/resume/confirm
 *
 *   GET    /api/student/recommendations
 *   GET    /api/student/recommendations/skills-gap
 *
 * SECURITY
 * --------
 * The caller's id always comes from the session. There is deliberately no
 * `studentId` parameter on any of these routes, so one student cannot read or
 * modify another student's profile or download their CV.
 */

import express from 'express';

import { Student, Application, Drive } from './models/index.js';
import { requireAuth } from './auth.js';
import {
  asyncHandler,
  badRequest,
  cleanList,
  cleanMultiline,
  cleanText,
  conflict,
  isEmail,
  notFound,
  HttpError,
} from './http.js';
import { serializeApplication, serializeStudent } from './serialize.js';
import { broadcast } from './events.js';
import { getProfileCompletion } from '../src/utils/profileCompletion.js';
import { departmentToBranch } from '../src/config/constants.js';
import { mergeSkills, skillKey, uniqueSkills } from './skills.js';
import {
  deleteResume as deleteStoredResume,
  maxSizeLabel,
  readResume,
  RESUME_ACCEPTED_MIME,
  saveResume,
} from './resume-store.js';
import {
  extractResumeText,
  parseResumeText,
  UnreadableResumeError,
} from './extract.js';
import { MATCH_THRESHOLDS, rankJobs, summarizeSkillGap } from './matching.js';
import {
  ADZUNA_MISSING_VARS,
  isConfigured as adzunaConfigured,
  searchExternalJobs,
  sourceInfo as adzunaSource,
} from './external-jobs.js';
import { RESUME_MAX_BYTES } from './config.js';

/* -------------------------------------------------------------------------- */
/* SHARED VALIDATION                                                          */
/* -------------------------------------------------------------------------- */

const WORK_MODES = ['Any', 'Onsite', 'Hybrid', 'Remote'];
const EMPLOYMENT_TYPES = ['Any', 'Full Time', 'Internship'];

function loadStudentDoc(req) {
  return Student.findById(req.user.id);
}

function readProjectsInput(value) {
  if (!Array.isArray(value)) throw badRequest('Projects must be a list.');
  return value.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object') throw badRequest(`Project ${index + 1} is not valid.`);
    const title = cleanText(item.title, 160);
    if (!title) throw badRequest(`Project ${index + 1} needs a title.`);
    return {
      title,
      description: cleanMultiline(item.description, 1200),
      techStack: uniqueSkills(cleanList(item.techStack, { maxLength: 40, limit: 20 })),
      link: cleanText(item.link, 400),
    };
  });
}

function readExperiencesInput(value) {
  if (!Array.isArray(value)) throw badRequest('Experience entries must be a list.');
  return value.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object') throw badRequest(`Experience ${index + 1} is not valid.`);
    const role = cleanText(item.role, 160);
    const company = cleanText(item.company, 160);
    if (!role && !company) throw badRequest(`Experience ${index + 1} needs a role or a company.`);
    return {
      type: item.type === 'Work' ? 'Work' : 'Internship',
      company,
      role,
      startDate: cleanText(item.startDate, 20),
      endDate: cleanText(item.endDate, 20),
      description: cleanMultiline(item.description, 1200),
      technologies: uniqueSkills(cleanList(item.technologies, { maxLength: 40, limit: 20 })),
    };
  });
}

function readCertificationsInput(value) {
  if (!Array.isArray(value)) throw badRequest('Certifications must be a list.');
  return value.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object') throw badRequest(`Certification ${index + 1} is not valid.`);
    const name = cleanText(item.name, 200);
    if (!name) throw badRequest(`Certification ${index + 1} needs a name.`);
    return {
      name,
      issuer: cleanText(item.issuer, 160),
      year: cleanText(item.year, 20),
      link: cleanText(item.link, 400),
    };
  });
}

function readPreferencesInput(value) {
  if (!value || typeof value !== 'object') throw badRequest('Preferences must be an object.');
  const preferences = {};

  if ('roles' in value) preferences.roles = cleanList(value.roles, { maxLength: 80, limit: 10 });
  if ('industries' in value) preferences.industries = cleanList(value.industries, { maxLength: 80, limit: 10 });
  if ('locations' in value) preferences.locations = cleanList(value.locations, { maxLength: 60, limit: 10 });

  if ('workMode' in value) {
    if (!WORK_MODES.includes(value.workMode)) throw badRequest('Unknown work mode.');
    preferences.workMode = value.workMode;
  }
  if ('employmentType' in value) {
    if (!EMPLOYMENT_TYPES.includes(value.employmentType)) throw badRequest('Unknown employment preference.');
    preferences.employmentType = value.employmentType;
  }
  if ('expectedSalary' in value) preferences.expectedSalary = cleanText(value.expectedSalary, 60);

  return preferences;
}

/**
 * Apply a (partial) profile payload to a student document.
 *
 * Only keys that are actually present are touched, so the onboarding wizard can
 * save one step at a time without wiping the others. Every value is validated
 * here - the browser's validation exists for a better error message, not for
 * trust.
 *
 * @returns {boolean} whether anything changed
 */
export function applyProfilePayload(student, body = {}) {
  let changed = false;
  const touch = () => {
    changed = true;
  };

  if ('name' in body) {
    const name = cleanText(body.name, 120);
    if (!name) throw badRequest('Name cannot be empty.');
    student.name = name;
    touch();
  }

  if ('emailNotifications' in body) {
    if (typeof body.emailNotifications !== 'boolean') {
      throw badRequest('emailNotifications must be true or false.');
    }
    student.emailNotifications = body.emailNotifications;
    touch();
  }
  if ('driveAnnouncements' in body) {
    if (typeof body.driveAnnouncements !== 'boolean') {
      throw badRequest('driveAnnouncements must be true or false.');
    }
    student.driveAnnouncements = body.driveAnnouncements;
    touch();
  }

  if ('phone' in body) {
    student.phone = cleanText(body.phone, 40);
    touch();
  }
  if ('rollNumber' in body) {
    student.rollNumber = cleanText(body.rollNumber, 40);
    touch();
  }
  if ('enrollmentNumber' in body) {
    student.enrollmentNumber = cleanText(body.enrollmentNumber, 60);
    touch();
  }
  if ('university' in body) {
    student.university = cleanText(body.university, 200);
    touch();
  }
  if ('about' in body) {
    student.about = cleanMultiline(body.about, 2000);
    touch();
  }

  /* -------------------------------- academics ------------------------------- */

  if ('branch' in body && !('department' in body)) {
    student.branch = cleanText(body.branch, 40) || student.branch;
    touch();
  }

  if ('department' in body) {
    const department = cleanText(body.department, 120);
    student.department = department;
    const branch = departmentToBranch(department);
    if (branch) student.branch = branch;
    touch();
  }

  if ('degree' in body) {
    student.degree = cleanText(body.degree, 60);
    touch();
  }
  if ('specialization' in body) {
    student.specialization = cleanText(body.specialization, 120);
    touch();
  }

  if ('semester' in body) {
    const semester = Number(body.semester);
    if (!Number.isInteger(semester) || semester < 1 || semester > 8) {
      throw badRequest('Semester must be between 1 and 8.');
    }
    student.semester = semester;
    touch();
  }

  if ('currentYear' in body) {
    const year = Number(body.currentYear);
    if (!Number.isInteger(year) || year < 0 || year > 6) throw badRequest('Current year must be between 1 and 6.');
    student.currentYear = year;
    touch();
  }

  if ('cgpa' in body) {
    const cgpa = Number(body.cgpa);
    if (Number.isNaN(cgpa) || cgpa < 0 || cgpa > 10) throw badRequest('CGPA must be between 0 and 10.');
    student.cgpa = cgpa;
    touch();
  }

  if ('backlogs' in body) {
    const backlogs = Number(body.backlogs);
    if (!Number.isInteger(backlogs) || backlogs < 0 || backlogs > 50) {
      throw badRequest('Backlogs must be a whole number between 0 and 50.');
    }
    student.backlogs = backlogs;
    touch();
  }

  if ('graduationYear' in body) {
    const year = Number(body.graduationYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw badRequest('Enter a valid graduation year.');
    }
    student.graduationYear = year;
    touch();
  }

  if ('previousEducation' in body) {
    const value = body.previousEducation;
    if (value && typeof value === 'object') {
      student.previousEducation = {
        level: cleanText(value.level, 60),
        institution: cleanText(value.institution, 200),
        board: cleanText(value.board, 120),
        year: cleanText(value.year, 20),
        percentage: cleanText(value.percentage, 20),
      };
      touch();
    }
  }

  /* ------------------------------ professional ------------------------------ */

  const skillFields = {
    skills: 60,
    programmingLanguages: 40,
    frameworks: 40,
    databases: 30,
    tools: 40,
  };

  for (const [field, limit] of Object.entries(skillFields)) {
    if (!(field in body)) continue;
    if (!Array.isArray(body[field])) throw badRequest(`${field} must be a list.`);
    student[field] = uniqueSkills(cleanList(body[field], { maxLength: 50, limit }));

    // A skill the student typed back in is no longer a rejected extraction.
    if (field === 'skills' && student.rejectedSkills?.length) {
      const current = new Set(student.skills.map(skillKey));
      student.rejectedSkills = student.rejectedSkills.filter((key) => !current.has(skillKey(key)));
    }
    touch();
  }

  if ('achievements' in body) {
    student.achievements = cleanList(body.achievements, { maxLength: 300, limit: 20 });
    touch();
  }
  if ('projects' in body) {
    student.projects = readProjectsInput(body.projects);
    touch();
  }
  if ('experiences' in body) {
    student.experiences = readExperiencesInput(body.experiences);
    touch();
  }
  if ('certifications' in body) {
    student.certifications = readCertificationsInput(body.certifications);
    touch();
  }

  /* ------------------------------ preferences ------------------------------ */

  if ('preferences' in body) {
    const next = readPreferencesInput(body.preferences);
    student.preferences = { ...(student.preferences?.toObject?.() || student.preferences || {}), ...next };
    touch();
  }

  /* ------------------------------- onboarding ------------------------------ */

  if ('onboarding' in body && body.onboarding && typeof body.onboarding === 'object') {
    const step = Number(body.onboarding.step);
    if (Number.isInteger(step) && step >= 0 && step <= 6) student.onboarding.step = step;

    if (body.onboarding.completed === true) {
      // The personal and academic essentials must exist before a profile can be
      // called complete; a wizard step alone is not evidence.
      if (!student.name || !student.email) throw badRequest('Add your name and email before finishing.');
      student.onboarding.completedAt = new Date();
    }
    student.onboarding.updatedAt = new Date();
    touch();
  }

  return changed;
}

async function assertEmailAvailable(student, email) {
  if (!email || email === student.email) return;
  const taken = await Promise.all([
    Student.exists({ email, _id: { $ne: student._id } }),
    // Company/Admin collections are checked by the auth route; imported students
    // could still collide with a student row, which is the case handled here.
  ]);
  if (taken.some(Boolean)) throw conflict('That email is already in use.');
}

/** Shared PUT/PATCH handler. */
export const updateOwnProfile = asyncHandler(async (req, res) => {
  const student = await loadStudentDoc(req);
  if (!student) throw notFound('Student profile not found.');

  const body = req.body || {};

  if ('email' in body) {
    const email = cleanText(body.email, 160).toLowerCase();
    if (!isEmail(email)) throw badRequest('Enter a valid email address.');
    await assertEmailAvailable(student, email);
    if (email !== student.email) {
      const { Company, Admin } = await import('./models/index.js');
      const taken = await Promise.all([Company.exists({ hrEmail: email }), Admin.exists({ email })]);
      if (taken.some(Boolean)) throw conflict('That email is already in use.');
      student.email = email;
    }
  }

  applyProfilePayload(student, body);

  student.profileUpdatedAt = new Date();
  await student.save();

  const profile = serializeStudent(student.toObject());

  broadcast('students', { action: 'updated', studentId: req.user.id });
  // A CGPA / branch change can change drive eligibility, so clients refetch.
  broadcast('drives', { action: 'eligibility-changed' });

  res.json({ profile, completion: getProfileCompletion(profile) });
});

/* -------------------------------------------------------------------------- */
/* RESUMES                                                                    */
/* -------------------------------------------------------------------------- */

const rawResumeParser = express.raw({
  type: [
    ...RESUME_ACCEPTED_MIME,
    'application/octet-stream',
    // Also accept the legacy .doc / unknown types so the user gets a helpful
    // message instead of a generic one, and so the bytes can be sniffed.
    'application/msword',
    'application/vnd.ms-word',
    'application/x-pdf',
  ],
  limit: RESUME_MAX_BYTES + 1024,
});

function decodeFileName(request) {
  const header = request.headers['x-file-name'];
  if (!header) return '';
  try {
    return decodeURIComponent(String(header)).slice(0, 200);
  } catch {
    return String(header).slice(0, 200);
  }
}

function publicExtract(student) {
  const extract = student.resumeExtract;
  return {
    contact: {
      name: extract?.contact?.name || '',
      email: extract?.contact?.email || '',
      phone: extract?.contact?.phone || '',
    },
    summary: extract?.summary || '',
    skills: extract?.skills || [],
    education: {
      degree: extract?.education?.degree || '',
      department: extract?.education?.department || '',
      university: extract?.education?.university || '',
      graduationYear: extract?.education?.graduationYear ?? null,
      cgpa: extract?.education?.cgpa ?? null,
      percentage: extract?.education?.percentage ?? null,
      semester: extract?.education?.semester ?? null,
      currentYear: extract?.education?.currentYear ?? null,
      backlogs: extract?.education?.backlogs ?? null,
    },
    experience: extract?.experience || [],
    projects: extract?.projects || [],
    certifications: extract?.certifications || [],
    achievements: extract?.achievements || [],
    applied: extract?.applied || {
      fields: [],
      skills: [],
      projectTitles: [],
      experienceKeys: [],
      certificationNames: [],
    },
    appliedAt: extract?.appliedAt || '',
    notes: extract?.notes || [],
    textPreview: extract?.textPreview || '',
    extractedAt: extract?.extractedAt || '',
    confirmedAt: extract?.confirmedAt || '',
  };
}

const blankValue = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (typeof value === 'number' && value === 0) ||
  (typeof value === 'string' && /^not specified$/i.test(value.trim()));

/**
 * Fill *blank* profile fields from a parsed resume and report exactly what was
 * filled. Existing values are never touched - that is the difference between
 * "populate my profile from my CV" and "silently overwrite my profile".
 */
function applyExtractToProfile(student, parsed) {
  const applied = {
    fields: [],
    skills: [],
    projectTitles: [],
    experienceKeys: [],
    certificationNames: [],
  };
  const education = parsed.education || {};

  const fill = (field, value, isValid = () => true) => {
    if (value === null || value === undefined || value === '') return;
    if (!isValid(value)) return;
    if (!blankValue(student[field])) return;
    student[field] = value;
    applied.fields.push(field);
  };

  fill('degree', cleanText(education.degree, 60));
  fill('department', cleanText(education.department, 120));
  if (applied.fields.includes('department')) {
    const branch = departmentToBranch(student.department);
    if (branch) student.branch = branch;
  }
  fill('university', cleanText(parsed.university || education.university, 160));
  fill('phone', cleanText(parsed.phone, 20));
  fill('cgpa', Number(education.cgpa), (value) => Number.isFinite(value) && value > 0 && value <= 10);
  fill('graduationYear', Number(education.graduationYear), (value) => Number.isInteger(value) && value >= 2000 && value <= 2100);
  fill('currentYear', Number(education.currentYear), (value) => Number.isInteger(value) && value >= 1 && value <= 6);
  if (Number(education.backlogs) > 0) {
    fill('backlogs', Number(education.backlogs), (value) => Number.isInteger(value) && value >= 0 && value <= 50);
  }

  // Merge, never replace: existing skills keep their spelling and order, alias
  // duplicates (React / ReactJS) collapse to one entry, and skills the student
  // rejected in an earlier review stay out.
  const mergedSkills = mergeSkills(student.skills || [], uniqueSkills(parsed.skills || []), {
    excludeKeys: student.rejectedSkills || [],
  });
  if (mergedSkills.added.length) {
    student.skills = mergedSkills.skills;
    applied.skills = mergedSkills.added;
  }

  const existingProjects = new Set(
    (student.projects || []).map((project) => String(project.title).toLowerCase()),
  );
  const newProjects = (parsed.projects || []).filter(
    (project) => project.title && !existingProjects.has(project.title.toLowerCase()),
  );
  if (newProjects.length) {
    student.projects = [...(student.projects || []), ...newProjects];
    applied.projectTitles = newProjects.map((project) => project.title);
  }

  const existingExperiences = new Set(
    (student.experiences || []).map((item) => `${item.role}|${item.company}`.toLowerCase()),
  );
  const newExperiences = (parsed.experience || []).filter(
    (item) => !existingExperiences.has(`${item.role}|${item.company}`.toLowerCase()),
  );
  if (newExperiences.length) {
    student.experiences = [...(student.experiences || []), ...newExperiences];
    applied.experienceKeys = newExperiences.map((item) => `${item.role}|${item.company}`);
  }

  const existingCertifications = new Set(
    (student.certifications || []).map((item) => String(item.name).toLowerCase()),
  );
  const newCertifications = (parsed.certifications || []).filter(
    (item) => item.name && !existingCertifications.has(item.name.toLowerCase()),
  );
  if (newCertifications.length) {
    student.certifications = [...(student.certifications || []), ...newCertifications];
    applied.certificationNames = newCertifications.map((item) => item.name);
  }

  const existingAchievements = new Set(
    (student.achievements || []).map((item) => String(item).toLowerCase()),
  );
  const newAchievements = (parsed.achievements || []).filter(
    (item) => item && !existingAchievements.has(item.toLowerCase()),
  );
  if (newAchievements.length) {
    student.achievements = [...(student.achievements || []), ...newAchievements];
  }

  return applied;
}

/**
 * Read the stored file, extract its text and store the *proposal*. Never
 * touches the profile itself - the student confirms what to keep.
 */
async function parseStoredResume(student) {
  if (!student.resume?.storedName) {
    throw new HttpError(400, 'Upload a resume before asking for an extraction.');
  }

  const buffer = await readResume(student.resume.storedName);
  const kind = student.resume.mimeType === 'application/pdf' ? 'pdf' : 'docx';

  let text = '';
  let notes = [];

  try {
    const extracted = extractResumeText(buffer, kind);
    text = extracted.text;
    notes = extracted.notes;
  } catch (error) {
    if (!(error instanceof UnreadableResumeError)) throw error;
    notes = [error.message];
  }

  const parsed = parseResumeText(text);
  const now = new Date().toISOString();

  student.resume.hasText = text.length >= 40;
  student.resume.textChars = text.length;
  student.resume.parsedAt = now;

  student.resumeExtract = {
    contact: {
      name: parsed.name || student.name || '',
      email: parsed.email || '',
      phone: parsed.phone || '',
    },
    summary: parsed.summary || '',
    skills: parsed.skills,
    education: parsed.education,
    experience: parsed.experience,
    projects: parsed.projects,
    certifications: parsed.certifications,
    achievements: parsed.achievements || [],
    textPreview: parsed.textPreview,
    notes: [...notes, ...parsed.notes],
    extractedAt: now,
    confirmedAt: '',
  };

  // Populate blank profile fields immediately, so the student does not have to
  // copy anything by hand. Every fill is recorded for the review step.
  const applied = applyExtractToProfile(student, parsed);
  student.resumeExtract.applied = applied;
  student.resumeExtract.appliedAt = now;

  await student.save();
  return { hasText: student.resume.hasText, textChars: text.length, extract: publicExtract(student) };
}

/** POST /api/students/me/resume - the raw file is the request body. */
const uploadResume = asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.body)) {
    throw badRequest(
      `Send the resume file itself as the request body with Content-Type ${RESUME_ACCEPTED_MIME.join(' or ')}.`,
    );
  }

  const student = await loadStudentDoc(req);
  if (!student) throw notFound('Student profile not found.');

  const saved = await saveResume({
    studentId: String(student._id),
    buffer: req.body,
    fileName: decodeFileName(req),
  });

  const previous = student.resume?.storedName;

  student.resume = {
    fileName: saved.displayName,
    size: `${Math.max(1, Math.round(saved.sizeBytes / 1024))} KB`,
    uploadedOn: new Date().toISOString().slice(0, 10),
    storedName: saved.storedName,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    hasText: false,
    textChars: 0,
    parsedAt: '',
    extractConfirmedAt: '',
  };
  student.resumeExtract = null;
  student.profileUpdatedAt = new Date();
  await student.save();

  // Only remove the old file once the new one is safely stored.
  if (previous && previous !== saved.storedName) await deleteStoredResume(previous);

  const extraction = await parseStoredResume(student);

  broadcast('students', { action: 'resume-uploaded', studentId: String(student._id) });
  broadcast('drives', { action: 'eligibility-changed' });

  res.status(201).json({
    resume: serializeStudent(student.toObject()).resume,
    extraction,
  });
});

/** GET /api/students/me/resume - metadata + the extraction proposal. */
const getResume = asyncHandler(async (req, res) => {
  const student = await loadStudentDoc(req).lean();
  if (!student) throw notFound('Student profile not found.');

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    resume: serializeStudent(student).resume,
    extraction: student.resumeExtract ? publicExtract(student) : null,
  });
});

/** GET /api/students/me/resume/file - owner-only download. */
const downloadResume = asyncHandler(async (req, res) => {
  const student = await loadStudentDoc(req).lean();
  if (!student?.resume?.storedName) throw notFound('No resume has been uploaded.');

  const buffer = await readResume(student.resume.storedName);
  const safeName = student.resume.fileName.replace(/[\\/:*?"<>|]/g, '_');

  res.setHeader('Content-Type', student.resume.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
});

/** DELETE /api/students/me/resume */
const removeResume = asyncHandler(async (req, res) => {
  const student = await loadStudentDoc(req);
  if (!student) throw notFound('Student profile not found.');

  const storedName = student.resume?.storedName;
  student.resume = null;
  student.resumeExtract = null;
  student.profileUpdatedAt = new Date();
  await student.save();

  await deleteStoredResume(storedName);

  broadcast('students', { action: 'resume-deleted', studentId: String(student._id) });
  res.json({ success: true, resume: null });
});

/** POST /api/students/me/resume/parse - re-run extraction on the stored file. */
const reparseResume = asyncHandler(async (req, res) => {
  const student = await loadStudentDoc(req);
  if (!student) throw notFound('Student profile not found.');

  const extraction = await parseStoredResume(student);
  res.json({ resume: serializeStudent(student.toObject()).resume, extraction });
});

/**
 * PATCH /api/students/me/resume/confirm
 *
 * The student sends back only the values they accepted after reviewing the
 * extraction. Anything they removed is not applied. Existing profile values are
 * kept unless `overwrite: true`, so confirming a second CV cannot silently
 * replace an edited profile.
 */
const confirmExtract = asyncHandler(async (req, res) => {
  const student = await loadStudentDoc(req);
  if (!student) throw notFound('Student profile not found.');
  if (!student.resumeExtract) throw badRequest('There is no extracted resume information to confirm.');

  const body = req.body || {};
  const overwrite = body.overwrite === true;

  if (Array.isArray(body.skills)) {
    const accepted = uniqueSkills(cleanList(body.skills, { maxLength: 50, limit: 60 }));
    student.skills = mergeSkills(student.skills || [], accepted).skills;

    // Accepting a skill clears an earlier rejection of the same skill.
    if (student.rejectedSkills?.length) {
      const current = new Set(student.skills.map(skillKey));
      student.rejectedSkills = student.rejectedSkills.filter((key) => !current.has(skillKey(key)));
    }
  }

  if (body.education && typeof body.education === 'object') {
    const education = body.education;

    if (cleanText(education.degree, 60) && (overwrite || !student.degree)) {
      student.degree = cleanText(education.degree, 60);
    }
    if (cleanText(education.department, 120) && (overwrite || !student.department)) {
      student.department = cleanText(education.department, 120);
      const branch = departmentToBranch(student.department);
      if (branch) student.branch = branch;
    }
    const year = Number(education.graduationYear);
    if (Number.isInteger(year) && year >= 2000 && year <= 2100 && (overwrite || !student.graduationYear)) {
      student.graduationYear = year;
    }
    if (cleanText(education.university, 160) && (overwrite || !student.university)) {
      student.university = cleanText(education.university, 160);
    }
    const backlogs = Number(education.backlogs);
    if (
      Number.isInteger(backlogs) &&
      backlogs >= 0 &&
      backlogs <= 50 &&
      (overwrite || !student.backlogs)
    ) {
      student.backlogs = backlogs;
    }
    const cgpa = Number(education.cgpa);
    if (Number.isFinite(cgpa) && cgpa > 0 && cgpa <= 10 && (overwrite || !student.cgpa)) {
      student.cgpa = cgpa;
    }
  }

  if (Array.isArray(body.projects)) {
    const accepted = readProjectsInput(body.projects);
    const existing = new Set((student.projects || []).map((project) => project.title.toLowerCase()));
    student.projects = [
      ...(student.projects || []),
      ...accepted.filter((project) => !existing.has(project.title.toLowerCase())),
    ];
  }

  if (Array.isArray(body.experiences)) {
    const accepted = readExperiencesInput(body.experiences);
    const existing = new Set(
      (student.experiences || []).map((item) => `${item.role}|${item.company}`.toLowerCase()),
    );
    student.experiences = [
      ...(student.experiences || []),
      ...accepted.filter((item) => !existing.has(`${item.role}|${item.company}`.toLowerCase())),
    ];
  }

  if (Array.isArray(body.certifications)) {
    const accepted = readCertificationsInput(body.certifications);
    const existing = new Set((student.certifications || []).map((item) => item.name.toLowerCase()));
    student.certifications = [
      ...(student.certifications || []),
      ...accepted.filter((item) => !existing.has(item.name.toLowerCase())),
    ];
  }

  // The review step can reject individual extracted values. Only values this
  // extraction auto-filled can be removed, and only while the profile still
  // holds exactly that value - an edit made since is never lost.
  const rejected = body.rejected && typeof body.rejected === 'object' ? body.rejected : null;
  if (rejected) {
    const applied = student.resumeExtract.applied || {};
    const extracted = student.resumeExtract;
    const scalarValues = {
      degree: extracted.education?.degree || '',
      department: extracted.education?.department || '',
      university: extracted.education?.university || '',
      cgpa: extracted.education?.cgpa ?? null,
      graduationYear: extracted.education?.graduationYear ?? null,
      backlogs: extracted.education?.backlogs ?? null,
      phone: extracted.contact?.phone || '',
    };

    for (const field of cleanList(rejected.fields, { maxLength: 40, limit: 20 })) {
      if (!(field in scalarValues)) continue;
      if (!(applied.fields || []).includes(field)) continue;
      if (String(student[field] ?? '') !== String(scalarValues[field] ?? '')) continue;
      student[field] =
        field === 'cgpa' || field === 'graduationYear' || field === 'backlogs' ? null : '';
    }

    const rejectedSkills = new Set(
      cleanList(rejected.skills, { maxLength: 50, limit: 60 }).map(skillKey).filter(Boolean),
    );
    if (rejectedSkills.size) {
      // Only skills this extraction added can be removed; a skill the student
      // already had before uploading is never touched.
      const removable = new Set(
        (applied.skills || []).map(skillKey).filter((key) => rejectedSkills.has(key)),
      );
      if (removable.size) {
        student.skills = (student.skills || []).filter((skill) => !removable.has(skillKey(skill)));

        // Remember the rejection so re-parsing the same file cannot re-add it.
        const dismissed = new Set([
          ...(student.rejectedSkills || []).map(skillKey),
          ...removable,
        ]);
        student.rejectedSkills = [...dismissed].filter(Boolean).slice(0, 100);
      }
    }

    const rejectedProjects = new Set(
      cleanList(rejected.projectTitles, { maxLength: 160, limit: 20 }).map((title) =>
        title.toLowerCase(),
      ),
    );
    if (rejectedProjects.size) {
      const removable = new Set(
        (applied.projectTitles || [])
          .filter((title) => rejectedProjects.has(title.toLowerCase()))
          .map((title) => title.toLowerCase()),
      );
      student.projects = (student.projects || []).filter(
        (project) => !removable.has(String(project.title).toLowerCase()),
      );
    }

    const rejectedExperiences = new Set(
      cleanList(rejected.experienceKeys, { maxLength: 200, limit: 20 }).map((key) =>
        key.toLowerCase(),
      ),
    );
    if (rejectedExperiences.size) {
      const removable = new Set(
        (applied.experienceKeys || [])
          .filter((key) => rejectedExperiences.has(key.toLowerCase()))
          .map((key) => key.toLowerCase()),
      );
      student.experiences = (student.experiences || []).filter(
        (item) => !removable.has(`${item.role}|${item.company}`.toLowerCase()),
      );
    }

    const rejectedCertifications = new Set(
      cleanList(rejected.certificationNames, { maxLength: 200, limit: 20 }).map((name) =>
        name.toLowerCase(),
      ),
    );
    if (rejectedCertifications.size) {
      const removable = new Set(
        (applied.certificationNames || [])
          .filter((name) => rejectedCertifications.has(name.toLowerCase()))
          .map((name) => name.toLowerCase()),
      );
      student.certifications = (student.certifications || []).filter(
        (item) => !removable.has(String(item.name).toLowerCase()),
      );
    }
  }

  const now = new Date().toISOString();
  student.resumeExtract.confirmedAt = now;
  if (student.resume) student.resume.extractConfirmedAt = now;
  student.profileUpdatedAt = new Date();

  await student.save();

  const profile = serializeStudent(student.toObject());
  broadcast('students', { action: 'updated', studentId: String(student._id) });
  broadcast('drives', { action: 'eligibility-changed' });

  res.json({ profile, completion: getProfileCompletion(profile) });
});

/* -------------------------------------------------------------------------- */
/* RECOMMENDATIONS                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Ranking results are memoised for a few minutes. The Adzuna search itself is
 * cached for 10 minutes, but re-ranking 60 listings per dashboard refresh would
 * still be wasted CPU, and this keeps the endpoint cheap for a class of 60.
 */
const RECOMMENDATION_TTL_MS = 5 * 60 * 1000;
const recommendationCache = new Map();

function cacheKeyFor(student, queries) {
  return JSON.stringify({
    id: String(student._id),
    updatedAt: student.updatedAt instanceof Date ? student.updatedAt.getTime() : student.updatedAt,
    resume: student.resumeExtract?.confirmedAt || '',
    queries: queries.map((query) => [query.what, query.where]),
  });
}

/** A sensible first search when the student has not chosen roles yet. */
function derivedRoleQuery(student) {
  const department = String(student.department || '');
  if (/computer|information technology|software|artificial|data science/i.test(department)) {
    return 'software engineer';
  }
  if (/electronics|electrical|instrumentation/i.test(department)) return 'electronics engineer';
  if (/mechanical/i.test(department)) return 'mechanical engineer';
  if (/civil/i.test(department)) return 'civil engineer';
  if (/chemical/i.test(department)) return 'chemical engineer';

  const topSkill = (student.skills || [])[0];
  return topSkill ? `${topSkill} developer` : 'graduate trainee';
}

/** Up to two provider queries, derived from the real preferences. */
export function recommendationQueries(student, override = {}) {
  const preferences = student.preferences || {};
  const roles = [
    ...(Array.isArray(override.roles) ? override.roles : []),
    ...(preferences.roles || []),
  ]
    .map((role) => cleanText(role, 100))
    .filter(Boolean);

  const uniqueRoles = [...new Set(roles)];
  const location =
    cleanText(override.where, 60) || cleanText((preferences.locations || [])[0], 60) || '';

  const whats = uniqueRoles.length ? uniqueRoles.slice(0, 2) : [derivedRoleQuery(student)];

  const queries = whats.map((what) => ({
    what,
    where: location,
    page: 1,
    resultsPerPage: 20,
    sortBy: 'relevance',
    category: '',
    maxDaysOld: 30,
  }));

  // De-duplicate identical what/where pairs so we never spend two calls on one
  // search.
  const seen = new Set();
  return queries.filter((query) => {
    const key = `${query.what}|${query.where}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildRecommendations(studentDoc, { roles, where } = {}) {
  const student = serializeStudent(studentDoc);
  const completion = getProfileCompletion(student);

  if (!adzunaConfigured()) {
    return {
      configured: false,
      missing: ADZUNA_MISSING_VARS,
      message:
        'Personalised recommendations need live job data. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to the server environment to enable them.',
      profileCompletion: completion,
      recommended: [],
      strong: [],
      explore: [],
      skillGap: null,
      considered: 0,
      source: null,
      generatedAt: new Date().toISOString(),
    };
  }

  const queries = recommendationQueries(studentDoc, { roles, where });
  const key = cacheKeyFor(studentDoc, queries);
  const cached = recommendationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const jobs = [];
  const seenIds = new Set();
  const failures = [];

  for (const query of queries) {
    try {
      const result = await searchExternalJobs(query);
      for (const job of result.jobs) {
        if (seenIds.has(job.id)) continue;
        seenIds.add(job.id);
        jobs.push(job);
      }
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (jobs.length === 0 && failures.length > 0) {
    // The dashboard must stay usable when the provider is down, so this is a
    // 200 with an honest explanation rather than an error page.
    return {
      configured: true,
      degraded: true,
      message: failures[0],
      profileCompletion: completion,
      recommended: [],
      strong: [],
      explore: [],
      skillGap: null,
      considered: 0,
      source: adzunaSource(),
      generatedAt: new Date().toISOString(),
    };
  }

  const ranked = rankJobs(student, jobs);
  const recommended = ranked.slice(0, 8);
  const recommendedIds = new Set(recommended.map((job) => job.id));

  const strong = ranked
    .filter((job) => job.match.matchScore >= MATCH_THRESHOLDS.strong)
    .slice(0, 8);

  const explore = ranked
    .filter((job) => !recommendedIds.has(job.id))
    .slice(0, 12);

  const value = {
    configured: true,
    degraded: false,
    message: null,
    profileCompletion: completion,
    queries: queries.map((query) => ({ what: query.what, where: query.where })),
    considered: ranked.length,
    recommended,
    strong,
    explore,
    skillGap: summarizeSkillGap(student, ranked),
    thresholds: MATCH_THRESHOLDS,
    source: adzunaSource(),
    generatedAt: new Date().toISOString(),
  };

  if (recommendationCache.size > 200) {
    const oldest = recommendationCache.keys().next().value;
    if (oldest !== undefined) recommendationCache.delete(oldest);
  }
  recommendationCache.set(key, { expiresAt: Date.now() + RECOMMENDATION_TTL_MS, value });

  return value;
}

/** GET /api/student/recommendations */
const getRecommendations = asyncHandler(async (req, res) => {
  const studentDoc = await loadStudentDoc(req).lean();
  if (!studentDoc) throw notFound('Student profile not found.');

  const roles = cleanText(req.query.roles, 200)
    ? cleanText(req.query.roles, 200).split(',').map((role) => role.trim()).filter(Boolean)
    : undefined;

  const result = await buildRecommendations(studentDoc, {
    roles,
    where: cleanText(req.query.where, 60),
  });

  res.setHeader('Cache-Control', 'private, no-store');
  res.json(result);
});

/** GET /api/student/recommendations/skills-gap */
const getSkillGap = asyncHandler(async (req, res) => {
  const studentDoc = await loadStudentDoc(req).lean();
  if (!studentDoc) throw notFound('Student profile not found.');

  const result = await buildRecommendations(studentDoc);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    configured: result.configured,
    degraded: Boolean(result.degraded),
    message: result.message || null,
    skillGap: result.skillGap,
    considered: result.considered,
    profileCompletion: result.profileCompletion,
    generatedAt: result.generatedAt,
  });
});

/* -------------------------------------------------------------------------- */
/* ROUTE REGISTRATION                                                         */
/* -------------------------------------------------------------------------- */

export function registerStudentProfileRoutes(router) {
  const studentOnly = requireAuth(['student']);

  router.get(
    '/students/me/profile',
    studentOnly,
    asyncHandler(async (req, res) => {
      const student = await loadStudentDoc(req).lean();
      if (!student) throw notFound('Student profile not found.');

      const profile = serializeStudent(student);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ profile, completion: getProfileCompletion(profile) });
    }),
  );

  router.patch('/students/me/profile', studentOnly, updateOwnProfile);

  router.get(
    '/students/me/profile-completion',
    studentOnly,
    asyncHandler(async (req, res) => {
      const student = await loadStudentDoc(req).lean();
      if (!student) throw notFound('Student profile not found.');
      res.setHeader('Cache-Control', 'no-store');
      res.json(getProfileCompletion(serializeStudent(student)));
    }),
  );

  router.post('/students/me/resume', studentOnly, rawResumeParser, uploadResume);
  router.get('/students/me/resume', studentOnly, getResume);
  router.get('/students/me/resume/file', studentOnly, downloadResume);
  router.delete('/students/me/resume', studentOnly, removeResume);
  router.post('/students/me/resume/parse', studentOnly, reparseResume);
  router.patch('/students/me/resume/confirm', studentOnly, confirmExtract);

  router.get('/student/recommendations', studentOnly, getRecommendations);
  router.get('/student/recommendations/skills-gap', studentOnly, getSkillGap);
}

export { buildRecommendations, maxSizeLabel, serializeApplication, Application, Drive };
export default registerStudentProfileRoutes;
