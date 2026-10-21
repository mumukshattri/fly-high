import { useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import { ROLE_LABELS } from '../config/navigation';

/**
 * components/Topbar.jsx
 * ---------------------------------------------------------------------------
 * Page title + search + notification bell + user chip.
 *
 * The search box is controlled by local state and only navigates on Enter
 * (`onSearchSubmit`), which is how the dashboard search can jump to the drives
 * page with the term pre-filled.
 */
export default function Topbar({
  title,
  subtitle,
  role,
  user,
  unreadCount = 0,
  searchPlaceholder = 'Search...',
  onSearchSubmit,
  onOpenNotifications,
  onOpenMenu,
}) {
  const [term, setTerm] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    if (term.trim()) onSearchSubmit(term.trim());
  };

  return (
    <header className="topbar">
      <button type="button" className="topbar__menu" onClick={onOpenMenu} aria-label="Open menu">
        <Icon name="menu" size={18} />
      </button>

      <div className="topbar__titles">
        <div className="topbar__title">{title}</div>
        {subtitle ? <div className="topbar__subtitle">{subtitle}</div> : null}
      </div>

      <form className="topbar__search" onSubmit={handleSubmit} role="search">
        <Icon name="search" size={16} />
        <input
          type="text"
          value={term}
          placeholder={searchPlaceholder}
          onChange={(event) => setTerm(event.target.value)}
          aria-label="Search the portal"
        />
      </form>

      <div className="topbar__actions">
        {onOpenNotifications ? (
          <button
            type="button"
            className="icon-button"
            onClick={onOpenNotifications}
            aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
          >
            <Icon name="bell" size={18} />
            {unreadCount > 0 ? <span className="icon-button__dot" /> : null}
          </button>
        ) : null}

        <div className="topbar__user">
          <Avatar name={user?.name || '?'} />
          <div className="topbar__user-meta">
            <div className="topbar__user-name">{user?.name}</div>
            <div className="topbar__user-role">{ROLE_LABELS[role]}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
