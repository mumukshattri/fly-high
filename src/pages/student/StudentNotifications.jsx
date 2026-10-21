import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { useCurrentStudent } from '../../hooks/useCurrentStudent';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../utils/format';

/**
 * pages/student/StudentNotifications.jsx
 * ---------------------------------------------------------------------------
 * The notification inbox. In a real system the backend creates these rows
 * whenever an application status changes, a drive is published or a deadline
 * is close - see applicationService.updateApplicationStatus() where the demo
 * inserts a notification on every status change.
 */
const TYPE_STYLES = {
  success: { icon: 'check-circle', tint: 'tint-green' },
  danger: { icon: 'x-circle', tint: 'tint-red' },
  warning: { icon: 'alert-triangle', tint: 'tint-amber' },
  info: { icon: 'info', tint: 'tint-blue' },
};

export default function StudentNotifications() {
  const student = useCurrentStudent();
  const data = useData();
  const { loading, markNotificationRead, markAllNotificationsRead, saving } = data;
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Only this student's notifications, newest first (sorted by the service).
  const notifications = useMemo(
    () => data.notifications.filter((notification) => notification.studentId === student?.id),
    [data.notifications, student],
  );

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  const handleMarkAll = async () => {
    await markAllNotificationsRead(student.id);
    showToast('All notifications marked as read.', 'info');
  };

  const handleOpen = async (notification) => {
    if (!notification.read) await markNotificationRead(notification.id);
    // Status notifications point at the application tracker.
    if (notification.title.toLowerCase().includes('application') || notification.type === 'success') {
      navigate('/student/applications');
    }
  };

  if (loading || !student) return <LoadingState text="Loading notifications..." />;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={
          unreadCount > 0
            ? `You have ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.`
            : 'You are all caught up.'
        }
      >
        <Button
          variant="outline"
          icon="check"
          onClick={handleMarkAll}
          loading={saving}
          disabled={unreadCount === 0}
        >
          Mark all as read
        </Button>
      </PageHeader>

      {notifications.length === 0 ? (
        <EmptyState
          icon="bell"
          title="No notifications yet"
          text="Updates about your applications, shortlisting and new drives will appear here."
        >
          <Button variant="primary" icon="briefcase" onClick={() => navigate('/student/drives')}>
            Browse recruitment drives
          </Button>
        </EmptyState>
      ) : (
        <div className="card card--flush">
          <div className="card__header">
            <div>
              <div className="card__title">Inbox</div>
              <div className="card__subtitle">{notifications.length} notifications</div>
            </div>
            <span className="badge badge--info">{unreadCount} unread</span>
          </div>

          {notifications.map((notification) => {
            const style = TYPE_STYLES[notification.type] || TYPE_STYLES.info;

            return (
              <button
                key={notification.id}
                type="button"
                className={`notification ${notification.read ? '' : 'is-unread'}`}
                style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)' }}
                onClick={() => handleOpen(notification)}
              >
                <span className={`notification__icon ${style.tint}`}>
                  <Icon name={style.icon} size={18} />
                </span>

                <span className="grow">
                  <span className="notification__title">{notification.title}</span>
                  <span className="notification__text" style={{ display: 'block' }}>
                    {notification.message}
                  </span>
                  <span className="notification__meta" style={{ display: 'block' }}>
                    {formatDate(notification.date)} &middot; {notification.read ? 'Read' : 'Unread'}
                  </span>
                </span>

                {!notification.read ? <span className="status-dot" style={{ color: 'var(--blue-600)' }} /> : null}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
