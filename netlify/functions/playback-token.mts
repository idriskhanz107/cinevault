import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { signPlaybackToken, manifestUrl } from '../lib/mux';
import { HttpError, json, log, readJson, route } from '../lib/http';
import { optionalEnv, rateLimit, requireUser, supabaseAdmin } from '../lib/server';

const bodySchema = z.object({ movieId: z.uuid() });

/**
 * Issues a short-lived signed Mux playback token. Access rules:
 *  - signed-in users: movie must be published and ready
 *  - admins: any movie whose video is ready (preview before publishing)
 *
 * movies.video_asset_id contains the Mux ASSET ID for ready movies (not the
 * upload ID — the upload ID is temporary and replaced when the asset is created).
 * The playback token sub claim must be the signed PLAYBACK ID, which is fetched
 * from Supabase (stored after the webhook resolves it) or from Mux directly.
 */
export default route('POST', async (req) => {
  const user = await requireUser(req);
  await rateLimit('playback-token', user.id, 60, 600);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid request');

  const { data: movie, error } = await supabaseAdmin()
    .from('movies')
    .select('id, visibility, upload_status, video_asset_id, video_provider, playback_id')
    .eq('id', parsed.data.movieId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const visible = movie && (user.role === 'admin' || movie.visibility === 'published');
  if (!movie || !visible) throw new HttpError(404, 'Movie not found');
  if (movie.upload_status !== 'ready' || !movie.video_asset_id) {
    return json(409, { status: movie.upload_status, error: 'This video is not ready to stream yet.' });
  }
  if (movie.video_provider !== 'mux') {
    return json(409, { status: 'failed', error: 'This video was uploaded with a legacy provider and cannot be played.' });
  }

  // The playback token sub must be the signed playback ID, not the asset ID.
  // We try movies.playback_id first (set by the webhook), then fall back to
  // fetching it from Mux in real time.
  let playbackId: string | null = movie.playback_id ?? null;
  if (!playbackId) {
    const { getAsset } = await import('../lib/mux');
    const asset = await getAsset(movie.video_asset_id);
    playbackId = asset?.playbackId ?? null;
    if (playbackId) {
      // Cache it for future requests.
      await supabaseAdmin()
        .from('movies')
        .update({ playback_id: playbackId })
        .eq('id', movie.id);
    }
  }

  if (!playbackId) {
    return json(409, { status: 'failed', error: 'Playback ID is not yet available. Please try again shortly.' });
  }

  const ttl = Number(optionalEnv('PLAYBACK_TOKEN_TTL_SECONDS', '14400'));
  const { token, expiresAt } = signPlaybackToken(playbackId, ttl);
  log('info', 'playback token issued', { movieId: movie.id, userId: user.id });
  return json(200, { token, manifestUrl: manifestUrl(playbackId, token), expiresAt });
});

export const config: Config = { path: '/api/playback-token' };
