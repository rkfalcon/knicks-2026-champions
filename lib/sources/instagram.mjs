// Apify Instagram Scraper adapter (apify/instagram-scraper).
// KEY: scrape profiles in SMALL BATCHES run in parallel. One giant request with
// all profiles gets throttled by Instagram (returns only big accounts); batches
// of ~5 reliably return every profile. No residential proxies needed.
import { fetchWithTimeout } from "../http.mjs";

const ENDPOINT =
  "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";

const BATCH_SIZE = 5;   // profiles per Apify run
const CONCURRENCY = 8;  // batches in flight at once (free plan allows 25)

// Every still frame of a post: carousel children (each slide's display image,
// incl. video thumbnails), else the sidecar `images` array, else the cover.
function imagesOf(item) {
  if (Array.isArray(item.childPosts) && item.childPosts.length) {
    const frames = item.childPosts.map((c) => c.displayUrl || c.imageUrl).filter(Boolean);
    if (frames.length) return frames;
  }
  if (Array.isArray(item.images) && item.images.length) return item.images.filter(Boolean);
  return item.displayUrl ? [item.displayUrl] : [];
}

export function normalizeItem(item) {
  if (!item || item.error || !item.shortCode) return null;
  const images = imagesOf(item);
  // IG "collab" co-authors (the post shows on each co-author's grid).
  const coauthors = Array.isArray(item.coauthorProducers)
    ? item.coauthorProducers.map((c) => ({ username: c.username, fullName: c.full_name })).filter((c) => c.username)
    : [];
  return {
    id: `ig-${item.shortCode}`,
    platform: "instagram",
    author: item.ownerUsername || "unknown",
    authorName: item.ownerFullName || item.ownerUsername || "",
    coauthors,
    authorAvatar: null,
    text: item.caption || "",
    image: images[0] || item.displayUrl || null,
    images,
    video: item.type === "Video" || Boolean(item.videoUrl),
    url: item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null),
    date: item.timestamp || null,
    likes: item.likesCount ?? 0,
    reposts: 0,
    views: item.videoViewCount ?? 0,
  };
}

async function runBatch(group, token, config) {
  // NOTE: do NOT pass `onlyPostsNewerThan`. With that param the apify actor
  // returns mostly *tagged/collab* posts and only a handful of the profile's
  // OWN posts (e.g. 5 vs 20 for the same profile) — it silently under-captures
  // every account. We fetch the latest `resultsLimit` posts and apply the date
  // window ourselves in tagAndDedupe() instead.
  const input = {
    directUrls: group.map((h) => `https://www.instagram.com/${h}/`),
    resultsType: "posts",
    resultsLimit: config.instagram.resultsLimitPerSource ?? 20,
    addParentData: false,
  };
  try {
    const res = await fetchWithTimeout(`${ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, config.instagram.batchTimeoutMs ?? 120000);
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    return await res.json();
  } catch (err) {
    console.warn(`  ⚠ IG batch [${group.join(",")}] failed: ${err.message}`);
    return [];
  }
}

export async function fetchInstagram(config, token, { timeLeft = () => Infinity } = {}) {
  if (!token) {
    console.warn("  ⚠ APIFY_TOKEN not set — skipping Instagram.");
    return [];
  }
  const handles = config.instagram.profileHandles || [];
  if (!handles.length) return [];
  const wanted = new Set(handles.map((h) => h.toLowerCase()));
  const batchTimeout = config.instagram.batchTimeoutMs ?? 120000;

  const batches = [];
  for (let i = 0; i < handles.length; i += BATCH_SIZE) batches.push(handles.slice(i, i + BATCH_SIZE));

  // Run batches in parallel, capped at CONCURRENCY in flight. Stop starting new
  // waves when there isn't enough budget left for a wave's worst case (one batch
  // timeout) so the cron never overruns the serverless limit mid-scrape.
  const raw = [];
  let done = 0;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    if (timeLeft() < batchTimeout + 10000) {
      console.warn(`  ⚠ IG scrape stopping early at ${done}/${batches.length} batches (time budget)`);
      break;
    }
    const slice = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map((g) => runBatch(g, token, config)));
    for (const items of results) raw.push(...(items || []));
    done += slice.length;
  }

  const allTracked = config.allTrackedHandles || wanted;
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const n = normalizeItem(item);
    if (!n || seen.has(n.id)) continue;
    const owner = (n.author || "").toLowerCase();
    if (!wanted.has(owner)) {
      // Not owned by a scraped profile. Keep it only if a scraped profile is an
      // IG-collab CO-AUTHOR *and* the owner isn't itself a tracked account (those
      // posts get captured — and correctly attributed — via the owner's own scrape).
      // This pulls in players' brand collabs (Skechers/NBA/MLB…) that live on their
      // grid, attributing the post to the player.
      const co = (n.coauthors || []).find((c) => wanted.has((c.username || "").toLowerCase()));
      if (!co || allTracked.has(owner)) continue;
      n.author = co.username;
      n.authorName = co.fullName || n.authorName;
      n.coauthored = true;
    }
    seen.add(n.id);
    out.push(n);
  }
  console.log(`  · Instagram → ${out.length} posts from ${handles.length} profiles (${batches.length} batches of ${BATCH_SIZE})`);
  return out;
}
