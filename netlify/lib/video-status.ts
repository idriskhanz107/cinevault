import { getAsset, getUploadRecord, mapState, type MuxAsset } from './mux';
import { supabaseAdmin } from './server';

/**
 * Applies a Mux asset state to the movie and upload rows (service-role).
 *
 * Called from:
 *   - applyVideoStatusFromUploadId  (polling path)
 *   - /api/mux-webhook              (Mux webhook for asset.ready / asset.errored)
 *
 * The `assetId` parameter MUST be the permanent Mux asset ID, not an upload ID.
 * Both callers are responsible for resolving the upload ID → asset ID first.
 *
 * A movie that is no longer 'ready' is forced back to draft so the
 * movies_published_requires_ready constraint can never be violated.
 *
 * @param assetId   Permanent Mux asset ID stored in movies.video_asset_id.
 * @param asset     Asset fetched from Mux (null = not found → mark failed).
 * @param uploadId  The Mux upload ID whose row in `uploads` should be updated.
 *                  Always provide this when known — it ensures exactly the
 *                  correct row is updated even when multiple upload attempts
 *                  exist for the same movie.
 */
export async function applyVideoStatus(
  assetId: string,
  asset: MuxAsset | null,
  uploadId?: string,
) {
  const sb = supabaseAdmin();
  const { status, error } = asset
    ? mapState(asset)
    : { status: 'failed' as const, error: 'Video asset not found at the streaming provider' };

  const movieUpdate: Record<string, unknown> = { upload_status: status };
  if (status !== 'ready') movieUpdate.visibility = 'draft';

  const { data: movie, error: movieErr } = await sb
    .from('movies')
    .update(movieUpdate)
    .eq('video_asset_id', assetId)
    .eq('video_provider', 'mux')
    .select('id, duration_minutes')
    .maybeSingle();
  if (movieErr) throw new Error(`movie status update failed: ${movieErr.message}`);

  // Fill runtime from Mux-reported duration when the admin did not enter one.
  if (movie && status === 'ready' && !movie.duration_minutes && asset?.duration && asset.duration > 0) {
    await sb
      .from('movies')
      .update({ duration_minutes: Math.max(1, Math.round(asset.duration / 60)) })
      .eq('id', movie.id);
  }

  // Update the specific upload row by provider_uid when the upload ID is known.
  // This is always more precise than movie_id because a movie can have multiple
  // upload attempts in the uploads table.
  if (uploadId) {
    const { error: uploadErr } = await sb
      .from('uploads')
      .update({
        status,
        error_message: error ?? null,
        ready_at: status === 'ready' ? new Date().toISOString() : null,
      })
      .eq('provider_uid', uploadId);
    if (uploadErr) throw new Error(`upload status update failed: ${uploadErr.message}`);
  } else if (movie) {
    // uploadId not available — fall back to movie_id scoped to in-flight rows only.
    // This path should only be reached when the upload ID truly cannot be determined.
    const { error: uploadErr } = await sb
      .from('uploads')
      .update({
        status,
        error_message: error ?? null,
        ready_at: status === 'ready' ? new Date().toISOString() : null,
      })
      .eq('movie_id', movie.id)
      .in('status', ['uploading', 'processing']);
    if (uploadErr) throw new Error(`upload status update failed: ${uploadErr.message}`);
  }

  return { status, error: error ?? null };
}

/**
 * Resolves the current Mux state for a movie identified by the value stored in
 * movies.video_asset_id, which may be either:
 *
 *   (a) A Mux UPLOAD ID — stored temporarily at upload creation time, before
 *       the asset has been created by Mux.
 *   (b) A permanent Mux ASSET ID — written by the webhook or a previous poll.
 *
 * The function detects which case applies by checking the uploads table:
 * if a row with provider_uid = storedId exists, storedId is the upload ID.
 * Otherwise it is treated as an asset ID and the associated upload ID is
 * looked up from the uploads table by movie_id so that applyVideoStatus can
 * update the correct upload row by provider_uid in every code path.
 *
 * Once the asset ID is discovered, movies.video_asset_id is updated
 * immediately so subsequent polls take the fast path.
 *
 * Polling NEVER reverts a movie from 'processing' or 'ready' to 'uploading'
 * once the asset has been created at Mux.
 */
export async function applyVideoStatusFromUploadId(storedId: string): Promise<{
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'pending';
  error: string | null;
}> {
  const sb = supabaseAdmin();

  // Determine whether storedId is an upload ID or an asset ID by checking
  // for a matching row in uploads.provider_uid.
  const { data: uploadRow } = await sb
    .from('uploads')
    .select('movie_id, status, provider_uid')
    .eq('provider_uid', storedId)
    .maybeSingle();

  // ---------------------------------------------------------------------------
  // Fast path: storedId is the permanent asset ID (no upload row uses it as
  // provider_uid, meaning the webhook or a previous poll already resolved the
  // upload → asset swap).
  //
  // We still need the upload ID to update the correct row in `uploads`.
  // Look it up from the movie → uploads relationship.
  // ---------------------------------------------------------------------------
  if (!uploadRow) {
    const asset = await getAsset(storedId);
    if (!asset) {
      // Asset not found — leave the status as-is rather than marking failed,
      // since the movie row may have already been updated to 'ready' by the webhook.
      return { status: 'processing', error: null };
    }

    // Resolve the upload ID for this asset so the upload row is updated precisely.
    // Find the movie row to get the movie_id, then find its most recent upload row.
    const { data: movieRow } = await sb
      .from('movies')
      .select('id')
      .eq('video_asset_id', storedId)
      .eq('video_provider', 'mux')
      .maybeSingle();

    let resolvedUploadId: string | undefined;
    if (movieRow) {
      // Find the most recent upload row for this movie that is still in-flight
      // or was the last one processed. provider_uid holds the upload ID.
      const { data: latestUpload } = await sb
        .from('uploads')
        .select('provider_uid')
        .eq('movie_id', movieRow.id)
        .eq('provider', 'mux')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      resolvedUploadId = latestUpload?.provider_uid ?? undefined;
    }

    return applyVideoStatus(storedId, asset, resolvedUploadId);
  }

  // ---------------------------------------------------------------------------
  // storedId IS an upload ID. The movie row still holds it as video_asset_id.
  // ---------------------------------------------------------------------------
  const movieId = uploadRow.movie_id;
  if (!movieId) return { status: 'uploading', error: null };

  // Poll the Mux upload record to see whether an asset has been created yet.
  let uploadRecord: { assetId: string | null; uploadStatus: string };
  try {
    uploadRecord = await getUploadRecord(storedId);
  } catch (err: unknown) {
    // If the upload record is not found at Mux, treat as failed.
    const httpStatus = (err && typeof err === 'object' && 'status' in err)
      ? (err as { status: number }).status
      : null;
    if (httpStatus === 404) return { status: 'failed', error: 'Upload record not found at Mux' };
    throw err;
  }

  if (!uploadRecord.assetId) {
    // Asset not yet created — map the Mux upload status.
    if (uploadRecord.uploadStatus === 'errored') {
      await sb.from('movies').update({ upload_status: 'failed', visibility: 'draft' }).eq('id', movieId);
      await sb.from('uploads').update({ status: 'failed' }).eq('provider_uid', storedId);
      return { status: 'failed', error: 'Mux upload failed' };
    }
    if (uploadRecord.uploadStatus === 'timed_out') {
      await sb.from('movies').update({ upload_status: 'failed', visibility: 'draft' }).eq('id', movieId);
      await sb.from('uploads').update({ status: 'failed', error_message: 'Upload timed out' }).eq('provider_uid', storedId);
      return { status: 'failed', error: 'Upload timed out' };
    }
    // Still uploading / waiting — keep as uploading.
    return { status: 'uploading', error: null };
  }

  // Asset has been created — swap the upload ID for the real asset ID.
  const assetId = uploadRecord.assetId;
  await sb.from('movies').update({ video_asset_id: assetId }).eq('id', movieId);

  // Fetch the asset state and apply it, passing the upload ID (storedId)
  // so the exact upload row is updated by provider_uid.
  const asset = await getAsset(assetId);
  return applyVideoStatus(assetId, asset, storedId);
}
