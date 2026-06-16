// twitterapi.io adapter — advanced search with cursor pagination.
// Docs: https://docs.twitterapi.io  | GET /twitter/tweet/advanced_search
//   query: Twitter advanced-search syntax (from:, keywords, since_time:, until_time:)
//   queryType: "Latest" | "Top"
//   cursor: "" for first page; use response.next_cursor afterward
//   header: X-API-Key

const BASE = "https://api.twitterapi.io";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toEpoch = (isoDate) => Math.floor(Date.parse(isoDate) / 1000);

function buildQueries(config) {
  const { since, until } = config.dateRange;
  const window = `since_time:${toEpoch(since)} until_time:${toEpoch(until)}`;
  const queries = [];

  for (const handle of config.twitter.handles) {
    queries.push(`from:${handle} (${config.globalKeywords.map((k) => `"${k}"`).join(" OR ")}) ${window}`);
  }
  for (const q of config.twitter.searchQueries) {
    queries.push(`${q} ${window}`);
  }
  return queries;
}

function extractMedia(tweet) {
  // twitterapi.io mirrors Twitter's payload; media can live in a few places.
  const ext = tweet.extendedEntities || tweet.extended_entities || tweet.entities || {};
  const media = ext.media || [];
  const photo = media.find((m) => m.type === "photo") || media[0];
  if (photo) {
    return {
      image: photo.media_url_https || photo.media_url || null,
      video: media.some((m) => m.type === "video" || m.type === "animated_gif"),
    };
  }
  return { image: null, video: false };
}

function normalizeTweet(tweet) {
  const author = tweet.author || {};
  const { image, video } = extractMedia(tweet);
  return {
    id: `x-${tweet.id}`,
    platform: "x",
    author: author.userName || author.screen_name || "unknown",
    authorName: author.name || author.userName || "",
    authorAvatar: author.profilePicture || author.profile_image_url_https || null,
    text: tweet.text || "",
    image,
    video,
    url: tweet.url || (author.userName ? `https://x.com/${author.userName}/status/${tweet.id}` : null),
    date: tweet.createdAt || tweet.created_at || null,
    likes: tweet.likeCount ?? tweet.favorite_count ?? 0,
    reposts: tweet.retweetCount ?? tweet.retweet_count ?? 0,
    views: tweet.viewCount ?? 0,
  };
}

async function searchOnce(apiKey, query, queryType, cursor) {
  const url = new URL(`${BASE}/twitter/tweet/advanced_search`);
  url.searchParams.set("query", query);
  url.searchParams.set("queryType", queryType || "Top");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!res.ok) {
    throw new Error(`twitterapi.io ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function fetchTwitter(config, apiKey) {
  if (!apiKey) {
    console.warn("  ⚠ TWITTERAPI_IO_KEY not set — skipping X/Twitter.");
    return [];
  }
  const out = [];
  const seen = new Set();
  const queries = buildQueries(config);
  const maxPages = config.twitter.maxPagesPerQuery ?? 3;

  for (const query of queries) {
    let cursor = "";
    for (let page = 0; page < maxPages; page++) {
      let data;
      try {
        data = await searchOnce(apiKey, query, config.twitter.queryType, cursor);
      } catch (err) {
        console.warn(`  ⚠ X query failed (${query.slice(0, 40)}…): ${err.message}`);
        break;
      }
      const tweets = data.tweets || data.data || [];
      for (const t of tweets) {
        const n = normalizeTweet(t);
        if (n.id && !seen.has(n.id)) {
          seen.add(n.id);
          out.push(n);
        }
      }
      if (!data.has_next_page || !data.next_cursor) break;
      cursor = data.next_cursor;
      await sleep(350); // be polite to the rate limiter
    }
    console.log(`  · X "${query.slice(0, 48)}…" → ${out.length} total`);
  }
  return out;
}
