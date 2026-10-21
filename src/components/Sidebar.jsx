import { NavLink } from 'react-router-dom';
import Icon from './Icon';
import Avatar from './Avatar';
import { NAVIGATION, ROLE_LABELS } from '../config/navigation';

/**
 * components/Sidebar.jsx
 * ---------------------------------------------------------------------------
 * The dark left navigation. It is rendered for all three roles - only the list
 * of links changes, and that list comes from config/navigation.js.
 *
 * NavLink (from React Router) adds the `is-active` class automatically when the
 * current URL matches, which is how the active menu item is highlighted.
 */
export default function Sidebar({ role, user, unreadCount = 0, open, onClose, onLogout, onResetDemoData }) {
  const config = NAVIGATION[role];
  if (!config) return null;

  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`}>
      {/* ---------------------------- brand ---------------------------- */}
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <Icon name="graduation" size={19} />
        </div>
        <div className="sidebar__brand-text">
          <span className="sidebar__brand-title">Placement Portal</span>
          <span className="sidebar__brand-sub">Campus Recruitment</span>
        </div>
        {/* Only visible on tablet/mobile, where the sidebar is an overlay. */}
        <button type="button" className="sidebar__close" onClick={onClose} aria-label="Close menu">
          <Icon name="x" size={17} />
        </button>
      </div>

      <span className="sidebar__section-label">{config.sectionLabel}</span>

      {/* ---------------------------- links ---------------------------- */}
      <nav className="sidebar__nav">
        {config.items.map((item) => {
          const badgeCount = item.path.endsWith('/notifications') ? unreadCount : 0;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
              onClick={onClose}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {badgeCount > 0 ? <span className="sidebar__badge">{badgeCount}</span> : null}
            </NavLink>
          );
        })}
      </nav>

      {/* ---------------------------- footer ---------------------------- */}
      <div className="sidebar__footer">
        <div className="sidebar__user">
          <Avatar name={user?.name || '?'} size="sm" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="sidebar__user-name truncate">{user?.name}</div>
            <div className="sidebar__user-role">{ROLE_LABELS[role]}</div>
          </div>
        </div>

        <button type="button" className="sidebar__logout" onClick={onLogout}>
          <Icon name="logout" size={16} />
          Logout
        </button>

        {/* Demo helper: restores the original mock data. */}
        <button type="button" className="sidebar__reset" onClick={onResetDemoData}>
          Reset demo data
        </button>
      </div>
    </aside>
  );
}
