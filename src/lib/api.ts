import { supabase } from './supabase';
import type { Movie } from './types';
import type { MovieFields } from './schemas';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Calls a Netlify Function with the user's Supabase access token. */
async function call<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Please sign in to continue.', 401);

  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Network error. Check your connection and try again.', 0);
  }

  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(payload.error || `Request failed (${res.status})`, res.status);
  return payload;
}

export interface CreateUploadResult {
  movieId: string;
  assetId: string;
  uploadUrl: string;
}

export const api = {
  createUpload: (movie: MovieFields, file: { name: string; size: number; type: string }, movieId?: string) =>
    call<CreateUploadResult>('create-upload', { movie, file, movieId }),

  videoStatus: (movieId: string) =>
    call<{ status: Movie['upload_status']; error: string | null }>('video-status', { movieId }),

  deleteMovie: (movieId: string) => call<{ ok: true }>('delete-movie', { movieId }),

  playbackToken: (movieId: string, signal?: AbortSignal) =>
    call<{ token: string; manifestUrl: string; expiresAt: number }>('playback-token', { movieId }, signal),

  tmdbSearch: (query: string, year?: number) =>
    call<{ results: { tmdbId: number; title: string; releaseDate: string | null; posterUrl: string | null }[] }>(
      'tmdb',
      { action: 'search', query, year },
    ),

  tmdbDetails: (tmdbId: number) =>
    call<{ movie: Partial<MovieFields> }>('tmdb', { action: 'details', tmdbId }),
};
