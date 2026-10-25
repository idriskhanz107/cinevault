import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { getWatchlistIds, setWatchlisted } from '../lib/queries';

interface WatchlistState {
  ids: ReadonlySet<string>;
  has: (movieId: string) => boolean;
  toggle: (movieId: string) => Promise<void>;
}

const WatchlistContext = createContext<WatchlistState>({ ids: new Set(), has: () => false, toggle: async () => undefined });

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return setIds(new Set());
    let cancelled = false;
    getWatchlistIds(userId).then((s) => !cancelled && setIds(s)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggle = useCallback(
    async (movieId: string) => {
      if (!userId) throw new Error('Please sign in to use your watchlist.');
      const on = !ids.has(movieId);
      // Optimistic update with rollback.
      setIds((prev) => {
        const next = new Set(prev);
        if (on) next.add(movieId);
        else next.delete(movieId);
        return next;
      });
      try {
        await setWatchlisted(userId, movieId, on);
      } catch (e) {
        setIds((prev) => {
          const next = new Set(prev);
          if (on) next.delete(movieId);
          else next.add(movieId);
          return next;
        });
        throw e;
      }
    },
    [userId, ids],
  );

  const value = useMemo(() => ({ ids, has: (id: string) => ids.has(id), toggle }), [ids, toggle]);
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export const useWatchlist = () => useContext(WatchlistContext);
