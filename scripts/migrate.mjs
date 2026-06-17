#!/usr/bin/env node
// Apply a SQL file to the Supabase project via the Management API.
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/migrate.mjs supabase/schema-admin.sql
// Project ref is derived from SUPABASE_URL in .env (loaded via --env-file-if-exists).

import { readFile } from "node:fs/promises";

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];
if (!PAT) { console.error("SUPABASE_ACCESS_TOKEN required"); process.exit(1); }
if (!file) { console.error("usage: migrate.mjs <file.sql>"); process.exit(1); }

const url = process.env.SUPABASE_URL || "";
const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) { console.error("Could not derive project ref from SUPABASE_URL"); process.exit(1); }

const query = await readFile(file, "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const body = await res.text();
if (!res.ok) { console.error(`❌ ${res.status}: ${body}`); process.exit(1); }
console.log(`✅ Applied ${file} to ${ref}`);
