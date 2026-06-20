-- Multi-image (carousel) support: store every image of a post, not just the
-- cover. The existing `image` column stays as the cover (images[0]) for the grid.
alter table public.posts add column if not exists images jsonb default '[]'::jsonb;
