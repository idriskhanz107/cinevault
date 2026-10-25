import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { suggest } from '../lib/queries';
import { useDebounced } from '../hooks/useAsync';
import type { Movie } from '../lib/types';
import { Poster } from './MovieCard';

type Suggestion = Pick<Movie, 'id' | 'title' | 'release_year' | 'poster_url' | 'genres'>;

/** Search box with debounced, database-backed instant suggestions (ARIA combobox). */
export function SearchBar({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const listId = useId();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const debounced = useDebounced(term.trim(), 250);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounced.length < 2) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    suggest(debounced)
      .then((r) => !cancelled && setItems(r))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setTerm('');
    navigate(path);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (active >= 0 && items[active]) return go(`/movie/${items[active].id}`);
    if (term.trim()) go(`/movies?q=${encodeURIComponent(term.trim())}`);
  };

  const showList = open && debounced.length >= 2;

  return (
    <div ref={box} className={`relative ${className}`}>
      <form onSubmit={submit} role="search" aria-label="Search movies">
        <label htmlFor={`${listId}-input`} className="sr-only">Search movies</label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fog-500" aria-hidden />
        <input
          id={`${listId}-input`}
          type="search"
          value={term}
          maxLength={100}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Title, genre, actor, director…"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          className="input !rounded-full !bg-ink-800/80 !pl-9 !pr-8"
        />
        {term && (
          <button type="button" onClick={() => { setTerm(''); setItems([]); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-fog-500 hover:text-fog-100">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </form>
      {showList && (
        <ul id={listId} role="listbox" aria-label="Search suggestions" className="absolute z-50 mt-2 max-h-96 w-full min-w-72 overflow-auto rounded-xl border border-ink-500 bg-ink-800 p-1 shadow-2xl">
          {searching && items.length === 0 && <li className="px-3 py-2 text-sm text-fog-500">Searching…</li>}
          {!searching && items.length === 0 && <li className="px-3 py-2 text-sm text-fog-500">No movies found</li>}
          {items.map((m, i) => (
            <li key={m.id} id={`${listId}-opt-${i}`} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => go(`/movie/${m.id}`)} onMouseEnter={() => setActive(i)} className={`flex w-full items-center gap-3 rounded-lg p-2 text-left ${i === active ? 'bg-ink-600' : 'hover:bg-ink-700'}`}>
                <div className="h-12 w-8 shrink-0 overflow-hidden rounded"><Poster movie={m} /></div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{m.title}</div>
                  <div className="truncate text-xs text-fog-500">{[m.release_year, m.genres[0]].filter(Boolean).join(' • ')}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
