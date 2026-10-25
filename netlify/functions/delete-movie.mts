import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { deleteVideo } from '../lib/cloudflare';
import { HttpError, json, log, readJson, route } from '../lib/http';
import { rateLimit, requireAdmin, supabaseAdmin } from '../lib/server';

const bodySchema = z.object({ movieId: z.uuid() });

export default route('POST', async (req) => {
  const admin = await requireAdmin(req);
  await rateLimit('delete-movie', admin.id, 60, 3600);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid request');
  const sb = supabaseAdmin();

  const { data: movie, error } = await sb
    .from('movies').select('id, video_asset_id').eq('id', parsed.data.movieId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!movie) throw new HttpError(404, 'Movie not found');

  // Remove the video first; if that fails keep the row so the admin can retry.
  if (movie.video_asset_id) await deleteVideo(movie.video_asset_id);

  const { error: delErr } = await sb.from('movies').delete().eq('id', movie.id);
  if (delErr) throw new Error(delErr.message);

  log('info', 'movie deleted', { movieId: movie.id, adminId: admin.id });
  return json(200, { ok: true });
});

export const config: Config = { path: '/api/delete-movie' };
