/**
 * services/authService.js
 * ===========================================================================
 * AUTHENTICATION
 * ===========================================================================
 *
 * The functions here look exactly like the REST calls the Express backend will
 * provide later:
 *
 *    login()    ->  POST /api/auth/login    { email, password, role }
 *    register() ->  POST /api/auth/register { ...studentProfile }
 *    logout()   ->  POST /api/auth/logout
 *    getSession()->  GET  /api/auth/me
 *
 * Until then they validate against the mock database in `localDatabase.js` and
 * store a fake "token" in localStorage.
 *
 * NOTE: this is NOT real security. Passwords are compared in the browser and no
 * hashing happens. It is a frontend demo of the login flow.
 */

import { admin } from '../data/mockAdmin';
import { createId, loadDatabase, mutate, query, today } from './localDatabase';

const SESSION_KEY = 'placement-portal-session-v1';

/**
 * Demo logins shown on the login page so the evaluator can switch roles quickly.
 * A real backend obviously never publishes credentials.
 */
export const DEMO_CREDENTIALS = {
  student: { label: 'Student', email: 'aarav.sharma@student.edu', password: 'student123' },
  company: { label: 'Company', email: 'careers@technova.io', password: 'company123' },
  admin: { label: 'Admin', email: 'admin@college.edu', password: 'admin123' },
};

const makeToken = (role, id) => `mock-jwt.${role}.${id}.${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Session helpers (the "cookie")                                             */
/* -------------------------------------------------------------------------- */

export function getSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Login / Register / Logout                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {{email:string, password:string, role:'student'|'company'|'admin'}} credentials
 * @returns {Promise<{token:string, user:{id,role,name,email}}>}
 */
export async function login({ email, password, role }) {
  const enteredEmail = String(email || '').trim().toLowerCase();

  return query((db) => {
    if (role === 'student') {
      const student = db.students.find((item) => item.email.toLowerCase() === enteredEmail);
      if (!student || student.password !== password) {
        throw new Error('Invalid student email or password.');
      }
      return buildSession({ id: student.id, role: 'student', name: student.name, email: student.email });
    }

    if (role === 'company') {
      const company = db.companies.find((item) => item.hrEmail.toLowerCase() === enteredEmail);
      if (!company || password !== 'company123') {
        throw new Error('Invalid company email or password.');
      }
      return buildSession({
        id: company.id,
        role: 'company',
        name: company.name,
        email: company.hrEmail,
        // A real login response would return the logged-in company profile too.
        hrName: company.hrName,
        industry: company.industry,
        location: company.location,
        tier: company.tier,
      });
    }

    if (role === 'admin') {
      if (enteredEmail !== admin.email || password !== 'admin123') {
        throw new Error('Invalid administrator email or password.');
      }
      return buildSession({
        id: admin.id,
        role: 'admin',
        name: admin.name,
        email: admin.email,
        designation: admin.designation,
        department: admin.department,
        college: admin.college,
        phone: admin.phone,
      });
    }

    throw new Error('Please select a role to continue.');
  });
}

function buildSession(user) {
  const session = { token: makeToken(user.role, user.id), user, loggedInAt: new Date().toISOString() };
  saveSession(session);
  return session;
}

/** Reads the stored session (like GET /api/auth/me). */
export async function fetchCurrentUser() {
  const session = getSession();
  if (!session) return null;
  // Students may have edited their profile, so re-read the name from the DB.
  const database = loadDatabase();
  if (session.user.role === 'student') {
    const student = database.students.find((item) => item.id === session.user.id);
    if (student) session.user.name = student.name;
  }
  return session;
}

/**
 * Registers a new student (or a new company recruiter) and logs them in.
 * @param {object} form - fields from the Register page
 */
export async function register(form) {
  const email = String(form.email || '').trim().toLowerCase();

  const session = await mutate((db) => {
    const exists =
      db.students.some((item) => item.email.toLowerCase() === email) ||
      db.companies.some((item) => item.hrEmail.toLowerCase() === email);
    if (exists) throw new Error('An account with this email already exists.');

    if (form.role === 'company') {
      const company = {
        id: createId('cmp'),
        name: form.name,
        industry: form.industry || 'Not specified',
        location: form.location || 'Not specified',
        website: form.website || '',
        size: 'Not specified',
        tier: 'Standard',
        hrName: form.contactPerson || form.name,
        hrEmail: email,
        hrPhone: form.phone || '',
        about: '',
        verified: false,
        registeredOn: today(),
      };
      db.companies.push(company);
      return buildSession({ id: company.id, role: 'company', name: company.name, email: company.hrEmail });
    }

    const student = {
      id: createId('stu'),
      name: form.name,
      email,
      password: form.password,
      rollNumber: form.rollNumber || '',
      phone: form.phone || '',
      university: form.university || '',
      branch: form.branch || 'CSE',
      semester: Number(form.semester) || 1,
      cgpa: Number(form.cgpa) || 0,
      graduationYear: Number(form.graduationYear) || new Date().getFullYear() + 1,
      skills: [],
      about: '',
      resume: null,
      placementStatus: 'Active',
      registeredOn: today(),
    };
    db.students.push(student);
    // Welcome notification so the notifications page is not empty.
    db.notifications.push({
      id: createId('ntf'),
      studentId: student.id,
      type: 'info',
      title: 'Welcome to the Placement Portal',
      message: 'Complete your profile and upload your resume to become eligible for drives.',
      date: today(),
      read: false,
    });
    return buildSession({ id: student.id, role: 'student', name: student.name, email: student.email });
  });

  return session;
}

/** Logout simply drops the stored session. */
export async function logout() {
  clearSession();
  return { success: true };
}
