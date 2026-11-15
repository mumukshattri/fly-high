/**
 * server/email/events.js
 * ===========================================================================
 * BUSINESS EVENT -> DURABLE INTENT -> OUTBOX
 * ===========================================================================
 * Each event has a pure spec builder. A business route can prepare the spec
 * BEFORE its database write, then commit the intent after the write succeeds.
 * The legacy `queue...` helpers still work on their own: they prepare and
 * commit in one step, and the unique idempotency key makes that a no-op if the
 * route already prepared the same event.
 *
 * These functions are deliberately fail-soft: an email problem must never
 * prevent the business operation that called them from succeeding.
 */

import { randomUUID } from 'node:crypto';

import { EMAIL_DRIVE_ANNOUNCEMENTS, emailIsReady } from './config.js';
import { emailLog, safeError } from './log.js';
import {
  commitEmailIntent,
  enqueueIntentNow,
  prepareEmailIntent,
} from './intents.js';
import { ensureDriveAnnouncementJob, scheduleEmailFanout } from './fanout.js';
import { scheduleEmailDrain } from './worker.js';
import { Admin, Company, Drive } from '../models/index.js';
import { isEmail } from '../http.js';

const idOf = (value) => (value?._id ? String(value._id) : value ? String(value) : null);

/* -------------------------------------------------------------------------- */
/* PREPARE / COMMIT HELPERS                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Insert one outbox row through the durable intent journal. A duplicate
 * idempotency key is a successful no-op. Never throws to the caller.
 */
export async function enqueueEmail(spec) {
  if (!spec) return null;
  if (!isEmail(spec.recipient?.email)) {
    emailLog('skipped invalid recipient', {
      eventType: spec.eventType,
      templateId: spec.templateId,
    });
    return null;
  }

  const intent = await prepareEmailIntent(spec);
  if (!intent) return null;
  const result = await commitEmailIntent(intent);
  if (result?.queued && spec.drain !== false) scheduleEmailDrain();
  return result;
}

export async function prepareEmailSpec(spec) {
  if (!spec) return null;
  return prepareEmailIntent(spec);
}

export async function prepareEmailSpecs(specs) {
  const prepared = [];
  for (const spec of specs || []) {
    const intent = await prepareEmailIntent(spec);
    if (intent) prepared.push(intent);
  }
  return prepared;
}

export async function commitPreparedEmails(intents, { drain = true } = {}) {
  const list = Array.isArray(intents) ? intents : [intents];
  const results = [];
  for (const intent of list.filter(Boolean)) {
    results.push(await commitEmailIntent(intent));
  }
  if (drain && results.some((result) => result?.queued)) scheduleEmailDrain();
  return results;
}

export async function enqueueEmailBatch(specs, { drain = true } = {}) {
  const results = [];
  for (const spec of specs || []) {
    results.push(await enqueueEmail({ ...spec, drain: false }));
  }
  if (drain && results.some((result) => result?.queued)) scheduleEmailDrain();
  return results;
}

/* -------------------------------------------------------------------------- */
/* SPEC BUILDERS                                                               */
/* -------------------------------------------------------------------------- */

export function studentWelcomeSpec(student, { studentId } = {}) {
  if (!student || student.emailNotifications === false) return null;
  const id = studentId || idOf(student);
  if (!id) return null;
  return {
    eventType: 'student.welcome',
    templateId: 'student-welcome',
    recipient: { email: student.email, name: student.name, role: 'student' },
    related: { student: id },
    data: { studentName: student.name },
    idempotencyKey: `student-welcome/${id}`,
    verify: { kind: 'student-created', id: String(id) },
  };
}

export function companyWelcomeSpec(company, { companyId } = {}) {
  if (!company || company.emailNotifications === false) return null;
  const id = companyId || idOf(company);
  if (!id) return null;
  return {
    eventType: 'company.welcome',
    templateId: 'company-welcome',
    recipient: { email: company.hrEmail, name: company.hrName || company.name, role: 'company' },
    related: { company: id },
    data: { companyName: company.name, hrName: company.hrName },
    idempotencyKey: `company-welcome/${id}`,
    verify: { kind: 'company-created', id: String(id) },
  };
}

export function companyApprovedSpec(company) {
  if (!company || company.emailNotifications === false) return null;
  const id = idOf(company);
  if (!id) return null;
  return {
    eventType: 'company.approved',
    templateId: 'company-approved',
    recipient: { email: company.hrEmail, name: company.hrName || company.name, role: 'company' },
    related: { company: id },
    data: { companyName: company.name },
    idempotencyKey: `company-approved/${id}`,
    verify: { kind: 'company-approved', id: String(id) },
  };
}

export async function adminNewCompanySpecs(company, { companyId } = {}) {
  if (!company) return [];
  const id = companyId || idOf(company);
  if (!id) return [];

  let admins = [];
  try {
    admins = await Admin.find({}).select('email name').lean();
  } catch (error) {
    emailLog('admin lookup failed', { error: safeError(error) });
    return [];
  }

  return admins.map((admin) => ({
    eventType: 'admin.new-company',
    templateId: 'admin-new-company',
    recipient: { email: admin.email, name: admin.name, role: 'admin' },
    related: { company: id, admin: admin._id },
    data: {
      companyName: company.name,
      industry: company.industry,
      location: company.location,
      hrName: company.hrName,
      hrEmail: company.hrEmail,
      registeredOn: company.registeredOn,
    },
    idempotencyKey: `admin-new-company/${id}/${idOf(admin)}`,
    verify: { kind: 'company-created', id: String(id) },
  }));
}

export function applicationSubmittedSpec({ application, student, drive, company, applicationId } = {}) {
  if (!application || !student || !drive || student.emailNotifications === false) return null;
  const appId = applicationId || idOf(application);
  if (!appId) return null;
  return {
    eventType: 'application.submitted',
    templateId: 'application-submitted',
    recipient: { email: student.email, name: student.name, role: 'student' },
    related: { application: appId, student: idOf(student), drive: idOf(drive), company: idOf(company) },
    data: {
      studentName: student.name,
      companyName: company?.name || 'the company',
      role: drive.role,
      appliedOn: application.appliedOn,
    },
    idempotencyKey: `application-submitted/${appId}`,
    verify: { kind: 'application-created', id: String(appId) },
  };
}

export function newApplicationSpec({ application, student, drive, company, applicationId } = {}) {
  if (!application || !student || !drive || !company || company.emailNotifications === false) {
    return null;
  }
  const appId = applicationId || idOf(application);
  if (!appId) return null;
  return {
    eventType: 'application.new-applicant',
    templateId: 'new-application',
    recipient: { email: company.hrEmail, name: company.hrName || company.name, role: 'company' },
    related: { application: appId, student: idOf(student), drive: idOf(drive), company: idOf(company) },
    data: {
      companyName: company.name,
      role: drive.role,
      studentName: student.name,
      branch: student.branch,
      cgpa: student.cgpa,
      skills: student.skills,
      appliedOn: application.appliedOn,
    },
    idempotencyKey: `new-application/${appId}`,
    verify: { kind: 'application-created', id: String(appId) },
  };
}

export function applicationStatusSpec({
  application,
  student,
  drive,
  company,
  status,
  transitionId,
} = {}) {
  if (!application || !student || !drive || !status) return null;
  if (student.emailNotifications === false) return null;

  const appId = idOf(application);
  if (!appId) return null;

  const eventId =
    transitionId ||
    application.statusHistory?.[application.statusHistory.length - 1]?.eventId ||
    randomUUID();

  const templateId =
    status === 'Shortlisted'
      ? 'application-shortlisted'
      : status === 'Rejected'
        ? 'application-rejected'
        : 'application-status';

  return {
    eventType: `application.${status.toLowerCase().replace(/\s+/g, '-')}`,
    templateId,
    recipient: { email: student.email, name: student.name, role: 'student' },
    related: { application: appId, student: idOf(student), drive: idOf(drive), company: idOf(company) },
    data: {
      studentName: student.name,
      companyName: company?.name || 'the company',
      role: drive.role,
      status,
    },
    idempotencyKey: `application-status/${appId}/${eventId}`,
    verify: { kind: 'application-transition', id: String(appId), eventId: String(eventId) },
  };
}

export function drivePublishedSpec(drive, company, { driveId } = {}) {
  if (!drive || !company || company.emailNotifications === false) return null;
  const id = driveId || idOf(drive);
  if (!id) return null;
  return {
    eventType: 'drive.published',
    templateId: 'drive-published',
    recipient: { email: company.hrEmail, name: company.hrName || company.name, role: 'company' },
    related: { drive: id, company: idOf(company) },
    data: {
      role: drive.role,
      location: drive.location,
      package: drive.package,
      deadline: drive.deadline,
    },
    idempotencyKey: `drive-published/${id}`,
    verify: { kind: 'drive-created', id: String(id) },
  };
}

export function driveClosedSpec(drive, company) {
  if (!drive || !company || company.emailNotifications === false) return null;
  const id = idOf(drive);
  if (!id) return null;
  return {
    eventType: 'drive.closed',
    templateId: 'drive-closed',
    recipient: { email: company.hrEmail, name: company.hrName || company.name, role: 'company' },
    related: { drive: id, company: idOf(company) },
    data: { role: drive.role, companyName: company.name },
    idempotencyKey: `drive-closed/${id}`,
    verify: { kind: 'drive-closed', id: String(id) },
  };
}

export function driveDeadlineSpec(drive, company, days = 3) {
  if (!drive || !company || company.emailNotifications === false) return null;
  const id = idOf(drive);
  if (!id) return null;
  return {
    eventType: 'drive.deadline',
    templateId: 'drive-deadline',
    recipient: { email: company.hrEmail, name: company.hrName || company.name, role: 'company' },
    related: { drive: id, company: idOf(company) },
    data: { role: drive.role, companyName: company.name, deadline: drive.deadline, days },
    idempotencyKey: `drive-deadline/${id}/${drive.deadline}/${days}d`,
    verify: { kind: 'drive-deadline', id: String(id), deadline: drive.deadline },
  };
}

/* -------------------------------------------------------------------------- */
/* ACCOUNT EVENTS                                                             */
/* -------------------------------------------------------------------------- */

export async function queueStudentWelcome(student) {
  return enqueueEmail(studentWelcomeSpec(student));
}

export async function queueCompanyWelcome(company) {
  return enqueueEmail(companyWelcomeSpec(company));
}

export async function queueCompanyApproved(company) {
  return enqueueEmail(companyApprovedSpec(company));
}

export async function queueAdminNewCompany(company) {
  const specs = await adminNewCompanySpecs(company);
  return enqueueEmailBatch(specs);
}

/* -------------------------------------------------------------------------- */
/* APPLICATION EVENTS                                                         */
/* -------------------------------------------------------------------------- */

export async function queueApplicationSubmitted(args) {
  return enqueueEmail(applicationSubmittedSpec(args));
}

export async function queueNewApplication(args) {
  return enqueueEmail(newApplicationSpec(args));
}

export async function queueApplicationStatus(args) {
  return enqueueEmail(applicationStatusSpec(args));
}

/* -------------------------------------------------------------------------- */
/* DRIVE EVENTS                                                               */
/* -------------------------------------------------------------------------- */

export async function queueDrivePublished(drive, company) {
  return enqueueEmail(drivePublishedSpec(drive, company));
}

/**
 * Drive creation no longer enumerates students. It creates one durable job;
 * the worker walks eligible students in bounded, cursor-paginated batches.
 */
export async function queueDriveAnnouncements(drive, company) {
  if (!EMAIL_DRIVE_ANNOUNCEMENTS || !drive || !company) return null;
  if (!drive.announcementJobId) return null;
  if (!emailIsReady()) return null;

  const job = await ensureDriveAnnouncementJob(drive, { company });
  if (!job) return null;
  scheduleEmailFanout();
  return { background: true, jobId: job.jobId };
}

export async function queueDriveClosed(drive, company) {
  return enqueueEmail(driveClosedSpec(drive, company));
}

export async function queueDriveDeadline(drive, company, days = 3) {
  return enqueueIntentNow(driveDeadlineSpec(drive, company, days));
}

/** Daily scan used by the authenticated worker. */
export async function queueDeadlineReminders(days = 3) {
  if (!emailIsReady()) return { drives: 0 };
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + days);
  const deadline = target.toISOString().slice(0, 10);

  let drives = [];
  try {
    drives = await Drive.find({ status: 'Open', deadline }).lean();
  } catch (error) {
    emailLog('deadline scan failed', { error: safeError(error) });
    return { drives: 0 };
  }

  let queued = 0;
  for (const drive of drives) {
    const company = await Company.findById(drive.company).lean();
    if (!company) continue;
    const result = await queueDriveDeadline(drive, company, days);
    if (result?.queued) queued += 1;
  }
  return { drives: drives.length, queued };
}
