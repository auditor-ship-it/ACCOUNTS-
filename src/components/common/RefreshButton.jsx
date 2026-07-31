import { useState } from 'react';
import { Button } from './Button.jsx';
import { useCooldown } from '../../hooks/useCooldown.js';
import { apiQuotaRetrySeconds } from '../../api/client.js';
import styles from './RefreshButton.module.css';

const NORMAL_COOLDOWN_SECONDS = 20;

function formatSeconds(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/**
 * Shared "Refresh" control every data page uses instead of an ad-hoc reload
 * button. Data on every page is already cached server-side for ~90s (see
 * responseCache.middleware.js), so this mainly guards against a user
 * spam-clicking Refresh: a normal click starts a short cooldown, and if the
 * backend reports the Sheets API quota was actually hit (HTTP 429), the
 * cooldown jumps to whatever wait time the backend reports, app-wide.
 */
export function RefreshButton({ onRefresh, label = 'Refresh', size = 'sm', variant = 'secondary' }) {
  const { active, secondsLeft, start } = useCooldown();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (active || loading) return;
    setLoading(true);
    try {
      await onRefresh();
      start(NORMAL_COOLDOWN_SECONDS);
    } catch (err) {
      const quotaSeconds = apiQuotaRetrySeconds(err);
      start(quotaSeconds || NORMAL_COOLDOWN_SECONDS);
      throw err; // let the caller's own error state/toast still handle display
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant={variant} size={size} disabled={active} loading={loading} onClick={handleClick} className={styles.btn}>
      {active ? `Wait ${formatSeconds(secondsLeft)}` : label}
    </Button>
  );
}
