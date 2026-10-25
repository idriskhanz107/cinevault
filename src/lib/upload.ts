import * as tus from 'tus-js-client';
import { MAX_UPLOAD_BYTES } from './env';
import { ALLOWED_VIDEO_EXTENSIONS, ALLOWED_VIDEO_TYPES, ALLOWED_IMAGE_TYPES, MAX_POSTER_BYTES, fileExtension } from './schemas';
import { supabase } from './supabase';
import { formatBytes } from './format';

/** Client-side checks for fast feedback. The server re-validates everything. */
export function validateVideoFile(file: File): string | null {
  const typeOk = (ALLOWED_VIDEO_TYPES as readonly string[]).includes(file.type);
  const extOk = (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(fileExtension(file.name));
  if (!typeOk && !extOk) return `Unsupported video format. Allowed: ${ALLOWED_VIDEO_EXTENSIONS.join(', ')}.`;
  if (file.size === 0) return 'The selected file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return `File is too large (${formatBytes(file.size)}). Maximum is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  return null;
}

export function validatePosterFile(file: File): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Poster must be a JPEG, PNG or WebP image.';
  if (file.size > MAX_POSTER_BYTES) return `Poster is too large. Maximum is ${formatBytes(MAX_POSTER_BYTES)}.`;
  return null;
}

export interface VideoUploadHandle {
  start: () => void;
  abort: () => Promise<void>;
}

/**
 * Resumable upload straight to Cloudflare Stream using the one-time URL created by the
 * backend. The file never passes through Netlify. Interrupted uploads retry automatically
 * and can be resumed (same file) after a page reload via tus fingerprinting.
 */
export function uploadVideo(
  file: File,
  uploadUrl: string,
  cb: {
    onProgress: (sent: number, total: number) => void;
    onSuccess: () => void;
    onError: (message: string) => void;
    onRetry?: () => void;
  },
): VideoUploadHandle {
  const upload = new tus.Upload(file, {
    // Cloudflare requires chunks to be a multiple of 256 KiB (min 5 MiB).
    chunkSize: 50 * 1024 * 1024,
    uploadUrl,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    metadata: { filename: file.name, filetype: file.type },
    removeFingerprintOnSuccess: true,
    onProgress: cb.onProgress,
    onSuccess: () => cb.onSuccess(),
    onShouldRetry: (err, retryAttempt) => {
      const status = (err as tus.DetailedError).originalResponse?.getStatus();
      const retry = !status || status >= 500 || status === 429 || status === 408;
      if (retry && retryAttempt < 6) cb.onRetry?.();
      return retry;
    },
    onError: (err) => {
      const status = (err as tus.DetailedError).originalResponse?.getStatus();
      cb.onError(
        !navigator.onLine
          ? 'You appear to be offline. Reconnect and press "Retry upload" to continue where it stopped.'
          : status === 413
            ? 'The file is larger than the streaming provider allows.'
            : 'Upload interrupted. Press "Retry upload" to continue where it stopped.',
      );
    },
  });
  return {
    start: () => {
      void upload.findPreviousUploads().then((prev) => {
        if (prev[0]) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      });
    },
    abort: () => upload.abort(true),
  };
}

/** Uploads a poster/backdrop to the admin-only Supabase Storage bucket and returns its public URL. */
export async function uploadPoster(file: File, folder: 'posters' | 'backdrops' = 'posters'): Promise<string> {
  const problem = validatePosterFile(file);
  if (problem) throw new Error(problem);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type] ?? 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('posters').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
  if (error) throw new Error('Image upload failed. Check that you are signed in as an administrator.');
  return supabase.storage.from('posters').getPublicUrl(path).data.publicUrl;
}
