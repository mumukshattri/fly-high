import Icon from './Icon';

/**
 * components/EmptyState.jsx
 * ---------------------------------------------------------------------------
 * Shown whenever a list has no rows - for example "no applications yet" or
 * "no drives match your filters". Good UX always explains WHY a screen is
 * empty and offers the next action (the `children` slot).
 */
export default function EmptyState({ icon = 'search', title, text, children }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="empty-state__title">{title}</div>
      {text ? <p className="empty-state__text">{text}</p> : null}
      {children ? <div className="row gap-8 mt-12 wrap" style={{ justifyContent: 'center' }}>{children}</div> : null}
    </div>
  );
}
