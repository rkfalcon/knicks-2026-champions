// Ingestion core, shared by scripts/ingest.mjs (CLI) and api/ingest.js (cron).
// scrape -> filter to Knicks -> auto-tag -> upload images -> upsert to Supabase.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fetchTwitter } from "./sources/twitter.mjs";
import { fetchInstagram } from "./sources/instagram.mjs";
import { isRelevant, tagPost } from "./tag.mjs";
import {
  getAdminClient, ensureBucket, uploadImage, upsertPosts, writeMeta,
} from "./supabase.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadConfig() {
  const raw = await readFile(join(__dirname, "..", "config", "sources.json"), "utf8");
  return JSON.parse(raw);
}

export async function scrapeAndTag(config, env = process.env) {
  const tweets = await fetchTwitter(config, env.TWITTERAPI_IO_KEY);
  const igPosts = await fetchInstagram(config, env.APIFY_TOKEN);
  const posts = [...tweets, ...igPosts]
    .filter((p) => p.date && isRelevant(p, config))
    .map((p) => ({ ...p, tags: tagPost(p, config) }));
  const byId = new Map(posts.map((p) => [p.id, p]));
  return [...byId.values()];
}

export async function runIngest({ env = process.env, uploadMedia = true, log = console.log } = {}) {
  const config = await loadConfig();
  const supabase = getAdminClient(env);
  if (!supabase) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");

  await ensureBucket(supabase);
  await writeMeta(supabase, config);

  const posts = await scrapeAndTag(config, env);
  log(`scraped ${posts.length} relevant posts`);

  if (uploadMedia) {
    let mirrored = 0;
    for (const p of posts) {
      if (p.image && /^https?:/.test(p.image)) {
        const url = await uploadImage(supabase, p.id, p.image);
        if (url) { p.remoteImage = p.image; p.image = url; mirrored++; }
      }
    }
    log(`mirrored ${mirrored} images to Storage`);
  }

  const count = await upsertPosts(supabase, posts);
  log(`upserted ${count} posts`);
  return { count };
}
