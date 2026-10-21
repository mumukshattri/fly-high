import { useToast } from '../context/ToastContext';
import Icon from './Icon';

/**
 * components/ToastStack.jsx
 * ---------------------------------------------------------------------------
 * Renders every active toast in the top-right corner. It is mounted ONCE in
 * App.jsx, and any page can create a toast through `useToast()`.
 */
const TOAST_ICONS = {
  success: 'check-circle',
  error: 'x-circle',
  warning: 'alert-triangle',
  info: 'info',
};

export default function ToastStack() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.type}`} key={toast.id}>
          <Icon name={TOAST_ICONS[toast.type] || 'info'} size={18} />
          <span className="toast__message grow">{toast.message}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
