/**
 * api/index.js
 * ===========================================================================
 * VERCEL SERVERLESS ENTRY
 * ===========================================================================
 * Vercel serves the built React app as static files, but it does not run
 * `server/index.js`. This single function routes /api/* into the SAME Express
 * application the local server uses (`server/app.js`).
 *
 * WHY THIS IS NOT `api/[...route].js`
 * -----------------------------------
 * Catch-all bracket routes are a Next.js feature. On a plain Vite project
 * Vercel only matched ONE path segment: `/api/health` reached the function,
 * while `/api/auth/login` and `/api/realtime/version` returned Vercel's own
 * 404. The supported pattern for a non-Next project is a normal function plus
 * an explicit rewrite in vercel.json:
 *
 *     { "source": "/api/(.*)", "destination": "/api" }
 *
 * That rewrite forwards every API path here, and Express receives the original
 * URL, so its routes keep their `/api/...` prefix.
 *
 * The MongoDB connection is created once per warm instance and reused by later
 * invocations; `connectDatabase()` already returns the existing connection.
 */

import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/db.js';
import { sanitizeErrorText } from '../server/email/log.js';

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

  // Index creation is deliberately not part of the Vercel boot path. It is an
  // explicit operator action documented in docs/EMAIL.md; the worker verifies
  // that the required indexes exist and refuses to run otherwise.
  if (!app) app = createApp();
  return app;
}

export default async function handler(req, res) {
  // Express's router is mounted at /api. If a rewrite ever presents a bare
  // path, restore the prefix instead of silently 404ing.
  const url = String(req.url || '/');
  if (!url.startsWith('/api')) {
    req.url = `/api${url.startsWith('/') ? '' : '/'}${url}`;
  }

  let expressApp;

  try {
    expressApp = await boot();
  } catch (error) {
    const missingUri = !String(process.env.MONGODB_URI || '').trim();
    const safeMessage = String(sanitizeErrorText(error?.message || 'unknown error'))
      .replace(/\/\/[^@/]*@/, '//***@');
    console.error(`[vercel] API boot failed (${error?.name || 'Error'}): ${safeMessage}`);

    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: missingUri
          ? 'MONGODB_URI is not set for this Vercel deployment. Add it in Project → Settings → Environment Variables and redeploy.'
          : 'The API is deployed, but it could not connect to MongoDB. Check MONGODB_URI and that MongoDB Atlas allows connections from Vercel (0.0.0.0/0 in Network Access).',
      }),
    );
    return;
  }

  return expressApp(req, res);
}
