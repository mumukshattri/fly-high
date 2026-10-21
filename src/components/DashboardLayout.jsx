import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { getPageMeta, SEARCH_ROUTE } from '../config/navigation';

/**
 * components/DashboardLayout.jsx
 * ---------------------------------------------------------------------------
 * The shared shell for ALL logged-in pages (student, company and admin):
 *
 *   ┌───────────┬──────────────────────────────┐
 *   │           │  Topbar (title + search)     │
 *   │  Sidebar  ├──────────────────────────────┤
 *   │           │  <Outlet /> = the page       │
 *   └───────────┴──────────────────────────────┘
 *
 * `<Outlet />` is the React Router placeholder for the child route, so every
 * page is rendered inside this layout without repeating the sidebar/topbar.
 *
 * The `role` prop tells it which navigation to show.
 */
export default function DashboardLayout({ role }) {
  const { user, logout } = useAuth();
  const { notifications, resetDemoData } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the mobile sidebar whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const meta = getPageMeta(location.pathname, role);

  // Students only see their own notifications; admins see all unread ones.
  const unreadCount = notifications.filter((notification) => {
    if (notification.read) return false;
    return role === 'student' ? notification.studentId === user?.id : true;
  }).length;

  const handleLogout = async () => {
    await logout();
    showToast('You have been logged out.', 'info');
    navigate('/login', { replace: true });
  };

  const handleSearch = (term) => {
    navigate(`${SEARCH_ROUTE[role]}?q=${encodeURIComponent(term)}`);
  };

  const handleReset = async () => {
    await resetDemoData();
    showToast('Demo data restored to its original state.', 'info');
  };

  return (
    <div className="app-shell">
      <Sidebar
        role={role}
        user={user}
        unreadCount={unreadCount}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={handleLogout}
        onResetDemoData={handleReset}
      />

      {/* Dark backdrop behind the sidebar on tablets/phones */}
      <button
        type="button"
        className={`sidebar-overlay ${sidebarOpen ? 'is-open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-label="Close menu"
      />

      <div className="app-main">
        <Topbar
          title={meta.title}
          subtitle={meta.subtitle}
          role={role}
          user={user}
          unreadCount={unreadCount}
          searchPlaceholder={
            role === 'student'
              ? 'Search drives, companies...'
              : role === 'company'
                ? 'Search applicants...'
                : 'Search students...'
          }
          onSearchSubmit={handleSearch}
          onOpenMenu={() => setSidebarOpen(true)}
          onOpenNotifications={
            role === 'student' ? () => navigate('/student/notifications') : undefined
          }
        />

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
