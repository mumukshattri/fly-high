/**
 * server/serialize.js
 * ===========================================================================
 * DATABASE DOCUMENT -> API OBJECT
 * ===========================================================================
 *
 * The React app was written against a simple `id`-based shape, so every
 * response goes through one of these mappers. Keeping them in a single file
 * means:
 *
 *   - `_id`, `__v` and `passwordHash` can never leak by accident
 *   - the JSON contract the UI depends on is defined in exactly one place
 *   - a populated reference and a raw ObjectId both serialise the same way
 */

/** Accept an ObjectId, a populated document or a string. */
export function toId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

const list = (value) => (Array.isArray(value) ? value : []);

/** Projects / experience / certifications keep their shape but never `_id`. */
function serializeProjects(items) {
  return list(items).map((item) => ({
    title: item.title || '',
    description: item.description || '',
    techStack: list(item.techStack),
    link: item.link || '',
  }));
}

function serializeExperiences(items) {
  return list(items).map((item) => ({
    type: item.type === 'Work' ? 'Work' : 'Internship',
    company: item.company || '',
    role: item.role || '',
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    description: item.description || '',
    technologies: list(item.technologies),
  }));
}

function serializeCertifications(items) {
  return list(items).map((item) => ({
    name: item.name || '',
    issuer: item.issuer || '',
    year: item.year || '',
    link: item.link || '',
  }));
}

/**
 * Resume metadata only. The private storage handle and the extracted text are
 * deliberately absent: they are served by the owner-only resume endpoints.
 */
function serializeResume(resume) {
  if (!resume?.fileName) return null;
  return {
    fileName: resume.fileName,
    size: resume.size || '',
    uploadedOn: resume.uploadedOn || '',
    mimeType: resume.mimeType || '',
    sizeBytes: resume.sizeBytes ?? 0,
    hasText: Boolean(resume.hasText),
    parsedAt: resume.parsedAt || '',
    extractConfirmedAt: resume.extractConfirmedAt || '',
  };
}

/** The structured resume proposal (no raw text). */
function serializeResumeExtract(extract) {
  if (!extract) return null;
  return {
    skills: list(extract.skills),
    contact: {
      name: extract.contact?.name || '',
      email: extract.contact?.email || '',
      phone: extract.contact?.phone || '',
    },
    summary: extract.summary || '',
    education: {
      degree: extract.education?.degree || '',
      department: extract.education?.department || '',
      university: extract.education?.university || '',
      graduationYear: extract.education?.graduationYear ?? null,
      cgpa: extract.education?.cgpa ?? null,
      percentage: extract.education?.percentage ?? null,
      semester: extract.education?.semester ?? null,
      currentYear: extract.education?.currentYear ?? null,
      backlogs: extract.education?.backlogs ?? null,
    },
    experience: serializeExperiences(extract.experience),
    projects: serializeProjects(extract.projects),
    certifications: serializeCertifications(extract.certifications),
    achievements: list(extract.achievements),
    applied: {
      fields: list(extract.applied?.fields),
      skills: list(extract.applied?.skills),
      projectTitles: list(extract.applied?.projectTitles),
      experienceKeys: list(extract.applied?.experienceKeys),
      certificationNames: list(extract.applied?.certificationNames),
    },
    appliedAt: extract.appliedAt || '',
    notes: list(extract.notes),
    extractedAt: extract.extractedAt || '',
    confirmedAt: extract.confirmedAt || '',
  };
}

export function serializeStudent(doc) {
  if (!doc) return null;
  return {
    id: toId(doc),
    role: 'student',
    name: doc.name || '',
    email: doc.email || '',
    rollNumber: doc.rollNumber || '',
    enrollmentNumber: doc.enrollmentNumber || '',
    phone: doc.phone || '',
    university: doc.university || '',

    // Academic
    branch: doc.branch || '',
    department: doc.department || '',
    degree: doc.degree || '',
    specialization: doc.specialization || '',
    semester: doc.semester ?? 1,
    currentYear: doc.currentYear ?? 0,
    cgpa: doc.cgpa ?? 0,
    backlogs: doc.backlogs ?? 0,
    graduationYear: doc.graduationYear ?? 0,
    previousEducation: doc.previousEducation
      ? {
          level: doc.previousEducation.level || '',
          institution: doc.previousEducation.institution || '',
          board: doc.previousEducation.board || '',
          year: doc.previousEducation.year || '',
          percentage: doc.previousEducation.percentage || '',
        }
      : null,

    // Professional
    skills: list(doc.skills),
    programmingLanguages: list(doc.programmingLanguages),
    frameworks: list(doc.frameworks),
    databases: list(doc.databases),
    tools: list(doc.tools),
    certifications: serializeCertifications(doc.certifications),
    projects: serializeProjects(doc.projects),
    experiences: serializeExperiences(doc.experiences),
    achievements: list(doc.achievements),
    about: doc.about || '',

    // Career preferences
    preferences: {
      roles: list(doc.preferences?.roles),
      industries: list(doc.preferences?.industries),
      locations: list(doc.preferences?.locations),
      workMode: doc.preferences?.workMode || 'Any',
      employmentType: doc.preferences?.employmentType || 'Any',
      expectedSalary: doc.preferences?.expectedSalary || '',
    },

    // Resume + extraction proposal
    resume: serializeResume(doc.resume),
    resumeExtract: serializeResumeExtract(doc.resumeExtract),

    // Onboarding
    onboarding: {
      step: doc.onboarding?.step ?? 0,
      completedAt: doc.onboarding?.completedAt || null,
      completed: Boolean(doc.onboarding?.completedAt),
    },

    // Provenance. `verified` is false for every account because the portal has
    // no registrar integration; the UI labels data as self-declared.
    verified: Boolean(doc.verified),
    dataSource: doc.dataSource || 'self-declared',
    declaredBy: doc.declaredBy || 'student',
    invitationPending: Boolean(doc.invitationPending),

    placementStatus: doc.placementStatus || 'Active',
    emailNotifications: doc.emailNotifications !== false,
    driveAnnouncements: doc.driveAnnouncements !== false,
    registeredOn: doc.registeredOn || '',
    profileUpdatedAt: doc.profileUpdatedAt || null,
  };
}

export function serializeCompany(doc) {
  if (!doc) return null;
  return {
    id: toId(doc),
    role: 'company',
    name: doc.name || '',
    industry: doc.industry || '',
    location: doc.location || '',
    website: doc.website || '',
    size: doc.size || '',
    tier: doc.tier || 'Standard',
    hrName: doc.hrName || '',
    hrEmail: doc.hrEmail || '',
    hrPhone: doc.hrPhone || '',
    about: doc.about || '',
    verified: Boolean(doc.verified),
    emailNotifications: doc.emailNotifications !== false,
    registeredOn: doc.registeredOn || '',
  };
}

/**
 * Strip recruiter contact details. Students may browse companies, but they do
 * not need (and should not receive) a named person's email and phone number.
 */
export function publicCompany(company) {
  if (!company) return null;
  const { hrEmail, hrPhone, ...rest } = company;
  return rest;
}

export function serializeAdmin(doc) {
  if (!doc) return null;
  return {
    id: toId(doc),
    role: 'admin',
    name: doc.name || '',
    email: doc.email || '',
    designation: doc.designation || '',
    department: doc.department || '',
    phone: doc.phone || '',
    college: doc.college || '',
  };
}

export function serializeDrive(doc) {
  if (!doc) return null;
  return {
    id: toId(doc),
    companyId: toId(doc.company),
    role: doc.role || '',
    jobType: doc.jobType || 'Full Time',
    location: doc.location || '',
    package: doc.package || 'Not disclosed',
    stipend: doc.stipend || null,
    openings: doc.openings ?? 1,
    minimumCGPA: doc.minimumCGPA ?? 0,
    branches: Array.isArray(doc.branches) ? doc.branches : [],
    requiredSkills: Array.isArray(doc.requiredSkills) ? doc.requiredSkills : [],
    skillMatchMode: doc.skillMatchMode || 'any',
    deadline: doc.deadline || '',
    driveDate: doc.driveDate || doc.deadline || '',
    postedOn: doc.postedOn || '',
    status: doc.status || 'Open',
    tier: doc.tier || 'Standard',
    description: doc.description || '',
    responsibilities: Array.isArray(doc.responsibilities) ? doc.responsibilities : [],
    selectionProcess: Array.isArray(doc.selectionProcess) ? doc.selectionProcess : [],
  };
}

export function serializeApplication(doc) {
  if (!doc) return null;
  return {
    id: toId(doc),
    driveId: toId(doc.drive),
    studentId: toId(doc.student),
    status: doc.status || 'Applied',
    appliedOn: doc.appliedOn || '',
    lastUpdated: doc.lastUpdated || doc.appliedOn || '',
    recruiterNote: doc.recruiterNote || '',
    statusHistory: (doc.statusHistory || []).map((entry) => ({
      status: entry.status,
      date: entry.date,
      note: entry.note || '',
    })),
  };
}

export function serializeNotification(doc) {
  if (!doc) return null;
  return {
    id: toId(doc),
    studentId: toId(doc.student),
    type: doc.type || 'info',
    title: doc.title || '',
    message: doc.message || '',
    date: doc.date || '',
    read: Boolean(doc.read),
  };
}

/** Serialise an account of any role (used by /auth/me and login). */
export function serializeAccount(doc, role) {
  if (role === 'student') return serializeStudent(doc);
  if (role === 'company') return serializeCompany(doc);
  if (role === 'admin') return serializeAdmin(doc);
  return null;
}
