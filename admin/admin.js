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
async function api(method, body) {
  const res = await fetch("/api/admin/data", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin("Session expired — sign in again."); throw new Error("unauthorized"); }
  if (res.status === 403) { showLogin("This account is not an admin."); throw new Error("forbidden"); }
  return res.json();
}
async function loadData() { DATA = await api("GET"); }

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------------- entity schemas ---------------- */
const ENTITIES = {
  accounts: { pk: "id", cols: [
    { k: "platform", t: "select", opts: ["x", "instagram"] },
    { k: "handle", t: "text" }, { k: "label", t: "text" }, { k: "active", t: "bool" },
  ]},
  keywords: { pk: "id", cols: [
    { k: "term", t: "text" }, { k: "label", t: "text" },
    { k: "as_hashtag", t: "bool" }, { k: "active", t: "bool" },
  ]},
  players: { pk: "id", cols: [
    { k: "name", t: "text" }, { k: "number", t: "number" },
    { k: "x_handle", t: "text" }, { k: "ig_handle", t: "text" },
    { k: "aliases", t: "list" }, { k: "active", t: "bool" },
  ]},
  celebrities: { pk: "id", cols: [
    { k: "name", t: "text" }, { k: "aliases", t: "list" }, { k: "active", t: "bool" },
  ]},
  series: { pk: "id", cols: [
    { k: "id", t: "text" }, { k: "label", t: "text" }, { k: "opponent", t: "text" },
    { k: "result", t: "text" }, { k: "start_date", t: "date" }, { k: "end_date", t: "date" },
    { k: "round", t: "number" }, { k: "sort", t: "number" },
  ]},
  games: { pk: "id", cols: [
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
function renderTab(tab) {
  if (tab === "settings") return renderSettings();
  const schema = ENTITIES[tab];
  const rows = DATA[tab] || [];
  const head = schema.cols.map((c) => `<th>${c.k}</th>`).join("") + "<th></th>";
  const body = rows.map((r) => rowHTML(tab, schema, r)).join("");
  $("#panel").innerHTML = `
    <div class="panel-head">
      <h2>${tab} <small>(${rows.length})</small></h2>
      <button class="btn" data-add>＋ Add ${tab.replace(/s$/, "")}</button>
    </div>
    <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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
  return `<tr data-id="${esc(id)}">${cells}
    <td class="row-actions">
      <button class="btn sm" data-save>Save</button>
      ${id !== "" ? `<button class="btn sm danger" data-del>✕</button>` : ""}
    </td></tr>`;
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
  if (e.target.matches("[data-add]")) {
    DATA[tab].push({});            // blank editable row
    renderTab(tab);
    return;
  }
  const tr = e.target.closest("tr");
  const schema = ENTITIES[tab];
  if (e.target.matches("[data-save]")) {
    try {
      const row = readRow(tr, schema);
      const { ok, row: saved, error } = await api("POST", { entity: tab, op: "upsert", row });
      if (!ok) throw new Error(error);
      toast("Saved ✓");
      await loadData(); renderTab(tab);
    } catch (err) { toast(err.message, true); }
  }
  if (e.target.matches("[data-del]")) {
    if (!confirm("Delete this row?")) return;
    try {
      const { ok, error } = await api("POST", { entity: tab, op: "delete", id: tr.dataset.id });
      if (!ok) throw new Error(error);
      toast("Deleted");
      await loadData(); renderTab(tab);
    } catch (err) { toast(err.message, true); }
  }
});

/* ---------------- settings panel ---------------- */
function renderSettings() {
  const st = DATA.settings.stories || {};
  const dr = DATA.settings.date_range || {};
  $("#panel").innerHTML = `
    <div class="panel-head"><h2>Settings</h2></div>
    <div class="settings-grid">
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

/* ---------------- go ---------------- */
try {
  sb.auth.onAuthStateChange((_e, session) => { token = session?.access_token || null; });
  const session = await refreshSession();
  if (session) await showApp(session); else showLogin();
} catch (e) {
  showLogin("Couldn't check session: " + (e?.message || e));
}
