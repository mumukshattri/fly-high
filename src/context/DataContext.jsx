import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as applicationService from '../services/applicationService';
import * as driveService from '../services/driveService';
import * as studentService from '../services/studentService';
import { resetDatabase } from '../services/localDatabase';

/**
 * DataContext
 * ---------------------------------------------------------------------------
 * This is our small "frontend database" - all five collections are loaded once
 * from the services layer and kept in React state so pages can read them
 * synchronously without re-fetching on every navigation.
 *
 *   students | companies | drives | applications | notifications
 *
 * The pattern used here is deliberately simple and works for any backend:
 *
 *   1. on mount            -> GET the collections (loading = true)
 *   2. a page calls an     -> POST / PATCH through the service layer
 *     action
 *   3. when it succeeds    -> reload the collections (stay in sync)
 *
 * No Redux is needed because there is exactly one place (this provider) that
 * owns the data, and the data set is tiny.
 *
 * NOTE: `state` shape is also what the selector functions in utils/selectors.js
 * expect, e.g. getStudentApplications(studentId, state).
 */
const DataContext = createContext(null);

const EMPTY_STATE = {
  students: [],
  companies: [],
  drives: [],
  applications: [],
  notifications: [],
};

export function DataProvider({ children }) {
  const [state, setState] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); // true while a write is in flight
  const [error, setError] = useState(null);

  /**
   * Loads every collection in parallel (like Promise.all of four fetch calls).
   * @param {{silent?: boolean}} options - silent keeps the page visible after a write
   */
  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [students, companies, drives, applications, notifications] = await Promise.all([
        studentService.getStudents(),
        driveService.getCompanies(),
        driveService.getDrives(),
        applicationService.getApplications(),
        studentService.getNotifications(), // no id -> every notification
      ]);
      setState({ students, companies, drives, applications, notifications });
    } catch (loadError) {
      setError(loadError.message || 'Could not load data from the server.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Helper used by every write action below:
   * run the API call -> refresh quietly -> return the API result.
   * The caller can still `await` it to know when the write finished.
   */
  const runWrite = useCallback(
    async (writeAction) => {
      setSaving(true);
      try {
        const result = await writeAction();
        await refresh({ silent: true });
        return result;
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  /* ----------------------------- Student actions ----------------------------- */

  /** POST /api/applications - also creates a notification. */
  const applyToDrive = useCallback(
    ({ studentId, driveId }) => runWrite(() => applicationService.applyToDrive({ studentId, driveId })),
    [runWrite],
  );

  /** PUT /api/students/profile */
  const updateProfile = useCallback(
    (studentId, updates) =>
      runWrite(() => studentService.updateStudentProfile(studentId, updates)),
    [runWrite],
  );

  /** POST /api/students/resume (metadata only in the demo) */
  const uploadResume = useCallback(
    (studentId, fileMeta) => runWrite(() => studentService.uploadResume(studentId, fileMeta)),
    [runWrite],
  );

  /* ----------------------------- Company actions ----------------------------- */

  /** POST /api/drives */
  const createDrive = useCallback(
    (payload) => runWrite(() => driveService.createDrive(payload)),
    [runWrite],
  );

  /** PATCH /api/drives/:id */
  const closeDrive = useCallback(
    (driveId) => runWrite(() => driveService.closeDrive(driveId)),
    [runWrite],
  );

  /** PATCH /api/applications/:id - shortlist / reject / select */
  const updateApplicationStatus = useCallback(
    (payload) => runWrite(() => applicationService.updateApplicationStatus(payload)),
    [runWrite],
  );

  /* -------------------------------- Notifications ------------------------------- */

  const markNotificationRead = useCallback(
    (notificationId) => runWrite(() => studentService.markNotificationRead(notificationId)),
    [runWrite],
  );

  const markAllNotificationsRead = useCallback(
    (studentId) => runWrite(() => studentService.markAllNotificationsRead(studentId)),
    [runWrite],
  );

  /* --------------------------------- Admin / demo -------------------------------- */

  /** Deletes the localStorage database and reloads the original mock data. */
  const resetDemoData = useCallback(async () => {
    resetDatabase();
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      // data
      ...state,
      // flags
      loading,
      saving,
      error,
      // actions
      refresh,
      applyToDrive,
      updateProfile,
      uploadResume,
      createDrive,
      closeDrive,
      updateApplicationStatus,
      markNotificationRead,
      markAllNotificationsRead,
      resetDemoData,
    }),
    [
      state,
      loading,
      saving,
      error,
      refresh,
      applyToDrive,
      updateProfile,
      uploadResume,
      createDrive,
      closeDrive,
      updateApplicationStatus,
      markNotificationRead,
      markAllNotificationsRead,
      resetDemoData,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used inside <DataProvider>');
  return context;
}
