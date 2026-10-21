/**
 * services/driveService.js
 * ===========================================================================
 * RECRUITMENT DRIVES  (job postings created by companies)
 * ===========================================================================
 *
 *   getDrives()            ->  GET    /api/drives
 *   getDriveById(id)       ->  GET    /api/drives/:id
 *   getDrivesByCompany(id) ->  GET    /api/companies/:id/drives
 *   createDrive(payload)   ->  POST   /api/drives
 *   updateDrive(id, data)  ->  PATCH  /api/drives/:id
 *   closeDrive(id)         ->  PATCH  /api/drives/:id  { status: 'Closed' }
 *
 * Swapping to the real API = replace the body of each function with a fetch and
 * keep the same return shape. No React component has to change.
 */

import { checkEligibility } from '../utils/eligibility';
import { createId, mutate, query, today } from './localDatabase';

/** GET /api/drives */
export async function getDrives() {
  return query((db) => db.drives);
}

/** GET /api/drives/:id */
export async function getDriveById(driveId) {
  return query((db) => db.drives.find((drive) => drive.id === driveId) || null);
}

/** GET /api/companies  (kept here because drives always render with their company) */
export async function getCompanies() {
  return query((db) => db.companies);
}

/** GET /api/companies/:id/drives */
export async function getDrivesByCompany(companyId) {
  return query((db) => db.drives.filter((drive) => drive.companyId === companyId));
}

/**
 * Drives a student is allowed to apply for, each annotated with its eligibility
 * result. The real backend equivalent is
 *   GET /api/students/:id/eligible-drives
 */
export async function getDrivesForStudent(student) {
  const allDrives = await getDrives();
  if (!student) return allDrives.map((drive) => ({ ...drive, eligibility: null }));
  return allDrives.map((drive) => ({ ...drive, eligibility: checkEligibility(student, drive) }));
}

/** POST /api/drives  (used by the company dashboard) */
export async function createDrive(payload) {
  return mutate((db) => {
    const company = db.companies.find((item) => item.id === payload.companyId);
    if (!company) throw new Error('Company not found. Please log in again.');

    const drive = {
      id: createId('drv'),
      companyId: payload.companyId,
      role: payload.role,
      jobType: payload.jobType || 'Full Time',
      location: payload.location || company.location,
      package: payload.package || 'Not disclosed',
      stipend: payload.stipend || null,
      openings: Number(payload.openings) || 1,
      minimumCGPA: Number(payload.minimumCGPA) || 0,
      branches: payload.branches || [],
      requiredSkills: payload.requiredSkills || [],
      skillMatchMode: payload.skillMatchMode || 'any',
      deadline: payload.deadline,
      driveDate: payload.driveDate || payload.deadline,
      postedOn: today(),
      status: 'Open',
      tier: payload.tier || 'Standard',
      description: payload.description || '',
      responsibilities: payload.responsibilities || [],
      selectionProcess: payload.selectionProcess || [],
    };

    db.drives.unshift(drive); // newest first
    return drive;
  });
}

/** PATCH /api/drives/:id */
export async function updateDrive(driveId, updates) {
  return mutate((db) => {
    const drive = db.drives.find((item) => item.id === driveId);
    if (!drive) throw new Error('Drive not found.');
    Object.assign(drive, updates);
    return drive;
  });
}

/** PATCH /api/drives/:id { status: 'Closed' } */
export async function closeDrive(driveId) {
  return updateDrive(driveId, { status: 'Closed' });
}
