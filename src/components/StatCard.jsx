import Icon from './Icon';

/**
 * components/StatCard.jsx
 * ---------------------------------------------------------------------------
 * The KPI tile used on the student, company and admin dashboards.
 *
 * <StatCard label="Applications" value={4} icon="file-text" tint="blue" />
 *
 * `tint` only changes the icon chip colour, which keeps the page calm while
 * still colour-coding the numbers.
 */
export default function StatCard({ label, value, icon = 'trending-up', tint = 'blue', foot, hint }) {
  return (
    <article className="stat-card">
      <div className="stat-card__top">
        <span className="stat-card__label">{label}</span>
        <span className={`stat-card__icon tint-${tint}`}>
          <Icon name={icon} size={19} />
        </span>
      </div>
      <div className="stat-card__value">{value}</div>
      {foot ? <div className="stat-card__foot">{foot}</div> : null}
      {hint ? <div className="stat-card__foot soft">{hint}</div> : null}
    </article>
  );
}
