#!/usr/bin/env node
// Migrate to the unified accounts/people model.
// Old: accounts(platform, handle), players(...), celebrities(...) as separate tables.
// New: accounts(id, name, x_handle, ig_handle, account_type, number, aliases, active)
//      — one row per person/entity. Players/Celebrities become views (by type).
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node --env-file-if-exists=.env scripts/migrate-accounts.mjs

import { createClient } from "@supabase/supabase-js";

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error("SUPABASE_ACCESS_TOKEN required"); process.exit(1); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ref = (process.env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

async function ddl(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`DDL ${res.status}: ${await res.text()}`);
}

const keyFor = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// 1) read existing data (before we drop anything)
const [{ data: oldAccounts = [] }, { data: players = [] }, { data: celebs = [] }] = await Promise.all([
  sb.from("accounts").select("*"),
  sb.from("players").select("*"),
  sb.from("celebrities").select("*"),
]);

// 2) build merged entities
const entities = new Map(); // key -> entity
function ensure(name) {
  const k = keyFor(name);
  if (!entities.has(k)) {
    entities.set(k, { name, x_handle: null, ig_handle: null, account_type: "none", number: null, aliases: [], active: true });
  }
  return entities.get(k);
}
const mergeAliases = (e, list) => { e.aliases = [...new Set([...(e.aliases || []), ...(list || [])])]; };

for (const p of players) {
  const e = ensure(p.name);
  e.account_type = "player";
  if (p.number != null) e.number = p.number;
  if (p.x_handle) e.x_handle = p.x_handle;
  if (p.ig_handle) e.ig_handle = p.ig_handle;
  mergeAliases(e, p.aliases);
}
for (const c of celebs) {
  const e = ensure(c.name);
  if (e.account_type === "none") e.account_type = "celebrity";
  mergeAliases(e, c.aliases);
}

const TEAM = new Set(["nyknicks", "thegarden"]);
for (const a of oldAccounts) {
  const h = a.handle;
  let target = null;
  for (const e of entities.values()) {
    const keys = [keyFor(e.name), ...(e.aliases || []).map(keyFor)];
    if (keys.includes(keyFor(h))) { target = e; break; }
  }
  if (!target) {
    target = ensure(h);
    if (target.account_type === "none" && TEAM.has(h.toLowerCase())) target.account_type = "team";
  }
  if (a.platform === "x" && !target.x_handle) target.x_handle = h;
  if (a.platform === "instagram" && !target.ig_handle) target.ig_handle = h;
}

const rows = [...entities.values()];
console.log(`Merged into ${rows.length} entities:`);
for (const r of rows) console.log(`  ${r.account_type.padEnd(9)} ${r.name.padEnd(22)} x:${r.x_handle || "-"} ig:${r.ig_handle || "-"}`);

// 3) recreate accounts table, drop players/celebrities
await ddl(`
  drop table if exists public.accounts cascade;
  create table public.accounts (
    id         uuid primary key default gen_random_uuid(),
    name       text,
    x_handle   text,
    ig_handle  text,
    account_type text default 'none',
    number     integer,
    aliases    text[] default '{}',
    active     boolean default true,
    created_at timestamptz default now()
  );
  create index accounts_type_idx on public.accounts(account_type);
  alter table public.accounts enable row level security;
  drop policy if exists "public read accounts" on public.accounts;
  create policy "public read accounts" on public.accounts for select using (true);
  drop table if exists public.players cascade;
  drop table if exists public.celebrities cascade;
`);

// 4) insert merged entities
const { error } = await sb.from("accounts").insert(rows);
if (error) throw error;

console.log(`\n✅ Migrated → ${rows.length} accounts. players/celebrities tables dropped.`);
