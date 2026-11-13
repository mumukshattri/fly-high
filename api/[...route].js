/**
 * api/[...route].js
 * ===========================================================================
 * VERCEL SERVERLESS ENTRY
 * ===========================================================================
 * Vercel serves the built React app as static files, but it does not run
 * `server/index.js` - a Vite project has no server by default. That is why POST
 * /api/auth/register answered 404 on a Vercel deployment.
 *
 * This catch-all function routes every /api/* request into the SAME Express
 * application the local server uses (`server/app.js`), so authentication,
 * cookies, CSRF checks, validation and error handling are identical.
 *
 * The MongoDB connection is created once per warm function instance and reused
 * by later invocations; `connectDatabase()` already returns the existing
 * connection when one is open.
 */

import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/db.js';

let app = null;
let connection = null;

async function boot() {
  if (!connection) {
    connection = connectDatabase().catch((error) => {
      // Let the next invocation retry instead of caching the failure forever.
      connection = null;
      throw error;
    });
  }

  await connection;
  if (!app) app = createApp();
  return app;
}

export default async function handler(req, res) {
  let expressApp;

  try {
    expressApp = await boot();
  } catch (error) {
    console.error('[vercel] could not start the API:', error.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error:
          'The API is deployed, but it cannot reach MongoDB. Set MONGODB_URI in the Vercel project environment variables and redeploy.',
      }),
    );
    return;
  }

  return expressApp(req, res);
}
