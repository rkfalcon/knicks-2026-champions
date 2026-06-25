// Mirror-catch-up: find posts still on raw (un-mirrored) image URLs and copy them
// into Storage. If a frame's source URL has expired (fetch fails), re-fetch the
// post from its source for fresh URLs and mirror those. Bounded by a count limit,
// a time budget, and a re-fetch cap so it's safe to run inside the cron.
import { uploadImage } from "./supabase.mjs";
import { fetchPost } from "./add-post.mjs";

const framesOf = (p) => (Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []));
const isRemote = (u) => u && /^https?:/.test(u) && !u.includes("/storage/");

async function mirrorFrames(sb, id, frames) {
  const out = [];
  let uploaded = 0;
  for (let idx = 0; idx < frames.length; idx++) {
    const u = frames[idx];
    if (!isRemote(u)) { out.push(u); continue; }
    const up = await uploadImage(sb, id, u, frames.length > 1 ? `-${idx}` : "");
    if (up) { out.push(up); uploaded++; } else out.push(u);
  }
  return { out, uploaded };
}

async function mirrorOne(sb, env, post, allowRefetch) {
  let src = framesOf(post);
  let { out, uploaded } = await mirrorFrames(sb, post.id, src);
  let refetched = false;
  // Nothing copied + frames are remote → URLs likely expired; re-fetch fresh ones.
  if (uploaded === 0 && src.some(isRemote) && allowRefetch && post.url) {
    const fresh = await fetchPost(post.url, env).catch(() => null);
    const freshSrc = fresh ? framesOf(fresh) : [];
    if (freshSrc.length) { refetched = true; src = freshSrc; ({ out, uploaded } = await mirrorFrames(sb, post.id, freshSrc)); }
  }
  if (uploaded > 0) {
    await sb.from("posts").update({ images: out, image: out[0], remote_image: src[0] }).eq("id", post.id);
  }
  return { uploaded, refetched };
}

export async function mirrorPending(sb, env, { limit = 120, refetchLimit = 12, timeLeft = () => Infinity, log = () => {} } = {}) {
  // Efficient candidate query: posts whose cover image is still a raw http URL.
  const { data: pending } = await sb.from("posts")
    .select("id,image,images,url")
    .like("image", "http%")
    .not("image", "like", "%/storage/%")
    .limit(limit);
  if (!pending || !pending.length) { log("mirror catch-up: nothing to fix"); return { posts: 0, frames: 0, refetched: 0, pending: 0 }; }

  let posts = 0, frames = 0, refetched = 0;
  for (const p of pending) {
    if (timeLeft() < 15000) break; // leave headroom to finish the run
    const r = await mirrorOne(sb, env, p, refetched < refetchLimit);
    if (r.uploaded > 0) posts++;
    frames += r.uploaded;
    if (r.refetched) refetched++;
  }
  log(`mirror catch-up: fixed ${posts} posts (${frames} frames${refetched ? `, ${refetched} re-fetched` : ""}) of ${pending.length} pending`);
  return { posts, frames, refetched, pending: pending.length };
}
