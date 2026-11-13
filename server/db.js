/**
 * server/db.js
 * ===========================================================================
 * MONGODB CONNECTION
 * ===========================================================================
 *
 * One connection for the whole process, owned by Mongoose. The URI always
 * comes from configuration (`MONGODB_URI`); this module deliberately contains
 * no fallback data source - if MongoDB is unreachable the application refuses
 * to serve requests instead of quietly using something else.
 *
 *   connectDatabase()      -> used by server/index.js and by the tests
 *   disconnectDatabase()   -> graceful shutdown
 *   databaseStatus()       -> human readable state for /api/health
 */

import mongoose from 'mongoose';

import { requireMongoUri } from './config.js';

let connectionPromise = null;

const READY_STATE = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Connect to MongoDB. Safe to call more than once: the existing connection is
 * reused so a hot reload or a second call does not open extra pools.
 */
export async function connectDatabase(uri = requireMongoUri()) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  mongoose.set('strictQuery', true);

  connectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 10,
      // Indexes are declared on the schemas; let Mongoose build them.
      autoIndex: true,
    })
    .then(() => mongoose.connection)
    .finally(() => {
      connectionPromise = null;
    });

  return connectionPromise;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

export function databaseStatus() {
  return READY_STATE[mongoose.connection.readyState] || 'unknown';
}

/** Drop every document in the current database. Tests only. */
export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

export default mongoose;
