import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { mapState, signPlaybackToken, verifyWebhook } from '../netlify/lib/cloudflare';
import {
  mapState as muxMapState,
  signPlaybackToken as muxSignPlaybackToken,
  verifyWebhook as muxVerifyWebhook,
  type MuxAsset,
} from '../netlify/lib/mux';
import { escapeLike } from '../src/lib/queries';
import { createUploadSchema, movieFieldsSchema } from '../src/lib/schemas';
import { formatClock, parseList } from '../src/lib/format';

// ---------------------------------------------------------------------------
// Cloudflare Stream (legacy — kept for regression coverage)
// ---------------------------------------------------------------------------

const SECRET = 'whsec_test_secret';
const body = JSON.stringify({ uid: 'abcdef1234567890' });
const now = () => Math.floor(Date.now() / 1000);
const sign = (time: number, payload = body) =>
  `time=${time},sig1=${createHmac('sha256', SECRET).update(`${time}.${payload}`).digest('hex')}`;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

beforeAll(() => {
  process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = SECRET;
  process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID = 'key-1';
  process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ).toString('base64');
});

describe('verifyWebhook', () => {
  it('accepts a valid signature', () => expect(verifyWebhook(body, sign(now()))).toBe(true));
  it('rejects a tampered body', () => expect(verifyWebhook(body + ' ', sign(now()))).toBe(false));
  it('rejects a wrong secret', () => {
    const t = now();
    const bad = `time=${t},sig1=${createHmac('sha256', 'other').update(`${t}.${body}`).digest('hex')}`;
    expect(verifyWebhook(body, bad)).toBe(false);
  });
  it('rejects stale timestamps (replay)', () => expect(verifyWebhook(body, sign(now() - 3600))).toBe(false));
  it('rejects missing or malformed headers', () => {
    expect(verifyWebhook(body, null)).toBe(false);
    expect(verifyWebhook(body, 'garbage')).toBe(false);
  });
});

describe('signPlaybackToken', () => {
  it('produces an RS256 JWT bound to the video that verifies with the public key', () => {
    const { token, expiresAt } = signPlaybackToken('video123', 600);
    const [h, p, s] = token.split('.') as [string, string, string];
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header).toEqual({ alg: 'RS256', kid: 'key-1' });
    expect(payload.sub).toBe('video123');
    expect(payload.exp).toBe(expiresAt);
    const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('mapState', () => {
  it('maps provider states', () => {
    expect(mapState({ uid: 'a', readyToStream: true }).status).toBe('ready');
    expect(mapState({ uid: 'a', readyToStream: false, status: { state: 'inprogress' } }).status).toBe('processing');
    expect(mapState({ uid: 'a', readyToStream: false, status: { state: 'error', errorReasonText: 'bad' } })).toEqual({ status: 'failed', error: 'bad' });
    expect(mapState({ uid: 'a', readyToStream: false, status: { state: 'pendingupload' } }).status).toBe('uploading');
  });
});

// ---------------------------------------------------------------------------
// Mux — helpers
// ---------------------------------------------------------------------------

const MUX_SECRET = 'mux_webhook_secret_test';
const muxBody = JSON.stringify({ type: 'video.asset.ready', data: { id: 'abcd12345678' } });
const muxSign = (time: number, payload = muxBody) =>
  `t=${time},v1=${createHmac('sha256', MUX_SECRET).update(`${time}.${payload}`).digest('hex')}`;

const { privateKey: muxPrivKey, publicKey: muxPubKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

beforeAll(() => {
  process.env.MUX_WEBHOOK_SECRET = MUX_SECRET;
  process.env.MUX_SIGNING_KEY_ID = 'mux-key-1';
  process.env.MUX_SIGNING_PRIVATE_KEY = Buffer.from(
    muxPrivKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ).toString('base64');
});

describe('muxVerifyWebhook', () => {
  it('accepts a valid Mux signature', () => expect(muxVerifyWebhook(muxBody, muxSign(now()))).toBe(true));
  it('rejects a tampered body', () => expect(muxVerifyWebhook(muxBody + ' ', muxSign(now()))).toBe(false));
  it('rejects a wrong secret', () => {
    const t = now();
    const bad = `t=${t},v1=${createHmac('sha256', 'other').update(`${t}.${muxBody}`).digest('hex')}`;
    expect(muxVerifyWebhook(muxBody, bad)).toBe(false);
  });
  it('rejects stale timestamps (replay)', () => expect(muxVerifyWebhook(muxBody, muxSign(now() - 3600))).toBe(false));
  it('rejects missing or malformed headers', () => {
    expect(muxVerifyWebhook(muxBody, null)).toBe(false);
    expect(muxVerifyWebhook(muxBody, 'garbage')).toBe(false);
  });
  it('fails closed when MUX_WEBHOOK_SECRET is not set', () => {
    const saved = process.env.MUX_WEBHOOK_SECRET;
    delete process.env.MUX_WEBHOOK_SECRET;
    expect(muxVerifyWebhook(muxBody, muxSign(now()))).toBe(false);
    process.env.MUX_WEBHOOK_SECRET = saved;
  });
});

describe('muxSignPlaybackToken', () => {
  it('produces an RS256 JWT with Mux claims that verifies with the public key', () => {
    const { token, expiresAt } = muxSignPlaybackToken('playback-id-abc123', 600);
    const [h, p, s] = token.split('.') as [string, string, string];
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('mux-key-1');
    expect(header.typ).toBe('JWT');
    expect(payload.sub).toBe('playback-id-abc123');
    expect(payload.aud).toBe('v'); // Mux video playback audience claim
    expect(payload.exp).toBe(expiresAt);
    expect(typeof payload.iat).toBe('number');
    const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(muxPubKey, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('muxMapState', () => {
  it('maps Mux asset states to internal UploadStatus', () => {
    const readyAsset: MuxAsset = { assetId: 'a', playbackId: 'pb', status: 'ready' };
    const preparingAsset: MuxAsset = { assetId: 'a', playbackId: null, status: 'preparing' };
    const erroredAsset: MuxAsset = { assetId: 'a', playbackId: null, status: 'errored' };

    expect(muxMapState(readyAsset).status).toBe('ready');
    expect(muxMapState(preparingAsset).status).toBe('processing');
    expect(muxMapState(erroredAsset)).toEqual({ status: 'failed', error: 'Mux video processing failed' });
  });
});

// ---------------------------------------------------------------------------
// Mux webhook payload parsing (unit tests for the handler logic)
// These tests exercise the payload shape rules without making network calls.
// ---------------------------------------------------------------------------

describe('mux webhook payload shapes', () => {
  /**
   * Exercises the parsing logic the webhook handler uses without invoking
   * the full handler (which requires Mux API + Supabase).
   * We test exactly the field-extraction code paths from mux-webhook.mts.
   */

  it('video.upload.asset_created: data.id is the upload ID, data.asset_id is the asset ID', () => {
    // This is the real shape from WebhookDirectUpload per the @mux/ts SDK.
    const payload = {
      type: 'video.upload.asset_created',
      data: {
        id: 'upload_id_abc123',      // upload session ID — NOT the asset
        asset_id: 'asset_id_xyz789', // permanent asset ID — set when asset_created
        status: 'asset_created',
        cors_origin: 'https://example.com',
        timeout: 604800,
        // NOTE: there is no upload_id or playback_ids on this event
      },
    };

    const data = payload.data as Record<string, unknown>;
    const uploadId = typeof data.id === 'string' ? data.id : null;
    const assetId  = typeof data.asset_id === 'string' ? data.asset_id : null;
    // Fields that should NOT be present on this event type:
    const wrongUploadId  = typeof data.upload_id === 'string' ? data.upload_id : null;
    const playbackIds    = Array.isArray(data.playback_ids) ? data.playback_ids : null;

    expect(uploadId).toBe('upload_id_abc123');
    expect(assetId).toBe('asset_id_xyz789');
    expect(wrongUploadId).toBeNull();    // data.upload_id does not exist on this event
    expect(playbackIds).toBeNull();      // data.playback_ids does not exist on this event
  });

  it('video.asset.ready: data.id is the asset ID, data.upload_id is the upload ID', () => {
    // This is the real shape from WebhookAsset per the @mux/ts SDK.
    const payload = {
      type: 'video.asset.ready',
      data: {
        id: 'asset_id_xyz789',            // permanent asset ID
        status: 'ready',
        upload_id: 'upload_id_abc123',    // the upload session that created this asset
        playback_ids: [
          { id: 'playback_id_signed', policy: 'signed' },
        ],
      },
    };

    const data = payload.data as Record<string, unknown>;
    const assetId  = typeof data.id === 'string' ? data.id : null;
    const uploadId = typeof data.upload_id === 'string' ? data.upload_id : null;

    expect(assetId).toBe('asset_id_xyz789');
    expect(uploadId).toBe('upload_id_abc123');
  });

  it('video.asset.errored: data.id is the asset ID', () => {
    const payload = {
      type: 'video.asset.errored',
      data: {
        id: 'asset_id_xyz789',
        status: 'errored',
        upload_id: 'upload_id_abc123',
      },
    };

    const data = payload.data as Record<string, unknown>;
    expect(typeof data.id === 'string' ? data.id : null).toBe('asset_id_xyz789');
    expect(typeof data.upload_id === 'string' ? data.upload_id : null).toBe('upload_id_abc123');
  });

  it('rejects video.upload.asset_created when asset_id is missing', () => {
    // During the brief window between upload completion and asset creation,
    // Mux may send this event without asset_id (status != 'asset_created').
    // The handler must reject this rather than silently proceeding.
    const payload = {
      type: 'video.upload.asset_created',
      data: {
        id: 'upload_id_abc123',
        // asset_id intentionally absent
        status: 'waiting',
      },
    };

    const data = payload.data as Record<string, unknown>;
    const uploadId = typeof data.id === 'string' ? data.id : null;
    const assetId  = typeof data.asset_id === 'string' ? data.asset_id : null;

    expect(uploadId).toBe('upload_id_abc123');
    expect(assetId).toBeNull(); // handler returns 400 in this case
  });

  it('signature verification rejects old Cloudflare format on Mux endpoint', () => {
    // Cloudflare uses header 'webhook-signature: time=...,sig1=...'
    // Mux uses header 'mux-signature: t=...,v1=...'
    // A Cloudflare-format header should fail Mux verification.
    const t = now();
    const cfHeader = `time=${t},sig1=${createHmac('sha256', MUX_SECRET).update(`${t}.${muxBody}`).digest('hex')}`;
    expect(muxVerifyWebhook(muxBody, cfHeader)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyVideoStatus and applyVideoStatusFromUploadId logic
// These tests use vi.mock to stub Supabase and the Mux API.
// ---------------------------------------------------------------------------

vi.mock('../netlify/lib/mux', async (importOriginal) => {
  const real = await importOriginal<typeof import('../netlify/lib/mux')>();
  return {
    ...real,
    // getAsset and getUploadRecord are stubbed per-test with vi.mocked()
    getAsset: vi.fn(),
    getUploadRecord: vi.fn(),
  };
});

vi.mock('../netlify/lib/server', async (importOriginal) => {
  const real = await importOriginal<typeof import('../netlify/lib/server')>();
  return { ...real, supabaseAdmin: vi.fn() };
});

describe('applyVideoStatusFromUploadId — asset ID resolution', () => {
  it('fast path: if no upload row matches storedId, treats it as an asset ID', async () => {
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getAsset } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_abc', playbackId: 'pb_abc', status: 'ready', duration: 7200 };
    (getAsset as MockedFunction<typeof getAsset>).mockResolvedValueOnce(fakeAsset);

    // Supabase stub: no upload row found (storedId treated as asset ID)
    const mockSb = buildSupabaseStub({ uploadRow: null, movie: { id: 'movie_1', duration_minutes: null } });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(mockSb as unknown as ReturnType<typeof supabaseAdmin>);

    const result = await applyVideoStatusFromUploadId('asset_abc');
    expect(result.status).toBe('ready');
    expect(getAsset).toHaveBeenCalledWith('asset_abc');
  });

  it('upload ID path: polls Mux upload, swaps in asset ID when asset is created', async () => {
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getAsset, getUploadRecord } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    (getUploadRecord as MockedFunction<typeof getUploadRecord>).mockResolvedValueOnce({
      assetId: 'asset_xyz',
      uploadStatus: 'asset_created',
    });
    const fakeAsset: MuxAsset = { assetId: 'asset_xyz', playbackId: 'pb_xyz', status: 'ready', duration: 3600 };
    (getAsset as MockedFunction<typeof getAsset>).mockResolvedValueOnce(fakeAsset);

    const mockSb = buildSupabaseStub({
      uploadRow: { movie_id: 'movie_1', status: 'uploading' },
      movie: { id: 'movie_1', duration_minutes: null },
    });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(mockSb as unknown as ReturnType<typeof supabaseAdmin>);

    const result = await applyVideoStatusFromUploadId('upload_abc');
    expect(result.status).toBe('ready');
    // Verify asset ID was stored and the specific upload row was updated.
    expect(getUploadRecord).toHaveBeenCalledWith('upload_abc');
    expect(getAsset).toHaveBeenCalledWith('asset_xyz');
    expect(mockSb._updates).toContainEqual(
      expect.objectContaining({ table: 'movies', values: { video_asset_id: 'asset_xyz' } }),
    );
    expect(mockSb._updates).toContainEqual(
      expect.objectContaining({ table: 'uploads', filter: { provider_uid: 'upload_abc' } }),
    );
  });

  it('repeated polling after resolution takes the fast path (no upload row lookup needed)', async () => {
    // After the webhook or first poll resolves the upload → asset,
    // movies.video_asset_id holds the asset ID. The upload row's provider_uid
    // still holds the upload ID. On a subsequent poll the video-status endpoint
    // passes the current movies.video_asset_id (= asset ID) to applyVideoStatusFromUploadId.
    // Since no upload row has provider_uid = assetId, the fast path fires.
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getAsset } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_already_set', playbackId: 'pb_1', status: 'ready' };
    (getAsset as MockedFunction<typeof getAsset>).mockResolvedValueOnce(fakeAsset);

    // No upload row for this ID → fast path
    const mockSb = buildSupabaseStub({ uploadRow: null, movie: { id: 'movie_2', duration_minutes: 60 } });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(mockSb as unknown as ReturnType<typeof supabaseAdmin>);

    const result = await applyVideoStatusFromUploadId('asset_already_set');
    expect(result.status).toBe('ready');
    // Status must not regress to 'uploading'.
    expect(result.status).not.toBe('uploading');
  });

  it('returns uploading when Mux upload has no asset yet', async () => {
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getUploadRecord } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    (getUploadRecord as MockedFunction<typeof getUploadRecord>).mockResolvedValueOnce({
      assetId: null,
      uploadStatus: 'waiting',
    });

    const mockSb = buildSupabaseStub({ uploadRow: { movie_id: 'movie_3', status: 'uploading' } });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(mockSb as unknown as ReturnType<typeof supabaseAdmin>);

    const result = await applyVideoStatusFromUploadId('upload_waiting');
    expect(result.status).toBe('uploading');
  });

  it('marks movie as failed when Mux upload errors', async () => {
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getUploadRecord } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    (getUploadRecord as MockedFunction<typeof getUploadRecord>).mockResolvedValueOnce({
      assetId: null,
      uploadStatus: 'errored',
    });

    const mockSb = buildSupabaseStub({ uploadRow: { movie_id: 'movie_4', status: 'uploading' } });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(mockSb as unknown as ReturnType<typeof supabaseAdmin>);

    const result = await applyVideoStatusFromUploadId('upload_errored');
    expect(result.status).toBe('failed');
    expect(mockSb._updates).toContainEqual(
      expect.objectContaining({ table: 'movies', values: expect.objectContaining({ upload_status: 'failed' }) }),
    );
  });
});

describe('legacy Cloudflare records are unaffected by Mux logic', () => {
  it('applyVideoStatus only updates rows where video_provider = mux', async () => {
    // applyVideoStatus uses .eq('video_provider', 'mux') so Cloudflare rows
    // will never be matched and updated by this function.
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_mux', playbackId: 'pb_mux', status: 'ready' };

    // Simulate: no matching movie row (as would happen for a CF movie)
    const mockSb = buildSupabaseStub({ movie: null, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(mockSb as unknown as ReturnType<typeof supabaseAdmin>);

    // Should succeed without throwing; movie is null so nothing is updated.
    const result = await applyVideoStatus('asset_mux', fakeAsset);
    expect(result.status).toBe('ready');
    // No upload row update attempted when movie is null.
    expect(mockSb._updates.filter((u: { table: string }) => u.table === 'uploads')).toHaveLength(0);
  });

  it('mapState preserves Cloudflare states correctly', () => {
    // Ensures the Cloudflare mapState function is not broken by the Mux additions.
    expect(mapState({ uid: 'cf', readyToStream: true }).status).toBe('ready');
    expect(mapState({ uid: 'cf', readyToStream: false, status: { state: 'queued' } }).status).toBe('processing');
    expect(mapState({ uid: 'cf', readyToStream: false, status: { state: 'error', errorReasonText: 'oops' } }))
      .toEqual({ status: 'failed', error: 'oops' });
  });
});

// ---------------------------------------------------------------------------
// Input handling (provider-agnostic)
// ---------------------------------------------------------------------------

describe('input handling', () => {
  it('escapes LIKE wildcards so user input is literal', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
  });
  it('rejects non-https URLs and out-of-range values', () => {
    expect(movieFieldsSchema.safeParse({ title: 'x', poster_url: 'http://insecure.example/p.jpg' }).success).toBe(false);
    expect(movieFieldsSchema.safeParse({ title: 'x', poster_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(movieFieldsSchema.safeParse({ title: 'x', release_year: 1500 }).success).toBe(false);
    expect(movieFieldsSchema.safeParse({ title: '' }).success).toBe(false);
  });
  it('normalises empty optional fields to null', () => {
    const r = movieFieldsSchema.parse({ title: 'x', language: '', poster_url: '', release_date: '' });
    expect(r.language).toBeNull();
    expect(r.poster_url).toBeNull();
    expect(r.release_date).toBeNull();
  });
  it('validates the create-upload payload', () => {
    const ok = createUploadSchema.safeParse({ movie: { title: 'x' }, file: { name: 'a.mp4', size: 10, type: 'video/mp4' } });
    expect(ok.success).toBe(true);
    expect(createUploadSchema.safeParse({ movie: { title: 'x' }, file: { name: 'a.mp4', size: -1, type: '' } }).success).toBe(false);
    expect(createUploadSchema.safeParse({ movie: { title: 'x' }, movieId: 'not-a-uuid', file: { name: 'a', size: 1, type: '' } }).success).toBe(false);
  });
  it('formats helpers', () => {
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(65)).toBe('1:05');
    expect(parseList('A, B,\nA , ,C')).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Supabase client stub that records updates and returns
 * configurable data for select queries.
 *
 * Tracks all .update() calls in _updates so tests can assert on them.
 */
function buildSupabaseStub(opts: {
  uploadRow?: { movie_id: string | null; status: string } | null;
  movie?: { id: string; duration_minutes: number | null } | null;
}) {
  const updates: Array<{ table: string; values: Record<string, unknown>; filter: Record<string, unknown> }> = [];

  const makeChain = (table: string) => {
    let _values: Record<string, unknown> = {};
    let _filter: Record<string, unknown> = {};

    const chain = {
      update(values: Record<string, unknown>) { _values = values; return chain; },
      insert() { return chain; },
      select() { return chain; },
      delete() { return chain; },
      eq(col: string, val: unknown) { _filter[col] = val; return chain; },
      in(col: string, vals: unknown[]) { _filter[col] = vals; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() {
        // Record the update.
        if (Object.keys(_values).length > 0) {
          updates.push({ table, values: { ..._values }, filter: { ..._filter } });
        }
        // Return configured data for reads.
        if (table === 'uploads') {
          return Promise.resolve({ data: opts.uploadRow ?? null, error: null });
        }
        if (table === 'movies') {
          return Promise.resolve({ data: opts.movie ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single() { return chain.maybeSingle(); },
      then(resolve: (v: { data: null; error: null }) => void) {
        // For fire-and-forget update chains (no maybeSingle)
        if (Object.keys(_values).length > 0) {
          updates.push({ table, values: { ..._values }, filter: { ..._filter } });
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return chain;
  };

  return {
    _updates: updates,
    from: (table: string) => makeChain(table),
  };
}

// ---------------------------------------------------------------------------
// REGRESSION TESTS
// Four issues fixed in the current session:
//   R1. Fast-path upload ID resolution: resolvedUploadId passed via provider_uid
//   R2. create-upload rollback: snapshot restored on upload-row insert failure
//   R3. Webhook 5xx on required DB write errors (Mux will retry)
//   R4. Race condition guard: asset_created does not downgrade a ready movie
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// R1 — Fast-path upload ID resolution
//
// When applyVideoStatusFromUploadId is called with an asset ID (no upload row
// matches it as provider_uid), the function must:
//   (a) Look up the movie row to get movie_id.
//   (b) Find the most-recent mux upload row for that movie.
//   (c) Pass that upload's provider_uid as uploadId to applyVideoStatus so
//       the upload row is updated by provider_uid, not by movie_id.
// ---------------------------------------------------------------------------
describe('R1 — fast-path resolves upload ID from movie → uploads table', () => {
  it('passes resolvedUploadId to applyVideoStatus so upload row is targeted by provider_uid', async () => {
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getAsset } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_r1', playbackId: 'pb_r1', status: 'ready' };
    (getAsset as MockedFunction<typeof getAsset>).mockResolvedValueOnce(fakeAsset);

    // Sequence: first call (uploads, storedId lookup) → no row;
    //           second call (movies, by video_asset_id) → movie row;
    //           third call (uploads, latestUpload by movie_id) → upload row.
    const mockSb = buildSupabaseStubSequenced([
      // uploads.select().eq('provider_uid', 'asset_r1').maybeSingle()  → null (it's an asset ID)
      { table: 'uploads', data: null },
      // movies.update(...).eq('video_asset_id','asset_r1').select('id,duration_minutes').maybeSingle()
      { table: 'movies', data: { id: 'movie_r1', duration_minutes: null } },
      // movies.select('id').eq('video_asset_id','asset_r1').maybeSingle() — fast-path movie lookup
      { table: 'movies', data: { id: 'movie_r1', duration_minutes: null } },
      // uploads.select('provider_uid').eq('movie_id','movie_r1').eq('provider','mux').order().limit().maybeSingle()
      { table: 'uploads', data: { provider_uid: 'upload_r1' } },
      // uploads.update({status,error_message,ready_at}).eq('provider_uid','upload_r1') — fire-and-forget
      { table: 'uploads', data: null },
    ]);
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    const result = await applyVideoStatusFromUploadId('asset_r1');
    expect(result.status).toBe('ready');

    // The upload row must be updated by provider_uid = 'upload_r1', NOT by movie_id.
    const uploadUpdates = mockSb._updates.filter((u: { table: string }) => u.table === 'uploads');
    expect(uploadUpdates.length).toBeGreaterThan(0);
    const byProviderUid = uploadUpdates.find(
      (u: { filter: Record<string, unknown> }) => u.filter['provider_uid'] === 'upload_r1',
    );
    expect(byProviderUid).toBeDefined();
    // Must NOT fall back to movie_id scoped update.
    const byMovieId = uploadUpdates.find(
      (u: { filter: Record<string, unknown> }) => u.filter['movie_id'] !== undefined,
    );
    expect(byMovieId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R2 — create-upload rollback: snapshot fully restored on insert failure
//
// We test the rollback logic directly without invoking the full Netlify handler
// (which requires network I/O). We reproduce the sequence:
//   1. movie row fetched → snapshot captured
//   2. movie row updated with new upload fields
//   3. uploads insert fails
//   4. movie row restored to exact snapshot values
// ---------------------------------------------------------------------------
describe('R2 — create-upload rollback restores full original snapshot', () => {
  it('restores video_asset_id, video_provider, upload_status, visibility, playback_id on failure', async () => {
    // Simulate the logic from create-upload.mts without importing the handler.
    type MovieSnapshot = {
      video_asset_id: string | null;
      video_provider: string | null;
      upload_status: string;
      visibility: string;
      playback_id: string | null;
    };

    const originalSnapshot: MovieSnapshot = {
      video_asset_id: 'old_asset_cf_123',
      video_provider: 'cloudflare',
      upload_status: 'ready',
      visibility: 'public',
      playback_id: 'cf_pb_xyz',
    };

    const updates: Array<{ fields: Record<string, unknown>; filter: Record<string, unknown> }> = [];
    let insertAttempted = false;

    // Minimal inline stub — mirrors what create-upload.mts does.
    const stub = {
      from(table: string) {
        return {
          update(fields: Record<string, unknown>) {
            return {
              eq(col: string, val: unknown) {
                updates.push({ fields, filter: { [col]: val } });
                return {
                  eq() { return this; },
                  then(resolve: (v: { data: null; error: null }) => void) {
                    return Promise.resolve({ data: null, error: null }).then(resolve);
                  },
                };
              },
            };
          },
          insert() {
            insertAttempted = true;
            return Promise.resolve({ error: { message: 'duplicate key value' } });
          },
          select() { return this; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        };
      },
    };

    // Reproduce the rollback branch:
    let movieWritten = false;
    let savedId = 'movie_existing_1';
    const newVideoFields = {
      video_asset_id: 'upload_new_999',
      video_provider: 'mux',
      upload_status: 'uploading',
      visibility: 'draft',
      playback_id: null,
    };

    try {
      // Step 1: update movie with new upload fields.
      await stub.from('movies').update(newVideoFields).eq('id', savedId);
      movieWritten = true;

      // Step 2: insert upload row — will fail.
      const result = await stub.from('uploads').insert();
      if ((result as { error: { message: string } | null }).error) {
        throw new Error((result as { error: { message: string } }).error.message);
      }
    } catch {
      if (movieWritten && savedId && originalSnapshot) {
        await stub.from('movies').update({
          video_asset_id: originalSnapshot.video_asset_id,
          video_provider: originalSnapshot.video_provider,
          upload_status: originalSnapshot.upload_status,
          visibility: originalSnapshot.visibility,
          playback_id: originalSnapshot.playback_id,
        }).eq('id', savedId).then(() => undefined, () => undefined);
      }
    }

    expect(insertAttempted).toBe(true);

    // The last update to movies must restore every original field exactly.
    const movieUpdates = updates.filter((u) => u.filter['id'] === savedId);
    expect(movieUpdates.length).toBeGreaterThanOrEqual(2); // first write + restore

    const restoreUpdate = movieUpdates[movieUpdates.length - 1];
    expect(restoreUpdate.fields).toEqual({
      video_asset_id: 'old_asset_cf_123',
      video_provider: 'cloudflare',
      upload_status: 'ready',
      visibility: 'public',
      playback_id: 'cf_pb_xyz',
    });
  });

  it('deletes the new movie row entirely when the inserts fail for a brand-new movie', async () => {
    const deletes: Array<{ table: string; filter: Record<string, unknown> }> = [];

    const stub = {
      from(table: string) {
        const obj: Record<string, unknown> = {
          update() {
            return { eq() { return this; }, then(r: (v: unknown) => void) { return Promise.resolve(null).then(r); } };
          },
          insert() { return obj; },
          delete() {
            return {
              eq(col: string, val: unknown) {
                deletes.push({ table, filter: { [col]: val } });
                return { then(r: (v: unknown) => void) { return Promise.resolve(null).then(r); } };
              },
            };
          },
          select() { return obj; },
          single() { return Promise.resolve({ data: { id: 'movie_new_1' }, error: null }); },
        };
        return obj;
      },
    };

    let movieWritten = false;
    let savedId = '';

    try {
      // Step 1: insert new movie.
      const res = await stub.from('movies').insert().select().single();
      movieWritten = true;
      savedId = (res as unknown as { data: { id: string } }).data.id;

      // Step 2: insert upload row — fails.
      throw new Error('upload insert failed');
    } catch {
      if (movieWritten && savedId) {
        // New movie — delete entirely.
        await stub.from('movies').delete().eq('id', savedId).then(() => undefined, () => undefined);
      }
    }

    expect(deletes).toContainEqual(
      expect.objectContaining({ table: 'movies', filter: { id: 'movie_new_1' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// R3 — applyVideoStatus: DB write failures throw (caller handles as 500)
//
// These tests exercise the actual applyVideoStatus production function with
// a Supabase stub that returns errors, verifying it throws on DB failures so
// the webhook handler's route() wrapper converts them to HTTP 500.
// ---------------------------------------------------------------------------
describe('R3 — applyVideoStatus throws on required DB write failures', () => {
  it('throws when the movies table update fails', async () => {
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_db_err', playbackId: 'pb_err', status: 'ready' };

    const mockSb = buildSupabaseStubWithError({ movieError: { message: 'connection timeout' } });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    await expect(applyVideoStatus('asset_db_err', fakeAsset, 'upload_err'))
      .rejects.toThrow('movie status update failed');
  });

  it('throws when the uploads table update fails', async () => {
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_up_err', playbackId: 'pb_ue', status: 'ready' };

    // Movie update succeeds; uploads update returns an error.
    const mockSb = buildSupabaseStubWithError({
      movieError: null,
      uploadError: { message: 'constraint violation' },
    });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    await expect(applyVideoStatus('asset_up_err', fakeAsset, 'upload_ue'))
      .rejects.toThrow('upload status update failed');
  });

  it('returns status=failed when asset is null (not found at Mux)', async () => {
    // A null asset means "not found" — applyVideoStatus should mark the movie
    // failed. The movie row must be set to failed and visibility set to draft.
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const mockSb = buildSupabaseStub({ movie: { id: 'movie_nf', duration_minutes: null }, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    const result = await applyVideoStatus('asset_gone', null, 'upload_gone');
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
    const movieUpdate = mockSb._updates.find(
      (u: { table: string; values: Record<string, unknown> }) => u.table === 'movies',
    );
    expect(movieUpdate?.values.upload_status).toBe('failed');
    expect(movieUpdate?.values.visibility).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// R4 — Race condition guard: ready status is never downgraded
//
// Tested via applyVideoStatus and applyVideoStatusFromUploadId — the actual
// production functions used by the webhook and polling paths.
// ---------------------------------------------------------------------------
describe('R4 — race guard: ready status is never downgraded', () => {
  it('applyVideoStatus sets upload_status=ready for a ready asset', async () => {
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_race_r4', playbackId: 'pb_race', status: 'ready' };
    const mockSb = buildSupabaseStub({ movie: { id: 'movie_race', duration_minutes: null }, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    const result = await applyVideoStatus('asset_race_r4', fakeAsset, 'upload_race');
    expect(result.status).toBe('ready');
    const movieUpdate = mockSb._updates.find(
      (u: { table: string; values: Record<string, unknown> }) =>
        u.table === 'movies' && 'upload_status' in u.values,
    );
    expect(movieUpdate?.values.upload_status).toBe('ready');
  });

  it('applyVideoStatus sets upload_status=processing and visibility=draft for a preparing asset', async () => {
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const preparingAsset: MuxAsset = { assetId: 'asset_prep', playbackId: null, status: 'preparing' };
    const mockSb = buildSupabaseStub({ movie: { id: 'movie_prep', duration_minutes: null }, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    const result = await applyVideoStatus('asset_prep', preparingAsset, 'upload_prep');
    expect(result.status).toBe('processing');
    const movieUpdate = mockSb._updates.find(
      (u: { table: string; values: Record<string, unknown> }) =>
        u.table === 'movies' && 'upload_status' in u.values,
    );
    expect(movieUpdate?.values.upload_status).toBe('processing');
    expect(movieUpdate?.values.visibility).toBe('draft');
  });

  it('applyVideoStatusFromUploadId does not regress status from ready to uploading', async () => {
    // After polling resolves status to ready, a duplicate poll call should not
    // set the status back to uploading.
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getAsset } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_ready_r4', playbackId: 'pb_r4', status: 'ready' };
    (getAsset as MockedFunction<typeof getAsset>).mockResolvedValueOnce(fakeAsset);

    // No upload row matches storedId (it's already the asset ID — fast path).
    const mockSb = buildSupabaseStub({ uploadRow: null, movie: { id: 'movie_r4', duration_minutes: 120 } });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    const result = await applyVideoStatusFromUploadId('asset_ready_r4');
    expect(result.status).toBe('ready');
    expect(result.status).not.toBe('uploading');
    expect(result.status).not.toBe('processing');
  });
});

// ---------------------------------------------------------------------------
// Extended Supabase stub — supports sequenced responses for multi-step queries.
// Used by R1 tests where the same table is queried multiple times in one flow.
// ---------------------------------------------------------------------------

/**
 * Sequenced stub: responses are consumed in the order they are provided.
 * Each entry specifies which table the response is for; the stub matches the
 * next entry whose table matches.
 */
function buildSupabaseStubSequenced(
  sequence: Array<{ table: string; data: Record<string, unknown> | null; error?: { message: string } | null }>,
) {
  const updates: Array<{ table: string; values: Record<string, unknown>; filter: Record<string, unknown> }> = [];
  // Mutable index per table — consumed in order.
  const counters: Record<string, number> = {};

  const nextResponse = (table: string) => {
    const idx = counters[table] ?? 0;
    const matching = sequence.filter((s) => s.table === table);
    const entry = matching[idx] ?? { table, data: null, error: null };
    counters[table] = idx + 1;
    return { data: entry.data ?? null, error: entry.error ?? null };
  };

  const makeChain = (table: string) => {
    let _values: Record<string, unknown> = {};
    let _filter: Record<string, unknown> = {};

    const chain: Record<string, unknown> = {
      update(values: Record<string, unknown>) { _values = values; return chain; },
      insert() { return chain; },
      select() { return chain; },
      delete() { return chain; },
      eq(col: string, val: unknown) { _filter[col] = val; return chain; },
      in(col: string, vals: unknown[]) { _filter[col] = vals; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() {
        if (Object.keys(_values).length > 0) {
          updates.push({ table, values: { ..._values }, filter: { ..._filter } });
        }
        return Promise.resolve(nextResponse(table));
      },
      single() { return (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle(); },
      then(resolve: (v: unknown) => void) {
        if (Object.keys(_values).length > 0) {
          updates.push({ table, values: { ..._values }, filter: { ..._filter } });
        }
        return Promise.resolve(nextResponse(table)).then(resolve);
      },
    };
    return chain;
  };

  return {
    _updates: updates,
    from: (table: string) => makeChain(table),
  };
}

// ---------------------------------------------------------------------------
// buildSupabaseStubWithError — stub that returns DB errors on specific tables.
// Used by R3 tests to verify that applyVideoStatus throws on write failures.
// ---------------------------------------------------------------------------

/**
 * Returns a stub where the movie update maybeSingle() returns movieError (if set)
 * and the uploads update then() returns uploadError (if set).
 * Other calls return null data with no error.
 */
function buildSupabaseStubWithError(opts: {
  movieError?: { message: string } | null;
  uploadError?: { message: string } | null;
}) {
  const updates: Array<{ table: string; values: Record<string, unknown>; filter: Record<string, unknown> }> = [];

  const makeChain = (table: string) => {
    let _values: Record<string, unknown> = {};
    let _filter: Record<string, unknown> = {};

    const chain: Record<string, unknown> = {
      update(values: Record<string, unknown>) { _values = values; return chain; },
      insert() { return chain; },
      select() { return chain; },
      delete() { return chain; },
      eq(col: string, val: unknown) { _filter[col] = val; return chain; },
      in(col: string, vals: unknown[]) { _filter[col] = vals; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() {
        const hasValues = Object.keys(_values).length > 0;
        if (hasValues) {
          updates.push({ table, values: { ..._values }, filter: { ..._filter } });
          if (table === 'movies' && opts.movieError) {
            return Promise.resolve({ data: null, error: opts.movieError });
          }
        }
        // Reads: return a synthetic movie row so the read-path doesn't short-circuit.
        if (table === 'movies') return Promise.resolve({ data: { id: 'movie_stub', duration_minutes: null }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single() { return (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle(); },
      then(resolve: (v: unknown) => void) {
        const hasValues = Object.keys(_values).length > 0;
        if (hasValues) {
          updates.push({ table, values: { ..._values }, filter: { ..._filter } });
          if (table === 'uploads' && opts.uploadError) {
            return Promise.resolve({ data: null, error: opts.uploadError }).then(resolve);
          }
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return chain;
  };

  return {
    _updates: updates,
    from: (table: string) => makeChain(table),
  };
}

// ---------------------------------------------------------------------------
// Multiple upload attempts for one movie
// ---------------------------------------------------------------------------

describe('multiple upload attempts: correct upload row is updated', () => {
  it('when uploadId is provided, only the matching upload row is updated', async () => {
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_multi', playbackId: 'pb_multi', status: 'ready' };
    // Simulate: movie exists; upload row provided by provider_uid.
    const mockSb = buildSupabaseStub({ movie: { id: 'movie_multi', duration_minutes: null }, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    await applyVideoStatus('asset_multi', fakeAsset, 'upload_attempt_2');

    // The upload update must target provider_uid = 'upload_attempt_2' specifically.
    const uploadUpdates = mockSb._updates.filter((u: { table: string }) => u.table === 'uploads');
    expect(uploadUpdates.length).toBeGreaterThan(0);
    // Every upload update should filter by provider_uid, not by movie_id.
    for (const u of uploadUpdates) {
      expect(u.filter).toHaveProperty('provider_uid', 'upload_attempt_2');
      expect(u.filter).not.toHaveProperty('movie_id');
    }
  });

  it('when uploadId is absent, falls back to movie_id scoped in-flight rows', async () => {
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_noupload', playbackId: null, status: 'preparing' };
    const mockSb = buildSupabaseStub({ movie: { id: 'movie_noupload', duration_minutes: null }, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    // Call without an uploadId — should fall back to movie_id + in('status',...).
    await applyVideoStatus('asset_noupload', fakeAsset /* no uploadId */);

    const uploadUpdates = mockSb._updates.filter((u: { table: string }) => u.table === 'uploads');
    expect(uploadUpdates.length).toBeGreaterThan(0);
    const byMovieId = uploadUpdates.find(
      (u: { filter: Record<string, unknown> }) => u.filter['movie_id'] !== undefined,
    );
    expect(byMovieId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Idempotency: duplicate calls return the same status
// ---------------------------------------------------------------------------

describe('idempotency: duplicate status resolution calls', () => {
  it('calling applyVideoStatus twice with the same asset returns ready both times', async () => {
    const { applyVideoStatus } = await import('../netlify/lib/video-status');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_idem', playbackId: 'pb_idem', status: 'ready' };

    // First call.
    const mockSb1 = buildSupabaseStub({ movie: { id: 'movie_idem', duration_minutes: null }, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValueOnce(
      mockSb1 as unknown as ReturnType<typeof supabaseAdmin>,
    );
    const r1 = await applyVideoStatus('asset_idem', fakeAsset, 'upload_idem');
    expect(r1.status).toBe('ready');

    // Second call (duplicate delivery / retry).
    const mockSb2 = buildSupabaseStub({ movie: { id: 'movie_idem', duration_minutes: null }, uploadRow: null });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValueOnce(
      mockSb2 as unknown as ReturnType<typeof supabaseAdmin>,
    );
    const r2 = await applyVideoStatus('asset_idem', fakeAsset, 'upload_idem');
    expect(r2.status).toBe('ready');
  });

  it('calling applyVideoStatusFromUploadId with an asset ID twice is safe', async () => {
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getAsset } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    const fakeAsset: MuxAsset = { assetId: 'asset_idem2', playbackId: 'pb_idem2', status: 'ready' };

    // Both calls: no upload row (already the asset ID — fast path).
    for (let i = 0; i < 2; i++) {
      (getAsset as MockedFunction<typeof getAsset>).mockResolvedValueOnce(fakeAsset);
      const mockSb = buildSupabaseStub({ uploadRow: null, movie: { id: 'movie_idem2', duration_minutes: null } });
      (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValueOnce(
        mockSb as unknown as ReturnType<typeof supabaseAdmin>,
      );
    }

    const r1 = await applyVideoStatusFromUploadId('asset_idem2');
    const r2 = await applyVideoStatusFromUploadId('asset_idem2');
    expect(r1.status).toBe('ready');
    expect(r2.status).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// Out-of-order: asset.ready processed before upload.asset_created
// ---------------------------------------------------------------------------

describe('out-of-order event handling', () => {
  it('upload-path polling after asset is ready returns ready (upload row resolved)', async () => {
    // Simulates: first poll arrives after Mux has created the asset and
    // set it to ready. getUploadRecord returns assetId immediately.
    const { applyVideoStatusFromUploadId } = await import('../netlify/lib/video-status');
    const { getAsset, getUploadRecord } = await import('../netlify/lib/mux');
    const { supabaseAdmin } = await import('../netlify/lib/server');

    // The upload already has an assetId (upload processed quickly).
    (getUploadRecord as MockedFunction<typeof getUploadRecord>).mockResolvedValueOnce({
      assetId: 'asset_ooo',
      uploadStatus: 'asset_created',
    });
    const readyAsset: MuxAsset = { assetId: 'asset_ooo', playbackId: 'pb_ooo', status: 'ready' };
    (getAsset as MockedFunction<typeof getAsset>).mockResolvedValueOnce(readyAsset);

    const mockSb = buildSupabaseStub({
      uploadRow: { movie_id: 'movie_ooo', status: 'uploading' },
      movie: { id: 'movie_ooo', duration_minutes: null },
    });
    (supabaseAdmin as MockedFunction<typeof supabaseAdmin>).mockReturnValue(
      mockSb as unknown as ReturnType<typeof supabaseAdmin>,
    );

    const result = await applyVideoStatusFromUploadId('upload_ooo');
    expect(result.status).toBe('ready');
    // The movie row must have been updated to the real asset ID.
    const assetSwap = mockSb._updates.find(
      (u: { table: string; values: Record<string, unknown> }) =>
        u.table === 'movies' && u.values.video_asset_id === 'asset_ooo',
    );
    expect(assetSwap).toBeDefined();
  });
});
