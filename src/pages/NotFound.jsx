import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { HOME_ROUTE } from '../config/navigation';

/**
 * pages/NotFound.jsx
 * ---------------------------------------------------------------------------
 * Shown for any URL that does not match a route (the "*" route in App.jsx).
 * It sends the visitor back to their own dashboard (or to the login page).
 */
export default function NotFound() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="auth-main" style={{ minHeight: '100vh' }}>
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="empty-state__icon" style={{ margin: '0 auto 12px' }}>
          <Icon name="alert-triangle" size={24} />
        </div>
        <h1 className="auth-card__title">Page not found</h1>
        <p className="auth-card__sub">
          The page you are looking for does not exist in the Placement Portal.
        </p>
        <Button
          variant="primary"
          icon="dashboard"
          onClick={() => navigate(user ? HOME_ROUTE[user.role] : '/login')}
        >
          {user ? 'Back to dashboard' : 'Go to login'}
        </Button>
      </div>
    </div>
  );
}
