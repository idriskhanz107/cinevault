import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { isConfigured, isDemoMode } from '../lib/env';

interface CatalogState {
  /** Increments whenever the visible catalogue changes; data hooks refetch on change. */
  version: number;
  /** Ids removed (unpublished/deleted) since load, so open pages can drop them immediately. */
  removedIds: ReadonlySet<string>;
  connected: boolean;
}

const CatalogContext = createContext<CatalogState>({ version: 0, removedIds: new Set(), connected: false });

/**
 * Subscribes to Supabase Realtime:
 *  - postgres_changes on public.movies (INSERT/UPDATE). Realtime evaluates RLS per subscriber,
 *    so anonymous/normal users only receive rows they may SELECT (published + ready).
 *  - a broadcast channel carrying only {id} when a public movie is unpublished or deleted
 *    (such events cannot be delivered through postgres_changes under RLS).
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [removedIds, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!isConfigured || isDemoMode) return;
    // Debounce bursts (e.g. bulk edits) into a single refetch.
    const bump = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVersion((v) => v + 1), 300);
    };

    const channel = supabase
      .channel('catalog')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movies' }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const id = (payload.new as { id: string }).id;
          setRemoved((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
        bump();
      })
      .on('broadcast', { event: 'movie_removed' }, ({ payload }) => {
        const id = (payload as { id?: string })?.id;
        if (typeof id === 'string') setRemoved((prev) => new Set(prev).add(id));
        bump();
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));

    return () => {
      clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, []);

  const value = useMemo(() => ({ version, removedIds, connected }), [version, removedIds, connected]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export const useCatalog = () => useContext(CatalogContext);
