// Add a single X or Instagram post by URL (admin "paste a link" feature).
// Fetches that one post from the source API, auto-tags it, mirrors its images,
// and upserts it — no account or scraper run required.
import { getAdminClient, ensureBucket, uploadImage, upsertPosts } from "./supabase.mjs";
import { loadConfigFromDb } from "./config-db.mjs";
import { tagPost } from "./tag.mjs";
import { normalizeTweet } from "./sources/twitter.mjs";
import { normalizeItem } from "./sources/instagram.mjs";

const X_RE = /(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i;
const IG_RE = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i;

export function parsePostUrl(url) {
  const x = String(url || "").match(X_RE);
  if (x) return { platform: "x", id: x[1] };
  const ig = String(url || "").match(IG_RE);
  if (ig) return { platform: "instagram", shortcode: ig[1] };
  return null;
}

async function fetchTweet(id, env) {
  const key = env.TWITTERAPI_IO_KEY;
  if (!key) throw new Error("TWITTERAPI_IO_KEY not set");
  const res = await fetch(`https://api.twitterapi.io/twitter/tweets?tweet_ids=${id}`, {
    headers: { "X-API-Key": key },
  });
  if (!res.ok) throw new Error(`twitterapi.io ${res.status}`);
  const j = await res.json();
  const t = (j.tweets || j.data || [])[0];
  if (!t) throw new Error("Tweet not found — it may be deleted, private, or the link is wrong.");
  return normalizeTweet(t);
}

async function fetchIgPost(shortcode, env) {
  const token = env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN not set");
  const url = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const input = {
    directUrls: [`https://www.instagram.com/p/${shortcode}/`],
    resultsType: "posts",
    resultsLimit: 1,
    addParentData: false,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify ${res.status}`);
  const items = await res.json();
  const item = (items || []).find((i) => i && i.shortCode) || (items || [])[0];
  const n = item && normalizeItem(item);
  if (!n) throw new Error("Instagram post not found — it may be private or removed.");
  return n;
}

// Fetch + auto-tag a post (no save) — used for the admin preview.
export async function fetchPost(url, env = process.env) {
  const parsed = parsePostUrl(url);
  if (!parsed) throw new Error("Paste an X (x.com/.../status/…) or Instagram (instagram.com/p/…) post link.");
  const post = parsed.platform === "x"
    ? await fetchTweet(parsed.id, env)
    : await fetchIgPost(parsed.shortcode, env);
  const supabase = getAdminClient(env);
  const cfg = await loadConfigFromDb(supabase);
  post.tags = tagPost(post, cfg);
  return post;
}

const mergeList = (auto, manual) =>
  Array.from(new Set([...(auto || []), ...((manual || []).map((s) => String(s).trim()).filter(Boolean))]));

// Ensure a filterable account row exists for this post's author so users can
// filter by it. New ones are created cron_enabled=false (manual-only): visible
// in the site filters but skipped by the daily scrape until enabled. If the
// account is already tracked, it's left exactly as-is.
async function ensureAccount(supabase, post, overrides) {
  const handleCol = post.platform === "x" ? "x_handle" : "ig_handle";
  const handle = post.author;
  if (!handle) return null;
  const { data: existing } = await supabase.from("accounts").select("id").ilike(handleCol, handle).limit(1);
  if (existing && existing.length) return existing[0].id; // already tracked — don't touch it
  const { data } = await supabase.from("accounts").insert({
    name: overrides.accountName || post.authorName || handle,
    [handleCol]: handle,
    account_type: overrides.accountType || "none",
    active: true,
    cron_enabled: false, // manual-only: filterable but not scraped daily
    show_all: false,
  }).select("id");
  return data?.[0]?.id || null;
}

// Fetch + tag + apply admin overrides + mirror images + upsert.
export async function addPost(url, overrides = {}, env = process.env) {
  const post = await fetchPost(url, env);

  if (overrides.authorName) post.authorName = overrides.authorName;
  post.tags.players = mergeList(post.tags.players, overrides.players);
  post.tags.celebrities = mergeList(post.tags.celebrities, overrides.celebrities);
  post.tags.keywords = mergeList(post.tags.keywords, overrides.keywords);
  if (overrides.category) post.tags.category = overrides.category;
  post.sourceHandle = "manual"; // mark admin-added

  // Cover frame: the admin can pick which image of a multi-image post is the
  // default (images[0]). Move it to the front so the card + gallery lead with it.
  const ci = Number(overrides.coverIndex);
  if (Number.isInteger(ci) && ci > 0 && post.images && post.images[ci]) {
    const chosen = post.images[ci];
    post.images = [chosen, ...post.images.filter((_, j) => j !== ci)];
    post.image = chosen;
  }

  const supabase = getAdminClient(env);
  await ensureBucket(supabase);

  // Mirror every frame to storage (raw X/IG CDN URLs are hotlink-blocked).
  const src = (post.images && post.images.length) ? post.images : (post.image ? [post.image] : []);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const up = await uploadImage(supabase, post.id, src[i], src.length > 1 ? `-${i}` : "");
    out.push(up || src[i]);
  }
  if (out.length) { post.images = out; post.image = out[0]; post.remoteImage = src[0]; }

  await upsertPosts(supabase, [post]);

  // Optionally make the author a filterable (manual-only) account.
  if (overrides.createAccount) await ensureAccount(supabase, post, overrides);

  return post;
}
