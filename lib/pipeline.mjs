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
  for (const a of config.accounts || []) {
    if (a.x_handle) tracked.x.add(a.x_handle.toLowerCase());
    if (a.ig_handle) tracked.instagram.add(a.ig_handle.toLowerCase());
  }

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
  env = process.env, uploadMedia = true, sinceDays = null, maxImages = null,
  accountId = null, record = false, trigger = "cli", log = console.log,
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
  const anyNew = accounts.some((a) => !a.last_scraped_at);
  const full = !!accountId || anyNew || !sinceDays;
  if (!full) {
    const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
    config.dateRange = { ...config.dateRange, since };
    config.twitter = { ...config.twitter, maxPagesPerQuery: 2 };
    config.instagram = { ...config.instagram, resultsLimitPerSource: 25 };
    log(`incremental window since ${since}`);
  } else {
    log(`full window since ${config.dateRange.since}${anyNew ? " (new account present)" : ""}`);
  }

  // Open a run record.
  let runId = null;
  if (record) {
    const { data } = await supabase.from("runs")
      .insert({ scope, account_id: accountId, trigger, status: "running" }).select();
    runId = data?.[0]?.id;
  }
  const finish = async (patch) => {
    if (record && runId) {
      await supabase.from("runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", runId);
    }
  };

  try {
    if (!accounts.length) { await finish({ status: "done", scraped: 0, upserted: 0, mirrored: 0 }); return { count: 0, mirrored: 0, runId }; }

    await ensureBucket(supabase);
    await writeMeta(supabase, config);

    const posts = await scrapeAndTag(config, env);
    log(`scraped ${posts.length} relevant posts`);

    // Mark these accounts as scraped (so they go incremental next time).
    await supabase.from("accounts").update({ last_scraped_at: new Date().toISOString() })
      .in("id", accounts.map((a) => a.id));

    if (!posts.length) { await finish({ status: "done", scraped: 0, upserted: 0, mirrored: 0 }); return { count: 0, mirrored: 0, runId }; }

    // 1) Persist post data first (survives a later timeout).
    await upsertPosts(supabase, posts);

    // 2) Mirror images in a bounded, self-healing batch.
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
        if (ex && ex.includes("/storage/")) continue;
        if (p.image && /^https?:/.test(p.image)) {
          const url = await uploadImage(supabase, p.id, p.image);
          if (url) { p.remoteImage = p.image; p.image = url; mirrored++; changed.push(p); }
        }
      }
      if (changed.length) await upsertPosts(supabase, changed);
      log(`mirrored ${mirrored} new images to Storage`);
    }

    await finish({ status: "done", scraped: posts.length, upserted: posts.length, mirrored });
    log(`upserted ${posts.length} posts`);
    return { count: posts.length, mirrored, runId };
  } catch (e) {
    await finish({ status: "error", error: String(e.message || e) });
    throw e;
  }
}
