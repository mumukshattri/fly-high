/**
 * services/applicationService.js
 * ===========================================================================
 * APPLICATIONS (the student -> drive link that companies then review)
 * ===========================================================================
 *
 *   getApplications()            ->  GET   /api/applications
 *   getApplicationById(id)       ->  GET   /api/applications/:id
 *   getApplicationsByStudent(id) ->  GET   /api/applications?studentId=...
 *   getApplicationsByDrive(id)   ->  GET   /api/applications?driveId=...
 *   applyToDrive(payload)        ->  POST  /api/applications
 *   updateStatus(payload)        ->  PATCH /api/applications/:id
 *
 * The server decides which rows the caller may see from the session, so the
 * filters below are a convenience for the UI - they can never widen access.
 */

import { api } from './api';

const toQuery = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

/** GET /api/applications */
export async function getApplications({ studentId, driveId, status } = {}) {
  return api.get(`/applications${toQuery({ studentId, driveId, status })}`);
}

/** GET /api/applications/:id */
export async function getApplicationById(applicationId) {
  return api.get(`/applications/${encodeURIComponent(applicationId)}`);
}

/** GET /api/applications?studentId= */
export async function getApplicationsByStudent(studentId) {
  return getApplications({ studentId });
}

/** GET /api/applications?driveId= */
export async function getApplicationsByDrive(driveId) {
  return getApplications({ driveId });
}

/** Used to disable the Apply button on the drives page. */
export async function hasApplied(studentId, driveId) {
  const rows = await getApplications({ studentId, driveId });
  return rows.some((row) => row.studentId === studentId && row.driveId === driveId);
}

/**
 * POST /api/applications
 * The server re-runs the eligibility rules and the duplicate check, then
 * creates the student's notification.
 */
export async function applyToDrive({ driveId }) {
  return api.post('/applications', { driveId });
}

/**
 * PATCH /api/applications/:id
 * Only the company that owns the drive (or an admin) may move a candidate.
 */
export async function updateApplicationStatus({ applicationId, status, note = '' }) {
  return api.patch(`/applications/${encodeURIComponent(applicationId)}`, { status, note });
}
