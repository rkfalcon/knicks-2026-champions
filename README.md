# 🏀 Knicks 2026 — A Championship Picture Book

A fan-made, mobile-first **picture book** of the New York Knicks' 2026 NBA
Championship run, built from public **X (Twitter)** and **Instagram** posts.
Relive every series, every game, the clincher, the parade, and the party — and
filter the whole thing by **series, game, player, celebrity, or platform**.

**Live:** https://www.knicks.run

Design is a love letter to [knickknacks.nyc](https://knickknacks.nyc/): retro Y2K
fan-site energy (stars, marquee, ALL-CAPS, orange & blue) — but actually
responsive and readable on a phone.

---

## Architecture

```
config/sources.json     ← you edit: handles, keywords, dates, bracket, players, celebs
        │
        ▼
lib/pipeline.mjs        ← scrape → filter to Knicks → auto-tag → mirror images → upsert
   ├─ lib/sources/twitter.mjs    (twitterapi.io  advanced_search)
   ├─ lib/sources/instagram.mjs  (Apify  apify/instagram-scraper)
   ├─ lib/tag.mjs                (series / game / player / celebrity / festivities)
   └─ lib/supabase.mjs           (Postgres upsert + Storage image mirror)
        │
        ├─ scripts/ingest.mjs    ← CLI backfill (run locally, no time limit)
        └─ api/ingest.js         ← Vercel Cron, nightly (vercel.json)
        │
        ▼
   Supabase  (posts table + meta table + knicks-media Storage bucket)
        │
        ▼
   api/posts.js          ← serves the payload to the frontend (sample fallback)
        │
        ▼
   index.html + styles.css + app.js   ← static site on Vercel
```

- **Supabase** is the source of truth: a `posts` table (incremental upsert +
  dedupe by id), a `meta` table (the bracket/roster/celeb config the frontend
  reads to build filters), and a public **Storage** bucket holding mirrored
  images (so the book doesn't depend on expiring X/Instagram CDN URLs).
- **Vercel** hosts the static site, runs `/api/posts` (reads Supabase, falls
  back to bundled sample data so it's never empty), and runs `/api/ingest` on a
  **nightly cron** so the book keeps itself current.
- Nothing scrapes the platforms directly — it calls two commercial services
  (twitterapi.io, Apify) that you hold accounts with.

## Environment variables

Set these in **Vercel → Project Settings → Environment Variables** (already done
for the live deploy) and in a local `.env` for CLI runs:

| Var | What |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server-side only) |
| `TWITTERAPI_IO_KEY` | https://twitterapi.io |
| `APIFY_TOKEN` | https://apify.com → Settings → Integrations |
| `CRON_SECRET` | random string; Vercel sends it as `Bearer` to `/api/ingest` |

See `.env.example`. The Supabase schema lives in `supabase/schema.sql`
(`scripts/provision.mjs` applied it during setup).

## Common tasks

```bash
# Re-run the full backfill into Supabase (scrape + mirror images)
npm run ingest

# Local dev against the real API + functions
npm run dev            # vercel dev

# Preview just the static site with bundled sample data
npm run serve          # http://localhost:8080  (falls back to data/posts.json)

# Regenerate the bundled sample dataset
npm run sample

# Deploy
vercel deploy --prod
```

The Vercel cron (`vercel.json`) hits `/api/ingest` nightly at 09:00 UTC, so a
manual backfill is only needed for big changes (e.g. after editing the bracket).

## Configure what gets collected — `config/sources.json`

Everything is driven by one file. Edit it, then `npm run ingest` (or wait for the
nightly cron).

- **`globalKeywords`** — a post is kept only if it mentions one of these.
- **`dateRange`** — outer bound for all scraping.
- **`twitter.handles` / `instagram.profileHandles`** — accounts to pull from.
- **`twitter.searchQueries` / `instagram.hashtags`** — broader keyword/hashtag searches.
- **`series[]`** — the playoff bracket. Each series has `start`/`end` dates and
  `games` with dates. **Posts are auto-tagged to a game by date** (within ~1.5
  days of tip-off). ⚠️ Opponents are placeholders — set the real matchups.
- **`festivities`** — keywords + events (parade, rally). Anything dated after the
  clincher, or matching these words, is tagged `festivities`.
- **`players[]` / `celebrities[]`** — names + aliases matched in captions to tag who's in a post.

## Domain

Served at **www.knicks.run** via Vercel. DNS at Namecheap:
`A @ → 76.76.21.21` and `CNAME www → cname.vercel-dns.com`; the apex 308-redirects
to `www`.

## Honest caveats

- The committed `data/posts.json` is clearly-labeled **sample** data
  (`"sample": true`) with invented fan captions and generated SVG placeholders.
  It's only the offline fallback — the live site reads real posts from Supabase.
- All images and captions belong to their original posters; every card links back
  to the source. Non-commercial fan project.

— Built for the Garden faithful. Bing bong. 🟧🟦
