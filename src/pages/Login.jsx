import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { HOME_ROUTE } from '../config/navigation';

/**
 * pages/Login.jsx
 * ===========================================================================
 * LOGIN - the entry point of the workflow.
 * ===========================================================================
 * After a successful login the user is routed by ROLE:
 *
 *   student -> /student/dashboard
 *   company -> /company/dashboard
 *   admin   -> /admin/dashboard
 *
 * The three roles are clearly separated by the segmented control at the top.
 *
 * SECURITY NOTE (say this in the viva): the password is POSTed to
 * /api/auth/login. Express compares a scrypt hash and creates a server-side
 * session whose id lives in an HttpOnly cookie - JavaScript can never read it,
 * so there is no token in localStorage to steal.
 */

const ROLES = [
  { value: 'student', label: 'Student', icon: 'graduation' },
  { value: 'company', label: 'Company', icon: 'building' },
  { value: 'admin', label: 'Admin', icon: 'shield' },
];

export default function Login() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [role, setRole] = useState('student');
  const [form, setForm] = useState({ email: '', password: '' });
  // Sent to the API: false means a browser-session cookie (12h server row).
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForgotNote, setShowForgotNote] = useState(false);

  /** Local validation before we "call the API" (the browser checks first). */
  const validate = () => {
    const nextErrors = {};
    if (!form.email.trim()) nextErrors.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!form.password) nextErrors.password = 'Password is required.';
    else if (form.password.length < 6) nextErrors.password = 'Password must be at least 6 characters.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setServerError('');
    if (!validate()) return;

    try {
      setSubmitting(true);
      // POST /api/auth/login - the server sets the HttpOnly session cookie.
      const user = await login({
        email: form.email,
        password: form.password,
        role,
        remember,
      });
      showToast(`Welcome back, ${user.name}`, 'success');

      // If the guard sent us here from a protected page, go back there.
      const redirectTo = location.state?.from || HOME_ROUTE[user.role];
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setServerError(error.message || 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      {/* ---------------------------- left brand panel ---------------------------- */}
      <aside className="auth-aside">
        <div className="auth-brand">
          <div className="auth-brand__logo">
            <Icon name="graduation" size={22} />
          </div>
          <div>
            <div className="auth-brand__name">JOB N JOB</div>
            <div className="auth-brand__sub">Centralized Campus Recruitment Management System</div>
          </div>
        </div>

        <h2>One platform for students, recruiters and the placement cell.</h2>
        <p className="auth-aside__text">
          Students discover eligible drives and track every application. Companies publish drives and
          review applicants. The placement cell monitors the entire recruitment season.
        </p>

        <div className="auth-features">
          <div className="auth-feature">
            <span className="auth-feature__icon">
              <Icon name="target" size={17} />
            </span>
            <div>
              <div className="auth-feature__title">Automatic eligibility check</div>
              <div className="auth-feature__text">
                CGPA, branch, skills and deadline are validated before a student can apply.
              </div>
            </div>
          </div>

          <div className="auth-feature">
            <span className="auth-feature__icon">
              <Icon name="layers" size={17} />
            </span>
            <div>
              <div className="auth-feature__title">Track the hiring pipeline</div>
              <div className="auth-feature__text">
                Applied to Under Review to Shortlisted to Selected, with dates and remarks.
              </div>
            </div>
          </div>

          <div className="auth-feature">
            <span className="auth-feature__icon">
              <Icon name="bar-chart" size={17} />
            </span>
            <div>
              <div className="auth-feature__title">Placement analytics</div>
              <div className="auth-feature__text">
                Branch-wise and company-wise statistics for the placement cell.
              </div>
            </div>
          </div>
        </div>

        <div className="auth-aside__footer">
          JOB N JOB - Centralized Campus Recruitment Management System
        </div>
      </aside>

      {/* ------------------------------- login form ------------------------------- */}
      <main className="auth-main">
        <div className="auth-card">
          <h1 className="auth-card__title">Sign in to your account</h1>
          <p className="auth-card__sub">Select your role and enter your credentials to continue.</p>

          {/* Role selector - keeps the three user types clearly separate */}
          <div className="segmented" role="tablist" aria-label="Select your role">
            {ROLES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={role === item.value}
                className={`segmented__option ${role === item.value ? 'is-active' : ''}`}
                onClick={() => {
                  setRole(item.value);
                  setServerError('');
                }}
              >
                <Icon name={item.icon} size={15} />
                {item.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-24" noValidate>
            {serverError ? (
              <div className="auth-error" role="alert">
                <Icon name="alert-circle" size={16} />
                <span>{serverError}</span>
              </div>
            ) : null}

            <div className="field">
              <label className="label" htmlFor="email">
                {role === 'company' ? 'HR / Recruiter Email' : 'Email Address'}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className={`input ${errors.email ? 'input--error' : ''}`}
                placeholder={
                  role === 'student' ? 'you@student.edu' : role === 'company' ? 'hr@company.com' : 'admin@college.edu'
                }
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
              {errors.email ? <span className="field__error">{errors.email}</span> : null}
            </div>

            <div className="field">
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className={`input ${errors.password ? 'input--error' : ''}`}
                placeholder="Enter your password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
              {errors.password ? <span className="field__error">{errors.password}</span> : null}
            </div>

            <div className="auth-foot auth-foot--row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />{' '}
                Keep me signed in
              </label>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ height: 'auto', padding: 0 }}
                onClick={() => setShowForgotNote(true)}
              >
                Forgot password?
              </button>
            </div>

            {showForgotNote ? (
              <div className="inline-note inline-note--warning mb-16">
                <Icon name="info" size={16} />
                <span>
                  Password reset is handled by the placement cell. Contact your
                  placement officer to have your password re-issued.
                </span>
              </div>
            ) : null}

            <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} icon="login">
              {submitting ? 'Signing in...' : 'Login'}
            </Button>
          </form>

          <p className="auth-foot">
            Don't have an account? <Link to="/register">Register</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
