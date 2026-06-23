/* ---------------- bootstrap + auth ---------------- */
const $ = (s) => document.querySelector(s);
let createClient, cfg, sb, DATA = null, token = null;

// Dynamic import (with a fallback CDN) so a flaky module load surfaces an error
// in the login form instead of silently killing the whole page.
try {
  const mod = await import("https://esm.sh/@supabase/supabase-js@2.45.0")
    .catch(() => import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"));
  createClient = mod.createClient;
  if (!createClient) throw new Error("auth library failed to load");
  cfg = await fetch("/api/config").then((r) => r.json());
  if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) throw new Error("server is missing Supabase config");
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
} catch (e) {
  showLogin("Admin failed to load: " + (e?.message || e));
  throw e;
}

async function refreshSession() {
  const { data } = await sb.auth.getSession();
  token = data.session?.access_token || null;
  return data.session;
}

function showLogin(msg) {
  $("#login").hidden = false;
  $("#app").hidden = true;
  $("#logout").hidden = true;
  $("#who").textContent = "";
  if (msg) { $("#loginErr").textContent = msg; $("#loginErr").hidden = false; }
}

async function showApp(session) {
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#logout").hidden = false;
  $("#who").textContent = session.user.email;
  await loadData();
  renderTab(currentTab);
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginErr").hidden = true;
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("#email").value.trim(), password: $("#password").value,
  });
  if (error) return showLogin(error.message);
  await refreshSession();
  showApp(data.session);
});

$("#logout").addEventListener("click", async () => { await sb.auth.signOut(); showLogin(); });

/* ---------------- admin API ---------------- */
async function api(method, body, path = "/api/admin/data") {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin("Session expired — sign in again."); throw new Error("unauthorized"); }
  if (res.status === 403) { showLogin("This account is not an admin."); throw new Error("forbidden"); }
  return res.json();
}
async function loadData() { DATA = await api("GET"); }

function toast(msg, bad, sticky) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  clearTimeout(toast._t);
  if (!sticky) toast._t = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------------- entity schemas ---------------- */
const ENTITIES = {
  accounts: { pk: "id", singular: "account", cols: [
    { k: "name", t: "text" },
    { k: "x_handle", t: "text" }, { k: "ig_handle", t: "text" },
    { k: "account_type", t: "select", opts: ["none", "player", "team", "celebrity", "fan"] },
    { k: "show_all", t: "bool" },
    { k: "posts_only", t: "bool" },
    { k: "cron_enabled", t: "bool" },
    { k: "active", t: "bool" },
  ]},
  keywords: { pk: "id", singular: "keyword", cols: [
    { k: "term", t: "text" }, { k: "label", t: "text" },
    { k: "as_hashtag", t: "bool" }, { k: "active", t: "bool" },
  ]},
  players: { pk: "id", singular: "player", cols: [
    { k: "name", t: "text" }, { k: "number", t: "number" },
    { k: "x_handle", t: "text" }, { k: "ig_handle", t: "text" },
    { k: "aliases", t: "list" }, { k: "active", t: "bool" },
  ]},
  celebrities: { pk: "id", singular: "celebrity", cols: [
    { k: "name", t: "text" },
    { k: "x_handle", t: "text" }, { k: "ig_handle", t: "text" },
    { k: "aliases", t: "list" }, { k: "active", t: "bool" },
  ]},
  series: { pk: "id", singular: "series", cols: [
    { k: "id", t: "text" }, { k: "label", t: "text" }, { k: "opponent", t: "text" },
    { k: "result", t: "text" }, { k: "start_date", t: "date" }, { k: "end_date", t: "date" },
    { k: "round", t: "number" }, { k: "sort", t: "number" },
  ]},
  games: { pk: "id", singular: "game", cols: [
    { k: "id", t: "text" }, { k: "series_id", t: "text" }, { k: "label", t: "text" },
    { k: "game_date", t: "date" }, { k: "home", t: "bool" }, { k: "result", t: "text" }, { k: "sort", t: "number" },
  ]},
};

let currentTab = "accounts";
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab"); if (!b) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-on", t === b));
  currentTab = b.dataset.tab;
  renderTab(currentTab);
});

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- rendering ---------------- */
const acctFilter = { q: "", type: "all", focus: false };

function renderTab(tab) {
  if (tab === "settings") return renderSettings();
  if (tab === "runs") return renderRuns();
  if (tab === "addpost") return renderAddPost();
  const schema = ENTITIES[tab];
  const all = DATA[tab] || [];

  // Accounts tab: client-side search + type filter.
  const withTools = tab === "accounts";
  let rows = all;
  if (withTools) {
    const q = acctFilter.q.toLowerCase();
    rows = all.filter((r) => {
      if (acctFilter.type !== "all" && (r.account_type || "none") !== acctFilter.type) return false;
      if (q) return [r.name, r.x_handle, r.ig_handle].some((v) => (v || "").toLowerCase().includes(q));
      return true;
    });
  }

  const tools = withTools ? `
    <div class="tab-tools">
      <input id="acctSearch" type="search" placeholder="🔎 search name / handle" value="${esc(acctFilter.q)}" />
      <select id="acctType">
        ${["all", "player", "team", "celebrity", "fan", "none"].map((t) =>
          `<option value="${t}" ${acctFilter.type === t ? "selected" : ""}>${t === "all" ? "All types" : t}</option>`).join("")}
      </select>
    </div>` : "";
  const counter = withTools && rows.length !== all.length ? `${rows.length} of ${all.length}` : `${all.length}`;

  const head = schema.cols.map((c) => `<th>${c.k}</th>`).join("") + "<th></th>";
  const body = rows.map((r) => rowHTML(tab, schema, r)).join("");
  const runAll = tab === "accounts"
    ? `<button class="btn run" data-runall>▶ Run all</button>` : "";
  $("#panel").innerHTML = `
    <div class="panel-head">
      <h2>${tab} <small>(${counter})</small></h2>
      ${tools}
      ${runAll}
      <button class="btn" data-saveall>💾 Save all</button>
      <button class="btn" data-add>＋ Add ${schema.singular || tab}</button>
    </div>
    <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

  if (withTools) {
    const search = $("#acctSearch");
    search.addEventListener("input", () => { acctFilter.q = search.value; acctFilter.focus = true; renderTab("accounts"); });
    $("#acctType").addEventListener("change", (e) => { acctFilter.type = e.target.value; renderTab("accounts"); });
    if (acctFilter.focus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); acctFilter.focus = false; }
  }
}

function cellInput(c, val) {
  const v = val ?? "";
  if (c.t === "bool") return `<input type="checkbox" data-k="${c.k}" ${val ? "checked" : ""}>`;
  if (c.t === "select") return `<select data-k="${c.k}">${c.opts.map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select>`;
  if (c.t === "list") return `<input data-k="${c.k}" value="${esc(Array.isArray(val) ? val.join(", ") : v)}" placeholder="comma,separated">`;
  if (c.t === "number") return `<input data-k="${c.k}" type="number" value="${esc(v)}" style="width:5.5em">`;
  if (c.t === "date") return `<input data-k="${c.k}" type="date" value="${esc(v)}">`;
  return `<input data-k="${c.k}" value="${esc(v)}">`;
}

function rowHTML(tab, schema, r) {
  const id = r[schema.pk] ?? "";
  const cells = schema.cols.map((c) => `<td>${cellInput(c, r[c.k])}</td>`).join("");
  const runBtn = tab === "accounts" && id !== "" ? `<button class="btn sm run" data-run>▶ Run</button>` : "";
  return `<tr data-id="${esc(id)}">${cells}
    <td class="row-actions">
      <button class="btn sm" data-save>Save</button>
      ${runBtn}
      ${id !== "" ? `<button class="btn sm danger" data-del>✕</button>` : ""}
    </td></tr>`;
}

/* ---------------- runs ---------------- */
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const dur = (a, b) => {
  if (!a || !b) return "";
  const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

function renderRuns() {
  const runs = DATA.runs || [];
  const body = runs.map((r) => {
    const badge = r.status === "done" ? "✅" : r.status === "error" ? "❌" : "⏳";
    return `<tr>
      <td>${badge} ${esc(r.status)}</td>
      <td>${esc(r.scope || "all")}</td>
      <td>${esc(r.trigger || "")}</td>
      <td>${fmtTime(r.started_at)}</td>
      <td>${dur(r.started_at, r.finished_at)}</td>
      <td>${r.scraped ?? 0}</td>
      <td>${r.upserted ?? 0}</td>
      <td>${r.mirrored ?? 0}</td>
      <td class="run-err">${esc(r.error || "")}</td>
    </tr>`;
  }).join("");
  $("#panel").innerHTML = `
    <div class="panel-head">
      <h2>runs <small>(${runs.length})</small></h2>
      <button class="btn" data-refresh-runs>↻ Refresh</button>
    </div>
    <div class="table-wrap"><table><thead><tr>
      <th>status</th><th>scope</th><th>trigger</th><th>started</th><th>took</th>
      <th>scraped</th><th>upserted</th><th>images</th><th>error</th>
    </tr></thead><tbody>${body || `<tr><td colspan="9" style="padding:14px">No runs yet — hit ▶ Run all on the Accounts tab.</td></tr>`}</tbody></table></div>`;
  $("[data-refresh-runs]").addEventListener("click", async () => { await loadData(); renderRuns(); });
}

// Trigger an ingest run; accountId omitted = run all.
async function triggerRun(accountId, label) {
  const btns = document.querySelectorAll("[data-run],[data-runall]");
  btns.forEach((b) => (b.disabled = true));
  toast(`Running ${label}… this can take a minute`, false, true);
  try {
    const r = await api("POST", { accountId }, "/api/admin/run");
    if (!r.ok) throw new Error(r.error || "run failed");
    toast(`Run done: ${r.count} posts, ${r.mirrored} new images`);
    await loadData();
    currentTab = "runs";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === "runs"));
    renderRuns();
  } catch (e) {
    toast(e.message, true);
  } finally {
    document.querySelectorAll("[data-run],[data-runall]").forEach((b) => (b.disabled = false));
  }
}

function rowIsEmpty(row, schema) {
  return schema.cols.every((c) => {
    const v = row[c.k];
    return v == null || v === "" || v === false || (Array.isArray(v) && !v.length);
  });
}

function readRow(tr, schema) {
  const row = {};
  for (const c of schema.cols) {
    const elIn = tr.querySelector(`[data-k="${c.k}"]`);
    if (!elIn) continue;
    if (c.t === "bool") row[c.k] = elIn.checked;
    else if (c.t === "list") row[c.k] = elIn.value.split(",").map((s) => s.trim()).filter(Boolean);
    else if (c.t === "number") row[c.k] = elIn.value === "" ? null : Number(elIn.value);
    else row[c.k] = elIn.value.trim() === "" ? null : elIn.value.trim();
  }
  // keep existing pk for existing rows
  const id = tr.dataset.id;
  if (id) row[schema.pk] = id;
  else delete row[schema.pk]; // let DB default a uuid
  return row;
}

$("#panel").addEventListener("click", async (e) => {
  const tab = currentTab;
  if (e.target.matches("[data-runall]")) { triggerRun(null, "all accounts"); return; }
  if (e.target.matches("[data-run]")) {
    const tr = e.target.closest("tr");
    const label = tr.querySelector('[data-k="name"]')?.value || tr.querySelector('[data-k="x_handle"]')?.value || "account";
    triggerRun(tr.dataset.id, label);
    return;
  }
  const schema = ENTITIES[tab];

  // Add a blank row at the TOP (just under the column headings) WITHOUT
  // re-rendering — preserves unsaved input in other rows. Scroll up so the
  // headings + new row are visible and focus its first field.
  if (e.target.matches("[data-add]")) {
    const tbody = $("#panel tbody");
    // New accounts default to active + cron_enabled (scraped like before).
    const blank = tab === "accounts" ? { active: true, cron_enabled: true } : {};
    tbody.insertAdjacentHTML("afterbegin", rowHTML(tab, schema, blank));
    window.scrollTo({ top: 0, behavior: "smooth" });
    const firstField = tbody.querySelector("tr:first-child input, tr:first-child select");
    if (firstField) firstField.focus({ preventScroll: true });
    return;
  }

  // Save all rows at once (skip blank rows).
  if (e.target.matches("[data-saveall]")) {
    const trs = [...$("#panel tbody").querySelectorAll("tr")];
    let ok = 0, fail = 0, skipped = 0;
    toast(`Saving ${trs.length}…`, false, true);
    for (const tr of trs) {
      const row = readRow(tr, schema);
      if (rowIsEmpty(row, schema)) { skipped++; continue; }
      try {
        const { ok: o, row: saved, error } = await api("POST", { entity: tab, op: "upsert", row });
        if (!o) throw new Error(error);
        if (saved) tr.outerHTML = rowHTML(tab, schema, saved);
        ok++;
      } catch { fail++; }
    }
    toast(`Saved ${ok}${fail ? `, ${fail} failed` : ""}${skipped ? `, ${skipped} blank skipped` : ""} ✓`, fail > 0);
    loadData();
    return;
  }

  const tr = e.target.closest("tr");
  if (!tr) return;

  // Save one row in place — re-render only this row (keeps other rows' edits).
  if (e.target.matches("[data-save]")) {
    try {
      const { ok, row: saved, error } = await api("POST", { entity: tab, op: "upsert", row: readRow(tr, schema) });
      if (!ok) throw new Error(error);
      if (saved) tr.outerHTML = rowHTML(tab, schema, saved);
      toast("Saved ✓");
      loadData(); // background refresh, no full re-render
    } catch (err) { toast(err.message, true); }
  }

  // Delete one row in place.
  if (e.target.matches("[data-del]")) {
    if (!confirm("Delete this row?")) return;
    try {
      const { ok, error } = await api("POST", { entity: tab, op: "delete", id: tr.dataset.id });
      if (!ok) throw new Error(error);
      tr.remove();
      toast("Deleted");
      loadData();
    } catch (err) { toast(err.message, true); }
  }
});

/* ---------------- settings panel ---------------- */
function renderSettings() {
  const st = DATA.settings.stories || {};
  const dr = DATA.settings.date_range || {};
  const fk = Array.isArray(DATA.settings.filter_keywords) ? DATA.settings.filter_keywords : [];
  $("#panel").innerHTML = `
    <div class="panel-head"><h2>Settings</h2></div>
    <div class="settings-grid">
      <fieldset>
        <legend>Filter keywords</legend>
        <label>A post must contain at least one of these to be pulled in (comma-separated)
          <textarea id="set-filterkw" rows="3" style="font-size:0.95rem;padding:8px;border:3px solid var(--ink)">${esc(fk.join(", "))}</textarea>
        </label>
        <button class="btn sm" id="save-filterkw">Save filter keywords</button>
        <p class="hint">Applies to every account on every run (X &amp; Instagram). Leave empty to pull <em>all</em> posts from tracked accounts. Tip: don't include broad terms like "msg" or "madison square garden" — they match non-Knicks MSG events from accounts like @TheGarden.</p>
      </fieldset>
      <fieldset>
        <legend>Scrape window</legend>
        <label>Since <input id="set-since" type="date" value="${esc(dr.since || "")}"></label>
        <label>Until <input id="set-until" type="date" value="${esc(dr.until || "")}"></label>
        <button class="btn sm" id="save-window">Save window</button>
      </fieldset>
      <fieldset>
        <legend>Instagram Stories &amp; Highlights</legend>
        <label class="row"><input id="st-enabled" type="checkbox" ${st.enabled ? "checked" : ""}> Enabled</label>
        <label>Session cookie (sessionid)
          <input id="st-cookie" type="password" value="${esc(st.ig_session_cookie || "")}" placeholder="paste IG sessionid cookie">
        </label>
        <label>Active-stories actor <input id="st-active" value="${esc(st.active_actor || "")}"></label>
        <label>Highlights actor <input id="st-high" value="${esc(st.highlights_actor || "")}"></label>
        <button class="btn sm" id="save-stories">Save stories config</button>
        <p class="hint">Stories require a logged-in Instagram <code>sessionid</code> cookie. Use a burner account.</p>
      </fieldset>
    </div>`;

  $("#save-filterkw").addEventListener("click", async () => {
    try {
      const value = $("#set-filterkw").value.split(",").map((s) => s.trim()).filter(Boolean);
      await api("POST", { entity: "settings", op: "upsert", row: { key: "filter_keywords", value } });
      toast(`Saved ${value.length} filter keywords ✓`); await loadData();
    } catch (e) { toast(e.message, true); }
  });
  $("#save-window").addEventListener("click", async () => {
    try {
      await api("POST", { entity: "settings", op: "upsert", row: { key: "date_range", value: { since: $("#set-since").value, until: $("#set-until").value } } });
      toast("Window saved ✓"); await loadData();
    } catch (e) { toast(e.message, true); }
  });
  $("#save-stories").addEventListener("click", async () => {
    try {
      const value = {
        enabled: $("#st-enabled").checked,
        ig_session_cookie: $("#st-cookie").value.trim(),
        active_actor: $("#st-active").value.trim(),
        highlights_actor: $("#st-high").value.trim(),
      };
      await api("POST", { entity: "settings", op: "upsert", row: { key: "stories", value } });
      toast("Stories config saved ✓"); await loadData();
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------------- add a single post by URL ---------------- */
function renderAddPost() {
  $("#panel").innerHTML = `
    <div class="panel-head"><h2>Add a post <small>(paste a link — no account needed)</small></h2></div>
    <div class="addpost">
      <label>Post URL (X or Instagram)
        <input id="ap-url" type="url" placeholder="https://x.com/…/status/…  or  https://instagram.com/p/…">
      </label>
      <button class="btn" id="ap-fetch">Fetch preview</button>
      <p class="hint">Pulls the post's image(s) + caption, auto-detects players/keywords from the caption, and lets you add your own tags before saving. The account does <em>not</em> need to be tracked.</p>
      <div id="ap-preview"></div>
      <div id="ap-history"><p class="hint">Loading history…</p></div>
    </div>`;
  $("#ap-fetch").addEventListener("click", apFetch);
  $("#ap-url").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apFetch(); } });
  loadApHistory();
}

async function loadApHistory() {
  const box = $("#ap-history");
  if (!box) return;
  try {
    const r = await api("POST", { op: "list" }, "/api/admin/add-post");
    if (!r.ok) throw new Error(r.error || "couldn't load");
    renderApHistory(r.posts || []);
  } catch (e) { box.innerHTML = `<p class="hint">Couldn't load history: ${esc(e.message)}</p>`; }
}

function renderApHistory(posts) {
  const box = $("#ap-history");
  if (!box) return;
  const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); };
  if (!posts.length) {
    box.innerHTML = `<h3 class="ap-h-title">Manually added posts</h3><p class="hint">None yet — added posts will show here.</p>`;
    return;
  }
  const rows = posts.map((p) => {
    const img = p.image || (p.images && p.images[0]) || "";
    const tags = [
      ...(p.players || []).map((x) => `🏀 ${x}`),
      ...(p.celebrities || []).map((x) => `⭐ ${x}`),
      ...(p.keywords || []).map((x) => `#${x}`),
    ].map(esc).join(" ") || '<span class="hint">—</span>';
    const n = (p.images || []).length;
    return `<tr data-id="${esc(p.id)}">
      <td>${img ? `<img class="ap-h-thumb" src="${esc(img)}" alt="">${n > 1 ? `<span class="ap-h-multi">▣${n}</span>` : ""}` : ""}</td>
      <td class="ap-h-date">${fmt(p.created_at)}</td>
      <td>${p.platform === "x" ? "𝕏" : "📸"} @${esc(p.author)}${p.author_name ? `<br><small>${esc(p.author_name)}</small>` : ""}</td>
      <td class="ap-h-text">${esc((p.text || "").replace(/\s+/g, " ").slice(0, 120))}</td>
      <td>${tags}${p.hidden ? ' <em class="hint">(hidden)</em>' : ""}</td>
      <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">source ↗</a>` : ""}</td>
      <td><button class="btn sm danger" data-ap-remove="${esc(p.id)}" title="Remove this post">✕</button></td>
    </tr>`;
  }).join("");
  box.innerHTML = `
    <h3 class="ap-h-title">Manually added posts <small>(${posts.length})</small></h3>
    <div class="table-wrap"><table class="ap-h-table"><thead><tr>
      <th></th><th>added</th><th>account</th><th>caption</th><th>tags</th><th>link</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  box.querySelectorAll("[data-ap-remove]").forEach((b) =>
    b.addEventListener("click", () => apRemove(b.dataset.apRemove)));
}

async function apRemove(id) {
  if (!confirm("Remove this manually added post from the site?")) return;
  try {
    const r = await api("POST", { op: "remove", id }, "/api/admin/add-post");
    if (!r.ok) throw new Error(r.error || "couldn't remove");
    toast("Removed ✓");
    loadApHistory();
  } catch (e) { toast(e.message, true); }
}

async function apFetch() {
  const url = $("#ap-url").value.trim();
  if (!url) return;
  $("#ap-fetch").disabled = true;
  toast("Fetching post…", false, true);
  try {
    const r = await api("POST", { op: "preview", url }, "/api/admin/add-post");
    if (!r.ok) throw new Error(r.error || "couldn't fetch");
    renderApPreview(r.post);
    toast("Fetched ✓");
  } catch (e) { toast(e.message, true); }
  finally { $("#ap-fetch").disabled = false; }
}

let apCoverIdx = 0;
function renderApPreview(p) {
  const imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
  const t = p.tags || {};
  apCoverIdx = 0;
  const multi = imgs.length > 1;
  // Raw source URLs (esp. Instagram) block hotlinking, so display via our proxy.
  const apImg = (u) => (u && !u.includes("/storage/")) ? `/api/img?url=${encodeURIComponent(u)}` : u;
  $("#ap-preview").innerHTML = `
    <div class="ap-card">
      <div class="ap-imgs">${imgs.map((u, i) =>
        `<button type="button" class="ap-thumb${i === 0 ? " is-cover" : ""}" data-idx="${i}" title="Make this the cover">
          <img src="${esc(apImg(u))}" alt=""><span class="ap-cover-badge">★ cover</span></button>`).join("") || '<em class="hint">no image on this post</em>'}</div>
      ${multi ? '<p class="hint">Click an image to make it the default (cover) shown on the site.</p>' : ""}
      <div class="ap-head">
        <strong>@${esc(p.author)}</strong> · ${esc((p.date || "").toString().slice(0, 16))} · ${p.platform === "x" ? "X" : "Instagram"}
      </div>
      <p class="ap-text">${esc(p.text || "")}</p>
      <div class="ap-fields">
        <label>Author display name <input id="ap-author" value="${esc(p.authorName || p.author)}"></label>
        <label>Players <input id="ap-players" value="${esc((t.players || []).join(", "))}" placeholder="comma,separated"></label>
        <label>Celebrities <input id="ap-celebs" value="${esc((t.celebrities || []).join(", "))}" placeholder="comma,separated"></label>
        <label>Keywords / tags <input id="ap-keywords" value="${esc((t.keywords || []).join(", "))}" placeholder="knicks, parade, …"></label>
        <label>Category <select id="ap-category">
          ${["", "game", "festivities"].map((c) => `<option value="${c}" ${(t.category || "") === c ? "selected" : ""}>${c || "auto/none"}</option>`).join("")}
        </select></label>
      </div>
      <fieldset class="ap-acct">
        <legend><label><input type="checkbox" id="ap-mkacct" checked> Make @${esc(p.author)} a filterable account</label></legend>
        <div class="ap-fields">
          <label>Account display name <input id="ap-acctname" value="${esc(p.authorName || p.author)}"></label>
          <label>Account type <select id="ap-accttype">
            ${["none", "player", "team", "celebrity", "fan"].map((o) => `<option>${o}</option>`).join("")}
          </select></label>
        </div>
        <p class="hint">Lets users filter the site by this account. It is <strong>excluded from the daily scrape</strong> (cron_enabled=false) until you enable it on the Accounts tab. If the account already exists, it's left unchanged.</p>
      </fieldset>
      <button class="btn run" id="ap-add">＋ Add to site</button>
    </div>`;
  $("#ap-add").addEventListener("click", () => apAdd(p));
  $("#ap-preview").querySelectorAll(".ap-thumb").forEach((b) => b.addEventListener("click", () => {
    apCoverIdx = Number(b.dataset.idx);
    $("#ap-preview").querySelectorAll(".ap-thumb").forEach((x) =>
      x.classList.toggle("is-cover", Number(x.dataset.idx) === apCoverIdx));
  }));

  // Typeahead from existing system values (multi-value, comma-separated).
  attachTypeahead($("#ap-players"), (DATA.players || []).map((x) => x.name).filter(Boolean));
  attachTypeahead($("#ap-celebs"), (DATA.celebrities || []).map((x) => x.name).filter(Boolean));
  attachTypeahead($("#ap-keywords"), (DATA.keywords || []).map((x) => x.term).filter(Boolean));
}

// Lightweight multi-value autocomplete: suggests existing options matching the
// token after the last comma; you can still type new values freely.
function attachTypeahead(input, options) {
  if (!input) return;
  const label = input.closest("label") || input.parentElement;
  label.style.position = "relative";
  const menu = document.createElement("div");
  menu.className = "ap-typeahead";
  menu.hidden = true;
  label.appendChild(menu);
  let matches = [], active = -1;

  const parts = () => input.value.split(",");
  const curToken = () => parts().pop().trim();
  const close = () => { menu.hidden = true; active = -1; };

  const refresh = () => {
    const q = curToken().toLowerCase();
    const chosen = new Set(parts().slice(0, -1).map((s) => s.trim().toLowerCase()));
    matches = !q ? [] : options
      .filter((o) => o.toLowerCase().includes(q) && !chosen.has(o.toLowerCase()))
      .sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1))
      .slice(0, 8);
    active = -1;
    if (!matches.length) return close();
    menu.innerHTML = matches.map((m, i) => `<div class="ap-ta-item" data-i="${i}">${esc(m)}</div>`).join("");
    menu.hidden = false;
  };

  const highlight = () => menu.querySelectorAll(".ap-ta-item").forEach((d, i) => d.classList.toggle("is-on", i === active));

  const pick = (val) => {
    const p = parts();
    p[p.length - 1] = " " + val;
    input.value = p.join(",").replace(/^\s+/, "") + ", ";
    close();
    input.focus();
  };

  input.addEventListener("input", refresh);
  input.addEventListener("focus", refresh);
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    if (menu.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % matches.length; highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; highlight(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === "Escape") close();
  });
  menu.addEventListener("mousedown", (e) => {
    const it = e.target.closest(".ap-ta-item");
    if (!it) return;
    e.preventDefault();
    pick(matches[Number(it.dataset.i)]);
  });
}

async function apAdd(p) {
  const list = (sel) => $(sel).value.split(",").map((s) => s.trim()).filter(Boolean);
  $("#ap-add").disabled = true;
  toast("Adding to site…", false, true);
  try {
    const r = await api("POST", {
      op: "add",
      url: $("#ap-url").value.trim(),
      authorName: $("#ap-author").value.trim(),
      players: list("#ap-players"),
      celebrities: list("#ap-celebs"),
      keywords: list("#ap-keywords"),
      category: $("#ap-category").value || null,
      createAccount: $("#ap-mkacct").checked,
      accountName: $("#ap-acctname").value.trim(),
      accountType: $("#ap-accttype").value,
      coverIndex: apCoverIdx,
    }, "/api/admin/add-post");
    if (!r.ok) throw new Error(r.error || "couldn't add");
    toast(`Added @${r.post.author}'s post ✓`);
    $("#ap-preview").innerHTML = `<p class="hint">✅ Added <strong>@${esc(r.post.author)}</strong>'s post — it'll show on the site's next load. Paste another link to add more.</p>`;
    $("#ap-url").value = "";
    loadApHistory(); // show it in the history below
  } catch (e) { toast(e.message, true); $("#ap-add").disabled = false; }
}

/* ---------------- go ---------------- */
try {
  sb.auth.onAuthStateChange((_e, session) => { token = session?.access_token || null; });
  const session = await refreshSession();
  if (session) await showApp(session); else showLogin();
} catch (e) {
  showLogin("Couldn't check session: " + (e?.message || e));
}
