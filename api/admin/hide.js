// Admin: hide/unhide an individual post (e.g. a non-Knicks post that slipped in).
//   GET  /api/admin/hide            → { admin: true }  (UI gating: am I an admin?)
//   POST /api/admin/hide { id, hidden=true } → mark the post hidden (or unhide)
// Hidden posts are excluded from /api/posts and stay hidden across re-scrapes
// (postToRow never writes the `hidden` column, so upserts preserve it).

import { requireAdmin } from "../../lib/admin-auth.mjs";

export default async function handler(req, res) {
  const { status, sb } = await requireAdmin(req);
  if (status !== 200) return res.status(status).json({ ok: false, error: status === 401 ? "unauthorized" : "forbidden" });

  if (req.method === "GET") return res.status(200).json({ ok: true, admin: true });

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const id = body.id;
    const hidden = body.hidden !== false; // default true
    if (!id) return res.status(400).json({ ok: false, error: "id required" });
    const { error } = await sb.from("posts").update({ hidden }).eq("id", id);
    if (error) return res.status(400).json({ ok: false, error: String(error.message || error) });
    return res.status(200).json({ ok: true, id, hidden });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "method not allowed" });
}
