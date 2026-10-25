-- CineVault migration: add Mux as a supported video provider
-- Migration 4: run after 20250101000200_realtime_storage_seed.sql
--
-- Changes:
--   1. Extend the movies.video_provider CHECK constraint to accept 'mux'.
--      Existing 'cloudflare_stream' records are preserved unchanged.
--   2. Change the default video_provider to 'mux' for all new uploads.
--   3. Add a movies.playback_id column to cache the Mux signed playback ID.
--      This avoids an extra Mux API round-trip on every playback-token request.
--
-- Notes on existing constraints:
--   - movies.video_asset_id already allows [A-Za-z0-9]{8,64}.
--     Mux upload IDs and asset IDs are alphanumeric and fit this range.
--     No change needed to that constraint.
--   - movies_published_requires_ready requires upload_status='ready' AND
--     video_asset_id IS NOT NULL for published movies.  This is preserved and
--     remains valid: the temporary upload ID stored in video_asset_id satisfies
--     the NOT NULL requirement, and the movie cannot be published until
--     upload_status transitions to 'ready' (enforced by the backend).
--   - The video_provider CHECK constraint is inline in the CREATE TABLE and
--     PostgreSQL names it automatically as 'movies_video_provider_check'.
--     We drop it with IF EXISTS to make this migration idempotent.
--
-- Rollback (manual, before any new Mux movies are added):
--   ALTER TABLE public.movies DROP COLUMN IF EXISTS playback_id;
--   DROP INDEX IF EXISTS movies_playback_id_idx;
--   ALTER TABLE public.movies DROP CONSTRAINT IF EXISTS movies_video_provider_check;
--   ALTER TABLE public.movies ADD CONSTRAINT movies_video_provider_check
--     CHECK (video_provider IN ('cloudflare_stream'));
--   ALTER TABLE public.movies ALTER COLUMN video_provider SET DEFAULT 'cloudflare_stream';

-- 1. Drop the existing inline constraint.
--    PostgreSQL assigns the name automatically when no CONSTRAINT name is given
--    in the column definition.  The standard generated name is shown below.
--    To verify on your instance: SELECT conname FROM pg_constraint
--      WHERE conrelid = 'public.movies'::regclass AND conname LIKE '%provider%';
alter table public.movies
  drop constraint if exists movies_video_provider_check;

-- 2. Re-create the constraint accepting both providers.
alter table public.movies
  add constraint movies_video_provider_check
    check (video_provider in ('cloudflare_stream', 'mux'));

-- 3. Change the column default to 'mux' for all new movies going forward.
alter table public.movies
  alter column video_provider set default 'mux';

-- 4. Add playback_id column to cache the Mux signed playback ID.
--    NULL for Cloudflare records (they use a different token approach).
--    Mux playback IDs are alphanumeric strings, typically 11-32 characters,
--    but we allow up to 64 to match the video_asset_id constraint width.
alter table public.movies
  add column if not exists playback_id text
    check (playback_id is null or playback_id ~ '^[A-Za-z0-9]{8,64}$');

-- Index to support future queries by playback_id (e.g. DRM lookups).
create index if not exists movies_playback_id_idx
  on public.movies (playback_id) where playback_id is not null;

-- The authenticated role already has SELECT on movies (granted in migration 2).
-- service_role bypasses grants entirely.
-- No additional grants are needed for the new column.
