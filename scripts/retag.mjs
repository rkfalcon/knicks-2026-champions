#!/usr/bin/env node
// Re-tag existing posts against the CURRENT config (no re-scraping). Useful after
// editing keywords / players / opponents / the bracket in the admin panel.
//   node --env-file-if-exists=.env scripts/retag.mjs

import { createClient } from "@supabase/supabase-js";
import { loadConfigFromDb } from "../lib/config-db.mjs";
import { tagPost } from "../lib/tag.mjs";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const config = await loadConfigFromDb(sb);
const tracked = { x: new Set(), instagram: new Set() };
for (const a of config.accounts || []) tracked[a.platform]?.add(a.handle.toLowerCase());

let from = 0;
const PAGE = 1000;
let total = 0;
for (;;) {
  const { data, error } = await sb
    .from("posts")
    .select("id,text,author,posted_at,platform,post_type")
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data.length) break;

  const updates = data.map((r) => {
    const t = tagPost({ text: r.text || "", author: r.author || "", date: r.posted_at }, config);
    const authorLc = (r.author || "").toLowerCase();
    return {
      id: r.id,
      players: t.players, celebrities: t.celebrities, keywords: t.keywords,
      series: t.series, series_label: t.seriesLabel, game: t.game, game_label: t.gameLabel,
      category: t.category, festivity_event: t.festivityEvent,
      source_handle: tracked[r.platform]?.has(authorLc) ? r.author : null,
    };
  });
  // upsert merges on PK (id); other columns (image, etc.) are untouched.
  for (let i = 0; i < updates.length; i += 500) {
    const { error: uErr } = await sb.from("posts").upsert(updates.slice(i, i + 500), { onConflict: "id" });
    if (uErr) throw uErr;
  }
  total += data.length;
  process.stdout.write(`  re-tagged ${total}\r`);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`\n✅ Re-tagged ${total} posts against current config.`);
