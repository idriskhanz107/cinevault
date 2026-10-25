import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { mapState, signPlaybackToken, verifyWebhook } from '../netlify/lib/cloudflare';
import { escapeLike } from '../src/lib/queries';
import { createUploadSchema, movieFieldsSchema } from '../src/lib/schemas';
import { formatClock, parseList } from '../src/lib/format';

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
