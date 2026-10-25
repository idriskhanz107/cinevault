import type { Config } from '@netlify/functions';
import { createUploadSchema, ALLOWED_VIDEO_EXTENSIONS, ALLOWED_VIDEO_TYPES, fileExtension } from '../../src/lib/schemas';
import { createDirectUpload, deleteAsset } from '../lib/mux';
import { HttpError, json, log, readJson, route } from '../lib/http';
import { optionalEnv, rateLimit, requireAdmin, supabaseAdmin } from '../lib/server';

export default route('POST', async (req) => {
  const admin = await requireAdmin(req);
  await rateLimit('create-upload', admin.id, 20, 3600);

  const parsed = createUploadSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid request');
  }
  const { movie, movieId, file } = parsed.data;

  // Enforce file type and size on the server (client checks are UX only).
  // Mux supports files up to 10 GB; we allow up to MAX_UPLOAD_BYTES (default 10 GiB).
  const maxBytes = Number(optionalEnv('MAX_UPLOAD_BYTES', String(10 * 1024 * 1024 * 1024)));
  if (file.size > maxBytes) {
    throw new HttpError(413, `File exceeds the maximum upload size of ${Math.floor(maxBytes / 1024 ** 2)} MB`);
  }
  const typeOk = (ALLOWED_VIDEO_TYPES as readonly string[]).includes(file.type);
  const extOk = (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(fileExtension(file.name));
  if (!typeOk && !extOk) throw new HttpError(415, 'Unsupported video format');

  const sb = supabaseAdmin();

  // Extract the origin from the request so Mux can allow CORS on the upload URL.
  const origin = req.headers.get('origin') ?? req.headers.get('referer')?.replace(/\/[^/]*$/, '') ?? '*';

  // Ask Mux for a one-time resumable (TUS) upload URL.
  // uploadId is the Mux upload session ID — NOT the permanent asset ID.
  const { uploadId, uploadUrl } = await createDirectUpload(origin);

  // Temporarily store uploadId in video_asset_id so polling can locate this movie.
  // It will be replaced with the real Mux asset ID once the upload completes.
  const newVideoFields = {
    video_asset_id: uploadId,
    video_provider: 'mux',
    upload_status: 'uploading',
    visibility: 'draft',
  } as const;

  let savedId: string;

  // Snapshot of every field we will overwrite, so we can restore them exactly
  // if the uploads-table insert fails. Null means "this is a new movie row".
  type MovieSnapshot = {
    video_asset_id: string | null;
    video_provider: string | null;
    upload_status: string;
    visibility: string;
    playback_id: string | null;
  } | null;
  let originalSnapshot: MovieSnapshot = null;

  // For Mux assets that were previously in place, track the asset ID so we can
  // schedule cleanup after a successful new upload.
  let oldMuxAssetId: string | null = null;

  // Whether the movie row has been written with the new uploadId.
  let movieWritten = false;

  try {
    if (movieId) {
      const { data: existing, error: findErr } = await sb
        .from('movies')
        .select('id, video_asset_id, video_provider, upload_status, visibility, playback_id')
        .eq('id', movieId)
        .maybeSingle();
      if (findErr) throw new Error(findErr.message);
      if (!existing) throw new HttpError(404, 'Movie not found');

      // Record the full original video-related state for precise rollback.
      originalSnapshot = {
        video_asset_id: existing.video_asset_id ?? null,
        video_provider: existing.video_provider ?? null,
        upload_status: existing.upload_status,
        visibility: existing.visibility,
        playback_id: existing.playback_id ?? null,
      };

      // Only Mux assets can be deleted via this path; Cloudflare assets require
      // the old Cloudflare credentials which are no longer required.
      if (existing.video_provider === 'mux' && existing.video_asset_id) {
        oldMuxAssetId = existing.video_asset_id;
      }

      const { error } = await sb.from('movies').update({ ...movie, ...newVideoFields, playback_id: null }).eq('id', movieId);
      if (error) throw new Error(error.message);
      movieWritten = true;
      savedId = movieId;
    } else {
      const { data, error } = await sb
        .from('movies').insert({ ...movie, ...newVideoFields, created_by: admin.id }).select('id').single();
      if (error) throw new Error(error.message);
      movieWritten = true;
      savedId = data.id;
    }

    const { error: upErr } = await sb.from('uploads').insert({
      movie_id: savedId,
      created_by: admin.id,
      provider: 'mux',
      provider_uid: uploadId,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      status: 'uploading',
    });
    if (upErr) throw new Error(upErr.message);
  } catch (err) {
    // If the movie row was written but the upload row insert failed, restore
    // the original video-related fields so the row is not left in an
    // unresolvable state. For new movies, delete the row entirely.
    if (movieWritten) {
      if (movieId && originalSnapshot) {
        // Restore exactly what was there before, including the original provider,
        // asset ID, upload status, visibility, and playback ID.
        await sb.from('movies').update({
          video_asset_id: originalSnapshot.video_asset_id,
          video_provider: originalSnapshot.video_provider,
          upload_status: originalSnapshot.upload_status,
          visibility: originalSnapshot.visibility,
          playback_id: originalSnapshot.playback_id,
        }).eq('id', movieId).then(() => undefined, () => undefined);
      } else if (savedId!) {
        // New movie — delete the row entirely (no original state to restore).
        await sb.from('movies').delete().eq('id', savedId).then(() => undefined, () => undefined);
      }
    }
    log('warn', 'upload creation failed after Mux session was created', { uploadId, message: String(err) });
    throw err;
  }

  // Delete the previous Mux asset asynchronously — only after all DB writes
  // have succeeded so we never lose the reference prematurely.
  if (oldMuxAssetId && oldMuxAssetId !== uploadId) {
    deleteAsset(oldMuxAssetId).catch((e) =>
      log('warn', 'old Mux asset cleanup failed', { assetId: oldMuxAssetId, message: String(e) }),
    );
  }

  log('info', 'upload created', { movieId: savedId, adminId: admin.id });
  // Return uploadId as assetId for compatibility with the existing frontend contract.
  // The frontend only uses this value to display status; the real asset ID is
  // resolved server-side via polling/webhook.
  return json(201, { movieId: savedId, assetId: uploadId, uploadUrl });
});

export const config: Config = { path: '/api/create-upload' };
