-- Track which accounts have had a full historical backfill, separate from
-- last_scraped_at (which the nightly incremental cron updates for everyone).
-- New accounts start NULL and the cron backfills them (bounded) on later runs.
alter table public.accounts add column if not exists backfilled_at timestamptz;

-- Existing accounts that already have posts are effectively backfilled already.
update public.accounts a set backfilled_at = now()
  where a.backfilled_at is null
    and exists (
      select 1 from public.posts p
      where lower(p.author) = lower(a.ig_handle) or lower(p.author) = lower(a.x_handle)
    );
