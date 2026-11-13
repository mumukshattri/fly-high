import { useState } from 'react';
import Icon from './Icon';
import Button from './Button';

/**
 * components/ResumeExtractReview.jsx
 * ===========================================================================
 * WHAT THE RESUME ACTUALLY SAID
 * ===========================================================================
 * The server fills blank profile fields automatically, and records what it
 * filled. This panel shows those real values - not labels - and lets the
 * student keep or reject each one before confirming.
 *
 * Rejecting a value removes it from the profile only if the profile still holds
 * exactly the extracted value (the server enforces that), so an edit the
 * student made in the meantime is never lost.
 */

const SCALARS = [
  { key: 'degree', label: 'Degree' },
  { key: 'department', label: 'Branch / Department' },
  { key: 'university', label: 'University' },
  { key: 'cgpa', label: 'CGPA' },
  { key: 'graduationYear', label: 'Graduation year' },
  { key: 'semester', label: 'Current semester' },
  { key: 'backlogs', label: 'Active backlogs' },
];

function scalarValue(education, key) {
  if (key === 'cgpa') {
    if (education.cgpa) return `${education.cgpa}/10`;
    if (education.percentage) return `${education.percentage}%`;
    return '';
  }
  const value = education[key];
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

export default function ResumeExtractReview({ extract, applying = false, onApply }) {
  const education = extract?.education || {};
  const skills = extract?.skills || [];
  const projects = extract?.projects || [];
  const experiences = extract?.experience || [];
  const certifications = extract?.certifications || [];

  const availableScalars = SCALARS.filter((item) => scalarValue(education, item.key));

  const [fields, setFields] = useState(() => new Set(availableScalars.map((item) => item.key)));
  const [acceptedSkills, setAcceptedSkills] = useState(() => new Set(skills));
  const [acceptedProjects, setAcceptedProjects] = useState(
    () => new Set(projects.map((_, index) => index)),
  );
  const [acceptedExperiences, setAcceptedExperiences] = useState(
    () => new Set(experiences.map((_, index) => index)),
  );
  const [acceptedCertifications, setAcceptedCertifications] = useState(
    () => new Set(certifications.map((_, index) => index)),
  );

  if (!extract) return null;

  const toggle = (setter) => (value) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const toggleField = toggle(setFields);
  const toggleSkill = toggle(setAcceptedSkills);
  const toggleProject = toggle(setAcceptedProjects);
  const toggleExperience = toggle(setAcceptedExperiences);
  const toggleCertification = toggle(setAcceptedCertifications);

  const nothingFound =
    availableScalars.length === 0 &&
    skills.length === 0 &&
    projects.length === 0 &&
    experiences.length === 0 &&
    certifications.length === 0;

  const submit = () => {
    const acceptedEducation = {};
    for (const key of fields) {
      if (key === 'cgpa') acceptedEducation.cgpa = education.cgpa;
      else if (key === 'department') acceptedEducation.department = education.department;
      else acceptedEducation[key] = education[key];
    }

    onApply?.({
      education: acceptedEducation,
      skills: [...acceptedSkills],
      projects: [...acceptedProjects].map((index) => projects[index]),
      experiences: [...acceptedExperiences].map((index) => experiences[index]),
      certifications: [...acceptedCertifications].map((index) => certifications[index]),
      rejected: {
        fields: SCALARS.map((item) => item.key).filter((key) => !fields.has(key)),
        skills: skills.filter((skill) => !acceptedSkills.has(skill)),
        projectTitles: projects
          .filter((_, index) => !acceptedProjects.has(index))
          .map((project) => project.title),
        experienceKeys: experiences
          .filter((_, index) => !acceptedExperiences.has(index))
          .map((item) => `${item.role}|${item.company}`),
        certificationNames: certifications
          .filter((_, index) => !acceptedCertifications.has(index))
          .map((item) => item.name),
      },
      overwrite: false,
    });
  };

  return (
    <div className="card card--pad col gap-16">
      <div className="row spread wrap gap-8">
        <div>
          <div className="strong">Read from your resume</div>
          <p className="text-sm muted">
            These values were read from the file and filled into your blank profile fields.
            Uncheck anything that is wrong.
          </p>
        </div>
        <span className="badge badge--success">{skills.length} skills detected</span>
      </div>

      {nothingFound ? (
        <div className="inline-note inline-note--warning">
          <Icon name="alert-triangle" size={16} />
          <div>
            Nothing could be read from this file. If it is a scan, upload a text-based PDF
            exported from Word or Google Docs.
          </div>
        </div>
      ) : null}

      {availableScalars.length ? (
        <div className="detail-list">
          {availableScalars.map((item) => (
            <label
              key={item.key}
              className="detail-list__item"
              style={{ cursor: 'pointer', alignItems: 'center' }}
            >
              <div>
                <div className="detail-list__label">{item.label}</div>
                <div className="detail-list__value">{scalarValue(education, item.key)}</div>
              </div>
              <input
                type="checkbox"
                checked={fields.has(item.key)}
                onChange={() => toggleField(item.key)}
              />
            </label>
          ))}
        </div>
      ) : null}

      {skills.length ? (
        <div>
          <div className="label">Skills</div>
          <div className="chip-list mt-8">
            {skills.map((skill) => {
              const on = acceptedSkills.has(skill);
              return (
                <button
                  key={skill}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  style={{ opacity: on ? 1 : 0.4, cursor: 'pointer' }}
                  onClick={() => toggleSkill(skill)}
                >
                  {skill}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {projects.length ? (
        <div className="col gap-8">
          <div className="label">Projects</div>
          {projects.map((project, index) => (
            <label
              key={`${project.title}-${index}`}
              className="row gap-8"
              style={{ alignItems: 'flex-start', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={acceptedProjects.has(index)}
                onChange={() => toggleProject(index)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div className="strong">{project.title}</div>
                {project.techStack?.length ? (
                  <div className="text-xs muted">{project.techStack.join(' · ')}</div>
                ) : null}
                {project.description ? (
                  <p className="text-sm muted">{project.description}</p>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      ) : null}

      {experiences.length ? (
        <div className="col gap-8">
          <div className="label">Internships / experience</div>
          {experiences.map((item, index) => (
            <label
              key={`${item.role}-${item.company}-${index}`}
              className="row gap-8"
              style={{ alignItems: 'flex-start', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={acceptedExperiences.has(index)}
                onChange={() => toggleExperience(index)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div className="strong">
                  {item.role}
                  {item.company ? ` — ${item.company}` : ''}
                </div>
                {item.startDate || item.endDate ? (
                  <div className="text-xs muted">
                    {[item.startDate, item.endDate].filter(Boolean).join(' – ')}
                  </div>
                ) : null}
                {item.description ? <p className="text-sm muted">{item.description}</p> : null}
              </div>
            </label>
          ))}
        </div>
      ) : null}

      {certifications.length ? (
        <div className="col gap-8">
          <div className="label">Certifications</div>
          {certifications.map((item, index) => (
            <label
              key={`${item.name}-${index}`}
              className="row gap-8"
              style={{ alignItems: 'flex-start', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={acceptedCertifications.has(index)}
                onChange={() => toggleCertification(index)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div className="strong">{item.name}</div>
                {item.issuer || item.year ? (
                  <div className="text-xs muted">
                    {[item.issuer, item.year].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      ) : null}

      {extract.notes?.length ? (
        <ul className="text-sm muted" style={{ margin: 0, paddingLeft: 18 }}>
          {extract.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div className="row gap-8 wrap">
        <Button variant="primary" icon="check" loading={applying} onClick={submit}>
          Apply reviewed details
        </Button>
        <span className="text-sm muted">
          Unchecked values are removed from your profile again.
        </span>
      </div>
    </div>
  );
}
