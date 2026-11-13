import Icon from './Icon';
import { formatSalary, relativeTime } from '../utils/format';

/**
 * components/ExternalJobCard.jsx
 * ---------------------------------------------------------------------------
 * One vacancy from Adzuna (an employer that is NOT registered on Job N Job).
 *
 * Two rules this card follows:
 *   1. It renders ONLY what the provider sent. A missing salary, location or
 *      description is hidden, never filled with a placeholder.
 *   2. "Apply Externally" is a real <a href> to the provider's URL, opened in a
 *      new tab. No internal Application is created - the student applies on
 *      the employer's own site.
 */

/** Company initials for the tile: 'Nimbus Analytics' -> 'NA'. */
function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export default function ExternalJobCard({ job }) {
  const salary = formatSalary(job.salary);
  const posted = relativeTime(job.postedAt);

  return (
    <article className="job-card">
      <div className="job-card__head">
        <div className="job-card__logo" aria-hidden="true">
          {initials(job.company) || 'JB'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="job-card__company">{job.company || 'Employer not disclosed'}</div>
          <h3 className="job-card__title">{job.title}</h3>
        </div>
        <span className="badge badge--violet" title="This vacancy comes from an external job board, not from a drive on this portal">
          <Icon name="external-link" size={12} /> External
        </span>
      </div>

      <div className="job-card__body">
        <div className="job-card__grid">
          {job.location ? (
            <div>
              <div className="job-card__item-label">Location</div>
              <div className="job-card__item-value">
                <Icon name="map-pin" size={13} /> {job.location}
              </div>
            </div>
          ) : null}

          {salary ? (
            <div>
              <div className="job-card__item-label">
                Salary {job.salary.isPredicted ? <span className="muted">(estimated)</span> : null}
              </div>
              <div className="job-card__item-value">{salary}</div>
            </div>
          ) : null}

          {job.employmentType ? (
            <div>
              <div className="job-card__item-label">Type</div>
              <div className="job-card__item-value">{job.employmentType}</div>
            </div>
          ) : null}

          {posted ? (
            <div>
              <div className="job-card__item-label">Posted</div>
              <div className="job-card__item-value">
                <Icon name="clock" size={13} /> {posted}
              </div>
            </div>
          ) : null}
        </div>

        {job.description ? <p className="job-card__description">{job.description}</p> : null}

        {job.salary?.isPredicted ? (
          <p className="job-card__note">
            Salary marked estimated is Adzuna's model of the likely pay, not a figure published by the employer.
          </p>
        ) : null}
      </div>

      <div className="job-card__actions">
        <span className="job-card__source">
          {job.category ? <span className="text-xs muted">{job.category}</span> : null}
          <span className="text-xs muted">via {job.source}</span>
        </span>
        <a
          className="btn btn--primary"
          href={job.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          Apply Externally
          <Icon name="external-link" size={15} />
        </a>
      </div>
    </article>
  );
}
