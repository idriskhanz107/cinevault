-- CineVault schema (Supabase PostgreSQL)
-- Migration 1 of 3: tables, indexes, constraints, functions and triggers.
-- Run in order: 20250101000000 -> 20250101000100 -> 20250101000200.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (one row per auth user). Role is NEVER writable from the client.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url   text check (avatar_url is null or avatar_url ~* '^https://'),
  role         text not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Admin check used by RLS policies and storage policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Defence in depth: a signed-in user can never change a role, even if a policy
-- or grant is later loosened. Role changes are only possible with the
-- service-role key or from the SQL editor (where auth.uid() is null).
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'role changes are not permitted' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- Create the profile automatically on sign-up. The role always starts as
-- 'user'; user-supplied metadata is never used for privileges.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- genres
-- ---------------------------------------------------------------------------
create table public.genres (
  id         smallint generated always as identity primary key,
  name       text not null unique check (char_length(name) between 1 and 40),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- movies
-- ---------------------------------------------------------------------------
create table public.movies (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 200),
  description      text not null default '' check (char_length(description) <= 5000),
  release_year     smallint check (release_year between 1888 and 2100),
  release_date     date,
  genres           text[] not null default '{}' check (cardinality(genres) <= 10),
  language         text check (language is null or char_length(language) <= 60),
  country          text check (country is null or char_length(country) <= 100),
  director         text check (director is null or char_length(director) <= 200),
  "cast"           text[] not null default '{}' check (cardinality("cast") <= 50),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  poster_url       text check (poster_url   is null or poster_url   ~* '^https://'),
  backdrop_url     text check (backdrop_url is null or backdrop_url ~* '^https://'),
  trailer_url      text check (trailer_url  is null or trailer_url  ~* '^https://'),
  video_provider   text not null default 'cloudflare_stream' check (video_provider in ('cloudflare_stream')),
  video_asset_id   text check (video_asset_id is null or video_asset_id ~ '^[A-Za-z0-9]{8,64}$'),
  visibility       text not null default 'draft' check (visibility in ('draft', 'published')),
  upload_status    text not null default 'pending'
                   check (upload_status in ('pending', 'uploading', 'processing', 'ready', 'failed')),
  tmdb_id          integer unique,
  popularity       numeric(10, 3) not null default 0,
  rating_avg       numeric(3, 2),
  rating_count     integer not null default 0,
  search_text      text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  -- A movie can only be public once its video finished processing.
  constraint movies_published_requires_ready
    check (visibility <> 'published' or (upload_status = 'ready' and video_asset_id is not null))
);

create index movies_catalog_idx     on public.movies (visibility, upload_status, created_at desc);
create index movies_release_year_idx on public.movies (release_year desc);
create index movies_language_idx    on public.movies (language);
create index movies_popularity_idx  on public.movies (popularity desc);
create index movies_rating_idx      on public.movies (rating_avg desc nulls last, rating_count desc);
create index movies_title_idx       on public.movies (lower(title));
create index movies_genres_gin      on public.movies using gin (genres);
create index movies_search_trgm     on public.movies using gin (search_text extensions.gin_trgm_ops);
create index movies_asset_idx       on public.movies (video_asset_id) where video_asset_id is not null;

create or replace function public.movies_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.release_year is null and new.release_date is not null then
    new.release_year := extract(year from new.release_date)::smallint;
  end if;
  new.search_text := lower(concat_ws(' ',
    new.title,
    array_to_string(new.genres, ' '),
    new.release_year::text,
    new.language,
    new.country,
    new.director,
    array_to_string(new."cast", ' ')
  ));
  return new;
end;
$$;

create trigger movies_before_write
  before insert or update on public.movies
  for each row execute function public.movies_before_write();

create trigger movies_set_updated_at
  before update on public.movies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- watchlist, viewing history, reviews
-- ---------------------------------------------------------------------------
create table public.watchlist (
  user_id  uuid not null references auth.users (id) on delete cascade,
  movie_id uuid not null references public.movies (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);
create index watchlist_user_added_idx on public.watchlist (user_id, added_at desc);

create table public.viewing_history (
  user_id          uuid not null references auth.users (id) on delete cascade,
  movie_id         uuid not null references public.movies (id) on delete cascade,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  completed        boolean not null default false,
  last_watched_at  timestamptz not null default now(),
  primary key (user_id, movie_id)
);
create index viewing_history_user_idx  on public.viewing_history (user_id, last_watched_at desc);
create index viewing_history_movie_idx on public.viewing_history (movie_id, last_watched_at desc);

create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  movie_id    uuid not null references public.movies (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  review_text text check (review_text is null or char_length(review_text) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, movie_id)
);
create index reviews_movie_idx on public.reviews (movie_id, created_at desc);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

create or replace function public.refresh_movie_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid := coalesce(new.movie_id, old.movie_id);
begin
  update public.movies m
     set rating_avg   = s.avg_rating,
         rating_count = s.cnt
    from (
      select round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as cnt
        from public.reviews where movie_id = mid
    ) s
   where m.id = mid;
  return null;
end;
$$;

create trigger reviews_refresh_rating
  after insert or update of rating or delete on public.reviews
  for each row execute function public.refresh_movie_rating();

-- Public review feed (exposes display name only, never e-mail or user id).
create view public.movie_reviews as
  select r.id, r.movie_id, r.rating, r.review_text, r.created_at,
         coalesce(nullif(p.display_name, ''), 'Member') as display_name
    from public.reviews r
    join public.profiles p on p.id = r.user_id
    join public.movies  m on m.id = r.movie_id
   where m.visibility = 'published' and m.upload_status = 'ready';

-- ---------------------------------------------------------------------------
-- uploads (one row per video upload attempt)
-- ---------------------------------------------------------------------------
create table public.uploads (
  id              uuid primary key default gen_random_uuid(),
  movie_id        uuid references public.movies (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  provider        text not null default 'cloudflare_stream',
  provider_uid    text not null,
  file_name       text not null check (char_length(file_name) <= 255),
  file_size_bytes bigint not null check (file_size_bytes > 0),
  mime_type       text,
  status          text not null default 'uploading'
                  check (status in ('uploading', 'processing', 'ready', 'failed')),
  error_message   text check (error_message is null or char_length(error_message) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  ready_at        timestamptz
);
create index uploads_movie_idx   on public.uploads (movie_id);
create index uploads_created_idx on public.uploads (created_at desc);
create index uploads_uid_idx     on public.uploads (provider_uid);

create trigger uploads_set_updated_at
  before update on public.uploads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Rate limiting (used by Netlify Functions with the service-role key)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 1,
  primary key (key, window_start)
);

-- Fixed-window limiter. Returns true when the call is allowed.
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  h integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into h;

  -- opportunistic cleanup of old windows
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return h <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalogue RPCs
-- ---------------------------------------------------------------------------
-- Trending = most distinct viewers recently. Aggregated only; no user data leaks.
create or replace function public.trending_movies(days integer default 7, lim integer default 20)
returns setof public.movies
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.movies m
    left join (
      select movie_id, count(*) as c
        from public.viewing_history
       where last_watched_at > now() - make_interval(days => greatest(days, 1))
       group by movie_id
    ) h on h.movie_id = m.id
   where m.visibility = 'published' and m.upload_status = 'ready'
   order by coalesce(h.c, 0) desc, m.popularity desc, m.created_at desc
   limit least(greatest(lim, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Realtime: tell connected clients when a public movie disappears.
-- postgres_changes cannot deliver an UPDATE whose new row the subscriber is not
-- allowed to see (unpublish), nor row content for DELETE. This id-only broadcast
-- covers both without exposing any movie data.
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_movie_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.visibility = 'published' and old.upload_status = 'ready'
     and (tg_op = 'DELETE'
          or not (new.visibility = 'published' and new.upload_status = 'ready')) then
    perform realtime.send(jsonb_build_object('id', old.id), 'movie_removed', 'catalog', false);
  end if;
  return null;
end;
$$;

create trigger movies_broadcast_removal
  after update or delete on public.movies
  for each row execute function public.broadcast_movie_removal();
