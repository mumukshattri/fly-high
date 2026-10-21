/**
 * components/Progress.jsx
 * ---------------------------------------------------------------------------
 * A simple accessible progress bar. Used for the profile completion
 * percentage and for the admin statistics bars.
 */
export default function Progress({ value = 0, max = 100, small = false, className = '' }) {
  const percent = Math.max(0, Math.min(100, Math.round((value / max) * 100)));

  return (
    <div
      className={`progress ${small ? 'progress--sm' : ''} ${className}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}
