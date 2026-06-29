// Edge middleware: give shared links a matching preview card.
//
// Link-preview crawlers (iMessage, X, Slack…) read og:image/title from the
// server HTML without running JS. The site is a single static index.html with a
// fixed image, so we rewrite those tags for two kinds of shares:
//   • a filtered view  (/?celeb=Ben+Stiller) → a card with the filter baked in
//   • a single post    (/?post=ig-…&frame=2) → a card with the post's own image
//     and the account that created it
// Plain (no-param) visits pass straight through to the static homepage.
import { next } from "@vercel/edge";

export const config = { matcher: "/" };

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Mirror app.js activeChipList(): turn the query string into human labels.
function filterLabels(p) {
  const g = (k) => (p.get(k) || "").trim();
  const out = [];
  if (g("q")) out.push(`Search: "${g("q")}"`);
  if (g("series") && g("series") !== "all") out.push(g("series") === "festivities" ? "Festivities" : "A playoff series");
  if (g("game")) out.push("A game day");
  if (g("player") === "__all__") out.push("All players");
  else if (g("player")) out.push(`Player: ${g("player")}`);
  if (g("celeb") === "__all__") out.push("All celebs");
  else if (g("celeb")) out.push(`Celeb: ${g("celeb")}`);
  if (g("account")) out.push(`Account: @${g("account").replace(/^@/, "")}`);
  if (g("keyword") || g("tag")) out.push(`Tag: #${(g("keyword") || g("tag")).replace(/^#/, "")}`);
  if (g("type")) out.push({ post: "Posts", story: "Stories", highlight: "Highlights" }[g("type")] || g("type"));
  if (g("view")) out.push({ game: "Game days", festivities: "Festivities" }[g("view")] || g("view"));
  if (g("platform") === "x") out.push("X / Twitter");
  else if (g("platform") === "instagram") out.push("Instagram");
  return out;
}

// Look up one post (cover image + author) straight from Supabase REST.
async function postMeta(id) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !id) return null;
  try {
    const res = await fetch(`${base}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=author,author_name,image,images,platform&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return (await res.json())[0] || null;
  } catch { return null; }
}

// Look up a public photo book by username (display name + a cover image).
async function bookMeta(username) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !username) return null;
  const h = { headers: { apikey: key, Authorization: `Bearer ${key}` } };
  try {
    const pr = await fetch(`${base}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=user_id,display_name,username&limit=1`, h);
    if (!pr.ok) return null;
    const prof = (await pr.json())[0];
    if (!prof) return null;
    let cover = "";
    const sr = await fetch(`${base}/rest/v1/saved_items?user_id=eq.${prof.user_id}&select=frame_idx,posts(image,images)&order=created_at.desc&limit=1`, h);
    if (sr.ok) {
      const row = (await sr.json())[0];
      if (row?.posts) { const imgs = Array.isArray(row.posts.images) ? row.posts.images : []; cover = imgs[row.frame_idx] || row.posts.image || imgs[0] || ""; }
    }
    return { name: prof.display_name || prof.username || username, cover };
  } catch { return null; }
}

// Fetch the static HTML and rewrite the OG/Twitter tags to the given card.
async function inject(origin, { img, title, shareUrl, alt }) {
  const html = await fetch(`${origin}/index.html`).then((r) => r.text());
  let out = html;
  const set = (re, value) => { out = out.replace(re, (_m, a, _old, c) => `${a}${value}${c}`); };
  set(/(<meta property="og:image" content=")([^"]*)(")/, esc(img));
  set(/(<meta name="twitter:image" content=")([^"]*)(")/, esc(img));
  set(/(<meta name="twitter:card" content=")([^"]*)(")/, "summary_large_image");
  set(/(<meta property="og:image:width" content=")([^"]*)(")/, "1200");
  set(/(<meta property="og:image:height" content=")([^"]*)(")/, "630");
  set(/(<meta property="og:title" content=")([^"]*)(")/, esc(title));
  set(/(<meta name="twitter:title" content=")([^"]*)(")/, esc(title));
  set(/(<meta property="og:image:alt" content=")([^"]*)(")/, esc(alt || title));
  set(/(<meta property="og:url" content=")([^"]*)(")/, esc(shareUrl));
  return new Response(out, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}

export default async function middleware(req) {
  try {
    const url = new URL(req.url);

    // --- shared photo book ---
    if (url.searchParams.has("book")) {
      const meta = await bookMeta(url.searchParams.get("book"));
      if (!meta) return next();
      const title = `${meta.name}'s photo book`;
      // Use the cover photo DIRECTLY (a real saved image) rather than the
      // on-demand @vercel/og card: the card takes ~1.5s / ~1MB to render, which
      // is too slow for the iOS share-sheet preview (it shows a blank icon).
      // The storage photo loads in ~0.2s, so the preview reliably shows an image.
      const ogImg = meta.cover || `${url.origin}/api/og?label=${encodeURIComponent(title)}`;
      return inject(url.origin, { img: ogImg, title: `${meta.name}'s Knicks photo book`, shareUrl: url.toString(), alt: title });
    }

    // --- single-post share ---
    if (url.searchParams.has("post")) {
      const meta = await postMeta(url.searchParams.get("post"));
      if (!meta) return next();
      const acct = meta.author || "";
      // Use the exact carousel frame that was shared, if any.
      const frame = Number(url.searchParams.get("frame")) || 0;
      const imgs = Array.isArray(meta.images) ? meta.images : [];
      const cover = imgs[frame] || meta.image || imgs[0] || "";
      const ogImg = cover
        ? `${url.origin}/api/og?img=${encodeURIComponent(cover)}&acct=${encodeURIComponent(acct)}&plat=${encodeURIComponent(meta.platform || "")}`
        : `${url.origin}/api/og?label=${encodeURIComponent("@" + acct)}`;
      const title = `@${acct} — A Championship Picture Book`;
      return inject(url.origin, { img: ogImg, title, shareUrl: url.toString(), alt: `Post by @${acct}` });
    }

    // --- filtered-view share ---
    const labels = filterLabels(url.searchParams);
    if (!labels.length) return next(); // no params → normal static homepage
    const main = labels[0] + (labels.length > 1 ? `  (+${labels.length - 1} more)` : "");
    return inject(url.origin, {
      img: `${url.origin}/api/og?label=${encodeURIComponent(main)}`,
      title: `${labels[0]} — A Championship Picture Book`,
      shareUrl: url.toString(),
      alt: `Knicks 2026 picture book — ${main}`,
    });
  } catch {
    return next(); // on any error, serve the normal homepage (generic image)
  }
}
