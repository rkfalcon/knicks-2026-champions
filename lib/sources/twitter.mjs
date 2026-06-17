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
  const filterKw = config.filterKeywords || config.globalKeywords || [];
  // Only keep tweets that match a filter keyword (omit the clause when empty).
  const kwClause = filterKw.length ? `(${filterKw.map((k) => `"${k}"`).join(" OR ")}) ` : "";
  const queries = [];

  for (const handle of config.twitter.handles) {
    queries.push(`from:${handle} ${kwClause}${window}`);
  }
  for (const q of config.twitter.searchQueries) {
    queries.push(`${q} ${window}`);
  }
  return queries;
}

function mediaFromEntities(ent) {
  const media = (ent && ent.media) || [];
  if (!media.length) return null;
  const photo = media.find((m) => m.type === "photo") || media[0];
  return {
    image: photo.media_url_https || photo.media_url || null,
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
  if (ci) return { image: ci, video: false };
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
