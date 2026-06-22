// Edge middleware: give filtered share links a matching preview image.
//
// Link-preview crawlers (iMessage, X, Slack…) read the og:image/title from the
// server HTML without running JS. The site is a single static index.html with a
// fixed image, so when someone shares /?celeb=Ben+Stiller we rewrite those tags
// to point at /api/og?label=Celeb:%20Ben%20Stiller (a 1200×630 card with the
// filter baked in). Plain (no-filter) visits pass straight through to the static
// homepage, so the normal page is untouched and still CDN-cached.
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

export default async function middleware(req) {
  try {
    const url = new URL(req.url);
    const labels = filterLabels(url.searchParams);
    if (!labels.length) return next(); // no filter → normal static homepage

    const main = labels[0] + (labels.length > 1 ? `  (+${labels.length - 1} more)` : "");
    const img = `${url.origin}/api/og?label=${encodeURIComponent(main)}`;
    const title = `${labels[0]} — A Championship Picture Book`;

    // Fetch the raw static HTML; /index.html isn't matched by this middleware,
    // so there's no recursion.
    const html = await fetch(`${url.origin}/index.html`).then((r) => r.text());

    let out = html;
    const set = (re, value) => {
      out = out.replace(re, (_m, a, _old, c) => `${a}${value}${c}`);
    };
    set(/(<meta property="og:image" content=")([^"]*)(")/, esc(img));
    set(/(<meta name="twitter:image" content=")([^"]*)(")/, esc(img));
    set(/(<meta name="twitter:card" content=")([^"]*)(")/, "summary_large_image");
    set(/(<meta property="og:image:width" content=")([^"]*)(")/, "1200");
    set(/(<meta property="og:image:height" content=")([^"]*)(")/, "630");
    set(/(<meta property="og:title" content=")([^"]*)(")/, esc(title));
    set(/(<meta name="twitter:title" content=")([^"]*)(")/, esc(title));
    set(/(<meta property="og:image:alt" content=")([^"]*)(")/, esc(`Knicks 2026 picture book — ${main}`));
    set(/(<meta property="og:url" content=")([^"]*)(")/, esc(url.toString()));

    return new Response(out, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return next(); // on any error, serve the normal homepage (generic image)
  }
}
