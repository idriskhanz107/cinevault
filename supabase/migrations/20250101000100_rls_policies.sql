-- CineVault Row Level Security and privileges
-- NOTE: movies cannot be deleted directly by clients. Deletion goes through the
-- delete-movie Netlify Function so the Cloudflare Stream asset is removed too.
-- Migration 2 of 3.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.genres          enable row level security;
alter table public.movies          enable row level security;
alter table public.watchlist       enable row level security;
alter table public.viewing_history enable row level security;
alter table public.reviews         enable row level security;
alter table public.uploads         enable row level security;
alter table public.rate_limits     enable row level security;  -- no policies: service role only

-- ---------------------------------------------------------------------------
-- Table privileges (RLS is the gate; grants are the second lock)
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.genres, public.movies, public.watchlist,
              public.viewing_history, public.reviews, public.uploads, public.rate_limits
  from anon, authenticated;

-- Public catalogue reads
grant select on public.genres to anon, authenticated;
grant select on public.movies to anon, authenticated;
grant select on public.movie_reviews to anon, authenticated;

-- Admin writes are limited to editorial columns. Video state (asset id, status,
-- provider), rating aggregates and search_text can only be written by the
-- backend (service role) or by triggers.
grant insert (title, description, release_year, release_date, genres, language, country,
              director, "cast", duration_minutes, poster_url, backdrop_url, trailer_url,
              tmdb_id, popularity)
  on public.movies to authenticated;
grant update (title, description, release_year, release_date, genres, language, country,
              director, "cast", duration_minutes, poster_url, backdrop_url, trailer_url,
              tmdb_id, popularity, visibility)
  on public.movies to authenticated;
grant insert, update, delete on public.genres to authenticated;

-- Profiles: users may read/update only their own non-privileged columns.
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- Personal data
grant select, insert, delete on public.watchlist to authenticated;
grant select, insert, update, delete on public.viewing_history to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;

-- Admin visibility into uploads (written by the backend only)
grant select on public.uploads to authenticated;

-- RPCs
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant  execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant  execute on function public.trending_movies(integer, integer) to anon, authenticated;
grant  execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No insert policy: rows are created by the handle_new_user() trigger.

-- ---------------------------------------------------------------------------
-- genres
-- ---------------------------------------------------------------------------
create policy "genres_read_all" on public.genres
  for select to anon, authenticated using (true);

create policy "genres_admin_write" on public.genres
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- movies
-- ---------------------------------------------------------------------------
create policy "movies_read_published" on public.movies
  for select to anon, authenticated
  using (visibility = 'published' and upload_status = 'ready');

create policy "movies_admin_read_all" on public.movies
  for select to authenticated
  using ((select public.is_admin()));

create policy "movies_admin_insert" on public.movies
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "movies_admin_update" on public.movies
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- watchlist / viewing history: strictly owner-only
-- ---------------------------------------------------------------------------
create policy "watchlist_owner_select" on public.watchlist
  for select to authenticated using (user_id = (select auth.uid()));
create policy "watchlist_owner_insert" on public.watchlist
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "watchlist_owner_delete" on public.watchlist
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "history_owner_select" on public.viewing_history
  for select to authenticated using (user_id = (select auth.uid()));
create policy "history_owner_insert" on public.viewing_history
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "history_owner_update" on public.viewing_history
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "history_owner_delete" on public.viewing_history
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- reviews: owner writes; reads go through the movie_reviews view
-- ---------------------------------------------------------------------------
create policy "reviews_owner_select" on public.reviews
  for select to authenticated using (user_id = (select auth.uid()));
create policy "reviews_owner_insert" on public.reviews
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "reviews_owner_update" on public.reviews
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "reviews_owner_delete" on public.reviews
  for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- uploads: admin read-only from the client
-- ---------------------------------------------------------------------------
create policy "uploads_admin_select" on public.uploads
  for select to authenticated using ((select public.is_admin()));
