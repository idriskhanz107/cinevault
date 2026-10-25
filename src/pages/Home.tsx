import { Link } from 'react-router-dom';
import { Film } from 'lucide-react';
import { Hero, HeroSkeleton } from '../components/Hero';
import { MovieRow } from '../components/MovieRow';
import { EmptyState, ErrorState, PageContainer } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { getHistory, listGenres, listMovies, trendingMovies } from '../lib/queries';
import { isConfigured, isDemoMode } from '../lib/env';
import type { Genre, Movie } from '../lib/types';

function GenreRow({ genre }: { genre: Genre }) {
  const { data, loading, error, reload } = useAsync(() => listMovies({ genre: genre.name, sort: 'popular' }, 0, 20).then((r) => r.movies), [genre.name], true);
  // Hide genres with no published movies instead of rendering empty rows.
  if (!loading && !error && data?.length === 0) return null;
  return <MovieRow title={genre.name} movies={data} loading={loading} error={error} onRetry={reload} seeAllTo={`/movies?genre=${encodeURIComponent(genre.name)}`} />;
}

export default function Home() {
  const { user } = useAuth();
  const featured = useAsync(() => listMovies({ sort: 'popular' }, 0, 1).then((r) => r.movies[0] as Movie | undefined), [], true);
  const trending = useAsync(() => trendingMovies(20), [], true);
  const recent = useAsync(() => listMovies({ sort: 'recent' }, 0, 20).then((r) => r.movies), [], true);
  const popular = useAsync(() => listMovies({ sort: 'popular' }, 0, 20).then((r) => r.movies), [], true);
  const rated = useAsync(() => listMovies({ sort: 'rating' }, 0, 20).then((r) => r.movies), [], true);
  const genres = useAsync(listGenres, []);
  const cont = useAsync(
    () => (user ? getHistory(user.id, { inProgressOnly: true, limit: 20 }) : Promise.resolve([])),
    [user?.id],
    true,
  );

  if (!isConfigured && !isDemoMode) {
    return (
      <PageContainer className="py-16">
        <EmptyState title="Connect your database" message="CineVault loads every movie from Supabase. Configure the environment variables described in the README, or start with VITE_DEMO_MODE=true to preview the interface with sample data." />
      </PageContainer>
    );
  }

  const noMovies = !recent.loading && !recent.error && recent.data?.length === 0;
  const continueMovies = cont.data?.map((h) => h.movie);
  const progress = Object.fromEntries((cont.data ?? []).map((h) => [h.movie.id, h.duration_seconds ? h.position_seconds / h.duration_seconds : 0]));

  return (
    <>
      {featured.loading && !featured.data ? <HeroSkeleton /> : featured.data ? <Hero movie={featured.data} /> : null}
      <PageContainer className="pb-8 pt-4">
        {recent.error && <ErrorState message={recent.error} onRetry={recent.reload} />}
        {noMovies && (
          <EmptyState
            icon={<Film className="h-10 w-10" aria-hidden />}
            title="No movies published yet"
            message="Once an administrator uploads and publishes a movie, it will appear here instantly."
            action={<Link to="/admin" className="btn btn-ghost">Go to admin dashboard</Link>}
          />
        )}
        {!noMovies && !recent.error && (
          <>
            {user && continueMovies && continueMovies.length > 0 && (
              <MovieRow title="Continue Watching" movies={continueMovies} loading={cont.loading} error={cont.error} progress={progress} />
            )}
            <MovieRow title="Trending Movies" movies={trending.data} loading={trending.loading} error={trending.error} onRetry={trending.reload} seeAllTo="/movies?sort=popular" />
            <MovieRow title="Recently Added" movies={recent.data} loading={recent.loading} error={recent.error} onRetry={recent.reload} seeAllTo="/recent" />
            <MovieRow title="Popular Movies" movies={popular.data} loading={popular.loading} error={popular.error} onRetry={popular.reload} seeAllTo="/movies?sort=popular" />
            <MovieRow title="Top Rated" movies={rated.data} loading={rated.loading} error={rated.error} onRetry={rated.reload} seeAllTo="/movies?sort=rating" />
            {genres.data?.slice(0, 8).map((g) => <GenreRow key={g.id} genre={g} />)}
          </>
        )}
      </PageContainer>
    </>
  );
}
