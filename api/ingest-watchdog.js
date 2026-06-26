// GET /api/ingest-watchdog — runs ~40 min after the main cron. If today's
// scheduled run failed, stalled (stuck "running"), captured nothing, or never
// ran, it re-runs the ingest once (self-heal). Otherwise it's a no-op.
// runIngest already auto-resolves stale "running" rows and guards concurrency,
// so this is safe to fire even if the main run is genuinely still going.
import { getAdminClient } from "../lib/supabase.mjs";
import { runIngest } from "../lib/pipeline.mjs";

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

  // Look at the most recent scheduled run in the last 6 hours.
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: runs } = await sb.from("runs").select("*")
    .in("trigger", ["cron", "watchdog"]).gte("started_at", since)
    .order("started_at", { ascending: false }).limit(1);
  const last = runs?.[0];
  const ageMin = last ? (Date.now() - Date.parse(last.started_at)) / 60000 : Infinity;

  const reason = !last ? "no scheduled run found"
    : (last.status === "running" && ageMin > 10) ? "previous run stuck"
    : last.status === "error" ? "previous run failed"
    : (last.status === "done" && (last.upserted ?? 0) === 0) ? "previous run captured nothing"
    : null;

  if (!reason) {
    return res.status(200).json({ ok: true, action: "none", lastStatus: last.status, upserted: last.upserted ?? 0 });
  }

  try {
    const result = await runIngest({
      uploadMedia: true, sinceDays: 5, maxImages: 400, record: true, trigger: "watchdog",
      incrementalOnly: true, deadlineMs: 250000, backfillNew: true, backfillLimit: 2,
      log: (m) => console.log(m),
    });
    return res.status(200).json({ ok: true, action: "retried", reason, ...result });
  } catch (err) {
    console.error("watchdog error:", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
