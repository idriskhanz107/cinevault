import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Movie } from '../lib/types';
import { useCatalog } from '../context/CatalogContext';
import { MovieCard } from './MovieCard';
import { EmptyState, ErrorState, RowSkeleton } from './ui';

interface Props {
  title: string;
  movies: Movie[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  seeAllTo?: string;
  emptyMessage?: string;
  progress?: Record<string, number>;
  action?: ReactNode;
}

export function MovieRow({ title, movies, loading, error, onRetry, seeAllTo, emptyMessage, progress }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const { removedIds } = useCatalog();
  const visible = movies?.filter((m) => !removedIds.has(m.id));
  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className="py-4" aria-label={title}>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-lg font-bold sm:text-xl">{title}</h2>
        <div className="flex items-center gap-2">
          {seeAllTo && <Link to={seeAllTo} className="text-sm text-gold-400 hover:underline">See all</Link>}
          <div className="hidden gap-1 sm:flex">
            <button type="button" onClick={() => scrollBy(-1)} aria-label={`Scroll ${title} left`} className="rounded-full bg-white/10 p-1.5 hover:bg-white/20"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <button type="button" onClick={() => scrollBy(1)} aria-label={`Scroll ${title} right`} className="rounded-full bg-white/10 p-1.5 hover:bg-white/20"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
        </div>
      </div>
      {loading && !visible ? (
        <RowSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : visible && visible.length === 0 ? (
        <EmptyState title="Nothing here yet" message={emptyMessage ?? 'Movies will appear here as soon as they are published.'} />
      ) : (
        <div ref={scroller} className="scrollbar-hide fade-up -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2" tabIndex={-1}>
          {visible?.map((m) => (
            <div key={m.id} className="w-40 shrink-0 snap-start sm:w-44">
              <MovieCard movie={m} progress={progress?.[m.id]} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
