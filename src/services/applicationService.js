/**
 * services/applicationService.js
 * ===========================================================================
 * APPLICATIONS  (the student -> drive link that companies then review)
 * ===========================================================================
 *
 *   getApplications()            ->  GET   /api/applications
 *   getApplicationById(id)       ->  GET   /api/applications/:id
 *   getApplicationsByStudent(id) ->  GET   /api/students/:id/applications
 *   getApplicationsByDrive(id)   ->  GET   /api/drives/:id/applications
 *   applyToDrive(payload)        ->  POST  /api/applications
 *   updateStatus(payload)        ->  PATCH /api/applications/:id
 *
 * `applyToDrive` repeats the eligibility check. The UI already disables the
 * button for ineligible students (good UX), but a real backend must always
 * re-validate, because a browser can be tampered with.
 */

import { checkEligibility } from '../utils/eligibility';
import { createId, mutate, query, today } from './localDatabase';

/** GET /api/applications?studentId=&driveId=&status= */
export async function getApplications({ studentId, driveId, status } = {}) {
  return query((db) =>
    db.applications.filter((application) => {
      if (studentId && application.studentId !== studentId) return false;
      if (driveId && application.driveId !== driveId) return false;
      if (status && application.status !== status) return false;
      return true;
    }),
  );
}

/** GET /api/applications/:id */
export async function getApplicationById(applicationId) {
  return query((db) => db.applications.find((application) => application.id === applicationId) || null);
}

/** GET /api/students/:id/applications */
export async function getApplicationsByStudent(studentId) {
  return getApplications({ studentId });
}

/** GET /api/drives/:id/applications */
export async function getApplicationsByDrive(driveId) {
  return getApplications({ driveId });
}

/** Used to disable the Apply button on the drives page. */
export async function hasApplied(studentId, driveId) {
  return query((db) =>
    db.applications.some(
      (application) => application.studentId === studentId && application.driveId === driveId,
    ),
  );
}

/**
 * POST /api/applications
 * @param {{studentId:string, driveId:string}} payload
 * @returns the created application (status = 'Applied')
 */
export async function applyToDrive({ studentId, driveId }) {
  return mutate((db) => {
    const student = db.students.find((item) => item.id === studentId);
    const drive = db.drives.find((item) => item.id === driveId);

    if (!student) throw new Error('Student not found. Please log in again.');
    if (!drive) throw new Error('This recruitment drive is no longer available.');

    // 1. No duplicate applications for the same drive.
    const alreadyApplied = db.applications.some(
      (application) => application.studentId === studentId && application.driveId === driveId,
    );
    if (alreadyApplied) throw new Error('You have already applied for this drive.');

    // 2. Server-side eligibility re-check.
    const eligibility = checkEligibility(student, drive);
    if (!eligibility.eligible) {
      throw new Error(`You are not eligible for this drive. ${eligibility.reasons[0] || ''}`.trim());
    }

    const application = {
      id: createId('app'),
      driveId,
      studentId,
      status: 'Applied',
      appliedOn: today(),
      lastUpdated: today(),
      recruiterNote: '',
      statusHistory: [
        { status: 'Applied', date: today(), note: 'Application submitted by the student.' },
      ],
    };

    db.applications.unshift(application);

    // The backend would raise this notification automatically.
    db.notifications.unshift({
      id: createId('ntf'),
      studentId,
      type: 'success',
      title: 'Application submitted',
      message: `Your application for ${drive.role} was submitted successfully.`,
      date: today(),
      read: false,
    });

    return application;
  });
}

/**
 * PATCH /api/applications/:id
 * Used by the company dashboard when a recruiter shortlists / rejects a student.
 * @param {{applicationId:string, status:string, note?:string}} payload
 */
export async function updateApplicationStatus({ applicationId, status, note = '' }) {
  return mutate((db) => {
    const application = db.applications.find((item) => item.id === applicationId);
    if (!application) throw new Error('Application not found.');

    application.status = status;
    application.lastUpdated = today();
    if (note) application.recruiterNote = note;
    application.statusHistory.push({
      status,
      date: today(),
      note: note || `Status changed to ${status} by the recruiter.`,
    });

    // Notify the student about the status change.
    const drive = db.drives.find((item) => item.id === application.driveId);
    const company = drive ? db.companies.find((item) => item.id === drive.companyId) : null;
    db.notifications.unshift({
      id: createId('ntf'),
      studentId: application.studentId,
      type: status === 'Rejected' ? 'danger' : status === 'Selected' ? 'success' : 'info',
      title: `Application ${status}`,
      message: `${company ? company.name : 'The company'} updated your application${
        drive ? ` for ${drive.role}` : ''
      } to "${status}".`,
      date: today(),
      read: false,
    });

    return application;
  });
}
