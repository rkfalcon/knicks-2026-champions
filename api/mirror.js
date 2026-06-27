// GET /api/mirror — image mirror catch-up (runs after the scrape jobs).
//
// Why this exists: a full scrape can use the entire 300s budget, so the ingest's
// Phase-3 mirror step (and the watchdog's, when it re-scrapes) gets skipped. That
// leaves freshly-scraped posts pointing at raw Instagram/X CDN URLs, which expire
// and block hotlinking — so their images don't display on the site. This job does
// ONLY mirroring, looping until nothing is pending or the time budget runs out, so
// images reliably land in Storage regardless of how long the scrape took.
import { getAdminClient } from "../lib/supabase.mjs";
import { mirrorPending } from "../lib/mirror-pending.mjs";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers["authorization"];
    const isCron = req.headers["x-vercel-cron"] === "1";
    if (!isCron && auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const sb = getAdminClient();
  if (!sb) return res.status(500).json({ ok: false, error: "supabase not configured" });

  // Record a run row so the mirror count shows in the Runs tab alongside scrapes.
  let runId = null;
  try {
    const { data } = await sb.from("runs").insert({ scope: "mirror", trigger: "mirror", status: "running" }).select();
    runId = data?.[0]?.id || null;
  } catch { /* non-fatal */ }

  const start = Date.now();
  const timeLeft = () => 285000 - (Date.now() - start);
  let posts = 0, frames = 0, refetched = 0, rounds = 0, pending = 0;

  try {
    // mirrorPending caps at `limit` posts per call; loop until none pending, no
    // progress (some can't be mirrored even after a re-fetch), or out of time.
    while (timeLeft() > 20000) {
      const r = await mirrorPending(sb, process.env, {
        limit: 150, refetchLimit: 25, timeLeft, log: (m) => console.log(m),
      });
      rounds++; pending = r.pending;
      posts += r.posts; frames += r.frames; refetched += r.refetched;
      if (r.pending === 0 || r.posts === 0) break;
    }
    if (runId) await sb.from("runs").update({ status: "done", scraped: 0, upserted: 0, mirrored: frames, finished_at: new Date().toISOString() }).eq("id", runId);
    return res.status(200).json({ ok: true, posts, frames, refetched, rounds, lastPending: pending });
  } catch (err) {
    if (runId) await sb.from("runs").update({ status: "error", error: String(err.message || err), mirrored: frames, finished_at: new Date().toISOString() }).eq("id", runId);
    return res.status(500).json({ ok: false, error: String(err.message || err), frames });
  }
}
