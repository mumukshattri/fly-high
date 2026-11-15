/**
 * tests/vercel-routing.test.js
 * ===========================================================================
 * VERCEL API ROUTING CONFIGURATION
 * ===========================================================================
 * A plain Vite project cannot use Next.js catch-all bracket routes
 * (`api/[...route].js`): Vercel matched only one path segment, so
 * `/api/health` reached the function while `/api/auth/login` returned 404.
 *
 * The supported pattern is one function plus an explicit rewrite. These tests
 * fail if someone reintroduces the bracket file or drops the API rewrite before
 * the SPA fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

test('every /api path is rewritten to the function before the SPA fallback', async () => {
  const config = JSON.parse(await readFile(root('vercel.json'), 'utf8'));

  assert.ok(Array.isArray(config.rewrites) && config.rewrites.length >= 2);

  const apiRewrite = config.rewrites[0];
  assert.equal(apiRewrite.source, '/api/(.*)', 'the API rewrite must come first');
  assert.equal(apiRewrite.destination, '/api');

  const last = config.rewrites[config.rewrites.length - 1];
  assert.equal(last.destination, '/index.html', 'the SPA fallback comes last');

  assert.ok(config.functions['api/index.js'], 'the function is configured by its real path');
});

test('the deployed entry is api/index.js, not an unsupported catch-all file', () => {
  assert.equal(existsSync(root('api/index.js')), true);
  assert.equal(
    existsSync(root('api/[...route].js')),
    false,
    'bracket catch-all routes only work in Next.js projects',
  );
});

test('the Vercel entry exports one request handler', async () => {
  const entry = await import('../api/index.js');
  assert.equal(typeof entry.default, 'function');
});

test('the email cron uses task=email and never the default all task', async () => {
  const config = JSON.parse(await readFile(root('vercel.json'), 'utf8'));
  assert.ok(Array.isArray(config.crons) && config.crons.length === 1);
  const cron = config.crons[0];
  assert.equal(cron.path, '/api/internal/email/worker?task=email');
  assert.doesNotMatch(cron.path, /task=all/);
});

test('production boot does not create email indexes', async () => {
  const entry = await readFile(root('api/index.js'), 'utf8');
  const server = await readFile(root('server/index.js'), 'utf8');
  const db = await readFile(root('server/db.js'), 'utf8');
  const script = await readFile(root('server/email/create-indexes.js'), 'utf8');

  assert.doesNotMatch(entry, /ensureEmailIndexes/);
  assert.doesNotMatch(server, /ensureEmailIndexes/);
  assert.match(db, /autoIndex = !IS_PRODUCTION/);
  assert.match(script, /autoIndex: false/);
});
