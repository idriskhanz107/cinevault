import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { getVideo } from '../lib/cloudflare';
import { HttpError, json, readJson, route } from '../lib/http';
import { rateLimit, requireAdmin, supabaseAdmin } from '../lib/server';
import { applyVideoStatus } from '../lib/video-status';

const bodySchema = z.object({ movieId: z.uuid() });

/** Admin polls this while a video is uploading/processing; it syncs Cloudflare state into Supabase. */
export default route('POST', async (req) => {
  const admin = await requireAdmin(req);
  await rateLimit('video-status', admin.id, 240, 600);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid request');

  const { data: movie, error } = await supabaseAdmin()
    .from('movies').select('video_asset_id').eq('id', parsed.data.movieId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!movie) throw new HttpError(404, 'Movie not found');
  if (!movie.video_asset_id) return json(200, { status: 'pending', error: null });

  const video = await getVideo(movie.video_asset_id);
  // An asset that does not exist yet while the browser is still uploading is not a failure.
  if (!video) {
    const { data } = await supabaseAdmin()
      .from('uploads').select('status, created_at').eq('provider_uid', movie.video_asset_id).maybeSingle();
    const ageMs = data ? Date.now() - new Date(data.created_at).getTime() : Infinity;
    if (data?.status === 'uploading' && ageMs < 24 * 3600_000) return json(200, { status: 'uploading', error: null });
  }
  return json(200, await applyVideoStatus(movie.video_asset_id, video));
});

export const config: Config = { path: '/api/video-status' };
