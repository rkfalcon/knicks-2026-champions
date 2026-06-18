#!/usr/bin/env node
// Mirror every post image that's still on a remote (expiring) URL into Supabase
// Storage. Run soon after an ingest, before Instagram CDN URLs expire.
//   node --env-file-if-exists=.env scripts/mirror.mjs

import { createClient } from "@supabase/supabase-js";
import { uploadImage } from "../lib/supabase.mjs";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const pending = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("posts").select("id,image")
    .like("image", "http%").not("image", "ilike", "%/storage/%").range(from, from + 999);
  if (error) throw error;
  if (!data.length) break;
  pending.push(...data);
  if (data.length < 1000) break;
}
console.log(`pending remote images: ${pending.length}`);

let ok = 0, fail = 0;
for (const p of pending) {
  const url = await uploadImage(sb, p.id, p.image);
  if (url) { await sb.from("posts").update({ remote_image: p.image, image: url }).eq("id", p.id); ok++; }
  else fail++;
  if ((ok + fail) % 50 === 0) process.stdout.write(`  ${ok} mirrored, ${fail} failed (expired)\r`);
}
console.log(`\n✅ mirrored ${ok}, failed ${fail} (already-expired URLs).`);
