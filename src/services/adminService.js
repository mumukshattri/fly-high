/**
 * services/adminService.js
 * ===========================================================================
 * PLACEMENT CELL (ADMIN) AGGREGATES
 * ===========================================================================
 *
 *   getAdminProfile()  ->  GET /api/admin/profile
 *   getStatistics()    ->  GET /api/admin/statistics
 *
 * The maths itself lives in ONE place: `utils/selectors.getPlacementStatistics()`,
 * which is a pure function. This service is only the API seam around it.
 *
 * Why that matters: the admin pages compute their numbers with the same
 * function, so the aggregates can never disagree with the tables, and when the
 * Express backend is ready you only replace the body of `getStatistics()` with
 * a fetch - the shape of the object stays the same.
 *
 * On MongoDB the same numbers come from aggregation pipelines, for example:
 *
 *   db.applications.aggregate([
 *     { $match: { status: 'Selected' } },
 *     { $lookup: { from: 'students', localField: 'studentId',
 *                  foreignField: '_id', as: 'student' } },
 *     { $group: { _id: '$student.branch', placed: { $sum: 1 } } }
 *   ])
 */

import { admin } from '../data/mockAdmin';
import { getPlacementStatistics } from '../utils/selectors';
import { query } from './localDatabase';

/** GET /api/admin/profile */
export async function getAdminProfile() {
  return admin;
}

/** GET /api/admin/statistics */
export async function getStatistics() {
  return query((database) => getPlacementStatistics(database));
}
