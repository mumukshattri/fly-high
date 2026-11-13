/**
 * server/models/index.js
 * ===========================================================================
 * MODEL REGISTRY
 * ===========================================================================
 * Importing this file guarantees every model is registered with Mongoose, which
 * matters because `populate()` and `ref` only work once the target model exists.
 */

export { Student, default as studentModel } from './student.js';
export { Company, default as companyModel } from './company.js';
export { Admin, default as adminModel } from './admin.js';
export { Drive, default as driveModel } from './drive.js';
export { Application, default as applicationModel } from './application.js';
export { Notification, default as notificationModel } from './notification.js';
export { Session, default as sessionModel } from './session.js';
export { RealtimeState, default as realtimeModel } from './realtime.js';
