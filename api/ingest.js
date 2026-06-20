// GET/POST /api/ingest — scrape + tag + mirror images + upsert to Supabase.
// Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET:
// Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when that
// env var is set. Manual calls must send the same header.

import { runIngest } from "../lib/pipeline.mjs";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers["authorization"];
    const isCron = req.headers["x-vercel-cron"] === "1";
    if (!isCron && auth !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  try {
    // Incremental: only the last few days, and cap image mirroring per run so we
    // stay within the function budget. Posts persist first; un-mirrored images
    // self-heal on later runs. Full historical backfills use the CLI: `npm run ingest`.
    const days = Number(req.query?.days) || 4;
    const result = await runIngest({
      uploadMedia: true, sinceDays: days, maxImages: 120, record: true, trigger: "cron",
      incrementalOnly: true, // never a full all-accounts scrape — it can't fit 300s
      log: (m) => console.log(m),
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("ingest error:", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
