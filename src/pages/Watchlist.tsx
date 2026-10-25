import { Link } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { MovieCard } from '../components/MovieCard';
import { EmptyState, ErrorState, GridSkeleton, PageContainer } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useWatchlist } from '../context/WatchlistContext';
import { useAsync } from '../hooks/useAsync';
import { getWatchlist } from '../lib/queries';

export default function Watchlist() {
  const { user } = useAuth();
  const { ids } = useWatchlist();
  // Refetch whenever the set of saved ids changes (add/remove from anywhere).
  const { data, loading, error, reload } = useAsync(() => getWatchlist(user!.id), [user?.id, ids.size], true);
  const movies = data?.filter((m) => ids.has(m.id));

  return (
    <PageContainer className="py-8">
      <h1 className="font-display text-3xl font-bold">My Watchlist</h1>
      <div className="mt-6">
        {error ? <ErrorState message={error} onRetry={reload} />
          : loading && !data ? <GridSkeleton count={6} />
          : movies && movies.length === 0 ? (
            <EmptyState icon={<Bookmark className="h-10 w-10" aria-hidden />} title="Your watchlist is empty" message="Use the bookmark button on any movie to save it for later." action={<Link to="/movies" className="btn btn-primary">Browse movies</Link>} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {movies?.map((m) => <MovieCard key={m.id} movie={m} />)}
            </div>
          )}
      </div>
    </PageContainer>
  );
}
