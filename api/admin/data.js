// Admin CRUD API (Supabase Auth protected).
//   GET  /api/admin/data            → all config entities (for the panel to load)
//   POST /api/admin/data {entity, op, row|id}
//        op: "upsert" (row) | "delete" (id)
// Auth: Authorization: Bearer <supabase access token>; user must be in `admins`.

import { requireAdmin } from "../../lib/admin-auth.mjs";

export const config = { maxDuration: 15 };

// entity → primary key column
const TABLES = {
  accounts: "id", keywords: "id", players: "id", celebrities: "id",
  series: "id", games: "id", settings: "key",
};

export default async function handler(req, res) {
  const { status, sb } = await requireAdmin(req);
  if (status !== 200) return res.status(status).json({ error: status === 401 ? "unauthorized" : "forbidden" });

  if (req.method === "GET") {
    const [accounts, keywords, players, celebrities, series, games, settings] = await Promise.all([
      sb.from("accounts").select("*").order("platform").order("handle"),
      sb.from("keywords").select("*").order("term"),
      sb.from("players").select("*").order("sort"),
      sb.from("celebrities").select("*").order("sort"),
      sb.from("series").select("*").order("sort"),
      sb.from("games").select("*").order("sort"),
      sb.from("settings").select("*"),
    ]);
    return res.status(200).json({
      accounts: accounts.data || [], keywords: keywords.data || [],
      players: players.data || [], celebrities: celebrities.data || [],
      series: series.data || [], games: games.data || [],
      settings: Object.fromEntries((settings.data || []).map((r) => [r.key, r.value])),
    });
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { entity, op, row, id } = body;
    const pk = TABLES[entity];
    if (!pk) return res.status(400).json({ error: "unknown entity" });

    try {
      if (op === "delete") {
        if (id == null) return res.status(400).json({ error: "id required" });
        const { error } = await sb.from(entity).delete().eq(pk, id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }
      if (op === "upsert") {
        if (!row || typeof row !== "object") return res.status(400).json({ error: "row required" });
        const { data, error } = await sb.from(entity).upsert(row, { onConflict: pk }).select();
        if (error) throw error;
        return res.status(200).json({ ok: true, row: data?.[0] || null });
      }
      return res.status(400).json({ error: "unknown op" });
    } catch (e) {
      return res.status(400).json({ error: String(e.message || e) });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
