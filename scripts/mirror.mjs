#!/usr/bin/env node
// Mirror every still frame of every post (incl. carousel images) that's still on
// a remote (expiring) URL into Supabase Storage. Run after an ingest/backfill.
//   node --env-file-if-exists=.env scripts/mirror.mjs

import { createClient } from "@supabase/supabase-js";
import { uploadImage } from "../lib/supabase.mjs";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const srcImages = (p) => (Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []));
const isRemote = (u) => u && /^https?:/.test(u) && !u.includes("/storage/");

const pending = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("posts").select("id,image,images").range(from, from + 999);
  if (error) throw error;
  if (!data.length) break;
  for (const p of data) if (srcImages(p).some(isRemote)) pending.push(p);
  if (data.length < 1000) break;
}
console.log(`posts with un-mirrored frames: ${pending.length}`);

let ok = 0, fail = 0, frames = 0;
for (const p of pending) {
  const src = srcImages(p);
  const out = [];
  let uploaded = false, anyFail = false;
  for (let idx = 0; idx < src.length; idx++) {
    const u = src[idx];
    if (!isRemote(u)) { out.push(u); continue; }
    const up = await uploadImage(sb, p.id, u, src.length > 1 ? `-${idx}` : "");
    if (up) { out.push(up); uploaded = true; frames++; } else { out.push(u); anyFail = true; }
  }
  if (uploaded) {
    await sb.from("posts").update({ images: out, image: out[0], remote_image: src[0] }).eq("id", p.id);
    ok++;
  }
  if (anyFail) fail++;
  if ((ok + fail) % 50 === 0) process.stdout.write(`  ${ok} posts, ${frames} frames mirrored, ${fail} with expired frames\r`);
}
console.log(`\n✅ ${ok} posts updated, ${frames} frames mirrored, ${fail} posts had expired frames.`);
