// Apify Instagram Scraper adapter.
// Actor: apify/instagram-scraper
// Run-sync endpoint returns dataset items directly:
//   POST https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=APIFY_TOKEN
// Output item fields used: caption, displayUrl, ownerUsername, timestamp, likesCount,
//   commentsCount, url, shortCode, hashtags, type, videoUrl

const ENDPOINT =
  "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";

function buildInput(config) {
  const directUrls = (config.instagram.profileHandles || []).map(
    (h) => `https://www.instagram.com/${h}/`
  );
  return {
    directUrls,
    search: (config.instagram.hashtags || []).map((h) => `#${h}`).join(" "),
    searchType: "hashtag",
    searchLimit: config.instagram.hashtags?.length ? 5 : 0,
    resultsType: "posts",
    resultsLimit: config.instagram.resultsLimitPerSource ?? 50,
    onlyPostsNewerThan: config.dateRange.since,
    addParentData: false,
  };
}

function normalizeItem(item) {
  if (!item || item.error || !item.shortCode) return null;
  return {
    id: `ig-${item.shortCode}`,
    platform: "instagram",
    author: item.ownerUsername || "unknown",
    authorName: item.ownerFullName || item.ownerUsername || "",
    authorAvatar: null,
    text: item.caption || "",
    image: item.displayUrl || null,
    video: item.type === "Video" || Boolean(item.videoUrl),
    url: item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null),
    date: item.timestamp || null,
    likes: item.likesCount ?? 0,
    reposts: 0,
    views: item.videoViewCount ?? 0,
  };
}

export async function fetchInstagram(config, token) {
  if (!token) {
    console.warn("  ⚠ APIFY_TOKEN not set — skipping Instagram.");
    return [];
  }
  const url = `${ENDPOINT}?token=${encodeURIComponent(token)}`;
  let items;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInput(config)),
    });
    if (!res.ok) throw new Error(`Apify ${res.status}: ${await res.text()}`);
    items = await res.json();
  } catch (err) {
    console.warn(`  ⚠ Instagram scrape failed: ${err.message}`);
    return [];
  }

  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const n = normalizeItem(raw);
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      out.push(n);
    }
  }
  console.log(`  · Instagram → ${out.length} posts`);
  return out;
}
