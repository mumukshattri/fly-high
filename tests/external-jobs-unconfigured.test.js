/**
 * tests/external-jobs-unconfigured.test.js
 * ===========================================================================
 * Adzuna integration - missing configuration
 * ===========================================================================
 * `node --test` gives every file its own process, so this one can run with the
 * credentials removed before server/config.js is imported. That makes the
 * unconfigured behaviour testable even on a machine whose .env holds real keys.
 *
 * The rule under test: without keys we say exactly what is missing and return
 * no listings at all - no samples, no cached fixtures, no "demo" vacancies.
 */

import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// Point the config loader at an .env that deliberately does not exist, so a
// developer machine's real credentials cannot leak into this test process.
process.env.ENV_FILE = './.env.absent-for-tests';
delete process.env.ADZUNA_APP_ID;
delete process.env.ADZUNA_APP_KEY;
process.env.ADZUNA_COUNTRY = 'in';

const {
  ADZUNA_MISSING_VARS,
  isConfigured,
  notConfiguredError,
  searchExternalJobs,
  fetchCategories,
  sourceInfo,
} = await import('../server/external-jobs.js');

describe('external jobs without credentials', () => {
  test('reports both variables as missing and never as configured', () => {
    assert.equal(isConfigured(), false);
    assert.deepEqual(ADZUNA_MISSING_VARS, ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
  });

  test('the error explains what to add, returns 503 and carries no listings', () => {
    const error = notConfiguredError();

    assert.equal(error.status, 503);
    assert.equal(error.details.code, 'not_configured');
    assert.deepEqual(error.details.missing, ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
    assert.match(error.message, /ADZUNA_APP_ID/);
    assert.match(error.message, /ADZUNA_APP_KEY/);
    assert.equal('jobs' in error.details, false, 'no fabricated results, ever');
  });

  test('search and categories refuse to call the provider at all', async (t) => {
    const fetchSpy = t.mock.method(globalThis, 'fetch', () => {
      throw new Error('the provider must not be contacted without credentials');
    });

    await assert.rejects(() => searchExternalJobs({ what: 'developer' }), /not configured/i);
    await assert.rejects(() => fetchCategories(), /not configured/i);
    assert.equal(fetchSpy.mock.callCount(), 0, 'zero provider calls, zero quota spent');
  });

  test('attribution still names the provider so the UI copy stays accurate', () => {
    assert.equal(sourceInfo().name, 'Adzuna');
    assert.equal(sourceInfo().country, 'in');
  });
});
