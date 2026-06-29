/* Knicks 2026 picture book — vanilla JS, no build step. */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    book: $("#book"), empty: $("#empty"), count: $("#count"), reset: $("#reset"), share: $("#share"),
    scrollMore: $("#scrollMore"), homeBtn: $("#homeBtn"),
    q: $("#q"), suggest: $("#suggest"), series: $("#series"), atype: $("#atype"), player: $("#player"),
    celeb: $("#celeb"), account: $("#account"), keyword: $("#keyword"), ptype: $("#ptype"),
    category: $("#category"), sort: $("#sort"), media: $("#media"),
    platformChips: $("#platformChips"), activeChips: $("#activeChips"), generated: $("#generated"),
    filters: $("#filters"), filtersToggle: $("#filtersToggle"), filterSelects: $("#filterSelects"),
    lightbox: $("#lightbox"), lbStage: $("#lbStage"),
    lbClose: $("#lbClose"), lbPrev: $("#lbPrev"), lbNext: $("#lbNext"),
    acctArea: $("#acctArea"), bookBanner: $("#bookBanner"), authModal: $("#authModal"),
    saveToast: $("#saveToast"),
  };

  const state = {
    data: null,
    platform: "all",
    q: "", series: "all", atype: "all", player: "", celeb: "",
    account: "", keyword: "", ptype: "all",
    category: "all", sort: "desc",
    media: "media",  // default: only posts that carry a photo/video (hide text-only)
    view: [],        // currently-rendered posts (for lightbox nav)
    lbIndex: -1,
    // ---- personal photo book ----
    sb: null,          // supabase client (loaded on demand)
    user: null,        // logged-in user (or null)
    profile: null,     // their public profile { username, display_name }
    saved: new Set(),  // keys "<post_id>:<frame>" the user has saved
    bookMode: null,    // null | "mine" | { username, name } when viewing a book
    bookFrames: [],    // frame index per card when rendering a book view
  };

  const savedKey = (postId, frame) => `${postId}:${frame || 0}`;
  const isSaved = (postId, frame) => state.saved.has(savedKey(postId, frame));

  const fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    // Format in UTC so date-only values (YYYY-MM-DD) don't shift a day backward.
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : `${n}`);
  // Instagram lets accounts hide like counts; the scraper returns -1 for those.
  const likesHtml = (n) => (typeof n === "number" && n < 0 ? "" : `♥ ${fmtNum(n || 0)}`);
  const esc = (s) => (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Brand icons (single source, identical sizing via .pi) used everywhere a
  // platform is shown — so X and Instagram always match.
  const X_ICON = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
  const IG_ICON = `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`;
  const pIcon = (platform) => (platform === "x" ? X_ICON : IG_ICON);
  // A post "has media" if it carries a photo (single or carousel) or a video —
  // used by the MEDIA filter, which by default hides text-only posts.
  const hasMedia = (p) => !!(p.image || (p.images && p.images.length) || p.video);

  // Account-type filter: friendly labels + display order for the TYPE dropdown.
  const TYPE_LABELS = { player: "Players", team: "Team / Legends", celebrity: "Celebrities", photographer: "Photographers", fan: "Fans", none: "Other accounts" };
  const TYPE_ORDER = ["player", "team", "celebrity", "photographer", "fan", "none"];
  // The account_type of a post's author (via the account that owns its handle).
  const acctTypeOf = (p) => (state.acctType && state.acctType.get(p.platform + ":" + (p.author || "").toLowerCase())) || "none";

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
    initUser();       // load auth + this visitor's saved items (no-op if signed out)
    if (state.pendingPost) {   // a shared post link — open it on top of the feed
      const idx = state.view.findIndex((x) => x.id === state.pendingPost);
      if (idx >= 0) openLightbox(idx, state.pendingFrame || 0);
      state.pendingPost = null;
    }
    if (state.pendingBook) {   // a shared book link — show that book read-only
      openSharedBook(state.pendingBook);
      state.pendingBook = null;
    }
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

    el.player.innerHTML = `<option value="">Anyone</option><option value="__all__">All players</option>` +
      (d.players || []).slice().sort(byName).map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.number ? " #" + p.number : ""}</option>`).join("");

    el.celeb.innerHTML = `<option value="">Anyone</option><option value="__all__">All celebs</option>` +
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

    // Hide the format filter entirely if no stories/highlights exist yet.
    const hasStories = (d.posts || []).some((p) => p.postType && p.postType !== "post");
    if (el.ptype) el.ptype.closest("label").style.display = hasStories ? "" : "none";

    // Map each account handle → its account_type, and build the TYPE dropdown
    // from the types actually present.
    state.acctType = new Map();
    for (const a of d.accounts || []) {
      if (a.x_handle) state.acctType.set("x:" + a.x_handle.toLowerCase(), a.type || "none");
      if (a.ig_handle) state.acctType.set("instagram:" + a.ig_handle.toLowerCase(), a.type || "none");
    }
    const present = new Set((d.accounts || []).map((a) => a.type || "none"));
    el.atype.innerHTML = `<option value="all">All types</option>` +
      TYPE_ORDER.filter((t) => present.has(t)).map((t) => `<option value="${t}">${TYPE_LABELS[t] || t}</option>`).join("");
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
    if (state.atype !== "all") p.set("atype", state.atype);
    if (state.player) p.set("player", state.player);
    if (state.celeb) p.set("celeb", state.celeb);
    if (state.account !== "") {
      const a = (d.accounts || [])[Number(state.account)];
      if (a) p.set("account", a.ig_handle || a.x_handle || a.name);
    }
    if (state.keyword) p.set("keyword", state.keyword);
    if (state.ptype !== "all") p.set("type", state.ptype);
    if (state.category !== "all") p.set("view", state.category);
    if (state.media !== "media") p.set("media", state.media);
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
    if (p.has("series")) { state.series = p.get("series"); el.series.value = state.series; }
    if (p.has("atype")) { state.atype = p.get("atype"); el.atype.value = state.atype; }
    if (p.has("player")) { const v = p.get("player"); const m = v === "__all__" ? "__all__" : canon(d.players, v); if (m) { state.player = m; el.player.value = m; } }
    if (p.has("celeb")) { const v = p.get("celeb"); const m = v === "__all__" ? "__all__" : canon(d.celebrities, v); if (m) { state.celeb = m; el.celeb.value = m; } }
    if (p.has("account")) {
      const key = (p.get("account") || "").toLowerCase().replace(/^@/, "");
      const idx = (d.accounts || []).findIndex((a) =>
        [a.name, a.x_handle, a.ig_handle].some((v) => (v || "").toLowerCase() === key));
      if (idx >= 0) { state.account = String(idx); el.account.value = state.account; }
    }
    if (p.has("keyword") || p.has("tag")) { state.keyword = p.get("keyword") || p.get("tag"); el.keyword.value = state.keyword; }
    if (p.has("type")) { state.ptype = p.get("type"); el.ptype.value = state.ptype; }
    if (p.has("view")) { state.category = p.get("view"); el.category.value = state.category; }
    if (p.has("media")) { state.media = p.get("media"); el.media.value = state.media; }
    if (p.has("sort")) { state.sort = p.get("sort"); el.sort.value = state.sort; }
    // Per-post deep link: open this post (at this carousel frame) after render.
    if (p.has("post")) { state.pendingPost = p.get("post"); state.pendingFrame = Number(p.get("frame")) || 0; }
    // Shared photo book: /?book=<username>
    if (p.has("book")) state.pendingBook = p.get("book");
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

    if (state.media === "media") posts = posts.filter(hasMedia);
    if (state.platform !== "all") posts = posts.filter((p) => p.platform === state.platform);
    if (state.series !== "all") posts = posts.filter((p) => p.tags.series === state.series);
    if (state.atype !== "all") posts = posts.filter((p) => acctTypeOf(p) === state.atype);
    if (state.player === "__all__") posts = posts.filter((p) => (p.tags.players || []).length > 0);
    else if (state.player) posts = posts.filter((p) => (p.tags.players || []).includes(state.player));
    if (state.celeb === "__all__") posts = posts.filter((p) => (p.tags.celebrities || []).length > 0);
    else if (state.celeb) posts = posts.filter((p) => (p.tags.celebrities || []).includes(state.celeb));
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
          <span>${likesHtml(p.likes)}</span>
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
    // " moments" lives in a span so phones can drop it (keeps the status row to
    // one line even when "clear filters" appears). The numbers are safe to inject.
    const cnt = state.view.length === total ? `${total}` : `${state.view.length} of ${total}`;
    el.count.classList.remove("is-loading");
    el.count.innerHTML = `📖 ${cnt}<span class="cnt-suffix"> moments</span>`;

    const filtersActive = state.platform !== "all" || state.series !== "all" ||
      state.atype !== "all" || state.player || state.celeb || state.account || state.keyword ||
      state.ptype !== "all" || state.category !== "all" || state.media !== "media" || state.q;
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
    if (state.atype !== "all") chips.push({ kind: "atype", label: "Type: " + (TYPE_LABELS[state.atype] || state.atype) });
    if (state.player === "__all__") chips.push({ kind: "player", label: "Player: All players" });
    else if (state.player) {
      const p = (d.players || []).find((x) => x.name === state.player);
      chips.push({ kind: "player", label: "Player: " + state.player + (p && p.number ? " #" + p.number : "") });
    }
    if (state.celeb === "__all__") chips.push({ kind: "celeb", label: "Celeb: All celebs" });
    else if (state.celeb) chips.push({ kind: "celeb", label: "Celeb: " + state.celeb });
    if (state.account !== "") {
      const a = (d.accounts || [])[Number(state.account)];
      chips.push({ kind: "account", label: "Account: " + (a ? (a.name || a.x_handle || a.ig_handle || "") : "") });
    }
    if (state.keyword) {
      const k = (d.keywords || []).find((x) => x.term === state.keyword);
      chips.push({ kind: "keyword", label: "Tag: " + (k ? (k.label || k.term) : state.keyword) });
    }
    if (state.ptype !== "all") {
      chips.push({ kind: "ptype", label: "Format: " + ({ post: "Posts", story: "Stories", highlight: "Highlights" }[state.ptype] || state.ptype) });
    }
    if (state.category !== "all") {
      chips.push({ kind: "category", label: "View: " + ({ game: "Game days", festivities: "Festivities 🎉" }[state.category] || state.category) });
    }
    if (state.media !== "media") chips.push({ kind: "media", label: "Incl. text-only" });
    return chips;
  }

  function clearOne(kind) {
    switch (kind) {
      case "q": state.q = ""; el.q.value = ""; break;
      case "series": state.series = "all"; el.series.value = "all"; break;
      case "atype": state.atype = "all"; el.atype.value = "all"; break;
      case "player": state.player = ""; el.player.value = ""; break;
      case "celeb": state.celeb = ""; el.celeb.value = ""; break;
      case "account": state.account = ""; el.account.value = ""; break;
      case "keyword": state.keyword = ""; el.keyword.value = ""; break;
      case "ptype": state.ptype = "all"; el.ptype.value = "all"; break;
      case "category": state.category = "all"; el.category.value = "all"; break;
      case "media": state.media = "media"; el.media.value = "media"; break;
    }
  }

  function renderActiveChips() {
    el.activeChips.innerHTML = activeChipList().map((c) =>
      `<button type="button" class="active-chip" data-kind="${c.kind}" title="${esc(c.label)} — tap to clear"><span class="lbl">${esc(c.label)}</span><span class="x" aria-hidden="true">✕</span></button>`).join("");
  }

  // Floating "scroll for more" cue — visible only while there's a meaningful
  // amount of results still below the bottom of the viewport.
  function updateScrollMore() {
    // The Home button is available the moment you've scrolled down at all.
    if (el.homeBtn) el.homeBtn.hidden = window.scrollY < 300;
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
  function openLightbox(i, startFrame = 0) {
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
        <div class="lb-top">
          <div class="card-handle">${pIcon(p.platform)} @${esc(p.author)} · ${fmtDate(p.date)}${likesHtml(p.likes) ? " · " + likesHtml(p.likes) : ""}</div>
          <div class="lb-actions">
            <button class="lb-heart${isSaved(p.id, startFrame) ? " is-saved" : ""}" type="button" aria-pressed="${isSaved(p.id, startFrame)}" title="Save this image to your photo book">🧡</button>
            <button class="lb-share" type="button" title="Share this post"><span class="lb-share-icon">⤴</span><span class="lb-share-text"> Share</span></button>
          </div>
        </div>
        ${p.text ? `<p class="lb-text">${esc(p.text)}</p>` : ""}
        ${tags ? `<div class="taglist" style="margin-top:12px">${tags}</div>` : ""}
        ${p.url ? `<a class="lb-source" href="${esc(p.url)}" target="_blank" rel="noopener">↗ See it on ${p.platform === "x" ? "X" : "Instagram"}</a>` : ""}
        <button class="lb-remove" type="button" data-id="${esc(p.id)}">🗑 Remove — not Knicks</button>
      </div>`;
    el.lightbox.hidden = false;
    el.lbStage.scrollTop = 0;
    lockScroll();
    wireGallery();
    // Open on a specific carousel frame (from a shared deep link).
    if (startFrame > 0) {
      const gal = document.getElementById("lbGallery");
      if (gal) requestAnimationFrame(() => { gal.scrollLeft = startFrame * (gal.clientWidth || 1); });
    }
  }

  // Share THIS post — a clean deep link that reopens it (at the current carousel
  // frame) on the recipient's visit. Native share sheet on mobile, copy elsewhere.
  async function sharePost() {
    const p = state.view[state.lbIndex];
    if (!p) return;
    const gal = document.getElementById("lbGallery");
    const frame = gal ? Math.round(gal.scrollLeft / (gal.clientWidth || 1)) : 0;
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set("post", p.id);
    if (frame > 0) u.searchParams.set("frame", String(frame));
    const url = u.toString();
    if (navigator.share) {
      try { await navigator.share({ title: document.title, url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    const btn = el.lbStage.querySelector(".lb-share");
    const txt = btn ? (btn.querySelector(".lb-share-text") || btn) : null;
    try {
      await navigator.clipboard.writeText(url);
      if (txt) { txt.textContent = " ✓ Copied!"; setTimeout(() => { txt.textContent = " Share"; }, 1800); }
    } catch { if (txt) txt.textContent = " address bar ↑"; }
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
      refreshHeart(); // the heart tracks the frame now in view
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
      const sb = await getSupabase();
      if (!sb) return;
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

  /* ---------- personal photo book: auth + save ---------- */
  async function getSupabase() {
    if (state.sb) return state.sb;
    try {
      const mod = await import("https://esm.sh/@supabase/supabase-js@2.45.0")
        .catch(() => import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"));
      const cfg = await fetch("/api/config").then((r) => r.json());
      if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) return null;
      state.sb = mod.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      return state.sb;
    } catch { return null; }
  }

  async function initUser() {
    const sb = await getSupabase();
    if (!sb) { renderAcct(); return; }
    const { data } = await sb.auth.getSession();
    await onSession(data.session);
    sb.auth.onAuthStateChange((_e, s) => { onSession(s); });
  }

  async function onSession(session) {
    state.user = session?.user || null;
    if (state.user) {
      await loadProfileAndSaved();
      if (state.pendingSave) { const ps = state.pendingSave; state.pendingSave = null; await setSaved(ps.postId, ps.frame, true); }
    } else { state.profile = null; state.saved = new Set(); }
    renderAcct();
    refreshHeart();
  }

  async function loadProfileAndSaved() {
    const sb = state.sb, uid = state.user.id;
    let { data: prof } = await sb.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    if (!prof) prof = await ensureProfile();
    state.profile = prof;
    const { data: items } = await sb.from("saved_items").select("post_id,frame_idx").eq("user_id", uid);
    state.saved = new Set((items || []).map((r) => savedKey(r.post_id, r.frame_idx)));
  }

  async function ensureProfile() {
    const sb = state.sb, u = state.user;
    const base = (u.email || "fan").split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14) || "fan";
    for (let i = 0; i < 5; i++) {
      const username = base + (i ? "-" + Math.floor(1000 + Math.random() * 8999) : "");
      const { data, error } = await sb.from("profiles").insert({ user_id: u.id, username, display_name: base }).select().maybeSingle();
      if (!error && data) return data;
    }
    return { user_id: u.id, username: null, display_name: base };
  }

  async function toggleSaveCurrent() {
    const p = state.view[state.lbIndex];
    if (!p) return;
    const gal = document.getElementById("lbGallery");
    const frame = gal ? Math.round(gal.scrollLeft / (gal.clientWidth || 1)) : 0;
    if (!state.user) { state.pendingSave = { postId: p.id, frame }; openAuth(); return; }
    await setSaved(p.id, frame, !isSaved(p.id, frame));
  }

  async function setSaved(postId, frame, on) {
    const sb = state.sb;
    if (!sb || !state.user) return;
    const key = savedKey(postId, frame);
    let added = false;
    try {
      if (on) {
        const { error } = await sb.from("saved_items").upsert({ user_id: state.user.id, post_id: postId, frame_idx: frame }, { onConflict: "user_id,post_id,frame_idx" });
        if (!error) { state.saved.add(key); added = true; }
      } else {
        await sb.from("saved_items").delete().eq("user_id", state.user.id).eq("post_id", postId).eq("frame_idx", frame);
        state.saved.delete(key);
      }
    } catch { /* RLS / network — ignore */ }
    refreshHeart();
    if (added) showSaveToast();  // confirm the save + offer "View my book"
  }

  // Brief confirmation after saving an image, with a way to jump to the book.
  let saveToastTimer;
  function showSaveToast() {
    if (!el.saveToast) return;
    el.saveToast.hidden = false;
    requestAnimationFrame(() => el.saveToast.classList.add("is-on"));
    clearTimeout(saveToastTimer);
    saveToastTimer = setTimeout(hideSaveToast, 4500);
  }
  function hideSaveToast() {
    if (!el.saveToast) return;
    clearTimeout(saveToastTimer);
    el.saveToast.classList.remove("is-on");
    setTimeout(() => { el.saveToast.hidden = true; }, 250);
  }

  // Sync the lightbox heart to the post + frame currently in view.
  function refreshHeart() {
    const btn = el.lbStage.querySelector(".lb-heart");
    if (!btn || el.lightbox.hidden) return;
    const p = state.view[state.lbIndex];
    if (!p) return;
    const gal = document.getElementById("lbGallery");
    const frame = gal ? Math.round(gal.scrollLeft / (gal.clientWidth || 1)) : 0;
    const on = isSaved(p.id, frame);
    btn.classList.toggle("is-saved", on);
    btn.setAttribute("aria-pressed", String(on));
  }

  /* ---------- auth modal ---------- */
  function openAuth() { el.authModal.hidden = false; }
  function closeAuth() { el.authModal.hidden = true; const m = $("#authMsg"); if (m) m.hidden = true; }
  async function signInGoogle() {
    const sb = await getSupabase(); if (!sb) return;
    await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } });
  }
  async function signInEmail(email) {
    const sb = await getSupabase(); if (!sb) return;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
    const m = $("#authMsg");
    if (m) { m.hidden = false; m.textContent = error ? ("Couldn't send: " + error.message) : "✓ Check your email for the magic link to finish signing in."; }
  }
  async function signOut() { const sb = state.sb; if (sb) await sb.auth.signOut(); if (state.bookMode === "mine") exitBook(); }

  /* ---------- account UI ---------- */
  function renderAcct() {
    if (!el.acctArea) return;
    if (state.user) {
      const name = state.profile?.display_name || (state.user.email || "you").split("@")[0];
      el.acctArea.innerHTML = `<button class="link-btn" id="myBookBtn">♥ My Book</button><span class="acct-name" title="${esc(state.user.email || "")}">${esc(name)}</span><button class="link-btn" id="signOutBtn">Sign out</button>`;
    } else {
      el.acctArea.innerHTML = `<button class="link-btn" id="signInBtn">♥ Sign in</button>`;
    }
  }

  /* ---------- book view (mine or shared) ---------- */
  function itemsFromSaved(savedSet) {
    const byId = new Map((state.data.posts || []).map((p) => [p.id, p]));
    const out = [];
    for (const k of savedSet) {
      const i = k.lastIndexOf(":");
      const post = byId.get(k.slice(0, i));
      if (post) out.push({ post, frame: Number(k.slice(i + 1)) || 0 });
    }
    return out;
  }

  function openMyBook() {
    if (!state.user) { openAuth(); return; }
    state.bookMode = "mine";
    if (state.profile?.username) history.replaceState(null, "", "?book=" + encodeURIComponent(state.profile.username));
    renderBook(itemsFromSaved(state.saved), `${state.profile?.display_name || "Your"} photo book`, true);
  }

  async function openSharedBook(username) {
    const sb = await getSupabase();
    if (!sb) return;
    const { data: prof } = await sb.from("profiles").select("user_id,display_name,username").eq("username", username).maybeSingle();
    if (!prof) { state.bookMode = { username }; renderBook([], `@${username}'s photo book`, false, "That book doesn't exist (or was renamed)."); return; }
    const { data: items } = await sb.from("saved_items").select("post_id,frame_idx").eq("user_id", prof.user_id);
    const set = new Set((items || []).map((r) => savedKey(r.post_id, r.frame_idx)));
    state.bookMode = { username };
    renderBook(itemsFromSaved(set), `${prof.display_name || "@" + username}'s photo book`, false);
  }

  function renderBook(items, title, mine, emptyMsg) {
    state.bookFrames = items.map((it) => it.frame);
    state.view = items.map((it) => it.post);
    // " photo book" drops on phones (just the name); "·" separators show only on
    // phones, where the bar is a single left-to-right line.
    const titleHtml = esc(title).replace(/ photo book$/, '<span class="bb-suffix"> photo book</span>');
    const shareBtn = mine && state.profile?.username
      ? `<span class="bb-sep">·</span><button class="link-btn" id="bookShareBtn">Share my book ⤴</button>` : "";
    el.bookBanner.hidden = false;
    el.bookBanner.innerHTML = `<div class="bb-inner"><strong>🧡 ${titleHtml}</strong><span class="bb-sep">·</span><span class="bb-count">${items.length} image${items.length === 1 ? "" : "s"}</span>${shareBtn}<span class="bb-sep">·</span><button class="link-btn" id="bookBackBtn">✕ Back to feed</button></div>`;
    const n = colCount();
    el.book.innerHTML = Array.from({ length: n }, () => `<div class="book-col"></div>`).join("");
    const cols = [...el.book.querySelectorAll(".book-col")];
    state.cols = cols; state.rendered = items.length;
    el.empty.hidden = items.length > 0;
    el.book.hidden = items.length === 0;
    el.count.textContent = `📖 ${items.length} saved`;
    el.reset.hidden = true; el.activeChips.innerHTML = "";
    if (!items.length) el.empty.innerHTML = emptyMsg ? `<p>★ ${esc(emptyMsg)} ★</p>`
      : (mine ? `<p>★ Your photo book is empty ★</p><p>Tap the 🧡 on any image to save it here.</p>` : `<p>★ This book is empty ★</p>`);
    items.forEach((it, i) => {
      const img = (it.post.images && it.post.images[it.frame]) || it.post.image || "";
      cols[i % n].insertAdjacentHTML("beforeend", bookCardHTML(it.post, img, i));
    });
    window.scrollTo({ top: 0 });
    // Same "↓ Scroll for more" cue as the feed — book cards are .card in #book and
    // state.view/state.rendered are set above, so the shared scroll logic works.
    // Defer one frame so layout settles before measuring scroll height.
    requestAnimationFrame(updateScrollMore);
  }

  function bookCardHTML(p, img, i) {
    const emoji = p.tags.category === "festivities" ? "🏆" : "🏀";
    const inner = img ? `<img loading="lazy" src="${esc(img)}" alt="">` : `<span class="emoji">${emoji}</span>`;
    return `<article class="card book-card" data-i="${i}">
      <div class="card-media${img ? "" : " no-img"}">${inner}
        <span class="badge ${p.platform === "x" ? "x" : "ig"}">${pIcon(p.platform)} @${esc(p.author)}</span>
      </div></article>`;
  }

  function shareBook() {
    if (!state.profile?.username) return;
    const url = location.origin + "/?book=" + encodeURIComponent(state.profile.username);
    if (navigator.share) { navigator.share({ title: "My Knicks photo book", url }).catch(() => {}); return; }
    navigator.clipboard.writeText(url).then(() => {
      const b = $("#bookShareBtn"); if (b) { b.textContent = "✓ Link copied!"; setTimeout(() => { b.textContent = "⤴ Share my book"; }, 1800); }
    }).catch(() => {});
  }

  function exitBook() {
    state.bookMode = null;
    el.bookBanner.hidden = true;
    el.empty.innerHTML = `<p>★ No posts match that combo. ★</p><p>Loosen a filter and the Garden will fill back up.</p>`;
    history.replaceState(null, "", location.pathname);
    render();
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
      if (card) { const i = Number(card.dataset.i); openLightbox(i, state.bookMode ? (state.bookFrames[i] || 0) : 0); }
    });
    el.lbStage.addEventListener("click", (e) => {
      const rm = e.target.closest(".lb-remove");
      if (rm) { e.stopPropagation(); hidePost(rm.dataset.id); return; }
      const sh = e.target.closest(".lb-share");
      if (sh) { e.stopPropagation(); sharePost(); return; }
      const ht = e.target.closest(".lb-heart");
      if (ht) { e.stopPropagation(); toggleSaveCurrent(); }
    });

    // Account area (sign in / My Book / sign out), book banner, auth modal.
    el.acctArea.addEventListener("click", (e) => {
      if (e.target.closest("#signInBtn")) openAuth();
      else if (e.target.closest("#myBookBtn")) openMyBook();
      else if (e.target.closest("#signOutBtn")) signOut();
    });
    el.bookBanner.addEventListener("click", (e) => {
      if (e.target.closest("#bookBackBtn")) exitBook();
      else if (e.target.closest("#bookShareBtn")) shareBook();
    });
    if (el.saveToast) el.saveToast.addEventListener("click", (e) => {
      if (e.target.closest("#saveToastView")) { hideSaveToast(); if (!el.lightbox.hidden) closeLightbox(); openMyBook(); }
      else if (e.target.closest("#saveToastDismiss")) hideSaveToast();
    });
    el.authModal.addEventListener("click", (e) => {
      if (e.target === el.authModal || e.target.closest("#authClose")) { closeAuth(); return; }
      if (e.target.closest("#authGoogle")) signInGoogle();
    });
    const emailForm = document.getElementById("authEmailForm");
    if (emailForm) emailForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = (document.getElementById("authEmail").value || "").trim();
      if (v) signInEmail(v);
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
    el.homeBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

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
    el.series.addEventListener("change", () => { state.series = el.series.value; commitPick(); });
    el.atype.addEventListener("change", () => { state.atype = el.atype.value; commitPick(); });
    el.player.addEventListener("change", () => { state.player = el.player.value; commitPick(); });
    el.celeb.addEventListener("change", () => { state.celeb = el.celeb.value; commitPick(); });
    el.account.addEventListener("change", () => { state.account = el.account.value; commitPick(); });
    el.keyword.addEventListener("change", () => { state.keyword = el.keyword.value; commitPick(); });
    el.media.addEventListener("change", () => { state.media = el.media.value; commitPick(); });
    el.ptype.addEventListener("change", () => { state.ptype = el.ptype.value; commitPick(); });
    el.category.addEventListener("change", () => { state.category = el.category.value; commitPick(); });
    el.sort.addEventListener("change", () => { state.sort = el.sort.value; commitPick(); });

    el.reset.addEventListener("click", () => {
      Object.assign(state, {
        platform: "all", q: "", series: "all", atype: "all", player: "", celeb: "",
        account: "", keyword: "", ptype: "all", category: "all", media: "media",
      });
      el.q.value = ""; el.series.value = "all"; el.atype.value = "all"; el.player.value = ""; el.celeb.value = "";
      el.account.value = ""; el.keyword.value = ""; el.ptype.value = "all"; el.category.value = "all";
      el.media.value = "media";
      el.platformChips.querySelectorAll(".chip[data-platform]").forEach((c) => c.classList.toggle("is-on", c.dataset.platform === "all"));
      render(); scrollToResults(); // back to the top of the full feed
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
