/**
 * components/LoadingState.jsx
 * ---------------------------------------------------------------------------
 * Because our mock services deliberately wait ~320ms (like a real network
 * request) every page shows a real loading state. When the Express API is
 * connected nothing here changes - the same component keeps working.
 */
export default function LoadingState({ text = 'Loading...' }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  );
}

/** Grey shimmering card used as a placeholder while a list loads. */
export function CardSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-2">
      {Array.from({ length: count }).map((_, index) => (
        <div className="card card--pad" key={index}>
          <div className="skeleton skeleton--line" style={{ width: '40%' }} />
          <div className="skeleton skeleton--line" style={{ width: '70%' }} />
          <div className="skeleton skeleton--card" />
        </div>
      ))}
    </div>
  );
}
