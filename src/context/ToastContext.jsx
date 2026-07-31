import { createContext, useCallback, useContext, useState } from 'react';
import { Icon } from '../components/ui/Icon.jsx';
import styles from './Toast.module.css';

const ToastContext = createContext(null);
let nextId = 1;

const ICON = { success: 'check-circle', error: 'x-circle', warn: 'alert', info: 'info' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-2), { id, message, type }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={styles.wrap}>
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.type] || styles.success}`}>
            <Icon name={ICON[t.type] || ICON.success} className={styles.icon} />
            <p className={styles.message}>{t.message}</p>
            <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="x" size="sm" />
            </button>
            <span className={styles.bar} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
