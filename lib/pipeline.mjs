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

// Tag, source-stamp, and dedupe a batch of raw scraped items.
function tagAndDedupe(raw, config) {
  const tracked = { x: new Set(), instagram: new Set() };
  for (const a of config.accounts || []) {
    if (a.x_handle) tracked.x.add(a.x_handle.toLowerCase());
    if (a.ig_handle) tracked.instagram.add(a.ig_handle.toLowerCase());
  }
  const posts = raw
    .filter((p) => p.date && (p.postType === "story" || p.postType === "highlight" || isRelevant(p, config)))
    .map((p) => {
      const authorLc = (p.author || "").toLowerCase();
      const sourceHandle = tracked[p.platform]?.has(authorLc) ? p.author : (p.sourceHandle || null);
      return { ...p, sourceHandle, postType: p.postType || "post", tags: tagPost(p, config) };
    });
  return [...new Map(posts.map((p) => [p.id, p])).values()];
}

// X + Instagram posts (no stories — those are scraped separately so a slow/failed
// stories pass can't lose the night's posts).
export async function scrapeAndTag(config, env = process.env) {
  const tweets = await fetchTwitter(config, env.TWITTERAPI_IO_KEY);
  const igPosts = await fetchInstagram(config, env.APIFY_TOKEN);
  return tagAndDedupe([...tweets, ...igPosts], config);
}

export async function scrapeStories(config, env = process.env) {
  const stories = await fetchInstagramStories(config, env);
  return tagAndDedupe(stories, config);
}

export async function runIngest({
  env = process.env, uploadMedia = true, sinceDays = null, maxImages = null,
  accountId = null, record = false, trigger = "cli", log = console.log,
  incrementalOnly = false, resultsLimit = null,
} = {}) {
  const supabase = getAdminClient(env);
  if (!supabase) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");

  // All scraping config lives in Supabase (managed via /admin).
  const config = await loadConfigFromDb(supabase);

  // Restrict to active accounts — and to one account if accountId is given.
  let accounts = (config.accounts || []).filter((a) => a.active);
  if (accountId) accounts = accounts.filter((a) => a.id === accountId);
  config.accounts = accounts;
  config.twitter.handles = accounts.filter((a) => a.x_handle).map((a) => a.x_handle);
  config.instagram.profileHandles = accounts.filter((a) => a.ig_handle).map((a) => a.ig_handle);

  const scope = accountId
    ? (accounts[0]?.name || accounts[0]?.x_handle || accounts[0]?.ig_handle || "account")
    : "all";

  // Window: full backfill for a single account, for any never-scraped account,
  // or when no incremental window is requested (CLI/manual "run all"). Otherwise
  // a trimmed rolling window (the cron).
  // Window: full backfill for a single account or the CLI; otherwise the trimmed
  // rolling window. `incrementalOnly` (the nightly cron) forces the rolling window
  // even when a never-scraped account exists — a full all-accounts scrape can't
  // fit the 300s budget, so new accounts are backfilled separately (scripts/
  // backfill-new.mjs) instead of blowing up the cron.
  const anyNew = accounts.some((a) => !a.last_scraped_at);
  const full = !incrementalOnly && (!!accountId || anyNew || !sinceDays);
  if (!full) {
    const days = sinceDays || 4;
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    config.dateRange = { ...config.dateRange, since };
    config.twitter = { ...config.twitter, maxPagesPerQuery: 2 };
    config.instagram = { ...config.instagram, resultsLimitPerSource: 25 };
    log(`incremental window since ${since}`);
    if (anyNew) log("  ⚠ new (never-scraped) accounts present — run scripts/backfill-new.mjs to backfill their history");
  } else {
    log(`full window since ${config.dateRange.since}${anyNew ? " (new account present)" : ""}`);
  }
  // Deeper per-profile fetch (e.g. an image-backfill that must re-reach every
  // historical post, not just the most recent few).
  if (resultsLimit) {
    config.instagram = { ...config.instagram, resultsLimitPerSource: resultsLimit };
    config.twitter = { ...config.twitter, maxPagesPerQuery: Math.max(config.twitter.maxPagesPerQuery || 0, 5) };
    log(`results limit per source: ${resultsLimit}`);
  }

  // Open a run record. First auto-resolve runs left "running" by a previous
  // serverless timeout, then skip if another run is genuinely in-flight (stops
  // the cron from double-firing two overlapping scrapes).
  let runId = null;
  if (record) {
    const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase.from("runs")
      .update({ status: "error", error: "timed out (stale)", finished_at: new Date().toISOString() })
      .eq("status", "running").lt("started_at", staleIso);
    const { data: active } = await supabase.from("runs")
      .select("id").eq("status", "running").gte("started_at", staleIso).limit(1);
    if (active && active.length) {
      log("another run is already in progress — skipping");
      return { count: 0, mirrored: 0, skipped: true };
    }
    const { data } = await supabase.from("runs")
      .insert({ scope, account_id: accountId, trigger, status: "running" }).select();
    runId = data?.[0]?.id;
  }
  const finish = async (patch) => {
    if (record && runId) {
      await supabase.from("runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", runId);
    }
  };

  const srcImages = (p) => (p.images && p.images.length ? p.images : (p.image ? [p.image] : []));

  // Before upserting, swap in already-stored URLs for posts whose full image set
  // is mirrored at the same count — so the upsert never replaces good Storage
  // URLs with fresh (expiring) remote ones.
  const reuseMirrored = async (items) => {
    const ids = items.map((p) => p.id);
    const existing = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await supabase.from("posts").select("id,image,images").in("id", ids.slice(i, i + 500));
      (data || []).forEach((r) => existing.set(r.id, r));
    }
    for (const p of items) {
      const ex = existing.get(p.id);
      if (!ex) continue;
      const exImgs = Array.isArray(ex.images) && ex.images.length ? ex.images : (ex.image ? [ex.image] : []);
      const src = srcImages(p);
      const allStored = exImgs.length === src.length && exImgs.length > 0 &&
        exImgs.every((u) => u && u.includes("/storage/"));
      if (allStored) { p.images = exImgs; p.image = exImgs[0]; }
    }
  };

  // Mirror every still frame of each post to Storage, bounded by the run's shared
  // image budget. Multi-image posts get per-frame keys (id-0, id-1, …).
  let mirroredTotal = 0;
  const mirrorBatch = async (items) => {
    if (!uploadMedia || !items.length) return;
    if (maxImages && mirroredTotal >= maxImages) return;
    const changed = [];
    for (const p of items) {
      if (maxImages && mirroredTotal >= maxImages) break;
      const src = srcImages(p);
      if (!src.length || src.every((u) => u && u.includes("/storage/"))) continue;
      const out = [];
      let uploaded = false;
      for (let idx = 0; idx < src.length; idx++) {
        const u = src[idx];
        if ((maxImages && mirroredTotal >= maxImages) || !u || u.includes("/storage/") || !/^https?:/.test(u)) {
          out.push(u);
          continue;
        }
        const up = await uploadImage(supabase, p.id, u, src.length > 1 ? `-${idx}` : "");
        if (up) { out.push(up); mirroredTotal++; uploaded = true; } else out.push(u);
      }
      p.images = out;
      p.image = out[0] || p.image;
      if (uploaded) { p.remoteImage = src[0]; changed.push(p); }
    }
    if (changed.length) await upsertPosts(supabase, changed);
  };

  try {
    if (!accounts.length) { await finish({ status: "done", scraped: 0, upserted: 0, mirrored: 0 }); return { count: 0, mirrored: 0, runId }; }

    await ensureBucket(supabase);
    await writeMeta(supabase, config);

    // Phase 1 — X + Instagram posts. Persisted before stories so a slow/failed
    // stories pass can never lose the night's posts.
    const posts = await scrapeAndTag(config, env);
    log(`scraped ${posts.length} relevant posts`);
    await supabase.from("accounts").update({ last_scraped_at: new Date().toISOString() })
      .in("id", accounts.map((a) => a.id));
    if (posts.length) { await reuseMirrored(posts); await upsertPosts(supabase, posts); await mirrorBatch(posts); }

    // Phase 2 — Instagram stories/highlights (fault-isolated: its own try/catch).
    let storyCount = 0;
    try {
      const stories = await scrapeStories(config, env);
      if (stories.length) { await reuseMirrored(stories); await upsertPosts(supabase, stories); await mirrorBatch(stories); storyCount = stories.length; }
    } catch (e) {
      log(`⚠ stories phase failed (posts already saved): ${e.message}`);
    }

    const total = posts.length + storyCount;
    await finish({ status: "done", scraped: total, upserted: total, mirrored: mirroredTotal });
    log(`upserted ${total} (${posts.length} posts + ${storyCount} stories), mirrored ${mirroredTotal}`);
    return { count: total, mirrored: mirroredTotal, runId };
  } catch (e) {
    await finish({ status: "error", error: String(e.message || e) });
    throw e;
  }
}
