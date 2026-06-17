-- Per-account scrape tracking + ingest run history.
-- Apply: SUPABASE_ACCESS_TOKEN=sbp_... node --env-file-if-exists=.env scripts/migrate.mjs supabase/schema-runs.sql

alter table public.accounts add column if not exists last_scraped_at timestamptz;

create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  scope       text,                       -- 'all' or an account label
  account_id  uuid,
  trigger     text default 'manual',      -- manual | cron | cli
  status      text default 'running',     -- running | done | error
  scraped     integer default 0,
  upserted    integer default 0,
  mirrored    integer default 0,
  error       text,
  started_at  timestamptz default now(),
  finished_at timestamptz
);
create index if not exists runs_started_idx on public.runs(started_at desc);

-- Server-only (admin reads via the service-role key, which bypasses RLS).
alter table public.runs enable row level security;
