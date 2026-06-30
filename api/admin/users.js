// Admin: list signed-up users (email, when they joined, sign-in method) plus a
// link to their public photo book if they've actually saved any images.
//   GET /api/admin/users → { ok, count, users: [{ email, created_at, provider, saved, book_url }] }
import { requireAdmin } from "../../lib/admin-auth.mjs";

export default async function handler(req, res) {
  const { status, sb } = await requireAdmin(req);
  if (status !== 200) return res.status(status).json({ ok: false, error: status === 401 ? "unauthorized" : "forbidden" });

  // All auth users (paginate, just in case the list grows).
  const users = [];
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return res.status(500).json({ ok: false, error: String(error.message || error) });
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }

  // Profiles give the public username (→ /?book= URL); saved_items tells us who
  // actually built a book.
  const { data: profiles } = await sb.from("profiles").select("user_id,username");
  const profByUser = new Map((profiles || []).map((p) => [p.user_id, p]));
  const { data: saved } = await sb.from("saved_items").select("user_id");
  const savedCount = {};
  for (const s of saved || []) savedCount[s.user_id] = (savedCount[s.user_id] || 0) + 1;

  const rows = users.map((u) => {
    const prof = profByUser.get(u.id);
    const count = savedCount[u.id] || 0;
    return {
      email: u.email || "(no email)",
      created_at: u.created_at,
      provider: (u.app_metadata && u.app_metadata.provider) || "email",
      saved: count,
      book_url: (count > 0 && prof?.username) ? `https://www.knicks.run/?book=${encodeURIComponent(prof.username)}` : null,
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return res.status(200).json({ ok: true, count: rows.length, users: rows });
}
