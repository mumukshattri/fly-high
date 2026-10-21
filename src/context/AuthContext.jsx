import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authService from '../services/authService';

/**
 * AuthContext
 * ---------------------------------------------------------------------------
 * Holds WHO IS LOGGED IN and their ROLE. This is the demo equivalent of a
 * session cookie / JWT that a real backend would manage.
 *
 * `user` looks like:
 *   { id: 'stu-101', role: 'student', name: 'Aarav Sharma', email: '...' }
 *
 * The full student profile (CGPA, skills, resume) is NOT stored here - it lives
 * in DataContext, because profiles change while the session does not.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `initialising` is true while we restore a saved session from localStorage,
  // so we can show a loading screen instead of flashing the login page.
  const [initialising, setInitialising] = useState(true);

  useEffect(() => {
    let cancelled = false;

    authService
      .fetchCurrentUser()
      .then((session) => {
        if (!cancelled) setUser(session ? session.user : null);
      })
      .finally(() => {
        if (!cancelled) setInitialising(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Calls the mock login API and remembers the returned user. */
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
