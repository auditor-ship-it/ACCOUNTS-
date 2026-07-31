import styles from './LoadingSpinner.module.css';

export function LoadingSpinner({ label = 'Loading…' }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.spinner} />
      <span>{label}</span>
    </div>
  );
}
