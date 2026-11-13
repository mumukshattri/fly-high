import Icon from './Icon';
import { formatSalary, relativeTime } from '../utils/format';
import {
  factorRows,
  matchCategory,
  relevanceRows,
  scoredFactorText,
  whyReasons,
} from '../utils/matchPresentation';

/**
 * components/MatchJobCard.jsx
 * ---------------------------------------------------------------------------
 * One recommended external vacancy with its full, explainable match.
 *
 * Above the fold: the score, the category, matched/missing skills, the four
 * relevance rows (education, projects/experience, location, employment) and a
 * short human explanation. Everything else - the per-factor breakdown, the
 * weights, and the requirements the listing never stated - lives in the
 * collapsible "Why this match?" panel.
 *
 * Every number comes from the server's `match` object. The card never
 * calculates or adjusts a score, and it never calls relevance eligibility:
 * Adzuna listings do not state a college's CGPA/backlog rules, so the employer
 * decides that when the student applies.
 */

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function confidenceLabel(confidence) {
  if (!confidence) return '';
  return `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`;
}

function SkillChips({ skills, tone, limit = 8 }) {
  const shown = skills.slice(0, limit);
  const extra = skills.length - shown.length;

  return (
    <div className="chip-list">
      {shown.map((skill) => (
        <span className={`chip ${tone}`} key={skill}>
          {tone === 'chip--match' ? <Icon name="check" size={11} /> : null} {skill}
        </span>
      ))}
      {extra > 0 ? <span className="chip chip--ghost">+{extra} more</span> : null}
    </div>
  );
}

export default function MatchJobCard({ job, compact = false }) {
  const match = job.match || {};
  const category = matchCategory(match.level);
  const relevance = relevanceRows(match);
  const factors = factorRows(match);
  const reasons = whyReasons(match);
  const salary = formatSalary(job.salary);
  const posted = relativeTime(job.postedAt);
  const matchedSkills = match.matchedSkills || [];
  const missingSkills = match.missingSkills || [];

  return (
    <article className={`job-card job-card--match ${compact ? 'job-card--compact' : ''}`}>
      <div className="job-card__head">
        <div className="job-card__logo" aria-hidden="true">
          {initials(job.company) || 'JB'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="job-card__company">{job.company || 'Employer not disclosed'}</div>
          <h3 className="job-card__title">{job.title}</h3>
        </div>

        <div
          className="match-score"
          aria-label={`Match score ${match.matchScore} out of 100`}
          title="Relevance score from your profile and this advert's text"
        >
          <span className="match-score__value">{match.matchScore}%</span>
          <span className="match-score__label">match</span>
        </div>
      </div>

      <div className="match-badge-row">
        <span className={`match-badge match-badge--${category.tone}`}>
          <Icon name="target" size={12} />
          {category.label}
        </span>
        <span className="badge badge--violet">
          <Icon name="external-link" size={11} /> External
        </span>
        {match.remote ? <span className="badge badge--neutral">Remote</span> : null}
        {match.confidence ? (
          <span className="badge badge--neutral" title="How many factors the listing described">
            {confidenceLabel(match.confidence)}
          </span>
        ) : null}
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

        {/* education · projects/experience · location · employment */}
        <div className="match-relevance-grid" aria-label="Relevance by factor">
          {relevance.map((row) => (
            <div className={`match-rel match-rel--${row.tone}`} key={row.key}>
              <div className="match-rel__label">{row.label}</div>
              <div className="match-rel__value">
                <span>{row.value}</span>
                {row.score !== null ? <span className="match-rel__score">{row.score}%</span> : null}
              </div>
            </div>
          ))}
        </div>

        {matchedSkills.length ? (
          <div className="match-skills">
            <span className="match-skills__label">
              Matched skills ({matchedSkills.length})
            </span>
            <SkillChips skills={matchedSkills} tone="chip--match" />
          </div>
        ) : (
          <div className="match-skills">
            <span className="match-skills__label">Matched skills</span>
            <span className="text-sm muted">The listing does not name a technology from your profile.</span>
          </div>
        )}

        {missingSkills.length ? (
          <div className="match-skills">
            <span className="match-skills__label">
              Missing skills ({missingSkills.length}) - asked for in the advert, not on your profile
            </span>
            <SkillChips skills={missingSkills} tone="chip--neutral" />
          </div>
        ) : null}

        {reasons.length ? (
          <div className="match-whynow">
            <span className="match-skills__label">Why you are seeing this</span>
            <ul className="match-reasons">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="match-why">
          <summary className="match-why__summary">
            Why this match?
            <span className="match-why__hint">{scoredFactorText(match)}</span>
          </summary>

          <div className="match-factor-list">
            {factors.map((factor) => (
              <div className="match-factor" key={factor.key}>
                <div className="match-factor__head">
                  <span>{factor.label}</span>
                  <span className="match-factor__weight">{factor.weight}% weight</span>
                </div>
                <div
                  className={`match-factor__bar ${factor.scored ? '' : 'match-factor__bar--unknown'}`}
                  role="img"
                  aria-label={
                    factor.scored
                      ? `${factor.label}: ${factor.score} out of 100`
                      : `${factor.label}: not scored`
                  }
                >
                  <span style={{ width: `${factor.scored ? factor.score : 100}%` }} />
                </div>
                <p className="match-factor__detail">
                  {factor.scored ? `${factor.score}/100 · ` : 'Not scored · '}
                  {factor.detail}
                </p>
              </div>
            ))}
          </div>

          {match.unknownFactors?.length ? (
            <>
              <div className="match-skills__label" style={{ marginTop: 14 }}>
                Not stated in the listing
              </div>
              <ul className="match-why__unknown">
                {match.unknownFactors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}

          <p className="match-why__note">
            Weights: skills 40%, education 20%, projects/experience 15%, location 10%, role 10%,
            employment 5% - re-normalised over the factors this advert actually describes. Missing
            information is never counted against you. This is relevance, not eligibility: the
            employer decides that when you apply.
          </p>
        </details>
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
