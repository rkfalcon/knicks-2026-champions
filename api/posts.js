// GET /api/posts — the picture-book payload. Posts + filter metadata are read
// live from Supabase (config tables are managed via /admin). Falls back to the
// bundled sample so the site is never empty.

import { getAdminClient, rowToPost } from "../lib/supabase.mjs";
import sample from "../data/posts.json" with { type: "json" };

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");

  const sb = getAdminClient();
  if (!sb) return res.status(200).json(sample);

  try {
    const [postsRes, series, games, players, celebs, accounts, keywords, settings] = await Promise.all([
      sb.from("posts").select("*").order("posted_at", { ascending: false }).limit(8000),
      sb.from("series").select("*").order("sort"),
      sb.from("games").select("*").order("sort"),
      sb.from("players").select("*").eq("active", true).order("sort"),
      sb.from("celebrities").select("*").eq("active", true).order("sort"),
      sb.from("accounts").select("*").eq("active", true),
      sb.from("keywords").select("*").eq("active", true),
      sb.from("settings").select("*"),
    ]);
    if (postsRes.error) throw postsRes.error;

    const posts = (postsRes.data || []).map(rowToPost);
    if (!posts.length) return res.status(200).json(sample);

    const S = Object.fromEntries((settings.data || []).map((r) => [r.key, r.value]));
    const gamesBySeries = {};
    for (const g of games.data || []) {
      (gamesBySeries[g.series_id] ||= []).push({ id: g.id, label: g.label, date: g.game_date, result: g.result });
    }
    const seriesOut = (series.data || []).map((s) => ({
      id: s.id, label: s.label, opponent: s.opponent, result: s.result, games: gamesBySeries[s.id] || [],
    }));

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      team: S.team || sample.team,
      series: seriesOut,
      festivities: S.festivities || sample.festivities,
      players: (players.data || []).map((p) => ({ name: p.name, number: p.number })),
      celebrities: (celebs.data || []).map((c) => ({ name: c.name })),
      accounts: (accounts.data || []).map((a) => ({ platform: a.platform, handle: a.handle, label: a.label })),
      keywords: (keywords.data || []).map((k) => ({ term: k.term.replace(/^#/, ""), label: k.label })),
      count: posts.length,
      posts,
    });
  } catch (err) {
    console.error("posts api error:", err.message);
    return res.status(200).json(sample);
  }
}
