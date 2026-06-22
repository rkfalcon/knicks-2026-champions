#!/usr/bin/env node
// One-off backfill for accounts added today (never scraped yet).
// Scopes the scrape to active accounts with last_scraped_at = null, pulls the
// FULL window of Posts + Stories + Highlights, mirrors images, and marks them
// scraped. Leaves the nightly cron and all existing accounts untouched.
//
//   node --env-file-if-exists=.env scripts/backfill-new.mjs
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWITTERAPI_IO_KEY, APIFY_TOKEN

import { loadConfigFromDb } from "../lib/config-db.mjs";
import { scrapeAndTag, scrapeStories } from "../lib/pipeline.mjs";
import {
  getAdminClient, ensureBucket, uploadImage, upsertPosts,
} from "../lib/supabase.mjs";

const MAX_IMAGES = 1000; // generous safety cap on image mirroring

const sb = getAdminClient(process.env);
if (!sb) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

const countPosts = async () => {
  const { count } = await sb.from("posts").select("id", { count: "exact", head: true });
  return count || 0;
};

const config = await loadConfigFromDb(sb);
const newAccounts = (config.accounts || []).filter((a) => !a.last_scraped_at);

if (!newAccounts.length) {
  console.log("✅ No new accounts found (every active account already has last_scraped_at). Nothing to backfill.");
  process.exit(0);
}

const label = (a) => a.name || a.x_handle || a.ig_handle || a.id;
console.log(`\n🏀 Backfilling ${newAccounts.length} new account(s):`);
for (const a of newAccounts) {
  console.log(`   · ${label(a)}  [${[a.x_handle && "𝕏 @" + a.x_handle, a.ig_handle && "📸 @" + a.ig_handle].filter(Boolean).join("  ") || "no handles"}]`);
}
console.log(`   window: ${config.dateRange.since} → ${config.dateRange.until}\n`);

// Scope every source to just the new accounts; force highlights on for this run.
config.accounts = newAccounts;
config.twitter.handles = newAccounts.filter((a) => a.x_handle).map((a) => a.x_handle);
config.instagram.profileHandles = newAccounts.filter((a) => a.ig_handle).map((a) => a.ig_handle);
config.stories = { ...(config.stories || {}), include_highlights: true };

await ensureBucket(sb);

// Bounded image mirroring — every frame of each post (incl. carousels).
let mirrored = 0;
const srcImages = (p) => (p.images && p.images.length ? p.images : (p.image ? [p.image] : []));
async function mirrorBatch(items) {
  if (!items.length || mirrored >= MAX_IMAGES) return;
  const existing = new Map();
  const ids = items.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from("posts").select("id,image,images").in("id", ids.slice(i, i + 500));
    (data || []).forEach((r) => existing.set(r.id, r));
  }
  const changed = [];
  for (const p of items) {
    if (mirrored >= MAX_IMAGES) break;
    const ex = existing.get(p.id);
    const exImgs = (ex && Array.isArray(ex.images) && ex.images.length) ? ex.images : (ex?.image ? [ex.image] : []);
    const src = srcImages(p);
    if (exImgs.length === src.length && exImgs.length > 0 && exImgs.every((u) => u && u.includes("/storage/"))) {
      p.images = exImgs; p.image = exImgs[0]; continue;
    }
    const out = []; let uploaded = false;
    for (let idx = 0; idx < src.length; idx++) {
      const u = src[idx];
      if ((mirrored >= MAX_IMAGES) || !u || u.includes("/storage/") || !/^https?:/.test(u)) { out.push(u); continue; }
      const up = await uploadImage(sb, p.id, u, src.length > 1 ? `-${idx}` : "");
      if (up) { out.push(up); mirrored++; uploaded = true; } else out.push(u);
    }
    p.images = out; p.image = out[0] || p.image;
    if (uploaded) { p.remoteImage = src[0]; changed.push(p); }
  }
  if (changed.length) await upsertPosts(sb, changed);
}

const before = await countPosts();

// Phase 1 — X + Instagram posts.
const posts = await scrapeAndTag(config, process.env);
console.log(`scraped ${posts.length} posts (X + Instagram)`);
if (posts.length) { await upsertPosts(sb, posts); await mirrorBatch(posts); }

// Mark these accounts scraped now so the nightly cron treats them as known
// (and doesn't trigger a full-window re-scrape of everyone).
await sb.from("accounts").update({ last_scraped_at: new Date().toISOString() })
  .in("id", newAccounts.map((a) => a.id));

// Phase 2 — Instagram stories + highlights (fault-isolated).
let stories = [];
try {
  stories = await scrapeStories(config, process.env);
  if (stories.length) { await upsertPosts(sb, stories); await mirrorBatch(stories); }
} catch (e) {
  console.error(`⚠ stories/highlights phase failed (posts already saved): ${e.message}`);
}

const after = await countPosts();

// Per-account / per-type breakdown.
const all = [...posts, ...stories];
const typeOf = (p) => p.postType || "post";
const summary = {};
for (const a of newAccounts) {
  const xh = (a.x_handle || "").toLowerCase();
  const ih = (a.ig_handle || "").toLowerCase();
  const mine = all.filter((p) => {
    const au = (p.author || "").toLowerCase();
    return (p.platform === "x" && au === xh) || (p.platform === "instagram" && au === ih);
  });
  const by = { post: 0, story: 0, highlight: 0 };
  for (const p of mine) by[typeOf(p)] = (by[typeOf(p)] || 0) + 1;
  summary[label(a)] = { total: mine.length, ...by };
}

console.log("\n──────── BACKFILL COMPLETE ────────");
console.log(`new accounts:    ${newAccounts.length}`);
console.log(`scraped:         ${posts.length} posts + ${stories.length} stories/highlights = ${all.length}`);
console.log(`images mirrored: ${mirrored}${mirrored >= MAX_IMAGES ? " (hit cap!)" : ""}`);
console.log(`posts in DB:     ${before} → ${after}  (+${after - before} net new)`);
console.log("\nper-account captured this run (post / story / highlight):");
for (const [name, s] of Object.entries(summary)) {
  console.log(`   · ${name}: ${s.total}  (${s.post} post, ${s.story} story, ${s.highlight} highlight)`);
}
console.log("───────────────────────────────────\n");
