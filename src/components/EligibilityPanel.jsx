import Icon from './Icon';

/**
 * components/EligibilityPanel.jsx
 * ---------------------------------------------------------------------------
 * Renders the RESULT of `checkEligibility(student, drive)`.
 *
 * The panel never recalculates anything - it just prints the `checks` array
 * produced by the eligibility engine, which makes the rules transparent:
 * a student (and an examiner!) can see exactly which rule failed and why.
 *
 * Each check looks like:
 *   { label: 'Minimum CGPA', required: '7.5+', actual: '6.9',
 *     passed: false, detail: 'CGPA is below the required minimum.' }
 */
export default function EligibilityPanel({ eligibility, title = 'Eligibility Result' }) {
  if (!eligibility) return null;

  return (
    <section
      className={`eligibility-panel ${
        eligibility.eligible ? 'eligibility-panel--eligible' : 'eligibility-panel--ineligible'
      }`}
    >
      <header className="eligibility-panel__head">
        <span className="eligibility-panel__icon">
          <Icon name={eligibility.eligible ? 'check' : 'x'} size={19} strokeWidth={2.6} />
        </span>
        <div>
          <div className="eligibility-panel__title">
            {eligibility.eligible ? 'You are eligible' : 'You are not eligible'}
          </div>
          <div className="eligibility-panel__sub">
            {eligibility.eligible
              ? `${title}: every requirement below is met.`
              : eligibility.reasons[0] || 'You do not meet the requirements of this drive.'}
          </div>
        </div>
      </header>

      <div className="eligibility-panel__body">
        {eligibility.checks.map((check) => (
          <div className="check-row" key={check.label}>
            <span className={`check-row__mark check-row__mark--${check.passed ? 'pass' : 'fail'}`}>
              <Icon name={check.passed ? 'check' : 'x'} size={13} strokeWidth={3} />
            </span>

            <div className="check-row__main">
              <div className="check-row__label">{check.label}</div>
              <div className="check-row__detail">{check.detail}</div>
            </div>

            <div className="check-row__values">
              <div>
                Required: <strong>{check.required}</strong>
              </div>
              <div>
                You: <strong>{check.actual}</strong>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
