import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { Icon } from '../ui/Icon.jsx';
import styles from './TopBar.module.css';

export function TopBar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <header className={styles.bar}>
      <button type="button" className={styles.menuBtn} onClick={onMenuClick} aria-label="Toggle menu">
        <Icon name="list" />
      </button>
      <div className={styles.spacer} />
      <button
        type="button"
        className={styles.themeBtn}
        onClick={toggle}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="sm" />
      </button>
      <div className={styles.user}>
        <span className={styles.name}>{user?.name || user?.empId}</span>
        <span className={styles.email}>{user?.email}</span>
      </div>
      <button type="button" className={styles.logoutBtn} onClick={logout}>Logout</button>
    </header>
  );
}
