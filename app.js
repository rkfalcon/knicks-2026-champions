/* Knicks 2026 picture book — vanilla JS, no build step. */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    book: $("#book"), empty: $("#empty"), count: $("#count"), reset: $("#reset"), share: $("#share"), scrollMore: $("#scrollMore"),
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

  // Brand icons (single source, identical sizing via .pi) used everywhere a
  // platform is shown — so X and Instagram always match.
  const X_ICON = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
  const IG_ICON = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`;
  const pIcon = (platform) => (platform === "x" ? X_ICON : IG_ICON);

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
    applyUrlParams(); // pre-populate filters from a shared deep link
    render();
    initAdmin();      // enable admin remove controls if signed in (no-op otherwise)
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
        const label = a.name || a.x_handle || a.ig_handle || "";
        return `<option value="${i}">${esc(label)} (${a._count})</option>`;
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

  /* ---------- shareable URL state ----------
     Filters are mirrored in the query string so the address bar is always a
     shareable deep link, and a link with ?account=jalenbrunson1 (etc.) opens
     pre-filtered. Accounts use their handle (stable) rather than the array
     index. */
  function setPlatformChips() {
    el.platformChips.querySelectorAll(".chip[data-platform]").forEach((c) =>
      c.classList.toggle("is-on", c.dataset.platform === state.platform));
  }

  function syncUrl() {
    const d = state.data;
    const p = new URLSearchParams();
    if (state.platform !== "all") p.set("platform", state.platform);
    if (state.q) p.set("q", state.q);
    if (state.series !== "all") p.set("series", state.series);
    if (state.game) p.set("game", state.game);
    if (state.player) p.set("player", state.player);
    if (state.celeb) p.set("celeb", state.celeb);
    if (state.account !== "") {
      const a = (d.accounts || [])[Number(state.account)];
      if (a) p.set("account", a.ig_handle || a.x_handle || a.name);
    }
    if (state.keyword) p.set("keyword", state.keyword);
    if (state.ptype !== "all") p.set("type", state.ptype);
    if (state.category !== "all") p.set("view", state.category);
    if (state.sort !== "desc") p.set("sort", state.sort);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
  }

  function applyUrlParams() {
    const p = new URLSearchParams(location.search);
    if (![...p].length) return;
    const d = state.data;
    const canon = (list, val) => {
      const v = (val || "").toLowerCase();
      const m = (list || []).find((x) => (x.name || "").toLowerCase() === v);
      return m ? m.name : null;
    };
    if (p.has("platform")) { state.platform = p.get("platform"); setPlatformChips(); }
    if (p.has("q")) { state.q = p.get("q"); el.q.value = state.q; }
    if (p.has("series")) { state.series = p.get("series"); el.series.value = state.series; rebuildGames(); }
    if (p.has("game")) { state.game = p.get("game"); el.game.value = state.game; }
    if (p.has("player")) { const m = canon(d.players, p.get("player")); if (m) { state.player = m; el.player.value = m; } }
    if (p.has("celeb")) { const m = canon(d.celebrities, p.get("celeb")); if (m) { state.celeb = m; el.celeb.value = m; } }
    if (p.has("account")) {
      const key = (p.get("account") || "").toLowerCase().replace(/^@/, "");
      const idx = (d.accounts || []).findIndex((a) =>
        [a.name, a.x_handle, a.ig_handle].some((v) => (v || "").toLowerCase() === key));
      if (idx >= 0) { state.account = String(idx); el.account.value = state.account; }
    }
    if (p.has("keyword") || p.has("tag")) { state.keyword = p.get("keyword") || p.get("tag"); el.keyword.value = state.keyword; }
    if (p.has("type")) { state.ptype = p.get("type"); el.ptype.value = state.ptype; }
    if (p.has("view")) { state.category = p.get("view"); el.category.value = state.category; }
    if (p.has("sort")) { state.sort = p.get("sort"); el.sort.value = state.sort; }
  }

  let shareTimer;
  function flashShare(msg) {
    el.share.textContent = msg;
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => { el.share.textContent = "Share"; }, 1900);
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
    const emoji = p.tags.category === "festivities" ? "🏆" : "🏀";
    const inner = p.image
      ? `<img loading="lazy" src="${esc(p.image)}" alt="" onerror="this.remove();this.parentNode.classList.add('no-img');this.parentNode.insertAdjacentHTML('afterbegin','<span class=&quot;emoji&quot;>${emoji}</span>')">`
      : `<span class="emoji">${emoji}</span>`;
    const fest = p.tags.category === "festivities"
      ? `<span class="fest-tag">🎉 ${esc(festLabel(p) || "PARTY")}</span>` : "";
    const story = p.postType === "story" ? `<span class="type-tag">⏱ STORY</span>`
      : p.postType === "highlight" ? `<span class="type-tag">★ HIGHLIGHT</span>` : "";
    const multi = (p.images && p.images.length > 1)
      ? `<span class="multi-tag" aria-label="${p.images.length} photos">▣ ${p.images.length}</span>` : "";

    const tags = []
      .concat((p.tags.players || []).map((x) => `<span class="tag player">🏀 ${esc(x)}</span>`))
      .concat((p.tags.celebrities || []).map((x) => `<span class="tag celeb">⭐ ${esc(x)}</span>`))
      .concat((p.tags.keywords || []).slice(0, 3).map((x) => `<span class="tag kw">#${esc(x)}</span>`))
      .concat(p.tags.gameLabel ? [`<span class="tag game">${esc(p.tags.gameLabel)}</span>`] : [])
      .join("");

    return `<article class="card" data-i="${i}" data-id="${esc(p.id)}">
      <div class="card-media${p.image ? "" : " no-img"}">
        ${inner}
        <span class="badge ${platformClass}">${pIcon(p.platform)} @${esc(p.author)}</span>
        ${story}
        ${fest}
        ${multi}
        <button class="card-remove" type="button" data-id="${esc(p.id)}" title="Remove — not Knicks (admin)" aria-label="Remove post">✕</button>
      </div>
      <div class="card-body">
        <div class="card-handle">${pIcon(p.platform)} @${esc(p.author)}</div>
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

  const PAGE_SIZE = 60; // cards rendered per batch (windowed — the rest append on scroll)

  function render() {
    state.view = applyFilters();
    state.rendered = 0;

    // Empty columns up front; cards stream in (round-robin) in batches so a big
    // result set never rebuilds thousands of DOM nodes at once — that synchronous
    // work was blocking typing in the search box on mobile.
    const n = colCount();
    el.book.innerHTML = Array.from({ length: n }, () => `<div class="book-col"></div>`).join("");
    state.cols = [...el.book.querySelectorAll(".book-col")];
    el.empty.hidden = state.view.length > 0;
    el.book.hidden = state.view.length === 0;

    const total = state.data.count || state.data.posts.length;
    el.count.textContent = state.view.length === total
      ? `📖 ${total} moments`
      : `📖 ${state.view.length} of ${total} moments`;

    const filtersActive = state.platform !== "all" || state.series !== "all" ||
      state.game || state.player || state.celeb || state.account || state.keyword ||
      state.ptype !== "all" || state.category !== "all" || state.q;
    el.reset.hidden = !filtersActive;
    renderActiveChips();
    syncUrl();

    appendMore(); // first page (also calls updateScrollMore)
  }

  // Append the next batch of cards into the existing columns, continuing the
  // round-robin index so reading order (left-to-right, top-to-bottom) holds.
  function appendMore() {
    const cols = state.cols || [];
    const n = cols.length;
    if (!n) return;
    const start = state.rendered || 0;
    const end = Math.min(start + PAGE_SIZE, state.view.length);
    if (end <= start) { updateScrollMore(); return; }
    const buckets = Array.from({ length: n }, () => []);
    for (let i = start; i < end; i++) buckets[i % n].push(cardHTML(state.view[i], i));
    for (let c = 0; c < n; c++) if (buckets[c].length) cols[c].insertAdjacentHTML("beforeend", buckets[c].join(""));
    state.rendered = end;
    updateScrollMore();
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

  // Floating "scroll for more" cue — visible only while there's a meaningful
  // amount of results still below the bottom of the viewport.
  function updateScrollMore() {
    if (!el.scrollMore) return;
    const hasResults = (state.view || []).length > 0;
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight > window.innerHeight + 240;
    if (!hasResults || !scrollable) { el.scrollMore.hidden = true; return; }
    const remaining = doc.scrollHeight - window.scrollY - window.innerHeight;
    const moreBelow = (state.rendered || 0) < state.view.length || remaining > 240;
    el.scrollMore.hidden = false;
    // At the bottom the cue flips to a "back to top" control.
    el.scrollMore.dataset.mode = moreBelow ? "down" : "top";
    el.scrollMore.textContent = moreBelow ? "↓ Scroll for more" : "↑ Back to top";
  }

  /* ---------- lightbox ---------- */
  function openLightbox(i) {
    state.lbIndex = i;
    const p = state.view[i];
    if (!p) return;
    const imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
    let media = "";
    if (imgs.length > 1) {
      media = `<div class="lb-media"><div class="lb-gallery" id="lbGallery">${imgs.map((u) =>
        `<div class="lb-slide"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>`).join("")}</div>
        <button class="lb-g-nav lb-g-prev" id="lbGPrev" type="button" aria-label="Previous image">‹</button>
        <button class="lb-g-nav lb-g-next" id="lbGNext" type="button" aria-label="Next image">›</button>
        <div class="lb-dots" id="lbDots">${imgs.map((_, k) => `<span class="lb-dot${k === 0 ? " is-on" : ""}"></span>`).join("")}</div></div>`;
    } else if (imgs.length === 1) {
      media = `<div class="lb-media"><img src="${esc(imgs[0])}" alt="" onerror="this.style.display='none'"></div>`;
    }
    const tags = []
      .concat((p.tags.players || []).map((x) => `<span class="tag player">🏀 ${esc(x)}</span>`))
      .concat((p.tags.celebrities || []).map((x) => `<span class="tag celeb">⭐ ${esc(x)}</span>`))
      .concat(p.tags.seriesLabel ? [`<span class="tag game">${esc(p.tags.seriesLabel)}</span>`] : [])
      .concat(p.tags.gameLabel ? [`<span class="tag game">${esc(p.tags.gameLabel)}</span>`] : [])
      .join("");
    el.lbStage.innerHTML = `${media}
      <div class="lb-body">
        <div class="card-handle">${pIcon(p.platform)} @${esc(p.author)} · ${fmtDate(p.date)} · ♥ ${fmtNum(p.likes || 0)}</div>
        ${p.text ? `<p class="lb-text">${esc(p.text)}</p>` : ""}
        ${tags ? `<div class="taglist" style="margin-top:12px">${tags}</div>` : ""}
        ${p.url ? `<a class="lb-source" href="${esc(p.url)}" target="_blank" rel="noopener">↗ See it on ${p.platform === "x" ? "X" : "Instagram"}</a>` : ""}
        <button class="lb-remove" type="button" data-id="${esc(p.id)}">🗑 Remove — not Knicks</button>
      </div>`;
    el.lightbox.hidden = false;
    el.lbStage.scrollTop = 0;
    lockScroll();
    wireGallery();
  }

  // Fully lock the page behind the lightbox (iOS-safe) so no grid content peeks
  // through and the background can't scroll under the modal.
  function lockScroll() {
    if (document.body.dataset.locked) return;
    state.scrollY = window.scrollY;
    document.body.dataset.locked = "1";
    document.body.style.position = "fixed";
    document.body.style.top = `-${state.scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (!document.body.dataset.locked) return;
    delete document.body.dataset.locked;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    window.scrollTo(0, state.scrollY || 0);
  }

  // Swipe/click through a multi-image post inside the lightbox.
  function wireGallery() {
    const gal = document.getElementById("lbGallery");
    if (!gal) return;
    const dots = [...document.querySelectorAll("#lbDots .lb-dot")];
    const w = () => gal.clientWidth || 1;
    const cur = () => Math.round(gal.scrollLeft / w());
    const go = (dir) => gal.scrollTo({ left: (cur() + dir) * w(), behavior: "smooth" });
    const prev = document.getElementById("lbGPrev");
    const next = document.getElementById("lbGNext");
    prev.addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
    next.addEventListener("click", (e) => { e.stopPropagation(); go(1); });
    gal.addEventListener("scroll", () => {
      const k = cur();
      dots.forEach((d, j) => d.classList.toggle("is-on", j === k));
      prev.style.visibility = k <= 0 ? "hidden" : "visible";
      next.style.visibility = k >= dots.length - 1 ? "hidden" : "visible";
    }, { passive: true });
    prev.style.visibility = "hidden"; // start on the first slide
  }
  function closeLightbox() {
    el.lightbox.hidden = true;
    unlockScroll();
  }

  /* ---------- admin: remove non-Knicks posts ---------- */
  // Cheap check first — only the admin's browser has a Supabase session, so
  // normal visitors never load the auth library.
  function maybeAdmin() {
    try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); }
    catch { return false; }
  }
  async function initAdmin() {
    if (!maybeAdmin()) return;
    try {
      const mod = await import("https://esm.sh/@supabase/supabase-js@2.45.0")
        .catch(() => import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"));
      const cfg = await fetch("/api/config").then((r) => r.json());
      if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) return;
      const sb = mod.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const ok = await fetch("/api/admin/hide", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok).catch(() => false);
      if (!ok) return; // logged in but not an admin
      state.adminToken = token;
      document.body.classList.add("is-admin");
      sb.auth.onAuthStateChange((_e, s) => { state.adminToken = s?.access_token || null; });
    } catch { /* not admin / offline — stay in normal mode */ }
  }
  async function hidePost(id) {
    if (!state.adminToken || !id) return;
    if (!confirm("Remove this post from the site? It will stay hidden across re-scrapes.")) return;
    try {
      const res = await fetch("/api/admin/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.adminToken}` },
        body: JSON.stringify({ id, hidden: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
      state.data.posts = state.data.posts.filter((p) => p.id !== id);
      if (typeof state.data.count === "number") state.data.count = Math.max(0, state.data.count - 1);
      if (!el.lightbox.hidden) closeLightbox();
      render();
    } catch {
      alert("Couldn't remove the post — try signing in again at /admin.");
    }
  }
  function step(dir) {
    // Inside a multi-image post, step through its frames first; only move to the
    // next/previous post once you're at the end (or start) of the carousel.
    const gal = document.getElementById("lbGallery");
    if (gal) {
      const w = gal.clientWidth || 1;
      const cur = Math.round(gal.scrollLeft / w);
      const last = gal.querySelectorAll(".lb-slide").length - 1;
      const target = cur + dir;
      if (target >= 0 && target <= last) { gal.scrollTo({ left: target * w, behavior: "smooth" }); return; }
    }
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
        icons: [a.x_handle ? X_ICON : "", a.ig_handle ? IG_ICON : ""].filter(Boolean).join("") }));
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
    // Land on the feed: header scrolled out, sticky filter bar pinned at top,
    // newest results right below. Computed directly because scrollIntoView()
    // no-ops once the sticky bar is already pinned.
    setTimeout(() => {
      if (!el.filters || !el.book) return;
      const filterH = el.filters.getBoundingClientRect().height;
      const bookTop = el.book.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, bookTop - filterH), behavior: "smooth" });
    }, 60);
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
      updateScrollMore();
    });

    // Open the lightbox from any card (event delegation — survives windowed
    // appends without re-binding per card).
    el.book.addEventListener("click", (e) => {
      const rm = e.target.closest(".card-remove");
      if (rm) { e.stopPropagation(); hidePost(rm.dataset.id); return; }
      const card = e.target.closest(".card");
      if (card) openLightbox(Number(card.dataset.i));
    });
    el.lbStage.addEventListener("click", (e) => {
      const rm = e.target.closest(".lb-remove");
      if (rm) { e.stopPropagation(); hidePost(rm.dataset.id); }
    });

    // As the user nears the bottom, stream in more cards; also update the cue.
    let smTick = false;
    window.addEventListener("scroll", () => {
      const doc = document.documentElement;
      if (doc.scrollHeight - window.scrollY - window.innerHeight < 1200) appendMore();
      if (smTick) return;
      smTick = true;
      requestAnimationFrame(() => { smTick = false; updateScrollMore(); });
    }, { passive: true });
    el.scrollMore.addEventListener("click", () => {
      if (el.scrollMore.dataset.mode === "top") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      // Snap to the top of the NEXT post (just below the sticky filter bar) so
      // you land on a fresh post, not a sliver of the previous one.
      const sticky = getComputedStyle(el.filters).position === "sticky"
        ? el.filters.getBoundingClientRect().height : 0;
      const contentTop = window.scrollY + sticky;
      let target = null;
      for (const c of el.book.querySelectorAll(".card")) {
        const docTop = window.scrollY + c.getBoundingClientRect().top;
        if (docTop > contentTop + 8) { target = c; break; }
      }
      if (target) {
        const y = window.scrollY + target.getBoundingClientRect().top - sticky - 2;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
        setTimeout(appendMore, 60); // keep the windowed grid ahead of the jump
      } else {
        window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: "smooth" });
      }
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

    let qt, qs;
    el.q.addEventListener("input", () => {
      // Defer both the suggestions and the grid filter off the keystroke so the
      // typed character paints immediately (no per-letter lag on mobile).
      clearTimeout(qs);
      qs = setTimeout(showSuggest, 50);
      clearTimeout(qt);
      qt = setTimeout(() => {
        const changed = state.q !== el.q.value.trim();
        state.q = el.q.value.trim();
        render();
        if (changed) scrollToResults(); // jump to the top of the (newest) results
      }, 200);
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

    // After picking any filter option, collapse the panel and drop the user onto
    // the results — same UX as choosing a search suggestion.
    const commitPick = () => { render(); setFiltersOpen(false); scrollToResults(); };
    el.series.addEventListener("change", () => {
      state.series = el.series.value; state.game = ""; rebuildGames(); commitPick();
    });
    el.game.addEventListener("change", () => { state.game = el.game.value; commitPick(); });
    el.player.addEventListener("change", () => { state.player = el.player.value; commitPick(); });
    el.celeb.addEventListener("change", () => { state.celeb = el.celeb.value; commitPick(); });
    el.account.addEventListener("change", () => { state.account = el.account.value; commitPick(); });
    el.keyword.addEventListener("change", () => { state.keyword = el.keyword.value; commitPick(); });
    el.ptype.addEventListener("change", () => { state.ptype = el.ptype.value; commitPick(); });
    el.category.addEventListener("change", () => { state.category = el.category.value; commitPick(); });
    el.sort.addEventListener("change", () => { state.sort = el.sort.value; commitPick(); });

    el.reset.addEventListener("click", () => {
      Object.assign(state, {
        platform: "all", q: "", series: "all", game: "", player: "", celeb: "",
        account: "", keyword: "", ptype: "all", category: "all",
      });
      el.q.value = ""; el.series.value = "all"; el.player.value = ""; el.celeb.value = "";
      el.account.value = ""; el.keyword.value = ""; el.ptype.value = "all"; el.category.value = "all";
      el.platformChips.querySelectorAll(".chip[data-platform]").forEach((c) => c.classList.toggle("is-on", c.dataset.platform === "all"));
      rebuildGames(); render(); scrollToResults(); // back to the top of the full feed
    });

    // Share the current (filtered) view — native share sheet on mobile, copy to
    // clipboard elsewhere. The URL already reflects the active filters.
    el.share.addEventListener("click", async () => {
      const url = location.href;
      if (navigator.share) {
        try { await navigator.share({ title: document.title, url }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      try { await navigator.clipboard.writeText(url); flashShare("✓ Link copied!"); }
      catch { flashShare("Copy from the address bar"); }
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
