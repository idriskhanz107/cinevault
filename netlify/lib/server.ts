import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './http';

/** Reads a server-side environment variable. Missing values surface as a 500 (logged), never leaked. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

let admin: SupabaseClient | undefined;

/** Service-role client. SERVER ONLY - bypasses RLS. Never import from src/. */
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(
    process.env.SUPABASE_URL || env('VITE_SUPABASE_URL'),
    env('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return admin;
}

export interface AuthedUser {
  id: string;
  role: 'user' | 'admin';
}

/** Verifies the bearer JWT with Supabase Auth and loads the role from the database. */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Authentication required');

  const sb = supabaseAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Invalid or expired session');

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`profile lookup failed: ${profileError.message}`);

  return { id: data.user.id, role: profile?.role === 'admin' ? 'admin' : 'user' };
}

/** Authorization is decided here, on the server, from the database - never from client claims. */
export async function requireAdmin(req: Request): Promise<AuthedUser> {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Administrator access required');
  return user;
}

/** Fixed-window rate limit backed by Postgres. Fails closed. */
export async function rateLimit(scope: string, userId: string, max: number, windowSeconds: number) {
  const { data, error } = await supabaseAdmin().rpc('check_rate_limit', {
    p_key: `${scope}:${userId}`,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`rate limit check failed: ${error.message}`);
  if (data !== true) throw new HttpError(429, 'Too many requests. Please slow down.');
}
