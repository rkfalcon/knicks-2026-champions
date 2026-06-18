// Instagram Stories (active, 24h) + optional Highlights via Apify.
// Actor (configurable): automation-lab/instagram-stories-scraper
//   input:  { usernames[], sessionCookie, includeHighlights, maxHighlights }
//   output: { username, storyId, mediaType, mediaUrl, timestamp, expiresAt,
//             caption, highlightTitle, ...profile-info items (no mediaUrl) }
// Requires a logged-in Instagram sessionid cookie (settings.stories).
// Scraped in small parallel batches (Instagram throttles big requests).

const DEFAULT_ACTOR = "automation-lab/instagram-stories-scraper";
const BATCH = 5;
const CONCURRENCY = 6;

const runUrl = (actor, token) =>
  `https://api.apify.com/v2/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

function normalize(item) {
  if (!item || !item.mediaUrl) return null; // skip profile-info rows
  const username = item.username || item.ownerUsername || "unknown";
  const isHighlight = Boolean(item.highlightTitle) || item.type === "highlight";
  const video = /video/i.test(item.mediaType || "");
  const ts = item.timestamp || item.takenAt || item.createdAt;
  const date = ts ? new Date(ts).toISOString() : null;
  const sid = item.storyId || item.id || `${username}-${ts || item.mediaUrl}`;
  return {
    id: `igs-${isHighlight ? "h" : "s"}-${sid}`,
    platform: "instagram",
    author: username,
    authorName: username,
    authorAvatar: item.profilePicUrl || null,
    text: item.caption || item.highlightTitle || "",
    image: video ? null : item.mediaUrl, // story image (videos fall back to placeholder)
    video,
    url: item.url || `https://www.instagram.com/${username}/`,
    date,
    likes: 0, reposts: 0, views: 0,
    postType: isHighlight ? "highlight" : "story",
    expiresAt: item.expiresAt || null,
  };
}

async function runBatch(actor, token, usernames, cookie, includeHighlights) {
  const res = await fetch(runUrl(actor, token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames, sessionCookie: cookie, includeHighlights, maxHighlights: 5 }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

export async function fetchInstagramStories(config, env) {
  const st = config.stories || {};
  const token = env.APIFY_TOKEN;
  if (!st.enabled || !st.ig_session_cookie || !token) {
    if (st.enabled && !st.ig_session_cookie) console.warn("  ⚠ stories enabled but no IG cookie set — skipping.");
    return [];
  }
  const usernames = config.instagram.profileHandles || [];
  if (!usernames.length) return [];

  const actor = st.active_actor || DEFAULT_ACTOR;
  const includeHighlights = Boolean(st.include_highlights); // default: stories only
  const sinceMs = Date.parse(config.dateRange?.since || "1970-01-01");

  const batches = [];
  for (let i = 0; i < usernames.length; i += BATCH) batches.push(usernames.slice(i, i + BATCH));

  const raw = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const slice = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map((g) =>
      runBatch(actor, token, g, st.ig_session_cookie, includeHighlights)
        .catch((e) => { console.warn(`  ⚠ stories batch [${g.join(",")}] failed: ${e.message}`); return []; })));
    for (const items of results) raw.push(...(items || []));
  }

  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const n = normalize(item);
    if (!n || seen.has(n.id)) continue;
    if (n.date && Date.parse(n.date) < sinceMs) continue; // drop pre-window (old highlights)
    seen.add(n.id);
    out.push(n);
  }
  console.log(`  · Instagram stories${includeHighlights ? "/highlights" : ""} → ${out.length}`);
  return out;
}
