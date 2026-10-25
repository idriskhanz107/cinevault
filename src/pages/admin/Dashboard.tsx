import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Eye, EyeOff, Film, Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert, EmptyState, ErrorState, PageContainer, Spinner } from '../../components/ui';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import { adminListMovies, adminSetVisibility, adminStats, type AdminFilters } from '../../lib/queries';
import type { Movie } from '../../lib/types';

const STATUS_STYLE: Record<Movie['upload_status'], string> = {
  pending: 'bg-ink-600 text-fog-300',
  uploading: 'bg-blue-500/20 text-blue-300',
  processing: 'bg-gold-400/20 text-gold-400',
  ready: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-crimson-500/20 text-crimson-500',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-ink-800 p-4">
      <dt className="text-xs uppercase tracking-wide text-fog-500">{label}</dt>
      <dd className="mt-1 text-2xl font-bold">{value}</dd>
    </div>
  );
}

export default function Dashboard() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<AdminFilters['status']>('');
  const [visibility, setVisibility] = useState<AdminFilters['visibility']>('');
  const [sort, setSort] = useState<NonNullable<AdminFilters['sort']>>('created_at');
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const dq = useDebounced(q, 300);

  // `live` = refetch on realtime changes, so processing status updates appear automatically.
  const stats = useAsync(adminStats, [], true);
  const list = useAsync(() => adminListMovies({ q: dq, status, visibility, sort, ascending: asc }, page), [dq, status, visibility, sort, asc, page], true);
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 20));

  // Sync any still-processing videos with Cloudflare, then reload.
  const syncProcessing = async () => {
    const pending = list.data?.movies.filter((m) => m.upload_status === 'uploading' || m.upload_status === 'processing') ?? [];
    await Promise.allSettled(pending.map((m) => api.videoStatus(m.id)));
    list.reload();
    stats.reload();
  };

  const togglePublish = async (m: Movie) => {
    setActionError(null);
    setBusyId(m.id);
    try {
      await adminSetVisibility(m.id, m.visibility === 'published' ? 'draft' : 'published');
      list.reload(); stats.reload();
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not update the movie.'); }
    finally { setBusyId(null); }
  };

  const remove = async (m: Movie) => {
    if (!window.confirm(`Delete "${m.title}" permanently? The video file will also be removed.`)) return;
    setActionError(null);
    setBusyId(m.id);
    try { await api.deleteMovie(m.id); list.reload(); stats.reload(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not delete the movie.'); }
    finally { setBusyId(null); }
  };

  const s = stats.data;
  const SortBtn = ({ k, label }: { k: typeof sort; label: string }) => (
    <button type="button" className="inline-flex items-center gap-1 hover:text-gold-400" onClick={() => { if (sort === k) setAsc(!asc); else { setSort(k); setAsc(k === 'title'); } setPage(0); }}>
      {label}{sort === k && (asc ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
    </button>
  );

  return (
    <PageContainer className="py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Admin dashboard</h1>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => void syncProcessing()}>Refresh video status</button>
          <Link to="/admin/movies/new" className="btn btn-primary"><Plus className="h-4 w-4" aria-hidden />Add movie</Link>
        </div>
      </div>

      {stats.error ? <div className="mt-6"><ErrorState message={stats.error} onRetry={stats.reload} /></div> : (
        <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7" aria-label="Statistics">
          <Stat label="Total movies" value={s?.total ?? '–'} />
          <Stat label="Published" value={s?.published ?? '–'} />
          <Stat label="Ready" value={s?.ready ?? '–'} />
          <Stat label="In progress" value={s?.processing ?? '–'} />
          <Stat label="Failed" value={s?.failed ?? '–'} />
          <Stat label="Uploads" value={s?.uploadCount ?? '–'} />
          <Stat label="Uploaded size" value={s ? formatBytes(s.totalBytes) : '–'} />
        </dl>
      )}

      <form className="mt-8 grid gap-3 sm:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label="Filter collection">
        <div className="sm:col-span-2"><label className="label" htmlFor="aq">Search</label><input id="aq" type="search" className="input" value={q} maxLength={100} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Title, genre, director, cast…" /></div>
        <div><label className="label" htmlFor="as">Video status</label>
          <select id="as" className="input" value={status} onChange={(e) => { setStatus(e.target.value as AdminFilters['status']); setPage(0); }}>
            <option value="">All</option>{(['pending', 'uploading', 'processing', 'ready', 'failed'] as const).map((x) => <option key={x} value={x}>{x}</option>)}
          </select></div>
        <div><label className="label" htmlFor="av">Visibility</label>
          <select id="av" className="input" value={visibility} onChange={(e) => { setVisibility(e.target.value as AdminFilters['visibility']); setPage(0); }}>
            <option value="">All</option><option value="published">Published</option><option value="draft">Draft</option>
          </select></div>
      </form>

      {actionError && <div className="mt-4"><Alert>{actionError}</Alert></div>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-ink-600">
        {list.error ? <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>
          : list.loading && !list.data ? <div className="flex justify-center p-12"><Spinner /></div>
          : list.data?.movies.length === 0 ? <div className="p-4"><EmptyState icon={<Film className="h-10 w-10" aria-hidden />} title="No movies found" message="Add your first movie or adjust the filters." action={<Link to="/admin/movies/new" className="btn btn-primary">Add movie</Link>} /></div>
          : (
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Movie collection</caption>
              <thead className="bg-ink-800 text-xs uppercase text-fog-500">
                <tr>
                  <th scope="col" className="px-4 py-3"><SortBtn k="title" label="Title" /></th>
                  <th scope="col" className="px-4 py-3"><SortBtn k="release_year" label="Year" /></th>
                  <th scope="col" className="px-4 py-3">Video</th>
                  <th scope="col" className="px-4 py-3">Visibility</th>
                  <th scope="col" className="px-4 py-3"><SortBtn k="created_at" label="Added" /></th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600">
                {list.data?.movies.map((m) => (
                  <tr key={m.id} className="hover:bg-ink-800/60">
                    <td className="px-4 py-3 font-medium">{m.title}</td>
                    <td className="px-4 py-3 text-fog-300">{m.release_year ?? '—'}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[m.upload_status]}`}>{m.upload_status}</span></td>
                    <td className="px-4 py-3 text-fog-300">{m.visibility}</td>
                    <td className="px-4 py-3 text-fog-300">{formatDate(m.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" disabled={busyId === m.id || (m.visibility === 'draft' && m.upload_status !== 'ready')} onClick={() => void togglePublish(m)} className="rounded p-2 hover:bg-ink-600 disabled:opacity-40" aria-label={m.visibility === 'published' ? `Unpublish ${m.title}` : `Publish ${m.title}`} title={m.visibility === 'draft' && m.upload_status !== 'ready' ? 'Available once the video is ready' : undefined}>
                          {m.visibility === 'published' ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                        </button>
                        <Link to={`/admin/movies/${m.id}`} className="rounded p-2 hover:bg-ink-600" aria-label={`Edit ${m.title}`}><Pencil className="h-4 w-4" aria-hidden /></Link>
                        <button type="button" disabled={busyId === m.id} onClick={() => void remove(m)} className="rounded p-2 text-crimson-500 hover:bg-ink-600 disabled:opacity-40" aria-label={`Delete ${m.title}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button type="button" className="btn btn-ghost !py-1.5" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page + 1} of {pages}</span>
          <button type="button" className="btn btn-ghost !py-1.5" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      {s && s.recentUploads.length > 0 && (
        <section className="mt-10" aria-label="Recent uploads">
          <h2 className="text-lg font-bold">Recent uploads</h2>
          <ul className="mt-3 divide-y divide-ink-600 rounded-xl border border-ink-600 text-sm">
            {s.recentUploads.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate">{u.file_name}</span>
                <span className="shrink-0 text-xs text-fog-500">{formatBytes(Number(u.file_size_bytes))} · {formatDate(u.created_at)} · {u.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
