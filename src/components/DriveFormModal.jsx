import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import Icon from './Icon';
import { BRANCHES, JOB_TYPES, SKILL_MATCH_MODES, COMPANY_TIERS } from '../config/constants';

/**
 * components/DriveFormModal.jsx
 * ---------------------------------------------------------------------------
 * The "Create Recruitment Drive" form used by a company.
 *
 * This is the START of the campus recruitment workflow: the company defines the
 * eligibility RULES (minimum CGPA, branches, skills, deadline) as data. Every
 * student's eligibility is then computed from those rules by
 * utils/eligibility.js - nothing is hardcoded.
 *
 * The form is a controlled form again: one `form` state object, one `errors`
 * object, and a `validate()` function that runs before we call the service.
 */

const emptyForm = {
  role: '',
  jobType: 'Full Time',
  location: '',
  package: '',
  openings: 5,
  tier: 'Standard',
  minimumCGPA: 7,
  branches: ['CSE', 'IT'],
  skillsText: '',
  skillMatchMode: 'any',
  deadline: '',
  driveDate: '',
  description: '',
  responsibilitiesText: '',
};

export default function DriveFormModal({ company, onClose, onCreate, saving = false }) {
  const [form, setForm] = useState({ ...emptyForm, location: company?.location || '' });
  const [errors, setErrors] = useState({});

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const toggleBranch = (branch) => {
    setForm((current) => ({
      ...current,
      branches: current.branches.includes(branch)
        ? current.branches.filter((item) => item !== branch)
        : [...current.branches, branch],
    }));
  };

  const validate = () => {
    const nextErrors = {};
    if (!form.role.trim()) nextErrors.role = 'Job role is required.';
    if (!form.deadline) nextErrors.deadline = 'Application deadline is required.';
    if (!form.description.trim()) nextErrors.description = 'A short description is required.';
    if (form.branches.length === 0) nextErrors.branches = 'Select at least one branch.';
    if (!form.skillsText.trim()) nextErrors.skillsText = 'Add at least one required skill.';
    if (Number(form.minimumCGPA) < 0 || Number(form.minimumCGPA) > 10)
      nextErrors.minimumCGPA = 'Minimum CGPA must be between 0 and 10.';
    if (Number(form.openings) < 1) nextErrors.openings = 'At least one opening is required.';

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    // Turn the simple text inputs into the arrays the drive document stores.
    const payload = {
      companyId: company.id,
      role: form.role.trim(),
      jobType: form.jobType,
      location: form.location.trim() || company.location,
      package: form.package.trim() || 'Not disclosed',
      openings: Number(form.openings),
      tier: form.tier,
      minimumCGPA: Number(form.minimumCGPA),
      branches: form.branches,
      requiredSkills: form.skillsText
        .split(',')
        .map((skill) => skill.trim())
        .filter(Boolean),
      skillMatchMode: form.skillMatchMode,
      deadline: form.deadline,
      driveDate: form.driveDate || form.deadline,
      description: form.description.trim(),
      responsibilities: form.responsibilitiesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      selectionProcess: [],
    };

    onCreate(payload);
  };

  return (
    <Modal
      wide
      title="Create Recruitment Drive"
      subtitle={`Published by ${company?.name}. Students will see this drive immediately.`}
      onClose={saving ? () => {} : onClose}
      closeOnOverlay={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" icon="plus" onClick={handleSubmit} loading={saving}>
            Publish Drive
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field field--full">
          <label className="label" htmlFor="role">
            Job Role
          </label>
          <input
            id="role"
            className={`input ${errors.role ? 'input--error' : ''}`}
            placeholder="e.g. Software Development Engineer"
            value={form.role}
            onChange={(event) => update('role', event.target.value)}
          />
          {errors.role ? <span className="field__error">{errors.role}</span> : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="jobType">
            Job Type
          </label>
          <select id="jobType" className="select" value={form.jobType} onChange={(event) => update('jobType', event.target.value)}>
            {JOB_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="tier">
            Company Tier
          </label>
          <select id="tier" className="select" value={form.tier} onChange={(event) => update('tier', event.target.value)}>
            {COMPANY_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="location">
            Location
          </label>
          <input
            id="location"
            className="input"
            value={form.location}
            onChange={(event) => update('location', event.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="package">
            Package / CTC
          </label>
          <input
            id="package"
            className="input"
            placeholder="e.g. 12.0 LPA"
            value={form.package}
            onChange={(event) => update('package', event.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="openings">
            Number of Openings
          </label>
          <input
            id="openings"
            type="number"
            min="1"
            className={`input ${errors.openings ? 'input--error' : ''}`}
            value={form.openings}
            onChange={(event) => update('openings', event.target.value)}
          />
          {errors.openings ? <span className="field__error">{errors.openings}</span> : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="minimumCGPA">
            Minimum CGPA
          </label>
          <input
            id="minimumCGPA"
            type="number"
            step="0.1"
            min="0"
            max="10"
            className={`input ${errors.minimumCGPA ? 'input--error' : ''}`}
            value={form.minimumCGPA}
            onChange={(event) => update('minimumCGPA', event.target.value)}
          />
          {errors.minimumCGPA ? <span className="field__error">{errors.minimumCGPA}</span> : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="deadline">
            Application Deadline
          </label>
          <input
            id="deadline"
            type="date"
            className={`input ${errors.deadline ? 'input--error' : ''}`}
            value={form.deadline}
            onChange={(event) => update('deadline', event.target.value)}
          />
          {errors.deadline ? <span className="field__error">{errors.deadline}</span> : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="driveDate">
            Drive Date <span className="label__optional">(optional)</span>
          </label>
          <input
            id="driveDate"
            type="date"
            className="input"
            value={form.driveDate}
            onChange={(event) => update('driveDate', event.target.value)}
          />
        </div>

        <div className="field field--full">
          <label className="label">Eligible Branches</label>
          <div className="row gap-16 wrap">
            {BRANCHES.map((branch) => (
              <label className="checkbox" key={branch}>
                <input
                  type="checkbox"
                  checked={form.branches.includes(branch)}
                  onChange={() => toggleBranch(branch)}
                />
                {branch}
              </label>
            ))}
          </div>
          {errors.branches ? <span className="field__error">{errors.branches}</span> : null}
        </div>

        <div className="field field--full">
          <label className="label" htmlFor="skillsText">
            Required Skills <span className="label__optional">(comma separated)</span>
          </label>
          <input
            id="skillsText"
            className={`input ${errors.skillsText ? 'input--error' : ''}`}
            placeholder="e.g. Java, SQL, Data Structures"
            value={form.skillsText}
            onChange={(event) => update('skillsText', event.target.value)}
          />
          {errors.skillsText ? <span className="field__error">{errors.skillsText}</span> : null}
        </div>

        <div className="field field--full">
          <label className="label" htmlFor="skillMatchMode">
            Skill Matching Rule
          </label>
          <select
            id="skillMatchMode"
            className="select"
            value={form.skillMatchMode}
            onChange={(event) => update('skillMatchMode', event.target.value)}
          >
            {SKILL_MATCH_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
          <span className="field__hint">
            This is the rule the eligibility engine uses: "all" means the student must have every
            listed skill, "any one" means one is enough.
          </span>
        </div>

        <div className="field field--full">
          <label className="label" htmlFor="description">
            Job Description
          </label>
          <textarea
            id="description"
            className={`textarea ${errors.description ? 'textarea--error' : ''}`}
            placeholder="What will the selected students work on?"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
          />
          {errors.description ? <span className="field__error">{errors.description}</span> : null}
        </div>

        <div className="field field--full">
          <label className="label" htmlFor="responsibilitiesText">
            Responsibilities <span className="label__optional">(one per line)</span>
          </label>
          <textarea
            id="responsibilitiesText"
            className="textarea"
            placeholder={'Build REST APIs\nWrite unit tests\nParticipate in code reviews'}
            value={form.responsibilitiesText}
            onChange={(event) => update('responsibilitiesText', event.target.value)}
          />
        </div>
      </div>

      <div className="inline-note">
        <Icon name="info" size={16} />
        <span>
          Every student who meets all four rules (CGPA, branch, skills, and an open deadline) is
          automatically marked "Eligible" and can apply.
        </span>
      </div>
    </Modal>
  );
}
