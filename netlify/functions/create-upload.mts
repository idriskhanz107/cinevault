import type { Config } from '@netlify/functions';
import { createUploadSchema, ALLOWED_VIDEO_EXTENSIONS, ALLOWED_VIDEO_TYPES, fileExtension } from '../../src/lib/schemas';
import { createTusUpload, deleteVideo } from '../lib/cloudflare';
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

  // Enforce file type and size on the server (client checks are only UX).
  const maxBytes = Number(optionalEnv('MAX_UPLOAD_BYTES', String(10 * 1024 * 1024 * 1024)));
  if (file.size > maxBytes) {
    throw new HttpError(413, `File exceeds the maximum upload size of ${Math.floor(maxBytes / 1024 ** 2)} MB`);
  }
  const typeOk = (ALLOWED_VIDEO_TYPES as readonly string[]).includes(file.type);
  const extOk = (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(fileExtension(file.name));
  if (!typeOk && !extOk) throw new HttpError(415, 'Unsupported video format');

  const maxDurationSeconds = Number(optionalEnv('MAX_VIDEO_DURATION_SECONDS', '21600'));
  const sb = supabaseAdmin();

  // Ask Cloudflare for a one-time resumable upload URL.
  const { uid, uploadUrl } = await createTusUpload({
    size: file.size,
    name: movie.title,
    maxDurationSeconds,
  });

  const video = { video_asset_id: uid, upload_status: 'uploading', visibility: 'draft' } as const;
  let savedId: string;
  let oldAsset: string | null = null;

  try {
    if (movieId) {
      const { data: existing, error: findErr } = await sb
        .from('movies').select('id, video_asset_id').eq('id', movieId).maybeSingle();
      if (findErr) throw new Error(findErr.message);
      if (!existing) throw new HttpError(404, 'Movie not found');
      oldAsset = existing.video_asset_id;
      const { error } = await sb.from('movies').update({ ...movie, ...video }).eq('id', movieId);
      if (error) throw new Error(error.message);
      savedId = movieId;
    } else {
      const { data, error } = await sb
        .from('movies').insert({ ...movie, ...video, created_by: admin.id }).select('id').single();
      if (error) throw new Error(error.message);
      savedId = data.id;
    }

    const { error: upErr } = await sb.from('uploads').insert({
      movie_id: savedId,
      created_by: admin.id,
      provider_uid: uid,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      status: 'uploading',
    });
    if (upErr) throw new Error(upErr.message);
  } catch (err) {
    // Don't leave an orphaned asset at the provider if we could not record it.
    await deleteVideo(uid).catch(() => undefined);
    throw err;
  }

  if (oldAsset && oldAsset !== uid) {
    await deleteVideo(oldAsset).catch((e) => log('warn', 'old asset cleanup failed', { message: String(e) }));
  }

  log('info', 'upload created', { movieId: savedId, adminId: admin.id });
  return json(201, { movieId: savedId, assetId: uid, uploadUrl });
});

export const config: Config = { path: '/api/create-upload' };
