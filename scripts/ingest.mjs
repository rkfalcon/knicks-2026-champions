#!/usr/bin/env node
// Orchestrator: scrape X + Instagram, filter to Knicks-relevant, auto-tag,
// dedupe, sort, and write docs/data/posts.json.
//
//   node scripts/ingest.mjs            # scrape + write data
//   node scripts/ingest.mjs --download # also mirror media into docs/media/
//
// Reads keys from env: TWITTERAPI_IO_KEY, APIFY_TOKEN

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { fetchTwitter } from "./sources/twitter.mjs";
import { fetchInstagram } from "./sources/instagram.mjs";
import { isRelevant, tagPost } from "./lib/tag.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_OUT = join(ROOT, "docs", "data", "posts.json");
const MEDIA_DIR = join(ROOT, "docs", "media");

const DOWNLOAD = process.argv.includes("--download");

async function loadConfig() {
  const raw = await readFile(join(ROOT, "config", "sources.json"), "utf8");
  return JSON.parse(raw);
}

async function downloadMedia(post) {
  if (!post.image) return post;
  try {
    const res = await fetch(post.image);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ext = (extname(new URL(post.image).pathname) || ".jpg").split("?")[0] || ".jpg";
    const name = createHash("sha1").update(post.id).digest("hex").slice(0, 16) + ext;
    await mkdir(MEDIA_DIR, { recursive: true });
    await pipeline(Readable.fromWeb(res.body), createWriteStream(join(MEDIA_DIR, name)));
    return { ...post, image: `media/${name}`, remoteImage: post.image };
  } catch (err) {
    console.warn(`  ⚠ media download failed for ${post.id}: ${err.message}`);
    return post; // keep the remote URL as a fallback
  }
}

async function main() {
  const config = await loadConfig();
  console.log(`\n🏀 Ingesting ${config.team.name} ${config.team.season} championship posts\n`);

  console.log("Fetching X / Twitter…");
  const tweets = await fetchTwitter(config, process.env.TWITTERAPI_IO_KEY);
  console.log("Fetching Instagram…");
  const igPosts = await fetchInstagram(config, process.env.APIFY_TOKEN);

  let posts = [...tweets, ...igPosts]
    .filter((p) => p.date && isRelevant(p, config))
    .map((p) => ({ ...p, tags: tagPost(p, config) }));

  // dedupe by id, then sort newest-first
  const byId = new Map(posts.map((p) => [p.id, p]));
  posts = [...byId.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  if (DOWNLOAD) {
    console.log(`\nMirroring media locally (--download)…`);
    posts = [];
    for (const p of byId.values()) posts.push(await downloadMedia(p));
    posts.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    team: config.team,
    series: config.series.map((s) => ({
      id: s.id, label: s.label, opponent: s.opponent, result: s.result,
      games: s.games.map((g) => ({ id: g.id, label: g.label, date: g.date, result: g.result })),
    })),
    festivities: config.festivities,
    players: config.players.map((p) => ({ name: p.name, number: p.number })),
    celebrities: config.celebrities.map((c) => ({ name: c.name })),
    count: posts.length,
    posts,
  };

  await mkdir(dirname(DATA_OUT), { recursive: true });
  await writeFile(DATA_OUT, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Wrote ${posts.length} posts → ${DATA_OUT}\n`);

  if (posts.length === 0) {
    console.log("No posts written. Set TWITTERAPI_IO_KEY and APIFY_TOKEN, then re-run.");
    console.log("The site still renders from the committed sample data meanwhile.\n");
  }
}

main().catch((err) => {
  console.error("\n❌ Ingest failed:", err);
  process.exit(1);
});
