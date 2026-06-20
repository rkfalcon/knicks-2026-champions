// Supabase data + storage layer. Shared by the CLI ingest and the Vercel
// /api functions. Returns null when env isn't configured so callers can fall
// back to bundled sample data.

import { createClient } from "@supabase/supabase-js";

export const MEDIA_BUCKET = "knicks-media";

export function getAdminClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function ensureBucket(supabase) {
  const { data } = await supabase.storage.getBucket(MEDIA_BUCKET);
  if (!data) {
    await supabase.storage.createBucket(MEDIA_BUCKET, { public: true });
  }
}

/** Mirror a remote image into Storage; returns the public URL, or null on failure. */
export async function uploadImage(supabase, id, remoteUrl, suffix = "") {
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/jpeg";
    const ext = (ct.split("/")[1] || "jpg").split(";")[0].slice(0, 4);
    const path = `${id}${suffix}.${ext}`;
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, buf, { contentType: ct, upsert: true });
    if (error) throw error;
    return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

export function postToRow(p) {
  return {
    id: p.id,
    platform: p.platform,
    author: p.author,
    author_name: p.authorName || null,
    author_avatar: p.authorAvatar || null,
    text: p.text || null,
    image: p.image || null,
    images: (p.images && p.images.length ? p.images : (p.image ? [p.image] : [])),
    remote_image: p.remoteImage || null,
    video: !!p.video,
    url: p.url || null,
    posted_at: p.date,
    likes: p.likes || 0,
    reposts: p.reposts || 0,
    views: p.views || 0,
    series: p.tags.series,
    series_label: p.tags.seriesLabel,
    game: p.tags.game,
    game_label: p.tags.gameLabel,
    category: p.tags.category,
    festivity_event: p.tags.festivityEvent,
    players: p.tags.players || [],
    celebrities: p.tags.celebrities || [],
    keywords: p.tags.keywords || [],
    post_type: p.postType || "post",
    source_handle: p.sourceHandle || null,
    expires_at: p.expiresAt || null,
  };
}

export function rowToPost(r) {
  return {
    id: r.id,
    platform: r.platform,
    author: r.author,
    authorName: r.author_name,
    authorAvatar: r.author_avatar,
    text: r.text,
    image: r.image,
    images: (Array.isArray(r.images) && r.images.length ? r.images : (r.image ? [r.image] : [])),
    video: r.video,
    url: r.url,
    date: r.posted_at,
    likes: r.likes,
    reposts: r.reposts,
    views: r.views,
    postType: r.post_type || "post",
    sourceHandle: r.source_handle,
    tags: {
      series: r.series,
      seriesLabel: r.series_label,
      game: r.game,
      gameLabel: r.game_label,
      category: r.category,
      festivityEvent: r.festivity_event,
      players: r.players || [],
      celebrities: r.celebrities || [],
      keywords: r.keywords || [],
    },
  };
}

export async function upsertPosts(supabase, posts) {
  const rows = posts.map(postToRow);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("posts")
      .upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw error;
  }
  return rows.length;
}

/** Snapshot the bracket / roster / celeb config so the frontend can build filters. */
export async function writeMeta(supabase, config) {
  const entries = [
    { key: "team", value: config.team },
    {
      key: "series",
      value: config.series.map((s) => ({
        id: s.id, label: s.label, opponent: s.opponent, result: s.result,
        games: s.games.map((g) => ({ id: g.id, label: g.label, date: g.date, result: g.result })),
      })),
    },
    { key: "festivities", value: config.festivities },
    { key: "players", value: config.players.map((p) => ({ name: p.name, number: p.number })) },
    { key: "celebrities", value: config.celebrities.map((c) => ({ name: c.name })) },
  ];
  const { error } = await supabase.from("meta").upsert(entries, { onConflict: "key" });
  if (error) throw error;
}
