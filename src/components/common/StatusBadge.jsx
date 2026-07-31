import { Icon } from '../ui/Icon.jsx';
import styles from './StatusBadge.module.css';

const MAP = {
  pending: { color: 'warn', icon: 'clock' },
  'documents pending': { color: 'warn', icon: 'clock' },
  approved: { color: 'success', icon: 'check-circle' },
  completed: { color: 'success', icon: 'check-circle' },
  paid: { color: 'success', icon: 'check-circle' },
  rejected: { color: 'error', icon: 'x-circle' },
  overdue: { color: 'error', icon: 'x-circle' },
  disputed: { color: 'error', icon: 'x-circle' },
  invalid_state: { color: 'error', icon: 'x-circle' },
  renewed: { color: 'info', icon: 'refresh' },
  'in progress': { color: 'info', icon: 'refresh' }
};

export function StatusBadge({ status }) {
  const key = String(status || '').trim().toLowerCase();
  const entry = MAP[key] || { color: 'neutral', icon: null };
  return (
    <span className={`${styles.badge} ${styles[entry.color]}`}>
      {entry.icon && <Icon name={entry.icon} size="sm" />}
      {status || '—'}
    </span>
  );
}
