import { Icon } from '../ui/Icon.jsx';
import styles from './EmptyState.module.css';

export function EmptyState({ message = 'No data found', hint }) {
  return (
    <div className={styles.wrap}>
      <Icon name="inbox" className={styles.icon} />
      <div className={styles.message}>{message}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className={styles.wrap}>
      <Icon name="alert" className={styles.icon} />
      <div className={`${styles.message} ${styles.errorMessage}`}>{message}</div>
      {onRetry && (
        <button type="button" className={styles.retryBtn} onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}
