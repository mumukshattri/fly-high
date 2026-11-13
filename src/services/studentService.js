/**
 * services/studentService.js
 * ===========================================================================
 * STUDENT PROFILE, RESUME, RECOMMENDATIONS + NOTIFICATIONS
 * ===========================================================================
 *
 *   getMyProfile()                 ->  GET    /api/students/me/profile
 *   updateMyProfile(updates)       ->  PATCH  /api/students/me/profile
 *   getProfileCompletion()         ->  GET    /api/students/me/profile-completion
 *
 *   uploadResumeFile(file)         ->  POST   /api/students/me/resume   (raw body)
 *   getMyResume()                  ->  GET    /api/students/me/resume
 *   deleteMyResume()               ->  DELETE /api/students/me/resume
 *   parseMyResume()                ->  POST   /api/students/me/resume/parse
 *   confirmResumeExtract(payload)  ->  PATCH  /api/students/me/resume/confirm
 *
 *   getRecommendations()           ->  GET    /api/student/recommendations
 *   getSkillGap()                  ->  GET    /api/student/recommendations/skills-gap
 *
 * The id arguments kept on `updateStudentProfile` / `uploadResume` exist only
 * for call-site compatibility: the server ignores them and uses the session, so
 * a student can never edit or upload for somebody else.
 *
 * The resume download is a plain link (`RESUME_DOWNLOAD_URL`) because the
 * private file is served with the same HttpOnly cookie; there is no token to
 * put in the URL.
 */

import { api, uploadFile } from './api';

export const RESUME_DOWNLOAD_URL = '/api/students/me/resume/file';

/* --------------------------------- profile -------------------------------- */

/** GET /api/students/me/profile -> { profile, completion } */
export async function getMyProfile() {
  return api.get('/students/me/profile');
}

/** PATCH /api/students/me/profile -> { profile, completion } */
export async function updateMyProfile(updates) {
  return api.patch('/students/me/profile', updates);
}

/** GET /api/students/me/profile-completion */
export async function getProfileCompletion() {
  return api.get('/students/me/profile-completion');
}

/** Backwards-compatible alias used by DataContext. */
export async function updateStudentProfile(studentId, updates) {
  return updateMyProfile(updates);
}

/* --------------------------------- resume --------------------------------- */

/** POST /api/students/me/resume - sends the real file. */
export async function uploadResumeFile(file) {
  return uploadFile('/students/me/resume', file);
}

/** Backwards-compatible alias. */
export async function uploadResume(studentId, file) {
  return uploadResumeFile(file);
}

/** GET /api/students/me/resume -> { resume, extraction } */
export async function getMyResume() {
  return api.get('/students/me/resume');
}

/** DELETE /api/students/me/resume */
export async function deleteMyResume() {
  return api.del('/students/me/resume');
}

/** POST /api/students/me/resume/parse - re-read the stored file. */
export async function parseMyResume() {
  return api.post('/students/me/resume/parse');
}

/**
 * PATCH /api/students/me/resume/confirm
 * @param {{skills?: string[], education?: object, projects?: object[],
 *          experiences?: object[], certifications?: object[], overwrite?: boolean}} payload
 */
export async function confirmResumeExtract(payload) {
  return api.patch('/students/me/resume/confirm', payload);
}

/* ------------------------------ recommendations --------------------------- */

function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** GET /api/student/recommendations */
export async function getRecommendations(params = {}) {
  return api.get(`/student/recommendations${queryString(params)}`);
}

/** GET /api/student/recommendations/skills-gap */
export async function getSkillGap() {
  return api.get('/student/recommendations/skills-gap');
}

/* ------------------------------- directory -------------------------------- */

/** GET /api/students - scoped: admin = all, company = applicants, student = self */
export async function getStudents() {
  return api.get('/students');
}

/** GET /api/students/:id */
export async function getStudentById(studentId) {
  return api.get(`/students/${encodeURIComponent(studentId)}`);
}

/* ------------------------------ notifications ----------------------------- */

/** GET /api/notifications - the session decides whose notifications these are. */
export async function getNotifications() {
  return api.get('/notifications');
}

/** PATCH /api/notifications/:id  { read: true } */
export async function markNotificationRead(notificationId) {
  return api.patch(`/notifications/${encodeURIComponent(notificationId)}`, { read: true });
}

/** PATCH /api/notifications  { readAll: true } */
export async function markAllNotificationsRead() {
  return api.patch('/notifications', { readAll: true });
}
