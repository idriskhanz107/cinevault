import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from './env';

/**
 * Browser client - uses the public anon key only; all access is governed by RLS.
 * When the app is not configured the UI renders a setup screen (or demo mode) and
 * never issues requests, so a loopback placeholder keeps createClient() from throwing.
 */
export const supabase = createClient(
  isConfigured ? SUPABASE_URL : 'http://127.0.0.1:54321',
  isConfigured ? SUPABASE_ANON_KEY : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
