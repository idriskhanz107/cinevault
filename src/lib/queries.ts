import { isDemoMode } from './env';
import { DEMO_GENRES, DEMO_MOVIES } from './demo';
import { supabase } from './supabase';
import type { Genre, HistoryEntry, Movie, Review, UploadRecord } from './types';
import type { MovieFields } from './schemas';

export const PAGE_SIZE = 24;

export type SortKey = 'recent' | 'year' | 'title' | 'rating' | 'popular';

export interface MovieFilters {
  q?: string;
  genre?: string;
  year?: number;
  language?: string;
  sort?: SortKey;
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? 'Unknown database error');
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\s+/g, ' ').trim().slice(0, 100);
}

function sortDemo(list: Movie[], sort: SortKey): Movie[] {
  const copy = [...list];
  switch (sort) {
    case 'year': return copy.sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0));
    case 'title': return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'rating': return copy.sort((a, b) => (b.rating_avg ?? 0) - (a.rating_avg ?? 0));
    case 'popular': return copy.sort((a, b) => b.popularity - a.popularity);
    default: return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

/** Database-backed search / filter / sort with range pagination. RLS limits results to published movies. */
export async function listMovies(filters: MovieFilters = {}, page = 0, pageSize = PAGE_SIZE) {
  const sort = filters.sort ?? 'recent';

  if (isDemoMode) {
    const q = filters.q?.toLowerCase();
    let list = DEMO_MOVIES.filter(
      (m) =>
        (!q || [m.title, m.director, ...m.cast, ...m.genres, m.language, String(m.release_year)].join(' ').toLowerCase().includes(q)) &&
        (!filters.genre || m.genres.includes(filters.genre)) &&
        (!filters.year || m.release_year === filters.year) &&
        (!filters.language || m.language === filters.language),
    );
    list = sortDemo(list, sort);
    return { movies: list.slice(page * pageSize, (page + 1) * pageSize), total: list.length };
  }

  let query = supabase.from('movies').select('*', { count: 'exact' });
  const q = filters.q ? escapeLike(filters.q.toLowerCase()) : '';
  if (q) query = query.ilike('search_text', `%${q}%`);
  if (filters.genre) query = query.contains('genres', [filters.genre]);
  if (filters.year) query = query.eq('release_year', filters.year);
  if (filters.language) query = query.eq('language', filters.language);

  switch (sort) {
    case 'year': query = query.order('release_year', { ascending: false, nullsFirst: false }); break;
    case 'title': query = query.order('title', { ascending: true }); break;
    case 'rating': query = query.order('rating_avg', { ascending: false, nullsFirst: false }).order('rating_count', { ascending: false }); break;
    case 'popular': query = query.order('popularity', { ascending: false }); break;
    default: query = query.order('created_at', { ascending: false });
  }
  const { data, count, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
  if (error) fail(error);
  return { movies: (data ?? []) as Movie[], total: count ?? 0 };
}

export async function getMovie(id: string): Promise<Movie | null> {
  if (isDemoMode) return DEMO_MOVIES.find((m) => m.id === id) ?? null;
  const { data, error } = await supabase.from('movies').select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  return (data as Movie | null) ?? null;
}

export async function trendingMovies(limit = 20): Promise<Movie[]> {
  if (isDemoMode) return sortDemo(DEMO_MOVIES, 'popular').slice(0, limit);
  const { data, error } = await supabase.rpc('trending_movies', { days: 7, lim: limit });
  if (error) fail(error);
  return (data ?? []) as Movie[];
}

export async function suggest(term: string): Promise<Pick<Movie, 'id' | 'title' | 'release_year' | 'poster_url' | 'genres'>[]> {
  const { movies } = await listMovies({ q: term, sort: 'popular' }, 0, 6);
  return movies;
}

export async function listGenres(): Promise<Genre[]> {
  if (isDemoMode) return DEMO_GENRES;
  const { data, error } = await supabase.from('genres').select('*').order('name');
  if (error) fail(error);
  return (data ?? []) as Genre[];
}

export async function listLanguages(): Promise<string[]> {
  if (isDemoMode) return ['English'];
  const { data, error } = await supabase.from('movies').select('language').not('language', 'is', null).limit(1000);
  if (error) fail(error);
  return [...new Set((data ?? []).map((r) => r.language as string))].sort();
}

// ---------------------------------------------------------------- watchlist
export async function getWatchlistIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('watchlist').select('movie_id').eq('user_id', userId);
  if (error) fail(error);
  return new Set((data ?? []).map((r) => r.movie_id as string));
}

export async function getWatchlist(userId: string): Promise<Movie[]> {
  const { data, error } = await supabase
    .from('watchlist').select('added_at, movies(*)').eq('user_id', userId).order('added_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []).map((r: any) => r.movies).filter(Boolean) as Movie[];
}

export async function setWatchlisted(userId: string, movieId: string, on: boolean) {
  const { error } = on
    ? await supabase.from('watchlist').upsert({ user_id: userId, movie_id: movieId }, { onConflict: 'user_id,movie_id', ignoreDuplicates: true })
    : await supabase.from('watchlist').delete().eq('user_id', userId).eq('movie_id', movieId);
  if (error) fail(error);
}

// ------------------------------------------------------------------ history
export async function getHistory(userId: string, opts: { inProgressOnly?: boolean; limit?: number } = {}): Promise<HistoryEntry[]> {
  let query = supabase
    .from('viewing_history')
    .select('position_seconds, duration_seconds, completed, last_watched_at, movies(*)')
    .eq('user_id', userId)
    .order('last_watched_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.inProgressOnly) query = query.eq('completed', false).gt('position_seconds', 10);
  const { data, error } = await query;
  if (error) fail(error);
  return (data ?? [])
    .filter((r: any) => r.movies)
    .map((r: any) => ({
      movie: r.movies as Movie,
      position_seconds: r.position_seconds,
      duration_seconds: r.duration_seconds,
      completed: r.completed,
      last_watched_at: r.last_watched_at,
    }));
}

export async function getProgress(userId: string, movieId: string) {
  const { data, error } = await supabase
    .from('viewing_history').select('position_seconds, completed').eq('user_id', userId).eq('movie_id', movieId).maybeSingle();
  if (error) fail(error);
  return data as { position_seconds: number; completed: boolean } | null;
}

export async function saveProgress(userId: string, movieId: string, position: number, duration: number) {
  const completed = duration > 0 && position / duration > 0.95;
  const { error } = await supabase.from('viewing_history').upsert(
    {
      user_id: userId,
      movie_id: movieId,
      position_seconds: Math.max(0, Math.floor(position)),
      duration_seconds: duration > 0 ? Math.floor(duration) : null,
      completed,
      last_watched_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,movie_id' },
  );
  if (error) fail(error);
}

export async function clearHistory(userId: string) {
  const { error } = await supabase.from('viewing_history').delete().eq('user_id', userId);
  if (error) fail(error);
}

// ------------------------------------------------------------------ reviews
export async function getReviews(movieId: string): Promise<Review[]> {
  const { data, error } = await supabase
    .from('movie_reviews').select('*').eq('movie_id', movieId).order('created_at', { ascending: false }).limit(50);
  if (error) fail(error);
  return (data ?? []) as Review[];
}

export async function getMyReview(userId: string, movieId: string) {
  const { data, error } = await supabase
    .from('reviews').select('rating, review_text').eq('user_id', userId).eq('movie_id', movieId).maybeSingle();
  if (error) fail(error);
  return data as { rating: number; review_text: string | null } | null;
}

export async function saveReview(userId: string, movieId: string, rating: number, text: string) {
  const { error } = await supabase.from('reviews').upsert(
    { user_id: userId, movie_id: movieId, rating, review_text: text.trim() || null },
    { onConflict: 'user_id,movie_id' },
  );
  if (error) fail(error);
}

export async function deleteReview(userId: string, movieId: string) {
  const { error } = await supabase.from('reviews').delete().eq('user_id', userId).eq('movie_id', movieId);
  if (error) fail(error);
}

// -------------------------------------------------------------------- admin
export interface AdminFilters {
  q?: string;
  status?: Movie['upload_status'] | '';
  visibility?: Movie['visibility'] | '';
  sort?: 'created_at' | 'title' | 'release_year';
  ascending?: boolean;
}

export async function adminListMovies(f: AdminFilters, page: number, pageSize = 20) {
  let query = supabase.from('movies').select('*', { count: 'exact' });
  const q = f.q ? escapeLike(f.q.toLowerCase()) : '';
  if (q) query = query.ilike('search_text', `%${q}%`);
  if (f.status) query = query.eq('upload_status', f.status);
  if (f.visibility) query = query.eq('visibility', f.visibility);
  query = query.order(f.sort ?? 'created_at', { ascending: f.ascending ?? false });
  const { data, count, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
  if (error) fail(error);
  return { movies: (data ?? []) as Movie[], total: count ?? 0 };
}

export async function adminStats() {
  const count = async (build: (q: any) => any) => {
    const { count: c, error } = await build(supabase.from('movies').select('id', { count: 'exact', head: true }));
    if (error) fail(error);
    return (c as number) ?? 0;
  };
  const [total, published, ready, processing, failed] = await Promise.all([
    count((q) => q),
    count((q) => q.eq('visibility', 'published')),
    count((q) => q.eq('upload_status', 'ready')),
    count((q) => q.in('upload_status', ['uploading', 'processing'])),
    count((q) => q.eq('upload_status', 'failed')),
  ]);
  const { data: uploads, error } = await supabase
    .from('uploads').select('id, movie_id, file_name, file_size_bytes, status, created_at').order('created_at', { ascending: false }).limit(200);
  if (error) fail(error);
  const rows = (uploads ?? []) as UploadRecord[];
  return {
    total, published, ready, processing, failed,
    uploadCount: rows.length,
    totalBytes: rows.reduce((s, u) => s + Number(u.file_size_bytes), 0),
    recentUploads: rows.slice(0, 8),
  };
}

export async function adminUpdateMovie(id: string, fields: Partial<MovieFields>) {
  const { error } = await supabase.from('movies').update(fields).eq('id', id);
  if (error) fail(error);
}

export async function adminCreateDraft(fields: MovieFields): Promise<string> {
  const { data, error } = await supabase.from('movies').insert(fields).select('id').single();
  if (error) fail(error);
  return data.id as string;
}

export async function adminSetVisibility(id: string, visibility: Movie['visibility']) {
  const { error } = await supabase.from('movies').update({ visibility }).eq('id', id);
  if (error) {
    // movies_published_requires_ready check constraint
    if (error.message.includes('movies_published_requires_ready')) {
      throw new Error('This movie cannot be published until its video has finished processing.');
    }
    fail(error);
  }
}

export async function updateDisplayName(userId: string, displayName: string) {
  const { error } = await supabase.from('profiles').update({ display_name: displayName.trim().slice(0, 80) }).eq('id', userId);
  if (error) fail(error);
}
