import { createContext, useCallback, useContext, useState } from 'react';

/**
 * ToastContext
 * ---------------------------------------------------------------------------
 * A very small global "notification" system. Instead of building a separate
 * toast on every page, any component can do:
 *
 *     const { showToast } = useToast();
 *     showToast('Application submitted successfully.', 'success');
 *
 * `type` is one of: 'success' | 'error' | 'info' | 'warning'.
 * The <ToastStack /> component (rendered once in App.jsx) displays them.
 */
const ToastContext = createContext(null);

let toastCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message, type = 'success') => {
      const id = `toast-${(toastCounter += 1)}`;
      setToasts((current) => [...current, { id, message, type }]);
      // Auto dismiss after 4 seconds.
      setTimeout(() => dismissToast(id), 4000);
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
