// POST /api/admin/add-post — add a single post by URL (Supabase Auth).
//   body: { op: "preview", url }            → fetch + auto-tag, no save (for preview)
//   body: { op: "add", url, authorName?, players?, celebrities?, keywords?, category? }
//                                            → fetch + tag + mirror + upsert
import { requireAdmin } from "../../lib/admin-auth.mjs";
import { fetchPost, addPost } from "../../lib/add-post.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const { status } = await requireAdmin(req);
  if (status !== 200) return res.status(status).json({ error: status === 401 ? "unauthorized" : "forbidden" });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "method not allowed" }); }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  try {
    if (body.op === "add") {
      const post = await addPost(body.url, body, process.env);
      return res.status(200).json({ ok: true, post });
    }
    const post = await fetchPost(body.url, process.env);
    return res.status(200).json({ ok: true, post });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message || e) });
  }
}
