/**
 * server/external-jobs.js
 * ===========================================================================
 * EXTERNAL JOB DISCOVERY (Adzuna API)
 * ===========================================================================
 *
 * Students can search genuine vacancies published by employers that are NOT
 * registered on Job N Job. Those vacancies are never copied into MongoDB and
 * never become internal `Drive` documents - this module is a read-through
 * proxy in front of Adzuna with three jobs:
 *
 *   1. keep the credentials on the server (they are never sent to a browser,
 *      never logged and never echoed in an error message)
 *   2. normalize Adzuna's response into one stable shape the UI can render
 *   3. cache + throttle so a class of 60 students does not burn the API quota
 *
 * Adzuna's free tier is small (25 calls/minute, 250/day, 2,500/month), which is
 * exactly why the cache below is not optional.
 *
 * Anything the provider does not supply stays `null`. There is no fallback
 * company name, no invented salary and no placeholder description.
 *
 * Docs: https://developer.adzuna.com/docs/search
 */

import {
  ADZUNA_API_BASE,
  ADZUNA_APP_ID,
  ADZUNA_APP_KEY,
  ADZUNA_CACHE_TTL_MS,
  ADZUNA_COUNTRY,
  ADZUNA_TIMEOUT_MS,
} from './config.js';
import { HttpError, cleanText } from './http.js';

const API_BASE = ADZUNA_API_BASE;

/** Countries Adzuna serves (from their OpenAPI enum). `in` = India. */
export const SUPPORTED_COUNTRIES = [
  'at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es', 'fr', 'gb',
  'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'us', 'za',
];

/** The provider reports salaries in the local currency of the country. */
const CURRENCY_BY_COUNTRY = {
  at: 'EUR', au: 'AUD', be: 'EUR', br: 'BRL', ca: 'CAD', ch: 'CHF', de: 'EUR',
  es: 'EUR', fr: 'EUR', gb: 'GBP', in: 'INR', it: 'EUR', mx: 'MXN', nl: 'EUR',
  nz: 'NZD', pl: 'PLN', sg: 'SGD', us: 'USD', za: 'ZAR',
};

/** Public landing page used for the "Jobs by Adzuna" attribution link. */
const ATTRIBUTION_BY_COUNTRY = {
  in: 'https://www.adzuna.in',
  gb: 'https://www.adzuna.co.uk',
  us: 'https://www.adzuna.com',
  au: 'https://www.adzuna.com.au',
  ca: 'https://www.adzuna.ca',
  de: 'https://www.adzuna.de',
  fr: 'https://www.adzuna.fr',
  nl: 'https://www.adzuna.nl',
  sg: 'https://www.adzuna.sg',
};

export const COUNTRY = SUPPORTED_COUNTRIES.includes(ADZUNA_COUNTRY) ? ADZUNA_COUNTRY : 'in';

/* -------------------------------------------------------------------------- */
/* CONFIGURATION                                                              */
/* -------------------------------------------------------------------------- */

export const ADZUNA_MISSING_VARS = [
  ...(ADZUNA_APP_ID ? [] : ['ADZUNA_APP_ID']),
  ...(ADZUNA_APP_KEY ? [] : ['ADZUNA_APP_KEY']),
];

export const isConfigured = () => ADZUNA_MISSING_VARS.length === 0;

/**
 * The response shape the UI expects when credentials are absent. We do NOT
 * return fake listings - we say plainly what is missing.
 */
export function notConfiguredError() {
  return new HttpError(
    503,
    'External job search is not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to the server .env file and restart it.',
    { code: 'not_configured', missing: ADZUNA_MISSING_VARS },
  );
}

/* -------------------------------------------------------------------------- */
/* CACHE                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A tiny TTL cache. Two reasons it exists:
 *   - the free Adzuna key allows only a few hundred calls a day
 *   - a student typing in a search box must not fire a request per keystroke
 *
 * Because results are identical for every student, a shared cache leaks
 * nothing: it holds public vacancy data only.
 */
const CACHE_MAX_ENTRIES = 120;
const cache = new Map(); // key -> { expiresAt, value }

function cacheKey(parts) {
  return JSON.stringify(parts);
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the least-recently-used entry is evicted first.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function writeCache(key, value, ttlMs = ADZUNA_CACHE_TTL_MS) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

/** Exposed for tests and the health endpoint; never contains credentials. */
export function cacheSize() {
  return cache.size;
}

/* -------------------------------------------------------------------------- */
/* PER-USER THROTTLE                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The shared cache absorbs repeat searches, but a script could still request
 * thousands of distinct queries. This keeps one account from draining the
 * whole campus quota.
 */
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX_REQUESTS = 20;
const throttle = new Map(); // userId -> { count, resetAt }

export function checkUserThrottle(userId) {
  const now = Date.now();
  const entry = throttle.get(userId);

  if (!entry || entry.resetAt < now) {
    throttle.set(userId, { count: 1, resetAt: now + THROTTLE_WINDOW_MS });
    return;
  }

  if (entry.count >= THROTTLE_MAX_REQUESTS) {
    throw new HttpError(429, 'Too many job searches. Please wait a minute and try again.', {
      code: 'search_throttled',
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    });
  }

  entry.count += 1;
}

/* -------------------------------------------------------------------------- */
/* NORMALIZATION                                                              */
/* -------------------------------------------------------------------------- */

/** Adzuna wraps matched keywords in `**`; descriptions can contain markup. */
function plainText(value) {
  return String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function preview(value, maxLength = 260) {
  const text = plainText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[\s,;:.-]+$/, '')}...`;
}

/** Only http(s) links are accepted, so `javascript:` can never reach the UI. */
function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** "Full time - Permanent", built only from the parts Adzuna actually sent. */
function employmentType(raw) {
  const time = { full_time: 'Full time', part_time: 'Part time' }[raw?.contract_time] || null;
  const type = { permanent: 'Permanent', contract: 'Contract' }[raw?.contract_type] || null;
  const label = [time, type].filter(Boolean).join(' - ');
  return label || null;
}

/**
 * Turn one provider result into the shape used by the frontend.
 * Every field is either derived from the provider payload or `null`.
 */
export function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const title = plainText(raw.title);
  const url = safeUrl(raw.redirect_url);
  if (!title || !url) return null; // a vacancy nobody can open is not useful

  const min = number(raw.salary_min);
  const max = number(raw.salary_max) ?? min;

  const job = {
    id: raw.id != null ? String(raw.id) : url,
    title,
    company: plainText(raw.company?.display_name) || null,
    location: plainText(raw.location?.display_name) || null,
    description: preview(raw.description) || null,
    salary:
      min || max
        ? {
            min,
            max: max ?? min,
            currency: CURRENCY_BY_COUNTRY[COUNTRY] || null,
            // Adzuna flags modelled (not advertised) salaries with 1.
            isPredicted: Number(raw.salary_is_predicted) === 1,
          }
        : null,
    employmentType: employmentType(raw),
    category: plainText(raw.category?.label) || null,
    postedAt: isoDate(raw.created),
    url,
    source: 'Adzuna',
  };

  return job;
}

/** Public attribution block returned alongside every successful response. */
export function sourceInfo() {
  return {
    name: 'Adzuna',
    country: COUNTRY,
    attribution: 'Jobs by Adzuna',
    url: ATTRIBUTION_BY_COUNTRY[COUNTRY] || 'https://www.adzuna.com',
  };
}

/* -------------------------------------------------------------------------- */
/* PROVIDER CALL                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Map a provider failure onto an HttpError with a message a student can read.
 * The Adzuna key never appears in any of these strings.
 */
function providerError(status, body, timedOut) {
  if (timedOut) {
    return new HttpError(504, 'The external job provider did not respond in time. Try again.', {
      code: 'provider_timeout',
    });
  }

  if (status === 401) {
    console.warn('[external-jobs] Adzuna rejected the configured credentials.');
    return new HttpError(
      502,
      'The external job provider rejected our credentials. Check ADZUNA_APP_ID and ADZUNA_APP_KEY.',
      { code: 'provider_auth' },
    );
  }

  // 403 is what an app that is still pending activation (or is over its plan
  // allowance) receives, so do not blame the credentials for it.
  if (status === 403) {
    console.warn('[external-jobs] Adzuna refused the request (activation or plan quota).');
    return new HttpError(
      502,
      'The external job provider refused the request. The Adzuna application may still be pending activation or its plan allowance may be used up.',
      { code: 'provider_forbidden' },
    );
  }

  if (status === 429) {
    return new HttpError(429, 'The external job provider is rate limiting us. Try again shortly.', {
      code: 'provider_rate_limited',
    });
  }

  if (status === 400) {
    return new HttpError(502, 'The external job provider rejected the search filters.', {
      code: 'provider_bad_request',
      providerMessage: body?.display || null,
    });
  }

  return new HttpError(502, 'The external job provider is unavailable right now. Try again later.', {
    code: 'provider_error',
    providerStatus: status || null,
  });
}

/**
 * One GET against Adzuna, with a hard timeout.
 * @param {string} path - e.g. '/jobs/in/search/2'
 * @param {Record<string, string|number>} params
 */
async function callAdzuna(path, params) {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('app_id', ADZUNA_APP_ID);
  url.searchParams.set('app_key', ADZUNA_APP_KEY);
  url.searchParams.set('content-type', 'application/json');
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ADZUNA_TIMEOUT_MS),
    });
  } catch (error) {
    throw providerError(0, null, error?.name === 'TimeoutError' || error?.name === 'AbortError');
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) throw providerError(response.status, body, false);
  if (!body || typeof body !== 'object') {
    throw new HttpError(502, 'The external job provider returned an unexpected response.', {
      code: 'provider_bad_response',
    });
  }

  return body;
}

/* -------------------------------------------------------------------------- */
/* PUBLIC API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Search live vacancies.
 *
 * @param {{what?: string, where?: string, category?: string, page?: number,
 *          resultsPerPage?: number, maxDaysOld?: number, sortBy?: string}} query
 *   already validated and clamped by the route
 */
export async function searchExternalJobs(query) {
  if (!isConfigured()) throw notConfiguredError();

  const page = query.page || 1;
  const resultsPerPage = query.resultsPerPage || 20;

  const key = cacheKey(['search', COUNTRY, page, resultsPerPage, query.what, query.where, query.category, query.maxDaysOld, query.sortBy]);
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  const body = await callAdzuna(`/jobs/${COUNTRY}/search/${page}`, {
    results_per_page: resultsPerPage,
    what: query.what,
    where: query.where,
    category: query.category,
    max_days_old: query.maxDaysOld,
    sort_by: query.sortBy,
  });

  const jobs = Array.isArray(body.results)
    ? body.results.map(normalizeJob).filter(Boolean)
    : [];

  const total = Number.isFinite(Number(body.count)) ? Number(body.count) : null;

  const value = {
    configured: true,
    query: {
      what: query.what || null,
      where: query.where || null,
      category: query.category || null,
      page,
      resultsPerPage,
    },
    total,
    // Adzuna paginates through the path; we stop at 20 pages (quota guard).
    // An empty page also ends the list, even if `count` still claims more, so
    // the UI can never sit on a \"Load more\" button that returns nothing.
    hasMore:
      jobs.length > 0 &&
      page < 20 &&
      (total !== null ? page * resultsPerPage < total : jobs.length === resultsPerPage),
    jobs,
    source: sourceInfo(),
    fetchedAt: new Date().toISOString(),
  };

  writeCache(key, value);
  return { ...value, cached: false };
}

/**
 * Adzuna's own category list for the configured country, so the filter offers
 * what the provider really indexes instead of a list we invented.
 */
export async function fetchCategories() {
  if (!isConfigured()) throw notConfiguredError();

  const key = cacheKey(['categories', COUNTRY]);
  const cached = readCache(key);
  if (cached) return cached;

  const body = await callAdzuna(`/jobs/${COUNTRY}/categories`, {});
  const raw = Array.isArray(body) ? body : body.results;
  const categories = Array.isArray(raw)
    ? raw
        .map((item) => (typeof item === 'string' ? { tag: item, label: item } : item))
        .map((item) => ({ tag: String(item.tag || ''), label: plainText(item.label) || String(item.tag || '') }))
        .filter((item) => /^[a-z0-9-]{2,60}$/.test(item.tag))
    : [];

  const value = { configured: true, country: COUNTRY, categories, source: sourceInfo() };
  // Categories change a few times a year; a day of caching is plenty.
  writeCache(key, value, 1000 * 60 * 60 * 24);
  return value;
}
