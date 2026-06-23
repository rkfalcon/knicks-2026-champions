// POST /api/admin/run — trigger an ingest from the admin panel (Supabase Auth).
//   body: { accountId? }  → omit for "run all accounts"; include to run one account.
// Runs synchronously and records a row in `runs`. Account-only sourcing applies.

import { requireAdmin } from "../../lib/admin-auth.mjs";
import { runIngest } from "../../lib/pipeline.mjs";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const { status } = await requireAdmin(req);
  if (status !== 200) return res.status(status).json({ error: status === 401 ? "unauthorized" : "forbidden" });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "method not allowed" }); }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  try {
    const result = await runIngest({
      accountId: body.accountId || null,
      uploadMedia: true,
      maxImages: 250,
      // Deep per-profile fetch so a manual Run actually reaches a high-volume
      // account's full window (the default of 20 posts/profile only covers the
      // last few days for accounts that post often).
      resultsLimit: 200,
      record: true,
      trigger: "manual",
      log: (m) => console.log(m),
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error("admin run error:", e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
