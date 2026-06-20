-- Per-account override: posts_only = true keeps the account's keyword-matching
-- posts but skips its (unfilterable) stories/highlights. For noisy brand /
-- lifestyle accounts that post lots of non-Knicks story content. Default false.

alter table public.accounts add column if not exists posts_only boolean default false;
