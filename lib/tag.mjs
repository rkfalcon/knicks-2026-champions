// Auto-tagging: given a normalized post and the config, assign series / game /
// players / celebrities / category. Pure functions, no I/O — easy to unit test.

const DAY = 24 * 60 * 60 * 1000;

function lc(s) {
  return (s || "").toLowerCase();
}

function matchesAny(haystack, aliases) {
  const h = lc(haystack);
  return aliases.some((a) => h.includes(lc(a)));
}

/** Keep a post only if it contains a filter keyword. Empty list = keep all. */
export function isRelevant(post, config) {
  const kws = config.filterKeywords || config.globalKeywords || [];
  if (!kws.length) return true;
  const blob = `${post.text} ${post.author}`;
  return matchesAny(blob, kws);
}

/** Find the series whose [start, end] window contains the post date. */
function seriesForDate(dateMs, config) {
  for (const s of config.series) {
    const start = Date.parse(s.start);
    const end = Date.parse(s.end) + DAY; // inclusive of the end day
    if (dateMs >= start && dateMs <= end) return s;
  }
  return null;
}

/** Within a series, pick the game whose date is closest to the post date (same-day wins). */
function gameForDate(series, dateMs) {
  if (!series) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const g of series.games) {
    const delta = Math.abs(Date.parse(g.date) - dateMs);
    // a post counts toward a game if it's within ~1.5 days of tip-off
    if (delta < bestDelta && delta <= 1.5 * DAY) {
      best = g;
      bestDelta = delta;
    }
  }
  return best;
}

export function tagPost(post, config) {
  const blob = `${post.text} ${post.author}`;
  const dateMs = Date.parse(post.date);

  const players = config.players
    .filter((p) => matchesAny(blob, p.aliases.concat(p.name)))
    .map((p) => p.name);

  const celebrities = config.celebrities
    .filter((c) => matchesAny(blob, c.aliases.concat(c.name)))
    .map((c) => c.name);

  const clinchMs = Date.parse(config.team.championshipDate) + DAY;
  const isFestive =
    (Number.isFinite(dateMs) && dateMs >= clinchMs) ||
    matchesAny(blob, config.festivities.keywords);

  const series = seriesForDate(dateMs, config);
  const game = gameForDate(series, dateMs);

  // Tracked-keyword tags: which configured keywords appear in this post.
  const blobLc = lc(blob);
  const keywords = (config.keywordTerms || [])
    .map((term) => term.replace(/^#/, ""))
    .filter((term) => term && blobLc.includes(lc(term)));

  // Festivities event tagging (parade, rally, clinch night)
  let festivityEvent = null;
  if (isFestive) {
    let bestDelta = Infinity;
    for (const e of config.festivities.events) {
      const delta = Math.abs(Date.parse(e.date) - dateMs);
      if (delta < bestDelta && delta <= 2 * DAY) {
        festivityEvent = e.id;
        bestDelta = delta;
      }
    }
  }

  return {
    series: series ? series.id : isFestive ? "festivities" : "preseason",
    seriesLabel: series ? series.label : isFestive ? "Festivities" : "Other",
    game: game ? game.id : null,
    gameLabel: game ? game.label : null,
    players,
    celebrities,
    keywords,
    category: isFestive ? "festivities" : series ? "game" : "general",
    festivityEvent,
  };
}
