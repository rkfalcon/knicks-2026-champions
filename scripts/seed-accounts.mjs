#!/usr/bin/env node
// (Re)build the unified accounts table from config/sources.json.
// Safe to run after migrate-accounts.mjs has recreated the table.
//   SUPABASE_ACCESS_TOKEN=sbp_... node --env-file-if-exists=.env scripts/seed-accounts.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(await readFile(join(__dirname, "..", "config", "sources.json"), "utf8"));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const ref = (process.env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyFor = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const entities = new Map();
const ensure = (name) => {
  const k = keyFor(name);
  if (!entities.has(k)) entities.set(k, { name, x_handle: null, ig_handle: null, account_type: "none", number: null, aliases: [], active: true });
  return entities.get(k);
};
const mergeAliases = (e, list) => { e.aliases = [...new Set([...(e.aliases || []), ...(list || [])])]; };

for (const p of cfg.players) {
  const e = ensure(p.name); e.account_type = "player";
  if (p.number != null) e.number = p.number; mergeAliases(e, p.aliases);
}
for (const c of cfg.celebrities) {
  const e = ensure(c.name); if (e.account_type === "none") e.account_type = "celebrity"; mergeAliases(e, c.aliases);
}
const TEAM = new Set(["nyknicks", "thegarden"]);
const assign = (handle, platform) => {
  let target = null;
  for (const e of entities.values()) {
    if ([keyFor(e.name), ...(e.aliases || []).map(keyFor)].includes(keyFor(handle))) { target = e; break; }
  }
  if (!target) { target = ensure(handle); if (target.account_type === "none" && TEAM.has(handle.toLowerCase())) target.account_type = "team"; }
  if (platform === "x" && !target.x_handle) target.x_handle = handle;
  if (platform === "instagram" && !target.ig_handle) target.ig_handle = handle;
};
for (const h of cfg.twitter.handles) assign(h, "x");
for (const h of cfg.instagram.profileHandles) assign(h, "instagram");

const rows = [...entities.values()];
console.log(`Built ${rows.length} entities.`);

// nudge PostgREST to reload its schema cache, then insert with retries
if (PAT && ref) {
  await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "notify pgrst, 'reload schema';" }),
  }).catch(() => {});
}
await sb.from("accounts").delete().neq("id", "00000000-0000-0000-0000-000000000000"); // clear any partial
for (let attempt = 1; attempt <= 6; attempt++) {
  const { error } = await sb.from("accounts").insert(rows);
  if (!error) { console.log(`\n✅ Inserted ${rows.length} accounts.`); process.exit(0); }
  if (/schema cache|PGRST204/.test(error.message)) { console.log(`  schema cache not ready, retrying (${attempt})…`); await sleep(4000); continue; }
  console.error("❌", error.message); process.exit(1);
}
console.error("❌ Gave up after retries."); process.exit(1);
