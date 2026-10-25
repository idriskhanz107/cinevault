import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, LogIn } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { Alert, EmptyState, ErrorState, PageContainer, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useAsync } from '../hooks/useAsync';
import { ApiError, api } from '../lib/api';
import { isDemoMode } from '../lib/env';
import { getMovie, getProgress, saveProgress } from '../lib/queries';

interface Playback {
  manifestUrl: string;
  expiresAt: number;
}

export default function Watch() {
  const { id = '' } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { removedIds } = useCatalog();
  // `live` so a processing movie flips to the player the moment it becomes ready/published.
  const movie = useAsync(() => getMovie(id), [id], true);
  const resume = useAsync(() => (user ? getProgress(user.id, id) : Promise.resolve(null)), [user?.id, id]);

  const [playback, setPlayback] = useState<Playback | null>(null);
  const [playError, setPlayError] = useState<{ message: string; processing?: boolean } | null>(null);
  const [fetching, setFetching] = useState(false);
  const ready = movie.data?.upload_status === 'ready' && Boolean(movie.data?.video_asset_id || isDemoMode);

  const fetchToken = useCallback(async () => {
    setFetching(true);
    setPlayError(null);
    try {
      const r = await api.playbackToken(id);
      setPlayback({ manifestUrl: r.manifestUrl, expiresAt: r.expiresAt });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setPlayError({ message: 'This video is still processing. Please check back shortly.', processing: true });
      else if (e instanceof ApiError && e.status === 404) setPlayError({ message: 'This movie is not available.' });
      else setPlayError({ message: e instanceof Error ? e.message : 'Could not start playback.' });
    } finally {
      setFetching(false);
    }
  }, [id]);

  useEffect(() => {
    if (!user || !ready || isDemoMode) return;
    void fetchToken();
  }, [user, ready, fetchToken]);

  // Save progress; throttled by the player. Failures never interrupt playback.
  const lastWrite = useRef(0);
  const onProgress = useCallback(
    (pos: number, dur: number) => {
      if (!user || !id) return;
      const now = Date.now();
      if (now - lastWrite.current < 4000) return;
      lastWrite.current = now;
      void saveProgress(user.id, id, pos, dur).catch(() => undefined);
    },
    [user, id],
  );

  // Make sure the history row exists as soon as the user starts watching.
  useEffect(() => {
    if (user && playback) void saveProgress(user.id, id, resume.data?.position_seconds ?? 0, 0).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback?.manifestUrl]);

  if (authLoading || (movie.loading && !movie.data)) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (isDemoMode) return <Navigate to={`/movie/${id}`} replace />;

  const m = movie.data;
  return (
    <PageContainer className="py-6">
      <Link to={`/movie/${id}`} className="mb-4 inline-flex items-center gap-2 text-sm text-fog-300 hover:text-gold-400"><ArrowLeft className="h-4 w-4" aria-hidden />Back to details</Link>
      {movie.error ? (
        <ErrorState message={movie.error} onRetry={movie.reload} />
      ) : !m || removedIds.has(m.id) ? (
        <EmptyState title="Movie not available" message="It may have been unpublished or removed." action={<Link to="/movies" className="btn btn-primary">Browse movies</Link>} />
      ) : !user ? (
        <EmptyState icon={<LogIn className="h-10 w-10" aria-hidden />} title="Log in to watch" message="Create a free account or log in to stream this movie." action={<Link to="/login" state={{ from: `/watch/${id}` }} className="btn btn-primary">Log in</Link>} />
      ) : !ready || playError?.processing ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-ink-800 text-center">
          {m.upload_status === 'failed' ? (
            <Alert>Video processing failed. An administrator needs to re-upload this movie.</Alert>
          ) : (
            <>
              <Clock className="h-10 w-10 text-gold-400" aria-hidden />
              <p className="font-semibold">This video is still processing</p>
              <p className="max-w-sm text-sm text-fog-300">It will become playable automatically as soon as processing completes.</p>
            </>
          )}
        </div>
      ) : playError ? (
        <ErrorState message={playError.message} onRetry={() => void fetchToken()} />
      ) : fetching || !playback ? (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-ink-800"><Spinner label="Preparing video" /></div>
      ) : (
        <VideoPlayer
          src={playback.manifestUrl}
          poster={m.backdrop_url ?? m.poster_url}
          title={m.title}
          startAt={resume.loading ? 0 : resume.data && !resume.data.completed ? resume.data.position_seconds : 0}
          onProgress={onProgress}
          onAuthError={() => void fetchToken()}
        />
      )}
      {m && (
        <div className="mt-6 max-w-3xl">
          <h1 className="font-display text-2xl font-bold">{m.title}</h1>
          <p className="mt-2 text-sm text-fog-300">{m.description}</p>
        </div>
      )}
    </PageContainer>
  );
}
