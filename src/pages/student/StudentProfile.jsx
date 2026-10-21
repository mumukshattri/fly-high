import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import Button from '../../components/Button';
import Avatar from '../../components/Avatar';
import Progress from '../../components/Progress';
import LoadingState from '../../components/LoadingState';
import PageHeader from '../../components/PageHeader';
import { useCurrentStudent } from '../../hooks/useCurrentStudent';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { getProfileCompletion } from '../../utils/profileCompletion';
import { formatDate } from '../../utils/format';
import { BRANCHES, SEMESTERS } from '../../config/constants';

/**
 * pages/student/StudentProfile.jsx
 * ===========================================================================
 * STUDENT PROFILE - and the "edit / save / cancel" state pattern.
 * ===========================================================================
 * The page has two modes controlled by ONE piece of state:
 *
 *      const [isEditing, setIsEditing] = useState(false);
 *
 *  - isEditing === false  -> read-only panels (how the recruiter sees you)
 *  - isEditing === true   -> the same data inside inputs
 *
 * The form values live in a separate `form` state object ("draft"). This is the
 * standard controlled-form pattern: we never edit the stored student object
 * directly, so pressing Cancel is simply `setIsEditing(false)` and the original
 * data is still intact.
 *
 * Save -> `updateProfile(id, changedFields)` -> DataContext -> service layer
 *      -> POST/PUT /api/students/profile once the backend exists.
 */

export default function StudentProfile() {
  const student = useCurrentStudent();
  const { loading, saving, updateProfile, uploadResume } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [newSkill, setNewSkill] = useState('');
  const fileInputRef = useRef(null);

  // Build the draft form from the stored student whenever we enter edit mode.
  useEffect(() => {
    if (student) setForm({ ...student });
  }, [student, isEditing]);

  const completion = useMemo(() => getProfileCompletion(student), [student]);

  if (loading || !student || !form) return <LoadingState text="Loading your profile..." />;

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const validate = () => {
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Full name is required.';
    if (!form.email.trim()) nextErrors.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!form.phone.trim()) nextErrors.phone = 'Phone number is required.';
    if (!form.rollNumber.trim()) nextErrors.rollNumber = 'Roll number is required.';
    if (form.cgpa === '' || Number(form.cgpa) < 0 || Number(form.cgpa) > 10)
      nextErrors.cgpa = 'CGPA must be between 0 and 10.';

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      showToast('Please fix the highlighted fields before saving.', 'error');
      return;
    }

    try {
      await updateProfile(student.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone,
        rollNumber: form.rollNumber,
        university: form.university,
        branch: form.branch,
        semester: Number(form.semester),
        cgpa: Number(form.cgpa),
        graduationYear: Number(form.graduationYear),
        skills: form.skills,
        about: form.about,
      });
      setIsEditing(false);
      showToast('Profile updated successfully.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const handleCancel = () => {
    setForm({ ...student }); // drop the draft
    setErrors({});
    setIsEditing(false);
  };

  /** Adds a skill chip if it is not already present. */
  const addSkill = () => {
    const skill = newSkill.trim();
    if (!skill) return;
    const exists = form.skills.some((item) => item.toLowerCase() === skill.toLowerCase());
    if (exists) {
      showToast(`"${skill}" is already in your skills.`, 'warning');
      return;
    }
    update('skills', [...form.skills, skill]);
    setNewSkill('');
  };

  const removeSkill = (skill) => update('skills', form.skills.filter((item) => item !== skill));

  /**
   * Resume upload. We only store the file METADATA in the demo, because a real
   * upload needs multipart/form-data handled by multer on the Express server.
   */
  const handleResumeChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024; // 5 MB, same limit a backend would enforce
    if (file.size > maxSize) {
      showToast('Resume must be smaller than 5 MB.', 'error');
      return;
    }

    try {
      await uploadResume(student.id, {
        fileName: file.name,
        size: `${Math.round(file.size / 1024)} KB`,
      });
      showToast('Resume uploaded successfully.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      // Allow re-selecting the same file later.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadResume = () => {
    showToast('File download will work once the backend stores the uploaded file.', 'info');
  };

  return (
    <>
      <PageHeader
        title="My Profile"
        subtitle="These details decide which drives you are eligible for, so keep them accurate."
      >
        {isEditing ? (
          <>
            <Button variant="ghost" icon="x" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={handleSave} loading={saving}>
              Save Changes
            </Button>
          </>
        ) : (
          <Button variant="primary" icon="edit" onClick={() => setIsEditing(true)}>
            Edit Profile
          </Button>
        )}
      </PageHeader>

      {/* --------------------------------- hero --------------------------------- */}
      <section className="card card--pad mb-24">
        <div className="profile-hero">
          <Avatar name={student.name} size="lg" />
          <div className="profile-hero__info">
            <div className="profile-hero__name">{student.name}</div>
            <div className="muted text-sm">
              {student.rollNumber} &middot; {student.university}
            </div>
            <div className="profile-hero__meta">
              <span className="badge badge--info">{student.branch}</span>
              <span className="badge badge--neutral">Semester {student.semester}</span>
              <span className="badge badge--neutral">Batch of {student.graduationYear}</span>
              <span className="badge badge--success">CGPA {student.cgpa}</span>
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
              : `Add these to reach 100%: ${completion.missing.join(', ')}`}
          </p>
        </div>
      </section>

      <div className="grid grid-2">
        {/* ------------------------- personal information ------------------------- */}
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
                <label className="label" htmlFor="name">
                  Full Name
                </label>
                <input
                  id="name"
                  className={`input ${errors.name ? 'input--error' : ''}`}
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                />
                {errors.name ? <span className="field__error">{errors.name}</span> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className={`input ${errors.email ? 'input--error' : ''}`}
                  value={form.email}
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
                  value={form.phone}
                  onChange={(event) => update('phone', event.target.value)}
                />
                {errors.phone ? <span className="field__error">{errors.phone}</span> : null}
              </div>

              <div className="field field--full">
                <label className="label" htmlFor="about">
                  About <span className="label__optional">(shown to recruiters)</span>
                </label>
                <textarea
                  id="about"
                  className="textarea"
                  value={form.about}
                  onChange={(event) => update('about', event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="detail-list">
              <div className="detail-list__item">
                <div className="detail-list__label">Full Name</div>
                <div className="detail-list__value">{student.name}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Email</div>
                <div className="detail-list__value">{student.email}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Phone</div>
                <div className="detail-list__value">{student.phone}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Registered On</div>
                <div className="detail-list__value">{formatDate(student.registeredOn)}</div>
              </div>
              <div className="detail-list__item" style={{ gridColumn: '1 / -1' }}>
                <div className="detail-list__label">About</div>
                <div className="detail-list__value" style={{ fontWeight: 400 }}>
                  {student.about || 'No summary added yet.'}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* -------------------------- academic information -------------------------- */}
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
                <label className="label" htmlFor="university">
                  University / Institute
                </label>
                <input
                  id="university"
                  className="input"
                  value={form.university}
                  onChange={(event) => update('university', event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="rollNumber">
                  Roll Number
                </label>
                <input
                  id="rollNumber"
                  className={`input ${errors.rollNumber ? 'input--error' : ''}`}
                  value={form.rollNumber}
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
                  value={form.branch}
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
                <label className="label" htmlFor="cgpa">
                  CGPA
                </label>
                <input
                  id="cgpa"
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  className={`input ${errors.cgpa ? 'input--error' : ''}`}
                  value={form.cgpa}
                  onChange={(event) => update('cgpa', event.target.value)}
                />
                {errors.cgpa ? <span className="field__error">{errors.cgpa}</span> : null}
                <span className="field__hint">Changing your CGPA immediately changes your eligibility.</span>
              </div>

              <div className="field field--full">
                <label className="label" htmlFor="graduationYear">
                  Graduation Year
                </label>
                <input
                  id="graduationYear"
                  type="number"
                  className="input"
                  value={form.graduationYear}
                  onChange={(event) => update('graduationYear', event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="detail-list">
              <div className="detail-list__item">
                <div className="detail-list__label">University</div>
                <div className="detail-list__value">{student.university}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Branch</div>
                <div className="detail-list__value">{student.branch}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Semester</div>
                <div className="detail-list__value">{student.semester}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">CGPA</div>
                <div className="detail-list__value">{student.cgpa}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Graduation Year</div>
                <div className="detail-list__value">{student.graduationYear}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Roll Number</div>
                <div className="detail-list__value">{student.rollNumber}</div>
              </div>
            </div>
          )}
        </section>

        {/* --------------------------------- skills --------------------------------- */}
        <section className="card card--pad">
          <div className="card__header" style={{ padding: '0 0 14px', border: 0 }}>
            <div className="row gap-8">
              <Icon name="star" size={17} />
              <div className="card__title">Skills</div>
            </div>
            <span className="section__hint">{(form.skills || []).length} skills</span>
          </div>

          <div className="chip-list">
            {(form.skills || []).map((skill) => (
              <span className="chip" key={skill}>
                {skill}
                {isEditing ? (
                  <button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}>
                    <Icon name="x" size={12} />
                  </button>
                ) : null}
              </span>
            ))}
            {(form.skills || []).length === 0 ? (
              <span className="text-sm muted">No skills added yet.</span>
            ) : null}
          </div>

          {isEditing ? (
            <div className="skill-editor mt-16">
              <input
                className="input"
                style={{ maxWidth: 220 }}
                placeholder="Add a skill (e.g. Spring Boot)"
                value={newSkill}
                onChange={(event) => setNewSkill(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSkill();
                  }
                }}
              />
              <Button variant="outline" size="md" icon="plus" onClick={addSkill}>
                Add
              </Button>
            </div>
          ) : (
            <p className="text-xs soft mt-12">
              Skills are matched against the "Required Skills" of every drive. Add anything you can
              demonstrate in an interview.
            </p>
          )}
        </section>

        {/* --------------------------------- resume --------------------------------- */}
        <section className="card card--pad">
          <div className="card__header" style={{ padding: '0 0 14px', border: 0 }}>
            <div className="row gap-8">
              <Icon name="file-text" size={17} />
              <div className="card__title">Resume</div>
            </div>
            {student.resume ? <span className="badge badge--success">Uploaded</span> : null}
          </div>

          {student.resume ? (
            <div className="resume-box">
              <span className="resume-box__icon">
                <Icon name="file" size={20} />
              </span>
              <div className="grow" style={{ minWidth: 160 }}>
                <div className="resume-box__name">{student.resume.fileName}</div>
                <div className="resume-box__meta">
                  {student.resume.size} &middot; uploaded on {formatDate(student.resume.uploadedOn)}
                </div>
              </div>
              <div className="row gap-8">
                <Button variant="outline" size="sm" icon="eye" onClick={downloadResume}>
                  View
                </Button>
                <Button variant="outline" size="sm" icon="download" onClick={downloadResume}>
                  Download
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm muted">No resume uploaded yet. Recruiters expect a PDF resume.</p>
          )}

          <div className="row gap-12 mt-16 wrap">
            <input
              ref={fileInputRef}
              id="resume-upload"
              type="file"
              accept=".pdf,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleResumeChange}
            />
            <Button
              variant="primary"
              icon="upload"
              loading={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              {student.resume ? 'Replace Resume' : 'Upload Resume'}
            </Button>
            <span className="text-xs soft">PDF, DOC or DOCX &middot; maximum 5 MB</span>
          </div>

          <p className="text-xs soft mt-12">
            Demo note: only the file name is stored. The real upload endpoint will be
            <span className="mono"> POST /api/students/resume </span>
            (multipart/form-data handled by multer).
          </p>
        </section>
      </div>

      {isEditing ? (
        <div className="card card--pad mt-24">
          <div className="row-between wrap gap-12">
            <span className="text-sm muted">
              Unsaved changes are kept only in this page's state until you press Save Changes.
            </span>
            <div className="form-actions">
              <Button variant="ghost" icon="x" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" icon="check" onClick={handleSave} loading={saving}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card card--pad mt-24">
          <div className="row-between wrap gap-12">
            <span className="text-sm muted">
              Ready to apply? Your saved profile is used for every eligibility check.
            </span>
            <Button variant="outline" iconRight="chevron-right" onClick={() => navigate('/student/drives')}>
              Browse recruitment drives
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
