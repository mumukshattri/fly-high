/**
 * services/authService.js
 * ===========================================================================
 * AUTHENTICATION (real backend)
 * ===========================================================================
 *
 *   login()     ->  POST /api/auth/login    { email, password, role }
 *   register()  ->  POST /api/auth/register { ...profile, role }
 *   me()        ->  GET  /api/auth/me
 *   logout()    ->  POST /api/auth/logout
 *
 * Passwords are hashed with scrypt ON THE SERVER and never travel back to the
 * browser. The session itself is an HttpOnly cookie that JavaScript cannot
 * read, so there is no token to store - and nothing to leak.
 *
 * There are no demo accounts: the first administrator is created with
 * `npm run admin:create`, and everyone else registers normally.
 */

import { api, request } from './api';

/**
 * POST /api/auth/login -> { user, loggedInAt } (+ Set-Cookie)
 * `remember` is the "Keep me signed in" checkbox: false gives a browser-session
 * cookie that expires after 12 hours even if the browser is left open.
 */
export async function login({ email, password, role, remember = true }) {
  return api.post('/auth/login', { email, password, role, remember });
}

/** POST /api/auth/register -> { user, created } (+ Set-Cookie) */
export async function register(form) {
  return api.post('/auth/register', form);
}

/**
 * Restore the session after a page refresh.
 * Returns `{ user }` or null when the cookie is missing or expired.
 */
export async function fetchCurrentUser() {
  try {
    const { user } = await request('/auth/me');
    return user ? { user } : null;
  } catch (error) {
    // 401 simply means "not signed in". A network failure must still surface,
    // because "the API is down" and "you are logged out" are different things.
    if (error.status === 401) return null;
    throw error;
  }
}

/** POST /api/auth/logout - the server deletes the session, then clears the cookie. */
export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* the cookie is cleared by the response even if the call fails */
  }
  return { success: true };
}
