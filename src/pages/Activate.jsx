import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Button from '../components/Button';
import { api } from '../services/api';

/**
 * pages/Activate.jsx
 * ===========================================================================
 * ACCOUNT ACTIVATION for students imported from a CSV.
 * ===========================================================================
 * The placement cell's import creates an account with a random, unknowable
 * password and a one-time token. The student follows /activate?token=… and sets
 * their OWN password here. Nothing is ever emailed or printed from a shared
 * default, and the token is single-use.
 *
 * A successful activation also signs the student in (the server sets the same
 * HttpOnly session cookie as /auth/login), so the next full page load lands on
 * the dashboard as an authenticated user.
 */

export default function Activate() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Use at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.post('/auth/activate', { token, password });
      setDone(result.user);
      // A full navigation (rather than a client-side route change) makes
      // AuthContext re-read the session from the server.
      setTimeout(() => {
        window.location.assign('/student/onboarding');
      }, 600);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="auth-brand">
          <div className="auth-brand__logo">
            <Icon name="graduation" size={22} />
          </div>
          <div>
            <div className="auth-brand__name">JOB N JOB</div>
            <div className="auth-brand__sub">Campus Recruitment Management System</div>
          </div>
        </div>

        <h2>Your placement cell created your account.</h2>
        <p className="auth-aside__text">
          Set your own password to activate it. Nobody - not the placement cell, not this portal -
          ever sees or chooses it for you.
        </p>

        <div className="auth-features">
          {[
            { icon: 'shield', title: 'One-time link', text: 'The link stops working after activation.' },
            { icon: 'lock', title: 'Your password', text: 'Stored as a scrypt hash, never in plain text.' },
            { icon: 'user', title: 'Then onboarding', text: 'Add your academics, skills and resume.' },
          ].map((item) => (
            <div className="auth-feature" key={item.title}>
              <span className="auth-feature__icon">
                <Icon name={item.icon} size={17} />
              </span>
              <div>
                <div className="auth-feature__title">{item.title}</div>
                <div className="auth-feature__text">{item.text}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card" style={{ maxWidth: 460 }}>
          <h1 className="auth-card__title">Activate your account</h1>
          <p className="auth-card__sub">
            {token
              ? 'Choose a password for your Job N Job student account.'
              : 'This page needs the activation link from your placement cell.'}
          </p>

          {done ? (
            <div className="inline-note" style={{ marginTop: 16 }}>
              <Icon name="check-circle" size={16} />
              <div>
                <strong>Activated.</strong> Welcome, {done.name}. Taking you to your profile…
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-24" noValidate>
              {error ? (
                <div className="auth-error" role="alert">
                  <Icon name="alert-circle" size={16} />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="field field--full">
                <label className="label" htmlFor="activate-password">New password</label>
                <input
                  id="activate-password"
                  type="password"
                  className="input"
                  value={password}
                  placeholder="At least 6 characters"
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={!token}
                />
              </div>

              <div className="field field--full">
                <label className="label" htmlFor="activate-confirm">Confirm password</label>
                <input
                  id="activate-confirm"
                  type="password"
                  className="input"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={!token}
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                icon="lock"
                loading={busy}
                disabled={!token}
              >
                Set password &amp; continue
              </Button>
            </form>
          )}

          <p className="auth-foot">
            Already activated? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
