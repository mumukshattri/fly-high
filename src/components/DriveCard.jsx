import Icon from './Icon';
import StatusBadge from './StatusBadge';
import Button from './Button';
import { formatDate, deadlineLabel, daysUntil, initials } from '../utils/format';

/**
 * components/DriveCard.jsx
 * ---------------------------------------------------------------------------
 * One recruitment drive, shown on the dashboard and on the drives page.
 *
 * The card receives an already-ENRICHED drive (it contains `companyName` and
 * an `eligibility` result) plus whether the student already applied. It does
 * not calculate anything itself - all logic lives in utils/ and services/.
 *
 * Props
 *   drive       - enriched drive (companyName + eligibility)
 *   application - the student's application for this drive, if any
 *   onView      - open the details page
 *   onApply     - open the confirmation modal
 *   applying    - true while the POST /api/applications request is in flight
 */
export default function DriveCard({ drive, application, onView, onApply, applying = false }) {
  const eligibility = drive.eligibility;
  const alreadyApplied = Boolean(application);
  const days = daysUntil(drive.deadline);

  // Choose the colour of the deadline pill.
  const deadlineClass = days === null ? 'ok' : days < 0 ? 'over' : days <= 5 ? 'soon' : 'ok';

  const applyButton = () => {
    if (alreadyApplied) {
      // Requirement: show a disabled "Applied" button instead of "Apply"
      // so a student can never submit the same drive twice.
      return (
        <Button variant="applied" icon="check" disabled>
          Applied
        </Button>
      );
    }

    if (eligibility && !eligibility.eligible) {
      return (
        <Button variant="outline" icon="x" disabled title={eligibility.reasons[0]}>
          Not Eligible
        </Button>
      );
    }

    return (
      <Button variant="primary" onClick={() => onApply(drive)} loading={applying}>
        Apply
      </Button>
    );
  };

  return (
    <article className="drive-card">
      {/* ------------------------------- header ------------------------------- */}
      <div className="drive-card__head">
        <div className="drive-card__logo">{initials(drive.companyName)}</div>
        <div className="grow">
          <div className="drive-card__company">{drive.companyName}</div>
          <div className="drive-card__role">{drive.role}</div>
          <div className="row gap-4 mt-8 wrap">
            <StatusBadge status={drive.status} withIcon={false} />
            {drive.tier ? <span className="badge badge--violet">{drive.tier}</span> : null}
            <span className="badge badge--neutral">{drive.jobType}</span>
          </div>
        </div>
      </div>

      {/* -------------------------------- body -------------------------------- */}
      <div className="drive-card__body">
        <div className="drive-card__grid">
          <div>
            <div className="drive-card__item-label">Minimum CGPA</div>
            <div className="drive-card__item-value">{drive.minimumCGPA}+</div>
          </div>
          <div>
            <div className="drive-card__item-label">Package</div>
            <div className="drive-card__item-value">{drive.package}</div>
          </div>
          <div>
            <div className="drive-card__item-label">Eligible Branches</div>
            <div className="drive-card__item-value">{(drive.branches || []).join(' / ') || 'All'}</div>
          </div>
          <div>
            <div className="drive-card__item-label">Deadline</div>
            <div className="drive-card__item-value">
              {formatDate(drive.deadline)}
              <span className={`deadline-pill deadline-pill--${deadlineClass}`}>
                {deadlineLabel(drive.deadline)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-16">
          <div className="drive-card__item-label mb-8">Required Skills</div>
          <div className="chip-list">
            {(drive.requiredSkills || []).map((skill) => (
              <span className="chip" key={skill}>
                {skill}
              </span>
            ))}
            {drive.skillMatchMode === 'any' && drive.requiredSkills?.length > 1 ? (
              <span className="chip chip--neutral">any one</span>
            ) : null}
          </div>
        </div>

        {/* ------------------------------ eligibility ------------------------------ */}
        {eligibility ? (
          eligibility.eligible ? (
            <div className="drive-card__eligibility drive-card__eligibility--yes">
              <Icon name="check-circle" size={16} />
              <span>You are eligible for this drive.</span>
            </div>
          ) : (
            <div className="drive-card__eligibility drive-card__eligibility--no">
              <Icon name="x-circle" size={16} />
              <span>Not eligible - {eligibility.reasons[0]}</span>
            </div>
          )
        ) : null}
      </div>

      {/* ------------------------------- actions ------------------------------- */}
      <div className="drive-card__actions">
        <Button variant="outline" onClick={() => onView(drive.id)}>
          View Details
        </Button>
        {applyButton()}
      </div>
    </article>
  );
}
