const e = import.meta.env;

/** Only public, browser-safe values live here (Supabase URL + anon key). */
export const SUPABASE_URL = e.VITE_SUPABASE_URL?.trim() || '';
export const SUPABASE_ANON_KEY = e.VITE_SUPABASE_ANON_KEY?.trim() || '';

/** Explicit demo mode: sample catalogue, no backend, no accounts, no playback. */
export const isDemoMode = e.VITE_DEMO_MODE === 'true';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Client-side upload limit (UX only - the server enforces its own MAX_UPLOAD_BYTES). */
export const MAX_UPLOAD_BYTES = (Number(e.VITE_MAX_UPLOAD_MB) || 10240) * 1024 * 1024;
