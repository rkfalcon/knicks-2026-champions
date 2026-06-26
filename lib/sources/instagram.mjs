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
  return {
    id: `ig-${item.shortCode}`,
    platform: "instagram",
    author: item.ownerUsername || "unknown",
    authorName: item.ownerFullName || item.ownerUsername || "",
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
  const input = {
    directUrls: group.map((h) => `https://www.instagram.com/${h}/`),
    resultsType: "posts",
    resultsLimit: config.instagram.resultsLimitPerSource ?? 20,
    onlyPostsNewerThan: config.dateRange.since,
    addParentData: false,
  };
  try {
    const res = await fetchWithTimeout(`${ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, 150000);
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    return await res.json();
  } catch (err) {
    console.warn(`  ⚠ IG batch [${group.join(",")}] failed: ${err.message}`);
    return [];
  }
}

export async function fetchInstagram(config, token) {
  if (!token) {
    console.warn("  ⚠ APIFY_TOKEN not set — skipping Instagram.");
    return [];
  }
  const handles = config.instagram.profileHandles || [];
  if (!handles.length) return [];
  const wanted = new Set(handles.map((h) => h.toLowerCase()));

  const batches = [];
  for (let i = 0; i < handles.length; i += BATCH_SIZE) batches.push(handles.slice(i, i + BATCH_SIZE));

  // Run batches in parallel, capped at CONCURRENCY in flight.
  const raw = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const slice = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map((g) => runBatch(g, token, config)));
    for (const items of results) raw.push(...(items || []));
  }

  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const n = normalizeItem(item);
    if (!n || seen.has(n.id)) continue;
    // Account-only: keep only posts owned by a tracked profile (drops tagged/collab
    // posts whose owner is some non-tracked account).
    if (!wanted.has((n.author || "").toLowerCase())) continue;
    seen.add(n.id);
    out.push(n);
  }
  console.log(`  · Instagram → ${out.length} posts from ${handles.length} profiles (${batches.length} batches of ${BATCH_SIZE})`);
  return out;
}
