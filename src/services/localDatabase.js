/**
 * services/localDatabase.js
 * ===========================================================================
 * THE "FAKE BACKEND" FOR THE DEMO
 * ===========================================================================
 *
 * When the Node + Express + MongoDB backend is ready, THIS FILE IS DELETED.
 * Right now it plays the role of the database: it keeps the collections in
 * `localStorage` (so a page refresh does not lose your demo applications) and
 * it fakes network latency so the loading states are real.
 *
 * Every service (authService, driveService, ...) talks to the database through
 * `query()` and `mutate()` below, which is exactly what `fetch()` will do later.
 */

import { students } from '../data/mockStudents';
import { companies } from '../data/mockCompanies';
import { drives } from '../data/mockDrives';
import { applications } from '../data/mockApplications';
import { notifications } from '../data/mockNotifications';

const STORAGE_KEY = 'placement-portal-db-v1';

/** Simulated REST latency in milliseconds. */
const NETWORK_DELAY = 320;

const wait = (ms = NETWORK_DELAY) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deep clone so the imported mock data is never mutated directly. */
const clone = (value) => JSON.parse(JSON.stringify(value));

/** The initial state of our demo database. */
function createSeedData() {
  return {
    students: clone(students),
    companies: clone(companies),
    drives: clone(drives),
    applications: clone(applications),
    notifications: clone(notifications),
  };
}

/** Read the database from localStorage, seeding it on the very first run. */
export function loadDatabase() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Guard against a half-written value.
      if (parsed && parsed.students && parsed.drives && parsed.applications) return parsed;
    }
  } catch {
    // localStorage can be unavailable (private mode). Fall back to mock data.
  }
  const seed = createSeedData();
  saveDatabase(seed);
  return seed;
}

/** Write the whole database back to localStorage. */
export function saveDatabase(database) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  } catch {
    // Ignore quota / privacy errors - the demo simply will not persist.
  }
}

/** Wipe the demo database and reload the original mock data. */
export function resetDatabase() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return loadDatabase();
}

/**
 * READ operation - looks like a GET request.
 * @example const allDrives = await query(db => db.drives);
 */
export async function query(reader, { delay = NETWORK_DELAY } = {}) {
  await wait(delay);
  const database = loadDatabase();
  return reader(database);
}

/**
 * WRITE operation - looks like a POST / PUT / PATCH request.
 * The callback may change the database object; whatever it returns is sent
 * back to the caller (just like a JSON response body).
 */
export async function mutate(writer, { delay = NETWORK_DELAY } = {}) {
  await wait(delay);
  const database = loadDatabase();
  const result = writer(database);
  saveDatabase(database);
  return result;
}

/** Simple unique id generator (MongoDB would generate ObjectIds instead). */
export function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Today's date as 'YYYY-MM-DD'. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}
