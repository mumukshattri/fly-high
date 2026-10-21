import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { HOME_ROUTE } from '../config/navigation';
import { BRANCHES, SEMESTERS } from '../config/constants';

/**
 * pages/Register.jsx
 * ===========================================================================
 * REGISTRATION - creates the account that the whole workflow depends on.
 * ===========================================================================
 * A student must register before they can see drives or apply, because the
 * eligibility rules need the CGPA, branch and skills that are captured here.
 *
 * The form is identical in structure to the login form: local state + a
 * `validate()` function + a call to the service layer
 * (`register()` -> eventually POST /api/auth/register).
 */

const emptyStudentForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  rollNumber: '',
  phone: '',
  university: 'Vishwakarma Institute of Technology, Pune',
  branch: 'CSE',
  semester: 7,
  cgpa: '',
  graduationYear: 2027,
};

const emptyCompanyForm = {
  name: '',
  contactPerson: '',
  email: '',
  password: '',
  confirmPassword: '',
  industry: '',
  location: '',
  website: '',
  phone: '',
};

export default function Register() {
  const { register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [role, setRole] = useState('student');
  const [studentForm, setStudentForm] = useState(emptyStudentForm);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isStudent = role === 'student';

  const update = (field, value) => {
    if (isStudent) setStudentForm((current) => ({ ...current, [field]: value }));
    else setCompanyForm((current) => ({ ...current, [field]: value }));
  };

  const validate = () => {
    const form = isStudent ? studentForm : companyForm;
    const nextErrors = {};

    if (!form.name.trim()) nextErrors.name = isStudent ? 'Full name is required.' : 'Company name is required.';
    if (!form.email.trim()) nextErrors.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!form.password) nextErrors.password = 'Password is required.';
    else if (form.password.length < 6) nextErrors.password = 'Use at least 6 characters.';
    if (form.confirmPassword !== form.password) nextErrors.confirmPassword = 'Passwords do not match.';

    if (isStudent) {
      if (!studentForm.rollNumber.trim()) nextErrors.rollNumber = 'Roll number is required.';
      if (studentForm.cgpa === '') nextErrors.cgpa = 'CGPA is required.';
      else if (Number(studentForm.cgpa) < 0 || Number(studentForm.cgpa) > 10)
        nextErrors.cgpa = 'CGPA must be between 0 and 10.';
      if (!studentForm.phone.trim()) nextErrors.phone = 'Phone number is required.';
    } else if (!companyForm.contactPerson.trim()) {
      nextErrors.contactPerson = 'Contact person is required.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setServerError('');
    if (!validate()) return;

    const form = isStudent ? studentForm : companyForm;

    try {
      setSubmitting(true);
      const user = await register({ ...form, role });
      showToast(
        isStudent
          ? 'Account created. Complete your profile to unlock more drives.'
          : 'Company account created. You can now publish a recruitment drive.',
        'success',
      );
      navigate(HOME_ROUTE[user.role], { replace: true });
    } catch (error) {
      setServerError(error.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      {/* ------------------------------ left panel ------------------------------ */}
      <aside className="auth-aside">
        <div className="auth-brand">
          <div className="auth-brand__logo">
            <Icon name="graduation" size={22} />
          </div>
          <div>
            <div className="auth-brand__name">Placement Portal</div>
            <div className="auth-brand__sub">Campus Recruitment Management System</div>
          </div>
        </div>

        <h2>Register once and stay placement-ready all season.</h2>
        <p className="auth-aside__text">
          Your academic details power the eligibility engine, so filling them in correctly is what
          allows the portal to match you with the right drives automatically.
        </p>

        <div className="auth-features">
          {[
            { icon: 'user', title: '1. Create your profile', text: 'Name, branch, CGPA and skills.' },
            { icon: 'briefcase', title: '2. Browse recruitment drives', text: 'See only drives you qualify for.' },
            { icon: 'send', title: '3. Apply with one click', text: 'Confirmation modal prevents duplicates.' },
            { icon: 'layers', title: '4. Track your status', text: 'Applied to Selected, updated live.' },
          ].map((step) => (
            <div className="auth-feature" key={step.title}>
              <span className="auth-feature__icon">
                <Icon name={step.icon} size={17} />
              </span>
              <div>
                <div className="auth-feature__title">{step.title}</div>
                <div className="auth-feature__text">{step.text}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ------------------------------ register form ------------------------------ */}
      <main className="auth-main">
        <div className="auth-card" style={{ maxWidth: 560 }}>
          <h1 className="auth-card__title">Create your account</h1>
          <p className="auth-card__sub">Students and recruiters register here. Administrator accounts are created by the placement cell.</p>

          <div className="segmented" role="tablist" aria-label="Account type">
            <button
              type="button"
              className={`segmented__option ${isStudent ? 'is-active' : ''}`}
              onClick={() => {
                setRole('student');
                setErrors({});
              }}
            >
              <Icon name="graduation" size={15} />
              Student
            </button>
            <button
              type="button"
              className={`segmented__option ${!isStudent ? 'is-active' : ''}`}
              onClick={() => {
                setRole('company');
                setErrors({});
              }}
            >
              <Icon name="building" size={15} />
              Company / Recruiter
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-24" noValidate>
            {serverError ? (
              <div className="auth-error" role="alert">
                <Icon name="alert-circle" size={16} />
                <span>{serverError}</span>
              </div>
            ) : null}

            <div className="form-grid">
              <div className="field field--full">
                <label className="label" htmlFor="name">
                  {isStudent ? 'Full Name' : 'Company Name'}
                </label>
                <input
                  id="name"
                  className={`input ${errors.name ? 'input--error' : ''}`}
                  placeholder={isStudent ? 'e.g. Aarav Sharma' : 'e.g. TechNova Pvt Ltd'}
                  value={isStudent ? studentForm.name : companyForm.name}
                  onChange={(event) => update('name', event.target.value)}
                />
                {errors.name ? <span className="field__error">{errors.name}</span> : null}
              </div>

              {!isStudent ? (
                <div className="field field--full">
                  <label className="label" htmlFor="contactPerson">
                    Contact Person (HR)
                  </label>
                  <input
                    id="contactPerson"
                    className={`input ${errors.contactPerson ? 'input--error' : ''}`}
                    placeholder="e.g. Neha Kulkarni"
                    value={companyForm.contactPerson}
                    onChange={(event) => update('contactPerson', event.target.value)}
                  />
                  {errors.contactPerson ? <span className="field__error">{errors.contactPerson}</span> : null}
                </div>
              ) : null}

              <div className="field">
                <label className="label" htmlFor="email">
                  {isStudent ? 'College Email' : 'Official Email'}
                </label>
                <input
                  id="email"
                  type="email"
                  className={`input ${errors.email ? 'input--error' : ''}`}
                  placeholder={isStudent ? 'you@student.edu' : 'hr@company.com'}
                  value={isStudent ? studentForm.email : companyForm.email}
                  onChange={(event) => update('email', event.target.value)}
                />
                {errors.email ? <span className="field__error">{errors.email}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="phone">
                  Phone
                </label>
                <input
                  id="phone"
                  className={`input ${errors.phone ? 'input--error' : ''}`}
                  placeholder="+91 98765 43210"
                  value={isStudent ? studentForm.phone : companyForm.phone}
                  onChange={(event) => update('phone', event.target.value)}
                />
                {errors.phone ? <span className="field__error">{errors.phone}</span> : null}
              </div>

              {/* ---------------------- student-only academic fields ---------------------- */}
              {isStudent ? (
                <>
                  <div className="field">
                    <label className="label" htmlFor="rollNumber">
                      Roll Number
                    </label>
                    <input
                      id="rollNumber"
                      className={`input ${errors.rollNumber ? 'input--error' : ''}`}
                      placeholder="e.g. 2023CSE0142"
                      value={studentForm.rollNumber}
                      onChange={(event) => update('rollNumber', event.target.value)}
                    />
                    {errors.rollNumber ? <span className="field__error">{errors.rollNumber}</span> : null}
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="branch">
                      Branch
                    </label>
                    <select
                      id="branch"
                      className="select"
                      value={studentForm.branch}
                      onChange={(event) => update('branch', event.target.value)}
                    >
                      {BRANCHES.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="semester">
                      Semester
                    </label>
                    <select
                      id="semester"
                      className="select"
                      value={studentForm.semester}
                      onChange={(event) => update('semester', Number(event.target.value))}
                    >
                      {SEMESTERS.map((semester) => (
                        <option key={semester} value={semester}>
                          Semester {semester}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="cgpa">
                      Current CGPA
                    </label>
                    <input
                      id="cgpa"
                      type="number"
                      step="0.01"
                      min="0"
                      max="10"
                      className={`input ${errors.cgpa ? 'input--error' : ''}`}
                      placeholder="e.g. 8.1"
                      value={studentForm.cgpa}
                      onChange={(event) => update('cgpa', event.target.value)}
                    />
                    {errors.cgpa ? <span className="field__error">{errors.cgpa}</span> : null}
                  </div>

                  <div className="field field--full">
                    <label className="label" htmlFor="university">
                      University / Institute
                    </label>
                    <input
                      id="university"
                      className="input"
                      value={studentForm.university}
                      onChange={(event) => update('university', event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label className="label" htmlFor="industry">
                      Industry
                    </label>
                    <input
                      id="industry"
                      className="input"
                      placeholder="e.g. Product Engineering"
                      value={companyForm.industry}
                      onChange={(event) => update('industry', event.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="location">
                      Head Office Location
                    </label>
                    <input
                      id="location"
                      className="input"
                      placeholder="e.g. Bengaluru, Karnataka"
                      value={companyForm.location}
                      onChange={(event) => update('location', event.target.value)}
                    />
                  </div>

                  <div className="field field--full">
                    <label className="label" htmlFor="website">
                      Website <span className="label__optional">(optional)</span>
                    </label>
                    <input
                      id="website"
                      className="input"
                      placeholder="e.g. technova.io"
                      value={companyForm.website}
                      onChange={(event) => update('website', event.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="field">
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className={`input ${errors.password ? 'input--error' : ''}`}
                  placeholder="At least 6 characters"
                  value={isStudent ? studentForm.password : companyForm.password}
                  onChange={(event) => update('password', event.target.value)}
                />
                {errors.password ? <span className="field__error">{errors.password}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="confirmPassword">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  className={`input ${errors.confirmPassword ? 'input--error' : ''}`}
                  placeholder="Re-enter password"
                  value={isStudent ? studentForm.confirmPassword : companyForm.confirmPassword}
                  onChange={(event) => update('confirmPassword', event.target.value)}
                />
                {errors.confirmPassword ? <span className="field__error">{errors.confirmPassword}</span> : null}
              </div>
            </div>

            <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} icon="user-check">
              {submitting ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          <p className="auth-foot">
            Already registered? <Link to="/login">Login</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
