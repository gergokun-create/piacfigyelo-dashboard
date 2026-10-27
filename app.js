/* Piacfigyelő – nyilvános dashboard.
 * Külső függőség nélkül. Az adatok a data.json-ból jönnek (a privát repó generálja).
 * Minden adatból származó szöveg textContent-tel kerül a DOM-ba; innerHTML csak a
 * szerveroldalon biztonságosan renderelt riportokhoz (marketmon.safemd) kell.
 * A GitHub-token CSAK ebben a böngészőben van (localStorage vagy sessionStorage). */
"use strict";

const S = { data: null, reportFilter: "all", reportQuery: "" };
const NF = (d = 2) => new Intl.NumberFormat("hu-HU", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 2) => (v === null || v === undefined || v === "" || Number.isNaN(+v)) ? "–" : NF(d).format(+v);
const pct = (v, d = 2) => (v === null || v === undefined || Number.isNaN(+v)) ? "–" : (v > 0 ? "+" : "") + NF(d).format(+v) + "%";
const view = () => document.getElementById("view");

/* ---------- DOM-segéd ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const card = (title, ...kids) => h("section", { class: "card" }, h("h2", {}, ...[].concat(title)), ...kids);
const kpi = (label, value, cls) => h("div", { class: "kpi" }, h("div", { class: "l", text: label }), h("div", { class: "v " + (cls || ""), text: value }));
const signCls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const yesNo = (b) => (b === true ? "igen" : b === false ? "nem" : "–");

/* ---------- adat ---------- */
async function load(force) {
  /* A GitHub Pages 10 percig cache-elhetőnek jelöli a fájlokat; a no-cache mindig újraellenőrzi (ETag),
     így a friss adat azonnal látszik, változatlan adatnál pedig nem töltődik le újra. */
  const r = await fetch("data.json" + (force ? "?t=" + Date.now() : ""), { cache: force ? "no-store" : "no-cache" });
  if (!r.ok) throw new Error("data.json: HTTP " + r.status);
  S.data = await r.json();
  document.getElementById("title").textContent = S.data.title || "Piacfigyelő";
  document.getElementById("updated").textContent = "Frissítve: " + new Date(S.data.generated_at).toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" });
  document.getElementById("disclaimer").textContent = S.data.disclaimer + " Nem befektetési tanácsadás; a rendszer nem ad le megbízást.";
}

/* ---------- SVG-chartok ---------- */
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs) { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; }

function lineChart(points, opts = {}) {
  const W = 640, H = opts.height || 200, P = { l: 40, r: 12, t: 12, b: 24 };
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": opts.label || "chart" });
  if (!points.length) return h("p", { class: "empty", text: "Még nincs adat." });
  const ys = points.map((p) => p.y).concat([0]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const x = (i) => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (points.length - 1));
  const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo);
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    svg.append(s("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: "grid-line" }));
    const t = s("text", { x: P.l - 6, y: y(v) + 4, "text-anchor": "end" }); t.textContent = NF(1).format(v); svg.append(t);
  }
  svg.append(s("line", { x1: P.l, x2: W - P.r, y1: y(0), y2: y(0), class: "zero" }));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  svg.append(s("path", { d: `${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, class: "area" }));
  svg.append(s("path", { d, class: "line" }));
  const lbl = (i, anchor) => { const t = s("text", { x: x(i), y: H - 6, "text-anchor": anchor }); t.textContent = points[i].x; svg.append(t); };
  lbl(0, "start"); if (points.length > 1) lbl(points.length - 1, "end");
  return svg;
}

function barList(items) {
  /* items: [{label, value}] – vízszintes sávok, előjeles értékkel */
  const W = 640, row = 24, H = items.length * row + 8, L = 230;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "szűrő-kombinációk" });
  const m = Math.max(0.01, ...items.map((i) => Math.abs(i.value)));
  const mid = L + (W - L - 50) / 2, half = (W - L - 50) / 2;
  items.forEach((it, k) => {
    const yy = 4 + k * row;
    const t = s("text", { x: 0, y: yy + 15 }); t.textContent = it.label; svg.append(t);
    const w = (Math.abs(it.value) / m) * half;
    svg.append(s("rect", { x: it.value >= 0 ? mid : mid - w, y: yy + 4, width: Math.max(1, w), height: 14, rx: 3, class: it.value >= 0 ? "bar-pos" : "bar-neg" }));
    const v = s("text", { x: W - 4, y: yy + 15, "text-anchor": "end" }); v.textContent = NF(2).format(it.value) + "R"; svg.append(v);
  });
  svg.append(s("line", { x1: mid, x2: mid, y1: 0, y2: H, class: "zero" }));
  return svg;
}

function table(cols, rows) {
  return h("div", { class: "tbl" }, h("table", {},
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.r ? "r" : "", text: c.t })))),
    h("tbody", {}, rows.map((r) => h("tr", {}, cols.map((c) => { const v = c.f(r); return h("td", { class: (c.r ? "r " : "") + (c.cls ? c.cls(r) : "") }, v); }))))));
}

/* ---------- Áttekintés ---------- */
const STATUS = { waiting: ["várakozik", ""], active: ["aktív jel", "on"], closed: ["lezárva", "warn"] };
const FILTER_LABEL = { volume: "forgalom", vwap: "VWAP", trend: "trend", gap: "rés" };

function orbCard(d) {
  const live = d.orb && d.orb.live;
  const st = d.orb.settings;
  const kids = [];
  if (!live || !Object.keys(live.instruments || {}).length) {
    kids.push(h("p", { class: "empty", text: "Még nincs ORB-futás. Napok: " + st.weekdays.join(", ") + "." }));
  } else {
    kids.push(h("p", { class: "muted", text: `${live.day} · sáv ${st.range_minutes} perc · ${st.breakout_bar_minutes} perces gyertya · célok ${st.targets_r.join("R, ")}R` }));
    for (const [name, x] of Object.entries(live.instruments)) {
      const done = live.completed || live.eod_done;
      const [label, cls] = x.status === "waiting" && done ? ["nem volt jel", ""] : (STATUS[x.status] || [x.status, ""]);
      const box = h("div", { class: "inst" }, h("div", { class: "inst-head" }, h("span", { text: name }), h("span", { class: "badge " + cls, text: label })));
      const sig = x.signal;
      if (sig) {
        box.append(h("div", { class: "levels" },
          h("div", {}, h("span", { text: "belépő" }), h("b", { text: fmt(sig.entry) })),
          h("div", {}, h("span", { text: "stop" }), h("b", { class: "down", text: fmt(sig.stop) })),
          ...(sig.targets || []).map((t, i) => h("div", {}, h("span", { text: `${st.targets_r[i]}R cél` + ((x.targets_hit || []).includes(i) ? " ✓" : "") }), h("b", { class: "up", text: fmt(t) })))));
        box.append(h("div", { class: "chips mt8" }, Object.entries(sig.filters || {}).map(([k, v]) => h("span", { class: "badge " + (v ? "on" : "off"), text: (FILTER_LABEL[k] || k) + (v ? " ✓" : " ✗") }))));
        if (sig.late) box.append(h("p", { class: "muted", text: "⏱ késve észlelt jel" }));
      } else if (x.range_signal_price) {
        box.append(h("p", { class: "muted", text: `Sáv (jelforrás árában): ${fmt(x.range_signal_price.low)} – ${fmt(x.range_signal_price.high)}. Még nincs jel.` }));
      }
      if (x.exit) box.append(h("p", {}, "Kimenet: ", h("b", { text: x.exit.type }), " · ", h("b", { class: signCls(x.exit.r), text: fmt(x.exit.r) + "R" })));
      kids.push(box);
    }
  }
  const rows = (d.orb.days || []).slice(-6).reverse();
  if (rows.length) {
    kids.push(h("h3", { text: "Legutóbbi napok" }));
    kids.push(table([
      { t: "nap", f: (r) => r.date }, { t: "eszköz", f: (r) => r.instrument },
      { t: "jel", f: (r) => (r.signal ? "igen" : "–") }, { t: "kimenet", f: (r) => r.exit || (r.raw_exit ? "(szűrt)" : "–") },
      { t: "R", r: 1, f: (r) => (r.signal ? fmt(r.r) : "–"), cls: (r) => signCls(r.r) }], rows));
  }
  return card(["Napi ORB", h("span", { class: "badge", text: "CSPX · CNDX" })], ...kids);
}

function longtermCard(lt) {
  if (!lt) return card("Hosszú táv (TBSZ)", h("p", { class: "empty", text: "Még nincs elemzés." }));
  const i = lt.indicators;
  const bands = h("div", { class: "bands" }, lt.bands.map((b, k) => h("span", { class: k === lt.band_index ? "cur" : "" })));
  const labels = h("div", { class: "band-labels" }, lt.bands.map((b) => h("span", { text: `${b.from}${b.to === null ? "%+" : "–" + b.to + "%"} · ${fmt(b.multiplier, 2)}×` })));
  const tb = lt.tbsz.map((t) => h("p", { class: "muted tight" }, `${t.name} (gyűjtési év ${t.collection_year}): `,
    h("span", { class: "badge " + (t.open_for_deposits ? "on" : "off"), text: t.open_for_deposits ? `befizethető még ${t.days_left} napig` : "gyűjtési év lezárult" })));
  return card([`${lt.name}`, h("span", { class: "badge", text: lt.symbol })],
    h("div", { class: "kpis" },
      kpi("záró", fmt(i.close) + " " + (i.currency || "")),
      kpi("visszaesés a csúcstól", "−" + fmt(i.drawdown_from_peak_pct) + "%", i.drawdown_from_peak_pct >= 5 ? "down" : ""),
      kpi("befizetési szorzó", fmt(i.multiplier, 2) + "×"),
      kpi("heti RSI", fmt(i.weekly_rsi, 1)),
      kpi("1 hó", pct(i.change_1m_pct), signCls(i.change_1m_pct)),
      kpi("1 év", pct(i.change_1y_pct), signCls(i.change_1y_pct))),
    h("h3", { text: "Visszaesési sáv" }), bands, labels,
    h("p", { class: "muted", text: `Trend: ${i.trend || "–"} · SMA50 ${pct(i.close_vs_sma50_pct)} · SMA200 ${pct(i.close_vs_sma200_pct)} · vol20 ${fmt(i.vol20_ann_pct, 1)}% · csúcs ${fmt(i.peak)} (${i.peak_date})` }),
    h("p", { class: "muted", text: `Következő befizetés: ${lt.next_deposit_date}` }), ...tb);
}

function watchCard(w) {
  const rows = [].concat((w.stocks || {}).rows || [], (w.crypto || {}).rows || []);
  if (!rows.length) return card("Figyelőlista", h("p", { class: "empty", text: "Még nincs áttekintő." }));
  return card("Figyelőlista", table([
    { t: "ticker", f: (r) => h("a", { href: "#/elemzes?t=" + encodeURIComponent(r.symbol), text: r.symbol }) },
    { t: "záró", r: 1, f: (r) => fmt(r.close) }, { t: "1 nap", r: 1, f: (r) => pct(r.chg1d), cls: (r) => signCls(r.chg1d) },
    { t: "RSI", r: 1, f: (r) => fmt(r.rsi14, 1) }, { t: ">SMA50", f: (r) => yesNo(r.above_sma50) },
    { t: ">SMA200", f: (r) => yesNo(r.above_sma200) }, { t: "setup", f: (r) => r.error ? "adathiba" : (r.setups || "–") }], rows),
    h("p", { class: "muted", text: "A tickerre koppintva egyszeri elemzést indíthatsz." }));
}

function recentCard(reports) {
  const list = h("ul", { class: "list" }, reports.slice(0, 6).map(reportItem));
  return card(["Legutóbbi riportok", h("a", { href: "#/riportok", text: "mind →" })], reports.length ? list : h("p", { class: "empty", text: "Még nincs riport." }));
}

function reportItem(r) {
  return h("li", {}, h("a", { href: "#/r/" + r.path },
    r.img ? h("img", { class: "thumb", src: r.img, alt: "", loading: "lazy" }) : h("div", { class: "thumb" }),
    h("div", {}, h("div", { text: r.title }), h("div", { class: "meta", text: `${r.kind_label} · ${r.date}` }))));
}

function renderOverview() {
  const d = S.data;
  view().replaceChildren(h("div", { class: "grid" }, orbCard(d), longtermCard(d.longterm), watchCard(d.watchlist || {}), recentCard(d.reports || [])));
}

/* ---------- Riportok ---------- */
function renderReports() {
  const all = S.data.reports || [];
  const kinds = [...new Map(all.map((r) => [r.kind, r.kind_label])).entries()];
  const q = S.reportQuery.toLowerCase();
  const items = all.filter((r) => (S.reportFilter === "all" || r.kind === S.reportFilter) && (!q || (r.title + " " + r.date).toLowerCase().includes(q)));
  const chips = h("div", { class: "chips" }, [["all", "Mind"], ...kinds].map(([k, l]) =>
    h("button", { type: "button", class: "chip" + (S.reportFilter === k ? " active" : ""), text: l, onclick: () => { S.reportFilter = k; renderReports(); } })));
  const search = h("input", { type: "search", placeholder: "Keresés (ticker, dátum, cím)…", value: S.reportQuery, "aria-label": "Keresés" });
  search.addEventListener("input", (e) => { S.reportQuery = e.target.value; const pos = e.target.selectionStart; renderReports(); const n = document.querySelector("input[type=search]"); n.focus(); n.setSelectionRange(pos, pos); });
  const groups = [];
  let cur = null;
  for (const r of items) {
    if (r.date !== cur) { cur = r.date; groups.push(h("div", { class: "date-h", text: r.date })); groups.push(h("ul", { class: "list" })); }
    groups[groups.length - 1].append(reportItem(r));
  }
  view().replaceChildren(h("section", { class: "card" }, h("div", { class: "toolbar" }, search), chips,
    items.length ? h("div", {}, groups) : h("p", { class: "empty", text: "Nincs találat." })));
}

async function renderReport(path) {
  const meta = (S.data.reports || []).find((r) => r.path === path);
  if (!meta || !/^r\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\.html$/.test(path)) { view().replaceChildren(card("Nem található", h("a", { href: "#/riportok", text: "← vissza" }))); return; }
  const r = await fetch(path);
  const body = h("div", { class: "report" });
  body.innerHTML = r.ok ? await r.text() : "<p>A riport nem tölthető be.</p>"; /* safemd-vel renderelt, escape-elt HTML */
  view().replaceChildren(h("section", { class: "card report" }, h("a", { href: "#/riportok", text: "← riportok" }),
    h("h1", { text: meta.title }), h("p", { class: "muted", text: `${meta.kind_label} · ${meta.date}` }), body));
  window.scrollTo(0, 0);
}

/* ---------- Statisztika ---------- */
function renderStats() {
  const d = S.data, st = d.stats, o = d.orb;
  const out = [];
  const curve = (o.curve || []).map((p) => ({ x: p.date, y: p.cum }));
  const sig = (o.days || []).filter((r) => r.signal && typeof r.r === "number");
  const wins = sig.filter((r) => r.r > 0).length;
  out.push(card("Élő ORB-jelek (napló)", h("div", { class: "kpis" },
    kpi("jelek", String(sig.length)), kpi("találati arány", sig.length ? fmt((100 * wins) / sig.length, 1) + "%" : "–"),
    kpi("átlag R", sig.length ? fmt(sig.reduce((a, r) => a + r.r, 0) / sig.length) : "–"),
    kpi("össz R", sig.length ? fmt(sig.reduce((a, r) => a + r.r, 0)) : "–")),
    h("h3", { text: "Kumulált R" }), lineChart(curve, { label: "kumulált R" })));
  if (st) {
    const combos = (st.filter_combos || []).slice(0, 16);
    const f = st.forecasts || {};
    out.push(card(["Heti statisztika", h("span", { class: "muted", text: `${st.since} – ${st.updated}` })],
      h("div", { class: "kpis" },
        kpi("előrejelzés iránytalálat", f.direction_hit_rate_pct == null ? "–" : fmt(f.direction_hit_rate_pct, 1) + "%"),
        kpi("kiértékelt előrejelzés", String(f.evaluated ?? 0)), kpi("Brier", f.mean_brier == null ? "–" : fmt(f.mean_brier, 3)),
        kpi("ORB átlag R 95% CI", st.orb.ci95_avg_r ? st.orb.ci95_avg_r.map((v) => fmt(v)).join(" … ") : "kevés adat")),
      h("h3", { text: "Szűrő-kombinációk (első kitörés átlag R-je)" }),
      combos.length ? barList(combos.map((c) => ({ label: `${c.filters} (n=${c.n})`, value: c.avg_r }))) : h("p", { class: "empty", text: "Még kevés kitörés a naplóban." }),
      h("p", { class: "muted", text: "Kis mintán a különbségek nagy része véletlen lehet." })));
  }
  if (d.backtest) {
    const bt = h("div", { class: "report" });
    bt.innerHTML = d.backtest.html; /* safemd-vel renderelt */
    out.push(card(["Backtest", h("span", { class: "muted", text: d.backtest.date })],
      lineChart((d.backtest.curve || []).map((p) => ({ x: p.date, y: p.cum })), { label: "backtest kumulált R" }),
      h("details", {}, h("summary", { text: "Részletek" }), bt)));
  }
  view().replaceChildren(h("div", { class: "grid" }, out));
}

/* ---------- Elemzés indítása (GitHub workflow_dispatch) ---------- */
const STORE_KEYS = ["pf_repo", "pf_token"];
function getCred() {
  const g = (k) => localStorage.getItem(k) || sessionStorage.getItem(k) || "";
  try { return { repo: g("pf_repo"), token: g("pf_token") }; } catch { return { repo: "", token: "" }; }
}
function setCred(repo, token, remember) {
  try {
    for (const k of STORE_KEYS) { localStorage.removeItem(k); sessionStorage.removeItem(k); }
    const st = remember ? localStorage : sessionStorage;
    st.setItem("pf_repo", repo); st.setItem("pf_token", token);
  } catch { /* privát mód: csak memóriában */ }
}

async function gh(method, path, token, body) {
  const r = await fetch("https://api.github.com" + path, {
    method, headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, referrerPolicy: "no-referrer", cache: "no-store",
  });
  if (!r.ok && r.status !== 204) {
    let msg = "HTTP " + r.status;
    try { msg += ": " + (await r.json()).message; } catch { /* nincs JSON */ }
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}

function renderRun(prefill) {
  const cred = getCred();
  const status = h("div", { class: "status", hidden: true });
  const show = (msg, cls, link) => { status.hidden = false; status.className = "status " + (cls || ""); status.replaceChildren(msg, link ? h("span", {}, " ", h("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: "megnyitás a GitHubon" })) : ""); };
  const repo = h("input", { type: "text", placeholder: "felhasználó/privát-repó", value: cred.repo, autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const token = h("input", { type: "password", placeholder: "github_pat_…", value: cred.token, autocomplete: "off" });
  let remembered = false;
  try { remembered = !!localStorage.getItem("pf_token"); } catch { /* privát mód */ }
  const remember = h("input", { type: "checkbox", checked: remembered || !cred.token });
  const ticker = h("input", { type: "text", placeholder: "pl. BTC-USD, NVDA, VWCE.DE", value: prefill || "", autocapitalize: "characters", spellcheck: "false" });
  const symbols = [].concat(((S.data.watchlist || {}).stocks || {}).rows || [], ((S.data.watchlist || {}).crypto || {}).rows || []).map((r) => r.symbol);
  const btn = h("button", { class: "btn", type: "button", text: "Elemzés indítása" });

  btn.addEventListener("click", async () => {
    const t = ticker.value.trim().toUpperCase();
    const rp = repo.value.trim();
    if (!/^[A-Z0-9.^=\-]{1,20}$/.test(t)) return show("Érvénytelen ticker (Yahoo-formátum, pl. BTC-USD, VWCE.DE).", "err");
    if (!/^[\w.-]+\/[\w.-]+$/.test(rp)) return show("Add meg a privát repót felhasználó/név alakban.", "err");
    if (!token.value.trim()) return show("Add meg a GitHub-tokent (lásd lent).", "err");
    setCred(rp, token.value.trim(), remember.checked);
    btn.disabled = true;
    try {
      const started = new Date(Date.now() - 5000).toISOString();
      await gh("POST", `/repos/${rp}/actions/workflows/analyze.yml/dispatches`, token.value.trim(), { ref: "main", inputs: { ticker: t } });
      show(`Elindítva: ${t}. Várakozás a futásra…`);
      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 8000));
        const runs = await gh("GET", `/repos/${rp}/actions/workflows/analyze.yml/runs?event=workflow_dispatch&per_page=5&created=>=${encodeURIComponent(started)}`, token.value.trim());
        const run = runs && runs.workflow_runs && runs.workflow_runs[0];
        if (!run) { show(`${t}: sorban áll…`); continue; }
        if (run.status !== "completed") { show(`${t}: ${run.status === "in_progress" ? "fut" : "sorban áll"}…`, "", run.html_url); continue; }
        if (run.conclusion === "success") { show(`${t}: kész. Az ntfy-értesítés megérkezett; a riport 1–2 percen belül a Riportok fülön is látszik.`, "ok", run.html_url); }
        else { show(`${t}: a futás nem sikerült (${run.conclusion}).`, "err", run.html_url); }
        break;
      }
    } catch (e) {
      show("Hiba: " + e.message + (String(e.message).includes("401") || String(e.message).includes("403") ? " – ellenőrizd a tokent és a jogosultságát." : ""), "err");
    } finally { btn.disabled = false; }
  });

  const forget = h("button", { class: "btn secondary", type: "button", text: "Token törlése erről az eszközről", onclick: () => { setCred("", "", false); try { sessionStorage.clear(); } catch { /* */ } token.value = ""; show("A token törölve."); } });

  view().replaceChildren(h("div", { class: "grid" },
    card("Egyszeri elemzés indítása",
      h("label", { class: "field" }, "Ticker", ticker),
      symbols.length ? h("div", { class: "chips" }, symbols.map((sy) => h("button", { type: "button", class: "chip", text: sy, onclick: () => { ticker.value = sy; } }))) : null,
      h("div", { class: "row mt14" }, btn), status,
      h("p", { class: "muted", text: "A futás a privát repóban történik (GitHub Actions). Az eredmény ntfy-értesítésként és itt, a Riportok fülön jelenik meg." })),
    card("Beállítás ezen az eszközön",
      h("label", { class: "field" }, "Privát repó", repo),
      h("label", { class: "field" }, "GitHub-token (fine-grained)", token),
      h("label", { class: "check" }, remember, "Megjegyzés ezen az eszközön (különben a böngésző bezárásáig)"),
      forget,
      h("details", {}, h("summary", { text: "Hogyan kapok tokent?" }), h("ol", {},
        h("li", { text: "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token." }),
        h("li", { text: "Repository access: Only select repositories → csak a privát piacfigyelő repó." }),
        h("li", { text: "Permissions → Repository → Actions: Read and write (más jog nem kell)." }),
        h("li", { text: "Lejárat: pl. 90 nap. A tokent csak ez a böngésző tárolja; a nyilvános oldal kódja nem látja a privát repót." }))))));
}

/* ---------- útválasztás ---------- */
async function route() {
  if (!S.data) { try { await load(false); } catch (e) { view().replaceChildren(card("Hiba", h("p", { text: "Az adatok nem tölthetők be: " + e.message }))); return; } }
  const hash = location.hash.replace(/^#\/?/, "") || "attekintes";
  const [page, query] = hash.split("?");
  const tab = page.startsWith("r/") ? "riportok" : page;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  if (page.startsWith("r/")) return renderReport(page.slice(2));
  if (page === "riportok") return renderReports();
  if (page === "statisztika") return renderStats();
  if (page === "elemzes") return renderRun(new URLSearchParams(query || "").get("t"));
  return renderOverview();
}

document.getElementById("refresh").addEventListener("click", async () => { await load(true); route(); });
window.addEventListener("hashchange", route);
route();
