#!/usr/bin/env node
// Generates believable SAMPLE data so the site renders before any scraping.
// Real captions/handles are invented placeholders — clearly fan-style — and
// every post is run through the SAME tagPost() the live pipeline uses.
//   node scripts/sample.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tagPost } from "../lib/tag.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MEDIA = join(ROOT, "media");

const config = JSON.parse(await readFile(join(ROOT, "config", "sources.json"), "utf8"));

/* ---------- generate simple SVG "photos" so cards have imagery ---------- */
const SWATCHES = [
  ["#006bb6", "#f58426"], ["#f58426", "#006bb6"], ["#00477a", "#f58426"],
  ["#e06a0a", "#006bb6"], ["#0d1b2a", "#f58426"], ["#006bb6", "#fdf6ec"],
];
async function makeSVG(id, label, sub, idx) {
  const [bg, fg] = SWATCHES[idx % SWATCHES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="40" height="40" fill="${bg}"/><rect width="20" height="40" fill="${fg}" opacity="0.12"/></pattern></defs>
  <rect width="640" height="480" fill="url(#p)"/>
  <rect x="20" y="20" width="600" height="440" fill="none" stroke="${fg}" stroke-width="6"/>
  <text x="320" y="210" font-family="Arial Black, sans-serif" font-size="120" fill="${fg}" text-anchor="middle">🏀</text>
  <text x="320" y="320" font-family="Arial Black, sans-serif" font-weight="900" font-size="46" fill="${fg}" text-anchor="middle">${label}</text>
  <text x="320" y="370" font-family="Arial, sans-serif" font-size="26" fill="${fg}" opacity="0.85" text-anchor="middle">${sub}</text>
</svg>`;
  const file = `sample-${id}.svg`;
  await mkdir(MEDIA, { recursive: true });
  await writeFile(join(MEDIA, file), svg);
  return `media/${file}`;
}

/* ---------- caption templates ---------- */
const FANS = ["knickstape_", "garden_faithful", "bingbong_szn", "nyk_nation", "orange_n_blue", "msg_loud", "subwaykid"];
const pick = (arr, i) => arr[i % arr.length];

const posts = [];
let n = 0;

function add(p) { posts.push(p); }

// 2 posts per game (one media, one text) + a beat reporter tweet
for (const s of config.series) {
  for (const g of s.games) {
    const won = g.result === "W";
    const verb = won ? "TAKE GAME" : "drop a tough one";
    add({
      platform: "instagram", author: pick(FANS, n),
      text: `${won ? "🏀🔥" : "😤"} ${s.label} ${g.label} — Knicks ${won ? "WIN" : "fall"} vs ${s.opponent}. ${won ? "Brunson was UNREAL. Bing bong!! #NewYorkForever" : "We bounce back. #Knicks"} #knicks #knicksnation`,
      date: `${g.date}T23:14:00.000Z`, likes: 1800 + (n * 137) % 9000, media: true, _idx: n,
      _label: `${s.label.toUpperCase()}`, _sub: `${g.label} · ${g.result}`,
    });
    n++;
    add({
      platform: "x", author: pick(["WindhorstNBA", "ShamsCharania", "TheKnicksWall", "SNYtv"], n),
      text: `Knicks ${verb} ${g.label.replace("Game ", "")} of the ${s.label}. Jalen Brunson with another clutch fourth quarter. New York one step closer. #Knicks`,
      date: `${g.date}T23:48:00.000Z`, likes: 5200 + (n * 211) % 22000, media: false, _idx: n,
    });
    n++;
  }
}

// Star / celebrity flavor sprinkled across the run
const flavor = [
  { platform: "x", author: "espn", text: "Spike Lee courtside at MSG losing his mind as the Knicks pull away. The Garden is SHAKING. #Knicks", date: "2026-05-28T02:30:00.000Z", media: true, _label: "MSG", _sub: "Spike courtside" },
  { platform: "instagram", author: "nyknicks", text: "Karl-Anthony Towns double-double, OG Anunoby locking up the wing. This is Knicks basketball. 🧱 #NewYorkForever", date: "2026-05-22T01:10:00.000Z", media: true, _label: "KAT + OG", _sub: "ECF Game 2" },
  { platform: "x", author: "nyknicks", text: "Timothée Chalamet and Ben Stiller in the building for Finals Game 1. Everybody wants in. 🍿 #Knicks", date: "2026-06-04T22:00:00.000Z", media: false },
  { platform: "instagram", author: "kat", text: "One more. Locked in. 🙏 @nyknicks #NewYorkForever", date: "2026-06-10T18:00:00.000Z", media: true, _label: "LOCKED IN", _sub: "Towns" },
  { platform: "x", author: "jalenbrunson", text: "MSG, we hear you. Game 5. Let's bring it home. 🔵🟠", date: "2026-06-12T20:30:00.000Z", media: false },
];
for (const f of flavor) add({ ...f, likes: 12000 + (n * 333) % 40000, _idx: n++ });

// THE CLINCHER + festivities
const festive = [
  { platform: "x", author: "nyknicks", text: "CHAMPIONS. 🏆 NEW YORK KNICKS — 2026 NBA CHAMPIONS. The drought is OVER. #NewYorkForever", date: "2026-06-13T03:05:00.000Z", media: true, _label: "CHAMPIONS", _sub: "🏆 2026" },
  { platform: "instagram", author: "jalenbrunson", text: "FOR THE CITY. We did it New York. I love this team. I love this city. CHAMPIONS. 🏆🗽 #NewYorkForever", date: "2026-06-13T05:20:00.000Z", media: true, _label: "FOR THE CITY", _sub: "Brunson, champion" },
  { platform: "instagram", author: "garden_faithful", text: "Crying in the street outside MSG. 51 years. We are CHAMPIONS. I can't breathe. #Knicks #bingbong", date: "2026-06-13T04:00:00.000Z", media: false, likes: 88000 },
  { platform: "x", author: "espn", text: "The Larry O'Brien trophy is going to Manhattan. Knicks win their first title since 1973. Canyon of Heroes parade to follow. #NBAFinals", date: "2026-06-13T03:40:00.000Z", media: true, _label: "TROPHY", _sub: "Larry O'Brien" },
  { platform: "instagram", author: "nyknicks", text: "🎉 PARADE DAY. Canyon of Heroes. Ticker tape. Bring the whole city. See you on Broadway. #NewYorkForever", date: "2026-06-16T13:00:00.000Z", media: true, _label: "PARADE", _sub: "Canyon of Heroes" },
  { platform: "x", author: "garden_faithful", text: "Ticker tape raining down on Broadway. Brunson lifting the trophy on the float. Best day of my life. #Knicks #parade", date: "2026-06-16T15:30:00.000Z", media: true, _label: "TICKER TAPE", _sub: "Broadway" },
  { platform: "instagram", author: "bingbong_szn", text: "City Hall rally was INSANE. Thibs got the loudest ovation. CHAMPIONS forever. 🏆 #NewYorkForever", date: "2026-06-16T19:00:00.000Z", media: true, _label: "CITY HALL", _sub: "Rally" },
];
for (const f of festive) add({ likes: 30000, ...f, likes: f.likes ?? 30000 + (n * 777) % 120000, _idx: n++ });

/* ---------- finalize: generate media, tag, write ---------- */
const out = [];
let mediaIdx = 0;
for (const p of posts) {
  let image = null;
  if (p.media) {
    image = await makeSVG(`${mediaIdx}`, p._label || "KNICKS", p._sub || "2026", mediaIdx);
    mediaIdx++;
  }
  const base = {
    id: `${p.platform === "x" ? "x" : "ig"}-sample-${p._idx}`,
    platform: p.platform,
    author: p.author,
    authorName: p.author,
    text: p.text,
    image,
    video: false,
    url: p.platform === "x"
      ? `https://x.com/${p.author}`
      : `https://www.instagram.com/${p.author}/`,
    date: p.date,
    likes: p.likes,
    reposts: 0,
    views: 0,
  };
  out.push({ ...base, tags: tagPost(base, config) });
}

out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

const payload = {
  generatedAt: "2026-06-16T12:00:00.000Z",
  sample: true,
  team: config.team,
  series: config.series.map((s) => ({
    id: s.id, label: s.label, opponent: s.opponent, result: s.result,
    games: s.games.map((g) => ({ id: g.id, label: g.label, date: g.date, result: g.result })),
  })),
  festivities: config.festivities,
  players: config.players.map((p) => ({ name: p.name, number: p.number })),
  celebrities: config.celebrities.map((c) => ({ name: c.name })),
  count: out.length,
  posts: out,
};

await mkdir(join(ROOT, "data"), { recursive: true });
await writeFile(join(ROOT, "data", "posts.json"), JSON.stringify(payload, null, 2));
console.log(`✅ Sample data: ${out.length} posts + ${mediaIdx} placeholder images → data/posts.json`);
