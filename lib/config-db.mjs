// Assemble the pipeline config from the Supabase config tables, in the same
// shape config/sources.json used — so the scrapers and tagging are unchanged.

const DEFAULTS = {
  twitter: { queryType: "Top", maxPagesPerQuery: 5 },
  instagram: { resultsLimitPerSource: 50 },
};

export async function loadConfigFromDb(sb) {
  const [accounts, keywords, series, games, settings] = await Promise.all([
    sb.from("accounts").select("*").eq("active", true),
    sb.from("keywords").select("*").eq("active", true),
    sb.from("series").select("*").order("sort"),
    sb.from("games").select("*").order("sort"),
    sb.from("settings").select("*"),
  ]);

  const S = Object.fromEntries((settings.data || []).map((r) => [r.key, r.value]));
  const acc = accounts.data || [];
  const kws = keywords.data || [];
  const players = { data: acc.filter((a) => a.account_type === "player") };
  const celebrities = { data: acc.filter((a) => a.account_type === "celebrity") };

  const seriesById = new Map();
  for (const s of series.data || []) {
    seriesById.set(s.id, {
      id: s.id, label: s.label, round: s.round, opponent: s.opponent, result: s.result,
      start: s.start_date, end: s.end_date, games: [],
    });
  }
  for (const g of games.data || []) {
    const s = seriesById.get(g.series_id);
    if (s) s.games.push({ id: g.id, label: g.label, date: g.game_date, home: g.home, result: g.result });
  }

  return {
    team: S.team || { name: "New York Knicks", championshipDate: "2026-06-13" },
    dateRange: S.date_range || { since: "2026-04-12", until: "2026-06-30" },
    // Filter keywords (Settings → Filter keywords): a post must contain one of
    // these to be ingested. Empty = pull everything from tracked accounts.
    // Falls back to the Keywords-tab terms if the setting was never configured.
    filterKeywords: Array.isArray(S.filter_keywords) ? S.filter_keywords : kws.map((k) => k.term),
    globalKeywords: Array.isArray(S.filter_keywords) ? S.filter_keywords : kws.map((k) => k.term),
    keywordTerms: kws.map((k) => k.term), // for tagging only
    // Handles of accounts that bypass the keyword filter (show all posts).
    showAll: new Set(acc.filter((a) => a.show_all).flatMap((a) =>
      [a.x_handle, a.ig_handle].filter(Boolean).map((h) => h.toLowerCase()))),
    twitter: {
      ...DEFAULTS.twitter,
      handles: acc.filter((a) => a.x_handle).map((a) => a.x_handle),
      // Account-only discovery: no broad keyword searches (they pulled in
      // non-tracked accounts). Only from:<handle> queries run.
      searchQueries: [],
    },
    instagram: {
      ...DEFAULTS.instagram,
      profileHandles: acc.filter((a) => a.ig_handle).map((a) => a.ig_handle),
      // Account-only: no hashtag discovery; only tracked profiles.
      hashtags: [],
    },
    series: [...seriesById.values()],
    festivities: S.festivities || { keywords: [], events: [] },
    players: players.data.map((p) => ({
      name: p.name, number: p.number,
      aliases: [...(p.aliases || []), p.x_handle, p.ig_handle].filter(Boolean),
    })),
    celebrities: celebrities.data.map((c) => ({
      name: c.name,
      aliases: [...(c.aliases || []), c.x_handle, c.ig_handle].filter(Boolean),
    })),
    stories: S.stories || { enabled: false, ig_session_cookie: "", active_actor: "", highlights_actor: "" },
    accounts: acc, // raw, for source-handle tagging (x_handle/ig_handle)
  };
}
