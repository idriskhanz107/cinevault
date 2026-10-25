-- CineVault Realtime, Storage and seed data
-- Migration 3 of 3.

-- ---------------------------------------------------------------------------
-- Realtime: postgres_changes respects RLS, so subscribers only receive rows
-- they are allowed to SELECT.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.movies;

-- ---------------------------------------------------------------------------
-- Storage: public-read poster bucket, admin-only writes, enforced type + size.
-- (Videos are NOT stored in Supabase - they live in Cloudflare Stream.)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "posters_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'posters' and (select public.is_admin()));

create policy "posters_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'posters' and (select public.is_admin()));

create policy "posters_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'posters' and (select public.is_admin()))
  with check (bucket_id = 'posters' and (select public.is_admin()));

create policy "posters_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'posters' and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Genres (reference data, not demo content)
-- ---------------------------------------------------------------------------
insert into public.genres (name, slug) values
  ('Action', 'action'), ('Adventure', 'adventure'), ('Animation', 'animation'),
  ('Comedy', 'comedy'), ('Crime', 'crime'), ('Documentary', 'documentary'),
  ('Drama', 'drama'), ('Family', 'family'), ('Fantasy', 'fantasy'),
  ('History', 'history'), ('Horror', 'horror'), ('Music', 'music'),
  ('Mystery', 'mystery'), ('Romance', 'romance'), ('Science Fiction', 'science-fiction'),
  ('Thriller', 'thriller'), ('War', 'war'), ('Western', 'western')
on conflict (slug) do nothing;
