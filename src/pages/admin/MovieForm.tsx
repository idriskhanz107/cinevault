import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Search, UploadCloud } from 'lucide-react';
import { Alert, PageContainer, Spinner } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { formatBytes, parseList } from '../../lib/format';
import { adminCreateDraft, adminUpdateMovie, getMovie, listGenres } from '../../lib/queries';
import { movieFieldsSchema, type MovieFields } from '../../lib/schemas';
import type { Movie } from '../../lib/types';
import { uploadPoster, uploadVideo, validateVideoFile, type VideoUploadHandle } from '../../lib/upload';
import { useAsync } from '../../hooks/useAsync';

interface FormState {
  title: string; description: string; release_year: string; release_date: string;
  genres: string[]; language: string; country: string; director: string; cast: string;
  duration_minutes: string; poster_url: string; backdrop_url: string; trailer_url: string;
  tmdb_id: number | null; popularity: number;
}

const EMPTY: FormState = {
  title: '', description: '', release_year: '', release_date: '', genres: [], language: '', country: '',
  director: '', cast: '', duration_minutes: '', poster_url: '', backdrop_url: '', trailer_url: '', tmdb_id: null, popularity: 0,
};

const fromMovie = (m: Movie): FormState => ({
  title: m.title, description: m.description, release_year: m.release_year?.toString() ?? '', release_date: m.release_date ?? '',
  genres: m.genres, language: m.language ?? '', country: m.country ?? '', director: m.director ?? '', cast: m.cast.join(', '),
  duration_minutes: m.duration_minutes?.toString() ?? '', poster_url: m.poster_url ?? '', backdrop_url: m.backdrop_url ?? '',
  trailer_url: m.trailer_url ?? '', tmdb_id: m.tmdb_id, popularity: Number(m.popularity) || 0,
});

const num = (v: string) => (v.trim() === '' ? null : Number(v));

type Phase = 'idle' | 'preparing' | 'uploading' | 'processing' | 'ready' | 'failed' | 'interrupted';

export default function MovieForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const existing = useAsync(() => (id ? getMovie(id) : Promise.resolve(null)), [id]);
  const genres = useAsync(listGenres, []);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(!editing);
  const [video, setVideo] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [movieId, setMovieId] = useState<string | null>(id ?? null);
  const handle = useRef<VideoUploadHandle | null>(null);
  const uploadUrl = useRef<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // tmdb
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbResults, setTmdbResults] = useState<{ tmdbId: number; title: string; releaseDate: string | null; posterUrl: string | null }[]>([]);
  const [tmdbBusy, setTmdbBusy] = useState(false);
  const [tmdbError, setTmdbError] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data && !loaded) { setForm(fromMovie(existing.data)); setLoaded(true); }
  }, [existing.data, loaded]);

  useEffect(() => () => { clearInterval(poll.current); void handle.current?.abort(); }, []);

  // Warn before leaving mid-upload.
  useEffect(() => {
    if (phase !== 'uploading') return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const buildFields = (): MovieFields | null => {
    const parsed = movieFieldsSchema.safeParse({
      title: form.title, description: form.description, release_year: num(form.release_year), release_date: form.release_date,
      genres: form.genres, language: form.language, country: form.country, director: form.director, cast: parseList(form.cast),
      duration_minutes: num(form.duration_minutes), poster_url: form.poster_url, backdrop_url: form.backdrop_url,
      trailer_url: form.trailer_url, tmdb_id: form.tmdb_id, popularity: form.popularity,
    });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`));
      return null;
    }
    setErrors([]);
    return parsed.data;
  };

  const searchTmdb = async () => {
    if (!tmdbQuery.trim()) return;
    setTmdbBusy(true); setTmdbError(null);
    try { setTmdbResults((await api.tmdbSearch(tmdbQuery.trim(), num(form.release_year) ?? undefined)).results); }
    catch (e) { setTmdbError(e instanceof Error ? e.message : 'TMDB lookup failed. You can enter the details manually.'); }
    finally { setTmdbBusy(false); }
  };

  const importTmdb = async (tmdbId: number) => {
    setTmdbBusy(true); setTmdbError(null);
    try {
      const { movie } = await api.tmdbDetails(tmdbId);
      setForm((f) => ({
        ...f,
        title: movie.title ?? f.title, description: movie.description ?? f.description,
        release_year: movie.release_year?.toString() ?? f.release_year, release_date: movie.release_date ?? f.release_date,
        genres: movie.genres?.length ? movie.genres : f.genres, language: movie.language ?? f.language, country: movie.country ?? f.country,
        director: movie.director ?? f.director, cast: movie.cast?.join(', ') ?? f.cast,
        duration_minutes: movie.duration_minutes?.toString() ?? f.duration_minutes, poster_url: movie.poster_url ?? f.poster_url,
        backdrop_url: movie.backdrop_url ?? f.backdrop_url, trailer_url: movie.trailer_url ?? f.trailer_url,
        tmdb_id: movie.tmdb_id ?? f.tmdb_id, popularity: movie.popularity ?? f.popularity,
      }));
      setTmdbResults([]);
      setNotice('Metadata imported from TMDB. Review it, then save.');
    } catch (e) { setTmdbError(e instanceof Error ? e.message : 'TMDB lookup failed. You can enter the details manually.'); }
    finally { setTmdbBusy(false); }
  };

  const onImage = async (file: File | undefined, key: 'poster_url' | 'backdrop_url') => {
    if (!file) return;
    try { set(key, await uploadPoster(file, key === 'poster_url' ? 'posters' : 'backdrops')); }
    catch (e) { setErrors([e instanceof Error ? e.message : 'Image upload failed.']); }
  };

  const watchProcessing = (mid: string) => {
    clearInterval(poll.current);
    setPhase('processing'); setStatusMsg('Cloudflare is processing the video…');
    poll.current = setInterval(() => {
      api.videoStatus(mid).then((r) => {
        if (r.status === 'ready') { clearInterval(poll.current); setPhase('ready'); setStatusMsg('Video is ready. You can now publish the movie.'); }
        else if (r.status === 'failed') { clearInterval(poll.current); setPhase('failed'); setStatusMsg(r.error || 'Video processing failed.'); }
      }).catch(() => undefined); // transient errors: keep polling
    }, 5000);
  };

  const beginBrowserUpload = (file: File, url: string, mid: string) => {
    setPhase('uploading'); setStatusMsg(null);
    handle.current = uploadVideo(file, url, {
      onProgress: (sent, total) => setProgress(total ? Math.round((sent / total) * 100) : 0),
      onRetry: () => setStatusMsg('Connection problem — retrying automatically…'),
      onSuccess: () => { setProgress(100); watchProcessing(mid); },
      onError: (message) => { setPhase('interrupted'); setStatusMsg(message); },
    });
    handle.current.start();
  };

  const retryUpload = () => {
    if (video && uploadUrl.current && movieId) beginBrowserUpload(video, uploadUrl.current, movieId);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const fields = buildFields();
    if (!fields) return;
    if (video) {
      const problem = validateVideoFile(video);
      if (problem) return setErrors([problem]);
    }
    setSaving(true);
    try {
      if (video) {
        setPhase('preparing');
        const r = await api.createUpload(fields, { name: video.name, size: video.size, type: video.type }, movieId ?? undefined);
        setMovieId(r.movieId); uploadUrl.current = r.uploadUrl;
        beginBrowserUpload(video, r.uploadUrl, r.movieId);
        setNotice('Movie saved. Keep this tab open until the upload finishes.');
        if (!editing) window.history.replaceState(null, '', `/admin/movies/${r.movieId}`);
      } else if (editing && id) {
        await adminUpdateMovie(id, fields);
        setNotice('Changes saved.');
      } else {
        // Metadata first; the video can be attached later from the edit screen.
        const newId = await adminCreateDraft(fields);
        navigate(`/admin/movies/${newId}`, { replace: true });
      }
    } catch (err) {
      setPhase('idle');
      setErrors([err instanceof ApiError || err instanceof Error ? err.message : 'Could not save the movie.']);
    } finally { setSaving(false); }
  };

  if (editing && (existing.loading || !loaded)) return <div className="flex justify-center py-24"><Spinner /></div>;

  const busyUpload = phase === 'preparing' || phase === 'uploading';

  return (
    <PageContainer className="py-8">
      <Link to="/admin" className="mb-4 inline-flex items-center gap-2 text-sm text-fog-300 hover:text-gold-400"><ArrowLeft className="h-4 w-4" aria-hidden />Dashboard</Link>
      <h1 className="font-display text-3xl font-bold">{editing ? 'Edit movie' : 'Add movie'}</h1>

      <section className="mt-6 rounded-xl bg-ink-800 p-4" aria-label="TMDB metadata lookup">
        <h2 className="text-sm font-semibold">Fetch metadata from TMDB (optional)</h2>
        <div className="mt-2 flex gap-2">
          <label htmlFor="tmdb-q" className="sr-only">Movie title</label>
          <input id="tmdb-q" className="input" placeholder="Search TMDB by title" value={tmdbQuery} onChange={(e) => setTmdbQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void searchTmdb(); } }} />
          <button type="button" className="btn btn-ghost" onClick={() => void searchTmdb()} disabled={tmdbBusy}><Search className="h-4 w-4" aria-hidden />Search</button>
        </div>
        {tmdbError && <div className="mt-2"><Alert>{tmdbError}</Alert></div>}
        {tmdbResults.length > 0 && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {tmdbResults.map((r) => (
              <li key={r.tmdbId}><button type="button" onClick={() => void importTmdb(r.tmdbId)} className="flex w-full items-center gap-3 rounded-lg bg-ink-700 p-2 text-left hover:bg-ink-600">
                {r.posterUrl ? <img src={r.posterUrl} alt="" className="h-14 w-10 rounded object-cover" /> : <div className="h-14 w-10 rounded bg-ink-500" />}
                <span><span className="block text-sm font-semibold">{r.title}</span><span className="text-xs text-fog-500">{r.releaseDate?.slice(0, 4) ?? 'Unknown year'}</span></span>
              </button></li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={submit} className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]" noValidate>
        <div className="space-y-4">
          <div><label className="label" htmlFor="title">Title *</label><input id="title" className="input" required maxLength={200} value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><label className="label" htmlFor="desc">Description</label><textarea id="desc" className="input" rows={5} maxLength={5000} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="year">Release year</label><input id="year" type="number" min={1888} max={2100} className="input" value={form.release_year} onChange={(e) => set('release_year', e.target.value)} /></div>
            <div><label className="label" htmlFor="date">Release date</label><input id="date" type="date" className="input" value={form.release_date} onChange={(e) => set('release_date', e.target.value)} /></div>
            <div><label className="label" htmlFor="dur">Duration (minutes)</label><input id="dur" type="number" min={1} max={1440} className="input" value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} /></div>
          </div>
          <fieldset>
            <legend className="label">Genres (up to 10)</legend>
            <div className="flex flex-wrap gap-2">
              {(genres.data?.map((g) => g.name) ?? []).concat(form.genres.filter((g) => !genres.data?.some((x) => x.name === g))).map((g) => {
                const on = form.genres.includes(g);
                return <button type="button" key={g} aria-pressed={on} onClick={() => set('genres', on ? form.genres.filter((x) => x !== g) : [...form.genres, g].slice(0, 10))} className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-gold-400 bg-gold-400/15 text-gold-400' : 'border-ink-500 text-fog-300 hover:border-fog-500'}`}>{g}</button>;
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="lang">Language</label><input id="lang" className="input" maxLength={60} value={form.language} onChange={(e) => set('language', e.target.value)} /></div>
            <div><label className="label" htmlFor="country">Country</label><input id="country" className="input" maxLength={100} value={form.country} onChange={(e) => set('country', e.target.value)} /></div>
          </div>
          <div><label className="label" htmlFor="dir">Director</label><input id="dir" className="input" maxLength={200} value={form.director} onChange={(e) => set('director', e.target.value)} /></div>
          <div><label className="label" htmlFor="cast">Cast (comma separated)</label><textarea id="cast" className="input" rows={2} value={form.cast} onChange={(e) => set('cast', e.target.value)} /></div>
          <div><label className="label" htmlFor="trailer">Trailer URL (https)</label><input id="trailer" type="url" className="input" value={form.trailer_url} onChange={(e) => set('trailer_url', e.target.value)} /></div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl bg-ink-800 p-4">
            <h2 className="text-sm font-semibold">Poster</h2>
            {form.poster_url && <img src={form.poster_url} alt="Poster preview" className="mt-2 w-32 rounded" />}
            <label className="label mt-2" htmlFor="poster-file">Upload image (JPEG, PNG, WebP, max 5 MB)</label>
            <input id="poster-file" type="file" accept="image/jpeg,image/png,image/webp" className="text-xs" onChange={(e) => void onImage(e.target.files?.[0], 'poster_url')} />
            <label className="label mt-2" htmlFor="poster-url">…or image URL</label>
            <input id="poster-url" type="url" className="input" value={form.poster_url} onChange={(e) => set('poster_url', e.target.value)} />
            <label className="label mt-2" htmlFor="bd-file">Backdrop image</label>
            <input id="bd-file" type="file" accept="image/jpeg,image/png,image/webp" className="text-xs" onChange={(e) => void onImage(e.target.files?.[0], 'backdrop_url')} />
            <input aria-label="Backdrop URL" type="url" className="input mt-2" value={form.backdrop_url} onChange={(e) => set('backdrop_url', e.target.value)} placeholder="Backdrop URL" />
          </div>

          <div className="rounded-xl bg-ink-800 p-4">
            <h2 className="text-sm font-semibold">{editing ? 'Replace video file' : 'Video file'}</h2>
            <label className="label mt-2" htmlFor="video-file">MP4, MOV, MKV, WebM, AVI</label>
            <input id="video-file" type="file" accept="video/*,.mkv" disabled={busyUpload} className="text-xs" onChange={(e) => { const f = e.target.files?.[0] ?? null; setVideo(f); if (f) { const p = validateVideoFile(f); setErrors(p ? [p] : []); } }} />
            {video && <p className="mt-1 text-xs text-fog-500">{video.name} · {formatBytes(video.size)}</p>}

            {phase !== 'idle' && (
              <div className="mt-4" aria-live="polite">
                <div className="mb-1 flex justify-between text-xs"><span className="capitalize">{phase === 'preparing' ? 'Preparing…' : phase}</span><span>{progress}%</span></div>
                <div className="h-2 overflow-hidden rounded bg-ink-600" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress"><div className={`h-full ${phase === 'failed' || phase === 'interrupted' ? 'bg-crimson-500' : 'bg-gold-400'} transition-all`} style={{ width: `${progress}%` }} /></div>
                {statusMsg && <p className="mt-2 text-xs text-fog-300">{statusMsg}</p>}
                {phase === 'interrupted' && <button type="button" className="btn btn-ghost mt-2 !py-1.5 text-xs" onClick={retryUpload}><UploadCloud className="h-4 w-4" aria-hidden />Retry upload</button>}
                {phase === 'ready' && movieId && <Link to="/admin" className="btn btn-primary mt-2 !py-1.5 text-xs">Back to dashboard to publish</Link>}
              </div>
            )}
          </div>

          {errors.length > 0 && <Alert><ul className="list-inside list-disc">{errors.map((er) => <li key={er}>{er}</li>)}</ul></Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          <button className="btn btn-primary w-full" disabled={saving || busyUpload}>{saving ? 'Saving…' : video ? 'Save & upload video' : editing ? 'Save changes' : 'Save movie'}</button>
        </aside>
      </form>
    </PageContainer>
  );
}
