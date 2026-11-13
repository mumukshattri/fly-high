import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import Button from '../../components/Button';
import Progress from '../../components/Progress';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import {
  ONBOARDING_STEPS,
  DEPARTMENTS,
  DEGREES,
  ACADEMIC_YEARS,
  SEMESTERS,
  WORK_MODES,
  EMPLOYMENT_PREFERENCES,
  ROLE_SUGGESTIONS,
  LOCATION_SUGGESTIONS,
  INDUSTRY_SUGGESTIONS,
  SKILL_SUGGESTIONS,
} from '../../config/constants';
import {
  getMyProfile,
  updateMyProfile,
  uploadResumeFile,
  confirmResumeExtract,
} from '../../services/studentService';
import ResumeExtractReview from '../../components/ResumeExtractReview';

/**
 * pages/student/Onboarding.jsx
 * ===========================================================================
 * THE GUIDED STUDENT ONBOARDING WIZARD
 * ===========================================================================
 * Six steps, each saved to MongoDB as you leave it:
 *
 *   1 personal · 2 academic · 3 skills & experience · 4 preferences
 *   5 resume   · 6 review & finish
 *
 * Two kinds of progress are persisted:
 *   - the SERVER records `onboarding.step`, so a student who closes the tab on
 *     another device resumes at the right step
 *   - a localStorage draft keeps unsaved keystrokes for the current device
 *
 * Nothing here is required to keep an existing account working: the wizard is
 * additive and every step can be revisited later from My Profile.
 */

const DRAFT_PREFIX = 'jnj-onboarding-draft:';

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  university: '',
  rollNumber: '',
  enrollmentNumber: '',

  department: '',
  customDepartment: '',
  degree: '',
  specialization: '',
  currentYear: 0,
  semester: 1,
  cgpa: '',
  backlogs: 0,
  graduationYear: '',
  previousEducation: { level: '', institution: '', board: '', year: '', percentage: '' },

  skills: [],
  programmingLanguages: [],
  frameworks: [],
  databases: [],
  tools: [],
  projects: [],
  experiences: [],
  certifications: [],
  achievements: [],

  preferences: {
    roles: [],
    industries: [],
    locations: [],
    workMode: 'Any',
    employmentType: 'Any',
    expectedSalary: '',
  },
};

function fromProfile(profile) {
  if (!profile) return { ...emptyForm };
  const known = DEPARTMENTS.some((item) => item.label === profile.department);
  return {
    ...emptyForm,
    name: profile.name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    university: profile.university === 'Not specified' ? '' : profile.university || '',
    rollNumber: profile.rollNumber || '',
    enrollmentNumber: profile.enrollmentNumber || '',

    department: known ? profile.department : profile.department ? 'Other' : '',
    customDepartment: known ? '' : profile.department || '',
    degree: profile.degree || '',
    specialization: profile.specialization || '',
    currentYear: profile.currentYear || (profile.semester ? Math.ceil(profile.semester / 2) : 0),
    semester: profile.semester || 1,
    cgpa: profile.cgpa ? String(profile.cgpa) : '',
    backlogs: profile.backlogs ?? 0,
    graduationYear: profile.graduationYear ? String(profile.graduationYear) : '',
    previousEducation: {
      ...emptyForm.previousEducation,
      ...(profile.previousEducation || {}),
    },

    skills: profile.skills || [],
    programmingLanguages: profile.programmingLanguages || [],
    frameworks: profile.frameworks || [],
    databases: profile.databases || [],
    tools: profile.tools || [],
    projects: (profile.projects || []).map((project) => ({
      ...project,
      techStack: (project.techStack || []).join(', '),
    })),
    experiences: profile.experiences || [],
    certifications: profile.certifications || [],
    achievements: profile.achievements || [],

    preferences: { ...emptyForm.preferences, ...(profile.preferences || {}) },
  };
}

/* -------------------------------------------------------------------------- */
/* SMALL EDITORS                                                              */
/* -------------------------------------------------------------------------- */

function ChipEditor({ label, hint, values = [], onChange, placeholder, suggestions = [] }) {
  const [text, setText] = useState('');

  const addValue = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    if (values.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setText('');
      return;
    }
    onChange([...values, value]);
    setText('');
  };

  return (
    <div className="field field--full">
      <span className="label">{label}</span>
      {hint ? <span className="field__hint">{hint}</span> : null}

      <div className="chip-list mt-8">
        {values.length === 0 ? <span className="text-sm muted">Nothing added yet.</span> : null}
        {values.map((value) => (
          <span className="chip" key={value}>
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
      </div>

      <div className="row gap-8 mt-8 wrap">
        <input
          className="input"
          style={{ maxWidth: 260 }}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addValue(text);
            }
          }}
        />
        <Button variant="outline" size="sm" icon="plus" onClick={() => addValue(text)}>
          Add
        </Button>
      </div>

      {suggestions.length > 0 ? (
        <div className="chip-list mt-8">
          {suggestions
            .filter((suggestion) => !values.includes(suggestion))
            .slice(0, 8)
            .map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                className="chip chip--suggest"
                onClick={() => addValue(suggestion)}
              >
                + {suggestion}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function ListEditor({ title, hint, items, onChange, blank, render, addLabel = 'Add' }) {
  const add = () => onChange([...items, { ...blank }]);
  const update = (index, field, value) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };
  const remove = (index) => onChange(items.filter((_, position) => position !== index));

  return (
    <div className="field field--full">
      <div className="row-between wrap gap-8">
        <div>
          <span className="label">{title}</span>
          {hint ? <span className="field__hint">{hint}</span> : null}
        </div>
        <Button variant="outline" size="sm" icon="plus" onClick={add}>
          {addLabel}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm muted mt-8">Nothing added yet.</p>
      ) : (
        <div className="col gap-12 mt-12">
          {items.map((item, index) => (
            <div className="repeat-block" key={index}>
              <div className="row-between">
                <span className="text-xs strong uppercase">{title} {index + 1}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${title} ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              <div className="form-grid mt-8">
                {render(item, (field, value) => update(index, field, value))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* THE WIZARD                                                                 */
/* -------------------------------------------------------------------------- */

export default function Onboarding() {
  const { user } = useAuth();
  const { refresh } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState(null);
  const [profile, setProfile] = useState(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [resumeInfo, setResumeInfo] = useState(null);
  const [extract, setExtract] = useState(null);
  const [finished, setFinished] = useState(false);
  const fileRef = useRef(null);

  const draftKey = user ? `${DRAFT_PREFIX}${user.id}` : null;

  /* ------------------------------- load ---------------------------------- */
  useEffect(() => {
    let cancelled = false;

    getMyProfile()
      .then(({ profile: loaded }) => {
        if (cancelled) return;
        const next = fromProfile(loaded);
        setProfile(loaded);

        // A device-local draft wins only when it belongs to the same account.
        let restored = null;
        try {
          const raw = draftKey ? localStorage.getItem(draftKey) : null;
          if (raw) restored = JSON.parse(raw);
        } catch {
          restored = null;
        }

        setForm(restored && restored.form ? { ...next, ...restored.form } : next);
        setStep(
          Number.isInteger(restored?.step)
            ? restored.step
            : Math.min(loaded.onboarding?.step || 0, ONBOARDING_STEPS.length - 1),
        );
        setResumeInfo(loaded.resume || null);
        setExtract(loaded.resumeExtract || null);
        setFinished(Boolean(loaded.onboarding?.completed));
      })
      .catch((error) => showToast(error.message, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draftKey, showToast]);

  /* --------------------------- draft persistence -------------------------- */
  useEffect(() => {
    if (!form || !draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ form, step, savedAt: Date.now() }));
    } catch {
      /* a full/blocked localStorage must never break the wizard */
    }
  }, [form, step, draftKey]);

  const update = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const updatePreferences = (field, value) => {
    setForm((current) => ({
      ...current,
      preferences: { ...current.preferences, [field]: value },
    }));
  };

  const resolvedDepartment =
    form?.department === 'Other' ? form.customDepartment.trim() : form?.department || '';

  const completion = useMemo(() => {
    if (!form) return 0;
    // A light client-side estimate for the step rail; the authoritative number
    // always comes from the server (GET /students/me/profile-completion).
    const checks = [
      Boolean(form.name && form.email && form.phone && form.university),
      Boolean(resolvedDepartment && form.degree && form.cgpa !== '' && form.graduationYear),
      form.skills.length >= 3,
      form.projects.length + form.experiences.length > 0,
      form.preferences.roles.length > 0 && form.preferences.locations.length > 0,
      Boolean(resumeInfo?.fileName),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form, resolvedDepartment, resumeInfo]);

  if (loading || !form) return <LoadingState text="Loading your onboarding wizard..." />;

  /* ------------------------------ validation ----------------------------- */
  const validateStep = (index) => {
    const next = {};

    if (index === 0) {
      if (!form.name.trim()) next.name = 'Full name is required.';
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'A valid email is required.';
      if (!form.phone.trim()) next.phone = 'Phone number is required.';
      if (!form.university.trim()) next.university = 'University / institution is required.';
    }

    if (index === 1) {
      if (!resolvedDepartment.trim()) next.department = 'Choose your department.';
      if (!form.degree) next.degree = 'Choose your degree / programme.';
      if (form.cgpa === '' || Number(form.cgpa) < 0 || Number(form.cgpa) > 10) {
        next.cgpa = 'CGPA must be between 0 and 10.';
      }
      const year = Number(form.graduationYear);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        next.graduationYear = 'Enter a valid graduation year.';
      }
      if (Number(form.backlogs) < 0 || Number(form.backlogs) > 50) {
        next.backlogs = 'Backlogs must be between 0 and 50.';
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /* -------------------------------- saving -------------------------------- */
  const payloadFor = (index) => {
    if (index === 0) {
      return {
        name: form.name,
        email: form.email,
        phone: form.phone,
        university: form.university,
        rollNumber: form.rollNumber,
        enrollmentNumber: form.enrollmentNumber,
      };
    }
    if (index === 1) {
      return {
        department: resolvedDepartment,
        degree: form.degree,
        specialization: form.specialization,
        currentYear: Number(form.currentYear) || 0,
        semester: Number(form.semester) || 1,
        cgpa: Number(form.cgpa),
        backlogs: Number(form.backlogs) || 0,
        graduationYear: Number(form.graduationYear),
        previousEducation: form.previousEducation,
      };
    }
    if (index === 2) {
      return {
        skills: form.skills,
        programmingLanguages: form.programmingLanguages,
        frameworks: form.frameworks,
        databases: form.databases,
        tools: form.tools,
        projects: form.projects.map((project) => ({
          title: project.title,
          description: project.description,
          techStack: String(project.techStack || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        })),
        experiences: form.experiences,
        certifications: form.certifications,
        achievements: form.achievements,
      };
    }
    if (index === 3) {
      return { preferences: form.preferences };
    }
    return {};
  };

  const saveStep = async (index, { nextStep } = {}) => {
    if (!validateStep(index)) {
      showToast('Please fix the highlighted fields before continuing.', 'error');
      return false;
    }

    setSaving(true);
    try {
      const result = await updateMyProfile({
        ...payloadFor(index),
        onboarding: { step: nextStep ?? Math.min(index + 1, ONBOARDING_STEPS.length - 1) },
      });

      setProfile(result.profile);
      setResumeInfo(result.profile.resume || null);
      await refresh({ silent: true });

      if (nextStep !== undefined) setStep(nextStep);
      return true;
    } catch (error) {
      showToast(error.message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    const next = Math.min(step + 1, ONBOARDING_STEPS.length - 1);
    await saveStep(step, { nextStep: next });
  };

  const goBack = () => setStep((current) => Math.max(0, current - 1));

  const finish = async () => {
    setSaving(true);
    try {
      const result = await updateMyProfile({
        onboarding: { step: ONBOARDING_STEPS.length, completed: true },
      });
      setProfile(result.profile);
      await refresh({ silent: true });
      if (draftKey) localStorage.removeItem(draftKey);
      showToast('Profile saved. Your recommendations will now use it.', 'success');
      navigate('/student/dashboard');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Copy the fields the server filled from the resume into this form. */
  const applyServerFills = (nextProfile, applied) => {
    if (!applied) return;
    const next = fromProfile(nextProfile);
    setForm((current) => {
      const merged = { ...current };
      for (const field of applied.fields || []) {
        if (field === 'department') {
          merged.department = next.department;
          merged.customDepartment = next.customDepartment;
        } else {
          merged[field] = next[field];
        }
      }
      if ((applied.skills || []).length) merged.skills = next.skills;
      if ((applied.projectTitles || []).length) merged.projects = next.projects;
      if ((applied.experienceKeys || []).length) merged.experiences = next.experiences;
      if ((applied.certificationNames || []).length) merged.certifications = next.certifications;
      return merged;
    });
  };

  const uploadResume = async (file) => {
    if (!file) return;
    setSaving(true);
    try {
      const result = await uploadResumeFile(file);
      setResumeInfo(result.resume);
      setExtract(result.extraction?.extract || null);

      // The server already filled the blank profile fields; mirror that here so
      // the rest of the wizard (and the review step) shows the real values.
      const refreshed = await getMyProfile();
      setProfile(refreshed.profile);
      applyServerFills(refreshed.profile, result.extraction?.extract?.applied);
      await refresh({ silent: true });

      const filled = result.extraction?.extract?.applied?.fields?.length || 0;
      showToast(
        result.extraction?.hasText
          ? `Resume read. ${filled} profile field${filled === 1 ? '' : 's'} filled automatically - review them below.`
          : 'Resume uploaded. No text could be read from it - see the note below.',
        result.extraction?.hasText ? 'success' : 'warning',
      );
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyReviewedExtract = async (payload) => {
    setSaving(true);
    try {
      const result = await confirmResumeExtract(payload);
      const next = fromProfile(result.profile);
      setProfile(result.profile);
      setForm((current) => ({
        ...current,
        degree: next.degree,
        department: next.department,
        customDepartment: next.customDepartment,
        university: next.university,
        cgpa: next.cgpa,
        graduationYear: next.graduationYear,
        backlogs: next.backlogs,
        skills: next.skills,
        projects: next.projects,
        experiences: next.experiences,
        certifications: next.certifications,
      }));
      setExtract(result.profile.resumeExtract || null);
      await refresh({ silent: true });
      showToast('Reviewed details saved to your profile.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------------- view --------------------------------- */
  const stepMeta = ONBOARDING_STEPS[step];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{finished ? 'Update your profile' : 'Complete your profile'}</h1>
          <p className="page-header__sub">
            {finished
              ? 'Your profile is already saved. Change anything and save again.'
              : 'Six short steps. Everything is saved as you go, so you can stop and come back.'}
          </p>
        </div>
        <div className="row gap-8 wrap">
          <span className="badge badge--info">{completion}% ready</span>
          {finished ? (
            <Button variant="ghost" iconRight="chevron-right" onClick={() => navigate('/student/dashboard')}>
              Dashboard
            </Button>
          ) : null}
        </div>
      </header>

      <div className="wizard">
        {/* ------------------------------ step rail ------------------------------ */}
        <aside className="card card--pad wizard__rail">
          <div className="wizard__progress">
            <span className="text-xs muted">
              Step {step + 1} of {ONBOARDING_STEPS.length}
            </span>
            <Progress value={((step + 1) / ONBOARDING_STEPS.length) * 100} small />
          </div>

          <ol className="wizard-steps">
            {ONBOARDING_STEPS.map((item, index) => (
              <li
                key={item.key}
                className={`wizard-step ${index === step ? 'is-current' : ''} ${
                  index < step ? 'is-done' : ''
                }`}
              >
                <button type="button" onClick={() => setStep(index)}>
                  <span className="wizard-step__dot">
                    {index < step ? <Icon name="check" size={12} /> : index + 1}
                  </span>
                  <span>
                    <span className="wizard-step__title">{item.title}</span>
                    <span className="wizard-step__hint">{item.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <p className="text-xs soft mt-16">
            Self-declared information. Your college has not verified these details; only a
            registrar feed could do that, and this portal does not have one.
          </p>
        </aside>

        {/* ------------------------------ step body ----------------------------- */}
        <section className="card card--pad wizard__body">
          <div className="wizard__body-head">
            <span className="badge badge--info">Step {step + 1}</span>
            <h2 className="section__title">{stepMeta.title}</h2>
            <p className="section__hint">{stepMeta.hint}</p>
          </div>

          {/* 1. personal */}
          {step === 0 ? (
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="ob-name">Full name</label>
                <input
                  id="ob-name"
                  className={`input ${errors.name ? 'input--error' : ''}`}
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                />
                {errors.name ? <span className="field__error">{errors.name}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-email">Email address</label>
                <input
                  id="ob-email"
                  type="email"
                  className={`input ${errors.email ? 'input--error' : ''}`}
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                />
                {errors.email ? <span className="field__error">{errors.email}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-phone">Phone number</label>
                <input
                  id="ob-phone"
                  className={`input ${errors.phone ? 'input--error' : ''}`}
                  value={form.phone}
                  placeholder="+91 98765 43210"
                  onChange={(event) => update('phone', event.target.value)}
                />
                {errors.phone ? <span className="field__error">{errors.phone}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-university">University / institution</label>
                <input
                  id="ob-university"
                  className={`input ${errors.university ? 'input--error' : ''}`}
                  value={form.university}
                  onChange={(event) => update('university', event.target.value)}
                />
                {errors.university ? <span className="field__error">{errors.university}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-roll">
                  Student registration / roll number <span className="label__optional">(if applicable)</span>
                </label>
                <input
                  id="ob-roll"
                  className="input"
                  value={form.rollNumber}
                  onChange={(event) => update('rollNumber', event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-enrollment">
                  Enrollment number <span className="label__optional">(optional)</span>
                </label>
                <input
                  id="ob-enrollment"
                  className="input"
                  value={form.enrollmentNumber}
                  onChange={(event) => update('enrollmentNumber', event.target.value)}
                />
              </div>
            </div>
          ) : null}

          {/* 2. academic */}
          {step === 1 ? (
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="ob-department">Department</label>
                <select
                  id="ob-department"
                  className={`select ${errors.department ? 'input--error' : ''}`}
                  value={form.department}
                  onChange={(event) => update('department', event.target.value)}
                >
                  <option value="">Select a department</option>
                  {DEPARTMENTS.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {errors.department ? <span className="field__error">{errors.department}</span> : null}
              </div>

              {form.department === 'Other' ? (
                <div className="field">
                  <label className="label" htmlFor="ob-custom-department">Your department</label>
                  <input
                    id="ob-custom-department"
                    className="input"
                    value={form.customDepartment}
                    onChange={(event) => update('customDepartment', event.target.value)}
                    placeholder="e.g. Aerospace Engineering"
                  />
                </div>
              ) : null}

              <div className="field">
                <label className="label" htmlFor="ob-degree">Degree / programme</label>
                <select
                  id="ob-degree"
                  className={`select ${errors.degree ? 'input--error' : ''}`}
                  value={form.degree}
                  onChange={(event) => update('degree', event.target.value)}
                >
                  <option value="">Select a degree</option>
                  {DEGREES.map((degree) => (
                    <option key={degree} value={degree}>
                      {degree}
                    </option>
                  ))}
                </select>
                {errors.degree ? <span className="field__error">{errors.degree}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-specialization">
                  Specialization <span className="label__optional">(optional)</span>
                </label>
                <input
                  id="ob-specialization"
                  className="input"
                  value={form.specialization}
                  placeholder="e.g. Artificial Intelligence"
                  onChange={(event) => update('specialization', event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-year">Current academic year</label>
                <select
                  id="ob-year"
                  className="select"
                  value={form.currentYear}
                  onChange={(event) => update('currentYear', Number(event.target.value))}
                >
                  <option value={0}>Not specified</option>
                  {ACADEMIC_YEARS.map((year) => (
                    <option key={year} value={year}>
                      Year {year}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-semester">Semester</label>
                <select
                  id="ob-semester"
                  className="select"
                  value={form.semester}
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
                <label className="label" htmlFor="ob-cgpa">Current CGPA</label>
                <input
                  id="ob-cgpa"
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  className={`input ${errors.cgpa ? 'input--error' : ''}`}
                  value={form.cgpa}
                  onChange={(event) => update('cgpa', event.target.value)}
                />
                {errors.cgpa ? <span className="field__error">{errors.cgpa}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-backlogs">Active backlogs</label>
                <input
                  id="ob-backlogs"
                  type="number"
                  min="0"
                  max="50"
                  className={`input ${errors.backlogs ? 'input--error' : ''}`}
                  value={form.backlogs}
                  onChange={(event) => update('backlogs', event.target.value)}
                />
                {errors.backlogs ? <span className="field__error">{errors.backlogs}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-graduation">Graduation year</label>
                <input
                  id="ob-graduation"
                  type="number"
                  min="2000"
                  max="2100"
                  className={`input ${errors.graduationYear ? 'input--error' : ''}`}
                  value={form.graduationYear}
                  onChange={(event) => update('graduationYear', event.target.value)}
                />
                {errors.graduationYear ? (
                  <span className="field__error">{errors.graduationYear}</span>
                ) : null}
              </div>

              <div className="field field--full">
                <span className="label">Previous education <span className="label__optional">(optional)</span></span>
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-prev-level">Level</label>
                <input
                  id="ob-prev-level"
                  className="input"
                  value={form.previousEducation.level}
                  placeholder="Class XII"
                  onChange={(event) =>
                    update('previousEducation', { ...form.previousEducation, level: event.target.value })
                  }
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-prev-institution">Institution</label>
                <input
                  id="ob-prev-institution"
                  className="input"
                  value={form.previousEducation.institution}
                  onChange={(event) =>
                    update('previousEducation', {
                      ...form.previousEducation,
                      institution: event.target.value,
                    })
                  }
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-prev-year">Year</label>
                <input
                  id="ob-prev-year"
                  className="input"
                  value={form.previousEducation.year}
                  onChange={(event) =>
                    update('previousEducation', { ...form.previousEducation, year: event.target.value })
                  }
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-prev-percentage">Percentage</label>
                <input
                  id="ob-prev-percentage"
                  className="input"
                  value={form.previousEducation.percentage}
                  onChange={(event) =>
                    update('previousEducation', {
                      ...form.previousEducation,
                      percentage: event.target.value,
                    })
                  }
                />
              </div>
            </div>
          ) : null}

          {/* 3. professional */}
          {step === 2 ? (
            <div className="form-grid">
              <ChipEditor
                label="Technical skills"
                hint="The single most important field for matching."
                values={form.skills}
                onChange={(value) => update('skills', value)}
                placeholder="e.g. Data Structures"
                suggestions={SKILL_SUGGESTIONS}
              />
              <ChipEditor
                label="Programming languages"
                values={form.programmingLanguages}
                onChange={(value) => update('programmingLanguages', value)}
                placeholder="e.g. Python"
                suggestions={['Python', 'Java', 'C++', 'JavaScript', 'SQL']}
              />
              <ChipEditor
                label="Frameworks & libraries"
                values={form.frameworks}
                onChange={(value) => update('frameworks', value)}
                placeholder="e.g. React"
                suggestions={['React', 'Node.js', 'Spring Boot', 'Django', 'Flask']}
              />
              <ChipEditor
                label="Databases"
                values={form.databases}
                onChange={(value) => update('databases', value)}
                placeholder="e.g. MongoDB"
                suggestions={['MySQL', 'MongoDB', 'PostgreSQL', 'Redis']}
              />
              <ChipEditor
                label="Tools & technologies"
                values={form.tools}
                onChange={(value) => update('tools', value)}
                placeholder="e.g. Docker"
                suggestions={['Git', 'Docker', 'AWS', 'Linux', 'Jira']}
              />

              <ListEditor
                title="Projects"
                hint="Add the projects you can talk about in an interview."
                items={form.projects}
                onChange={(value) => update('projects', value)}
                blank={{ title: '', description: '', techStack: '' }}
                addLabel="Add project"
                render={(item, set) => (
                  <>
                    <div className="field field--full">
                      <label className="label">Title</label>
                      <input
                        className="input"
                        value={item.title}
                        onChange={(event) => set('title', event.target.value)}
                        placeholder="e.g. Campus Lost & Found"
                      />
                    </div>
                    <div className="field field--full">
                      <label className="label">Description</label>
                      <textarea
                        className="textarea"
                        value={item.description}
                        onChange={(event) => set('description', event.target.value)}
                        placeholder="What it does, what you built, what changed because of it."
                      />
                    </div>
                    <div className="field field--full">
                      <label className="label">Technologies (comma separated)</label>
                      <input
                        className="input"
                        value={item.techStack}
                        onChange={(event) => set('techStack', event.target.value)}
                        placeholder="React, Node.js, MongoDB"
                      />
                    </div>
                  </>
                )}
              />

              <ListEditor
                title="Internships / work experience"
                items={form.experiences}
                onChange={(value) => update('experiences', value)}
                blank={{ type: 'Internship', role: '', company: '', description: '' }}
                addLabel="Add experience"
                render={(item, set) => (
                  <>
                    <div className="field">
                      <label className="label">Type</label>
                      <select
                        className="select"
                        value={item.type}
                        onChange={(event) => set('type', event.target.value)}
                      >
                        <option value="Internship">Internship</option>
                        <option value="Work">Work</option>
                      </select>
                    </div>
                    <div className="field">
                      <label className="label">Role</label>
                      <input
                        className="input"
                        value={item.role}
                        onChange={(event) => set('role', event.target.value)}
                        placeholder="Backend Intern"
                      />
                    </div>
                    <div className="field">
                      <label className="label">Company</label>
                      <input
                        className="input"
                        value={item.company}
                        onChange={(event) => set('company', event.target.value)}
                      />
                    </div>
                    <div className="field field--full">
                      <label className="label">What you did</label>
                      <textarea
                        className="textarea"
                        value={item.description}
                        onChange={(event) => set('description', event.target.value)}
                      />
                    </div>
                  </>
                )}
              />

              <ListEditor
                title="Certifications"
                items={form.certifications}
                onChange={(value) => update('certifications', value)}
                blank={{ name: '', issuer: '', year: '' }}
                addLabel="Add certification"
                render={(item, set) => (
                  <>
                    <div className="field">
                      <label className="label">Name</label>
                      <input
                        className="input"
                        value={item.name}
                        onChange={(event) => set('name', event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label className="label">Issuer</label>
                      <input
                        className="input"
                        value={item.issuer}
                        onChange={(event) => set('issuer', event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label className="label">Year</label>
                      <input
                        className="input"
                        value={item.year}
                        onChange={(event) => set('year', event.target.value)}
                      />
                    </div>
                  </>
                )}
              />

              <ChipEditor
                label="Achievements"
                values={form.achievements}
                onChange={(value) => update('achievements', value)}
                placeholder="e.g. Winner, internal hackathon"
              />
            </div>
          ) : null}

          {/* 4. preferences */}
          {step === 3 ? (
            <div className="form-grid">
              <ChipEditor
                label="Preferred job roles"
                hint="Used word-for-word when searching live vacancies."
                values={form.preferences.roles}
                onChange={(value) => updatePreferences('roles', value)}
                placeholder="e.g. Backend Developer"
                suggestions={ROLE_SUGGESTIONS}
              />
              <ChipEditor
                label="Preferred industries"
                values={form.preferences.industries}
                onChange={(value) => updatePreferences('industries', value)}
                placeholder="e.g. Product Engineering"
                suggestions={INDUSTRY_SUGGESTIONS}
              />
              <ChipEditor
                label="Preferred locations"
                values={form.preferences.locations}
                onChange={(value) => updatePreferences('locations', value)}
                placeholder="e.g. Pune"
                suggestions={LOCATION_SUGGESTIONS}
              />

              <div className="field">
                <label className="label" htmlFor="ob-workmode">Work mode</label>
                <select
                  id="ob-workmode"
                  className="select"
                  value={form.preferences.workMode}
                  onChange={(event) => updatePreferences('workMode', event.target.value)}
                >
                  {WORK_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-employment">Internship or full time?</label>
                <select
                  id="ob-employment"
                  className="select"
                  value={form.preferences.employmentType}
                  onChange={(event) => updatePreferences('employmentType', event.target.value)}
                >
                  {EMPLOYMENT_PREFERENCES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="ob-salary">
                  Expected salary <span className="label__optional">(optional)</span>
                </label>
                <input
                  id="ob-salary"
                  className="input"
                  value={form.preferences.expectedSalary}
                  placeholder="e.g. 8-12 LPA"
                  onChange={(event) => updatePreferences('expectedSalary', event.target.value)}
                />
                <span className="field__hint">
                  Only shown on your profile. It is never sent to the job provider.
                </span>
              </div>
            </div>
          ) : null}

          {/* 5. resume */}
          {step === 4 ? (
            <div className="col gap-16">
              <div className="inline-note">
                <Icon name="shield" size={16} />
                <div>
                  <strong>Your resume stays private.</strong> It is stored outside the public web
                  root and only you and the placement cell can download it. Recruiters never get
                  unrestricted access.
                </div>
              </div>

              {resumeInfo ? (
                <div className="resume-box">
                  <span className="resume-box__icon">
                    <Icon name="file" size={20} />
                  </span>
                  <div className="grow" style={{ minWidth: 160 }}>
                    <div className="resume-box__name">{resumeInfo.fileName}</div>
                    <div className="resume-box__meta">
                      {resumeInfo.size} · uploaded on {resumeInfo.uploadedOn} ·{' '}
                      {resumeInfo.hasText ? 'text read successfully' : 'no readable text'}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                    Replace
                  </Button>
                </div>
              ) : (
                <div className="upload-drop">
                  <Icon name="upload" size={22} />
                  <div className="strong">Upload your resume</div>
                  <p className="text-sm muted">
                    PDF or DOCX, up to 5 MB. Text-based PDFs are read automatically; scanned
                    images cannot be read without OCR.
                  </p>
                  <Button variant="primary" icon="upload" loading={saving} onClick={() => fileRef.current?.click()}>
                    Choose a file
                  </Button>
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: 'none' }}
                onChange={(event) => uploadResume(event.target.files?.[0])}
              />

              {extract ? (
                <ResumeExtractReview
                  extract={extract}
                  applying={saving}
                  onApply={applyReviewedExtract}
                />
              ) : null}

              <p className="text-sm muted">
                You can finish onboarding without a resume and upload it later from My Profile.
              </p>
            </div>
          ) : null}

          {/* 6. review */}
          {step === 5 ? (
            <div className="col gap-16">
              <div className="detail-list">
                <div className="detail-list__item">
                  <div className="detail-list__label">Name</div>
                  <div className="detail-list__value">{form.name}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Email</div>
                  <div className="detail-list__value">{form.email}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Phone</div>
                  <div className="detail-list__value">{form.phone || '—'}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">University</div>
                  <div className="detail-list__value">{form.university || '—'}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Department</div>
                  <div className="detail-list__value">{resolvedDepartment || '—'}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Degree</div>
                  <div className="detail-list__value">{form.degree || '—'}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">CGPA</div>
                  <div className="detail-list__value">{form.cgpa || '—'}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Graduation</div>
                  <div className="detail-list__value">{form.graduationYear || '—'}</div>
                </div>
              </div>

              <div>
                <div className="label">Skills</div>
                <div className="chip-list mt-8">
                  {form.skills.length === 0 ? (
                    <span className="text-sm muted">None added.</span>
                  ) : (
                    form.skills.map((skill) => (
                      <span className="chip" key={skill}>
                        {skill}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="detail-list">
                <div className="detail-list__item">
                  <div className="detail-list__label">Preferred roles</div>
                  <div className="detail-list__value">
                    {form.preferences.roles.join(', ') || '—'}
                  </div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Preferred locations</div>
                  <div className="detail-list__value">
                    {form.preferences.locations.join(', ') || '—'}
                  </div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Work mode</div>
                  <div className="detail-list__value">{form.preferences.workMode}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Employment</div>
                  <div className="detail-list__value">{form.preferences.employmentType}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Resume</div>
                  <div className="detail-list__value">{resumeInfo?.fileName || 'Not uploaded yet'}</div>
                </div>
              </div>

              <div className="inline-note inline-note--warning">
                <Icon name="alert-triangle" size={16} />
                <div>
                  These details are <strong>self-declared</strong>. Your college has not verified
                  them. Keep them accurate: they decide which campus drives you are eligible for.
                </div>
              </div>

              <div className="row gap-8 wrap">
                <Button variant="ghost" icon="edit" onClick={() => setStep(0)}>
                  Edit my answers
                </Button>
                <Button variant="primary" icon="check" loading={saving} onClick={finish}>
                  Save &amp; finish
                </Button>
              </div>
            </div>
          ) : null}

          {/* ------------------------------ footer ------------------------------ */}
          <div className="wizard__footer">
            <Button
              variant="ghost"
              icon="arrow-left"
              onClick={goBack}
              disabled={step === 0 || saving}
            >
              Back
            </Button>

            <div className="row gap-8 wrap">
              {step === 4 ? (
                <Button variant="ghost" onClick={() => setStep(5)} disabled={saving}>
                  Skip for now
                </Button>
              ) : null}

              {step < ONBOARDING_STEPS.length - 1 ? (
                <Button variant="primary" iconRight="chevron-right" loading={saving} onClick={goNext}>
                  Save &amp; continue
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {profile ? null : null}
    </>
  );
}
