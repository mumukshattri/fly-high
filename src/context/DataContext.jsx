import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as applicationService from '../services/applicationService';
import * as adminService from '../services/adminService';
import * as driveService from '../services/driveService';
import * as studentService from '../services/studentService';
import { subscribeRealtime } from '../services/api';
import { useAuth } from './AuthContext';

/**
 * DataContext
 * ---------------------------------------------------------------------------
 * All five collections are loaded from the MongoDB backend and kept in React
 * state so pages can read them synchronously without refetching on navigation.
 *
 *   students | companies | drives | applications | notifications
 *
 * The rules that matter for correctness and security:
 *
 *   1. NOTHING loads without an authenticated user. Every request carries the
 *      HttpOnly session cookie and the SERVER decides what that account may
 *      read (a student gets their own rows, a recruiter gets their own
 *      company's rows, an admin gets everything). The browser never receives a
 *      full private payload and filters it down.
 *   2. Signing out - or a refused session - empties the state immediately, so a
 *      second person on the same browser never sees the previous account's data.
 *   3. Live updates arrive over SSE as "something changed". We refetch through
 *      the authenticated REST API, which keeps every payload correctly scoped;
 *      events themselves carry no personal data.
 *   4. A failed load is reported in `error`; a 401 means the session is over and
 *      signs the user out instead of looping on a dead cookie.
 *
 * `state` is the shape the selectors in utils/selectors.js expect, e.g.
 * getStudentApplications(studentId, state).
 */
const DataContext = createContext(null);

const EMPTY_STATE = {
  students: [],
  companies: [],
  drives: [],
  applications: [],
  notifications: [],
};

/** Coalesce bursts of events (one shortlist notifies several clients at once). */
const REALTIME_DEBOUNCE_MS = 250;

export function DataProvider({ children }) {
  const { user, logout } = useAuth();

  const [state, setState] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(false); // first load for the current user
  const [saving, setSaving] = useState(false); // a write is in flight
  const [error, setError] = useState(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Lets an in-flight response be discarded if the account changed meanwhile.
  const activeUserId = useRef(null);
  activeUserId.current = user?.id || null;

  const clear = useCallback(() => {
    setState(EMPTY_STATE);
    setError(null);
    setLoading(false);
  }, []);

  /**
   * Load every collection the current role is allowed to read.
   * @param {{silent?: boolean}} options - silent keeps the page visible after a write
   */
  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) {
        clear();
        return;
      }

      if (!silent) setLoading(true);

      try {
        const [students, companies, drives, applications, notifications] = await Promise.all([
          studentService.getStudents(),
          driveService.getCompanies(),
          driveService.getDrives(),
          applicationService.getApplications(),
          studentService.getNotifications(),
        ]);

        // A response belonging to a session we have already left is dropped.
        if (activeUserId.current !== user.id) return;

        setState({ students, companies, drives, applications, notifications });
        setError(null);
      } catch (loadError) {
        if (activeUserId.current !== user.id) return;

        if (loadError.status === 401) {
          // Expired or revoked session: stop pretending we are signed in.
          await logout().catch(() => {});
          clear();
          return;
        }

        setError(loadError.message || 'Could not load data from the server.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [user, logout, clear],
  );

  // Load on sign-in, clear on sign-out.
  useEffect(() => {
    if (!user) {
      clear();
      return;
    }
    refresh();
  }, [user, refresh, clear]);

  // Live updates, for a signed-in user only.
  useEffect(() => {
    if (!user) {
      setRealtimeConnected(false);
      return undefined;
    }

    let timer = null;
    const unsubscribe = subscribeRealtime(
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          refresh({ silent: true });
        }, REALTIME_DEBOUNCE_MS);
      },
      { onStatus: setRealtimeConnected },
    );

    return () => {
      clearTimeout(timer);
      unsubscribe();
      setRealtimeConnected(false);
    };
  }, [user, refresh]);

  /** Write -> refetch -> return the API result. */
  const runWrite = useCallback(
    async (writeAction) => {
      setSaving(true);
      try {
        const result = await writeAction();
        await refresh({ silent: true });
        return result;
      } catch (writeError) {
        if (writeError.status === 401) {
          await logout().catch(() => {});
          clear();
        }
        throw writeError;
      } finally {
        setSaving(false);
      }
    },
    [refresh, logout, clear],
  );

  /* ----------------------------- Student actions ----------------------------- */

  /** POST /api/applications - the server revalidates eligibility and duplicates. */
  const applyToDrive = useCallback(
    ({ driveId }) => runWrite(() => applicationService.applyToDrive({ driveId })),
    [runWrite],
  );

  /** PATCH /api/students/me/profile - the id is kept for call-site compatibility. */
  const updateProfile = useCallback(
    (studentId, updates) => runWrite(() => studentService.updateStudentProfile(studentId, updates)),
    [runWrite],
  );

  /** POST /api/students/me/resume - sends the actual File, not just its name. */
  const uploadResume = useCallback(
    (studentId, file) => runWrite(() => studentService.uploadResumeFile(file)),
    [runWrite],
  );

  /* ------------------------------ Company actions ----------------------------- */

  /** POST /api/drives - refused with 403 until an admin verifies the company. */
  const createDrive = useCallback(
    (payload) => runWrite(() => driveService.createDrive(payload)),
    [runWrite],
  );

  /** PATCH /api/drives/:id { status: 'Closed' } */
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
    () => runWrite(() => studentService.markAllNotificationsRead()),
    [runWrite],
  );

  /* ----------------------------------- Admin ----------------------------------- */

  /** PATCH /api/admin/companies/:id { verified } */
  const setCompanyVerification = useCallback(
    (companyId, verified) =>
      runWrite(() => adminService.setCompanyVerification(companyId, verified)),
    [runWrite],
  );

  const value = useMemo(
    () => ({
      // data
      ...state,
      // flags
      loading,
      saving,
      error,
      realtimeConnected,
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
      setCompanyVerification,
    }),
    [
      state,
      loading,
      saving,
      error,
      realtimeConnected,
      refresh,
      applyToDrive,
      updateProfile,
      uploadResume,
      createDrive,
      closeDrive,
      updateApplicationStatus,
      markNotificationRead,
      markAllNotificationsRead,
      setCompanyVerification,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used inside <DataProvider>');
  return context;
}
