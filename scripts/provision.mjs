#!/usr/bin/env node
// One-shot Supabase provisioning via the Management API.
// Reads secrets from env, creates a project, waits until healthy, pulls the
// API keys, applies supabase/schema.sql, and writes a complete .env.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... TWITTERAPI_IO_KEY=... APIFY_TOKEN=... \
//   CRON_SECRET=$(openssl rand -hex 24) node scripts/provision.mjs

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error("SUPABASE_ACCESS_TOKEN required"); process.exit(1); }

const API = "https://api.supabase.com/v1";
const H = { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (s) => (s ? s.slice(0, 6) + "…" + s.slice(-4) : "(none)");

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

const PROJECT_NAME = "knicks-2026-champions";
const REGION = process.env.SUPABASE_REGION || "us-east-1";

function randPass() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let p = "";
  for (let i = 0; i < 28; i++) p += cs[(Math.floor(Math.random() * cs.length))];
  return p + "_Aa9"; // guarantee complexity
}

(async () => {
  console.log("→ Looking up organization…");
  const orgs = await api("/organizations");
  if (!orgs.length) throw new Error("No organizations on this account.");
  const org = orgs[0];
  console.log(`  org: ${org.name} (${org.id})`);

  // Reuse an existing project with this name if present (idempotent re-runs).
  const projects = await api("/projects");
  let proj = projects.find((p) => p.name === PROJECT_NAME);

  const dbPass = randPass();
  if (!proj) {
    console.log(`→ Creating project "${PROJECT_NAME}" in ${REGION}…`);
    proj = await api("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: PROJECT_NAME,
        organization_id: org.id,
        region: REGION,
        db_pass: dbPass,
      }),
    });
  } else {
    console.log(`→ Reusing existing project "${PROJECT_NAME}" (${proj.id})`);
  }
  const ref = proj.id || proj.ref;

  console.log("→ Waiting for project to become healthy (can take ~2 min)…");
  let status = "";
  for (let i = 0; i < 60; i++) {
    const p = await api(`/projects/${ref}`);
    status = p.status;
    process.stdout.write(`  status: ${status}            \r`);
    if (status === "ACTIVE_HEALTHY") break;
    await sleep(5000);
  }
  console.log(`\n  status: ${status}`);

  console.log("→ Fetching API keys…");
  let keys = [];
  for (let i = 0; i < 12; i++) {
    try { keys = await api(`/projects/${ref}/api-keys`); if (keys.length) break; } catch {}
    await sleep(5000);
  }
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!service) throw new Error("Could not fetch service_role key yet — re-run in a minute.");
  const url = `https://${ref}.supabase.co`;
  console.log(`  url: ${url}`);
  console.log(`  service_role: ${mask(service)}`);

  console.log("→ Applying schema…");
  const schema = await readFile(join(ROOT, "supabase", "schema.sql"), "utf8");
  await api(`/projects/${ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query: schema }),
  });
  console.log("  schema applied ✓");

  const env = [
    `SUPABASE_URL=${url}`,
    `SUPABASE_SERVICE_ROLE_KEY=${service}`,
    `SUPABASE_ANON_KEY=${anon || ""}`,
    `TWITTERAPI_IO_KEY=${process.env.TWITTERAPI_IO_KEY || ""}`,
    `APIFY_TOKEN=${process.env.APIFY_TOKEN || ""}`,
    `CRON_SECRET=${process.env.CRON_SECRET || ""}`,
    "",
  ].join("\n");
  await writeFile(join(ROOT, ".env"), env);
  console.log("→ Wrote .env (git-ignored)");

  // Emit machine-readable line for the wrapper to capture if needed.
  console.log(`PROVISIONED ref=${ref} url=${url}`);
})().catch((e) => { console.error("\n❌", e.message); process.exit(1); });
