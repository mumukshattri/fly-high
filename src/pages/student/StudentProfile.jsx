import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import Button from '../../components/Button';
import Avatar from '../../components/Avatar';
import Progress from '../../components/Progress';
import LoadingState from '../../components/LoadingState';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { getProfileCompletion } from '../../utils/profileCompletion';
import { formatDate } from '../../utils/format';
import {
  DEPARTMENTS,
  DEGREES,
  ACADEMIC_YEARS,
  SEMESTERS,
  WORK_MODES,
  EMPLOYMENT_PREFERENCES,
  SKILL_GROUPS,
  ROLE_SUGGESTIONS,
  LOCATION_SUGGESTIONS,
} from '../../config/constants';
import {
  getMyProfile,
  updateMyProfile,
  getMyResume,
  uploadResumeFile,
  deleteMyResume,
  confirmResumeExtract,
  RESUME_DOWNLOAD_URL,
} from '../../services/studentService';

/**
 * pages/student/StudentProfile.jsx
 * ===========================================================================
 * THE STUDENT'S OWN PROFILE
 * ===========================================================================
 * Everything here is real and persisted:
 *
 *   - personal + academic details  -> PATCH /api/students/me/profile
 *   - skills, projects, experience -> the same endpoint, one section at a time
 *   - career preferences           -> the same endpoint
 *   - resume upload / replace /    -> /api/students/me/resume (+ /file, DELETE)
 *     delete / download
 *   - extracted resume review      -> /api/students/me/resume/confirm
 *
 * Extraction is shown as a PROPOSAL. The student ticks what they want and
 * nothing is written to the profile until they confirm, so a badly formatted
 * CV can never damage a profile they already typed.
 */

function ChipEditor({ label, values = [], onChange, placeholder, saving }) {
  const [text, setText] = useState('');

  const add = () => {
    const value = text.trim();
    if (!value) return;
    if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
    setText('');
  };

  return (
    <div>
      <div className="label">{label}</div>
      <div className="chip-list mt-8">
        {values.length === 0 ? <span className="text-sm muted">None added.</span> : null}
        {values.map((value) => (
          <span className="chip" key={value}>
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              disabled={saving}
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
          style={{ maxWidth: 220 }}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" size="sm" icon="plus" onClick={add} disabled={saving}>
          Add
        </Button>
      </div>
    </div>
  );
}

export default function StudentProfile() {
  const { refresh } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [resumeState, setResumeState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [adding, setAdding] = useState(null); // 'project' | 'experience' | 'certification'
  const [draft, setDraft] = useState({});
  const [selection, setSelection] = useState({ skills: [], education: false, projects: false, experiences: false, certifications: false });
  const fileRef = useRef(null);

  const completion = useMemo(() => getProfileCompletion(profile || {}), [profile]);
  const extract = resumeState?.extraction || null;
  const resume = profile?.resume || null;

  const applyProfile = useCallback((next) => {
    setProfile(next);
    setForm({
      ...next,
      preferences: { ...next.preferences },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileResponse, resumeResponse] = await Promise.all([getMyProfile(), getMyResume()]);
      applyProfile(profileResponse.profile);
      setResumeState(resumeResponse);

      const proposal = resumeResponse.extraction;
      if (proposal) {
        setSelection({
          skills: proposal.skills || [],
          education: Boolean(proposal.education?.degree || proposal.education?.department),
          projects: (proposal.projects || []).length > 0,
          experiences: (proposal.experience || []).length > 0,
          certifications: (proposal.certifications || []).length > 0,
        });
      }
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [applyProfile, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !profile || !form) return <LoadingState text="Loading your profile..." />;

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  /* ------------------------------- saving --------------------------------- */

  const patch = async (payload, message = 'Profile updated.') => {
    setSaving(true);
    try {
      const result = await updateMyProfile(payload);
      applyProfile(result.profile);
      await refresh({ silent: true });
      showToast(message, 'success');
      return true;
    } catch (error) {
      showToast(error.message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Full name is required.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'A valid email is required.';
    if (form.cgpa === '' || Number(form.cgpa) < 0 || Number(form.cgpa) > 10) {
      next.cgpa = 'CGPA must be between 0 and 10.';
    }
    const year = Number(form.graduationYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      next.graduationYear = 'Enter a valid graduation year.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      showToast('Please fix the highlighted fields before saving.', 'error');
      return;
    }

    const ok = await patch({
      name: form.name,
      email: form.email,
      phone: form.phone,
      rollNumber: form.rollNumber,
      enrollmentNumber: form.enrollmentNumber,
      university: form.university,
      about: form.about,
      department: form.department,
      degree: form.degree,
      specialization: form.specialization,
      semester: Number(form.semester),
      currentYear: Number(form.currentYear),
      cgpa: Number(form.cgpa),
      backlogs: Number(form.backlogs),
      graduationYear: Number(form.graduationYear),
      preferences: form.preferences,
    });

    if (ok) setIsEditing(false);
  };

  const cancelEdit = () => {
    setForm({ ...profile, preferences: { ...profile.preferences } });
    setErrors({});
    setIsEditing(false);
  };

  const saveList = (field, values) => patch({ [field]: values }, 'Saved.');

  /* ------------------------------- resume --------------------------------- */

  const handleResumeChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSaving(true);
    try {
      const result = await uploadResumeFile(file);
      setResumeState({ resume: result.resume, extraction: result.extraction?.extract || null });
      await load();
      await refresh({ silent: true });
      showToast(
        result.extraction?.hasText
          ? 'Resume uploaded and read. Review the extracted details below.'
          : 'Resume uploaded, but no text could be read from it. See the note below.',
        result.extraction?.hasText ? 'success' : 'warning',
      );
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDeleteResume = async () => {
    if (!window.confirm('Delete your uploaded resume? You can upload a new one later.')) return;
    setSaving(true);
    try {
      await deleteMyResume();
      setResumeState({ resume: null, extraction: null });
      await load();
      await refresh({ silent: true });
      showToast('Resume deleted.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmExtract = async () => {
    setSaving(true);
    try {
      // Uploading already filled the blank profile fields. Unchecking an item
      // here therefore *rejects* it - the server removes it again, but only
      // while the profile still holds exactly the extracted value.
      const payload = {
        skills: selection.skills,
        rejected: {
          skills: extract.skills.filter((skill) => !selection.skills.includes(skill)),
          projectTitles: selection.projects ? [] : extract.projects.map((project) => project.title),
          experienceKeys: selection.experiences
            ? []
            : extract.experience.map((item) => `${item.role}|${item.company}`),
          certificationNames: selection.certifications
            ? []
            : extract.certifications.map((item) => item.name),
          fields: selection.education
            ? []
            : ['degree', 'department', 'university', 'cgpa', 'graduationYear', 'backlogs'],
        },
      };
      if (selection.education) payload.education = extract.education;
      if (selection.projects) payload.projects = extract.projects;
      if (selection.experiences) payload.experiences = extract.experience;
      if (selection.certifications) payload.certifications = extract.certifications;

      const result = await confirmResumeExtract(payload);
      applyProfile(result.profile);
      setResumeState((current) => ({
        resume: current?.resume || null,
        extraction: current?.extraction
          ? { ...current.extraction, confirmedAt: new Date().toISOString() }
          : null,
      }));
      await refresh({ silent: true });
      showToast('The selected resume details were added to your profile.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleSkill = (skill) => {
    setSelection((current) => ({
      ...current,
      skills: current.skills.includes(skill)
        ? current.skills.filter((item) => item !== skill)
        : [...current.skills, skill],
    }));
  };

  /* ------------------------------ list adders ----------------------------- */

  const openAdd = (type) => {
    setDraft(
      type === 'project'
        ? { title: '', description: '', techStack: '' }
        : type === 'experience'
          ? { type: 'Internship', role: '', company: '', description: '' }
          : { name: '', issuer: '', year: '' },
    );
    setAdding(type);
  };

  const submitAdd = async () => {
    if (adding === 'project') {
      if (!draft.title?.trim()) {
        showToast('A project needs a title.', 'error');
        return;
      }
      await patch(
        {
          projects: [
            ...profile.projects,
            {
              title: draft.title,
              description: draft.description,
              techStack: String(draft.techStack || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            },
          ],
        },
        'Project added.',
      );
    }
    if (adding === 'experience') {
      if (!draft.role?.trim() && !draft.company?.trim()) {
        showToast('Add a role or a company.', 'error');
        return;
      }
      await patch({ experiences: [...profile.experiences, draft] }, 'Experience added.');
    }
    if (adding === 'certification') {
      if (!draft.name?.trim()) {
        showToast('A certification needs a name.', 'error');
        return;
      }
      await patch({ certifications: [...profile.certifications, draft] }, 'Certification added.');
    }
    setAdding(null);
    setDraft({});
  };

  const removeItem = async (type, index) => {
    if (type === 'project') await patch({ projects: profile.projects.filter((_, i) => i !== index) }, 'Project removed.');
    if (type === 'experience') {
      await patch({ experiences: profile.experiences.filter((_, i) => i !== index) }, 'Experience removed.');
    }
    if (type === 'certification') {
      await patch(
        { certifications: profile.certifications.filter((_, i) => i !== index) },
        'Certification removed.',
      );
    }
  };

  return (
    <>
      <PageHeader
        title="My Profile"
        subtitle="These details decide which drives you are eligible for and which jobs you are matched with."
      >
        {isEditing ? (
          <>
            <Button variant="ghost" icon="x" onClick={cancelEdit} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={handleSave} loading={saving}>
              Save Changes
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              icon="sparkles"
              onClick={() => navigate('/student/onboarding')}
            >
              Complete profile
            </Button>
            <Button variant="primary" icon="edit" onClick={() => setIsEditing(true)}>
              Edit Profile
            </Button>
          </>
        )}
      </PageHeader>

      {/* --------------------------------- hero --------------------------------- */}
      <section className="card card--pad mb-24">
        <div className="profile-hero">
          <Avatar name={profile.name} size="lg" />
          <div className="profile-hero__info">
            <div className="profile-hero__name">{profile.name}</div>
            <div className="muted text-sm">
              {profile.rollNumber || profile.enrollmentNumber || 'No roll number'} ·{' '}
              {profile.university || 'No institution'}
            </div>
            <div className="profile-hero__meta">
              <span className="badge badge--info">{profile.branch || 'No branch'}</span>
              <span className="badge badge--neutral">{profile.degree || 'Degree not set'}</span>
              <span className="badge badge--neutral">
                {profile.currentYear ? `Year ${profile.currentYear}` : `Semester ${profile.semester}`}
              </span>
              <span className="badge badge--success">CGPA {profile.cgpa}</span>
              <span
                className="badge badge--warning"
                title="This portal has no registrar integration, so nothing here is university-verified."
              >
                <Icon name="info" size={11} /> Self-declared
              </span>
            </div>
          </div>
          <div className="profile-hero__stat">
            <div className="profile-hero__stat-value">{completion.percent}%</div>
            <div className="profile-hero__stat-label">Profile complete</div>
          </div>
        </div>

        <div className="mt-16">
          <Progress value={completion.percent} />
          <p className="text-xs soft mt-8">
            {completion.missing.length === 0
              ? 'All profile sections are complete.'
              : `Still to add: ${completion.missing.join(', ')}`}
          </p>
        </div>
      </section>

      <div className="grid grid-2">
        {/* ------------------------------- personal ------------------------------ */}
        <section className="card card--pad">
          <div className="card__header" style={{ padding: '0 0 14px', border: 0 }}>
            <div className="row gap-8">
              <Icon name="user" size={17} />
              <div className="card__title">Personal Information</div>
            </div>
            {isEditing ? <span className="badge badge--warning">Editing</span> : null}
          </div>

          {isEditing ? (
            <div className="form-grid">
              <div className="field field--full">
                <label className="label" htmlFor="p-name">Full name</label>
                <input
                  id="p-name"
                  className={`input ${errors.name ? 'input--error' : ''}`}
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                />
                {errors.name ? <span className="field__error">{errors.name}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="p-email">Email</label>
                <input
                  id="p-email"
                  type="email"
                  className={`input ${errors.email ? 'input--error' : ''}`}
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                />
                {errors.email ? <span className="field__error">{errors.email}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="p-phone">Phone</label>
                <input
                  id="p-phone"
                  className="input"
                  value={form.phone}
                  onChange={(event) => update('phone', event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="p-roll">Roll number</label>
                <input
                  id="p-roll"
                  className="input"
                  value={form.rollNumber}
                  onChange={(event) => update('rollNumber', event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="p-university">University</label>
                <input
                  id="p-university"
                  className="input"
                  value={form.university}
                  onChange={(event) => update('university', event.target.value)}
                />
              </div>

              <div className="field field--full">
                <label className="label" htmlFor="p-about">About (shown to recruiters)</label>
                <textarea
                  id="p-about"
                  className="textarea"
                  value={form.about}
                  onChange={(event) => update('about', event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="detail-list">
              <div className="detail-list__item">
                <div className="detail-list__label">Email</div>
                <div className="detail-list__value">{profile.email}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Phone</div>
                <div className="detail-list__value">{profile.phone || '—'}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Roll number</div>
                <div className="detail-list__value">{profile.rollNumber || '—'}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Enrollment</div>
                <div className="detail-list__value">{profile.enrollmentNumber || '—'}</div>
              </div>
              <div className="detail-list__item" style={{ gridColumn: '1 / -1' }}>
                <div className="detail-list__label">About</div>
                <div className="detail-list__value" style={{ fontWeight: 400 }}>
                  {profile.about || 'No summary added yet.'}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------- academic ------------------------------ */}
        <section className="card card--pad">
          <div className="card__header" style={{ padding: '0 0 14px', border: 0 }}>
            <div className="row gap-8">
              <Icon name="graduation" size={17} />
              <div className="card__title">Academic Information</div>
            </div>
          </div>

          {isEditing ? (
            <div className="form-grid">
              <div className="field field--full">
                <label className="label" htmlFor="p-department">Department</label>
                <select
                  id="p-department"
                  className="select"
                  value={form.department}
                  onChange={(event) => update('department', event.target.value)}
                >
                  <option value="">Select a department</option>
                  {DEPARTMENTS.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                  {form.department && !DEPARTMENTS.some((item) => item.label === form.department) ? (
                    <option value={form.department}>{form.department}</option>
                  ) : null}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="p-degree">Degree</label>
                <select
                  id="p-degree"
                  className="select"
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
              </div>

              <div className="field">
                <label className="label" htmlFor="p-specialization">Specialization</label>
                <input
                  id="p-specialization"
                  className="input"
                  value={form.specialization}
                  onChange={(event) => update('specialization', event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="p-year">Current year</label>
                <select
                  id="p-year"
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
                <label className="label" htmlFor="p-semester">Semester</label>
                <select
                  id="p-semester"
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
                <label className="label" htmlFor="p-cgpa">CGPA</label>
                <input
                  id="p-cgpa"
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
                <label className="label" htmlFor="p-backlogs">Active backlogs</label>
                <input
                  id="p-backlogs"
                  type="number"
                  min="0"
                  max="50"
                  className="input"
                  value={form.backlogs}
                  onChange={(event) => update('backlogs', event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="p-graduation">Graduation year</label>
                <input
                  id="p-graduation"
                  type="number"
                  className={`input ${errors.graduationYear ? 'input--error' : ''}`}
                  value={form.graduationYear}
                  onChange={(event) => update('graduationYear', event.target.value)}
                />
                {errors.graduationYear ? (
                  <span className="field__error">{errors.graduationYear}</span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="detail-list">
              <div className="detail-list__item">
                <div className="detail-list__label">Department</div>
                <div className="detail-list__value">{profile.department || profile.branch}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Degree</div>
                <div className="detail-list__value">{profile.degree || '—'}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Specialization</div>
                <div className="detail-list__value">{profile.specialization || '—'}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Semester / year</div>
                <div className="detail-list__value">
                  {profile.currentYear ? `Year ${profile.currentYear}` : `Semester ${profile.semester}`}
                </div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">CGPA</div>
                <div className="detail-list__value">{profile.cgpa}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Active backlogs</div>
                <div className="detail-list__value">{profile.backlogs}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Graduation year</div>
                <div className="detail-list__value">{profile.graduationYear || '—'}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Branch code</div>
                <div className="detail-list__value">{profile.branch}</div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------ skills --------------------------------- */}
      <section className="card card--pad mt-24">
        <div className="row gap-8 mb-16">
          <Icon name="star" size={17} />
          <div className="card__title">Skills &amp; Technologies</div>
          <span className="section__hint">Saved as soon as you add or remove one</span>
        </div>

        <div className="grid grid-2">
          {SKILL_GROUPS.map((group) => (
            <ChipEditor
              key={group.key}
              label={group.label}
              values={profile[group.key] || []}
              placeholder={group.placeholder}
              saving={saving}
              onChange={(values) => saveList(group.key, values)}
            />
          ))}
        </div>

        <p className="text-xs soft mt-12">
          Skills are compared with each vacancy's own text by the matching engine, and with the
          required-skills list of every campus drive by the eligibility engine.
        </p>
      </section>

      {/* --------------------------- projects etc ----------------------------- */}
      <div className="grid grid-2 mt-24">
        <section className="card card--pad">
          <div className="row-between mb-16">
            <div className="row gap-8">
              <Icon name="layers" size={17} />
              <div className="card__title">Projects</div>
            </div>
            <Button variant="outline" size="sm" icon="plus" onClick={() => openAdd('project')}>
              Add
            </Button>
          </div>

          {profile.projects.length === 0 ? (
            <p className="text-sm muted">No projects added yet.</p>
          ) : (
            <div className="col gap-12">
              {profile.projects.map((project, index) => (
                <div className="summary-list__item" key={`${project.title}-${index}`}>
                  <div style={{ minWidth: 0 }}>
                    <div className="strong text-sm">{project.title}</div>
                    {project.description ? (
                      <div className="text-xs muted">{project.description}</div>
                    ) : null}
                    {project.techStack.length ? (
                      <div className="chip-list mt-8">
                        {project.techStack.map((tech) => (
                          <span className="chip chip--neutral" key={tech}>
                            {tech}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${project.title}`}
                    onClick={() => removeItem('project', index)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card card--pad">
          <div className="row-between mb-16">
            <div className="row gap-8">
              <Icon name="briefcase" size={17} />
              <div className="card__title">Internships &amp; Experience</div>
            </div>
            <Button variant="outline" size="sm" icon="plus" onClick={() => openAdd('experience')}>
              Add
            </Button>
          </div>

          {profile.experiences.length === 0 ? (
            <p className="text-sm muted">No internships or work experience added yet.</p>
          ) : (
            <div className="col gap-12">
              {profile.experiences.map((experience, index) => (
                <div className="summary-list__item" key={`${experience.role}-${index}`}>
                  <div>
                    <div className="strong text-sm">{experience.role || experience.company}</div>
                    <div className="text-xs muted">
                      {experience.type} · {experience.company || 'Company not set'}
                    </div>
                    {experience.description ? (
                      <div className="text-xs soft mt-8">{experience.description}</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove experience"
                    onClick={() => removeItem('experience', index)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-2 mt-24">
        <section className="card card--pad">
          <div className="row-between mb-16">
            <div className="row gap-8">
              <Icon name="award" size={17} />
              <div className="card__title">Certifications</div>
            </div>
            <Button variant="outline" size="sm" icon="plus" onClick={() => openAdd('certification')}>
              Add
            </Button>
          </div>

          {profile.certifications.length === 0 ? (
            <p className="text-sm muted">No certifications added yet.</p>
          ) : (
            <div className="col gap-8">
              {profile.certifications.map((certification, index) => (
                <div className="summary-list__item" key={`${certification.name}-${index}`}>
                  <div>
                    <div className="strong text-sm">{certification.name}</div>
                    <div className="text-xs muted">
                      {[certification.issuer, certification.year].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove certification"
                    onClick={() => removeItem('certification', index)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* --------------------------- preferences ---------------------------- */}
        <section className="card card--pad">
          <div className="card__header" style={{ padding: '0 0 14px', border: 0 }}>
            <div className="row gap-8">
              <Icon name="target" size={17} />
              <div className="card__title">Career Preferences</div>
            </div>
            {isEditing ? <span className="badge badge--warning">Editing</span> : null}
          </div>

          {isEditing ? (
            <div className="col gap-12">
              <ChipEditor
                label="Preferred roles"
                values={form.preferences.roles}
                placeholder="e.g. Backend Developer"
                onChange={(values) =>
                  update('preferences', { ...form.preferences, roles: values })
                }
              />
              <ChipEditor
                label="Preferred locations"
                values={form.preferences.locations}
                placeholder="e.g. Pune"
                onChange={(values) =>
                  update('preferences', { ...form.preferences, locations: values })
                }
              />

              <div className="field">
                <label className="label" htmlFor="p-workmode">Work mode</label>
                <select
                  id="p-workmode"
                  className="select"
                  value={form.preferences.workMode}
                  onChange={(event) =>
                    update('preferences', { ...form.preferences, workMode: event.target.value })
                  }
                >
                  {WORK_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="p-employment">Employment type</label>
                <select
                  id="p-employment"
                  className="select"
                  value={form.preferences.employmentType}
                  onChange={(event) =>
                    update('preferences', {
                      ...form.preferences,
                      employmentType: event.target.value,
                    })
                  }
                >
                  {EMPLOYMENT_PREFERENCES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="p-salary">Expected salary</label>
                <input
                  id="p-salary"
                  className="input"
                  value={form.preferences.expectedSalary}
                  onChange={(event) =>
                    update('preferences', {
                      ...form.preferences,
                      expectedSalary: event.target.value,
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="detail-list">
              <div className="detail-list__item" style={{ gridColumn: '1 / -1' }}>
                <div className="detail-list__label">Preferred roles</div>
                <div className="detail-list__value">
                  {profile.preferences.roles.join(', ') || 'Not set'}
                </div>
              </div>
              <div className="detail-list__item" style={{ gridColumn: '1 / -1' }}>
                <div className="detail-list__label">Preferred locations</div>
                <div className="detail-list__value">
                  {profile.preferences.locations.join(', ') || 'Not set'}
                </div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Work mode</div>
                <div className="detail-list__value">{profile.preferences.workMode}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Employment</div>
                <div className="detail-list__value">{profile.preferences.employmentType}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Expected salary</div>
                <div className="detail-list__value">
                  {profile.preferences.expectedSalary || 'Not set'}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------- resume -------------------------------- */}
      <section className="card card--pad mt-24">
        <div className="card__header" style={{ padding: '0 0 14px', border: 0 }}>
          <div className="row gap-8">
            <Icon name="file-text" size={17} />
            <div className="card__title">Resume</div>
          </div>
          {resume ? (
            <span className="badge badge--success">
              {resume.hasText ? 'Uploaded · text read' : 'Uploaded · no text layer'}
            </span>
          ) : (
            <span className="badge badge--neutral">Not uploaded</span>
          )}
        </div>

        {resume ? (
          <div className="resume-box">
            <span className="resume-box__icon">
              <Icon name="file" size={20} />
            </span>
            <div className="grow" style={{ minWidth: 160 }}>
              <div className="resume-box__name">{resume.fileName}</div>
              <div className="resume-box__meta">
                {resume.size} · uploaded on {formatDate(resume.uploadedOn)}
              </div>
            </div>
            <div className="row gap-8 wrap">
              <a
                className="btn btn--outline btn--sm"
                href={RESUME_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="download" size={14} /> Download
              </a>
              <Button variant="outline" size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                Replace
              </Button>
              <Button
                variant="danger-outline"
                size="sm"
                icon="x"
                loading={saving}
                onClick={handleDeleteResume}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="upload-drop">
            <Icon name="upload" size={22} />
            <div className="strong">Upload your resume</div>
            <p className="text-sm muted">
              PDF or DOCX up to 5 MB. Text-based PDFs are read automatically. Scanned images
              cannot be read without OCR - upload a text-readable version instead.
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
          onChange={handleResumeChange}
        />

        {/* ------------------------- extraction review ------------------------- */}
        {extract ? (
          <div className="extract-panel mt-16">
            <div className="row-between wrap gap-8">
              <div className="row gap-8">
                <Icon name="sparkles" size={16} />
                <strong>Review what we read from your resume</strong>
              </div>
              {extract.confirmedAt ? (
                <span className="badge badge--success">
                  Added on {formatDate(extract.confirmedAt.slice(0, 10))}
                </span>
              ) : (
                <span className="badge badge--success">Skills added automatically</span>
              )}
            </div>

            {extract.notes.length ? (
              <ul className="text-xs soft mt-8" style={{ paddingLeft: 18 }}>
                {extract.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-12">
              <div className="label">Skills found in the document - already in your profile</div>
              {extract.applied?.skills?.length ? (
                <p className="text-xs soft mt-4">
                  {extract.applied.skills.length} new{' '}
                  {extract.applied.skills.length === 1 ? 'skill was' : 'skills were'} added to your
                  profile when the resume was read. Click a skill to remove it before applying.
                </p>
              ) : null}
              <div className="chip-list mt-8">
                {extract.skills.length === 0 ? (
                  <span className="text-sm muted">No technologies were recognised.</span>
                ) : (
                  extract.skills.map((skill) => {
                    const selected = selection.skills.includes(skill);
                    return (
                      <button
                        type="button"
                        key={skill}
                        className={`chip ${selected ? 'chip--match' : 'chip--neutral'}`}
                        onClick={() => toggleSkill(skill)}
                        aria-pressed={selected}
                      >
                        {selected ? <Icon name="check" size={11} /> : null}
                        {skill}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="review-grid mt-12">
              {[
                {
                  key: 'education',
                  label: 'Education',
                  summary: [
                    extract.education.degree,
                    extract.education.department,
                    extract.education.cgpa ? `CGPA ${extract.education.cgpa}/10` : '',
                    extract.education.graduationYear
                      ? `Class of ${extract.education.graduationYear}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                },
                {
                  key: 'projects',
                  label: 'Projects',
                  summary: extract.projects.map((project) => project.title).join(', '),
                },
                {
                  key: 'experiences',
                  label: 'Experience',
                  summary: extract.experience
                    .map((item) => [item.role, item.company].filter(Boolean).join(' at '))
                    .join(', '),
                },
                {
                  key: 'certifications',
                  label: 'Certifications',
                  summary: extract.certifications.map((item) => item.name).join(', '),
                },
              ].map((row) => (
                <label className="review-item" key={row.key}>
                  <input
                    type="checkbox"
                    checked={Boolean(selection[row.key])}
                    onChange={(event) =>
                      setSelection((current) => ({ ...current, [row.key]: event.target.checked }))
                    }
                  />
                  <span>
                    <span className="strong text-sm">{row.label}</span>
                    <span className="text-xs muted" style={{ display: 'block' }}>
                      {row.summary || 'Nothing found'}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="row gap-8 wrap mt-12">
              <Button
                variant="primary"
                size="sm"
                icon="check"
                loading={saving}
                disabled={selection.skills.length === 0 && !selection.education && !selection.projects && !selection.experiences && !selection.certifications}
                onClick={confirmExtract}
              >
                Add selected to my profile
              </Button>
              <span className="text-xs soft">
                Skills are added automatically on upload. Unchecking one removes it from your
                profile again and keeps it out of future re-parses; anything you typed yourself is
                kept.
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {/* ------------------------------ add modal ------------------------------ */}
      {adding ? (
        <Modal
          title={
            adding === 'project'
              ? 'Add a project'
              : adding === 'experience'
                ? 'Add an experience'
                : 'Add a certification'
          }
          onClose={() => setAdding(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button variant="primary" icon="check" loading={saving} onClick={submitAdd}>
                Save
              </Button>
            </>
          }
        >
          <div className="form-grid">
            {adding === 'project' ? (
              <>
                <div className="field field--full">
                  <label className="label">Title</label>
                  <input
                    className="input"
                    value={draft.title || ''}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </div>
                <div className="field field--full">
                  <label className="label">Description</label>
                  <textarea
                    className="textarea"
                    value={draft.description || ''}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </div>
                <div className="field field--full">
                  <label className="label">Technologies (comma separated)</label>
                  <input
                    className="input"
                    value={draft.techStack || ''}
                    onChange={(event) => setDraft({ ...draft, techStack: event.target.value })}
                  />
                </div>
              </>
            ) : null}

            {adding === 'experience' ? (
              <>
                <div className="field">
                  <label className="label">Type</label>
                  <select
                    className="select"
                    value={draft.type || 'Internship'}
                    onChange={(event) => setDraft({ ...draft, type: event.target.value })}
                  >
                    <option value="Internship">Internship</option>
                    <option value="Work">Work</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label">Role</label>
                  <input
                    className="input"
                    value={draft.role || ''}
                    onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                  />
                </div>
                <div className="field field--full">
                  <label className="label">Company</label>
                  <input
                    className="input"
                    value={draft.company || ''}
                    onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                  />
                </div>
                <div className="field field--full">
                  <label className="label">What you did</label>
                  <textarea
                    className="textarea"
                    value={draft.description || ''}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </div>
              </>
            ) : null}

            {adding === 'certification' ? (
              <>
                <div className="field field--full">
                  <label className="label">Name</label>
                  <input
                    className="input"
                    value={draft.name || ''}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label">Issuer</label>
                  <input
                    className="input"
                    value={draft.issuer || ''}
                    onChange={(event) => setDraft({ ...draft, issuer: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label">Year</label>
                  <input
                    className="input"
                    value={draft.year || ''}
                    onChange={(event) => setDraft({ ...draft, year: event.target.value })}
                  />
                </div>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {isEditing ? (
        <div className="card card--pad mt-24">
          <div className="row-between wrap gap-12">
            <span className="text-sm muted">
              Unsaved changes live only on this page until you press Save Changes.
            </span>
            <div className="form-actions">
              <Button variant="ghost" icon="x" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" icon="check" onClick={handleSave} loading={saving}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
