/**
 * server/http.js
 * ===========================================================================
 * HTTP PRIMITIVES (Express edition)
 * ===========================================================================
 * Error types, input sanitising and the small helpers every route needs.
 * Keeping them here means the routes read like business logic, not plumbing.
 */

/** An error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = 'You must sign in to continue.') =>
  new HttpError(401, message);
export const forbidden = (message = 'You are not allowed to perform this action.') =>
  new HttpError(403, message);
export const notFound = (message = 'Resource not found.') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
export const tooManyRequests = (message) => new HttpError(429, message);

/**
 * Wrap an async route handler so a rejected promise reaches Express's error
 * middleware (works on Express 4 and 5 alike).
 */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/** Read one cookie without pulling in cookie-parser. */
export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Collapse whitespace and trim; used for every single-line free-text field. */
export function cleanText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Trim but keep interior newlines (descriptions, "about" text). */
export function cleanMultiline(value, maxLength = 4000) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

/** Clean a list of short strings from an untrusted body. */
export function cleanList(value, { maxLength = 40, limit = 40 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** True for a 24-character hex string (a MongoDB ObjectId). */
export function isObjectId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

/** Today's date as `YYYY-MM-DD` (UTC). */
export function today() {
  return new Date().toISOString().slice(0, 10);
}
