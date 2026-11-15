/**
 * server/email/service.js
 * ===========================================================================
 * RESEND PROVIDER BOUNDARY
 * ===========================================================================
 * This is the only module that talks to Resend. It never exposes the API key,
 * never logs message bodies, and always returns a structured result.
 */

import { Resend } from 'resend';

import { isEmail } from '../http.js';
import { sanitizeErrorText } from './log.js';
import {
  EMAIL_MODE,
  EMAIL_TEST_RECIPIENT,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  RESEND_REPLY_TO,
  emailIsReady,
} from './config.js';

let client = null;
let testTransport = null;

/** Test seam: no network call and no Resend quota is used by the test suite. */
export function setEmailTransportForTests(transport) {
  testTransport = typeof transport === 'function' ? transport : null;
}

export function resetEmailTransportForTests() {
  testTransport = null;
}

function getClient() {
  if (!RESEND_API_KEY) return null;
  if (!client) client = new Resend(RESEND_API_KEY);
  return client;
}

/** Small, safe error shape. Never include response bodies or headers. */
export function normaliseProviderError(error) {
  const statusCode = Number(error?.statusCode ?? error?.status ?? 0) || null;
  const code = String(error?.name || error?.code || 'resend_error').slice(0, 80);
  const message = sanitizeErrorText(error?.message || 'Email provider request failed.', 300);
  return {
    code,
    statusCode,
    message,
    retryable: isRetryable({ code, statusCode }),
  };
}

export function isRetryable(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  if (error.retryable === false) return false;
  const status = Number(error.statusCode || 0);
  if (!status) return true; // network / DNS / timeout
  if ([408, 425, 429].includes(status)) return true;
  if (status >= 500) return true;
  return false;
}

function recipientFor(email) {
  if (EMAIL_MODE === 'test') return EMAIL_TEST_RECIPIENT;
  return email;
}

/**
 * Send one already-rendered message.
 *
 * @returns {Promise<{ok:boolean, messageId?:string, providerStatus?:string, error?:object, skipped?:string}>}
 */
export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!emailIsReady()) {
    return {
      ok: false,
      skipped: 'not_configured',
      error: { code: 'not_configured', statusCode: null, message: 'Email is not enabled or configured.', retryable: false },
    };
  }

  const recipient = recipientFor(String(to || '').trim().toLowerCase());
  if (!isEmail(recipient)) {
    return {
      ok: false,
      error: { code: 'invalid_recipient', statusCode: 422, message: 'The recipient address is invalid.', retryable: false },
    };
  }

  if (!isEmail(RESEND_FROM_EMAIL.match(/<([^>]+)>/)?.[1] || RESEND_FROM_EMAIL)) {
    return {
      ok: false,
      error: { code: 'invalid_from_address', statusCode: 422, message: 'The configured sender address is invalid.', retryable: false },
    };
  }

  if (typeof testTransport === 'function') {
    try {
      const result = await testTransport({
        from: RESEND_FROM_EMAIL,
        to: recipient,
        subject,
        html,
        text,
        idempotencyKey,
      });
      if (result?.error) {
        return { ok: false, error: normaliseProviderError(result.error) };
      }
      return {
        ok: true,
        messageId: String(result?.id || result?.messageId || 'test-message'),
        providerStatus: 'accepted',
      };
    } catch (error) {
      return { ok: false, error: normaliseProviderError(error) };
    }
  }

  const resend = getClient();
  if (!resend) {
    return {
      ok: false,
      error: { code: 'missing_api_key', statusCode: null, message: 'RESEND_API_KEY is not set.', retryable: false },
    };
  }

  let result;
  let timeout;
  try {
    result = await Promise.race([
      resend.emails.send(
        {
          from: RESEND_FROM_EMAIL,
          to: [recipient],
          subject,
          html,
          text,
          ...(RESEND_REPLY_TO ? { replyTo: RESEND_REPLY_TO } : {}),
        },
        { idempotencyKey },
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Object.assign(new Error('Resend request timed out.'), { name: 'timeout' })),
          10_000,
        );
      }),
    ]);
  } catch (error) {
    return { ok: false, error: normaliseProviderError(error) };
  } finally {
    clearTimeout(timeout);
  }

  if (result?.error) {
    return { ok: false, error: normaliseProviderError(result.error) };
  }

  if (!result?.data?.id) {
    return {
      ok: false,
      error: { code: 'missing_message_id', statusCode: null, message: 'Resend accepted no message ID.', retryable: true },
    };
  }

  return { ok: true, messageId: String(result.data.id), providerStatus: 'accepted' };
}

export function providerFromAddress() {
  return RESEND_FROM_EMAIL;
}
