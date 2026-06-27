import { runIngest } from "./lib/pipeline.mjs";
const t0 = Date.now();
const r = await runIngest({
  uploadMedia: true, sinceDays: 4, maxImages: 400, record: false, trigger: "manual-test",
  incrementalOnly: true, deadlineMs: 250000, backfillNew: true, backfillLimit: 2,
  log: (m) => console.log(`  [${((Date.now()-t0)/1000).toFixed(1)}s] ${m}`),
});
console.log(`\nTOTAL WALL TIME: ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log("RESULT:", JSON.stringify(r));
