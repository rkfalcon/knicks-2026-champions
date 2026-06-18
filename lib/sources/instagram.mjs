// Instagram posts adapter — uses a per-username Apify actor that reliably covers
// profiles the default anonymous scraper can't (player/celeb accounts).
// Actor (configurable): muhammetakkurtt/instagram-scraper
//   input: { usernames[], resultsType: "posts", limit }
//   output: Instagram GraphQL nodes (display_url, shortcode, owner.username,
//           taken_at_timestamp, edge_media_to_caption…)

const DEFAULT_ACTOR = "muhammetakkurtt/instagram-scraper";

function runUrl(actor, token) {
  return `https://api.apify.com/v2/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
}

function normalizeItem(item) {
  if (!item || item.error) return null;
  const shortcode = item.shortCode || item.shortcode || item.code;
  if (!shortcode) return null;
  const owner = item.ownerUsername || item.owner?.username || item.username || "unknown";
  const caption =
    item.caption ||
    item.edge_media_to_caption?.edges?.[0]?.node?.text ||
    item.accessibility_caption || "";
  const ts = item.timestamp || item.taken_at_timestamp || item.takenAtTimestamp;
  const date = ts
    ? new Date(typeof ts === "number" || /^\d+$/.test(ts) ? Number(ts) * 1000 : ts).toISOString()
    : null;
  const video = item.is_video ?? (item.type === "Video") ?? Boolean(item.videoUrl);
  return {
    id: `ig-${shortcode}`,
    platform: "instagram",
    author: owner,
    authorName: item.ownerFullName || item.owner?.full_name || owner,
    authorAvatar: null,
    text: caption,
    image: item.displayUrl || item.display_url || null,
    video,
    url: item.url || `https://www.instagram.com/p/${shortcode}/`,
    date,
    likes: item.likesCount ?? item.edge_media_preview_like?.count ?? 0,
    reposts: 0,
    views: item.videoViewCount ?? item.video_view_count ?? 0,
  };
}

export async function fetchInstagram(config, token) {
  if (!token) {
    console.warn("  ⚠ APIFY_TOKEN not set — skipping Instagram.");
    return [];
  }
  const usernames = config.instagram.profileHandles || [];
  if (!usernames.length) return [];

  const actor = config.instagram.postsActor || DEFAULT_ACTOR;
  const limit = config.instagram.resultsLimitPerSource ?? 30;
  const sinceMs = Date.parse(config.dateRange?.since || "1970-01-01");

  let items;
  try {
    const res = await fetch(runUrl(actor, token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames, resultsType: "posts", limit }),
    });
    if (!res.ok) throw new Error(`Apify ${actor} ${res.status}: ${(await res.text()).slice(0, 160)}`);
    items = await res.json();
  } catch (err) {
    console.warn(`  ⚠ Instagram scrape failed: ${err.message}`);
    return [];
  }

  const seen = new Set();
  const out = [];
  for (const raw of items || []) {
    const n = normalizeItem(raw);
    if (!n || seen.has(n.id)) continue;
    // keep only posts within the scrape window (this actor filters by count, not date)
    if (n.date && Date.parse(n.date) < sinceMs) continue;
    seen.add(n.id);
    out.push(n);
  }
  console.log(`  · Instagram (${actor}) → ${out.length} posts from ${usernames.length} profiles`);
  return out;
}
