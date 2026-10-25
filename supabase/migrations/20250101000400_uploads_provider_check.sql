-- CineVault migration: add CHECK constraint on uploads.provider
-- Migration 5: run after 20250101000300_mux_provider.sql
--
-- The uploads.provider column was created with a default of 'cloudflare_stream'
-- but no CHECK constraint, meaning any string value could be inserted.
-- This migration adds a constraint to enforce only known provider values and
-- changes the default to 'mux' for all new upload records.
--
-- Existing Cloudflare rows (provider = 'cloudflare_stream') are preserved.
-- New Mux uploads (provider = 'mux') are already in the valid set.
--
-- Rollback (before any new providers are added):
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_provider_check;
--   ALTER TABLE public.uploads ALTER COLUMN provider SET DEFAULT 'cloudflare_stream';

-- 1. Add the CHECK constraint (idempotent via the name).
alter table public.uploads
  add constraint if not exists uploads_provider_check
    check (provider in ('cloudflare_stream', 'mux'));

-- 2. Change the column default to 'mux' for all new upload records.
alter table public.uploads
  alter column provider set default 'mux';
