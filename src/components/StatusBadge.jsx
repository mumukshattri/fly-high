import Icon from './Icon';
import { slugify } from '../utils/format';

/**
 * components/StatusBadge.jsx
 * ---------------------------------------------------------------------------
 * The coloured pill that shows an application's status. Because every page uses
 * this one component, "Shortlisted" always looks the same across the portal.
 *
 * Applied       -> blue (just submitted)
 * Under Review  -> amber (in progress)
 * Shortlisted   -> violet (good news)
 * Selected      -> green (offer)
 * Rejected      -> red
 */
const STATUS_STYLES = {
  Applied: { variant: 'info', icon: 'send' },
  'Under Review': { variant: 'warning', icon: 'clock' },
  Shortlisted: { variant: 'violet', icon: 'star' },
  Selected: { variant: 'success', icon: 'check-circle' },
  Rejected: { variant: 'danger', icon: 'x-circle' },
  Open: { variant: 'success', icon: 'check-circle' },
  Closed: { variant: 'neutral', icon: 'lock' },
  Active: { variant: 'success', icon: 'check-circle' },
};

export default function StatusBadge({ status, withIcon = true, className = '' }) {
  if (!status) return null;
  const style = STATUS_STYLES[status] || { variant: 'neutral', icon: 'circle' };

  return (
    <span
      className={`badge badge--${style.variant} ${className}`}
      data-status={slugify(status)}
    >
      {withIcon ? <Icon name={style.icon} size={12} strokeWidth={2.4} /> : <span className="status-dot" />}
      {status}
    </span>
  );
}
