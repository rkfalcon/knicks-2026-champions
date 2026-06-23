// Image proxy for the admin Add-Post preview. Instagram's CDN blocks hotlinking
// (foreign-referer requests 403), so raw IG image URLs won't render in an <img>
// on our domain before they're mirrored. This streams the image server-side
// from a small allow-list of media CDNs so the preview can show it.
//
// Host-allow-listed to those CDNs + image content-types only, so it can't be
// used as an open proxy / SSRF to arbitrary hosts.
export const config = { maxDuration: 15 };

const ALLOW = [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i, /(^|\.)twimg\.com$/i];

export default async function handler(req, res) {
  const raw = req.query?.url || new URL(req.url, "http://x").searchParams.get("url");
  let u;
  try { u = new URL(raw); } catch { return res.status(400).send("bad url"); }
  if (u.protocol !== "https:" || !ALLOW.some((re) => re.test(u.hostname))) {
    return res.status(403).send("forbidden host");
  }
  try {
    const r = await fetch(u.toString(), { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return res.status(502).send(`upstream ${r.status}`);
    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return res.status(415).send("not an image");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(buf);
  } catch {
    return res.status(502).send("fetch failed");
  }
}
