/**
 * tests/external-jobs.test.js
 * ===========================================================================
 * Adzuna integration - service level
 * ===========================================================================
 * This file runs in its OWN process (node --test isolates files), so it can set
 * fake credentials before server/config.js is imported. `fetch` is replaced
 * with a recorder, which lets us assert exactly what we would have sent to
 * api.adzuna.com and how we map its responses back - without spending a single
 * call of the real quota and without putting fixture data anywhere near the app.
 *
 * The payloads below are the documented Adzuna shape (see
 * https://developer.adzuna.com/docs/search), trimmed to a couple of fields.
 */

import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADZUNA_APP_ID = 'test-app-id';
process.env.ADZUNA_APP_KEY = 'test-app-key';
process.env.ADZUNA_COUNTRY = 'in';

const {
  searchExternalJobs,
  fetchCategories,
  normalizeJob,
  isConfigured,
  sourceInfo,
} = await import('../server/external-jobs.js');

const realFetch = globalThis.fetch;

/** Replace global fetch with a recorder that returns `body` with `status`. */
function stubFetch({ status = 200, body = {}, onCall } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    onCall?.(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A response shaped exactly like Adzuna's JobSearchResults. */
const ADZUNA_BODY = {
  count: 137,
  mean: 1200000,
  results: [
    {
      id: '4001234567',
      title: '**Java** Developer',
      created: '2026-11-04T08:30:00Z',
      description: '**Java** developer with <b>Spring Boot</b> experience. Salary negotiable.',
      redirect_url: 'https://www.adzuna.in/land/ad/4001234567?se=abc',
      company: { display_name: 'Nimbus Analytics' },
      location: { display_name: 'Pune, Maharashtra', area: ['India', 'Maharashtra', 'Pune'] },
      category: { label: 'IT Jobs', tag: 'it-jobs' },
      salary_min: 900000,
      salary_max: 1500000,
      salary_is_predicted: '0',
      contract_time: 'full_time',
      contract_type: 'permanent',
    },
    {
      id: '4009999999',
      title: 'Data Analyst',
      created: '2026-11-01T10:00:00Z',
      description: 'SQL and dashboards.',
      redirect_url: 'https://www.adzuna.in/land/ad/4009999999',
      // no company, no salary, no contract type
    },
    {
      id: 'broken',
      title: 'Unsafe link',
      redirect_url: 'javascript:alert(1)',
    },
  ],
};

describe('normalizeJob', () => {
  test('keeps only provider data and strips highlighting markup', () => {
    const job = normalizeJob(ADZUNA_BODY.results[0]);

    assert.equal(job.title, 'Java Developer');
    assert.equal(job.company, 'Nimbus Analytics');
    assert.equal(job.location, 'Pune, Maharashtra');
    assert.equal(job.category, 'IT Jobs');
    assert.equal(job.employmentType, 'Full time - Permanent');
    assert.equal(job.postedAt, '2026-11-04T08:30:00.000Z');
    assert.equal(job.source, 'Adzuna');
    assert.match(job.description, /Spring Boot/);
    assert.doesNotMatch(job.description, /\*\*|<b>/);
    assert.deepEqual(job.salary, {
      min: 900000,
      max: 1500000,
      currency: 'INR',
      isPredicted: false,
    });
  });

  test('missing fields stay null instead of being invented', () => {
    const job = normalizeJob(ADZUNA_BODY.results[1]);

    assert.equal(job.company, null);
    assert.equal(job.salary, null);
    assert.equal(job.employmentType, null);
    assert.equal(job.category, null);
    assert.equal(job.location, null);
    assert.ok(job.url.startsWith('https://www.adzuna.in/'));
  });

  test('a listing with a non-http link is dropped entirely', () => {
    assert.equal(normalizeJob(ADZUNA_BODY.results[2]), null);
  });
});

describe('searchExternalJobs', () => {
  test('calls the India search endpoint with validated parameters', async () => {
    const calls = stubFetch({ body: ADZUNA_BODY });

    await searchExternalJobs({
      what: 'java developer',
      where: 'pune',
      category: 'it-jobs',
      page: 2,
      resultsPerPage: 50,
      maxDaysOld: 7,
      sortBy: 'salary',
    });

    const url = new URL(calls[0]);
    assert.equal(url.origin, 'https://api.adzuna.com');
    assert.equal(url.pathname, '/v1/api/jobs/in/search/2');
    assert.equal(url.searchParams.get('app_id'), 'test-app-id');
    assert.equal(url.searchParams.get('app_key'), 'test-app-key');
    assert.equal(url.searchParams.get('results_per_page'), '50');
    assert.equal(url.searchParams.get('what'), 'java developer');
    assert.equal(url.searchParams.get('where'), 'pune');
    assert.equal(url.searchParams.get('category'), 'it-jobs');
    assert.equal(url.searchParams.get('max_days_old'), '7');
    assert.equal(url.searchParams.get('sort_by'), 'salary');
    assert.equal(url.searchParams.get('content-type'), 'application/json');
  });

  test('returns normalized jobs, the provider total and a hasMore flag', async () => {
    stubFetch({ body: ADZUNA_BODY });

    const result = await searchExternalJobs({ what: 'java', page: 1, resultsPerPage: 2 });

    assert.equal(result.configured, true);
    assert.equal(result.total, 137);
    assert.equal(result.hasMore, true);
    assert.equal(result.jobs.length, 2, 'the unsafe link is filtered out');
    assert.equal(result.source.name, 'Adzuna');
    assert.equal(result.cached, false);
  });

  test('an identical search is served from the cache', async () => {
    const calls = stubFetch({ body: ADZUNA_BODY });

    await searchExternalJobs({ what: 'cached-query', page: 1, resultsPerPage: 5 });
    const second = await searchExternalJobs({ what: 'cached-query', page: 1, resultsPerPage: 5 });

    assert.equal(calls.length, 1, 'the provider is called once');
    assert.equal(second.cached, true);
  });

  test('a rejected key becomes 502 provider_auth, never a leaked secret', async () => {
    stubFetch({ status: 401, body: { exception: 'AUTH_FAIL', display: 'Authorisation failed' } });

    await assert.rejects(
      () => searchExternalJobs({ what: 'auth-failure', page: 1, resultsPerPage: 5 }),
      (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.details.code, 'provider_auth');
        assert.doesNotMatch(error.message, /test-app-key/);
        return true;
      },
    );
  });

  test('a pending-activation refusal becomes 502 provider_forbidden, not an auth error', async () => {
    stubFetch({ status: 403, body: { exception: 'AUTH_FAIL' } });

    await assert.rejects(
      () => searchExternalJobs({ what: 'forbidden', page: 1, resultsPerPage: 5 }),
      (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.details.code, 'provider_forbidden');
        assert.match(error.message, /pending activation|allowance/i);
        assert.doesNotMatch(error.message, /test-app-key/);
        return true;
      },
    );
  });

  test('rate limiting from the provider becomes 429', async () => {
    stubFetch({ status: 429, body: { exception: 'RATE_LIMIT' } });

    await assert.rejects(
      () => searchExternalJobs({ what: 'rate-limited', page: 1, resultsPerPage: 5 }),
      (error) => {
        assert.equal(error.status, 429);
        assert.equal(error.details.code, 'provider_rate_limited');
        return true;
      },
    );
  });

  test('a timeout becomes 504 instead of hanging the request', async () => {
    globalThis.fetch = async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    };

    await assert.rejects(
      () => searchExternalJobs({ what: 'slow', page: 1, resultsPerPage: 5 }),
      (error) => {
        assert.equal(error.status, 504);
        assert.equal(error.details.code, 'provider_timeout');
        return true;
      },
    );
  });
});

describe('categories and configuration', () => {
  test('categories come from the provider and malformed tags are dropped', async () => {
    const calls = stubFetch({
      body: {
        results: [
          { tag: 'it-jobs', label: 'IT Jobs' },
          { tag: 'engineering-jobs', label: 'Engineering Jobs' },
          { tag: '../etc/passwd', label: 'Nope' },
        ],
      },
    });

    const result = await fetchCategories();

    assert.equal(new URL(calls[0]).pathname, '/v1/api/jobs/in/categories');
    assert.deepEqual(
      result.categories.map((category) => category.tag),
      ['it-jobs', 'engineering-jobs'],
    );
  });

  test('the server reports configured, and attribution points at Adzuna India', () => {
    assert.equal(isConfigured(), true);
    assert.deepEqual(sourceInfo(), {
      name: 'Adzuna',
      country: 'in',
      attribution: 'Jobs by Adzuna',
      url: 'https://www.adzuna.in',
    });
  });
});
