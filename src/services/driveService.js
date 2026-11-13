/**
 * services/driveService.js
 * ===========================================================================
 * RECRUITMENT DRIVES (job postings created by companies)
 * ===========================================================================
 *
 *   getDrives()            ->  GET    /api/drives
 *   getDriveById(id)       ->  GET    /api/drives/:id
 *   getCompanies()         ->  GET    /api/companies
 *   getDrivesByCompany(id) ->  GET    /api/companies/:id/drives
 *   createDrive(payload)   ->  POST   /api/drives
 *   updateDrive(id, data)  ->  PATCH  /api/drives/:id
 *   closeDrive(id)         ->  PATCH  /api/drives/:id  { status: 'Closed' }
 *
 * The server takes `companyId` from the session, so a recruiter can only ever
 * publish a drive under their own company.
 */

import { checkEligibility } from '../utils/eligibility.js';
import { api } from './api';

/** GET /api/drives */
export async function getDrives() {
  return api.get('/drives');
}

/** GET /api/drives/:id */
export async function getDriveById(driveId) {
  return api.get(`/drives/${encodeURIComponent(driveId)}`);
}

/** GET /api/companies */
export async function getCompanies() {
  return api.get('/companies');
}

/** GET /api/companies/:id/drives */
export async function getDrivesByCompany(companyId) {
  return api.get(`/companies/${encodeURIComponent(companyId)}/drives`);
}

/**
 * Drives annotated with their eligibility result for one student.
 * The decision comes from the same pure function the server uses, so the badge
 * in the UI and the server-side check can never disagree.
 */
export async function getDrivesForStudent(student) {
  const allDrives = await getDrives();
  if (!student) return allDrives.map((drive) => ({ ...drive, eligibility: null }));
  return allDrives.map((drive) => ({ ...drive, eligibility: checkEligibility(student, drive) }));
}

/** POST /api/drives */
export async function createDrive(payload) {
  return api.post('/drives', payload);
}

/** PATCH /api/drives/:id */
export async function updateDrive(driveId, updates) {
  return api.patch(`/drives/${encodeURIComponent(driveId)}`, updates);
}

/** PATCH /api/drives/:id { status: 'Closed' } */
export async function closeDrive(driveId) {
  return api.patch(`/drives/${encodeURIComponent(driveId)}`, { status: 'Closed' });
}
