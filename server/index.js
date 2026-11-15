/**
 * server/index.js
 * ===========================================================================
 * ENTRY POINT
 * ===========================================================================
 *
 *   npm run server      production-style process (API + built SPA)
 *   npm run dev:api     same, restarted on file changes
 *   npm run dev         Vite dev server on 5173, proxying /api here
 *
 * Startup order is deliberate: the database connects FIRST, so a
 * misconfigured MONGODB_URI fails immediately with a readable message instead
 * of producing a server that answers 500s. There is no fallback data source.
 */

import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { sanitizeErrorText } from './email/log.js';
import { HOST, NODE_ENV, PORT, requireMongoUri } from './config.js';

/** Hide credentials before a URI is printed to the console. */
function safeUri(uri) {
  return uri.replace(/\/\/[^@/]*@/, '//***@');
}

async function start() {
  const uri = requireMongoUri();

  console.log(`[db]  connecting to ${safeUri(uri)}`);
  await connectDatabase(uri);
  console.log('[db]  connected');

  // Email indexes are NOT built during startup. Production index creation is
  // an explicit operator action; the worker verifies before doing any work.
  const app = createApp();

  const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log(`  Job N Job API  ->  http://${HOST}:${PORT}`);
    console.log(`  Health check   ->  http://${HOST}:${PORT}/api/health`);
    console.log(`  Environment    ->  ${NODE_ENV}`);
    console.log('');
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDatabase().catch(() => {});
      process.exit(0);
    });
    // Do not hang forever on a stuck socket.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

start().catch((error) => {
  const message = safeUri(sanitizeErrorText(error?.message || 'unknown startup error', 500));
  console.error('\n[startup] Job N Job could not start:\n');
  console.error(`  ${message}`);
  console.error('');
  process.exit(1);
});
