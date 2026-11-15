/**
 * server/api.js
 * ===========================================================================
 * REST API
 * ===========================================================================
 *
 * Contract notes that matter for security:
 *
 *  1. The caller's identity ALWAYS comes from the session cookie, never from a
 *     request body or query string. A `studentId` / `companyId` in a payload is
 *     ignored, so one user cannot act as another.
 *  2. Reads are scoped by role: a student only ever receives their own rows, a
 *     recruiter only rows belonging to their own company's drives.
 *  3. Every write re-checks ownership AND the business rules (eligibility,
 *     duplicate application, deadline, verified company) on the server. The UI
 *     checks exist for good UX; they are not the security boundary.
 *  4. Password hashes never appear in a response (they are `select: false` and
 *     the serialisers never read them).
 */

import express from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

import {
  Application,
  Admin,
  Company,
  Drive,
  Notification,
  Student,
} from './models/index.js';
import {
  authenticateCredentials,
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  sessionTokenFromRequest,
  setSessionCookie,
} from './auth.js';
import { hashPassword } from './password.js';
import {
  asyncHandler,
  badRequest,
  cleanList,
  cleanMultiline,
  cleanText,
  conflict,
  forbidden,
  isEmail,
  isIsoDate,
  isObjectId,
  HttpError,
  notFound,
  today,
  tooManyRequests,
} from './http.js';
import {
  publicCompany,
  serializeAdmin,
  serializeApplication,
  serializeCompany,
  serializeDrive,
  serializeNotification,
  serializeStudent,
} from './serialize.js';
import {
  addClient,
  broadcast,
  currentRevision,
  realtimeTransport,
} from './events.js';
import {
  checkUserThrottle,
  fetchCategories,
  isConfigured as externalJobsConfigured,
  searchExternalJobs,
  sourceInfo as externalJobsSource,
  ADZUNA_MISSING_VARS,
} from './external-jobs.js';
import { registerStudentProfileRoutes, updateOwnProfile } from './students-api.js';
import { registerAdminStudentRoutes } from './admin-students-api.js';
import {
  adminNewCompanySpecs,
  applicationStatusSpec,
  applicationSubmittedSpec,
  companyApprovedSpec,
  companyWelcomeSpec,
  driveClosedSpec,
  drivePublishedSpec,
  newApplicationSpec,
  prepareEmailSpecs,
  queueAdminNewCompany,
  queueApplicationStatus,
  queueApplicationSubmitted,
  queueCompanyApproved,
  queueCompanyWelcome,
  queueDriveAnnouncements,
  queueDriveClosed,
  queueDrivePublished,
  queueNewApplication,
  queueStudentWelcome,
  studentWelcomeSpec,
} from './email/events.js';
import { EMAIL_DRIVE_ANNOUNCEMENTS, emailIsReady } from './email/config.js';
import { skipEmailIntents } from './email/intents.js';
import { registerEmailRoutes } from './email/routes.js';
import { emailLog, safeError } from './email/log.js';
import { databaseStatus } from './db.js';
import { checkEligibility } from '../src/utils/eligibility.js';
import { getPlacementStatistics } from '../src/utils/selectors.js';

export const APPLICATION_STATUSES = ['Applied', 'Under Review', 'Shortlisted', 'Selected', 'Rejected'];
const TARGET_STATUSES = APPLICATION_STATUSES.filter((status) => status !== 'Applied');
const DRIVE_STATUSES = ['Open', 'Closed'];
const ADMIN_NOTIFICATION_LIMIT = 200;

export const apiRouter = express.Router();

/* -------------------------------------------------------------------------- */
/* SCOPED READS                                                               */
/* -------------------------------------------------------------------------- */

/** Ids (as strings) of every drive owned by one company. */
async function driveIdsForCompany(companyId) {
  const docs = await Drive.find({ company: companyId }).select('_id').lean();
  return docs.map((doc) => String(doc._id));
}

async function studentsForCompany(companyId) {
  const driveIds = await driveIdsForCompany(companyId);
  if (driveIds.length === 0) return [];

  const studentIds = await Application.distinct('student', { drive: { $in: driveIds } });
  const docs = await Student.find({ _id: { $in: studentIds } }).sort({ name: 1 }).lean();
  return docs.map(serializeStudent);
}

async function visibleStudents(user) {
  if (user.role === 'admin') {
    return (await Student.find().sort({ name: 1 }).lean()).map(serializeStudent);
  }
  if (user.role === 'student') {
    const doc = await Student.findById(user.id).lean();
    return doc ? [serializeStudent(doc)] : [];
  }
  return studentsForCompany(user.id);
}

async function visibleCompanies(user) {
  const docs = await Company.find().sort({ name: 1 }).lean();
  const companies = docs.map(serializeCompany);

  if (user.role === 'student') return companies.map(publicCompany);
  // A recruiter sees contact details for its own company only.
  return companies.map((company) => (company.id === user.id ? company : publicCompany(company)));
}

async function visibleApplications(user) {
  if (user.role === 'admin') {
    return (await Application.find().sort({ appliedOn: -1, createdAt: -1 }).lean()).map(
      serializeApplication,
    );
  }
  if (user.role === 'student') {
    const docs = await Application.find({ student: user.id })
      .sort({ appliedOn: -1, createdAt: -1 })
      .lean();
    return docs.map(serializeApplication);
  }

  const driveIds = await driveIdsForCompany(user.id);
  if (driveIds.length === 0) return [];
  const docs = await Application.find({ drive: { $in: driveIds } })
    .sort({ appliedOn: -1, createdAt: -1 })
    .lean();
  return docs.map(serializeApplication);
}

async function visibleNotifications(user) {
  if (user.role === 'student') {
    const docs = await Notification.find({ student: user.id })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    return docs.map(serializeNotification);
  }
  if (user.role === 'admin') {
    const docs = await Notification.find()
      .sort({ date: -1, createdAt: -1 })
      .limit(ADMIN_NOTIFICATION_LIMIT)
      .lean();
    return docs.map(serializeNotification);
  }
  // A company has no personal notifications.
  return [];
}

async function canSeeStudent(user, studentId) {
  if (!isObjectId(studentId)) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'student') return user.id === studentId;
  const applicants = await studentsForCompany(user.id);
  return applicants.some((student) => student.id === studentId);
}

/** Load a drive the caller is allowed to manage, or throw. */
async function loadManageableDrive(user, driveId) {
  if (!isObjectId(driveId)) throw notFound('Recruitment drive not found.');
  const drive = await Drive.findById(driveId).lean();
  if (!drive) throw notFound('Recruitment drive not found.');

  if (user.role === 'admin') return drive;
  if (user.role === 'company' && String(drive.company) === user.id) return drive;
  throw forbidden('This drive belongs to another company.');
}

/* -------------------------------------------------------------------------- */
/* AUTH                                                                       */
/* -------------------------------------------------------------------------- */

const loginAttempts = new Map();
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function assertNotRateLimited(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return;
  if (entry.resetAt < Date.now()) {
    loginAttempts.delete(key);
    return;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    throw tooManyRequests('Too many sign-in attempts. Please wait a few minutes and try again.');
  }
}

function recordFailure(key) {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < Date.now()) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

/** POST /api/auth/login */
apiRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const password = String(req.body?.password || '');
    const role = cleanText(req.body?.role, 20);

    if (!email || !password) throw badRequest('Email and password are required.');
    if (role && !['student', 'company', 'admin'].includes(role)) throw badRequest('Unknown role.');

    const key = `${req.ip}:${email}`;
    assertNotRateLimited(key);

    let user;
    try {
      user = await authenticateCredentials({ email, password, role });
    } catch (error) {
      recordFailure(key);
      throw error;
    }

    loginAttempts.delete(key);

    // "Keep me signed in" - the checkbox is checked by default.
    const remember = req.body?.remember !== false;

    const session = await createSession(user, req, { remember });
    setSessionCookie(res, session);
    res.json({ user, loggedInAt: new Date().toISOString() });
  }),
);

/** POST /api/auth/register - students and companies only. */
apiRouter.post(
  '/auth/register',
  asyncHandler(async (req, res) => {
    const role = cleanText(req.body?.role, 20);
    if (!['student', 'company'].includes(role)) {
      throw badRequest('Only students and companies can register.');
    }

    const name = cleanText(req.body?.name, 120);
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const password = String(req.body?.password || '');

    if (!name) {
      throw badRequest(role === 'student' ? 'Full name is required.' : 'Company name is required.');
    }
    if (!isEmail(email)) throw badRequest('Enter a valid email address.');
    if (password.length < 6) throw badRequest('Password must be at least 6 characters.');

    const taken = await Promise.all([
      Student.exists({ email }),
      Company.exists({ hrEmail: email }),
      Admin.exists({ email }),
    ]);
    if (taken.some(Boolean)) throw conflict('An account with this email already exists.');

    const passwordHash = await hashPassword(password);
    const registeredOn = today();

    let account;
    let user;

    if (role === 'company') {
      const companyId = new mongoose.Types.ObjectId();
      const draft = {
        _id: companyId,
        name,
        industry: cleanText(req.body.industry, 120) || 'Not specified',
        location: cleanText(req.body.location, 120) || 'Not specified',
        website: cleanText(req.body.website, 200),
        size: cleanText(req.body.teamSize, 60) || 'Not specified',
        hrName: cleanText(req.body.contactPerson, 120) || name,
        hrEmail: email,
        hrPhone: cleanText(req.body.phone, 40),
        about: cleanMultiline(req.body.about, 2000),
        emailNotifications: true,
        registeredOn,
      };

      // Prepare the durable intents BEFORE the business write. A crash after
      // Company.create but before the outbox insert is recovered by the worker.
      const prepared = await prepareEmailSpecs([
        companyWelcomeSpec(draft, { companyId }),
        ...(await adminNewCompanySpecs(draft, { companyId })),
      ]);

      try {
        account = await Company.create({ ...draft, verified: false, passwordHash });
      } catch (error) {
        await skipEmailIntents(prepared, 'company registration did not complete');
        throw error;
      }

      user = serializeCompany(account.toObject());
      broadcast('companies', { action: 'registered', companyId: user.id });
      await queueCompanyWelcome(account);
      await queueAdminNewCompany(account);
    } else {
      const cgpa = Number(req.body.cgpa);
      if (Number.isNaN(cgpa) || cgpa < 0 || cgpa > 10) {
        throw badRequest('CGPA must be between 0 and 10.');
      }

      const studentId = new mongoose.Types.ObjectId();
      const draft = {
        _id: studentId,
        name,
        email,
        rollNumber: cleanText(req.body.rollNumber, 40),
        phone: cleanText(req.body.phone, 40),
        university: cleanText(req.body.university, 200) || 'Not specified',
        branch: cleanText(req.body.branch, 20) || 'CSE',
        semester: Math.min(8, Math.max(1, Number(req.body.semester) || 1)),
        cgpa,
        graduationYear: Number(req.body.graduationYear) || new Date().getFullYear() + 1,
        skills: cleanList(req.body.skills, { maxLength: 40, limit: 40 }),
        about: cleanMultiline(req.body.about, 2000),
        placementStatus: 'Active',
        registeredOn,
      };

      const prepared = await prepareEmailSpecs([
        studentWelcomeSpec(draft, { studentId }),
      ]);

      try {
        account = await Student.create({ ...draft, passwordHash });
      } catch (error) {
        await skipEmailIntents(prepared, 'student registration did not complete');
        throw error;
      }

      user = serializeStudent(account.toObject());

      try {
        await Notification.create({
          student: user.id,
          type: 'info',
          title: 'Welcome to Job N Job',
          message:
            'Complete your profile and upload your resume to unlock eligible recruitment drives.',
          date: registeredOn,
        });
      } catch (error) {
        emailLog('in-app welcome notification could not be persisted', { error: safeError(error) });
      }

      broadcast('students', { action: 'registered', studentId: user.id });
      broadcast('notifications', { studentId: user.id });
      await queueStudentWelcome(account);
    }

    const session = await createSession(user, req, { remember: req.body?.remember !== false });
    setSessionCookie(res, session);

    res.status(201).json({ user, created: true });
  }),
);

/** GET /api/auth/me */
apiRouter.get(
  '/auth/me',
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

/** POST /api/auth/logout */
apiRouter.post(
  '/auth/logout',
  requireAuth(),
  asyncHandler(async (req, res) => {
    await destroySession(sessionTokenFromRequest(req));
    clearSessionCookie(res);
    res.json({ success: true });
  }),
);

/* -------------------------------------------------------------------------- */
/* STUDENTS                                                                   */
/* -------------------------------------------------------------------------- */

apiRouter.get(
  '/students',
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await visibleStudents(req.user));
  }),
);

apiRouter.get(
  '/students/:id',
  requireAuth(),
  asyncHandler(async (req, res) => {
    if (!(await canSeeStudent(req.user, req.params.id))) {
      throw forbidden('You cannot view this student profile.');
    }
    const doc = await Student.findById(req.params.id).lean();
    if (!doc) throw notFound('Student not found.');
    res.json(serializeStudent(doc));
  }),
);

/**
 * PUT /api/students/profile
 *
 * Kept for backward compatibility with the first version of the UI. It now
 * runs exactly the same validation and persistence as
 * PATCH /api/students/me/profile (see server/students-api.js), so there is one
 * implementation of the profile rules, not two.
 */
apiRouter.put('/students/profile', requireAuth(['student']), updateOwnProfile);

/**
 * The old POST /api/students/resume stored only a file name and a size string.
 * It has been replaced by POST /api/students/me/resume, which stores the real
 * file in private storage, validates its signature and extracts its text.
 * See server/students-api.js.
 */

/* -------------------------------------------------------------------------- */
/* COMPANIES                                                                  */
/* -------------------------------------------------------------------------- */

apiRouter.get(
  '/companies',
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await visibleCompanies(req.user));
  }),
);

/** PATCH /api/companies/me - recruiter email preference. */
apiRouter.patch(
  '/companies/me',
  requireAuth(['company']),
  asyncHandler(async (req, res) => {
    if (typeof req.body?.emailNotifications !== 'boolean') {
      throw badRequest('Only { "emailNotifications": true|false } is supported here.');
    }
    const company = await Company.findByIdAndUpdate(
      req.user.id,
      { $set: { emailNotifications: req.body.emailNotifications } },
      { new: true },
    ).lean();
    if (!company) throw notFound('Company account not found.');
    res.json(serializeCompany(company));
  }),
);

apiRouter.get(
  '/companies/:id/drives',
  requireAuth(),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw notFound('Company not found.');
    if (req.user.role === 'company' && req.user.id !== req.params.id) {
      throw forbidden('You can only view your own drives.');
    }
    const docs = await Drive.find({ company: req.params.id }).sort({ postedOn: -1 }).lean();
    res.json(docs.map(serializeDrive));
  }),
);

/* -------------------------------------------------------------------------- */
/* DRIVES                                                                     */
/* -------------------------------------------------------------------------- */

function readDrivePayload(body = {}) {
  const role = cleanText(body.role, 160);
  if (!role) throw badRequest('Job role is required.');

  const deadline = cleanText(body.deadline, 10);
  if (!isIsoDate(deadline)) throw badRequest('Deadline must be a valid date.');
  if (deadline < today()) throw badRequest('The deadline cannot be in the past.');

  const minimumCGPA = Number(body.minimumCGPA ?? 0);
  if (Number.isNaN(minimumCGPA) || minimumCGPA < 0 || minimumCGPA > 10) {
    throw badRequest('Minimum CGPA must be between 0 and 10.');
  }

  const openings = Number(body.openings ?? 1);
  if (!Number.isInteger(openings) || openings < 1 || openings > 10000) {
    throw badRequest('Openings must be a positive whole number.');
  }

  const driveDate = cleanText(body.driveDate, 10) || deadline;
  if (!isIsoDate(driveDate)) throw badRequest('Interview date must be a valid date.');

  return {
    role,
    jobType: cleanText(body.jobType, 40) || 'Full Time',
    location: cleanText(body.location, 160) || 'Not specified',
    package: cleanText(body.package, 60) || 'Not disclosed',
    stipend: body.stipend ? cleanText(body.stipend, 60) : null,
    openings,
    minimumCGPA,
    branches: cleanList(body.branches, { maxLength: 20, limit: 20 }),
    requiredSkills: cleanList(body.requiredSkills, { maxLength: 40, limit: 30 }),
    skillMatchMode: body.skillMatchMode === 'all' ? 'all' : 'any',
    deadline,
    driveDate,
    tier: cleanText(body.tier, 40) || 'Standard',
    description: cleanMultiline(body.description, 5000),
    responsibilities: cleanList(body.responsibilities, { maxLength: 300, limit: 20 }),
    selectionProcess: cleanList(body.selectionProcess, { maxLength: 300, limit: 20 }),
  };
}

apiRouter.get(
  '/drives',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const docs = await Drive.find().sort({ postedOn: -1, createdAt: -1 }).lean();
    res.json(docs.map(serializeDrive));
  }),
);

apiRouter.get(
  '/drives/:id',
  requireAuth(),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw notFound('Recruitment drive not found.');
    const doc = await Drive.findById(req.params.id).lean();
    if (!doc) throw notFound('Recruitment drive not found.');
    res.json(serializeDrive(doc));
  }),
);

/** POST /api/drives - only a VERIFIED company may publish. */
apiRouter.post(
  '/drives',
  requireAuth(['company']),
  asyncHandler(async (req, res) => {
    const company = await Company.findById(req.user.id).lean();
    if (!company) throw notFound('Company account not found.');
    if (!company.verified) {
      throw forbidden(
        'Your company account is awaiting placement-cell verification, so it cannot publish drives yet.',
      );
    }

    const payload = readDrivePayload(req.body);
    const driveId = new mongoose.Types.ObjectId();
    // Only write the durable announcement handle when the feature is enabled
    // and fully configured. Otherwise a later rollout could reconcile old
    // drives and send announcements for stale postings.
    const announcementJobId = EMAIL_DRIVE_ANNOUNCEMENTS && emailIsReady()
      ? `drive-announcements/${driveId}`
      : '';
    const prepared = await prepareEmailSpecs([
      drivePublishedSpec(
        {
          _id: driveId,
          role: payload.role,
          location: payload.location,
          package: payload.package,
          deadline: payload.deadline,
        },
        company,
        { driveId },
      ),
    ]);

    let doc;
    try {
      doc = await Drive.create({
        _id: driveId,
        company: req.user.id,
        ...payload,
        postedOn: today(),
        status: 'Open',
        announcementJobId,
      });
    } catch (error) {
      await skipEmailIntents(prepared, 'drive creation did not complete');
      throw error;
    }

    const drive = serializeDrive(doc.toObject());
    broadcast('drives', { action: 'created', driveId: drive.id });
    await queueDrivePublished(doc, company);
    await queueDriveAnnouncements(doc, company);
    res.status(201).json(drive);
  }),
);

/** PATCH /api/drives/:id - close/reopen, or edit the whole drive. */
apiRouter.patch(
  '/drives/:id',
  requireAuth(['company', 'admin']),
  asyncHandler(async (req, res) => {
    const drive = await loadManageableDrive(req.user, req.params.id);
    const previousStatus = drive.status;
    const body = req.body || {};
    const update = {};

    if ('status' in body) {
      const status = cleanText(body.status, 20);
      if (!DRIVE_STATUSES.includes(status)) throw badRequest('Status must be Open or Closed.');
      update.status = status;
    }

    // Full edit (company "edit drive" form).
    if ('role' in body || 'deadline' in body || 'minimumCGPA' in body) {
      Object.assign(update, readDrivePayload(body));
    }

    if (Object.keys(update).length === 0) throw badRequest('Nothing to update.');

    const closing = previousStatus === 'Open' && update.status === 'Closed';
    const company = closing ? await Company.findById(drive.company).lean() : null;
    const prepared = closing && company
      ? await prepareEmailSpecs([driveClosedSpec(drive, company)])
      : [];

    try {
      await Drive.updateOne({ _id: drive._id }, { $set: update });
    } catch (error) {
      await skipEmailIntents(prepared, 'drive update did not complete');
      throw error;
    }
    const updated = await Drive.findById(drive._id).lean();

    broadcast('drives', { action: 'updated', driveId: req.params.id });
    if (previousStatus === 'Open' && updated?.status === 'Closed' && company) {
      await queueDriveClosed(updated, company);
    }
    res.json(serializeDrive(updated));
  }),
);

/* -------------------------------------------------------------------------- */
/* APPLICATIONS                                                               */
/* -------------------------------------------------------------------------- */

apiRouter.get(
  '/applications',
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await visibleApplications(req.user));
  }),
);

apiRouter.get(
  '/applications/:id',
  requireAuth(),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw notFound('Application not found.');
    const doc = await Application.findById(req.params.id).lean();
    if (!doc) throw notFound('Application not found.');

    if (req.user.role === 'student' && String(doc.student) !== req.user.id) {
      throw forbidden('This application belongs to another student.');
    }
    if (req.user.role === 'company') {
      const drive = await Drive.findById(doc.drive).select('company').lean();
      if (!drive || String(drive.company) !== req.user.id) {
        throw forbidden('This application belongs to another company.');
      }
    }

    res.json(serializeApplication(doc));
  }),
);

/**
 * POST /api/applications
 * Re-runs every rule on the server: the drive must be open, the deadline
 * respected, the profile eligible, and the application unique.
 */
apiRouter.post(
  '/applications',
  requireAuth(['student']),
  asyncHandler(async (req, res) => {
    const driveId = cleanText(req.body?.driveId, 60);
    if (!isObjectId(driveId)) throw badRequest('A drive must be selected.');

    const studentDoc = await Student.findById(req.user.id).lean();
    if (!studentDoc) throw notFound('Student profile not found.');

    const driveDoc = await Drive.findById(driveId).lean();
    if (!driveDoc) throw notFound('This recruitment drive is no longer available.');

    const student = serializeStudent(studentDoc);
    const drive = serializeDrive(driveDoc);

    const duplicate = await Application.exists({ student: req.user.id, drive: driveId });
    if (duplicate) throw conflict('You have already applied for this drive.');

    const eligibility = checkEligibility(student, drive);
    if (!eligibility.eligible) {
      throw forbidden(`You are not eligible for this drive. ${eligibility.reasons[0] || ''}`.trim());
    }

    const date = today();
    const applicationId = new mongoose.Types.ObjectId();
    const appliedEventId = randomUUID();
    const company = await Company.findById(driveDoc.company)
      .select('name hrEmail hrName emailNotifications')
      .lean();

    const applicationDraft = { _id: applicationId, appliedOn: date };
    const prepared = await prepareEmailSpecs([
      applicationSubmittedSpec({
        application: applicationDraft,
        student: studentDoc,
        drive: driveDoc,
        company,
        applicationId,
      }),
      newApplicationSpec({
        application: applicationDraft,
        student: studentDoc,
        drive: driveDoc,
        company,
        applicationId,
      }),
    ]);

    let created;
    try {
      created = await Application.create({
        _id: applicationId,
        drive: driveId,
        student: req.user.id,
        status: 'Applied',
        appliedOn: date,
        lastUpdated: date,
        recruiterNote: '',
        statusHistory: [
          {
            status: 'Applied',
            date,
            note: 'Application submitted by the student.',
            eventId: appliedEventId,
          },
        ],
      });
    } catch (error) {
      await skipEmailIntents(prepared, 'application creation did not complete');
      // The unique (drive, student) index wins the race between two clicks.
      if (error?.code === 11000) throw conflict('You have already applied for this drive.');
      throw error;
    }

    try {
      await Notification.create({
        student: req.user.id,
        type: 'success',
        title: 'Application submitted',
        message: `Your application for ${drive.role} at ${company?.name || 'the company'} was submitted successfully.`,
        date,
      });
    } catch (error) {
      // The application exists; an in-app notification failure must not turn a
      // successful submission into an error response.
      emailLog('in-app application notification could not be persisted', {
        error: safeError(error),
      });
    }

    await queueApplicationSubmitted({ application: created, student: studentDoc, drive: driveDoc, company });
    await queueNewApplication({ application: created, student: studentDoc, drive: driveDoc, company });

    broadcast('applications', { action: 'created', driveId });
    broadcast('notifications', { studentId: req.user.id });
    broadcast('companies', { action: 'application-created' });

    res.status(201).json(serializeApplication(created.toObject()));
  }),
);

/** PATCH /api/applications/:id - move a candidate through the pipeline. */
apiRouter.patch(
  '/applications/:id',
  requireAuth(['company', 'admin']),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw notFound('Application not found.');

    const application = await Application.findById(req.params.id);
    if (!application) throw notFound('Application not found.');

    const drive = await Drive.findById(application.drive).lean();
    if (!drive) throw notFound('The drive for this application no longer exists.');
    if (req.user.role === 'company' && String(drive.company) !== req.user.id) {
      throw forbidden('This application belongs to another company.');
    }

    const status = cleanText(req.body?.status, 30);
    if (!TARGET_STATUSES.includes(status)) throw badRequest('Unknown application status.');
    if (application.status === status) {
      return res.json(serializeApplication(application.toObject()));
    }

    const note = cleanText(req.body?.note, 500);
    const date = today();
    const transitionId = randomUUID();
    const company = await Company.findById(drive.company).select('name').lean();
    const studentDoc = await Student.findById(application.student).lean();

    // Durable intent first: if the process dies after the atomic status write,
    // the worker confirms the transition id and queues the email.
    const prepared = studentDoc
      ? await prepareEmailSpecs([
          applicationStatusSpec({
            application,
            student: studentDoc,
            drive,
            company,
            status,
            transitionId,
          }),
        ])
      : [];

    let updated;
    try {
      const update = {
        $set: {
          status,
          lastUpdated: date,
          ...(note ? { recruiterNote: note } : {}),
        },
        $push: {
          statusHistory: {
            status,
            date,
            note: note || `Status changed to ${status} by the recruiter.`,
            eventId: transitionId,
          },
        },
      };
      updated = await Application.findOneAndUpdate(
        { _id: application._id, status: { $ne: status } },
        update,
        { new: true },
      );
    } catch (error) {
      await skipEmailIntents(prepared, 'application status update did not complete');
      throw error;
    }

    if (!updated) {
      // Another concurrent request already made this exact transition.
      await skipEmailIntents(prepared, 'duplicate concurrent status transition');
      const current = await Application.findById(application._id).lean();
      return res.json(serializeApplication(current || application.toObject()));
    }

    const type = status === 'Rejected' ? 'danger' : status === 'Selected' ? 'success' : 'info';

    try {
      await Notification.create({
        student: application.student,
        type,
        title: `Application ${status}`,
        message: `${company?.name || 'The company'} updated your application for ${drive.role} to "${status}".`,
        date,
      });
    } catch (error) {
      // The status change is the business truth. A notification failure must
      // not turn a successful update into an error response.
      emailLog('in-app notification could not be persisted', { error: safeError(error) });
    }

    if (studentDoc) {
      await queueApplicationStatus({
        application: updated,
        student: studentDoc,
        drive,
        company,
        status,
        transitionId,
      });
    }

    broadcast('applications', { action: 'status-changed', applicationId: req.params.id });
    broadcast('notifications', { studentId: String(application.student) });
    if (status === 'Selected') {
      broadcast('students', { action: 'placed', studentId: String(application.student) });
    }

    res.json(serializeApplication(updated.toObject()));
  }),
);

/* -------------------------------------------------------------------------- */
/* NOTIFICATIONS                                                              */
/* -------------------------------------------------------------------------- */

apiRouter.get(
  '/notifications',
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await visibleNotifications(req.user));
  }),
);

apiRouter.patch(
  '/notifications/:id',
  requireAuth(),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw notFound('Notification not found.');
    const notification = await Notification.findById(req.params.id);
    if (!notification) throw notFound('Notification not found.');

    if (req.user.role === 'student' && String(notification.student) !== req.user.id) {
      throw forbidden('This notification belongs to another user.');
    }
    if (req.body?.read !== true) throw badRequest('Only { "read": true } is supported here.');

    notification.read = true;
    await notification.save();

    broadcast('notifications', { studentId: String(notification.student) });
    res.json(serializeNotification(notification.toObject()));
  }),
);

apiRouter.patch(
  '/notifications',
  requireAuth(['student']),
  asyncHandler(async (req, res) => {
    if (req.body?.readAll !== true) throw badRequest('Only { "readAll": true } is supported here.');
    await Notification.updateMany({ student: req.user.id, read: false }, { $set: { read: true } });
    broadcast('notifications', { studentId: req.user.id });
    res.json({ success: true });
  }),
);

/* -------------------------------------------------------------------------- */
/* ADMIN                                                                      */
/* -------------------------------------------------------------------------- */

apiRouter.get(
  '/admin/statistics',
  requireAuth(['admin']),
  asyncHandler(async (req, res) => {
    const [students, companies, drives, applications] = await Promise.all([
      Student.find().lean(),
      Company.find().lean(),
      Drive.find().lean(),
      Application.find().lean(),
    ]);

    res.json(
      getPlacementStatistics({
        students: students.map(serializeStudent),
        companies: companies.map(serializeCompany),
        drives: drives.map(serializeDrive),
        applications: applications.map(serializeApplication),
      }),
    );
  }),
);

/** PATCH /api/admin/companies/:id - approve or suspend a recruiter. */
apiRouter.patch(
  '/admin/companies/:id',
  requireAuth(['admin']),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw notFound('Company not found.');
    if (typeof req.body?.verified !== 'boolean') {
      throw badRequest('Only { "verified": true|false } is supported here.');
    }

    const existing = await Company.findById(req.params.id);
    if (!existing) throw notFound('Company not found.');

    const wasVerified = existing.verified;
    const approving = !wasVerified && req.body.verified;
    const prepared = approving
      ? await prepareEmailSpecs([companyApprovedSpec(existing)])
      : [];

    existing.verified = req.body.verified;
    try {
      await existing.save();
    } catch (error) {
      await skipEmailIntents(prepared, 'company approval did not complete');
      throw error;
    }
    const company = existing.toObject();

    broadcast('companies', { action: 'verified', companyId: req.params.id });
    if (!wasVerified && company.verified) {
      await queueCompanyApproved(existing);
    }
    res.json(serializeCompany(company));
  }),
);

/** GET /api/admin/export - a full JSON backup for the placement cell. */
apiRouter.get(
  '/admin/export',
  requireAuth(['admin']),
  asyncHandler(async (req, res) => {
    const [students, companies, drives, applications, notifications] = await Promise.all([
      Student.find().lean(),
      Company.find().lean(),
      Drive.find().lean(),
      Application.find().lean(),
      Notification.find().lean(),
    ]);

    res.json({
      exportedAt: new Date().toISOString(),
      students: students.map(serializeStudent),
      companies: companies.map(serializeCompany),
      drives: drives.map(serializeDrive),
      applications: applications.map(serializeApplication),
      notifications: notifications.map(serializeNotification),
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* PROFILE, RESUME, RECOMMENDATIONS AND ADMIN STUDENT MANAGEMENT              */
/* -------------------------------------------------------------------------- */

registerStudentProfileRoutes(apiRouter);
registerAdminStudentRoutes(apiRouter);
registerEmailRoutes(apiRouter);

/* -------------------------------------------------------------------------- */
/* EXTERNAL JOB DISCOVERY (Adzuna)                                            */
/* -------------------------------------------------------------------------- */

/**
 * External vacancies are a READ-THROUGH view of another company's API.
 * Nothing here touches MongoDB: an external job is never stored as a Drive and
 * never creates an Application, so the placement records stay purely internal.
 *
 * Parameters are validated/clamped here (never forwarded raw), and the shared
 * provider credentials never leave the server.
 */

const EXTERNAL_SORTS = ['relevance', 'date', 'salary'];

function integerParam(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw badRequest('Numeric query parameters must be whole numbers.');
  const parsed = Number(value);
  return Math.min(Math.max(parsed, min), max);
}

function externalJobsQuery(req) {
  const category = cleanText(req.query.category, 60);
  if (category && !/^[a-z0-9-]{2,60}$/.test(category)) {
    throw badRequest('That job category is not valid.');
  }

  const sortBy = cleanText(req.query.sortBy, 20).toLowerCase();
  if (sortBy && !EXTERNAL_SORTS.includes(sortBy)) {
    throw badRequest(`sortBy must be one of: ${EXTERNAL_SORTS.join(', ')}.`);
  }

  return {
    what: cleanText(req.query.what, 100),
    where: cleanText(req.query.where, 60),
    category,
    page: integerParam(req.query.page, 1, 1, 20),
    resultsPerPage: integerParam(req.query.resultsPerPage, 20, 1, 50),
    maxDaysOld: integerParam(req.query.maxDaysOld, null, 1, 30),
    sortBy,
  };
}

apiRouter.get(
  '/external-jobs',
  requireAuth(['student']),
  asyncHandler(async (req, res) => {
    // Validate first: a malformed request is a 400 whether or not the provider
    // happens to be configured.
    const query = externalJobsQuery(req);

    // Answered before the query is sent anywhere, so a misconfigured server
    // never produces an empty but "successful" list.
    if (!externalJobsConfigured()) {
      res.status(503).json({
        error:
          'External job search is not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to the server .env file and restart it.',
        details: { code: 'not_configured', missing: ADZUNA_MISSING_VARS },
      });
      return;
    }

    checkUserThrottle(String(req.user.id));
    const result = await searchExternalJobs(query);

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(result);
  }),
);

/** Adzuna's own category list for the configured country. */
apiRouter.get(
  '/external-jobs/categories',
  requireAuth(['student']),
  asyncHandler(async (req, res) => {
    if (!externalJobsConfigured()) {
      res.status(503).json({
        error:
          'External job search is not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to the server .env file and restart it.',
        details: { code: 'not_configured', missing: ADZUNA_MISSING_VARS },
      });
      return;
    }

    res.json(await fetchCategories());
  }),
);

/** What the UI shows when there is no provider configuration at all. */
apiRouter.get(
  '/external-jobs/status',
  requireAuth(['student']),
  asyncHandler(async (req, res) => {
    res.json({
      configured: externalJobsConfigured(),
      missing: ADZUNA_MISSING_VARS,
      source: externalJobsSource(),
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* REAL-TIME                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/realtime/version - the cursor a polling client watches.
 *
 * `transport` tells a browser which mechanism this deployment supports, so a
 * Vercel function never leaves an EventSource hanging: it polls instead.
 */
apiRouter.get(
  '/realtime/version',
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      revision: await currentRevision(),
      transport: realtimeTransport(),
      at: new Date().toISOString(),
    });
  }),
);

apiRouter.get(
  '/realtime/events',
  requireAuth(),
  asyncHandler(async (req, res) => {
    // A long-lived stream makes no sense on a serverless platform: answer
    // immediately and let the client use the revision cursor.
    if (realtimeTransport() === 'poll') {
      res.status(204).end();
      return;
    }
    addClient(res, req.user);
  }),
);

/* -------------------------------------------------------------------------- */
/* META                                                                       */
/* -------------------------------------------------------------------------- */

apiRouter.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), database: databaseStatus() });
});

/** Unknown API route -> JSON 404 rather than the SPA fallback. */
apiRouter.use((req, res, next) => {
  next(new HttpError(404, `No endpoint for ${req.method} ${req.originalUrl}.`));
});

export default apiRouter;
