/* Knicks 2026 picture book — vanilla JS, no build step. */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    book: $("#book"), empty: $("#empty"), count: $("#count"), reset: $("#reset"),
    q: $("#q"), suggest: $("#suggest"), series: $("#series"), game: $("#game"), player: $("#player"),
    celeb: $("#celeb"), account: $("#account"), keyword: $("#keyword"), ptype: $("#ptype"),
    category: $("#category"), sort: $("#sort"),
    platformChips: $("#platformChips"), activeChips: $("#activeChips"), generated: $("#generated"),
    filters: $("#filters"), filtersToggle: $("#filtersToggle"), filterSelects: $("#filterSelects"),
    lightbox: $("#lightbox"), lbStage: $("#lbStage"),
    lbClose: $("#lbClose"), lbPrev: $("#lbPrev"), lbNext: $("#lbNext"),
  };

  const state = {
    data: null,
    platform: "all",
    q: "", series: "all", game: "", player: "", celeb: "",
    account: "", keyword: "", ptype: "all",
    category: "all", sort: "desc",
    view: [],        // currently-rendered posts (for lightbox nav)
    lbIndex: -1,
  };

  const fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    // Format in UTC so date-only values (YYYY-MM-DD) don't shift a day backward.
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : `${n}`);
  const esc = (s) => (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- load ---------- */
  async function load() {
    // Prefer the live API (Supabase via Vercel); fall back to the bundled
    // sample JSON so static hosting / local dev still works.
    let payload = null;
    for (const src of ["/api/posts", "data/posts.json"]) {
      try {
        const res = await fetch(src, { cache: "no-store" });
        if (res.ok) { payload = await res.json(); break; }
      } catch { /* try next source */ }
    }
    if (!payload) {
      el.count.textContent = "Couldn't load posts";
      el.book.innerHTML = `<p style="font-family:VT323,monospace;font-size:1.2rem">
        ★ Data didn't load. Check /api/posts or data/posts.json. ★</p>`;
      return;
    }
    state.data = payload;
    buildFilters();
    bind();
    render();
    if (state.data.generatedAt) {
      el.generated.textContent =
        `Last updated ${new Date(state.data.generatedAt).toLocaleString("en-US")} · ${state.data.count} posts in the book`;
    }
  }

  /* ---------- build filter options from the payload ---------- */
  function buildFilters() {
    const d = state.data;
    el.series.innerHTML = `<option value="all">The whole run</option>` +
      (d.series || []).map((s) => `<option value="${s.id}">${esc(s.label)}${s.result ? " — " + esc(s.result) : ""}</option>`).join("") +
      `<option value="festivities">🎉 Festivities</option>`;

    const byName = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });

    el.player.innerHTML = `<option value="">Anyone</option>` +
      (d.players || []).slice().sort(byName).map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.number ? " #" + p.number : ""}</option>`).join("");

    el.celeb.innerHTML = `<option value="">Anyone</option>` +
      (d.celebrities || []).slice().sort(byName).map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");

    // Count posts per account, keyed by platform+author so an account whose X and
    // IG handles match (e.g. NBA) isn't double-counted. Mirrors the filter logic.
    const byPlatformAuthor = {};
    const playerCounts = {}, celebCounts = {};
    for (const p of d.posts || []) {
      const k = p.platform + ":" + (p.author || "").toLowerCase();
      byPlatformAuthor[k] = (byPlatformAuthor[k] || 0) + 1;
      (p.tags.players || []).forEach((x) => (playerCounts[x] = (playerCounts[x] || 0) + 1));
      (p.tags.celebrities || []).forEach((x) => (celebCounts[x] = (celebCounts[x] || 0) + 1));
    }
    state.playerCounts = playerCounts;
    state.celebCounts = celebCounts;
    const acctCount = (a) =>
      (a.x_handle ? byPlatformAuthor["x:" + a.x_handle.toLowerCase()] || 0 : 0) +
      (a.ig_handle ? byPlatformAuthor["instagram:" + a.ig_handle.toLowerCase()] || 0 : 0);
    // Annotate each account with its post count (shown in the label) and sort the
    // dropdown alphabetically by name. Replace state.data.accounts so the option
    // indices stay in sync with applyFilters' lookup.
    d.accounts = (d.accounts || [])
      .map((a) => ({ ...a, _count: acctCount(a) }))
      .sort((x, y) => (x.name || x.x_handle || x.ig_handle || "")
        .localeCompare(y.name || y.x_handle || y.ig_handle || "", undefined, { sensitivity: "base" }));
    el.account.innerHTML = `<option value="">All accounts</option>` +
      d.accounts.map((a, i) => {
        const icons = [a.x_handle ? "𝕏" : "", a.ig_handle ? "📸" : ""].filter(Boolean).join("");
        const label = a.name || a.x_handle || a.ig_handle || "";
        return `<option value="${i}">${esc(label)} ${icons} (${a._count})</option>`;
      }).join("");

    el.keyword.innerHTML = `<option value="">Any keyword</option>` +
      (d.keywords || []).map((k) => `<option value="${esc(k.term)}">${esc(k.label || k.term)}</option>`).join("");

    // Hide the type filter entirely if no stories/highlights exist yet.
    const hasStories = (d.posts || []).some((p) => p.postType && p.postType !== "post");
    if (el.ptype) el.ptype.closest("label").style.display = hasStories ? "" : "none";

    rebuildGames();
  }

  function rebuildGames() {
    const d = state.data;
    const s = (d.series || []).find((x) => x.id === state.series);
    if (!s) { el.game.innerHTML = `<option value="">All games</option>`; el.game.disabled = true; return; }
    el.game.disabled = false;
    el.game.innerHTML = `<option value="">All ${esc(s.label)} games</option>` +
      s.games.map((g) => `<option value="${g.id}">${esc(g.label)} (${fmtDate(g.date)})${g.result ? " " + g.result : ""}</option>`).join("");
  }

  /* ---------- filtering ---------- */
  function applyFilters() {
    const d = state.data;
    let posts = d.posts.slice();

    if (state.platform !== "all") posts = posts.filter((p) => p.platform === state.platform);
    if (state.series !== "all") posts = posts.filter((p) => p.tags.series === state.series);
    if (state.game) posts = posts.filter((p) => p.tags.game === state.game);
    if (state.player) posts = posts.filter((p) => (p.tags.players || []).includes(state.player));
    if (state.celeb) posts = posts.filter((p) => (p.tags.celebrities || []).includes(state.celeb));
    if (state.category !== "all") posts = posts.filter((p) => p.tags.category === state.category);
    if (state.ptype !== "all") posts = posts.filter((p) => (p.postType || "post") === state.ptype);

    if (state.account !== "") {
      const a = (d.accounts || [])[Number(state.account)];
      if (a) {
        const x = (a.x_handle || "").toLowerCase();
        const ig = (a.ig_handle || "").toLowerCase();
        posts = posts.filter((p) => {
          const au = (p.author || "").toLowerCase();
          return (p.platform === "x" && x && au === x) ||
                 (p.platform === "instagram" && ig && au === ig);
        });
      }
    }
    if (state.keyword) {
      const k = state.keyword.toLowerCase();
      posts = posts.filter((p) => (p.tags.keywords || []).some((x) => x.toLowerCase() === k));
    }

    if (state.q) {
      const q = state.q.toLowerCase();
      posts = posts.filter((p) =>
        (p.text || "").toLowerCase().includes(q) ||
        (p.author || "").toLowerCase().includes(q) ||
        (p.tags.players || []).some((x) => x.toLowerCase().includes(q)) ||
        (p.tags.keywords || []).some((x) => x.toLowerCase().includes(q)) ||
        (p.tags.celebrities || []).some((x) => x.toLowerCase().includes(q)));
    }

    if (state.sort === "likes") posts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else posts.sort((a, b) => {
      const c = Date.parse(a.date) - Date.parse(b.date);
      return state.sort === "asc" ? c : -c;
    });

    return posts;
  }

  /* ---------- render ---------- */
  function cardHTML(p, i) {
    const platformClass = p.platform === "x" ? "x" : "ig";
    const platformLabel = p.platform === "x" ? "𝕏" : "IG";
    const emoji = p.tags.category === "festivities" ? "🏆" : "🏀";
    const inner = p.image
      ? `<img loading="lazy" src="${esc(p.image)}" alt="" onerror="this.remove();this.parentNode.classList.add('no-img');this.parentNode.insertAdjacentHTML('afterbegin','<span class=&quot;emoji&quot;>${emoji}</span>')">`
      : `<span class="emoji">${emoji}</span>`;
    const fest = p.tags.category === "festivities"
      ? `<span class="fest-tag">🎉 ${esc(festLabel(p) || "PARTY")}</span>` : "";
    const story = p.postType === "story" ? `<span class="type-tag">⏱ STORY</span>`
      : p.postType === "highlight" ? `<span class="type-tag">★ HIGHLIGHT</span>` : "";

    const tags = []
      .concat((p.tags.players || []).map((x) => `<span class="tag player">🏀 ${esc(x)}</span>`))
      .concat((p.tags.celebrities || []).map((x) => `<span class="tag celeb">⭐ ${esc(x)}</span>`))
      .concat((p.tags.keywords || []).slice(0, 3).map((x) => `<span class="tag kw">#${esc(x)}</span>`))
      .concat(p.tags.gameLabel ? [`<span class="tag game">${esc(p.tags.gameLabel)}</span>`] : [])
      .join("");

    return `<article class="card" data-i="${i}">
      <div class="card-media${p.image ? "" : " no-img"}">
        ${inner}
        <span class="badge ${platformClass}">${platformLabel} @${esc(p.author)}</span>
        ${story}
        ${fest}
      </div>
      <div class="card-body">
        <div class="card-handle">${p.platform === "x" ? "𝕏" : "📸"} @${esc(p.author)}</div>
        ${p.text ? `<p class="card-text">${esc(p.text)}</p>` : ""}
        <div class="card-meta">
          <span>${fmtDate(p.date)}</span>
          <span>♥ ${fmtNum(p.likes || 0)}</span>
        </div>
        ${tags ? `<div class="taglist">${tags}</div>` : ""}
      </div>
    </article>`;
  }

  function festLabel(p) {
    const ev = (state.data.festivities && state.data.festivities.events || [])
      .find((e) => e.id === p.tags.festivityEvent);
    return ev ? ev.label : null;
  }

  // Columns matched to the CSS breakpoints — used to lay cards out in row order.
  function colCount() {
    const w = window.innerWidth;
    if (w >= 1180) return 4;
    if (w >= 900) return 3;
    if (w >= 560) return 2;
    return 1;
  }

  function render() {
    const posts = applyFilters();
    state.view = posts;

    // Distribute cards round-robin across columns so reading order is left-to-right,
    // top-to-bottom (newest first across the top row) instead of column-by-column.
    const n = colCount();
    const cols = Array.from({ length: n }, () => []);
    posts.forEach((p, i) => cols[i % n].push(cardHTML(p, i)));
    el.book.innerHTML = cols.map((c) => `<div class="book-col">${c.join("")}</div>`).join("");
    el.empty.hidden = posts.length > 0;
    el.book.hidden = posts.length === 0;

    const total = state.data.count || state.data.posts.length;
    el.count.textContent = posts.length === total
      ? `📖 ${total} moments`
      : `📖 ${posts.length} of ${total} moments`;

    const filtersActive = state.platform !== "all" || state.series !== "all" ||
      state.game || state.player || state.celeb || state.account || state.keyword ||
      state.ptype !== "all" || state.category !== "all" || state.q;
    el.reset.hidden = !filtersActive;
    renderActiveChips();

    el.book.querySelectorAll(".card").forEach((c) =>
      c.addEventListener("click", () => openLightbox(Number(c.dataset.i))));
  }

  /* ---------- active-filter chips (shown in the chips row) ---------- */
  function activeChipList() {
    const d = state.data;
    const chips = [];
    if (state.q) chips.push({ kind: "q", label: `🔎 “${state.q}”` });
    if (state.series !== "all") {
      const s = (d.series || []).find((x) => x.id === state.series);
      chips.push({ kind: "series", label: "Series: " + (s ? s.label : (state.series === "festivities" ? "Festivities 🎉" : state.series)) });
    }
    if (state.game) {
      const s = (d.series || []).find((x) => x.id === state.series);
      const g = s && s.games.find((x) => x.id === state.game);
      chips.push({ kind: "game", label: "Game: " + (g ? g.label : state.game) });
    }
    if (state.player) {
      const p = (d.players || []).find((x) => x.name === state.player);
      chips.push({ kind: "player", label: "Player: " + state.player + (p && p.number ? " #" + p.number : "") });
    }
    if (state.celeb) chips.push({ kind: "celeb", label: "Celeb: " + state.celeb });
    if (state.account !== "") {
      const a = (d.accounts || [])[Number(state.account)];
      chips.push({ kind: "account", label: "Account: " + (a ? (a.name || a.x_handle || a.ig_handle || "") : "") });
    }
    if (state.keyword) {
      const k = (d.keywords || []).find((x) => x.term === state.keyword);
      chips.push({ kind: "keyword", label: "Tag: " + (k ? (k.label || k.term) : state.keyword) });
    }
    if (state.ptype !== "all") {
      chips.push({ kind: "ptype", label: "Type: " + ({ post: "Posts", story: "Stories", highlight: "Highlights" }[state.ptype] || state.ptype) });
    }
    if (state.category !== "all") {
      chips.push({ kind: "category", label: "View: " + ({ game: "Game days", festivities: "Festivities 🎉" }[state.category] || state.category) });
    }
    return chips;
  }

  function clearOne(kind) {
    switch (kind) {
      case "q": state.q = ""; el.q.value = ""; break;
      case "series": state.series = "all"; el.series.value = "all"; state.game = ""; rebuildGames(); break;
      case "game": state.game = ""; el.game.value = ""; break;
      case "player": state.player = ""; el.player.value = ""; break;
      case "celeb": state.celeb = ""; el.celeb.value = ""; break;
      case "account": state.account = ""; el.account.value = ""; break;
      case "keyword": state.keyword = ""; el.keyword.value = ""; break;
      case "ptype": state.ptype = "all"; el.ptype.value = "all"; break;
      case "category": state.category = "all"; el.category.value = "all"; break;
    }
  }

  function renderActiveChips() {
    el.activeChips.innerHTML = activeChipList().map((c) =>
      `<button type="button" class="active-chip" data-kind="${c.kind}" title="${esc(c.label)} — tap to clear"><span class="lbl">${esc(c.label)}</span><span class="x" aria-hidden="true">✕</span></button>`).join("");
  }

  /* ---------- lightbox ---------- */
  function openLightbox(i) {
    state.lbIndex = i;
    const p = state.view[i];
    if (!p) return;
    const media = p.image
      ? `<img src="${esc(p.image)}" alt="" onerror="this.style.display='none'">` : "";
    const tags = []
      .concat((p.tags.players || []).map((x) => `<span class="tag player">🏀 ${esc(x)}</span>`))
      .concat((p.tags.celebrities || []).map((x) => `<span class="tag celeb">⭐ ${esc(x)}</span>`))
      .concat(p.tags.seriesLabel ? [`<span class="tag game">${esc(p.tags.seriesLabel)}</span>`] : [])
      .concat(p.tags.gameLabel ? [`<span class="tag game">${esc(p.tags.gameLabel)}</span>`] : [])
      .join("");
    el.lbStage.innerHTML = `${media}
      <div class="lb-body">
        <div class="card-handle">${p.platform === "x" ? "𝕏" : "📸"} @${esc(p.author)} · ${fmtDate(p.date)} · ♥ ${fmtNum(p.likes || 0)}</div>
        ${p.text ? `<p class="lb-text">${esc(p.text)}</p>` : ""}
        ${tags ? `<div class="taglist" style="margin-top:12px">${tags}</div>` : ""}
        ${p.url ? `<a class="lb-source" href="${esc(p.url)}" target="_blank" rel="noopener">↗ See it on ${p.platform === "x" ? "X" : "Instagram"}</a>` : ""}
      </div>`;
    el.lightbox.hidden = false;
    el.lbStage.scrollTop = 0;
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    el.lightbox.hidden = true;
    document.body.style.overflow = "";
  }
  function step(dir) {
    const n = state.view.length;
    if (!n) return;
    openLightbox((state.lbIndex + dir + n) % n);
  }

  /* ---------- search autocomplete ---------- */
  const KIND = { player: "PLAYER", account: "ACCT", celeb: "CELEB", keyword: "TAG" };

  function setFiltersOpen(open) {
    el.filterSelects.hidden = !open;
    el.filtersToggle.classList.toggle("is-open", open);
    el.filtersToggle.setAttribute("aria-expanded", String(open));
    el.filtersToggle.textContent = (open ? "▴" : "▾") + " Filters";
  }

  function buildSuggest(qRaw) {
    const q = qRaw.trim().toLowerCase();
    if (!q) return [];
    const d = state.data;
    const inc = (s) => (s || "").toLowerCase().includes(q);
    const rank = (s) => ((s || "").toLowerCase().startsWith(q) ? 0 : 1); // prefix matches first
    const items = [];
    (d.players || []).filter((p) => inc(p.name) && (state.playerCounts?.[p.name] || 0) > 0)
      .sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 6)
      .forEach((p) => items.push({ kind: "player", label: p.name + (p.number ? " #" + p.number : ""), value: p.name }));
    (d.accounts || []).map((a, i) => ({ a, i }))
      .filter(({ a }) => (a._count || 0) > 0 && (inc(a.name) || inc(a.x_handle) || inc(a.ig_handle)))
      .sort((x, y) => rank(x.a.name || x.a.x_handle) - rank(y.a.name || y.a.x_handle)).slice(0, 6)
      .forEach(({ a, i }) => items.push({ kind: "account", value: String(i),
        label: a.name || a.x_handle || a.ig_handle,
        icons: [a.x_handle ? "𝕏" : "", a.ig_handle ? "📸" : ""].filter(Boolean).join("") }));
    (d.celebrities || []).filter((c) => inc(c.name) && (state.celebCounts?.[c.name] || 0) > 0)
      .sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 6)
      .forEach((c) => items.push({ kind: "celeb", label: c.name, value: c.name }));
    (d.keywords || []).filter((k) => inc(k.term)).sort((a, b) => rank(a.term) - rank(b.term)).slice(0, 6)
      .forEach((k) => items.push({ kind: "keyword", label: "#" + k.term, value: k.term }));
    items.push({ kind: "text", label: `Search captions for “${qRaw.trim()}”`, value: qRaw.trim() });
    return items;
  }

  function showSuggest() {
    const items = buildSuggest(el.q.value);
    state.sugItems = items;
    state.sugIndex = -1;
    if (!items.length) return hideSuggest();
    el.suggest.innerHTML = items.map((it, i) =>
      `<div class="suggest-item" data-i="${i}" role="option">
        <span class="s-kind">${it.kind === "text" ? "🔎" : KIND[it.kind]}</span>
        <span class="s-label">${esc(it.label)}${it.icons ? " " + it.icons : ""}</span>
      </div>`).join("");
    el.suggest.hidden = false;
    el.q.setAttribute("aria-expanded", "true");
  }

  function hideSuggest() {
    el.suggest.hidden = true;
    el.q.setAttribute("aria-expanded", "false");
    state.sugIndex = -1;
  }

  function applySuggest(it) {
    if (!it) return;
    if (it.kind === "text") {
      state.q = it.value; el.q.value = it.value;
    } else {
      state.q = ""; el.q.value = "";
      if (it.kind === "player") { state.player = it.value; el.player.value = it.value; }
      else if (it.kind === "account") { state.account = it.value; el.account.value = it.value; }
      else if (it.kind === "celeb") { state.celeb = it.value; el.celeb.value = it.value; }
      else if (it.kind === "keyword") { state.keyword = it.value; el.keyword.value = it.value; }
    }
    hideSuggest();
    el.q.blur();            // dismiss the mobile keyboard
    setFiltersOpen(false);  // collapse the filters panel — land on the results
    render();
    scrollToResults();      // move past the header to the filter bar + first result
  }

  // Scroll so the (collapsed) filter bar sits at the top of the viewport and the
  // first results are visible — past the big hero header. Delayed so it runs
  // after the iOS keyboard finishes dismissing (which itself shifts the layout).
  function scrollToResults() {
    setTimeout(() => {
      if (el.filters) el.filters.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
  }

  function moveSuggest(dir) {
    const n = state.sugItems ? state.sugItems.length : 0;
    if (!n) return;
    state.sugIndex = (state.sugIndex + dir + n) % n;
    el.suggest.querySelectorAll(".suggest-item").forEach((node, i) =>
      node.classList.toggle("is-active", i === state.sugIndex));
  }

  /* ---------- bind ---------- */
  function bind() {
    // Re-lay the grid when the column count changes (responsive).
    let cols = colCount();
    let rt;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (colCount() !== cols) { cols = colCount(); render(); } }, 150);
    });

    el.platformChips.querySelectorAll(".chip[data-platform]").forEach((chip) =>
      chip.addEventListener("click", () => {
        el.platformChips.querySelectorAll(".chip[data-platform]").forEach((c) => c.classList.remove("is-on"));
        chip.classList.add("is-on");
        state.platform = chip.dataset.platform;
        render();
      }));

    // Collapsible filters panel (hidden by default).
    el.filtersToggle.addEventListener("click", () => setFiltersOpen(el.filterSelects.hidden));

    el.activeChips.addEventListener("click", (e) => {
      const btn = e.target.closest(".active-chip");
      if (!btn) return;
      clearOne(btn.dataset.kind);
      render();
    });

    let qt;
    el.q.addEventListener("input", () => {
      showSuggest();
      clearTimeout(qt);
      qt = setTimeout(() => { state.q = el.q.value.trim(); render(); }, 200);
    });
    el.q.addEventListener("focus", () => { if (el.q.value.trim()) showSuggest(); });
    el.q.addEventListener("blur", () => setTimeout(hideSuggest, 150));
    el.q.addEventListener("keydown", (e) => {
      if (el.suggest.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); moveSuggest(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggest(-1); }
      else if (e.key === "Enter" && state.sugIndex >= 0) { e.preventDefault(); applySuggest(state.sugItems[state.sugIndex]); }
      else if (e.key === "Escape") hideSuggest();
    });
    // mousedown (not click) so the selection registers before the input blurs.
    el.suggest.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".suggest-item");
      if (!item) return;
      e.preventDefault();
      applySuggest(state.sugItems[Number(item.dataset.i)]);
    });

    el.series.addEventListener("change", () => {
      state.series = el.series.value; state.game = ""; rebuildGames(); render();
    });
    el.game.addEventListener("change", () => { state.game = el.game.value; render(); });
    el.player.addEventListener("change", () => { state.player = el.player.value; render(); });
    el.celeb.addEventListener("change", () => { state.celeb = el.celeb.value; render(); });
    el.account.addEventListener("change", () => { state.account = el.account.value; render(); });
    el.keyword.addEventListener("change", () => { state.keyword = el.keyword.value; render(); });
    el.ptype.addEventListener("change", () => { state.ptype = el.ptype.value; render(); });
    el.category.addEventListener("change", () => { state.category = el.category.value; render(); });
    el.sort.addEventListener("change", () => { state.sort = el.sort.value; render(); });

    el.reset.addEventListener("click", () => {
      Object.assign(state, {
        platform: "all", q: "", series: "all", game: "", player: "", celeb: "",
        account: "", keyword: "", ptype: "all", category: "all",
      });
      el.q.value = ""; el.series.value = "all"; el.player.value = ""; el.celeb.value = "";
      el.account.value = ""; el.keyword.value = ""; el.ptype.value = "all"; el.category.value = "all";
      el.platformChips.querySelectorAll(".chip[data-platform]").forEach((c) => c.classList.toggle("is-on", c.dataset.platform === "all"));
      rebuildGames(); render();
    });

    el.lbClose.addEventListener("click", closeLightbox);
    el.lbPrev.addEventListener("click", () => step(-1));
    el.lbNext.addEventListener("click", () => step(1));
    el.lightbox.addEventListener("click", (e) => { if (e.target === el.lightbox) closeLightbox(); });
    document.addEventListener("keydown", (e) => {
      if (el.lightbox.hidden) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    });
  }

  load();
})();
