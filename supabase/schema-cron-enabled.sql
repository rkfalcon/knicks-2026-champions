-- Accounts excluded from the daily cron (e.g. accounts that only hold manually
-- added posts). They still appear in the site's filters; they're just skipped
-- by the nightly scrape + auto-backfill until cron_enabled is set true.
alter table accounts add column if not exists cron_enabled boolean not null default true;
