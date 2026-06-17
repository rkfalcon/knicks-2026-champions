// Admin CRUD API (Supabase Auth protected).
//   GET  /api/admin/data            → all config entities (for the panel to load)
//   POST /api/admin/data {entity, op, row|id}
//        op: "upsert" (row) | "delete" (id)
// Auth: Authorization: Bearer <supabase access token>; user must be in `admins`.

import { requireAdmin } from "../../lib/admin-auth.mjs";

export const config = { maxDuration: 15 };

// entity → { table, pk, forceType? }. Players/Celebrities are views of accounts.
const ENTITY = {
  accounts:    { table: "accounts", pk: "id" },
  players:     { table: "accounts", pk: "id", forceType: "player" },
  celebrities: { table: "accounts", pk: "id", forceType: "celebrity" },
  keywords:    { table: "keywords", pk: "id" },
  series:      { table: "series", pk: "id" },
  games:       { table: "games", pk: "id" },
  settings:    { table: "settings", pk: "key" },
};

export default async function handler(req, res) {
  const { status, sb } = await requireAdmin(req);
  if (status !== 200) return res.status(status).json({ error: status === 401 ? "unauthorized" : "forbidden" });

  if (req.method === "GET") {
    const [accounts, keywords, series, games, settings] = await Promise.all([
      sb.from("accounts").select("*").order("account_type").order("name"),
      sb.from("keywords").select("*").order("term"),
      sb.from("series").select("*").order("sort"),
      sb.from("games").select("*").order("sort"),
      sb.from("settings").select("*"),
    ]);
    const acc = accounts.data || [];
    return res.status(200).json({
      accounts: acc,
      players: acc.filter((a) => a.account_type === "player"),
      celebrities: acc.filter((a) => a.account_type === "celebrity"),
      keywords: keywords.data || [],
      series: series.data || [], games: games.data || [],
      settings: Object.fromEntries((settings.data || []).map((r) => [r.key, r.value])),
    });
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { entity, op, row, id } = body;
    const def = ENTITY[entity];
    if (!def) return res.status(400).json({ error: "unknown entity" });

    try {
      if (op === "delete") {
        if (id == null) return res.status(400).json({ error: "id required" });
        const { error } = await sb.from(def.table).delete().eq(def.pk, id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }
      if (op === "upsert") {
        if (!row || typeof row !== "object") return res.status(400).json({ error: "row required" });
        if (def.forceType) row.account_type = def.forceType;
        const { data, error } = await sb.from(def.table).upsert(row, { onConflict: def.pk }).select();
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
