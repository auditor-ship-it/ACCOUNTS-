import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../api/client.js';

/**
 * Shared loading/error/data pattern for fetch-on-mount screens — consolidates
 * the repetitive fetch->render->error handling every original render*()/fetch*()
 * pair did by hand.
 */
export function useAsync(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetcher();
      if (mounted.current) setData(res);
    } catch (e) {
      if (mounted.current) setError(apiErrorMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mounted.current = true;
    run();
    return () => { mounted.current = false; };
  }, [run]);

  return { data, loading, error, reload: run, setData };
}
