import type { Config } from '@netlify/functions';
import { getAsset, verifyWebhook } from '../lib/mux';
import { json, log, route } from '../lib/http';
import { applyVideoStatus } from '../lib/video-status';
import { supabaseAdmin } from '../lib/server';

/**
 * Mux webhook endpoint. Configure it in Mux dashboard > Webhooks to POST here.
 *
 * Mux signs requests with HMAC-SHA256. The signature header is:
 *   mux-signature: t=<unix>,v1=<hex>
 *
 * Set MUX_WEBHOOK_SECRET in Netlify to the signing secret shown in the Mux
 * dashboard after creating the webhook endpoint. Requests with invalid or
 * missing signatures are rejected with 401.
 *
 * SDK type reference (verified against @mux/ts WebhookDirectUpload / WebhookAsset):
 *
 *   video.upload.asset_created  (data: WebhookDirectUpload)
 *     data.id        = upload ID  (the session, NOT the asset)
 *     data.asset_id  = permanent asset ID (only set when status = 'asset_created')
 *     NOTE: no data.upload_id or data.playback_ids on this event type.
 *     Playback IDs are on the asset object; fetch from Mux API to get them.
 *
 *   video.asset.ready / video.asset.errored  (data: WebhookAsset)
 *     data.id         = asset ID
 *     data.status     = 'ready' | 'errored'
 *     data.upload_id  = the upload ID that created this asset (optional)
 *
 * Error handling:
 *   - 401 for invalid signature (Mux will not retry these).
 *   - 400 for malformed payload (Mux will not retry these).
 *   - 500 for required database write failures (Mux WILL retry on 5xx).
 *   - 200 for success or for gracefully-skipped events.
 *
 * Idempotency:
 *   - asset_created: if the movie row already holds the permanent asset ID (i.e.,
 *     polling resolved it first), the update WHERE clause won't match, which is
 *     correct — 200 is returned.
 *   - asset.ready/errored: always re-fetches from Mux before updating, so
 *     replaying this event is safe and produces the same outcome.
 *   - If the movie is already in a terminal state (ready), a late asset_created
 *     delivery will not downgrade it to 'processing'.
 */
export default route('POST', async (req) => {
  const raw = await req.text();
  if (raw.length > 65_536) return json(400, { error: 'Payload too large' });

  const sigHeader = req.headers.get('mux-signature');
  if (!verifyWebhook(raw, sigHeader)) {
    log('warn', 'mux webhook rejected: invalid signature');
    return json(401, { error: 'Invalid signature' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON payload' });
  }

  if (typeof payload !== 'object' || payload === null) return json(400, { error: 'Invalid payload' });

  const event = payload as { type?: unknown; data?: Record<string, unknown> };
  const eventType = typeof event.type === 'string' ? event.type : null;
  if (!eventType || typeof event.data !== 'object' || event.data === null) {
    return json(400, { error: 'Missing event type or data' });
  }

  const data = event.data;
  const sb = supabaseAdmin();

  // ---------------------------------------------------------------------------
  // video.upload.asset_created
  //
  // data is WebhookDirectUpload:
  //   data.id        → upload ID  (locate the movie row)
  //   data.asset_id  → permanent Mux asset ID  (write to movies.video_asset_id)
  //
  // Playback IDs are NOT present here. Fetch the asset from the Mux API.
  //
  // Idempotency: the UPDATE WHERE clause includes video_asset_id = uploadId, so
  // if the row has already been swapped to the asset ID by polling, the update
  // matches zero rows — this is correct, not an error.
  //
  // Race guard: if the movie already has upload_status = 'ready' (the asset.ready
  // webhook arrived first), do not downgrade it to 'processing'.
  // ---------------------------------------------------------------------------
  if (eventType === 'video.upload.asset_created') {
    const uploadId = typeof data.id === 'string' ? data.id : null;
    const assetId  = typeof data.asset_id === 'string' ? data.asset_id : null;

    if (!uploadId || !assetId) {
      log('warn', 'webhook: asset_created missing upload id or asset id', { type: eventType });
      return json(400, { error: 'Missing upload id or asset id' });
    }

    // Check whether the movie row still holds the upload ID before making any
    // Mux API calls. If polling already swapped the upload ID to the asset ID,
    // there is nothing to do — return 200 immediately (idempotent replay).
    // Guard against the race where asset.ready already set upload_status='ready';
    // in that case we update the asset ID but do NOT touch upload_status.
    const { data: existingMovie, error: lookupErr } = await sb
      .from('movies')
      .select('id, upload_status, video_asset_id')
      .eq('video_asset_id', uploadId)
      .eq('video_provider', 'mux')
      .maybeSingle();

    if (lookupErr) {
      log('error', 'webhook: movie lookup failed on asset_created', { message: lookupErr.message });
      return json(500, { error: 'Database lookup failed' });
    }

    if (!existingMovie) {
      // Movie row not found with this upload ID — either already swapped by
      // polling (idempotent replay) or upload ID unknown. Either way: 200.
      log('info', 'webhook: asset_created skipped (movie already resolved or not found)', { uploadId, assetId });
      return json(200, { ok: true });
    }

    // The movie still holds the upload ID — fetch the asset for the playback ID,
    // then perform the swap. This Mux API call is deferred to here so we skip it
    // entirely when the event is an idempotent replay.
    const asset = await getAsset(assetId);
    const signedPlaybackId = asset?.playbackId ?? null;

    const alreadyReady = existingMovie.upload_status === 'ready';
    const movieUpdateFields: Record<string, unknown> = {
      video_asset_id: assetId,
      ...(signedPlaybackId ? { playback_id: signedPlaybackId } : {}),
      video_provider: 'mux',
    };
    // Only set to 'processing' if not already in a terminal/later state.
    if (!alreadyReady) {
      movieUpdateFields.upload_status = 'processing';
    }

    const { error: movieErr } = await sb
      .from('movies')
      .update(movieUpdateFields)
      .eq('id', existingMovie.id);
    if (movieErr) {
      log('error', 'webhook: failed to update movie on asset_created', { message: movieErr.message });
      return json(500, { error: 'Failed to update movie' });
    }

    const { error: uploadErr } = await sb
      .from('uploads')
      .update({ status: alreadyReady ? 'ready' : 'processing' })
      .eq('provider_uid', uploadId);
    if (uploadErr) {
      log('error', 'webhook: failed to update upload on asset_created', { message: uploadErr.message });
      return json(500, { error: 'Failed to update upload row' });
    }

    log('info', 'webhook: asset_created', { uploadId, assetId, alreadyReady });
    return json(200, { ok: true });
  }

  // ---------------------------------------------------------------------------
  // video.asset.ready / video.asset.errored
  //
  // data is WebhookAsset:
  //   data.id         → asset ID
  //   data.upload_id  → upload ID (optional, set for direct uploads)
  //
  // Re-fetch from Mux for authoritative state (never trust the webhook body
  // for security-sensitive status changes). Replay-safe because applyVideoStatus
  // is idempotent when called with the same asset ID and state.
  // DB write errors return 500 so Mux will retry.
  // ---------------------------------------------------------------------------
  if (eventType === 'video.asset.ready' || eventType === 'video.asset.errored') {
    const assetId  = typeof data.id === 'string' ? data.id : null;
    const uploadId = typeof data.upload_id === 'string' ? data.upload_id : null;

    if (!assetId) {
      log('warn', 'webhook: asset event missing asset id', { type: eventType });
      return json(400, { error: 'Missing asset id' });
    }

    // Re-fetch from Mux for authoritative state.
    const asset = await getAsset(assetId);

    // Cache the playback ID if we have it.
    if (asset?.playbackId) {
      const { error: pbErr } = await sb
        .from('movies')
        .update({ playback_id: asset.playbackId })
        .eq('video_asset_id', assetId)
        .eq('video_provider', 'mux');
      if (pbErr) {
        log('error', 'webhook: failed to cache playback_id', { message: pbErr.message });
        return json(500, { error: 'Failed to cache playback ID' });
      }
    }

    // applyVideoStatus throws on DB error; the route wrapper converts that to 500.
    const result = await applyVideoStatus(assetId, asset, uploadId ?? undefined);
    log('info', 'webhook applied', { assetId, eventType, status: result.status });
    return json(200, { ok: true });
  }

  // All other event types: acknowledge and ignore.
  return json(200, { ok: true });
});

export const config: Config = { path: '/api/mux-webhook' };
