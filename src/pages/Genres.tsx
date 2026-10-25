import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, PageContainer } from '../components/ui';
import { MovieRow } from '../components/MovieRow';
import { useAsync } from '../hooks/useAsync';
import { listGenres, listMovies } from '../lib/queries';
import type { Genre } from '../lib/types';

function GenreSection({ genre }: { genre: Genre }) {
  const { data, loading, error, reload } = useAsync(() => listMovies({ genre: genre.name, sort: 'recent' }, 0, 20).then((r) => r.movies), [genre.name], true);
  if (!loading && !error && data?.length === 0) return null;
  return <MovieRow title={genre.name} movies={data} loading={loading} error={error} onRetry={reload} seeAllTo={`/movies?genre=${encodeURIComponent(genre.name)}`} />;
}

export default function Genres() {
  const genres = useAsync(listGenres, []);
  return (
    <PageContainer className="py-8">
      <h1 className="font-display text-3xl font-bold">Genres</h1>
      {genres.error && <div className="mt-6"><ErrorState message={genres.error} onRetry={genres.reload} /></div>}
      {genres.data && genres.data.length === 0 && <div className="mt-6"><EmptyState title="No genres defined" /></div>}
      <div className="mt-5 flex flex-wrap gap-2" role="list" aria-label="All genres">
        {genres.data?.map((g) => (
          <Link key={g.id} role="listitem" to={`/movies?genre=${encodeURIComponent(g.name)}`} className="rounded-full border border-ink-500 bg-ink-800 px-4 py-1.5 text-sm hover:border-gold-400 hover:text-gold-400">{g.name}</Link>
        ))}
      </div>
      <div className="mt-6">{genres.data?.map((g) => <GenreSection key={g.id} genre={g} />)}</div>
    </PageContainer>
  );
}
