import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(() => {
    if (!path) { setLoading(false); return; }
    setLoading(true); setError(null);
    api.get<T>(path)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(reload, [path, ...deps]);
  return { data, error, loading, reload, setData };
}
