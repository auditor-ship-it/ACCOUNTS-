import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { TopBar } from './TopBar.jsx';
import styles from './AppShell.module.css';

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className={`${styles.scrim} ${menuOpen ? styles.scrimOn : ''}`} onClick={() => setMenuOpen(false)} />
      <div className={styles.main}>
        <TopBar onMenuClick={() => setMenuOpen((v) => !v)} />
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
