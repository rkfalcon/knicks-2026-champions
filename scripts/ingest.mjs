#!/usr/bin/env node
// CLI backfill: scrape X + Instagram and write everything to Supabase
// (posts table + image Storage). Use this for the big historical backfill —
// no serverless time limit locally. The Vercel cron keeps it fresh after.
//
//   node --env-file-if-exists=.env scripts/ingest.mjs            # scrape + upload images
//   node --env-file-if-exists=.env scripts/ingest.mjs --no-media # skip image mirroring
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWITTERAPI_IO_KEY, APIFY_TOKEN

import { runIngest } from "../lib/pipeline.mjs";

const uploadMedia = !process.argv.includes("--no-media");

console.log("\n🏀 Backfilling Knicks 2026 posts into Supabase\n");
try {
  const { count } = await runIngest({ uploadMedia });
  console.log(`\n✅ Done — ${count} posts in Supabase.\n`);
} catch (err) {
  console.error("\n❌ Ingest failed:", err.message);
  console.error("   Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / scraper keys in .env\n");
  process.exit(1);
}
