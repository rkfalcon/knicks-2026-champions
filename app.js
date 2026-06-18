/* Knicks 2026 picture book — vanilla JS, no build step. */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    book: $("#book"), empty: $("#empty"), count: $("#count"), reset: $("#reset"),
    q: $("#q"), series: $("#series"), game: $("#game"), player: $("#player"),
    celeb: $("#celeb"), account: $("#account"), keyword: $("#keyword"), ptype: $("#ptype"),
    category: $("#category"), sort: $("#sort"),
    platformChips: $("#platformChips"), generated: $("#generated"),
    filtersToggle: $("#filtersToggle"), filterSelects: $("#filterSelects"),
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

    el.player.innerHTML = `<option value="">Anyone</option>` +
      (d.players || []).map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.number ? " #" + p.number : ""}</option>`).join("");

    el.celeb.innerHTML = `<option value="">Anyone</option>` +
      (d.celebrities || []).map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");

    // Count posts per account, keyed by platform+author so an account whose X and
    // IG handles match (e.g. NBA) isn't double-counted. Mirrors the filter logic.
    const byPlatformAuthor = {};
    for (const p of d.posts || []) {
      const k = p.platform + ":" + (p.author || "").toLowerCase();
      byPlatformAuthor[k] = (byPlatformAuthor[k] || 0) + 1;
    }
    const acctCount = (a) =>
      (a.x_handle ? byPlatformAuthor["x:" + a.x_handle.toLowerCase()] || 0 : 0) +
      (a.ig_handle ? byPlatformAuthor["instagram:" + a.ig_handle.toLowerCase()] || 0 : 0);
    // Replace state.data.accounts with a count-annotated, count-sorted copy so the
    // option indices stay in sync with applyFilters' lookup.
    d.accounts = (d.accounts || [])
      .map((a) => ({ ...a, _count: acctCount(a) }))
      .sort((x, y) => y._count - x._count || (x.name || "").localeCompare(y.name || ""));
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

  function render() {
    const posts = applyFilters();
    state.view = posts;

    el.book.innerHTML = posts.map((p, i) => cardHTML(p, i)).join("");
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

    el.book.querySelectorAll(".card").forEach((c) =>
      c.addEventListener("click", () => openLightbox(Number(c.dataset.i))));
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

  /* ---------- bind ---------- */
  function bind() {
    el.platformChips.querySelectorAll(".chip[data-platform]").forEach((chip) =>
      chip.addEventListener("click", () => {
        el.platformChips.querySelectorAll(".chip[data-platform]").forEach((c) => c.classList.remove("is-on"));
        chip.classList.add("is-on");
        state.platform = chip.dataset.platform;
        render();
      }));

    // Collapsible filters panel (hidden by default).
    el.filtersToggle.addEventListener("click", () => {
      const open = el.filterSelects.hidden;
      el.filterSelects.hidden = !open;
      el.filtersToggle.classList.toggle("is-open", open);
      el.filtersToggle.setAttribute("aria-expanded", String(open));
      el.filtersToggle.textContent = (open ? "▴" : "▾") + " Filters";
    });

    let qt;
    el.q.addEventListener("input", () => {
      clearTimeout(qt);
      qt = setTimeout(() => { state.q = el.q.value.trim(); render(); }, 160);
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
