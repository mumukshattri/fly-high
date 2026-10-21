import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

// Contexts (global state)
import { AuthProvider } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ToastProvider } from './context/ToastContext';

// Layout + guards
import DashboardLayout from './components/DashboardLayout';
import ToastStack from './components/ToastStack';
import { ProtectedRoute, RedirectIfAuthenticated } from './components/ProtectedRoute';

// Auth pages
import Login from './pages/Login';
import Register from './pages/Register';
import NotFound from './pages/NotFound';

// Student pages
import StudentDashboard from './pages/student/StudentDashboard';
import StudentProfile from './pages/student/StudentProfile';
import StudentDrives from './pages/student/StudentDrives';
import DriveDetails from './pages/student/DriveDetails';
import StudentApplications from './pages/student/StudentApplications';
import ApplicationDetails from './pages/student/ApplicationDetails';
import StudentNotifications from './pages/student/StudentNotifications';

// Company pages
import CompanyDashboard from './pages/company/CompanyDashboard';
import CompanyDrives from './pages/company/CompanyDrives';
import CompanyApplicants from './pages/company/CompanyApplicants';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminStudents from './pages/admin/AdminStudents';
import AdminCompanies from './pages/admin/AdminCompanies';
import AdminDrives from './pages/admin/AdminDrives';
import AdminApplications from './pages/admin/AdminApplications';
import AdminStatistics from './pages/admin/AdminStatistics';

/**
 * App.jsx
 * ===========================================================================
 * ROUTING
 * ===========================================================================
 * The whole app is a tree of <Route> elements:
 *
 *   /login, /register                        -> public
 *   /student/*   (role = student)            -> one layout + child pages
 *   /company/*   (role = company)
 *   /admin/*     (role = admin)
 *
 * Layout routes:  /student is rendered by <DashboardLayout>, and each child
 * page appears inside it through <Outlet />. That is why the sidebar and top
 * bar do not unmount when you navigate between pages.
 *
 * Guarding: <ProtectedRoute role="student"> sends you to /login if nobody is
 * logged in, or to your own dashboard if you belong to another role.
 *
 * Provider order matters: AuthProvider (who am I) wraps DataProvider (the
 * collections), and both wrap the routes.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <DataProvider>
            {/* Global toast messages - rendered above every page */}
            <ToastStack />

            <Routes>
              {/* ---------------------------- public ---------------------------- */}
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route
                path="/login"
                element={
                  <RedirectIfAuthenticated>
                    <Login />
                  </RedirectIfAuthenticated>
                }
              />
              <Route
                path="/register"
                element={
                  <RedirectIfAuthenticated>
                    <Register />
                  </RedirectIfAuthenticated>
                }
              />

              {/* --------------------------- student ---------------------------- */}
              <Route
                path="/student"
                element={
                  <ProtectedRoute role="student">
                    <DashboardLayout role="student" />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<StudentDashboard />} />
                <Route path="profile" element={<StudentProfile />} />
                <Route path="drives" element={<StudentDrives />} />
                <Route path="drives/:driveId" element={<DriveDetails />} />
                <Route path="applications" element={<StudentApplications />} />
                <Route path="applications/:applicationId" element={<ApplicationDetails />} />
                <Route path="notifications" element={<StudentNotifications />} />
              </Route>

              {/* --------------------------- company ---------------------------- */}
              <Route
                path="/company"
                element={
                  <ProtectedRoute role="company">
                    <DashboardLayout role="company" />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<CompanyDashboard />} />
                <Route path="drives" element={<CompanyDrives />} />
                <Route path="applicants" element={<CompanyApplicants />} />
              </Route>

              {/* ---------------------------- admin ----------------------------- */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute role="admin">
                    <DashboardLayout role="admin" />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="students" element={<AdminStudents />} />
                <Route path="companies" element={<AdminCompanies />} />
                <Route path="drives" element={<AdminDrives />} />
                <Route path="applications" element={<AdminApplications />} />
                <Route path="statistics" element={<AdminStatistics />} />
              </Route>

              {/* ---------------------------- fallback --------------------------- */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </DataProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
