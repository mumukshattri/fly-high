/**
 * server/email/log.js
 * ===========================================================================
 * SAFE EMAIL LOGGING
 * ===========================================================================
 * Email failures can contain recipient addresses, provider responses and even
 * authentication material. Logs and stored error rows are operational data, so
 * they must never become a second copy of that sensitive data.
 */

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_PATTERN = /\b(?:re|whsec)_[A-Za-z0-9_-]{6,}\b/g;
const TOKEN_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const BLOCKED_KEYS = new Set([
  'html',
  'text',
  'payload',
  'body',
  'apiKey',
  'apikey',
  'authorization',
  'password',
  'passwordHash',
  'secret',
  'token',
  'cookie',
]);

/** Redact addresses, provider keys and bearer tokens from free text. */
export function sanitizeErrorText(value, maxLength = 300) {
  return String(value ?? '')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(SECRET_PATTERN, '[secret]')
    .replace(TOKEN_PATTERN, '[secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** A small, safe error shape. Never include response bodies or headers. */
export function safeError(error) {
  if (!error) return { name: 'error' };
  return {
    name: String(error.name || error.code || 'error').slice(0, 80),
    statusCode: Number(error.statusCode ?? error.status ?? 0) || null,
    code: error.code ? String(error.code).slice(0, 80) : undefined,
  };
}

function safeMeta(meta) {
  return Object.fromEntries(
    Object.entries(meta || {})
      .filter(([key]) => !BLOCKED_KEYS.has(key))
      .map(([key, value]) => {
        if (typeof value === 'string') return [key, sanitizeErrorText(value, 160)];
        if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [key, value];
        if (value && typeof value === 'object') {
          return [key, { name: value.name ? String(value.name).slice(0, 80) : undefined }];
        }
        return [key, String(value).slice(0, 80)];
      }),
  );
}

export function emailLog(message, meta = {}) {
  console.warn(`[email] ${message}`, safeMeta(meta));
}

export function emailError(message, meta = {}) {
  console.error(`[email] ${message}`, safeMeta(meta));
}
