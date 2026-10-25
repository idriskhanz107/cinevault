import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { manifestUrl, signPlaybackToken } from '../lib/cloudflare';
import { HttpError, json, log, readJson, route } from '../lib/http';
import { optionalEnv, rateLimit, requireUser, supabaseAdmin } from '../lib/server';

const bodySchema = z.object({ movieId: z.uuid() });

/**
 * Issues a short-lived signed playback token. Access rules:
 *  - signed-in users: movie must be published and ready
 *  - admins: any movie whose video is ready (preview before publishing)
 */
export default route('POST', async (req) => {
  const user = await requireUser(req);
  await rateLimit('playback-token', user.id, 60, 600);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid request');

  const { data: movie, error } = await supabaseAdmin()
    .from('movies')
    .select('id, visibility, upload_status, video_asset_id')
    .eq('id', parsed.data.movieId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const visible = movie && (user.role === 'admin' || movie.visibility === 'published');
  if (!movie || !visible) throw new HttpError(404, 'Movie not found');
  if (movie.upload_status !== 'ready' || !movie.video_asset_id) {
    return json(409, { status: movie.upload_status, error: 'This video is not ready to stream yet.' });
  }

  const ttl = Number(optionalEnv('PLAYBACK_TOKEN_TTL_SECONDS', '14400'));
  const { token, expiresAt } = signPlaybackToken(movie.video_asset_id, ttl);
  log('info', 'playback token issued', { movieId: movie.id, userId: user.id });
  return json(200, { token, manifestUrl: manifestUrl(token), expiresAt });
});

export const config: Config = { path: '/api/playback-token' };
