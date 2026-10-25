/**
 * Mux Video integration for CineVault (server-side only).
 *
 * Wraps @mux/ts for direct-upload creation, asset status polling, asset
 * deletion, signed-JWT playback-token generation, and webhook verification.
 *
 * Key difference from Cloudflare Stream:
 *   - createDirectUpload() returns an upload.id (the TUS upload session
 *     identifier) and a one-time TUS URL.  The permanent asset.id is only
 *     assigned after the browser finishes uploading.
 *   - Store upload.id in uploads.provider_uid; write asset.id into
 *     movies.video_asset_id only after it becomes available (via webhook
 *     or polling).
 *
 * Environment variables required (server-side only, never exposed to the browser):
 *   MUX_TOKEN_ID             – Mux access-token ID
 *   MUX_TOKEN_SECRET         – Mux access-token secret
 *   MUX_SIGNING_KEY_ID       – Signing key ID for signed playback
 *   MUX_SIGNING_PRIVATE_KEY  – Base64-encoded PKCS8 PEM of the signing private key
 *   MUX_WEBHOOK_SECRET       – Webhook signing secret from Mux dashboard
 */

import { createHmac, createPrivateKey, sign as rsaSign, timingSafeEqual } from 'node:crypto';
import Mux from '@mux/ts';
import { env } from './server';

export type UploadStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';

/** Normalised view of a Mux asset used internally. */
export interface MuxAsset {
  /** Mux asset ID (the permanent identifier for playback & deletion). */
  assetId: string;
  /** The `signed` playback ID — needed to build the HLS URL and sign tokens. */
  playbackId: string | null;
  status: 'preparing' | 'ready' | 'errored';
  duration?: number;
}

let _mux: Mux | undefined;
function muxClient(): Mux {
  _mux ??= new Mux({
    tokenId: env('MUX_TOKEN_ID'),
    tokenSecret: env('MUX_TOKEN_SECRET'),
  });
  return _mux;
}

/**
 * Creates a Mux direct-upload session (TUS).  The browser uploads the file
 * directly to the returned URL; the video never passes through Netlify.
 *
 * Returns:
 *   uploadId  – Mux's upload.id, stored in uploads.provider_uid.
 *               This is NOT a playback asset ID.
 *   uploadUrl – One-time TUS-compatible URL to pass to the browser.
 *
 * Supported formats: MP4, MOV, MKV, WebM, AVI, and most common containers.
 * Mux transcodes source material server-side.  MKV files with complex
 * audio or subtitle tracks may require conversion to MP4 for broad
 * compatibility — this is a Mux limitation, not a CineVault restriction.
 * Maximum upload size per Mux's current documentation: 10 GB.
 */
export async function createDirectUpload(corsOrigin: string): Promise<{ uploadId: string; uploadUrl: string }> {
  const upload = await muxClient().video.uploads.create({
    cors_origin: corsOrigin,
    new_asset_settings: {
      // `signed` policy: playback requires a JWT from our playback-token function.
      playback_policies: ['signed'],
    },
    // Give browsers 7 days to complete a resumable TUS upload.
    timeout: 604800,
  });

  if (!upload.url) throw new Error('Mux did not return an upload URL');
  return { uploadId: upload.id, uploadUrl: upload.url };
}

/**
 * Polls the Mux upload record to check whether an asset has been created.
 * Returns the asset_id once available, or null if the upload is still waiting.
 */
export async function getUploadRecord(uploadId: string): Promise<{ assetId: string | null; uploadStatus: string }> {
  const upload = await muxClient().video.uploads.retrieve(uploadId);
  return {
    assetId: upload.asset_id ?? null,
    uploadStatus: upload.status,
  };
}

/**
 * Fetches a Mux asset by its permanent asset ID.
 * Returns null if the asset does not exist (404).
 */
export async function getAsset(assetId: string): Promise<MuxAsset | null> {
  const client = muxClient();
  let asset;
  try {
    asset = await client.video.assets.retrieve(assetId);
  } catch (err: unknown) {
    // @mux/ts throws an error with a `status` property (HTTP status code).
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) return null;
    throw err;
  }

  const signedPlaybackId = asset.playback_ids?.find((p) => p.policy === 'signed')?.id ?? null;
  return {
    assetId: asset.id,
    playbackId: signedPlaybackId,
    status: asset.status,
    duration: asset.duration,
  };
}

/**
 * Deletes a Mux asset by its permanent asset ID.
 * Ignores 404 (already deleted).  Safe to call with any string ID — the
 * caller must ensure it is a real Mux asset ID, not an upload ID.
 */
export async function deleteAsset(assetId: string): Promise<void> {
  try {
    await muxClient().video.assets.delete(assetId);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) return;
    throw err;
  }
}

/**
 * Cancels a Mux direct-upload session.
 * Should be called when a movie is deleted while the browser is still uploading
 * (i.e. video_asset_id holds an upload ID, not yet a permanent asset ID) to
 * prevent Mux from creating an orphaned asset after the movie row is gone.
 * Ignores 404 (already cancelled or completed) and 422 (upload already past
 * the waiting state — Mux rejects cancel for completed uploads).
 */
export async function cancelUpload(uploadId: string): Promise<void> {
  try {
    await muxClient().video.uploads.cancel(uploadId);
  } catch (err: unknown) {
    const status = err && typeof err === 'object' && 'status' in err
      ? (err as { status: number }).status
      : null;
    // 404 = already gone; 422 = upload is no longer cancellable (completed/errored).
    // Both are safe to ignore.
    if (status === 404 || status === 422) return;
    throw err;
  }
}

/** Maps a Mux asset status to the internal UploadStatus enum. */
export function mapState(asset: MuxAsset): { status: UploadStatus; error?: string } {
  if (asset.status === 'ready') return { status: 'ready' };
  if (asset.status === 'errored') return { status: 'failed', error: 'Mux video processing failed' };
  return { status: 'processing' }; // Mux 'preparing' maps to our 'processing'
}

// ---------------------------------------------------------------------------
// Playback token (RS256 JWT, signed with the Mux signing key)
// ---------------------------------------------------------------------------

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * Signs a Mux playback JWT (RS256) using the signing key configured in Netlify.
 *
 * MUX_SIGNING_PRIVATE_KEY must be the base64-encoded PKCS8 PEM value shown
 * in the Mux dashboard under Settings > Signing Keys.
 *
 * Claims per Mux spec:
 *   sub  – the signed playback ID (not the asset ID)
 *   aud  – "v" for video playback
 *   kid  – signing key ID (included in the JWT header)
 *   exp  – expiry (Unix seconds)
 *   iat  – issued-at (Unix seconds)
 */
export function signPlaybackToken(playbackId: string, ttlSeconds: number): { token: string; expiresAt: number } {
  const kid = env('MUX_SIGNING_KEY_ID');
  const pem = Buffer.from(env('MUX_SIGNING_PRIVATE_KEY'), 'base64').toString('utf8');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: playbackId, aud: 'v', exp, iat: now }));
  const signature = rsaSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPrivateKey(pem));
  return { token: `${header}.${payload}.${b64url(signature)}`, expiresAt: exp };
}

/** Returns the signed HLS manifest URL for the given playback ID and token. */
export function manifestUrl(playbackId: string, token: string): string {
  return `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8?token=${token}`;
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Verifies a Mux webhook signature.
 *
 * Mux sends:   mux-signature: t=<unix>,v1=<hmac-sha256-hex>
 * HMAC input:  `${t}.${rawBody}`
 * Secret:      MUX_WEBHOOK_SECRET (from Mux dashboard > Webhooks)
 *
 * Returns false (fail-closed) if the secret is not configured.
 * Timing-safe comparison is used to prevent timing attacks.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;

  const secret = process.env.MUX_WEBHOOK_SECRET;
  if (!secret) return false; // fail closed when not configured

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const time = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(time) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - time) > 300) return false; // reject stale (>5 min)

  const expected = createHmac('sha256', secret)
    .update(`${time}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
