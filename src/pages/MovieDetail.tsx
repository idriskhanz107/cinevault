import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bookmark, BookmarkCheck, Play, Star, Clapperboard } from 'lucide-react';
import { Poster } from '../components/MovieCard';
import { Alert, EmptyState, ErrorState, PageContainer, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useWatchlist } from '../context/WatchlistContext';
import { useAsync } from '../hooks/useAsync';
import { formatDate, formatDuration } from '../lib/format';
import { deleteReview, getMovie, getMyReview, getProgress, getReviews, saveReview } from '../lib/queries';

function Reviews({ movieId }: { movieId: string }) {
  const { user } = useAuth();
  const reviews = useAsync(() => getReviews(movieId), [movieId]);
  const mine = useAsync(() => (user ? getMyReview(user.id, movieId) : Promise.resolve(null)), [user?.id, movieId]);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<unknown>(null);

  if (mine.data !== undefined && loadedFor !== mine.data) {
    setLoadedFor(mine.data);
    setRating(mine.data?.rating ?? 0);
    setText(mine.data?.review_text ?? '');
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || rating < 1) return setErr('Choose a star rating first.');
    setBusy(true);
    setErr(null);
    try {
      await saveReview(user.id, movieId, rating, text);
      reviews.reload();
      mine.reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save your review.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!user) return;
    try {
      await deleteReview(user.id, movieId);
      setRating(0);
      setText('');
      reviews.reload();
      mine.reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not delete your review.');
    }
  };

  return (
    <section className="mt-10" aria-label="Ratings and reviews">
      <h2 className="text-xl font-bold">Ratings &amp; reviews</h2>
      {user ? (
        <form onSubmit={submit} className="mt-4 max-w-xl space-y-3 rounded-xl bg-ink-800 p-4">
          <fieldset>
            <legend className="label">Your rating</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={rating === n} className="rounded p-1">
                  <Star className={`h-6 w-6 ${n <= rating ? 'fill-gold-400 text-gold-400' : 'text-fog-500'}`} aria-hidden />
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="review-text">Review (optional)</label>
            <textarea id="review-text" className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          {err && <Alert>{err}</Alert>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy}>{mine.data ? 'Update review' : 'Submit review'}</button>
            {mine.data && <button type="button" className="btn btn-ghost" onClick={() => void remove()}>Delete</button>}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-fog-300"><Link to="/login" className="text-gold-400 underline">Log in</Link> to rate and review.</p>
      )}
      <ul className="mt-6 space-y-4">
        {reviews.data?.map((r) => (
          <li key={r.id} className="rounded-lg border border-ink-600 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{r.display_name}</span>
              <span className="flex items-center gap-1 text-gold-400"><Star className="h-4 w-4 fill-current" aria-hidden />{r.rating}/5</span>
            </div>
            {/* React escapes text content; reviews are rendered as plain text only. */}
            {r.review_text && <p className="mt-2 whitespace-pre-wrap text-sm text-fog-300">{r.review_text}</p>}
            <p className="mt-2 text-xs text-fog-500">{formatDate(r.created_at)}</p>
          </li>
        ))}
        {reviews.data?.length === 0 && <li className="text-sm text-fog-500">No reviews yet.</li>}
      </ul>
    </section>
  );
}

export default function MovieDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { removedIds } = useCatalog();
  const { has, toggle } = useWatchlist();
  const { data: movie, loading, error, reload } = useAsync(() => getMovie(id), [id], true);
  const progress = useAsync(() => (user ? getProgress(user.id, id) : Promise.resolve(null)), [user?.id, id]);
  const [wlError, setWlError] = useState<string | null>(null);

  if (loading && !movie) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (error) return <PageContainer className="py-10"><ErrorState message={error} onRetry={reload} /></PageContainer>;
  if (!movie || removedIds.has(movie.id)) {
    return <PageContainer className="py-10"><EmptyState title="Movie not available" message="It may have been unpublished or removed." action={<Link to="/movies" className="btn btn-primary">Browse movies</Link>} /></PageContainer>;
  }

  const saved = has(movie.id);
  const resume = progress.data && !progress.data.completed && progress.data.position_seconds > 10;

  return (
    <article>
      <div className="relative isolate">
        {movie.backdrop_url && <img src={movie.backdrop_url} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-40" />}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-900 via-ink-900/80 to-ink-900/40" />
        <PageContainer className="grid gap-8 py-10 md:grid-cols-[16rem_1fr] md:py-16">
          <div className="mx-auto w-48 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 md:w-64"><div className="aspect-[2/3]"><Poster movie={movie} /></div></div>
          <div>
            <h1 className="font-display text-3xl font-bold sm:text-5xl">{movie.title}</h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fog-300">
              {movie.release_year && <span>{movie.release_year}</span>}
              {movie.duration_minutes && <span>{formatDuration(movie.duration_minutes)}</span>}
              {movie.language && <span>{movie.language}</span>}
              {movie.country && <span>{movie.country}</span>}
              {movie.rating_avg != null && <span className="flex items-center gap-1 text-gold-400"><Star className="h-4 w-4 fill-current" aria-hidden />{Number(movie.rating_avg).toFixed(1)} <span className="text-fog-500">({movie.rating_count})</span></span>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">{movie.genres.map((g) => <Link key={g} to={`/movies?genre=${encodeURIComponent(g)}`} className="rounded-full border border-white/20 px-3 py-0.5 text-xs hover:border-gold-400">{g}</Link>)}</div>
            <p className="mt-5 max-w-2xl leading-relaxed text-fog-100">{movie.description || 'No description available.'}</p>
            <dl className="mt-5 grid max-w-2xl gap-2 text-sm sm:grid-cols-[7rem_1fr]">
              {movie.director && <><dt className="text-fog-500">Director</dt><dd>{movie.director}</dd></>}
              {movie.cast.length > 0 && <><dt className="text-fog-500">Cast</dt><dd>{movie.cast.join(', ')}</dd></>}
            </dl>
            <div className="mt-7 flex flex-wrap gap-3">
              {movie.upload_status === 'ready' ? (
                <Link to={`/watch/${movie.id}`} className="btn btn-primary"><Play className="h-4 w-4 fill-current" aria-hidden />{resume ? 'Resume' : 'Watch Now'}</Link>
              ) : (
                <span className="btn btn-ghost cursor-default">Video processing…</span>
              )}
              {user && (
                <button type="button" className="btn btn-ghost" aria-pressed={saved} onClick={() => { setWlError(null); toggle(movie.id).catch((e: Error) => setWlError(e.message)); }}>
                  {saved ? <BookmarkCheck className="h-4 w-4 text-gold-400" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
                  {saved ? 'In watchlist' : 'Add to watchlist'}
                </button>
              )}
              {movie.trailer_url && (
                <a href={movie.trailer_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost"><Clapperboard className="h-4 w-4" aria-hidden />Trailer</a>
              )}
            </div>
            {wlError && <div className="mt-3 max-w-md"><Alert>{wlError}</Alert></div>}
          </div>
        </PageContainer>
      </div>
      <PageContainer className="pb-6"><Reviews movieId={movie.id} /></PageContainer>
    </article>
  );
}
