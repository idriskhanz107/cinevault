import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { HttpError, json, readJson, route } from '../lib/http';
import { rateLimit, requireAdmin, supabaseAdmin } from '../lib/server';
import { applyVideoStatusFromUploadId } from '../lib/video-status';

const bodySchema = z.object({ movieId: z.uuid() });

/** Admin polls this while a video is uploading/processing; it syncs Mux state into Supabase. */
export default route('POST', async (req) => {
  const admin = await requireAdmin(req);
  await rateLimit('video-status', admin.id, 240, 600);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid request');

  const { data: movie, error } = await supabaseAdmin()
    .from('movies')
    .select('video_asset_id, video_provider, upload_status')
    .eq('id', parsed.data.movieId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!movie) throw new HttpError(404, 'Movie not found');

  // No video associated yet.
  if (!movie.video_asset_id) return json(200, { status: 'pending', error: null });

  // Only handle Mux records via this path.
  if (movie.video_provider !== 'mux') {
    return json(200, { status: movie.upload_status, error: null });
  }

  // video_asset_id holds either:
  //   (a) the Mux upload ID (while the browser is still uploading / Mux hasn't created the asset yet)
  //   (b) the real Mux asset ID (after the webhook or a previous poll resolved it)
  // applyVideoStatusFromUploadId handles both cases.
  const result = await applyVideoStatusFromUploadId(movie.video_asset_id);
  return json(200, result);
});

export const config: Config = { path: '/api/video-status' };
