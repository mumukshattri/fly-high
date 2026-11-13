/**
 * server/config.js
 * ===========================================================================
 * CONFIGURATION
 * ===========================================================================
 *
 * Everything that varies between machines lives here and comes from the
 * environment (or from a git-ignored `.env` file):
 *
 *   MONGODB_URI     the database - REQUIRED, there is no fallback on purpose
 *   PORT            API port (default 5000)
 *   HOST            bind address (default 127.0.0.1)
 *   NODE_ENV        'production' enables Secure cookies + HSTS
 *   APP_ORIGIN      extra browser origins allowed to call the API
 *   ADZUNA_*        external job search (optional; the feature says so if unset)
 *
 * `.env` is read with Node's built-in loader (Node 22 LTS / 24 LTS), so the
 * project does not need the `dotenv` package.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_FILE = process.env.ENV_FILE || path.join(ROOT_DIR, '.env');

if (existsSync(ENV_FILE)) {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch (error) {
      console.warn(`[config] could not read ${ENV_FILE}: ${error.message}`);
    }
  } else {
    console.warn(
      `[config] Node ${process.version} cannot load ${ENV_FILE} automatically. ` +
        'Export the variables in your shell instead (Node 22 LTS or newer is required).',
    );
  }
}

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

export const PORT = Number(process.env.PORT) || 5000;
export const HOST = process.env.HOST || '127.0.0.1';

/** No default: an unset URI must fail loudly rather than silently fall back. */
export const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();

/* --------------------------------- sessions -------------------------------- */

export const SESSION_COOKIE_NAME = 'jnj_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days, "Keep me signed in"
// Without "Keep me signed in" the cookie is a browser-session cookie and the
// row on the server still expires, so closing the browser signs the user out.
export const SESSION_SHORT_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

/* -------------------------- external job search --------------------------- */

/**
 * Adzuna powers "Discover External Opportunities". Both values are SECRET:
 * they are read here, used by server/external-jobs.js and never sent to a
 * browser. When either is missing the endpoint answers 503 with the names of
 * the missing variables instead of inventing listings.
 */
export const ADZUNA_APP_ID = String(process.env.ADZUNA_APP_ID || '').trim();
export const ADZUNA_APP_KEY = String(process.env.ADZUNA_APP_KEY || '').trim();
/** Country edition: 'in' for India (the default). */
export const ADZUNA_COUNTRY = String(process.env.ADZUNA_COUNTRY || 'in').trim().toLowerCase();
/** Hard timeout for one provider call; a slow API must not hang the page. */
export const ADZUNA_TIMEOUT_MS = Number(process.env.ADZUNA_TIMEOUT_MS) || 8000;
/** Provider base URL; only changed for testing against a local stub. */
export const ADZUNA_API_BASE = String(
  process.env.ADZUNA_API_BASE || 'https://api.adzuna.com/v1/api',
).replace(/\/+$/, '');
/** How long a search response is reused (the free tier is ~250 calls a day). */
export const ADZUNA_CACHE_TTL_MS = Number(process.env.ADZUNA_CACHE_TTL_MS) || 1000 * 60 * 10;

/* --------------------------- resume storage ------------------------------- */

/**
 * Private storage for uploaded resumes. Deliberately outside `dist/`, so no
 * static middleware can ever serve a student's CV to the internet. Override
 * with RESUME_STORAGE_DIR when moving to a mounted volume.
 */
export const RESUME_STORAGE_DIR = process.env.RESUME_STORAGE_DIR
  ? path.resolve(process.env.RESUME_STORAGE_DIR)
  : path.join(ROOT_DIR, 'storage', 'resumes');

/** Maximum accepted resume size in bytes (default 5 MB). */
export const RESUME_MAX_BYTES = Number(process.env.RESUME_MAX_BYTES) || 5 * 1024 * 1024;

/* ----------------------------- job matching ------------------------------- */

/** Factor weights must add up to 1; the engine normalises over what it knows. */
export const DEFAULT_MATCH_WEIGHTS = {
  skills: 0.4,
  education: 0.2,
  experience: 0.15,
  location: 0.1,
  role: 0.1,
  employment: 0.05,
};

export const DEFAULT_MATCH_THRESHOLDS = { excellent: 80, strong: 65, moderate: 50 };

function parseNumberMap(raw, fallback, { minimum = 0, maximum = 100 } = {}) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    const result = { ...fallback };
    let seen = 0;
    for (const key of Object.keys(fallback)) {
      const value = Number(parsed[key]);
      if (Number.isFinite(value) && value >= minimum && value <= maximum) {
        result[key] = value;
        seen += 1;
      }
    }
    if (seen === 0) throw new Error('no usable values');
    return result;
  } catch (error) {
    console.warn(`[config] ignoring invalid MATCH_* setting: ${error.message}`);
    return fallback;
  }
}

/** Configurable (and documented in .env.example) matching weights. */
export const MATCH_WEIGHTS = parseNumberMap(process.env.MATCH_WEIGHTS, DEFAULT_MATCH_WEIGHTS, {
  minimum: 0,
  maximum: 1,
});

/** Score thresholds for the Excellent / Strong / Moderate labels. */
export const MATCH_THRESHOLDS = parseNumberMap(process.env.MATCH_THRESHOLDS, DEFAULT_MATCH_THRESHOLDS);

/** How long a CSV-import activation link is valid. */
export const INVITE_TTL_MS = Number(process.env.INVITE_TTL_MS) || 1000 * 60 * 60 * 24 * 7;

/* ---------------------------------- CORS ---------------------------------- */

/**
 * Normalise one origin into the exact form a browser puts in its `Origin`
 * header: lower-case scheme and host, no trailing slash, port only when it is
 * not the scheme default. This is what makes `APP_ORIGIN=https://jobs.example.com/`
 * (with a stray slash) match instead of silently rejecting every write.
 */
function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
].map(normalizeOrigin);

/** APP_ORIGIN accepts one origin or a comma-separated list (several deploys). */
const EXTRA_ORIGINS = String(process.env.APP_ORIGIN || '')
  .split(',')
  .map((value) => {
    const raw = value.trim();
    if (!raw) return '';
    const normalized = normalizeOrigin(raw);
    if (!normalized) {
      console.warn(`[config] ignoring APP_ORIGIN entry "${raw}": not a valid http(s) origin.`);
    }
    return normalized;
  })
  .filter(Boolean);

/** Every origin explicitly allowed, in normalised form. */
export const ALLOWED_ORIGINS = new Set([...DEV_ORIGINS, ...EXTRA_ORIGINS]);

/** Loopback hosts, in every spelling a browser may use. */
export function isLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

/**
 * May this browser origin make a state-changing request?
 *
 * Production: only an explicitly configured origin (APP_ORIGIN) or the exact
 * origin the request was addressed to (see sameSiteGuard). Development: any
 * loopback origin, because the Vite dev server legitimately moves ports when
 * 5173 is taken and answers as localhost, 127.0.0.1 or [::1]. No non-loopback
 * origin is ever exempted, and nothing here relaxes the production rules.
 */
export function isAllowedOrigin(origin) {
  const normalized = normalizeOrigin(String(origin || '').trim());
  if (!normalized) return false;
  if (ALLOWED_ORIGINS.has(normalized)) return true;
  return !IS_PRODUCTION && isLocalOrigin(normalized);
}

/**
 * Throws a message a human can act on when the database is not configured.
 * Called by the connection module, never at import time, so tests can inject
 * their own URI.
 */
export function requireMongoUri() {
  if (MONGODB_URI) return MONGODB_URI;
  throw new Error(
    [
      '',
      '  MONGODB_URI is not set, so Job N Job cannot reach MongoDB.',
      '',
      '  Create a .env file in the project root (copy .env.example) with:',
      '      MONGODB_URI=mongodb://127.0.0.1:27017/jobnjob',
      '',
      '  The server never falls back to SQLite, localStorage or in-memory data.',
      '',
    ].join('\n'),
  );
}
