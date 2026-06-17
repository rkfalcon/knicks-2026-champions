#!/usr/bin/env node
// Seed the config tables from config/sources.json and create the first admin user.
//   node --env-file-if-exists=.env scripts/seed.mjs [admin-email]
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const cfg = JSON.parse(await readFile(join(ROOT, "config", "sources.json"), "utf8"));

const up = async (table, rows, onConflict) => {
  if (!rows.length) return;
  const { error } = await sb.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  seeded ${rows.length} → ${table}`);
};

// accounts
const accounts = [
  ...cfg.twitter.handles.map((h) => ({ platform: "x", handle: h, active: true })),
  ...cfg.instagram.profileHandles.map((h) => ({ platform: "instagram", handle: h, active: true })),
];
await up("accounts", accounts, "platform,handle");

// keywords (global + IG hashtags)
const kw = new Map();
for (const k of cfg.globalKeywords) kw.set(k.toLowerCase(), { term: k, as_hashtag: false, active: true });
for (const h of cfg.instagram.hashtags) kw.set(h.toLowerCase(), { term: h, as_hashtag: true, active: true });
await up("keywords", [...kw.values()], "term");

// players
await up("players", cfg.players.map((p, i) => ({
  name: p.name, number: p.number, aliases: p.aliases || [], active: true, sort: i,
})));

// celebrities
await up("celebrities", cfg.celebrities.map((c, i) => ({
  name: c.name, aliases: c.aliases || [], active: true, sort: i,
})));

// series + games
await up("series", cfg.series.map((s, i) => ({
  id: s.id, label: s.label, round: s.round, opponent: s.opponent, result: s.result,
  start_date: s.start, end_date: s.end, sort: i,
})), "id");
const games = cfg.series.flatMap((s) => s.games.map((g, i) => ({
  id: g.id, series_id: s.id, label: g.label, game_date: g.date, home: g.home, result: g.result, sort: i,
})));
await up("games", games, "id");

// settings
await up("settings", [
  { key: "team", value: cfg.team },
  { key: "date_range", value: cfg.dateRange },
  { key: "festivities", value: cfg.festivities },
  { key: "x_search_queries", value: cfg.twitter.searchQueries || [] },
  { key: "stories", value: {
      enabled: false,
      ig_session_cookie: "",
      active_actor: "automation-lab/instagram-stories-scraper",
      highlights_actor: "muhammetakkurtt/instagram-scraper",
  } },
], "key");

// admin user
const email = process.argv[2] || "rkfalcon@gmail.com";
const password = Array.from({ length: 16 }, () =>
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#"[Math.floor(Math.random() * 57)]).join("");
let userId;
const { data: created, error: cErr } = await sb.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (cErr && !/already/i.test(cErr.message)) throw cErr;
if (created?.user) { userId = created.user.id; console.log(`\n  created admin user ${email}`); }
else {
  const { data: list } = await sb.auth.admin.listUsers();
  userId = list.users.find((u) => u.email === email)?.id;
  console.log(`\n  admin user ${email} already existed`);
}
await sb.from("admins").upsert({ user_id: userId, email }, { onConflict: "user_id" });

console.log("\n✅ Seed complete.");
if (created?.user) {
  console.log(`\n  ADMIN LOGIN  →  ${email}`);
  console.log(`  PASSWORD     →  ${password}`);
  console.log("  (change it after first login)\n");
} else {
  console.log("  (existing user kept — use your existing password, or reset via Supabase dashboard)\n");
}
