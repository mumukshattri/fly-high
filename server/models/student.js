/**
 * server/models/student.js
 * ===========================================================================
 * STUDENT ACCOUNT + PROFILE
 * ===========================================================================
 *
 * A student is both an identity (email + password hash) and a profile, because
 * the eligibility engine and the matching engine both need the profile on every
 * request.
 *
 * BACKWARD COMPATIBILITY
 * ----------------------
 * The first version of the portal only stored name/email/rollNumber/phone/
 * university/branch/semester/cgpa/graduationYear/skills/about/resume. Every one
 * of those fields is still here with the same name and meaning, and every new
 * field has a default, so a student document created months ago keeps working
 * and simply reports a lower completion percentage.
 *
 * `branch` stays the short code the eligibility engine compares against a
 * drive's `branches` list. `department` is the readable full name captured by
 * the onboarding wizard, and `branch` is derived from it.
 *
 * `passwordHash` is `select: false`, so a normal query can never accidentally
 * leak it into a response; authentication opts in explicitly.
 *
 * SELF-DECLARED vs VERIFIED
 * -------------------------
 * `verified` is ALWAYS false. The portal has no university registrar
 * integration, so nothing here can honestly be called verified. Anything that
 * arrived through a CSV import is additionally marked `dataSource: 'imported'`
 * and `declaredBy: 'placement-cell'`.
 */

import mongoose from 'mongoose';

/** Resume metadata. The binary lives outside MongoDB (see resume-store.js). */
const resumeSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 200 },
    size: { type: String, default: '', maxlength: 40 },
    uploadedOn: { type: String, default: '' },

    // Private storage handle. Never sent to a client.
    storedName: { type: String, default: '', maxlength: 120 },
    mimeType: { type: String, default: '', maxlength: 120 },
    sizeBytes: { type: Number, default: 0, min: 0 },
    hasText: { type: Boolean, default: false },
    textChars: { type: Number, default: 0, min: 0 },
    parsedAt: { type: String, default: '' },
    extractConfirmedAt: { type: String, default: '' },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: '', maxlength: 1200 },
    techStack: { type: [String], default: [] },
    link: { type: String, default: '', maxlength: 400 },
  },
  { _id: false },
);

const experienceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Internship', 'Work'], default: 'Internship' },
    company: { type: String, default: '', trim: true, maxlength: 160 },
    role: { type: String, default: '', trim: true, maxlength: 160 },
    startDate: { type: String, default: '', maxlength: 20 },
    endDate: { type: String, default: '', maxlength: 20 },
    description: { type: String, default: '', maxlength: 1200 },
    technologies: { type: [String], default: [] },
  },
  { _id: false },
);

const certificationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    issuer: { type: String, default: '', trim: true, maxlength: 160 },
    year: { type: String, default: '', maxlength: 20 },
    link: { type: String, default: '', maxlength: 400 },
  },
  { _id: false },
);

const preferencesSchema = new mongoose.Schema(
  {
    roles: { type: [String], default: [] },
    industries: { type: [String], default: [] },
    locations: { type: [String], default: [] },
    workMode: { type: String, enum: ['Any', 'Onsite', 'Hybrid', 'Remote'], default: 'Any' },
    employmentType: { type: String, enum: ['Any', 'Full Time', 'Internship'], default: 'Any' },
    expectedSalary: { type: String, default: '', maxlength: 60 },
  },
  { _id: false },
);

const previousEducationSchema = new mongoose.Schema(
  {
    level: { type: String, default: '', maxlength: 60 }, // e.g. "Class XII"
    institution: { type: String, default: '', maxlength: 200 },
    board: { type: String, default: '', maxlength: 120 },
    year: { type: String, default: '', maxlength: 20 },
    percentage: { type: String, default: '', maxlength: 20 },
  },
  { _id: false },
);

/**
 * The structured result of reading a resume. Kept strictly separate from the
 * profile: extraction never overwrites what the student typed. The student
 * reviews it and chooses what to accept (`PATCH /resume/confirm`).
 */
const resumeExtractSchema = new mongoose.Schema(
  {
    contact: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    summary: { type: String, default: '', maxlength: 800 },
    skills: { type: [String], default: [] },
    education: {
      degree: { type: String, default: '' },
      department: { type: String, default: '' },
      university: { type: String, default: '' },
      graduationYear: { type: Number, default: null },
      cgpa: { type: Number, default: null },
      percentage: { type: Number, default: null },
      semester: { type: Number, default: null },
      currentYear: { type: Number, default: null },
      backlogs: { type: Number, default: null },
    },
    experience: { type: [experienceSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    achievements: { type: [String], default: [] },
    /** What the server filled into blank profile fields, so it can be undone. */
    applied: {
      fields: { type: [String], default: [] },
      skills: { type: [String], default: [] },
      projectTitles: { type: [String], default: [] },
      experienceKeys: { type: [String], default: [] },
      certificationNames: { type: [String], default: [] },
    },
    appliedAt: { type: String, default: '' },
    textPreview: { type: String, default: '', maxlength: 1200 },
    notes: { type: [String], default: [] },
    extractedAt: { type: String, default: '' },
    confirmedAt: { type: String, default: '' },
  },
  { _id: false },
);

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    passwordHash: { type: String, required: true, select: false },

    /* ------------------------------ identity ------------------------------ */
    rollNumber: { type: String, default: '', trim: true, maxlength: 40 },
    enrollmentNumber: { type: String, default: '', trim: true, maxlength: 60 },
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    university: { type: String, default: '', trim: true, maxlength: 200 },

    /* ------------------------------ academics ----------------------------- */
    branch: { type: String, default: 'CSE', trim: true, maxlength: 40 },
    department: { type: String, default: '', trim: true, maxlength: 120 },
    degree: { type: String, default: '', trim: true, maxlength: 60 },
    specialization: { type: String, default: '', trim: true, maxlength: 120 },
    semester: { type: Number, default: 1, min: 1, max: 8 },
    currentYear: { type: Number, default: 0, min: 0, max: 6 },
    cgpa: { type: Number, default: 0, min: 0, max: 10 },
    backlogs: { type: Number, default: 0, min: 0, max: 50 },
    graduationYear: { type: Number, default: 0 },
    previousEducation: { type: previousEducationSchema, default: null },

    /* ----------------------------- professional --------------------------- */
    skills: { type: [String], default: [] },
    /**
     * Comparison keys (see server/skills.js `skillKey`) of resume skills the
     * student rejected during review. Kept on the profile so re-parsing the same
     * resume cannot add a rejected skill back. Not a separate collection.
     */
    rejectedSkills: { type: [String], default: [] },
    programmingLanguages: { type: [String], default: [] },
    frameworks: { type: [String], default: [] },
    databases: { type: [String], default: [] },
    tools: { type: [String], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    experiences: { type: [experienceSchema], default: [] },
    achievements: { type: [String], default: [] },
    about: { type: String, default: '', maxlength: 2000 },

    /* ---------------------------- preferences ----------------------------- */
    preferences: { type: preferencesSchema, default: () => ({}) },

    /* ------------------------------ resume -------------------------------- */
    resume: { type: resumeSchema, default: null },
    resumeExtract: { type: resumeExtractSchema, default: null },

    /* ----------------------------- onboarding ----------------------------- */
    onboarding: {
      step: { type: Number, default: 0, min: 0, max: 6 },
      completedAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },

    /* ------------------------- provenance / status ------------------------ */
    // No verification source exists, so this stays false and the UI says
    // "self-declared" instead of implying the college confirmed anything.
    verified: { type: Boolean, default: false },
    dataSource: { type: String, enum: ['self-declared', 'imported'], default: 'self-declared' },
    declaredBy: { type: String, enum: ['student', 'placement-cell'], default: 'student' },

    // CSV import creates an account with NO usable password and a one-time
    // activation token (stored hashed). Login is impossible until activation.
    invitationPending: { type: Boolean, default: false, index: true },
    inviteTokenHash: { type: String, default: '', select: false },
    inviteExpiresAt: { type: Date, default: null },
    inviteCreatedAt: { type: Date, default: null },

    placementStatus: { type: String, default: 'Active', trim: true, maxlength: 30 },
    registeredOn: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    profileUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Admin directory filters (department / graduation year / CGPA / completion).
studentSchema.index({ department: 1, graduationYear: 1 });
studentSchema.index({ cgpa: -1 });
studentSchema.index({ name: 'text', email: 'text' });

export const Student = mongoose.models.Student || mongoose.model('Student', studentSchema);
export default Student;
