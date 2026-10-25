import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { MovieCard } from '../components/MovieCard';
import { EmptyState, ErrorState, GridSkeleton, PageContainer } from '../components/ui';
import { useCatalog } from '../context/CatalogContext';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { PAGE_SIZE, listGenres, listLanguages, listMovies, type SortKey } from '../lib/queries';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recently added' },
  { value: 'year', label: 'Release year' },
  { value: 'title', label: 'Alphabetical (A–Z)' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'popular', label: 'Most popular' },
];

/** Shared by /movies, /recent and genre browsing. Filters live in the URL so pages are shareable. */
export default function Browse({ title = 'Movies', defaultSort = 'recent' }: { title?: string; defaultSort?: SortKey }) {
  const [params, setParams] = useSearchParams();
  const { removedIds } = useCatalog();
  const q = params.get('q') ?? '';
  const genre = params.get('genre') ?? '';
  const language = params.get('language') ?? '';
  const year = Number(params.get('year')) || undefined;
  const rawSort = params.get('sort');
  const sort = (SORTS.some((s) => s.value === rawSort) ? rawSort : defaultSort) as SortKey;

  const [text, setText] = useState(q);
  const debouncedText = useDebounced(text, 350);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<import('../lib/types').Movie[]>([]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => { if (debouncedText !== q) update('q', debouncedText.trim()); }, [debouncedText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); setItems([]); }, [q, genre, language, year, sort]);

  const genres = useAsync(listGenres, []);
  const languages = useAsync(listLanguages, []);
  const result = useAsync(
    () => listMovies({ q, genre, language, year, sort }, page, PAGE_SIZE),
    [q, genre, language, year, sort, page],
    true,
  );

  // Accumulate pages (incremental loading). Realtime version bumps refetch the current page in place.
  useEffect(() => {
    if (!result.data) return;
    setItems((prev) => {
      const start = page * PAGE_SIZE;
      const merged = prev.slice(0, start).concat(result.data!.movies);
      return page === 0 ? result.data!.movies : merged;
    });
  }, [result.data, page]);

  const shown = items.filter((m) => !removedIds.has(m.id));
  const total = result.data?.total ?? 0;
  const hasMore = items.length < total;

  return (
    <PageContainer className="py-8">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <form className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Filter movies">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-q">Search</label>
          <input id="f-q" className="input" type="search" maxLength={100} value={text} onChange={(e) => setText(e.target.value)} placeholder="Title, actor, director, year…" />
        </div>
        <div>
          <label className="label" htmlFor="f-genre">Genre</label>
          <select id="f-genre" className="input" value={genre} onChange={(e) => update('genre', e.target.value)}>
            <option value="">All genres</option>
            {genres.data?.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-lang">Language</label>
          <select id="f-lang" className="input" value={language} onChange={(e) => update('language', e.target.value)}>
            <option value="">All languages</option>
            {languages.data?.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-year">Release year</label>
          <input id="f-year" className="input" type="number" min={1888} max={2100} value={year ?? ''} onChange={(e) => update('year', e.target.value)} placeholder="e.g. 2021" />
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="label" htmlFor="f-sort"><SlidersHorizontal className="mr-1 inline h-3 w-3" aria-hidden />Sort by</label>
          <select id="f-sort" className="input" value={sort} onChange={(e) => update('sort', e.target.value)}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </form>

      <div className="mt-6" aria-live="polite">
        {result.error ? (
          <ErrorState message={result.error} onRetry={result.reload} />
        ) : result.loading && items.length === 0 ? (
          <GridSkeleton />
        ) : shown.length === 0 ? (
          <EmptyState title="No movies match" message="Try removing a filter or searching for something else." />
        ) : (
          <>
            <p className="mb-3 text-sm text-fog-500">{total} movie{total === 1 ? '' : 's'}</p>
            <div className="fade-up grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {shown.map((m) => <MovieCard key={m.id} movie={m} />)}
            </div>
            {hasMore && (
              <div className="mt-8 text-center">
                <button type="button" className="btn btn-ghost" disabled={result.loading} onClick={() => setPage((p) => p + 1)}>
                  {result.loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
