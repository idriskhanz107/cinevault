import type { Config } from '@netlify/functions';
import { getVideo, verifyWebhook, mapState } from '../lib/cloudflare';
import { json, log, route } from '../lib/http';
import { supabaseAdmin } from '../lib/server';

/**
 * Legacy Cloudflare Stream webhook handler.
 *
 * This endpoint is kept for historical reference only.  New videos are uploaded
 * via Mux.  If you no longer have any Cloudflare Stream assets, this function
 * can be removed and its Netlify route deregistered.
 *
 * Applies a Cloudflare video state directly to the Supabase rows without going
 * through the shared video-status helper (which has been migrated to Mux types).
 */
export default route('POST', async (req) => {
  const raw = await req.text();
  if (raw.length > 65_536 || !verifyWebhook(raw, req.headers.get('webhook-signature'))) {
    return json(401, { error: 'Invalid signature' });
  }
  let uid: unknown;
  try {
    uid = (JSON.parse(raw) as { uid?: unknown }).uid;
  } catch {
    return json(400, { error: 'Invalid payload' });
  }
  if (typeof uid !== 'string' || !/^[A-Za-z0-9]{8,64}$/.test(uid)) return json(400, { error: 'Invalid payload' });

  const video = await getVideo(uid);
  const { status, error } = video
    ? mapState(video)
    : { status: 'failed' as const, error: 'Video asset not found at the streaming provider' };

  const sb = supabaseAdmin();
  const movieUpdate: Record<string, unknown> = { upload_status: status };
  if (status !== 'ready') movieUpdate.visibility = 'draft';

  const { data: movie, error: movieErr } = await sb
    .from('movies')
    .update(movieUpdate)
    .eq('video_asset_id', uid)
    .eq('video_provider', 'cloudflare_stream')
    .select('id, duration_minutes')
    .maybeSingle();
  if (movieErr) throw new Error(`movie status update failed: ${movieErr.message}`);

  if (movie && status === 'ready' && !movie.duration_minutes && video?.duration && video.duration > 0) {
    await sb
      .from('movies')
      .update({ duration_minutes: Math.max(1, Math.round(video.duration / 60)) })
      .eq('id', movie.id);
  }

  const { error: uploadErr } = await sb
    .from('uploads')
    .update({
      status,
      error_message: error ?? null,
      ready_at: status === 'ready' ? new Date().toISOString() : null,
    })
    .eq('provider_uid', uid);
  if (uploadErr) throw new Error(`upload status update failed: ${uploadErr.message}`);

  log('info', 'cloudflare webhook applied (legacy)', { uid, status });
  return json(200, { ok: true });
});

export const config: Config = { path: '/api/cloudflare-webhook' };
