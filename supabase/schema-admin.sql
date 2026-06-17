-- Knicks 2026 — admin / config schema (phase 2).
-- All scraping config lives in these tables now, editable via /admin.
-- Apply with: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/migrate.mjs supabase/schema-admin.sql

-- ---------- tracked accounts (X + Instagram handles) ----------
create table if not exists public.accounts (
  id         uuid primary key default gen_random_uuid(),
  platform   text not null check (platform in ('x','instagram')),
  handle     text not null,
  label      text,
  active     boolean default true,
  created_at timestamptz default now(),
  unique (platform, handle)
);

-- ---------- tracked keywords (pulled in + become tags) ----------
create table if not exists public.keywords (
  id         uuid primary key default gen_random_uuid(),
  term       text not null unique,
  label      text,
  as_hashtag boolean default true,   -- also search Instagram by #term
  active     boolean default true,
  created_at timestamptz default now()
);

-- ---------- players ----------
create table if not exists public.players (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  number    integer,
  x_handle  text,
  ig_handle text,
  aliases   text[] default '{}',
  active    boolean default true,
  sort      integer default 0
);

-- ---------- celebrities ----------
create table if not exists public.celebrities (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  aliases text[] default '{}',
  active  boolean default true,
  sort    integer default 0
);

-- ---------- series + games (the bracket) ----------
create table if not exists public.series (
  id         text primary key,
  label      text not null,
  round      integer,
  opponent   text,
  result     text,
  start_date date,
  end_date   date,
  sort       integer default 0
);

create table if not exists public.games (
  id        text primary key,
  series_id text references public.series(id) on delete cascade,
  label     text not null,
  game_date date,
  home      boolean,
  result    text,
  sort      integer default 0
);

-- ---------- settings (server-side only: date range, IG cookie, story actors) ----------
create table if not exists public.settings (
  key   text primary key,
  value jsonb
);

-- ---------- admin allowlist (references Supabase Auth users) ----------
create table if not exists public.admins (
  user_id uuid primary key,
  email   text,
  created_at timestamptz default now()
);

-- ---------- posts: new columns for keywords / stories ----------
alter table public.posts add column if not exists keywords      text[] default '{}';
alter table public.posts add column if not exists post_type     text default 'post';  -- post | story | highlight | reel
alter table public.posts add column if not exists source_handle text;                 -- tracked account it came from
alter table public.posts add column if not exists expires_at    timestamptz;          -- stories: 24h expiry

create index if not exists posts_keywords_idx  on public.posts using gin (keywords);
create index if not exists posts_type_idx      on public.posts (post_type);
create index if not exists posts_author_idx    on public.posts (author);

-- ---------- RLS ----------
-- Config the frontend needs to build filters: public read. Writes go through the
-- admin API with the service-role key (bypasses RLS).
alter table public.accounts    enable row level security;
alter table public.keywords    enable row level security;
alter table public.players     enable row level security;
alter table public.celebrities enable row level security;
alter table public.series      enable row level security;
alter table public.games       enable row level security;
alter table public.settings    enable row level security;  -- NO public policy: server-only (holds the IG cookie)
alter table public.admins      enable row level security;  -- NO public policy: server-only

do $$
declare t text;
begin
  foreach t in array array['accounts','keywords','players','celebrities','series','games']
  loop
    execute format('drop policy if exists "public read %1$s" on public.%1$I', t);
    execute format('create policy "public read %1$s" on public.%1$I for select using (true)', t);
  end loop;
end $$;
