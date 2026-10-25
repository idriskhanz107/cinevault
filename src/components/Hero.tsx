import { Link } from 'react-router-dom';
import { Info, Play } from 'lucide-react';
import type { Movie } from '../lib/types';
import { formatDuration } from '../lib/format';

export function Hero({ movie }: { movie: Movie }) {
  return (
    <section aria-label="Featured movie" className="relative isolate overflow-hidden">
      {movie.backdrop_url || movie.poster_url ? (
        <img src={movie.backdrop_url ?? movie.poster_url ?? ''} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-ink-600 via-ink-800 to-ink-900" />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-900 via-ink-900/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-ink-900 to-transparent" />
      <div className="mx-auto flex min-h-[26rem] max-w-7xl flex-col justify-end px-4 pb-14 pt-24 sm:min-h-[32rem] sm:px-6 lg:px-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold-400">Featured</p>
        <h1 className="max-w-2xl font-display text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">{movie.title}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 text-sm text-fog-300">
          {movie.release_year && <span>{movie.release_year}</span>}
          {movie.duration_minutes && <span>{formatDuration(movie.duration_minutes)}</span>}
          {movie.genres.slice(0, 3).map((g) => <span key={g} className="rounded-full border border-white/20 px-2 py-0.5 text-xs">{g}</span>)}
        </p>
        <p className="mt-4 line-clamp-3 max-w-xl text-sm text-fog-100 sm:text-base">{movie.description}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={`/watch/${movie.id}`} className="btn btn-primary"><Play className="h-4 w-4 fill-current" aria-hidden />Watch Now</Link>
          <Link to={`/movie/${movie.id}`} className="btn btn-ghost"><Info className="h-4 w-4" aria-hidden />More Info</Link>
        </div>
      </div>
    </section>
  );
}

export function HeroSkeleton() {
  return <div className="skeleton min-h-[26rem] w-full sm:min-h-[32rem]" role="status" aria-label="Loading featured movie" />;
}
