#!/usr/bin/env node
// Surgical non-Knicks cleanup for noisy brand/lifestyle accounts.
//   1. Flag the given handles (default: NYON + Siegelman) posts-only.
//   2. Delete their stories/highlights (unfilterable non-Knicks noise).
//   3. Delete only their posts that match NO Knicks keyword once the over-broad
//      "New York" term is ignored *for these accounts* — so brand-slogan posts
//      go but "NYON x Knicks" posts stay. Leaves every other account untouched
//      (NBA/ESPN/SNY keep their "New York"/"MSG" Finals coverage).
//
//   node --env-file-if-exists=.env scripts/cleanup-nonknicks.mjs [extra_handle ...]

import { getAdminClient } from "../lib/supabase.mjs";
import { loadConfigFromDb } from "../lib/config-db.mjs";
import { isRelevant } from "../lib/tag.mjs";

const sb = getAdminClient(process.env);
if (!sb) { console.error("❌ Supabase admin client not configured"); process.exit(1); }

const BRAND = ["newyorkornowhere", "max_siegelman", ...process.argv.slice(2)];

const delBy = async (ids) => {
  for (let i = 0; i < ids.length; i += 500) {
    const { error } = await sb.from("posts").delete().in("id", ids.slice(i, i + 500));
    if (error) throw error;
  }
};

/* 1 — flag the brand accounts posts-only. */
const { data: flagged } = await sb.from("accounts")
  .update({ posts_only: true })
  .or(BRAND.map((h) => `ig_handle.ilike.${h},x_handle.ilike.${h}`).join(","))
  .select("name,ig_handle,x_handle");
console.log(`flagged posts_only: ${(flagged || []).map((a) => a.ig_handle || a.x_handle).join(", ") || "(none matched)"}`);

const config = await loadConfigFromDb(sb);
const poHandles = new Set([...config.postsOnly].map((h) => h.toLowerCase()));

/* 2 — delete stories/highlights from posts-only accounts. */
const { data: sh } = await sb.from("posts").select("id,author").in("post_type", ["story", "highlight"]);
const storyIds = (sh || []).filter((p) => poHandles.has((p.author || "").toLowerCase())).map((p) => p.id);
await delBy(storyIds);
console.log(`deleted stories/highlights from posts-only accounts: ${storyIds.length}`);

/* 3 — delete brand posts that match no Knicks keyword (ignoring "New York"). */
const strict = { ...config, showAll: new Set(),
  filterKeywords: (config.filterKeywords || []).filter((k) => k.toLowerCase() !== "new york") };
strict.globalKeywords = strict.filterKeywords;
const handlesArr = [...poHandles];
const { data: bp } = await sb.from("posts")
  .select("id,author,text,platform")
  .or("post_type.eq.post,post_type.is.null")
  .in("author", handlesArr);
const dropIds = [];
for (const r of bp || []) {
  const post = { text: r.text || "", author: r.author || "", platform: r.platform, postType: "post" };
  if (!isRelevant(post, strict)) dropIds.push(r.id);
}
await delBy(dropIds);
console.log(`deleted brand posts with no Knicks keyword: ${dropIds.length}`);

const { count } = await sb.from("posts").select("id", { count: "exact", head: true });
console.log(`\n✅ cleanup done — posts in DB now: ${count}`);
