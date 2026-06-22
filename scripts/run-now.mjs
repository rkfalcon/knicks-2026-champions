// One-off manual ingest: incremental for existing accounts + full backfill for
// any never-backfilled (new) accounts. Records the run so it shows in /admin.
import { getAdminClient } from "../lib/supabase.mjs";
import { runIngest } from "../lib/pipeline.mjs";

const sb = getAdminClient(process.env);
const count = async () => (await sb.from("posts").select("id", { count: "exact", head: true })).count || 0;

const before = await count();
console.log(`before — total posts: ${before}`);

const res = await runIngest({
  incrementalOnly: true,   // existing accounts: rolling window (new posts)
  backfillNew: true,       // new accounts: full-window backfill
  backfillLimit: 9,        // cover all 9 accounts added today in this run
  sinceDays: 5,
  uploadMedia: true,
  maxImages: 600,
  record: true,
  trigger: "manual",
  log: console.log,
});

const after = await count();
console.log("\n════ MANUAL RUN COMPLETE ════");
console.log(`scraped/upserted this run: ${res.count} (incl. ${res.backfilled} from new-account backfill) | images mirrored: ${res.mirrored}`);
console.log(`total posts: ${before} -> ${after}  (+${after - before} net new)`);
