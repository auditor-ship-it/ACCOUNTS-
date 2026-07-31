import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './navConfig.js';
import { usePermission } from '../../hooks/usePermission.js';
import { Icon } from '../ui/Icon.jsx';
import styles from './Sidebar.module.css';

export function Sidebar({ open, onNavigate }) {
  const { canView } = usePermission();

  return (
    <aside className={`${styles.sidebar} ${open ? styles.open : ''}`}>
      <div className={styles.brand}>
        <span className={styles.mark}><i /></span>
        <span className={styles.brandText}>Accounts &amp; Collection</span>
      </div>
      <nav className={styles.nav}>
        {NAV_ITEMS.filter((item) => item.sidebarKey === null || canView(item.sidebarKey)).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            onClick={onNavigate}
          >
            <Icon name={item.icon} className={styles.navIcon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
