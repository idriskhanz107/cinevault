import type { Config } from '@netlify/functions';
import { getVideo, verifyWebhook } from '../lib/cloudflare';
import { json, log, route } from '../lib/http';
import { applyVideoStatus } from '../lib/video-status';

/**
 * Cloudflare Stream webhook (configure it to POST here). Authenticated by HMAC
 * signature, not by user session. The payload is only used to learn the video uid;
 * the real state is re-fetched from Cloudflare so a forged body cannot change anything.
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

  const result = await applyVideoStatus(uid, await getVideo(uid));
  log('info', 'webhook applied', { uid, status: result.status });
  return json(200, { ok: true });
});

export const config: Config = { path: '/api/cloudflare-webhook' };
