/**
 * server/email/create-indexes.js
 * ===========================================================================
 * EXPLICIT EMAIL INDEX OPERATOR COMMAND
 * ===========================================================================
 * Production index creation is never a boot or deploy side effect. This file
 * is the only code path that creates the required indexes, and it requires an
 * explicit --approve flag so it cannot run because a server started.
 *
 * Safe usage:
 *   NODE_ENV=production npm run email:indexes -- --check
 *   NODE_ENV=production npm run email:indexes -- --approve
 *
 * --check is read-only. --approve is additive and never drops an index or
 * collection. Both commands use the MONGODB_URI already configured for the
 * deployment; do not put a connection string in chat or commit it.
 */

import { connectDatabase, disconnectDatabase } from '../db.js';
import { emailIndexReport, ensureEmailIndexes } from './indexes.js';

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const approved = args.has('--approve');

if (checkOnly === approved) {
  console.error(
    'Refusing to run. Use exactly one of --check (read-only) or --approve (create additive indexes).',
  );
  process.exit(1);
}

let exitCode = 0;
try {
  // This command, not Mongoose, is the only index writer. Disable the driver's
  // implicit schema-index creation even when the operator forgets NODE_ENV.
  await connectDatabase(undefined, { autoIndex: false });

  if (approved) {
    await ensureEmailIndexes();
  }

  const report = await emailIndexReport();
  if (report.ok) {
    console.log('[email-indexes] all required indexes are present');
  } else {
    console.error('[email-indexes] missing required indexes:');
    for (const index of report.missing) console.error(`  - ${index}`);
    exitCode = 2;
  }
} catch (error) {
  // Never print the driver message here: it can contain a connection string.
  console.error(`[email-indexes] failed (${error?.name || 'Error'})`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => {});
  process.exitCode = exitCode;
}
