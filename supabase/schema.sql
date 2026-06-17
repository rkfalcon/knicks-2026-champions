-- Knicks 2026 picture book — Supabase schema.
-- Paste into the Supabase SQL editor (or run via psql) once per project.

create table if not exists public.posts (
  id              text primary key,
  platform        text not null,            -- 'x' | 'instagram'
  author          text,
  author_name     text,
  author_avatar   text,
  text            text,
  image           text,                     -- Storage public URL (mirrored)
  remote_image    text,                     -- original source URL
  video           boolean default false,
  url             text,                     -- link to the original post
  posted_at       timestamptz,
  likes           integer default 0,
  reposts         integer default 0,
  views           integer default 0,
  series          text,
  series_label    text,
  game            text,
  game_label      text,
  category        text,                     -- 'game' | 'festivities' | 'general'
  festivity_event text,
  players         text[] default '{}',
  celebrities     text[] default '{}',
  created_at      timestamptz default now()
);

create index if not exists posts_posted_at_idx  on public.posts (posted_at desc);
create index if not exists posts_series_idx      on public.posts (series);
create index if not exists posts_game_idx        on public.posts (game);
create index if not exists posts_category_idx    on public.posts (category);
create index if not exists posts_players_idx     on public.posts using gin (players);
create index if not exists posts_celebs_idx      on public.posts using gin (celebrities);

-- Filter config snapshot (bracket, roster, celebs) the frontend reads.
create table if not exists public.meta (
  key   text primary key,
  value jsonb
);

-- Row Level Security: public read-only. Writes happen only via the service-role
-- key (server-side ingest), which bypasses RLS.
alter table public.posts enable row level security;
alter table public.meta  enable row level security;

drop policy if exists "public read posts" on public.posts;
create policy "public read posts" on public.posts for select using (true);

drop policy if exists "public read meta" on public.meta;
create policy "public read meta" on public.meta for select using (true);
