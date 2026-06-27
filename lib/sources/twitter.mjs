// twitterapi.io adapter — advanced search with cursor pagination.
// Docs: https://docs.twitterapi.io  | GET /twitter/tweet/advanced_search
//   query: Twitter advanced-search syntax (from:, keywords, since_time:, until_time:)
//   queryType: "Latest" | "Top"
//   cursor: "" for first page; use response.next_cursor afterward
//   header: X-API-Key

import { fetchWithTimeout } from "../http.mjs";

const BASE = "https://api.twitterapi.io";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toEpoch = (isoDate) => Math.floor(Date.parse(isoDate) / 1000);

function buildQueries(config) {
  const { since, until } = config.dateRange;
  const window = `since_time:${toEpoch(since)} until_time:${toEpoch(until)}`;
  const filterKw = config.filterKeywords || config.globalKeywords || [];
  const showAll = config.showAll || new Set();
  // Only keep tweets that match a filter keyword (omit the clause when empty).
  const kwClause = filterKw.length ? `(${filterKw.map((k) => `"${k}"`).join(" OR ")}) ` : "";
  const queries = [];

  for (const handle of config.twitter.handles) {
    // show_all accounts: pull every tweet (no keyword clause).
    const clause = showAll.has(handle.toLowerCase()) ? "" : kwClause;
    queries.push(`from:${handle} ${clause}${window}`);
  }
  for (const q of config.twitter.searchQueries) {
    queries.push(`${q} ${window}`);
  }
  return queries;
}

function mediaFromEntities(ent) {
  const media = (ent && ent.media) || [];
  if (!media.length) return null;
  // All photo frames (a tweet can carry up to 4); video/gif posts fall back to
  // the media's preview image so the card still has a still.
  const urlOf = (m) => m.media_url_https || m.media_url || null;
  const photos = media.filter((m) => m.type === "photo").map(urlOf).filter(Boolean);
  const images = photos.length ? photos : [urlOf(media[0])].filter(Boolean);
  return {
    image: images[0] || null,
    images,
    video: media.some((m) => m.type === "video" || m.type === "animated_gif"),
  };
}

// Link-preview / summary cards: binding_values is an array of {key, value:{image_value:{url}}}.
function cardImage(card) {
  const bv = card && (card.binding_values || card.bindingValues);
  if (!Array.isArray(bv)) return null;
  const imgs = bv
    .map((b) => ({ key: b.key || "", url: b.value?.image_value?.url || b.value?.imageValue?.url }))
    .filter((x) => x.url);
  if (!imgs.length) return null;
  const score = (k) => (/large/i.test(k) ? 3 : /orig/i.test(k) ? 2 : /small|thumb/i.test(k) ? 0 : 1);
  imgs.sort((a, b) => score(b.key) - score(a.key));
  return imgs[0].url;
}

function extractMedia(tweet) {
  // Direct media, then a quote-tweet's media, then a retweet's, then a card preview.
  const entitySources = [
    tweet.extendedEntities || tweet.extended_entities || tweet.entities,
    (tweet.quoted_tweet || tweet.quotedTweet || {}).extendedEntities,
    (tweet.retweeted_tweet || tweet.retweetedTweet || {}).extendedEntities,
  ];
  for (const ent of entitySources) {
    const m = mediaFromEntities(ent);
    if (m && m.image) return m;
  }
  const ci = cardImage(tweet.card);
  if (ci) return { image: ci, images: [ci], video: false };
  return { image: null, images: [], video: false };
}

export function normalizeTweet(tweet) {
  const author = tweet.author || {};
  const { image, images, video } = extractMedia(tweet);
  return {
    id: `x-${tweet.id}`,
    platform: "x",
    author: author.userName || author.screen_name || "unknown",
    authorName: author.name || author.userName || "",
    authorAvatar: author.profilePicture || author.profile_image_url_https || null,
    text: tweet.text || "",
    image,
    images,
    video,
    url: tweet.url || (author.userName ? `https://x.com/${author.userName}/status/${tweet.id}` : null),
    date: tweet.createdAt || tweet.created_at || null,
    likes: tweet.likeCount ?? tweet.favorite_count ?? 0,
    reposts: tweet.retweetCount ?? tweet.retweet_count ?? 0,
    views: tweet.viewCount ?? 0,
  };
}

const CONCURRENCY = 6; // queries in flight at once (was fully sequential — the
                       // main cron time sink: 35 handles × pages, one at a time)

async function searchOnce(apiKey, query, queryType, cursor) {
  const url = new URL(`${BASE}/twitter/tweet/advanced_search`);
  url.searchParams.set("query", query);
  url.searchParams.set("queryType", queryType || "Top");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetchWithTimeout(url, { headers: { "X-API-Key": apiKey } }, 30000);
  if (!res.ok) {
    throw new Error(`twitterapi.io ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// One query, paginated to maxPages. Returns normalized tweets (caller dedupes).
async function runQuery(apiKey, query, queryType, maxPages) {
  const out = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page++) {
    let data;
    try {
      data = await searchOnce(apiKey, query, queryType, cursor);
    } catch (err) {
      console.warn(`  ⚠ X query failed (${query.slice(0, 40)}…): ${err.message}`);
      break;
    }
    const tweets = data.tweets || data.data || [];
    for (const t of tweets) out.push(normalizeTweet(t));
    if (!data.has_next_page || !data.next_cursor) break;
    cursor = data.next_cursor;
    await sleep(350); // be polite to the rate limiter
  }
  return out;
}

export async function fetchTwitter(config, apiKey, { timeLeft = () => Infinity } = {}) {
  if (!apiKey) {
    console.warn("  ⚠ TWITTERAPI_IO_KEY not set — skipping X/Twitter.");
    return [];
  }
  const out = [];
  const seen = new Set();
  const queries = buildQueries(config);
  const maxPages = config.twitter.maxPagesPerQuery ?? 3;
  const queryType = config.twitter.queryType;

  // Run queries in parallel waves; stop starting new waves when the run's time
  // budget is nearly spent so the cron always finishes (one query's worst case
  // is maxPages × 30s, so 40s of headroom is enough to let an in-flight wave end).
  let done = 0;
  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    if (timeLeft() < 40000) {
      console.warn(`  ⚠ X scrape stopping early at ${done}/${queries.length} queries (time budget)`);
      break;
    }
    const slice = queries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map((q) => runQuery(apiKey, q, queryType, maxPages)));
    for (const arr of results) for (const n of arr) {
      if (n.id && !seen.has(n.id)) { seen.add(n.id); out.push(n); }
    }
    done += slice.length;
  }
  console.log(`  · X → ${out.length} tweets from ${done}/${queries.length} queries`);
  return out;
}
