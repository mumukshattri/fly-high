import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HOME_ROUTE } from '../config/navigation';
import Icon from './Icon';

/**
 * components/ProtectedRoute.jsx
 * ---------------------------------------------------------------------------
 * ROUTE GUARDING - an important part of the project.
 *
 * 1. While the saved session is being restored we show a loading screen
 *    (otherwise a refresh would bounce a logged-in user back to /login).
 * 2. A user who is not logged in is redirected to /login.
 * 3. A logged-in user who visits a page that belongs to ANOTHER role is sent
 *    to their own dashboard, e.g. a student typing /admin/dashboard.
 *
 * <Route path="/student" element={<ProtectedRoute role="student"><DashboardLayout/></ProtectedRoute>}>
 */
export function ProtectedRoute({ role, children }) {
  const { user, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <AppLoading />;

  if (!user) {
    // We remember where the user wanted to go so login can send them back.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to={HOME_ROUTE[user.role]} replace />;
  }

  return children;
}

/**
 * The opposite guard: keeps an already logged-in user away from /login and
 * /register so they cannot "log in twice".
 */
export function RedirectIfAuthenticated({ children }) {
  const { user, initialising } = useAuth();
  if (initialising) return <AppLoading />;
  if (user) return <Navigate to={HOME_ROUTE[user.role]} replace />;
  return children;
}

/** Full-screen loading screen used during session restore. */
export function AppLoading() {
  return (
    <div className="app-loading">
      <div className="app-loading__inner">
        <div className="app-loading__logo">
          <Icon name="graduation" size={24} />
        </div>
        <span className="app-loading__text">Loading Placement Portal...</span>
      </div>
    </div>
  );
}
