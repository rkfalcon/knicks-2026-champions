// Instagram Stories (active) + Highlights (older) via Apify.
// Both require a logged-in Instagram session cookie (sessionid) — Instagram does
// not expose stories anonymously. Configured in settings.stories:
//   { enabled, ig_session_cookie, active_actor, highlights_actor }
// Actor input schemas vary, so field extraction here is intentionally defensive.

const runUrl = (actor, token) =>
  `https://api.apify.com/v2/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

async function runActor(actor, token, input) {
  const res = await fetch(runUrl(actor, token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`${actor} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

function normalize(item, type) {
  const username =
    item.ownerUsername || item.username || item.user?.username || item.owner?.username || "unknown";
  const video = !!(item.videoUrl || item.isVideo || /video/i.test(item.type || item.mediaType || ""));
  const image =
    item.thumbnailUrl || item.displayUrl || item.imageUrl || item.mediaUrl ||
    (!video ? item.url : null) || null;
  const ts = item.timestamp || item.takenAt || item.taken_at || item.takenAtDate || item.createdAt || null;
  const id = item.id || item.pk || item.storyId || item.shortCode || `${username}-${ts || ""}`;
  const date = ts ? new Date(isNaN(ts) ? ts : Number(ts) * (String(ts).length <= 10 ? 1000 : 1)).toISOString() : null;
  return {
    id: `igs-${type}-${id}`,
    platform: "instagram",
    author: username,
    authorName: username,
    authorAvatar: item.profilePicUrl || null,
    text: item.caption || item.text || "",
    image,
    video,
    url: item.url || `https://www.instagram.com/${username}/`,
    date,
    likes: 0,
    reposts: 0,
    views: item.viewsCount || item.videoViewCount || 0,
    postType: type,
    expiresAt: type === "story" && date ? new Date(Date.parse(date) + 24 * 3600e3).toISOString() : null,
  };
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
  const cookieInputs = { sessionid: st.ig_session_cookie, cookies: st.ig_session_cookie, session_id: st.ig_session_cookie };
  const out = [];
  const seen = new Set();

  const collect = (items, type) => {
    for (const it of items || []) {
      const n = normalize(it, type);
      if (n.date && !seen.has(n.id)) { seen.add(n.id); out.push(n); }
    }
  };

  if (st.active_actor) {
    try {
      collect(await runActor(st.active_actor, token, { usernames, username: usernames, ...cookieInputs }), "story");
    } catch (e) { console.warn("  ⚠ active stories:", e.message); }
  }
  if (st.highlights_actor) {
    try {
      collect(await runActor(st.highlights_actor, token, {
        usernames, username: usernames, resultsType: "stories", addParentData: false, ...cookieInputs,
      }), "highlight");
    } catch (e) { console.warn("  ⚠ highlights:", e.message); }
  }
  console.log(`  · Instagram stories/highlights → ${out.length}`);
  return out;
}
