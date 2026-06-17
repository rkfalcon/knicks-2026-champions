// GET /api/posts — returns the picture-book payload.
// Reads from Supabase when configured; falls back to bundled sample data so the
// site is never empty (e.g. before the first backfill).

import { getAdminClient, rowToPost } from "../lib/supabase.mjs";
import sample from "../data/posts.json" with { type: "json" };

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");

  const supabase = getAdminClient();
  if (!supabase) return res.status(200).json(sample);

  try {
    const [postsRes, metaRes] = await Promise.all([
      supabase.from("posts").select("*").order("posted_at", { ascending: false }).limit(5000),
      supabase.from("meta").select("*"),
    ]);
    if (postsRes.error) throw postsRes.error;

    const posts = (postsRes.data || []).map(rowToPost);
    if (!posts.length) return res.status(200).json(sample); // nothing ingested yet

    const m = Object.fromEntries((metaRes.data || []).map((r) => [r.key, r.value]));
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      team: m.team || sample.team,
      series: m.series || sample.series,
      festivities: m.festivities || sample.festivities,
      players: m.players || sample.players,
      celebrities: m.celebrities || sample.celebrities,
      count: posts.length,
      posts,
    });
  } catch (err) {
    console.error("posts api error:", err.message);
    return res.status(200).json(sample);
  }
}
