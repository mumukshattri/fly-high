/**
 * services/studentService.js
 * ===========================================================================
 * STUDENT PROFILE + NOTIFICATIONS
 * ===========================================================================
 *
 *   getStudents()                 ->  GET    /api/students
 *   getStudentById(id)            ->  GET    /api/students/:id
 *   updateStudentProfile(id, f)   ->  PUT    /api/students/profile
 *   uploadResume(id, fileInfo)    ->  POST   /api/students/resume   (multipart)
 *   getNotifications(studentId)   ->  GET    /api/notifications
 *   markNotificationRead(id)      ->  PATCH  /api/notifications/:id
 */

import { createId, mutate, query, today } from './localDatabase';

/** GET /api/students */
export async function getStudents() {
  return query((db) => db.students);
}

/** GET /api/students/:id */
export async function getStudentById(studentId) {
  return query((db) => db.students.find((student) => student.id === studentId) || null);
}

/**
 * PUT /api/students/profile
 * @param {string} studentId
 * @param {object} updates - only the fields that changed
 */
export async function updateStudentProfile(studentId, updates) {
  return mutate((db) => {
    const student = db.students.find((item) => item.id === studentId);
    if (!student) throw new Error('Student profile not found.');
    // `password` is never edited from this form.
    const { password, ...safeUpdates } = updates;
    Object.assign(student, safeUpdates);
    return student;
  });
}

/**
 * POST /api/students/resume
 * In the real backend this is a multipart/form-data upload handled by multer,
 * which stores the file and returns { fileName, size, uploadedOn }.
 * Here we only record the metadata.
 */
export async function uploadResume(studentId, fileMeta) {
  return mutate((db) => {
    const student = db.students.find((item) => item.id === studentId);
    if (!student) throw new Error('Student profile not found.');
    student.resume = {
      fileName: fileMeta.fileName,
      size: fileMeta.size || '—',
      uploadedOn: today(),
    };
    return student.resume;
  });
}

/**
 * GET /api/notifications?studentId=
 * The admin passes no id and receives every notification in the system.
 */
export async function getNotifications(studentId) {
  return query((db) =>
    db.notifications
      .filter((notification) => !studentId || notification.studentId === studentId)
      .sort((a, b) => (a.date < b.date ? 1 : -1)), // newest first
  );
}

/** PATCH /api/notifications/:id  { read: true } */
export async function markNotificationRead(notificationId) {
  return mutate((db) => {
    const notification = db.notifications.find((item) => item.id === notificationId);
    if (notification) notification.read = true;
    return notification || null;
  });
}

/** PATCH /api/notifications  { readAll: true } */
export async function markAllNotificationsRead(studentId) {
  return mutate((db) => {
    db.notifications
      .filter((notification) => notification.studentId === studentId)
      .forEach((notification) => {
        notification.read = true;
      });
    return true;
  });
}

/**
 * Convenience helper used by the Register page / demo reset - creates the
 * welcome notification for a freshly registered student.
 */
export async function addNotification({ studentId, title, message, type = 'info' }) {
  return mutate((db) => {
    const notification = {
      id: createId('ntf'),
      studentId,
      type,
      title,
      message,
      date: today(),
      read: false,
    };
    db.notifications.unshift(notification);
    return notification;
  });
}
