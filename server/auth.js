/**
 * server/auth.js
 * ===========================================================================
 * SESSIONS AND AUTHORISATION
 * ===========================================================================
 *
 * HOW LOGIN WORKS
 * ---------------
 * 1. The browser POSTs an email + password.
 * 2. The server compares them against a scrypt hash (server/password.js).
 * 3. On success it creates a random 32-byte token, stores only its SHA-256 hash
 *    in the `sessions` collection, and returns the raw token in an HttpOnly,
 *    SameSite=Lax cookie.
 *
 * WHY NOT localStorage
 * --------------------
 * A token in localStorage is readable by any script that runs on the page (one
 * bad dependency, one XSS bug). An HttpOnly cookie is not readable by
 * JavaScript at all, so script injection cannot steal a session.
 *
 * WHY NOT A STATELESS JWT
 * -----------------------
 * A JWT cannot be revoked before it expires. Because sessions live in MongoDB,
 * logging out really invalidates the session, and the account is re-read on
 * every request so a deleted account stops working immediately.
 *
 * CSRF: SameSite=Lax stops the cookie being sent on cross-site POSTs. As
 * defence in depth, server/app.js also rejects any write whose Origin does not
 * match the host (or the configured allow-list).
 */

import { createHash, randomBytes } from 'node:crypto';

import {
  IS_PRODUCTION,
  SESSION_COOKIE_NAME,
  SESSION_SHORT_TTL_MS,
  SESSION_TTL_MS,
} from './config.js';
import { Student, Company, Admin, Session } from './models/index.js';
import { serializeAccount } from './serialize.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import { forbidden, isObjectId, readCookie, unauthorized } from './http.js';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/* -------------------------------------------------------------------------- */
/* ACCOUNT LOOKUPS                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Find an account by email across all three collections.
 * Students and admins log in with `email`; a company uses its HR email.
 */
export async function findAccountByEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return null;

  const [student, company, admin] = await Promise.all([
    Student.findOne({ email: value }).select('+passwordHash').lean(),
    Company.findOne({ hrEmail: value }).select('+passwordHash').lean(),
    Admin.findOne({ email: value }).select('+passwordHash').lean(),
  ]);

  if (student) return { role: 'student', doc: student };
  if (company) return { role: 'company', doc: company };
  if (admin) return { role: 'admin', doc: admin };
  return null;
}

/** Load a serialised account by id + role. Returns null when it is gone. */
export async function loadAccount(id, role) {
  if (!isObjectId(String(id))) return null;

  if (role === 'student') {
    return serializeAccount(await Student.findById(id).lean(), 'student');
  }
  if (role === 'company') {
    return serializeAccount(await Company.findById(id).lean(), 'company');
  }
  if (role === 'admin') {
    return serializeAccount(await Admin.findById(id).lean(), 'admin');
  }
  return null;
}

/**
 * Check an email + password pair.
 *
 * One generic error covers "no such account", "wrong role" and "wrong
 * password", so an attacker cannot enumerate which emails exist. A dummy hash
 * comparison runs when nothing matched, to keep the timing similar.
 */
export async function authenticateCredentials({ email, password, role }) {
  const invalid = unauthorized('Invalid email or password for the selected role.');
  const account = await findAccountByEmail(email);

  if (!account) {
    await verifyPassword(String(password || ''), DUMMY_HASH);
    throw invalid;
  }
  if (role && account.role !== role) {
    await verifyPassword(String(password || ''), DUMMY_HASH);
    throw invalid;
  }

  const ok = await verifyPassword(String(password || ''), account.doc.passwordHash);
  if (!ok) throw invalid;

  const user = await loadAccount(String(account.doc._id), account.role);
  if (!user) throw invalid;
  return user;
}

/* -------------------------------------------------------------------------- */
/* SESSIONS                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Create a session row and return the raw token to place in the cookie.
 *
 * `remember` is the "Keep me signed in" checkbox: when it is false the server
 * row lives for 12 hours and the cookie is a browser-session cookie, so closing
 * the browser ends the session.
 */
export async function createSession(user, req, { remember = true } = {}) {
  const token = randomBytes(32).toString('base64url');
  const ttl = remember ? SESSION_TTL_MS : SESSION_SHORT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  await Session.create({
    tokenHash: hashToken(token),
    user: user.id,
    role: user.role,
    expiresAt,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 300),
  });

  return { token, expiresAt, persistent: remember };
}

/** Write the session cookie. HttpOnly + SameSite=Lax always; Secure in prod. */
export function setSessionCookie(res, { token, expiresAt, persistent = true }) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    // No `expires` makes it a browser-session cookie.
    ...(persistent ? { expires: expiresAt } : {}),
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
  });
}

/** Delete one session (logout). Succeeds silently when it is already gone. */
export async function destroySession(token) {
  if (!token) return;
  await Session.deleteOne({ tokenHash: hashToken(token) });
}

/**
 * Resolve the caller from the session cookie.
 * Returns null for a missing, unknown or expired session.
 */
export async function getRequestUser(req) {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  if (!token) return null;

  const session = await Session.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!session) return null;

  return loadAccount(String(session.user), session.role);
}

/** Express middleware: require a session, optionally limited to given roles. */
export function requireAuth(roles) {
  return async (req, res, next) => {
    try {
      const user = await getRequestUser(req);
      if (!user) throw unauthorized();
      if (roles && !roles.includes(user.role)) {
        throw forbidden('Your account does not have access to this resource.');
      }
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** The raw session token from the request (logout needs it). */
export function sessionTokenFromRequest(req) {
  return readCookie(req, SESSION_COOKIE_NAME);
}
