import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck, Film, Star } from 'lucide-react';
import type { Movie } from '../lib/types';
import { useWatchlist } from '../context/WatchlistContext';
import { useAuth } from '../context/AuthContext';

export function Poster({ movie, className = '' }: { movie: Pick<Movie, 'title' | 'poster_url'>; className?: string }) {
  return movie.poster_url ? (
    <img src={movie.poster_url} alt={`${movie.title} poster`} loading="lazy" decoding="async" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-ink-600 to-ink-800 p-3 text-center ${className}`}>
      <Film className="h-8 w-8 text-fog-500" aria-hidden />
      <span className="text-xs font-semibold text-fog-300">{movie.title}</span>
    </div>
  );
}

function MovieCardBase({ movie, progress, className = 'w-full' }: { movie: Movie; progress?: number; className?: string }) {
  const { user } = useAuth();
  const { has, toggle } = useWatchlist();
  const saved = has(movie.id);

  return (
    <article className={`group relative ${className}`}>
      <Link to={`/movie/${movie.id}`} className="block" aria-label={`${movie.title}${movie.release_year ? `, ${movie.release_year}` : ''}`}>
        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-ink-700 ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-gold-400/60 group-focus-within:ring-gold-400/60">
          <Poster movie={movie} className="transition duration-500 group-hover:scale-105" />
          {movie.rating_avg != null && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold">
              <Star className="h-3 w-3 fill-gold-400 text-gold-400" aria-hidden />
              {Number(movie.rating_avg).toFixed(1)}
            </span>
          )}
          {progress != null && progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Watched">
              <div className="h-full bg-gold-400" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )}
        </div>
        <h3 className="mt-2 truncate text-sm font-semibold">{movie.title}</h3>
        <p className="truncate text-xs text-fog-500">
          {[movie.release_year, movie.genres[0]].filter(Boolean).join(' • ')}
        </p>
      </Link>
      {user && (
        <button
          type="button"
          onClick={() => void toggle(movie.id).catch(() => undefined)}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${movie.title} from watchlist` : `Add ${movie.title} to watchlist`}
          className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 opacity-0 transition hover:bg-black focus:opacity-100 group-hover:opacity-100"
        >
          {saved ? <BookmarkCheck className="h-4 w-4 text-gold-400" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </article>
  );
}

export const MovieCard = memo(MovieCardBase);
