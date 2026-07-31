import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Generic countdown-timer state — used by RefreshButton to disable itself
 * for a bit after each click (so a user can't spam-click and burn through
 * Google's Sheets API read quota) and, if the backend reports a real quota
 * lockout (HTTP 429 with `retryAfterSeconds`), for however long that lasts.
 */
export function useCooldown() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef(null);

  const start = useCallback((seconds) => {
    clearInterval(timerRef.current);
    setSecondsLeft(Math.max(1, Math.ceil(seconds)));
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => clearInterval(timerRef.current), []);

  return { active: secondsLeft > 0, secondsLeft, start };
}
