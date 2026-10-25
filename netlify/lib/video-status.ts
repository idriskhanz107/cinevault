import { mapState, type CfVideo } from './cloudflare';
import { supabaseAdmin } from './server';

/**
 * Applies a Cloudflare video state to the movie and upload rows (service role).
 * A movie that is no longer 'ready' is forced back to draft so the
 * movies_published_requires_ready constraint can never be violated.
 */
export async function applyVideoStatus(uid: string, video: CfVideo | null) {
  const sb = supabaseAdmin();
  const { status, error } = video
    ? mapState(video)
    : { status: 'failed' as const, error: 'Video asset not found at the streaming provider' };

  const movieUpdate: Record<string, unknown> = { upload_status: status };
  if (status !== 'ready') movieUpdate.visibility = 'draft';

  const { data: movie, error: movieErr } = await sb
    .from('movies')
    .update(movieUpdate)
    .eq('video_asset_id', uid)
    .select('id, duration_minutes')
    .maybeSingle();
  if (movieErr) throw new Error(`movie status update failed: ${movieErr.message}`);

  // Fill the runtime from the real video duration when the admin did not enter one.
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

  return { status, error: error ?? null };
}
