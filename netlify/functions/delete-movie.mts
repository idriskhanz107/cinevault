import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { deleteAsset, cancelUpload } from '../lib/mux';
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
    .from('movies')
    .select('id, video_asset_id, video_provider, upload_status')
    .eq('id', parsed.data.movieId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!movie) throw new HttpError(404, 'Movie not found');

  // Remove the Mux asset (or cancel the in-flight upload) before deleting the row
  // so we don't leave orphaned assets at Mux.
  // Cloudflare assets on legacy records are skipped — they would require
  // CLOUDFLARE_* credentials which are no longer required.
  if (movie.video_asset_id && movie.video_provider === 'mux') {
    // If the movie is still uploading, video_asset_id holds the Mux upload ID
    // (not yet an asset ID). Cancel the upload so Mux doesn't create an orphaned
    // asset after the movie row is deleted.
    if (movie.upload_status === 'uploading') {
      await cancelUpload(movie.video_asset_id);
    } else {
      await deleteAsset(movie.video_asset_id);
    }
  }

  const { error: delErr } = await sb.from('movies').delete().eq('id', movie.id);
  if (delErr) throw new Error(delErr.message);

  log('info', 'movie deleted', { movieId: movie.id, adminId: admin.id });
  return json(200, { ok: true });
});

export const config: Config = { path: '/api/delete-movie' };
