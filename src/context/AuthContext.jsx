import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authService from '../services/authService';

/**
 * AuthContext
 * ---------------------------------------------------------------------------
 * Holds WHO IS LOGGED IN and their ROLE.
 *
 * The session itself belongs to the server: it lives in an HttpOnly cookie, so
 * this context never touches a token. On boot we ask GET /api/auth/me who the
 * cookie belongs to, which makes a page refresh keep you signed in.
 *
 * `user` looks like:
 *   { id: '6aeadcea...', role: 'student', name: 'Aarav Sharma', email: '...' }
 *
 * The full student profile (CGPA, skills, resume) is NOT stored here - it lives
 * in DataContext, because profiles change while the session does not.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `initialising` is true while we ask the server who we are, so we can show a
  // loading screen instead of flashing the login page.
  const [initialising, setInitialising] = useState(true);

  useEffect(() => {
    let cancelled = false;

    authService
      .fetchCurrentUser()
      .then((session) => {
        if (!cancelled) setUser(session ? session.user : null);
      })
      // An unreachable API means "not signed in yet", not a crash: the login
      // page will explain that the server needs to be started.
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setInitialising(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** POST /api/auth/login - the server sets the session cookie. */
  const login = useCallback(async (credentials) => {
    const session = await authService.login(credentials);
    setUser(session.user);
    return session.user;
  }, []);

  const register = useCallback(async (form) => {
    const session = await authService.register(form);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      initialising,
      isAuthenticated: Boolean(user),
      // Handy booleans so pages do not compare strings everywhere.
      isStudent: user?.role === 'student',
      isCompany: user?.role === 'company',
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
    }),
    [user, initialising, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
