/**
 * services/adminService.js
 * ===========================================================================
 * PLACEMENT CELL (ADMIN) AGGREGATES
 * ===========================================================================
 *
 *   getAdminProfile()            ->  GET   /api/auth/me
 *   getStatistics()              ->  GET   /api/admin/statistics
 *   setCompanyVerification()     ->  PATCH /api/admin/companies/:id
 *
 *   getStudentDirectory(query)   ->  GET   /api/admin/students
 *   getStudentDetail(id)         ->  GET   /api/admin/students/:id
 *   previewImport(csv, mapping)  ->  POST  /api/admin/students/import/preview
 *   confirmImport(csv, mapping)  ->  POST  /api/admin/students/import/confirm
 *   studentExportUrl(query)      ->  GET   /api/admin/students/export (download)
 *   getStudentExport(query)      ->  same, as JSON for in-app use
 *
 * The statistics are computed ON THE SERVER from MongoDB, using the same pure
 * selector module the UI imports (`utils/selectors.js`), so the numbers can
 * never drift away from the rows they describe. Every endpoint rejects any
 * session that is not an administrator.
 */

import { api } from './api';

function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** GET /api/auth/me - the signed-in administrator. */
export async function getAdminProfile() {
  const { user } = await api.get('/auth/me');
  return user;
}

/** GET /api/admin/statistics */
export async function getStatistics() {
  return api.get('/admin/statistics');
}

/**
 * PATCH /api/admin/companies/:id  { verified: boolean }
 * A newly registered company cannot publish drives until the placement cell
 * approves it here.
 */
export async function setCompanyVerification(companyId, verified) {
  return api.patch(`/admin/companies/${encodeURIComponent(companyId)}`, { verified });
}

/** GET /api/admin/students?search=&department=&…&page=&pageSize= */
export async function getStudentDirectory(query = {}) {
  return api.get(`/admin/students${queryString(query)}`);
}

/** GET /api/admin/students/:id - profile, applications and invitation state. */
export async function getStudentDetail(studentId) {
  return api.get(`/admin/students/${encodeURIComponent(studentId)}`);
}

/**
 * POST /api/admin/students/import/preview
 * Without a mapping the server returns the detected columns and a suggestion;
 * with one it returns the validated rows. It never writes.
 */
export async function previewImport(csv, mapping) {
  return api.post('/admin/students/import/preview', mapping ? { csv, mapping } : { csv });
}

/** POST /api/admin/students/import/confirm */
export async function confirmImport(csv, mapping) {
  return api.post('/admin/students/import/confirm', { csv, mapping });
}

/** The download URL (a plain link keeps the cookie-based auth working). */
export function studentExportUrl(query = {}, format = 'csv') {
  return `/api/admin/students/export${queryString({ ...query, format })}`;
}

/** The JSON export, for previewing inside the app. */
export async function getStudentExport(query = {}) {
  return api.get(`/admin/students/export${queryString({ ...query, format: 'json' })}`);
}

/** Private resume download for an authorised administrator. */
export function studentResumeUrl(studentId) {
  return `/api/admin/students/${encodeURIComponent(studentId)}/resume/file`;
}
