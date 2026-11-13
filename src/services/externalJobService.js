import { api } from './api';

/**
 * services/externalJobService.js
 * ===========================================================================
 * EXTERNAL JOB DISCOVERY (Adzuna, proxied by our own Express server)
 * ===========================================================================
 * The browser NEVER talks to Adzuna and never sees the API key. It calls
 * /api/external-jobs, our backend calls Adzuna, normalizes the response and
 * returns plain JSON.
 *
 * Nothing in this file fabricates a vacancy: if the call fails, the error is
 * thrown and the page renders an honest error/config state.
 */

/** Turn the filter object into a query string, dropping empty values. */
function toQueryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Search live external vacancies.
 * @param {{what?: string, where?: string, category?: string, page?: number,
 *          resultsPerPage?: number, sortBy?: string}} filters
 * @returns {Promise<{jobs: object[], total: number|null, hasMore: boolean,
 *                    source: object, query: object, fetchedAt: string}>}
 */
export function searchExternalJobs(filters = {}) {
  return api.get(`/external-jobs${toQueryString(filters)}`);
}

/** The provider's category list for the configured country. */
export function getExternalJobCategories() {
  return api.get('/external-jobs/categories');
}

/** Is the server configured with Adzuna credentials? */
export function getExternalJobsStatus() {
  return api.get('/external-jobs/status');
}
