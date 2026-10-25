import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MovieCard } from '../components/MovieCard';
import { Alert, EmptyState, ErrorState, GridSkeleton, PageContainer } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { formatDate } from '../lib/format';
import { clearHistory, getHistory, updateDisplayName } from '../lib/queries';

export default function Profile() {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useAsync(() => getHistory(user!.id, { limit: 60 }), [user?.id], true);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateDisplayName(user.id, name);
      await refreshProfile();
      setMsg({ kind: 'success', text: 'Profile updated.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update profile.' });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!user || !window.confirm('Clear your entire viewing history?')) return;
    try {
      await clearHistory(user.id);
      history.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Could not clear history.' });
    }
  };

  return (
    <PageContainer className="py-8">
      <h1 className="font-display text-3xl font-bold">Your profile</h1>
      <form onSubmit={save} className="mt-6 max-w-md space-y-4 rounded-xl bg-ink-800 p-5">
        <div>
          <label className="label" htmlFor="pe">Email</label>
          <input id="pe" className="input" value={user?.email ?? ''} disabled readOnly />
        </div>
        <div>
          <label className="label" htmlFor="pn">Display name</label>
          <input id="pn" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={busy}>Save</button>
          {profile?.role === 'admin' && <Link to="/admin" className="text-sm text-gold-400 hover:underline">Admin dashboard</Link>}
        </div>
      </form>

      <section className="mt-10" aria-label="Viewing history">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Viewing history</h2>
          {history.data && history.data.length > 0 && <button type="button" onClick={() => void clear()} className="btn btn-ghost !py-1.5 text-xs">Clear history</button>}
        </div>
        <div className="mt-4">
          {history.error ? <ErrorState message={history.error} onRetry={history.reload} />
            : history.loading && !history.data ? <GridSkeleton count={6} />
            : history.data?.length === 0 ? <EmptyState title="Nothing watched yet" message="Movies you watch will be listed here." action={<Link to="/movies" className="btn btn-primary">Find something to watch</Link>} />
            : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {history.data?.map((h) => (
                  <div key={h.movie.id}>
                    <MovieCard movie={h.movie} progress={h.completed ? 1 : h.duration_seconds ? h.position_seconds / h.duration_seconds : 0} />
                    <p className="mt-0.5 text-xs text-fog-500">{h.completed ? 'Watched' : 'In progress'} · {formatDate(h.last_watched_at)}</p>
                  </div>
                ))}
              </div>
            )}
        </div>
      </section>
    </PageContainer>
  );
}
