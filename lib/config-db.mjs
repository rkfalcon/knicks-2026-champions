// Assemble the pipeline config from the Supabase config tables, in the same
// shape config/sources.json used — so the scrapers and tagging are unchanged.

const DEFAULTS = {
  twitter: { queryType: "Top", maxPagesPerQuery: 5 },
  instagram: { resultsLimitPerSource: 50 },
};

export async function loadConfigFromDb(sb) {
  const [accounts, keywords, players, celebrities, series, games, settings] = await Promise.all([
    sb.from("accounts").select("*").eq("active", true),
    sb.from("keywords").select("*").eq("active", true),
    sb.from("players").select("*").eq("active", true).order("sort"),
    sb.from("celebrities").select("*").eq("active", true).order("sort"),
    sb.from("series").select("*").order("sort"),
    sb.from("games").select("*").order("sort"),
    sb.from("settings").select("*"),
  ]);

  const S = Object.fromEntries((settings.data || []).map((r) => [r.key, r.value]));
  const acc = accounts.data || [];
  const kws = keywords.data || [];

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
    globalKeywords: kws.map((k) => k.term),
    keywordTerms: kws.map((k) => k.term),
    twitter: {
      ...DEFAULTS.twitter,
      handles: acc.filter((a) => a.platform === "x").map((a) => a.handle),
      searchQueries: S.x_search_queries || [],
    },
    instagram: {
      ...DEFAULTS.instagram,
      profileHandles: acc.filter((a) => a.platform === "instagram").map((a) => a.handle),
      hashtags: kws.filter((k) => k.as_hashtag).map((k) => k.term.replace(/^#/, "")),
    },
    series: [...seriesById.values()],
    festivities: S.festivities || { keywords: [], events: [] },
    players: (players.data || []).map((p) => ({
      name: p.name, number: p.number,
      aliases: [...(p.aliases || []), p.x_handle, p.ig_handle].filter(Boolean),
    })),
    celebrities: (celebrities.data || []).map((c) => ({ name: c.name, aliases: c.aliases || [] })),
    stories: S.stories || { enabled: false, ig_session_cookie: "", active_actor: "", highlights_actor: "" },
    accounts: acc, // raw, for source-handle tagging
  };
}
