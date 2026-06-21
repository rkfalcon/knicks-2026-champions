-- Admin can hide individual non-Knicks posts. Hidden posts are excluded from the
-- site and stay hidden across re-scrapes (upsert never writes this column).
alter table public.posts add column if not exists hidden boolean default false;
create index if not exists posts_hidden_idx on public.posts (hidden);
