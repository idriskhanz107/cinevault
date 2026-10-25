import { createHmac, createPrivateKey, sign as rsaSign, timingSafeEqual } from 'node:crypto';
import { env } from './server';

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 15_000;

export type UploadStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';

export interface CfVideo {
  uid: string;
  readyToStream: boolean;
  duration?: number;
  status?: { state?: string; pctComplete?: string; errorReasonCode?: string; errorReasonText?: string };
}

function headers(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${env('CLOUDFLARE_STREAM_API_TOKEN')}`, ...extra };
}

function accountUrl(path: string) {
  return `${API}/accounts/${encodeURIComponent(env('CLOUDFLARE_ACCOUNT_ID'))}${path}`;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * Creates a resumable (tus) direct-creator upload. The browser uploads straight to
 * Cloudflare using the returned one-time URL; the API token never leaves the server.
 * Videos are created with requiresignedurls so they can only be played with a token.
 */
export async function createTusUpload(opts: { size: number; name: string; maxDurationSeconds: number }) {
  const metadata = [
    `name ${b64(opts.name)}`,
    'requiresignedurls',
    `maxDurationSeconds ${b64(String(opts.maxDurationSeconds))}`,
  ].join(',');

  const res = await fetch(accountUrl('/stream?direct_user=true'), {
    method: 'POST',
    headers: headers({
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(opts.size),
      'Upload-Metadata': metadata,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const uploadUrl = res.headers.get('location');
  const uid = res.headers.get('stream-media-id');
  if (!res.ok || !uploadUrl || !uid) {
    throw new Error(`cloudflare create upload failed: HTTP ${res.status}`);
  }
  if (!uploadUrl.startsWith('https://')) throw new Error('cloudflare returned a non-HTTPS upload URL');
  return { uid, uploadUrl };
}

export async function getVideo(uid: string): Promise<CfVideo | null> {
  const res = await fetch(accountUrl(`/stream/${encodeURIComponent(uid)}`), {
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cloudflare get video failed: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: CfVideo };
  return body.result ?? null;
}

export async function deleteVideo(uid: string): Promise<void> {
  const res = await fetch(accountUrl(`/stream/${encodeURIComponent(uid)}`), {
    method: 'DELETE',
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 404) throw new Error(`cloudflare delete video failed: HTTP ${res.status}`);
}

/** Maps Cloudflare's processing state to our upload_status values. */
export function mapState(video: CfVideo): { status: UploadStatus; error?: string } {
  const state = video.status?.state;
  if (video.readyToStream || state === 'ready') return { status: 'ready' };
  if (state === 'error') {
    return { status: 'failed', error: (video.status?.errorReasonText || 'Video processing failed').slice(0, 500) };
  }
  if (state === 'queued' || state === 'inprogress') return { status: 'processing' };
  return { status: 'uploading' };
}

/**
 * Signs a playback token locally (RS256) with a Cloudflare Stream signing key.
 * See: https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
 * CLOUDFLARE_STREAM_SIGNING_KEY_PEM is the base64 "pem" value returned when the key was created.
 */
export function signPlaybackToken(uid: string, ttlSeconds: number): { token: string; expiresAt: number } {
  const kid = env('CLOUDFLARE_STREAM_SIGNING_KEY_ID');
  const pem = Buffer.from(env('CLOUDFLARE_STREAM_SIGNING_KEY_PEM'), 'base64').toString('utf8');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const header = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const payload = b64url(JSON.stringify({ sub: uid, kid, exp, nbf: now - 60 }));
  const signature = rsaSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPrivateKey(pem));
  return { token: `${header}.${payload}.${b64url(signature)}`, expiresAt: exp };
}

export function manifestUrl(token: string): string {
  const code = env('CLOUDFLARE_STREAM_CUSTOMER_CODE');
  return `https://customer-${code}.cloudflarestream.com/${token}/manifest/video.m3u8`;
}

/**
 * Verifies a Cloudflare Stream webhook. Header format: `time=<unix>,sig1=<hex hmac>`
 * where hmac = HMAC-SHA256(secret, `${time}.${rawBody}`). Rejects stale timestamps.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const time = Number(parts.time);
  const sig = parts.sig1;
  if (!Number.isFinite(time) || !sig) return false;
  if (Math.abs(Date.now() / 1000 - time) > 300) return false;

  const expected = createHmac('sha256', env('CLOUDFLARE_STREAM_WEBHOOK_SECRET'))
    .update(`${time}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
