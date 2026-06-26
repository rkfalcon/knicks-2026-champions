-- Personal photo books: users save individual images into a public, shareable book.
-- Books are public (discoverable/shareable), so reads are open; writes are owner-only.

-- One public profile per user (their book identity).
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text unique,            -- public slug for /?book=<username>
  display_name text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table public.profiles enable row level security;
do $$ begin
  create policy "profiles public read"  on public.profiles for select using (true);
  create policy "profiles owner insert" on public.profiles for insert with check (auth.uid() = user_id);
  create policy "profiles owner update" on public.profiles for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- One row per saved image (a specific post + carousel frame).
create table if not exists public.saved_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  post_id    text not null references public.posts(id) on delete cascade,
  frame_idx  integer not null default 0,
  created_at timestamptz default now(),
  unique (user_id, post_id, frame_idx)
);
alter table public.saved_items enable row level security;
do $$ begin
  create policy "saved public read"  on public.saved_items for select using (true);
  create policy "saved owner insert" on public.saved_items for insert with check (auth.uid() = user_id);
  create policy "saved owner delete" on public.saved_items for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists saved_items_user_idx on public.saved_items (user_id);
