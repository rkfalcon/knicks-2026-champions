# 🏀 Knicks 2026 — A Championship Picture Book

A fan-made, mobile-first **picture book** of the New York Knicks' 2026 NBA
Championship run, built from public **X (Twitter)** and **Instagram** posts.
Relive every series, every game, the clincher, the parade, and the party — and
filter the whole thing by **series, game, player, celebrity, or platform**.

Design is a love letter to [knickknacks.nyc](https://knickknacks.nyc/): retro Y2K
fan-site energy (stars, marquee, ALL-CAPS, orange & blue) — but actually
responsive and readable on a phone.

> The site ships with **sample data** so it works immediately. Real content is
> pulled in by the scraping pipeline below once you add your API keys.

---

## How it works

```
config/sources.json   ← you edit: handles, keywords, dates, the bracket, players, celebs
        │
        ▼
scripts/ingest.mjs     ← scrapes X + Instagram, filters to Knicks, auto-tags, dedupes
   ├─ sources/twitter.mjs    (twitterapi.io  advanced_search)
   ├─ sources/instagram.mjs  (Apify apify/instagram-scraper)
   └─ lib/tag.mjs            (series / game / player / celebrity / festivities tagging)
        │
        ▼
docs/data/posts.json   ← the dataset the site reads
        │
        ▼
docs/ (index.html + styles.css + app.js)   ← the static, GitHub-Pages site
```

Nothing here scrapes the platforms directly — it calls two commercial services
you hold accounts with, and you supply the keys.

## Quick start

```bash
# 1. See the site right now with sample data
npm run sample            # regenerate the sample dataset (optional; already committed)
npm run serve             # http://localhost:8080

# 2. Pull in real posts
cp .env.example .env      # then paste your keys into .env
set -a; source .env; set +a
npm run ingest            # writes docs/data/posts.json
# or, to also mirror images locally (recommended — IG/X image URLs expire):
npm run ingest:media
```

### Get the API keys

| Service | What it scrapes | Env var | Link |
|---|---|---|---|
| twitterapi.io | X / Twitter | `TWITTERAPI_IO_KEY` | https://twitterapi.io |
| Apify | Instagram | `APIFY_TOKEN` | https://apify.com/apify/instagram-scraper |

If a key is missing, that source is skipped (with a warning) and the other still runs.

## Configure what gets collected — `config/sources.json`

Everything is driven by one file. Edit it, re-run `npm run ingest`, done.

- **`globalKeywords`** — a post is kept only if it mentions one of these.
- **`dateRange`** — outer bound for all scraping.
- **`twitter.handles` / `instagram.profileHandles`** — accounts to pull from.
- **`twitter.searchQueries` / `instagram.hashtags`** — broader keyword/hashtag searches.
- **`series[]`** — the playoff bracket. Each series has `start`/`end` dates and a
  list of `games` with dates. **Posts are auto-tagged to a game by date** (within
  ~1.5 days of tip-off). ⚠️ Opponents are placeholders — set them to the real matchups.
- **`festivities`** — keywords + events (parade, rally). Anything dated after the
  clincher, or matching these words, is tagged `festivities`.
- **`players[]` / `celebrities[]`** — names + aliases matched in captions to tag who's in a post.

## Deploy (GitHub Pages)

This repo serves the site from the **`docs/`** folder on the default branch.
In **Settings → Pages**, set Source = "Deploy from a branch", Branch = `main`,
Folder = `/docs`. Your site goes live at:

```
https://rkfalcon.github.io/<repo-name>/
```

To refresh the content later: re-run `npm run ingest:media`, then commit and push
the updated `docs/data/posts.json` (and `docs/media/`).

## Notes & honest caveats

- **Sample vs. real:** the committed `docs/data/posts.json` is clearly-labeled
  sample data (`"sample": true`) with invented fan captions and generated SVG
  "photos." It's replaced wholesale the first time `npm run ingest` succeeds.
- **Image hotlinking:** Instagram/X image URLs expire and often block hotlinking.
  Use `npm run ingest:media` to mirror images into `docs/media/` so the book keeps
  working long-term. (Mind the repo size if you collect thousands.)
- **Respect the sources:** all images and captions belong to their original
  posters. Every card links back to the original post. This is a non-commercial
  fan project.

— Built for the Garden faithful. Bing bong. 🟧🟦
