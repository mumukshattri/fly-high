/**
 * server/password.js
 * ===========================================================================
 * PASSWORD HASHING
 * ===========================================================================
 *
 * Passwords are NEVER stored or compared in plain text. Each password gets a
 * random per-user salt and is stretched with scrypt - a deliberately slow,
 * memory-hard KDF built into Node's crypto module, so no dependency is needed.
 *
 * Stored format:  scrypt$<N>$<saltHex>$<hashHex>
 *   N is stored alongside the hash so the cost can be raised later without
 *   invalidating existing passwords.
 *
 * `verifyPassword` compares with `timingSafeEqual`, so an attacker cannot learn
 * the hash byte-by-byte from response timings.
 *
 * The async scrypt variant is used so hashing does not block the event loop
 * while another request is being served.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// 128 * N * r bytes, plus headroom for scrypt's internal buffers.
const MAX_MEMORY = 64 * 1024 * 1024;

/** Hash a plain-text password for storage. */
export async function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(String(plain), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  });
  return `scrypt$${SCRYPT_N}$${salt}$${derived.toString('hex')}`;
}

/** Constant-time comparison of a candidate password against a stored hash. */
export async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;

  const [scheme, nRaw, salt, expectedHex] = stored.split('$');
  if (scheme !== 'scrypt' || !nRaw || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length === 0) return false;

  let candidate;
  try {
    candidate = await scryptAsync(String(plain), salt, expected.length, {
      N: Number(nRaw),
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false;
  }

  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * A hash that can never match, used to keep the timing of "no such account"
 * similar to "wrong password".
 */
export const DUMMY_HASH = `scrypt$${SCRYPT_N}$${'0'.repeat(32)}$${'0'.repeat(128)}`;
