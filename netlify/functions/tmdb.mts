import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { HttpError, json, readJson, route } from '../lib/http';
import { env, rateLimit, requireAdmin } from '../lib/server';

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('search'), query: z.string().trim().min(1).max(100), year: z.number().int().min(1888).max(2100).optional() }),
  z.object({ action: z.literal('details'), tmdbId: z.number().int().positive() }),
]);

async function tmdb(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${TMDB}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // Bearer "API Read Access Token" (v4) - kept server-side only.
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env('TMDB_API_READ_TOKEN')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new HttpError(404, 'Movie not found on TMDB');
  if (!res.ok) throw new Error(`tmdb request failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, any>;
}

const img = (size: string, path?: string | null) => (path ? `${IMG}/${size}${path}` : null);

/** Admin-only proxy so the TMDB token never reaches the browser. */
export default route('POST', async (req) => {
  const admin = await requireAdmin(req);
  await rateLimit('tmdb', admin.id, 120, 600);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid request');
  const body = parsed.data;

  if (body.action === 'search') {
    const data = await tmdb('/search/movie', {
      query: body.query,
      include_adult: 'false',
      ...(body.year ? { year: String(body.year) } : {}),
    });
    const results = (data.results as any[]).slice(0, 8).map((m) => ({
      tmdbId: m.id as number,
      title: m.title as string,
      releaseDate: (m.release_date as string) || null,
      posterUrl: img('w185', m.poster_path),
    }));
    return json(200, { results });
  }

  const m = await tmdb(`/movie/${body.tmdbId}`, { append_to_response: 'credits,videos' });
  const trailer = (m.videos?.results as any[] | undefined)?.find(
    (v) => v.site === 'YouTube' && v.type === 'Trailer' && /^[\w-]{6,20}$/.test(v.key),
  );
  const languages = (m.spoken_languages as any[] | undefined) ?? [];
  const release: string | null = m.release_date || null;

  return json(200, {
    movie: {
      title: m.title,
      description: m.overview ?? '',
      release_date: release,
      release_year: release ? Number(release.slice(0, 4)) : null,
      genres: ((m.genres as any[]) ?? []).map((g) => g.name),
      language: languages[0]?.english_name ?? null,
      country: ((m.production_countries as any[]) ?? [])[0]?.name ?? null,
      director: ((m.credits?.crew as any[]) ?? []).find((c) => c.job === 'Director')?.name ?? null,
      cast: ((m.credits?.cast as any[]) ?? []).slice(0, 12).map((c) => c.name),
      duration_minutes: m.runtime || null,
      poster_url: img('w780', m.poster_path),
      backdrop_url: img('w1280', m.backdrop_path),
      trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
      tmdb_id: m.id,
      popularity: Number(m.popularity) || 0,
    },
  });
});

export const config: Config = { path: '/api/tmdb' };
