// Ingestion core, shared by scripts/ingest.mjs (CLI) and api/ingest.js (cron).
// scrape -> filter to Knicks -> auto-tag -> upload images -> upsert to Supabase.

import { fetchTwitter } from "./sources/twitter.mjs";
import { fetchInstagram } from "./sources/instagram.mjs";
import { fetchInstagramStories } from "./sources/instagram-stories.mjs";
import { isRelevant, tagPost } from "./tag.mjs";
import { loadConfigFromDb } from "./config-db.mjs";
import {
  getAdminClient, ensureBucket, uploadImage, upsertPosts, writeMeta,
} from "./supabase.mjs";

export async function scrapeAndTag(config, env = process.env) {
  const tweets = await fetchTwitter(config, env.TWITTERAPI_IO_KEY);
  const igPosts = await fetchInstagram(config, env.APIFY_TOKEN);
  const stories = await fetchInstagramStories(config, env);

  // Set of tracked handles per platform → mark which posts are "from" a tracked account.
  const tracked = { x: new Set(), instagram: new Set() };
  for (const a of config.accounts || []) tracked[a.platform]?.add(a.handle.toLowerCase());

  const raw = [...tweets, ...igPosts, ...stories];
  const posts = raw
    .filter((p) => p.date && (p.postType === "story" || p.postType === "highlight" || isRelevant(p, config)))
    .map((p) => {
      const authorLc = (p.author || "").toLowerCase();
      const sourceHandle = tracked[p.platform]?.has(authorLc) ? p.author : (p.sourceHandle || null);
      return { ...p, sourceHandle, postType: p.postType || "post", tags: tagPost(p, config) };
    });

  const byId = new Map(posts.map((p) => [p.id, p]));
  return [...byId.values()];
}

export async function runIngest({
  env = process.env, uploadMedia = true, sinceDays = null, maxImages = null, log = console.log,
} = {}) {
  const supabase = getAdminClient(env);
  if (!supabase) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");

  // All scraping config now lives in Supabase (managed via /admin).
  const config = await loadConfigFromDb(supabase);

  // Incremental mode (used by the cron): look back only a few days and trim
  // scrape scope so the run stays well within the serverless time budget.
  if (sinceDays) {
    const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
    config.dateRange = { ...config.dateRange, since };
    config.twitter = { ...config.twitter, maxPagesPerQuery: 2 };
    config.instagram = { ...config.instagram, resultsLimitPerSource: 25 };
    log(`incremental window since ${since}`);
  }

  await ensureBucket(supabase);
  await writeMeta(supabase, config);

  const posts = await scrapeAndTag(config, env);
  log(`scraped ${posts.length} relevant posts`);
  if (!posts.length) return { count: 0, mirrored: 0 };

  // 1) Persist post data immediately so a later timeout never loses it. Images
  //    keep their original (remote) URL for now.
  await upsertPosts(supabase, posts);

  // 2) Mirror images in a bounded batch. Posts left with a remote URL are
  //    re-attempted on the next run (the skip check only short-circuits when the
  //    stored URL is already in Storage), so coverage self-heals over time.
  let mirrored = 0;
  if (uploadMedia) {
    const existing = new Map();
    const ids = posts.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await supabase.from("posts").select("id,image").in("id", ids.slice(i, i + 500));
      (data || []).forEach((r) => existing.set(r.id, r.image));
    }
    const changed = [];
    for (const p of posts) {
      if (maxImages && mirrored >= maxImages) break;
      const ex = existing.get(p.id);
      if (ex && ex.includes("/storage/")) continue; // already mirrored
      if (p.image && /^https?:/.test(p.image)) {
        const url = await uploadImage(supabase, p.id, p.image);
        if (url) { p.remoteImage = p.image; p.image = url; mirrored++; changed.push(p); }
      }
    }
    if (changed.length) await upsertPosts(supabase, changed);
    log(`mirrored ${mirrored} new images to Storage`);
  }

  log(`upserted ${posts.length} posts`);
  return { count: posts.length, mirrored };
}
