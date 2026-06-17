-- Per-account override: show_all = true bypasses the keyword filter for that
-- account (all its posts are ingested). Default false (keyword-filtered).

alter table public.accounts add column if not exists show_all boolean default false;

-- Sensible default: the team account is all-Knicks, so show everything.
update public.accounts set show_all = true
  where lower(x_handle) = 'nyknicks' or lower(ig_handle) = 'nyknicks';
