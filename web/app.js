/* ClearCount web app — static, no backend. */
(() => {
  "use strict";
  const BASE_Y0 = 2003, BASE_Y1 = 2021, BLIND_HATCH = 0.6;
  const MONTHS = { en: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
                   ru: ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"],
                   kk: ["Қаң","Ақп","Нау","Сәу","Мам","Мау","Шіл","Там","Қыр","Қаз","Қар","Жел"] };
  const S = { mapMode: "month", lang: "en", mode: "responder", view: "pct", y0: 2001, y1: 2025, sel: null, aoi: null, preset: "kz" };
  const D = {};
  const $ = (id) => document.getElementById(id);
  const t = (k) => (I18N[S.lang] && I18N[S.lang][k]) || I18N.en[k] || k;
  const fmt = (x, d = 0) => (x == null || !isFinite(x)) ? "–" : x.toLocaleString(S.lang === "kk" ? "kk-KZ" : S.lang, { maximumFractionDigits: d, minimumFractionDigits: d });
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- color scales (colour-blind safe: blue ↔ grey ↔ orange) ----------
  const RAMP = ["#2b6cb0", "#7fb1d6", "#9aa3b0", "#f6a04d", "#e8590c"];
  const pctColor = d3.scaleLinear().domain([0, .25, .5, .75, 1]).range(RAMP).interpolate(d3.interpolateRgb).clamp(true);
  const anomColor = d3.scaleLinear().domain([-1, -.5, 0, 1, 2]).range(RAMP).clamp(true);
  let absColor = d3.scaleSequentialLog(d3.interpolateInferno).domain([1, 1000]);
  const ZERO_COLOR = () => (document.documentElement.dataset.theme === "light" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: light)").matches)) ? "#e9e4db" : "#1a2333";

  // ---------- helpers on month indices ----------
  const ym = (i) => { const mi = D.meta.m0 + i; return [2000 + Math.floor(mi / 12), mi % 12]; };
  const idxOf = (y, m) => (y - 2000) * 12 + m - D.meta.m0;
  const label = (i) => { const [y, m] = ym(i); return `${MONTHS[S.lang][m]} ${y}`; };

  // ---------- data loading ----------
  async function loadAll() {
    // build stamp (never cached) also versions all data requests, so daily updates reach every visitor
    D.build = await fetch("data/build.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const DV = (D.build && D.build.build) || (document.querySelector('script[src^="app.js"]') || {}).src?.split("v=")[1] || "1";
    const get = (f) => fetch("data/" + f + "?v=" + DV).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    const [cells, blind, nat, ev, val, flares, pidx] = await Promise.all([
      get("cells.json"), get("blind.json"), get("national.json"), get("events.json"),
      get("validation.json"), get("flares.json"), get("points_index.json")]);
    D.drift = await get("drift.json").catch(() => null);
    D.wx = await get("weather.json").catch(() => null);
    D.ml = await get("ml.json").catch(() => null);
    D.passes = await get("case_overpass.json").catch(() => null);
    D.lc = await get("landcover.json").catch(() => null);
    D.burned = await get("burned.json").catch(() => null);
    D.transfer = await get("transfer.json").catch(() => null);
    D.unc = await get("uncertainty.json").catch(() => null);
    D.trends = await get("trends.json").catch(() => null);
    D.regimes = await get("regimes.json").catch(() => null);
    D.regions = await get("regions.json").catch(() => null);
    D.bc = await get("blind_correction.json").catch(() => null);
    D.meta = cells.meta; D.n = cells.meta.n_months;
    D.cLat = Float32Array.from(cells.cells, (c) => c[0]);
    D.cLon = Float32Array.from(cells.cells, (c) => c[1]);
    D.cells = cells.cells;
    D.blind = blind; D.nat = nat; D.events = ev; D.val = val; D.flares = flares; D.pidx = pidx;
  }

  // ---------- AOI ----------
  function inAOI(lat, lon) {
    const a = S.aoi;
    if (a.type === "bbox") return lat >= a.b[0] && lat <= a.b[2] && lon >= a.b[1] && lon <= a.b[3];
    // polygon ray casting, ring = [[lat,lon],...]
    let inside = false; const r = a.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [yi, xi] = r[i], [yj, xj] = r[j];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function aoiBounds() {
    const a = S.aoi;
    if (a.type === "bbox") return a.b;
    const la = a.ring.map((p) => p[0]), lo = a.ring.map((p) => p[1]);
    return [Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo)];
  }

  function aggregate() {
    const n = D.n, H = new Float64Array(n), R = new Float64Array(n), sel = [];
    const g = D.meta.grid / 2;
    for (let k = 0; k < D.cells.length; k++) {
      const la = D.cLat[k], lo = D.cLon[k];
      // a cell counts if its centre is inside, or (for small AOIs) the AOI centre is inside the cell
      if (!inAOI(la, lo)) continue;
      sel.push(k);
      const [, , ms, hs, rs] = D.cells[k];
      for (let q = 0; q < ms.length; q++) { H[ms[q]] += hs[q]; R[ms[q]] += rs[q]; }
    }
    if (!sel.length) { // tiny AOI: take the cell containing the AOI centre
      const b = aoiBounds(), cla = (b[0] + b[2]) / 2, clo = (b[1] + b[3]) / 2;
      for (let k = 0; k < D.cells.length; k++) if (Math.abs(D.cLat[k] - cla) <= g && Math.abs(D.cLon[k] - clo) <= g) {
        sel.push(k); const [, , ms, hs, rs] = D.cells[k];
        for (let q = 0; q < ms.length; q++) { H[ms[q]] += hs[q]; R[ms[q]] += rs[q]; }
      }
    }
    // blindness: mean over 1° cells intersecting the AOI bbox
    const b = aoiBounds(), B = new Float64Array(n), Bn = new Float64Array(n);
    let used = D.blind.cells.filter(([la, lo]) => la + .5 >= b[0] && la - .5 <= b[2] && lo + .5 >= b[1] && lo - .5 <= b[3]);
    if (!used.length) {
      const cla = (b[0] + b[2]) / 2, clo = (b[1] + b[3]) / 2;
      used = [D.blind.cells.reduce((best, c) => (Math.hypot(c[0] - cla, c[1] - clo) < Math.hypot(best[0] - cla, best[1] - clo) ? c : best))];
    }
    for (const [, , fr] of used) for (let i = 0; i < n; i++) if (fr[i] >= 0) { B[i] += fr[i]; Bn[i]++; }
    for (let i = 0; i < n; i++) B[i] = Bn[i] ? B[i] / Bn[i] : NaN;
    // baselines by calendar month
    const base = Array.from({ length: 12 }, () => []);
    for (let y = BASE_Y0; y <= BASE_Y1; y++) for (let m = 0; m < 12; m++) { const i = idxOf(y, m); if (i >= 0 && i < n) base[m].push(H[i]); }
    base.forEach((a) => a.sort((x, y) => x - y));
    const med = base.map((a) => d3.median(a)), mean = base.map((a) => d3.mean(a));
    const HID = new Float64Array(n);
    if (D.bc) { const bb = aoiBounds(); const ok = D.bc.cells.map(([la, lo]) => la + .5 >= bb[0] && la - .5 <= bb[2] && lo + .5 >= bb[1] && lo - .5 <= bb[3]);
      if (!ok.some(Boolean)) { const cla = (bb[0] + bb[2]) / 2, clo = (bb[1] + bb[3]) / 2; let best = 0, bd = 1e9; D.bc.cells.forEach(([la, lo], k) => { const d = Math.hypot(la - cla, lo - clo); if (d < bd) { bd = d; best = k; } }); ok[best] = true; }
      // scale 1-degree estimates to the AOI share of each cell's activity is not available; use whole overlapping cells (noted in UI)
      D.bc.cell_month.forEach(([c, m, h]) => { if (ok[c] && m >= 0 && m < n) HID[m] += h; }); }
    D.agg = { H, R, B, base, med, mean, sel, nBlindCells: used.length, HID };
  }
  function pctRank(v, m) {
    const a = D.agg.base[m]; if (!a.length) return NaN;
    let lt = 0, eq = 0; for (const x of a) { if (x < v - 1e-9) lt++; else if (Math.abs(x - v) <= 1e-9) eq++; }
    return (lt + .5 * eq) / a.length;
  }

  // ---------- rendering: now card ----------
  function renderNow() {
    const i = S.sel, [y, m] = ym(i), A = D.agg, v = A.H[i], md = A.med[m], p = pctRank(v, m), blind = A.B[i];
    $("nowMonth").textContent = label(i);
    const ratio = md > 0 ? v / md : null;
    $("nowX").innerHTML = ratio != null ? `${fmt(ratio, ratio < 10 ? 1 : 0)}<small> ${t("x_median")}</small>` : `${fmt(v, 0)}<small> hotspots</small>`;
    const ci = D.unc && D.unc.lo[i] != null && D.unc.hi[i] - D.unc.lo[i] > 1e-4 ? ` (95%: ${fmt(v * D.unc.lo[i], 0)}–${fmt(v * D.unc.hi[i], 0)})` : "";
    $("nowLabel").textContent = `${fmt(v, 0)}${ci} harmonized hotspots · median ${fmt(md, 0)} · mean ${fmt(A.mean[m], 0)}`;
    $("nowGauge").style.left = `${(isFinite(p) ? p : .5) * 100}%`;
    const state = p >= .9 ? t("above") : p <= .25 ? t("below") : t("normal");
    const st = $("nowState"); st.textContent = `${state} · ${t("percentile")} ${fmt(p * 100, 0)}`;
    st.style.color = p >= .9 ? "var(--ember-2)" : p <= .25 ? "var(--sky)" : "var(--muted)";
    const c = $("nowConf"); const isBlind = blind >= BLIND_HATCH;
    c.textContent = isFinite(blind) ? `${isBlind ? "☁ " + t("conf_low") : "☀ " + t("conf_high")} · ${fmt(blind * 100, 0)}% cloudy days` : "☁ cloud data pending (NASA CERES ~3-month lag)";
    c.className = "pill" + (isBlind ? " warn" : "");
    $("nowDetail").textContent = `raw FIRMS sum: ${fmt(A.R[i], 0)} detections → harmonized: ${fmt(v, 1)}`;
    if (D.bc && isFinite(A.HID[i]) && A.HID[i] > .5) $("nowDetail").textContent += ` · ☁ est. hidden by clouds: +${fmt(A.HID[i], 0)}`;
        const o = outlook(); $("nowOutlook").innerHTML = o ? `📈 <b>Season so far</b> (Jan–${MONTHS[S.lang][o.M]} ${o.Y}): percentile <b>${fmt(o.pNow * 100, 0)}</b> of ${BASE_Y0}–${BASE_Y1}. Of the ${o.analogs.length} years with the most similar start (${o.analogs.join(", ")}), <b>${o.above.length}</b> ended the year above the median → outlook: <b style="color:${o.above.length >= 4 ? "var(--ember-2)" : o.above.length <= 2 ? "var(--sky)" : "var(--muted)"}">${o.above.length >= 4 ? "likely above normal" : o.above.length <= 2 ? "likely below normal" : "uncertain"}</b>.` : "";
    const al = $("alertBanner");
    if (isBlind && p < .5) { al.hidden = false; al.innerHTML = `☁ <b>Possibly blind.</b>&nbsp;${fmt(blind * 100, 0)}% of days this month were cloud-covered over this area — a low hotspot count here may mean "the satellites could not see", not "no fire". Check the day-by-day view.`; }
    else if (p >= .9) { al.hidden = false; al.innerHTML = `🔥 <b>Unusual activity.</b>&nbsp;${p >= .99 ? `Higher than every ${MONTHS[S.lang][m]} in ${BASE_Y0}–${BASE_Y1}` : `Higher than ${fmt(p * 100, 0)}% of ${MONTHS[S.lang][m]}s in ${BASE_Y0}–${BASE_Y1}`} (${ratio != null ? fmt(ratio, 1) + " × median" : fmt(v, 0) + " hotspots"}).`; }
    else al.hidden = true;
  }

  // ---------- calendar ----------
  function cellValue(i) {
    const [, m] = ym(i), v = D.agg.H[i];
    if (S.view === "abs") return { v, c: v > 0 ? absColor(Math.max(1, v)) : ZERO_COLOR() };
    if (S.view === "anom") { const mu = D.agg.mean[m]; const a = mu > 0 ? (v - mu) / mu : (v > 0 ? 2 : 0); return { v: a, c: (v === 0 && !(mu > 0)) ? ZERO_COLOR() : anomColor(a) }; }
    const p = pctRank(v, m); const zero = v === 0 && D.agg.med[m] === 0;
    return { v: p, c: zero ? ZERO_COLOR() : pctColor(p) };
  }
  function renderCalendar() {
    const years = d3.range(S.y0, S.y1 + 1), L = 40, T = 46, Rm = 52, ch = 22;
    const avail = ($("calendar").clientWidth || 640) - L - Rm;
    const cw = Math.max(16, Math.min(34, Math.floor(avail / years.length)));
    const W = L + years.length * cw + Rm, Hh = T + 12 * ch + 30;
    const A = D.agg; const maxH = d3.max(A.H) || 1;
    absColor = d3.scaleSequentialLog(d3.interpolateInferno).domain([1, Math.max(10, d3.quantile(Array.from(A.H).filter((x) => x > 0).sort(d3.ascending), .98) || 10)]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${Hh}`).attr("width", W).attr("height", Hh).attr("role", "grid").attr("aria-label", t("cal_title"));
    svg.append("defs").html(`<pattern id="hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,.55)" stroke-width="1.6"/></pattern>`);
    // annual totals mini-bars
    const yTot = years.map((y) => d3.sum(d3.range(12), (m) => { const i = idxOf(y, m); return i >= 0 && i < D.n ? A.H[i] : 0; }));
    const yb = d3.scaleLinear().domain([0, d3.max(yTot) || 1]).range([0, 28]);
    svg.append("g").selectAll("rect").data(years).join("rect").attr("x", (d, k) => L + k * cw + 4).attr("width", cw - 8)
      .attr("y", (d, k) => T - 8 - yb(yTot[k])).attr("height", (d, k) => yb(yTot[k])).attr("rx", 2).attr("fill", css("--ember")).attr("opacity", .75)
      .append("title").text((d, k) => `${d}: ${fmt(yTot[k], 0)} harmonized hotspots`);
    // sensor era marks
    const era = [[2000, "Terra"], [2002.5, "Aqua"], [2012, "VIIRS"]];
    // month labels
    svg.append("g").selectAll("text").data(MONTHS[S.lang]).join("text").attr("x", L - 8).attr("y", (d, m) => T + m * ch + ch / 2 + 4).attr("text-anchor", "end").text((d) => d);
    // year labels
    svg.append("g").selectAll("text").data(years).join("text").attr("class", "yr")
      .attr("transform", (d, k) => `translate(${L + k * cw + cw / 2},${T + 12 * ch + 14}) rotate(-50)`).attr("text-anchor", "end").attr("font-size", 10).text((d) => (years.length > 16 ? `'${String(d).slice(2)}` : d));
    // cells
    const cells = [];
    years.forEach((y, k) => d3.range(12).forEach((m) => { const i = idxOf(y, m); if (i >= 0 && i < D.n) cells.push({ i, k, m, y }); }));
    const g = svg.append("g");
    g.selectAll("rect.c").data(cells).join("rect").attr("class", (d) => "c" + (d.i === S.sel ? " sel" : ""))
      .attr("x", (d) => L + d.k * cw + 1).attr("y", (d) => T + d.m * ch + 1).attr("width", cw - 2).attr("height", ch - 2).attr("rx", 4)
      .attr("fill", (d) => cellValue(d.i).c).attr("tabindex", (d) => (d.i === S.sel ? 0 : -1)).attr("role", "gridcell")
      .attr("aria-label", (d) => ariaFor(d.i))
      .on("mousemove", (e, d) => showTip(e, tipHtml(d.i))).on("mouseleave", hideTip)
      .on("click", (e, d) => select(d.i)).on("keydown", (e, d) => calKey(e, d));
    g.selectAll("rect.h").data(cells.filter((d) => A.B[d.i] >= BLIND_HATCH)).join("rect").attr("class", "h").attr("pointer-events", "none")
      .attr("x", (d) => L + d.k * cw + 1).attr("y", (d) => T + d.m * ch + 1).attr("width", cw - 2).attr("height", ch - 2).attr("rx", 4).attr("fill", "url(#hatch)");
    // sensor-era ticks
    const ex = (yr) => L + (yr - S.y0) * cw;
    [[2002.5, "Aqua"], [2012, "VIIRS S-NPP"], [2018.25, "NOAA-20"]].forEach(([yr, name]) => {
      if (yr < S.y0 || yr > S.y1 + 1) return;
      svg.append("line").attr("x1", ex(yr)).attr("x2", ex(yr)).attr("y1", T - 4).attr("y2", T + 12 * ch).attr("stroke", css("--sky")).attr("stroke-dasharray", "2 3").attr("opacity", .55);
      svg.append("text").attr("x", ex(yr) + 3).attr("y", 10).attr("fill", css("--sky")).attr("font-size", 10).text(name);
    });
    // median column
    const mx = L + years.length * cw + 10;
    svg.append("text").attr("x", mx).attr("y", T - 6).attr("font-size", 10).text("median");
    svg.append("g").selectAll("text").data(A.med).join("text").attr("class", "mono").attr("x", mx).attr("y", (d, m) => T + m * ch + ch / 2 + 4).attr("font-size", 10).text((d) => fmt(d, d < 10 ? 1 : 0));
    $("calendar").replaceChildren(svg.node());
    renderLegend(); renderCalTable(years);
  }
  function ariaFor(i) { const [, m] = ym(i); return `${label(i)}: ${fmt(D.agg.H[i], 0)} hotspots, ${t("percentile")} ${fmt(pctRank(D.agg.H[i], m) * 100, 0)}${D.agg.B[i] >= BLIND_HATCH ? ", " + t("leg_blind") : ""}`; }
  function calKey(e, d) {
    const moves = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -12, ArrowRight: 12 };
    if (e.key === "Enter" || e.key === " ") { select(d.i); e.preventDefault(); return; }
    if (!(e.key in moves)) return;
    e.preventDefault(); const ni = Math.max(0, Math.min(D.n - 1, d.i + moves[e.key]));
    select(ni, true);
  }
  function renderLegend() {
    let ramp = "";
    if (S.view === "pct") ramp = `<span>${t("leg_below")}</span><span class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></span><span>${t("leg_above")}</span><span class="muted">(p0 · p50 · p100)</span>`;
    else if (S.view === "anom") ramp = `<span>−100%</span><span class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></span><span>+200%</span>`;
    else ramp = `<span>1</span><span class="ramp" style="background:linear-gradient(90deg,${d3.range(0, 1.01, .1).map((x) => d3.interpolateInferno(x)).join(",")})"></span><span>${fmt(absColor.domain()[1], 0)}+</span>`;
    $("calLegend").innerHTML = `${ramp}<span class="hatch" style="background:repeating-linear-gradient(45deg,#8d939d 0 2px,transparent 2px 5px)"></span><span>${t("leg_blind")} (≥${BLIND_HATCH * 100}% cloudy days)</span><span class="hatch" style="background:${ZERO_COLOR()}"></span><span>0</span>`;
  }
  function renderCalTable(years) {
    const A = D.agg; let h = `<table class="t mono"><thead><tr><th>Year</th>${MONTHS[S.lang].map((m) => `<th>${m}</th>`).join("")}<th>Σ</th></tr></thead><tbody>`;
    years.forEach((y) => { let s = 0; h += `<tr><td>${y}</td>`; for (let m = 0; m < 12; m++) { const i = idxOf(y, m); const v = i >= 0 && i < D.n ? A.H[i] : NaN; if (isFinite(v)) s += v; h += `<td>${isFinite(v) ? fmt(v, 0) : ""}${A.B[i] >= BLIND_HATCH ? "☁" : ""}</td>`; } h += `<td>${fmt(s, 0)}</td></tr>`; });
    $("calTable").innerHTML = h + "</tbody></table>";
  }
  function tipHtml(i) {
    const [, m] = ym(i), A = D.agg, v = A.H[i], p = pctRank(v, m), md = A.med[m];
    return `<b>${label(i)}</b><br>${fmt(v, 1)} harmonized hotspots<br>${t("percentile")}: <b>${fmt(p * 100, 0)}</b> · ${md > 0 ? fmt(v / md, 1) + " " + t("x_median") : "median 0"}<br>` +
      `<span class="muted">raw FIRMS: ${fmt(A.R[i], 0)} · cloudy days: ${isFinite(A.B[i]) ? fmt(A.B[i] * 100, 0) + "%" : "–"}</span>${A.B[i] >= BLIND_HATCH ? `<br>☁ <b>${t("leg_blind")}</b>` : ""}`;
  }
  const tip = () => $("tip");
  function showTip(e, html) { const el = tip(); el.innerHTML = html; el.style.opacity = 1; const x = Math.min(innerWidth - 300, e.clientX + 14); el.style.left = x + "px"; el.style.top = (e.clientY + 14) + "px"; }
  function hideTip() { tip().style.opacity = 0; }

  // ---------- raw vs harmonized chart ----------
  function lineChart(el, series, { yLabel = "", height = 230, log = false, marks = [] } = {}) {
    const W = el.clientWidth || 640, H = height, m = { l: 52, r: 14, t: 12, b: 26 };
    const allX = series.flatMap((s) => s.pts.map((p) => p[0])), allY = series.flatMap((s) => s.pts.map((p) => p[1]));
    const x = d3.scaleLinear().domain(d3.extent(allX)).range([m.l, W - m.r]);
    const y = (log ? d3.scaleSymlog().constant(10) : d3.scaleLinear()).domain([0, (d3.max(allY) || 1) * 1.08]).nice().range([H - m.b, m.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(Math.min(12, W / 60)).tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5, "~s"));
    marks.forEach(([xv, txt]) => { if (xv < x.domain()[0] || xv > x.domain()[1]) return; svg.append("line").attr("x1", x(xv)).attr("x2", x(xv)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--sky")).attr("stroke-dasharray", "3 3").attr("opacity", .6); svg.append("text").attr("x", x(xv) + 4).attr("y", m.t + 10).attr("fill", css("--sky")).attr("font-size", 10).text(txt); });
    series.filter((s) => s.band).forEach((s) => svg.append("path").datum(s.band).attr("fill", s.color).attr("opacity", .22).attr("d", d3.area().x((p) => x(p[0])).y0((p) => y(p[1])).y1((p) => y(p[2])).curve(d3.curveMonotoneX)));
    series.forEach((s) => {
      svg.append("path").datum(s.pts).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", s.w || 2).attr("stroke-dasharray", s.dash || null)
        .attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])).curve(d3.curveMonotoneX));
    });
    const lg = svg.append("g").attr("transform", `translate(${m.l + 8},${m.t + 6})`);
    series.forEach((s, k) => { const g = lg.append("g").attr("transform", `translate(0,${k * 16})`); g.append("line").attr("x2", 16).attr("y1", 5).attr("y2", 5).attr("stroke", s.color).attr("stroke-width", 2.5).attr("stroke-dasharray", s.dash || null); g.append("text").attr("x", 22).attr("y", 9).attr("fill", css("--text")).attr("font-size", 11).text(s.name); });
    if (yLabel) svg.append("text").attr("x", 6).attr("y", m.t + 2).attr("fill", css("--muted")).attr("font-size", 10).text(yLabel);
    el.replaceChildren(svg.node());
  }
  function renderRaw() {
    const A = D.agg, years = d3.range(Math.max(2001, S.y0), S.y1 + 1);
    const sumY = (arr, y) => d3.sum(d3.range(12), (m) => { const i = idxOf(y, m); return i >= 0 && i < D.n ? arr[i] : 0; });
    lineChart($("rawChart"), [
      { name: t("raw_series"), color: css("--faint"), pts: years.map((y) => [y, sumY(A.R, y)]), dash: "5 4" },
      { name: t("harm_series") + (D.unc ? " ± 95%" : ""), color: css("--ember"), w: 2.8, pts: years.map((y) => [y, sumY(A.H, y)]),
        band: D.unc ? years.map((y) => { let lo = 0, hi = 0; for (let m = 0; m < 12; m++) { const i = idxOf(y, m); if (i < 0 || i >= D.n) continue; lo += A.H[i] * (D.unc.lo[i] ?? 1); hi += A.H[i] * (D.unc.hi[i] ?? 1); } return [y, lo, hi]; }) : null },
      ...(D.bc ? [{ name: "ClearCount + est. hidden under clouds", color: css("--ember-2"), dash: "2 3", w: 1.8, pts: years.filter((y) => y <= 2025).map((y) => [y, sumY(A.H, y) + sumY(A.HID, y)]) }] : []),
    ], { yLabel: "hotspots / year", marks: [[2012, "VIIRS arrives"], [2018.25, "NOAA-20"]] });
  }
  function renderHood() {
    if (S.mode !== "scientist") return;
    const N = D.nat, years = d3.range(2001, 2000 + Math.floor((D.meta.m0 + D.n - 1) / 12) + 1);
    const sumY = (arr, y) => d3.sum(d3.range(12), (m) => { const i = idxOf(y, m); return i >= 0 && i < arr.length ? arr[i] : 0; });
    lineChart($("hoodChart"), [
      { name: "MODIS Terra", color: "#9aa3b0", pts: years.map((y) => [y, sumY(N.Terra, y)]) },
      { name: "MODIS Aqua", color: "#5ab0ff", pts: years.map((y) => [y, sumY(N.Aqua, y)]) },
      { name: "VIIRS S-NPP", color: "#b78cff", pts: years.filter((y) => y >= 2012).map((y) => [y, sumY(N.N, y)]) },
      { name: "VIIRS NOAA-20", color: "#4fd1a5", pts: years.filter((y) => y >= 2018).map((y) => [y, sumY(N.N20, y)]) },
      ...(N.N21 ? [{ name: "VIIRS NOAA-21", color: "#f472b6", pts: years.filter((y) => y >= 2023).map((y) => [y, sumY(N.N21, y)]) }] : []),
      { name: "ClearCount (S-NPP chain)", color: "#ff7a1a", w: 3, pts: years.map((y) => [y, sumY(N.harmonized, y)]) },
      { name: "ClearCount (NOAA-20 chain, 2024–25)", color: "#ffcc4d", dash: "4 3", pts: [2023, 2024, 2025].map((y) => [y, sumY(y >= 2024 ? N.harmonized_n20chain : N.harmonized, y)]) },
    ], { yLabel: "Kazakhstan, detections / year (log)", log: true, height: 280, marks: [[2012, "S-NPP"], [2018.25, "NOAA-20"], [2022, "Aqua drift"]] });
  }

  // ---------- day by day (points tiles + daily cloud, loaded on demand) ----------
  const cache = new Map();
  // .gz files are decompressed in the browser (works on any static host)
  // robust on any host: decompress only if the bytes really are gzip (some hosts decompress .gz themselves)
  const gunzipText = async (r) => {
    if (!r.ok) return "";
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b && typeof DecompressionStream !== "undefined")
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return new TextDecoder().decode(buf);
  };
  const fetchText = (u) => fetch(u).then((r) => (u.endsWith(".gz") ? gunzipText(r) : r.ok ? r.text() : ""));
  const getText = (u) => { if (!cache.has(u)) cache.set(u, fetchText(u)); return cache.get(u); };
  const getJSON = (u) => { if (!cache.has(u)) cache.set(u, fetchText(u).then((t) => (t ? JSON.parse(t) : null))); return cache.get(u); };
  let dayReq = 0;
  async function renderDaily(force) {
    const req = ++dayReq, el = $("dayChart"), b = aoiBounds(), [y, m] = ym(S.sel);
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    if (area > 80 && !force) { el.innerHTML = `<p class="muted">${t("day_big")} <button class="btn ghost" id="btnDay">${t("day_load")}</button></p>`; $("btnDay").onclick = () => renderDaily(true); $("dayText").textContent = ""; return; }
    el.innerHTML = `<p class="muted">…</p>`;
    const T = D.pidx.tile, urls = Object.entries(D.pidx.tiles).filter(([k, ys]) => { const [a, c] = k.split("_").map(Number); return ys.includes(y) && a + T >= b[0] && a <= b[2] && c + T >= b[1] && c <= b[3]; }).map(([k]) => `data/points/${k}_${y}.csv.gz`);
    const nd = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), H = new Float64Array(nd), Rw = new Float64Array(nd), F = new Float64Array(nd), dayPts = Array.from({ length: nd }, () => []);
    const pre = `${y}-${String(m + 1).padStart(2, "0")}-`, fireW = new Map();
    const [texts, cl, lk] = await Promise.all([Promise.all(urls.map(getText)), getJSON(`data/cloud/${y}.json.gz`), getJSON(`data/looks/${y}.json.gz`)]);
    if (req !== dayReq) return;
    for (const txt of texts) {
      let pos = txt.indexOf("\n") + 1;
      while (pos > 0 && pos < txt.length) {
        const end = txt.indexOf("\n", pos); const r = txt.slice(pos, end < 0 ? undefined : end); pos = end < 0 ? -1 : end + 1;
        if (!r || r.indexOf(pre) < 0) continue;
        const f = r.split(","); if (!inAOI(+f[0], +f[1])) continue;
        const d = +f[2].slice(8, 10) - 1;
        dayPts[d].push([+f[0], +f[1], f[9] === "landscape_fire", f[4]]);
        if (f[9] === "landscape_fire") { H[d] += +f[10]; Rw[d]++; const ck = `${Math.floor(+f[0]) + .5},${Math.floor(+f[1]) + .5}`; fireW.set(ck, (fireW.get(ck) || 0) + 1); } else F[d]++;
      }
    }
    // daily cloud (mean of 1-degree cells overlapping the AOI)
    const C = new Float64Array(nd).fill(NaN);
    if (cl) {
      let idx = cl.cells.map((c, k) => [c, k]).filter(([c]) => c[0] + .5 >= b[0] && c[0] - .5 <= b[2] && c[1] + .5 >= b[1] && c[1] - .5 <= b[3]).map(([, k]) => k);
      if (!idx.length) { const cla = (b[0] + b[2]) / 2, clo = (b[1] + b[3]) / 2; let best = 0, bd = 1e9; cl.cells.forEach((c, k) => { const dd = Math.hypot(c[0] - cla, c[1] - clo); if (dd < bd) { bd = dd; best = k; } }); idx = [best]; }
      // weight 1-degree cells by where the fire actually burned this month ("cloud over the fire")
      const wk = idx.map((k) => fireW.get(`${cl.cells[k][0]},${cl.cells[k][1]}`) || 0), useW = wk.some((w) => w > 0);
      const doy0 = Math.round((Date.UTC(y, m, 1) - Date.UTC(y, 0, 1)) / 864e5);
      for (let d = 0; d < nd; d++) { let s = 0, n = 0; idx.forEach((k, q) => { const v = cl.v[k][doy0 + d], w = useW ? wk[q] : 1; if (v >= 0 && w > 0) { s += v * w; n += w; } }); C[d] = n ? s / n : NaN; }
    }
    // satellite passes over the AOI (FIRMS swath outlines via CMR), mean over overlapping 1-degree cells
    const P = {};
    if (lk) {
      const doy0 = Math.round((Date.UTC(y, m, 1) - Date.UTC(y, 0, 1)) / 864e5);
      const li = lk.cells.map((c, k) => [c, k]).filter(([c]) => c[0] + .5 >= b[0] && c[0] - .5 <= b[2] && c[1] + .5 >= b[1] && c[1] - .5 <= b[3]).map(([, k]) => k);
      lk.sats.forEach((sat, si) => { P[sat] = d3.range(nd).map((d) => li.length ? d3.mean(li, (k) => lk.v[si][k][doy0 + d]) : 0); });
    }
    const SATN = { Terra: "Terra", Aqua: "Aqua", N: "S-NPP", N20: "NOAA-20", N21: "NOAA-21" };
    const passTxt = (d) => Object.keys(P).filter((k) => P[k][d] > 0).map((k) => `${SATN[k]} ${fmt(P[k][d], 1)}`).join(" · ");
    const passTot = (d) => d3.sum(Object.keys(P), (k) => P[k][d]);
    // chart
    const W = el.clientWidth || 640, Hh = 210, mg = { l: 44, r: 40, t: 14, b: 24 };
    const x = d3.scaleBand().domain(d3.range(nd)).range([mg.l, W - mg.r]).padding(.18);
    const yv = d3.scaleLinear().domain([0, (d3.max(H) || 1) * 1.15]).nice().range([Hh - mg.b, mg.t]);
    const yc = d3.scaleLinear().domain([0, 100]).range([Hh - mg.b, mg.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${Hh}`);
    svg.append("defs").html(`<pattern id="dh" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" stroke="${css("--faint")}" stroke-width="1.5" opacity=".55"/></pattern>`);
    svg.append("g").selectAll("rect").data(d3.range(nd).filter((d) => C[d] >= 70)).join("rect").attr("x", (d) => x(d) - x.step() * x.padding() / 2).attr("width", x.step()).attr("y", mg.t).attr("height", Hh - mg.t - mg.b).attr("fill", "url(#dh)");
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${Hh - mg.b})`).call(d3.axisBottom(x).tickValues(d3.range(0, nd, nd > 20 ? 3 : 1)).tickFormat((d) => d + 1));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(yv).ticks(4, "~s"));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${W - mg.r},0)`).call(d3.axisRight(yc).ticks(4).tickFormat((d) => d + "%"));
    svg.append("g").selectAll("rect").data(d3.range(nd)).join("rect").attr("x", (d) => x(d)).attr("width", x.bandwidth()).attr("y", (d) => yv(H[d])).attr("height", (d) => yv(0) - yv(H[d])).attr("rx", 2).attr("fill", css("--ember"))
      .on("mousemove", (e, d) => showTip(e, `<b>${d + 1} ${MONTHS[S.lang][m]} ${y}</b><br>${fmt(H[d], 1)} harmonized hotspots (${fmt(Rw[d], 0)} detections)<br>cloud: ${isFinite(C[d]) ? fmt(C[d], 0) + "%" : "–"}${C[d] >= 70 ? " ☁ blind" : ""}<br><span class="muted">satellite passes: ${passTxt(d) || "–"}</span><br>≈ <b>${fmt(passTot(d) * (1 - (isFinite(C[d]) ? C[d] : 0) / 100), 1)}</b> clear passes${F[d] ? `<br><span class="muted">${fmt(F[d], 0)} industrial/flare detections masked</span>` : ""}`)).on("mouseleave", hideTip).style("cursor", "pointer").on("click", (e, d) => showDay(y, m, d, dayPts[d], C[d]));
    svg.append("path").datum(d3.range(nd).filter((d) => isFinite(C[d]))).attr("fill", "none").attr("stroke", css("--sky")).attr("stroke-width", 2).attr("d", d3.line().x((d) => x(d) + x.bandwidth() / 2).y((d) => yc(C[d])).curve(d3.curveMonotoneX));
    svg.append("text").attr("x", mg.l).attr("y", 10).attr("fill", css("--ember")).attr("font-size", 10).text("■ hotspots / day");
    svg.append("text").attr("x", W - mg.r).attr("y", 10).attr("text-anchor", "end").attr("fill", css("--sky")).attr("font-size", 10).text("— cloud amount (NASA POWER)");
    el.replaceChildren(svg.node());
    // narrative: blind days that interrupt activity
    // a "blind gap": activity on both sides, a collapse in between, under heavy cloud
    const active = d3.range(nd).filter((d) => H[d] > 0), blindGaps = d3.range(1, nd - 1).filter((d) => {
      const prev = Math.max(H[d - 1], d > 1 ? H[d - 2] : 0), next = Math.max(H[d + 1], d < nd - 2 ? H[d + 2] : 0);
      return C[d] >= 70 && prev > 0 && next > 0 && H[d] < .35 * Math.min(prev, next);
    });
    const peak = d3.maxIndex(H);
    $("dayText").innerHTML = active.length
      ? `Peak: <b>${peak + 1} ${MONTHS[S.lang][m]}</b> (${fmt(H[peak], 0)}). ${blindGaps.length ? `☁ <b>Possibly blind:</b> on ${blindGaps.map((d) => `<b>${d + 1} ${MONTHS[S.lang][m]}</b>`).join(", ")} hotspots collapse while cloud cover was ≥70% — the satellites were likely blind (per-pass masks tell blind from quiet)${blindGaps.length && passTot(blindGaps[0]) ? ` (satellites passed ${fmt(passTot(blindGaps[0]), 0)} times that day, ≈${fmt(passTot(blindGaps[0]) * (1 - C[blindGaps[0]] / 100), 1)} of them clear)` : ""}.` : `${d3.range(nd).filter((d) => C[d] >= 70).length} of ${nd} days were mostly cloudy.`}`
      : t("no_cells");
    $("dayText").innerHTML += ` <span class="muted">Click a day to see the real satellite image (NASA GIBS) with that day's hotspots.</span>`;
    if (D.passes && y === 2023 && m === 5 && b[0] < 51 && b[2] > 50.4 && b[1] < 81 && b[3] > 79.2) {
      const rows = Object.values(D.passes).filter((r) => r.time >= "2023-06-09T12" && r.time <= "2023-06-11T12");
      const verdict = (r) => (r.fire_px > 0 ? ["🔥 fire seen", "var(--ember-2)"] : r.cloud_pct >= 50 ? ["☁ blind", "var(--sky)"] : r.cloud_pct < 10 ? ["✓ clear & quiet", "var(--ok)"] : ["◐ partly blind", "var(--muted)"]);
      $("dayText").innerHTML += `<div style="margin-top:10px"><div class="tag" style="margin-bottom:4px">Blind or quiet? Every MODIS pass over the fire zone, from the Level-2 fire masks (MYD14/MOD14 + geolocation)</div>
        <table class="t"><thead><tr><th>pass (local time, UTC+6)</th><th>satellite</th><th style="text-align:right">cloud over fire zone</th><th style="text-align:right">fire pixels</th><th>verdict</th></tr></thead><tbody>${rows.map((r) => { const v = verdict(r), lt = new Date(Date.parse(r.time + ":00Z") + 6 * 3600e3); return `<tr><td class="mono">${lt.toISOString().slice(5, 16).replace("T", " ")}</td><td>${r.sat}</td><td class="mono" style="text-align:right">${fmt(r.cloud_pct, 0)}%</td><td class="mono" style="text-align:right">${r.fire_px}</td><td style="color:${v[1]}">${v[0]}</td></tr>`; }).join("")}</tbody></table>
        <p style="margin:8px 0 0"><b>Both happened.</b> From the evening of 9 June to midday on 10 June, the passes over the fire were 69–100% cloud: the satellites were <b>blind</b>. On the night of 10 June the sky cleared and the passes still saw no fire. It had genuinely <b>quietened</b> under 2.9 mm of rain (humidity 69%, against 33% two days earlier; NASA POWER). On 11 June it flared up again. A raw hotspot feed shows the same "0" for both cases. <b>ClearCount tells them apart.</b></p></div>`;
    }
    const pr = PRESETS.find((q) => q.id === S.preset);
    if (pr && pr.case && blindGaps.length && !S._autoDay) { S._autoDay = true; showDay(y, m, blindGaps[0], dayPts[blindGaps[0]], C[blindGaps[0]]); }
  }

  // ---------- NASA GIBS true-colour image of a day + that day's hotspots ----------
  let dayLayer, dayDots, dayCtl;
  function gibsLayerFor(dt) {
    if (dt < "2002-07-04") return ["MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS Terra"];
    if (dt < "2016-01-01") return ["MODIS_Aqua_CorrectedReflectance_TrueColor", "MODIS Aqua"];
    if (dt < "2026-11-01") return ["VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS S-NPP"];
    return ["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS NOAA-20"];
  }
  function clearDay() { [dayLayer, dayDots].forEach((l) => l && map.removeLayer(l)); if (dayCtl) map.removeControl(dayCtl); dayLayer = dayDots = dayCtl = null; }
  function showDay(y, m, d, pts, cloud) {
    clearDay();
    const dt = `${y}-${String(m + 1).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}`, [layer, name] = gibsLayerFor(dt);
    dayLayer = L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${dt}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, { maxNativeZoom: 9, maxZoom: 12, opacity: .95, attribution: "NASA GIBS / Worldview" }).addTo(map);
    dayDots = L.layerGroup(pts.map(([la, lo, veg, sat]) => L.circleMarker([la, lo], { radius: 2.6, weight: 0, fillColor: veg ? "#ff3b00" : "#b78cff", fillOpacity: .95 }))).addTo(map);
    cellLayer.eachLayer((l) => l.setStyle({ fillOpacity: 0 }));
    const nVeg = pts.filter((p) => p[2]).length;
    dayCtl = L.control({ position: "topright" });
    dayCtl.onAdd = () => { const div = L.DomUtil.create("div", "daybadge"); div.innerHTML = `<b>${dt}</b> · ${name} true colour<br>${fmt(nVeg, 0)} fire detections (all satellites) · cloud ${isFinite(cloud) ? fmt(cloud, 0) + "%" : "–"}${cloud >= 70 ? " ☁" : ""}<br><a href="https://worldview.earthdata.nasa.gov/?v=${aoiBounds()[1]},${aoiBounds()[0]},${aoiBounds()[3]},${aoiBounds()[2]}&t=${dt}-T12:00:00Z&l=Coastlines_15m,VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_SNPP_Thermal_Anomalies_375m_All,MODIS_Aqua_Thermal_Anomalies_All,${layer}" target="_blank" rel="noopener">Open in NASA Worldview ↗</a> · <a href="https://firms.modaps.eosdis.nasa.gov/map/#d:${dt};@${((aoiBounds()[1] + aoiBounds()[3]) / 2).toFixed(2)},${((aoiBounds()[0] + aoiBounds()[2]) / 2).toFixed(2)},8.0z" target="_blank" rel="noopener">FIRMS map ↗</a><br><a href="#" data-x>✕ back to calendar view</a>`; L.DomEvent.disableClickPropagation(div); div.querySelector("[data-x]").onclick = (e) => { e.preventDefault(); clearDay(); renderMapCells(); }; return div; };
    dayCtl.addTo(map);
    const b = aoiBounds(); map.flyToBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [10, 10], duration: .6 });
  }

  // ---------- key findings (numbers read from the pipeline outputs) ----------
  function renderFindings() {
    const TRN = D.trends ? D.trends.national : null;
    const v = D.val, dr = D.drift && D.drift.summary, bu = D.burned;
    const rawJump = Math.exp(v.step_2012.raw_all_sensors_vs_aqua), harm = (Math.exp(v.step_2012.harmonized_vs_aqua) - 1) * 100;
    const pre = bu ? d3.mean(bu.filter((r) => r.year < 2012), (r) => r.raw_per_100km2) : null, post = bu ? d3.mean(bu.filter((r) => r.year > 2012), (r) => r.raw_per_100km2) : null;
    const hpre = bu ? d3.mean(bu.filter((r) => r.year < 2012), (r) => r.harmonized_per_100km2) : null, hpost = bu ? d3.mean(bu.filter((r) => r.year > 2012), (r) => r.harmonized_per_100km2) : null;
    const L = S.lang === "ru" ? "ru" : S.lang === "kk" ? "kk" : "en";
    const T = {
      en: [["Sensor jump removed", `When VIIRS joined in 2012, raw hotspot counts jumped ×${fmt(rawJump, 1)}. The ClearCount record moves ${fmt(harm, 0)}% (Pettitt p = ${fmt(v.pettitt_2006_2017.harmonized.p_value, 2)}, no break).`],
           ["Independent proof", `Checked against NASA burned-area maps (MCD64A1): raw hotspots per km² rose ×${fmt(post / pre, 1)} after 2012. ClearCount changed ${hpost > hpre ? "+" : ""}${fmt((hpost / hpre - 1) * 100, 0)}%.`],
           ["Blind or quiet?", `Abai, 10 June 2023: daytime passes were 69–100% cloud (blind), and clear night passes saw no fire (quiet under rain). Across Kazakhstan, clouds hid ≈${D.bc ? fmt(D.bc.hidden_share_pct, 0) : "?"}% of fire-season hotspots, and the trend survives the correction.`],
           ["Orbit drift caught", `As MODIS orbits drift, Aqua (later) sees ${dr ? (dr.aqua_change_pct > 0 ? "+" : "") + dr.aqua_change_pct : "?"}% more fires and Terra (earlier) ${dr ? dr.terra_change_pct : "?"}% fewer. The NOAA-20 control stays within ±5%.`], ["Raw data gets the trend backwards", `Raw FIRMS says Kazakhstan's fires are rising ${TRN ? fmt(TRN.raw.sen_pct_per_yr, 1) : "?"}%/yr. The harmonized record shows them falling ${TRN ? fmt(Math.abs(TRN.harmonized.sen_pct_per_yr), 1) : "?"}%/yr (p < 0.001), in 238 of 346 areas.`]],
      ru: [["Скачок сенсоров убран", `С приходом VIIRS в 2012 году сырой счёт вырос в ${fmt(rawJump, 1)} раза. Ряд ClearCount сдвигается на ${fmt(harm, 0)}% (тест Петтитта p = ${fmt(v.pettitt_2006_2017.harmonized.p_value, 2)}, разрыва нет).`],
           ["Независимое доказательство", `Сверка с картами гарей NASA (MCD64A1): сырые хотспоты на км² после 2012 года выросли в ${fmt(post / pre, 1)} раза. ClearCount изменился на ${hpost > hpre ? "+" : ""}${fmt((hpost / hpre - 1) * 100, 0)}%.`],
           ["Слепота или тишина?", "Пожар в Абае, 10 июня 2023. Днём над пожаром было 69–100% облаков: спутники были слепы. Ночью небо было ясным, а огня не было: он утих под дождём 2,9 мм."],
           ["Дрейф орбит пойман", `Из-за дрейфа орбит MODIS Aqua (пролетает позже) видит на ${dr ? (dr.aqua_change_pct > 0 ? "+" : "") + dr.aqua_change_pct : "?"}% больше пожаров, а Terra (пролетает раньше) — на ${dr ? Math.abs(dr.terra_change_pct) : "?"}% меньше. Контроль NOAA-20 в пределах ±5%.`], ["Сырые данные врут о тренде", `Сырой FIRMS говорит, что пожаров в Казахстане становится больше на ${TRN ? fmt(TRN.raw.sen_pct_per_yr, 1) : "?"}% в год. Согласованный ряд показывает снижение на ${TRN ? fmt(Math.abs(TRN.harmonized.sen_pct_per_yr), 1) : "?"}% в год (p < 0,001) в 238 из 346 районов.`]],
      kk: [["Сенсор секірісі жойылды", `2012 жылы VIIRS қосылғанда шикі сан ${fmt(rawJump, 1)} есе өсті. ClearCount: ${fmt(harm, 0)}%.`],
           ["Тәуелсіз дәлел", `NASA күйік аймақтарымен (MCD64A1) тексеру: шикі сан ${fmt(post / pre, 1)} есе өсті, ClearCount ${fmt((hpost / hpre - 1) * 100, 0)}%.`],
           ["Соқырлық па, тыныштық па?", "Абай, 2023 жылғы 10 маусым. Күндіз бұлт 69–100%: соқыр. Түнде аспан ашық, өрт жаңбырдан басылды."],
           ["Орбита ығысуы", `Aqua: ${dr ? dr.aqua_change_pct : "?"}%, Terra: ${dr ? dr.terra_change_pct : "?"}%. Бақылау NOAA-20: ±5%.`], ["Шикі дерек трендті бұрмалайды", `Шикі FIRMS: өрт жылына ${TRN ? fmt(TRN.raw.sen_pct_per_yr, 1) : "?"}% өседі. Үйлестірілген қатар: ${TRN ? fmt(Math.abs(TRN.harmonized.sen_pct_per_yr), 1) : "?"}% азаяды (p < 0,001).`]],
    }[L];
    const K = [`×${fmt(rawJump, 1)} → <em>${fmt(harm, 0)}%</em>`, bu ? `×${fmt(post / pre, 1)} → <em>${hpost > hpre ? "+" : ""}${fmt((hpost / hpre - 1) * 100, 0)}%</em>` : "–", `0 = <em>☁ / 🌧</em>`, dr ? `<em>+${dr.aqua_change_pct}%</em> / ${dr.terra_change_pct}%` : "–", TRN ? `+${fmt(TRN.raw.sen_pct_per_yr, 1)}% → <em>${fmt(TRN.harmonized.sen_pct_per_yr, 1)}%</em>` : "–"];
    const STEP = [1, 8, 4, 6, 2];
    $("findings").innerHTML = T.map(([title, d], k) => `<button class="finding" data-step="${STEP[k]}"><span class="k mono">${K[k]}</span><span class="t">${title}</span><span class="d">${d}</span><span class="go">${t("see")} →</span></button>`).join("");
    $("findings").querySelectorAll(".finding").forEach((b) => b.addEventListener("click", () => window.Story && window.Story.open(+b.dataset.step)));
    $("heroMeta").innerHTML = `NASA FIRMS · ${fmt(D.val.counts_all || 0, 0)} hotspots · ${D.meta.start} → ${D.meta.end}${D.build ? ` · <span title="Rebuilt automatically from NASA data (${D.build.mode})">⟳ updated ${D.build.updated_utc}</span>` : ""}`;
  }

  // ---------- season to date (GWIS / EFFIS / INPE style) ----------
  function renderYTD() {
    const A = D.agg, [Y, M] = ym(S.sel), lastY = ym(D.n - 1)[0], years = d3.range(2001, lastY + 1);
    const cum = (y) => { let c = 0; return d3.range(12).map((m) => { const i = idxOf(y, m); if (i < 0 || i >= D.n) return null; c += A.H[i]; return c; }); };
    const curves = new Map(years.map((y) => [y, cum(y)]));
    const base = d3.range(BASE_Y0, BASE_Y1 + 1), env = d3.range(12).map((m) => { const v = base.map((y) => curves.get(y)[m]).filter((x) => x != null); return [d3.min(v), d3.median(v), d3.max(v), d3.mean(v)]; });
    const el = $("ytdChart"), W = el.clientWidth || 600, H = 230, mg = { l: 48, r: 60, t: 10, b: 24 };
    const x = d3.scaleLinear().domain([0, 11]).range([mg.l, W - mg.r]);
    const ymax = d3.max([...curves.values()].flat().filter((v) => v != null)) || 1;
    const y = d3.scaleLinear().domain([0, ymax * 1.05]).nice().range([H - mg.b, mg.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("g").attr("class", "grid").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - mg.l - mg.r)).tickFormat(""));
    svg.append("path").datum(env).attr("fill", css("--faint")).attr("opacity", .18).attr("d", d3.area().x((d, m) => x(m)).y0((d) => y(d[0])).y1((d) => y(d[2])).curve(d3.curveMonotoneX));
    const line = d3.line().defined((v) => v != null).x((v, m) => x(m)).y((v) => y(v)).curve(d3.curveMonotoneX);
    years.filter((yy) => yy !== Y).forEach((yy) => svg.append("path").datum(curves.get(yy)).attr("fill", "none").attr("stroke", css("--faint")).attr("stroke-width", 1).attr("opacity", .35).attr("d", line)
      .append("title").text(`${yy}: ${fmt(d3.max(curves.get(yy).filter((v) => v != null)), 0)}`));
    svg.append("path").datum(env.map((d) => d[1])).attr("fill", "none").attr("stroke", css("--muted")).attr("stroke-dasharray", "5 4").attr("stroke-width", 1.5).attr("d", line);
    const cur = curves.get(Y).map((v, m) => (m <= M ? v : null));
    svg.append("path").datum(cur).attr("fill", "none").attr("stroke", css("--ember")).attr("stroke-width", 3).attr("d", line);
    svg.append("circle").attr("cx", x(M)).attr("cy", y(cur[M])).attr("r", 4.5).attr("fill", css("--ember"));
    svg.append("text").attr("x", x(M) + 7).attr("y", y(cur[M]) + 4).attr("fill", css("--ember-2")).attr("font-size", 12).attr("font-weight", 700).text(Y);
    svg.append("text").attr("x", W - mg.r + 4).attr("y", y(env[11][1]) + 4).attr("fill", css("--muted")).attr("font-size", 10).text("median");
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(12).tickFormat((m) => MONTHS[S.lang][m]));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4, "~s"));
    el.replaceChildren(svg.node());
    // status line + same-date table
    const now = cur[M], med = env[M][1], mean = env[M][3], prev = curves.get(Y - 1) ? curves.get(Y - 1)[M] : null;
    const ranked = years.filter((yy) => curves.get(yy)[M] != null).sort((a, b) => curves.get(b)[M] - curves.get(a)[M]), rank = ranked.indexOf(Y) + 1;
    const partial = S.sel === D.n - 1;
    $("ytdStatus").innerHTML = `By the end of <b>${MONTHS[S.lang][M]} ${Y}</b>${partial ? "*" : ""} the season stands at <b class="mono">${fmt(now, 0)}</b> harmonized hotspots: <b style="color:${now > med ? "var(--ember-2)" : "var(--sky)"}">${med > 0 ? fmt(now / med, 1) + "× the median" : ""}</b>${prev != null ? `, ${now >= prev ? "above" : "below"} ${Y - 1} by the same date (${prev > 0 ? (now >= prev ? "+" : "") + fmt((now / prev - 1) * 100, 0) + "%" : "–"})` : ""}. Rank <b>${rank}</b> of ${ranked.length} years.`;
    $("ytdTable").innerHTML = `<table class="t mono"><thead><tr><th>Year</th><th style="text-align:right">Jan–${MONTHS[S.lang][M]}</th><th style="text-align:right">vs previous year</th><th style="text-align:right">vs mean 2003–21</th></tr></thead><tbody>` +
      years.slice().reverse().filter((yy) => curves.get(yy)[M] != null).map((yy) => { const v = curves.get(yy)[M], p = curves.get(yy - 1) ? curves.get(yy - 1)[M] : null;
        const da = p ? (v / p - 1) * 100 : null, dm = mean ? (v / mean - 1) * 100 : null, c = (d) => (d == null ? "" : `style="text-align:right;color:${d > 0 ? "var(--ember-2)" : "var(--sky)"}"`);
        return `<tr class="${yy === Y ? "hl" : ""}"><td>${yy}${yy === lastY && partial ? "*" : ""}</td><td style="text-align:right">${fmt(v, 0)}</td><td ${c(da)}>${da == null ? "–" : (da > 0 ? "+" : "") + fmt(da, 0) + "%"}</td><td ${c(dm)}>${dm == null ? "–" : (dm > 0 ? "+" : "") + fmt(dm, 0) + "%"}</td></tr>`; }).join("") + "</tbody></table>";
  }

  // ---------- regions (oblast ranking) ----------
  function regionStats(h, i) {
    const [Y, m] = ym(i), base = d3.range(BASE_Y0, BASE_Y1 + 1).map((y) => h[idxOf(y, m)] || 0).sort(d3.ascending);
    const v = h[i] || 0; let lt = 0, eq = 0; base.forEach((x) => { if (x < v) lt++; else if (x === v) eq++; });
    const ytd = (y) => d3.sum(d3.range(m + 1), (mm) => h[idxOf(y, mm)] || 0), ytdBase = d3.median(d3.range(BASE_Y0, BASE_Y1 + 1).map(ytd));
    return { v, p: (lt + .5 * eq) / base.length, med: d3.median(base), ytd: ytd(Y), ytdMed: ytdBase };
  }
  function regionRing(r) { const g = r.geometry, polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]; const outer = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0]; return outer.map(([lo, la]) => [la, lo]); }
  function selectRegion(r) { setAOI({ type: "poly", ring: regionRing(r) }, "custom"); const b = aoiBounds(); map.flyToBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [10, 10], duration: .6 }); }
  function renderRegions() {
    if (!D.regions) { $("regionsCard").hidden = true; return; }
    const rows = D.regions.regions.filter((r) => r.cells > 3).map((r) => ({ r, ...regionStats(r.h, S.sel) })).sort((a, b) => b.p - a.p || b.v - a.v);
    const nm = (r) => (S.lang === "ru" ? r.name_ru : r.name);
    $("regionsBody").innerHTML = `<table class="t"><thead><tr><th>${S.lang === "ru" ? "Область" : "Region"}</th><th style="text-align:right">${label(S.sel)}</th><th style="text-align:right">× median</th><th style="text-align:right">percentile</th><th style="text-align:right">Jan–${MONTHS[S.lang][ym(S.sel)[1]]} vs median</th></tr></thead><tbody>${rows.map((o, k) => `<tr data-k="${D.regions.regions.indexOf(o.r)}" style="cursor:pointer"><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${pctColor(o.p)};margin-right:6px"></span>${nm(o.r)}</td><td class="mono" style="text-align:right">${fmt(o.v, 0)}</td><td class="mono" style="text-align:right">${o.med > 0 ? fmt(o.v / o.med, 1) : "–"}</td><td class="mono" style="text-align:right;color:${o.p >= .9 ? "var(--ember-2)" : o.p <= .25 ? "var(--sky)" : "inherit"}">${fmt(o.p * 100, 0)}</td><td class="mono" style="text-align:right">${o.ytdMed > 0 ? (o.ytd >= o.ytdMed ? "+" : "") + fmt((o.ytd / o.ytdMed - 1) * 100, 0) + "%" : "–"}</td></tr>`).join("")}</tbody></table>`;
    $("regionsBody").querySelectorAll("tr[data-k]").forEach((tr) => tr.addEventListener("click", () => selectRegion(D.regions.regions[+tr.dataset.k])));
    $("regionsSrc").textContent = "Source: harmonized NASA FIRMS record aggregated by region · " + D.regions.source;
  }

  // ---------- trends & regimes ----------
  function mk(x) { const n = x.length; let sgn = 0; for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) sgn += Math.sign(x[j] - x[i]);
    const cnt = d3.rollups(x, (v) => v.length, (v) => v).map((d) => d[1]); const v = (n * (n - 1) * (2 * n + 5) - d3.sum(cnt, (c) => c * (c - 1) * (2 * c + 5))) / 18;
    const z = v > 0 ? (sgn - Math.sign(sgn)) / Math.sqrt(v) : 0; const p = 2 * (1 - normCdf(Math.abs(z))); const sl = []; for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) sl.push((x[j] - x[i]) / (j - i));
    return { z, p, slope: d3.median(sl), med: d3.median(x) }; }
  function normCdf(z) { const t = 1 / (1 + .2316419 * z), d = .3989423 * Math.exp(-z * z / 2); return 1 - d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); }
  function renderTrends() {
    if (!D.trends) { $("trendCard").hidden = true; return; }
    const T = D.trends, years = d3.range(2003, 2026), A = D.agg;
    const ann = (arr) => years.map((y) => d3.sum(d3.range(12), (m) => { const i = idxOf(y, m); return i >= 0 && i < D.n ? arr[i] : 0; }));
    const h = mk(ann(A.H)), r = mk(ann(A.R));
    const fmtT = (o) => `<b class="mono" style="color:${o.p < .05 ? (o.slope < 0 ? "var(--sky)" : "var(--ember-2)") : "var(--muted)"}">${o.slope > 0 ? "+" : ""}${fmt(o.med > 0 ? o.slope / o.med * 100 : 0, 1)}%/yr</b> <span class="muted">(p ${o.p < .001 ? "< 0.001" : "= " + fmt(o.p, 3)})</span>`;
    const bar = (o, n) => `<div class="trbar" title="${o.down} down · ${o.none} no trend · ${o.up} up"><span style="width:${o.down / n * 100}%;background:#3b82f6"></span><span style="width:${o.none / n * 100}%;background:#9aa3b0"></span><span style="width:${o.up / n * 100}%;background:#f97316"></span></div>`;
    const nH = T.harmonized.up + T.harmonized.down + T.harmonized.none;
    $("trendBody").innerHTML = `<p style="margin:0 0 10px"><b>The raw data gets the trend backwards.</b> Across Kazakhstan, raw NASA FIRMS hotspots suggest fires are <b style="color:var(--ember-2)">rising ${fmt(T.national.raw.sen_pct_per_yr, 1)}%/yr</b>, but only because new satellites joined. On the harmonized record, fires are <b style="color:var(--sky)">falling ${fmt(Math.abs(T.national.harmonized.sen_pct_per_yr), 1)}%/yr</b> (p < 0.001). This matches published studies of the Kazakh steppe (more grazing, wetter years).</p>
      <div class="trbars"><span>Raw FIRMS</span>${bar(T.raw, nH)}<span>ClearCount</span>${bar(T.harmonized, nH)}</div>
      <p class="muted" style="font-size:12px;margin:6px 0 10px"><span style="color:#3b82f6">■</span> significant decrease · <span style="color:#9aa3b0">■</span> no significant trend · <span style="color:#f97316">■</span> significant increase, out of ${nH} 1° cells (Raw: ${T.raw.up} up / ${T.raw.down} down; ClearCount: ${T.harmonized.up} up / ${T.harmonized.down} down). Switch the map to <b>Trend</b> and <b>Raw-data trend</b> to compare.</p>
      <p style="margin:0">This area, 2003–2025: ClearCount ${fmtT(h)} · raw FIRMS ${fmtT(r)}</p>`;
    if (!D.regimes) return;
    const b = aoiBounds(), here = d3.rollup(D.regimes.cells.filter(([la, lo]) => la + .5 >= b[0] && la - .5 <= b[2] && lo + .5 >= b[1] && lo - .5 <= b[3]), (v) => v.length, (d) => d[2]);
    $("regimeBody").innerHTML = `<div class="tag" style="margin-bottom:6px">Fire regimes found by machine learning (unsupervised)</div><div class="regimes">${D.regimes.clusters.map((c, k) => {
      const W = 170, H = 46, x = d3.scaleBand().domain(d3.range(12)).range([0, W]).padding(.15), y = d3.scaleLinear().domain([0, d3.max(c.profile)]).range([H, 2]);
      const bars = c.profile.map((v, i) => `<rect x="${x(i)}" y="${y(v)}" width="${x.bandwidth()}" height="${H - y(v)}" rx="1.5" fill="${REG_COL[k]}"/>`).join("");
      return `<div class="regime"${here.get(k) ? ` style="border-color:${REG_COL[k]}"` : ""}><b><span style="color:${REG_COL[k]}">■</span> ${c.name}</b><svg viewBox="0 0 ${W} ${H + 12}" width="100%">${bars}<text x="0" y="${H + 11}" font-size="9" fill="${css("--muted")}">J F M A M J J A S O N D</text></svg>
        <div class="meta">${c.cells} cells · cropland ${fmt(c.cropland_share * 100, 0)}% · ${fmt(c.mean_annual_hotspots, 0)} hotspots/yr per cell<br>trend: ${c.cells_trend_down} cells falling, ${c.cells_trend_up} rising${here.get(k) ? `<br><b style="color:var(--text)">${here.get(k)} cell(s) in this area</b>` : ""}</div></div>`; }).join("")}</div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">${D.regimes.method}. Each 1° cell is grouped only by how it burns; the algorithm is given no geography.</p>`;
  }

  // ---------- what burns (land cover) ----------
  const LCC = { steppe: ["#f6a04d", "steppe, shrub & grass"], cropland: ["#ffd166", "cropland"], forest: ["#4fd1a5", "forest"] };
  function renderLC() {
    if (!D.lc) { $("lcCard").hidden = true; return; }
    const n = D.n, G = { cropland: new Float64Array(n), forest: new Float64Array(n) };
    ["cropland", "forest"].forEach((k) => Object.entries(D.lc[k]).forEach(([key, [ms, vs]]) => { const [la, lo] = key.split(",").map(Number); if (!inAOI(la, lo)) return; ms.forEach((m, q) => { if (m >= 0 && m < n) G[k][m] += vs[q]; }); }));
    G.steppe = Float64Array.from(D.agg.H, (v, i) => Math.max(0, v - G.cropland[i] - G.forest[i]));
    const keys = ["steppe", "cropland", "forest"], years = d3.range(Math.max(2001, S.y0), S.y1 + 1);
    const yr = years.map((y) => { const o = { y }; keys.forEach((k) => (o[k] = d3.sum(d3.range(12), (m) => { const i = idxOf(y, m); return i >= 0 && i < n ? G[k][i] : 0; }))); return o; });
    const stackChart = (el, data, xk, xlab, xfmt) => {
      const W = el.clientWidth || 300, H = 190, mg = { l: 40, r: 6, t: 8, b: 22 };
      const x = d3.scaleBand().domain(data.map((d) => d[xk])).range([mg.l, W - mg.r]).padding(.15);
      const st = d3.stack().keys(keys)(data), y = d3.scaleLinear().domain([0, d3.max(st[st.length - 1], (d) => d[1]) || 1]).nice().range([H - mg.b, mg.t]);
      const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).tickValues(x.domain().filter((d, i) => !(i % Math.ceil(data.length / 8)))).tickFormat(xfmt));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4, "~s"));
      st.forEach((layer) => svg.append("g").selectAll("rect").data(layer).join("rect").attr("x", (d) => x(d.data[xk])).attr("width", x.bandwidth()).attr("y", (d) => y(d[1])).attr("height", (d) => y(d[0]) - y(d[1])).attr("fill", LCC[layer.key][0])
        .append("title").text((d) => `${xfmt(d.data[xk])}: ${LCC[layer.key][1]} ${fmt(d.data[layer.key], 0)}`));
      svg.append("text").attr("x", mg.l).attr("y", 8).attr("fill", css("--muted")).attr("font-size", 10).text(xlab);
      el.replaceChildren(svg.node());
    };
    stackChart($("lcYear"), yr, "y", "per year", (d) => `'${String(d).slice(2)}`);
    const mon = d3.range(12).map((m) => { const o = { m }; keys.forEach((k) => (o[k] = d3.mean(d3.range(BASE_Y0, BASE_Y1 + 1), (y) => G[k][idxOf(y, m)] || 0))); return o; });
    stackChart($("lcMonth"), mon, "m", `typical month (${BASE_Y0}–${BASE_Y1} mean)`, (d) => MONTHS[S.lang][d]);
    const tot = d3.sum(keys, (k) => d3.sum(G[k])), share = (k) => (tot ? d3.sum(G[k]) / tot : 0);
    const cropPeak = d3.range(12).sort((a, b) => mon[b].cropland - mon[a].cropland).slice(0, 2).sort((a, b) => a - b);
    $("lcText").innerHTML = `<span style="color:${LCC.steppe[0]}">■</span> steppe/shrub/grass <b>${fmt(share("steppe") * 100, 0)}%</b> · <span style="color:${LCC.cropland[0]}">■</span> cropland <b>${fmt(share("cropland") * 100, 0)}%</b> · <span style="color:${LCC.forest[0]}">■</span> forest <b>${fmt(share("forest") * 100, 1)}%</b>. ` +
      (share("cropland") > .05 ? `Cropland fires peak in <b>${cropPeak.map((m) => MONTHS[S.lang][m]).join(" and ")}</b>, the crop-residue burning seasons. Kazakhstan's Law on the Plant World (Art. 14) bans burning stubble during high fire danger, so these months are where enforcement matters.` : "") +
      ` <span class="muted">Land cover from MODIS MCD12Q1 2020 (500 m). Sparse pine forests such as Semey Ormany are often classed as woody savanna and appear under steppe/shrub.</span>`;
  }

  // ---------- ML early warning ----------
  function renderML() {
    const el = $("mlBody"); if (!D.ml) { $("mlCard").hidden = true; return; }
    const i = S.sel, [y, m] = ym(i), b = aoiBounds();
    let cells = D.ml.cells.filter(([la, lo]) => la + .5 >= b[0] && la - .5 <= b[2] && lo + .5 >= b[1] && lo - .5 <= b[3]);
    const vals = cells.map(([, , ms, ps, ys]) => { const q = ms.indexOf(i); return q < 0 ? null : [ps[q], ys[q]]; }).filter(Boolean);
    const sk = D.ml.loyo, sp = D.ml.split;
    const skill = `<p class="muted" style="font-size:12px;margin:8px 0 0">Gradient-boosted trees on the harmonized record + NASA POWER weather. Every year is predicted by a model that never saw it: AUC <b class="mono">${sk.auc}</b>; the 10% highest-risk cell-months were above normal <b class="mono">${fmt(sk.hit_rate_top10pct * 100, 0)}%</b> of the time vs <b class="mono">${fmt(sk.base_rate * 100, 0)}%</b> at random (×${fmt(sk.hit_rate_top10pct / sk.base_rate, 1)}). Strict split (train ≤2015, test 2016–25): AUC ${sp.model.auc} vs persistence ${sp.persistence_auc}.</p>`;
    const rv = D.ml.raw_vs_harmonized;
    const rvHtml = rv ? `<div style="margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2)"><b>Harmonization makes the forecast better.</b> We trained the same model, with the same weather and the same target, on raw FIRMS history instead: AUC <span class="mono">${rv.raw_features.auc}</span> → <b class="mono">${rv.harmonized_features.auc}</b>, PR-AUC <span class="mono">${rv.raw_features.pr_auc}</span> → <b class="mono">${rv.harmonized_features.pr_auc}</b>. Hits among the top-10% risk: <span class="mono">${fmt(rv.raw_features.top10_hit_rate * 100, 0)}%</span> → <b class="mono">${fmt(rv.harmonized_features.top10_hit_rate * 100, 0)}%</b>. Skill over climatology <span class="mono">${fmt(rv.raw_features.brier_skill_vs_climatology * 100, 1)}%</span> → <b class="mono">${fmt(rv.harmonized_features.brier_skill_vs_climatology * 100, 1)}%</b>. <span class="muted">The target is an anomaly (above the 75th percentile), which is harder than predicting whether any fire occurs.</span></div>` : "";
    const imp = D.ml.importance.slice(0, 6), mx = imp[0][1];
    const drivers = `<div style="margin-top:10px"><div class="tag" style="margin-bottom:4px">what the model relies on (permutation importance)</div>${imp.map(([n, v]) => `<div style="display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:center;font-size:12px"><span class="muted">${n}</span><div class="bar" style="width:${Math.max(4, (v / mx) * 100)}%;background:linear-gradient(90deg,var(--sky),#9ad0ff)"></div></div>`).join("")}</div>`;
    if (!vals.length) { el.innerHTML = `<p class="muted">Forecasts cover fire-season months (Mar–Oct) in cells with a fire history. Pick such a month in the calendar.</p>` + skill + rvHtml + drivers; return; }
    const p = d3.mean(vals, (v) => v[0]), obs = d3.mean(vals, (v) => v[1]), hi = vals.filter((v) => v[0] >= .5).length;
    const prev = label(i - 1), verdict = obs >= .5 ? "above normal" : obs > 0 ? "partly above normal" : "not above normal";
    const col = p >= .45 ? "var(--ember-2)" : p >= .3 ? "var(--warn)" : "var(--sky)";
    el.innerHTML = `<div class="now" style="grid-template-columns:auto 1fr"><div><div class="now-big mono" style="color:${col}">${fmt(p * 100, 0)}<small>%</small></div><div class="muted" style="font-size:12px">chance of an above-normal month<br>issued end of ${prev}</div></div>
      <div><div class="gauge" aria-hidden="true" style="background:linear-gradient(90deg,#2b6cb0,#9aa3b0 40%,#f6a04d 70%,#e8590c)"><i style="left:${p * 100}%"></i></div>
      <div class="gauge-l"><span>0%</span><span>base rate ${fmt(sk.base_rate * 100, 0)}%</span><span>100%</span></div>
      <p style="margin:8px 0 0">What happened: <b>${verdict}</b> (${fmt(obs * 100, 0)}% of ${vals.length} cells). ${hi ? `<b>${hi}</b> cell(s) were flagged ≥50% risk a month ahead.` : ""}</p></div></div>` + skill + rvHtml + drivers;
  }

  // ---------- fire weather (NASA POWER) ----------
  function wxSeries() {
    if (!D.wx) return null;
    const b = aoiBounds();
    let cells = D.wx.cells.filter(([la, lo]) => la + .5 >= b[0] && la - .5 <= b[2] && lo + .5 >= b[1] && lo - .5 <= b[3]);
    if (!cells.length) { const cla = (b[0] + b[2]) / 2, clo = (b[1] + b[3]) / 2; cells = [D.wx.cells.reduce((a, c) => (Math.hypot(c[0] - cla, c[1] - clo) < Math.hypot(a[0] - cla, a[1] - clo) ? c : a))]; }
    const out = {};
    ["precip_mm_day", "tmax_c", "rh_pct", "wind_ms"].forEach((k) => { out[k] = d3.range(D.n).map((i) => d3.mean(cells, (c) => (c[2][k] ? c[2][k][i] : null))); });
    return out;
  }
  function spearman(a, b) {
    const ok = a.map((v, i) => [v, b[i]]).filter(([x, y]) => isFinite(x) && isFinite(y)); if (ok.length < 8) return NaN;
    const rk = (arr) => { const s = arr.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(arr.length); s.forEach(([, i], k) => (r[i] = k)); return r; };
    const ra = rk(ok.map((p) => p[0])), rb = rk(ok.map((p) => p[1])), ma = d3.mean(ra), mb = d3.mean(rb);
    return d3.sum(ra, (v, i) => (v - ma) * (rb[i] - mb)) / Math.sqrt(d3.sum(ra, (v) => (v - ma) ** 2) * d3.sum(rb, (v) => (v - mb) ** 2));
  }
  function renderWeather() {
    const W = wxSeries(); if (!W) { $("wxCard").hidden = true; return; }
    const i = S.sel, [, m] = ym(i), base = (k) => d3.range(BASE_Y0, BASE_Y1 + 1).map((y) => W[k][idxOf(y, m)]).filter(isFinite);
    const card = (k, unit, lbl, pct) => { const v = W[k][i], bs = base(k), mu = d3.mean(bs); if (!isFinite(v) || !isFinite(mu)) return `<div class="metric"><b>–</b><span>${lbl}</span></div>`;
      const d = pct ? (mu > 0 ? (v / mu - 1) * 100 : 0) : v - mu, sgn = d > 0 ? "+" : "";
      const bad = (k === "precip_mm_day" || k === "rh_pct") ? d < (pct ? -30 : -5) : d > (k === "tmax_c" ? 1.5 : .5);
      return `<div class="metric"><b class="mono ${bad ? "meh" : ""}">${fmt(v, 1)} ${unit}</b><span>${lbl}: <b class="mono">${sgn}${fmt(d, pct ? 0 : 1)}${pct ? "%" : " " + unit}</b> vs normal</span></div>`; };
    // antecedent dryness: previous 3 months precipitation vs normal
    const ante = (j) => d3.mean([j - 1, j - 2, j - 3].filter((q) => q >= 0), (q) => W.precip_mm_day[q]);
    const anteNow = ante(i), anteBase = d3.mean(d3.range(BASE_Y0, BASE_Y1 + 1).map((y) => ante(idxOf(y, m))).filter(isFinite));
    $("wxGrid").innerHTML = card("precip_mm_day", "mm/d", "precipitation", true) + card("tmax_c", "°C", "max temperature", false) + card("rh_pct", "%", "humidity", false) +
      card("wind_ms", "m/s", "wind", false) + `<div class="metric"><b class="mono ${anteNow < .7 * anteBase ? "meh" : ""}">${fmt((anteNow / anteBase - 1) * 100, 0)}%</b><span>rain in the 3 months before, vs normal</span></div>`;
    // which weather tracks fire in this area? fire-season months Apr-Oct, all years
    const idx = d3.range(D.n).filter((j) => { const [, mm] = ym(j); return mm >= 3 && mm <= 9; });
    const fireP = idx.map((j) => pctRank(D.agg.H[j], ym(j)[1]));
    const anom = (k, pct) => idx.map((j) => { const mm = ym(j)[1], mu = d3.mean(d3.range(BASE_Y0, BASE_Y1 + 1).map((y) => W[k][idxOf(y, mm)]).filter(isFinite)); const v = W[k][j]; return pct ? v / mu - 1 : v - mu; });
    const rP = spearman(fireP, anom("precip_mm_day", true)), rT = spearman(fireP, anom("tmax_c", false)), rA = spearman(fireP, idx.map((j) => ante(j)));
    $("wxText").innerHTML = `In this area (Apr–Oct, ${ym(0)[0]}–${ym(D.n - 1)[0]}), fire rank vs weather, Spearman ρ: rain <b class="mono">${fmt(rP, 2)}</b> · max temperature <b class="mono">${fmt(rT, 2)}</b> · rain in the 3 months before <b class="mono">${fmt(rA, 2)}</b>. ` +
      `${Math.abs(rT) > Math.abs(rP) && rT > .15 ? "Hot months burn more here." : rP < -.15 ? "Dry months burn more here." : "Weather explains little here, so ignition by people (agricultural burning) likely dominates."} <span class="muted">Correlation is not causation.</span>`;
  }

  // ---------- orbit drift detector (scientist mode) ----------
  function renderDrift() {
    if (S.mode !== "scientist" || !D.drift) return;
    const dr = D.drift, el = $("driftChart"), W = el.clientWidth || 600, H = 240, mg = { l: 46, r: 14, t: 14, b: 26 };
    const x = d3.scaleLinear().domain(d3.extent(dr.years)).range([mg.l, W - mg.r]), y = d3.scaleLinear().domain([.55, 1.3]).range([H - mg.b, mg.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("rect").attr("x", x(2012)).attr("width", x(2019) - x(2012)).attr("y", mg.t).attr("height", H - mg.t - mg.b).attr("fill", css("--sky")).attr("opacity", .06);
    svg.append("text").attr("x", x(2012) + 4).attr("y", mg.t + 10).attr("fill", css("--muted")).attr("font-size", 10).text("baseline 2012–2019 (= 1.0)");
    svg.append("line").attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", y(1)).attr("y2", y(1)).attr("stroke", css("--faint")).attr("stroke-dasharray", "3 3");
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat((v) => (v > 1 ? "+" : "") + Math.round((v - 1) * 100) + "%"));
    const ser = [["Aqua", "#5ab0ff", "MODIS Aqua (drifting later)"], ["Terra", "#ffcc4d", "MODIS Terra (drifting earlier)"], ["N20", "#4fd1a5", "NOAA-20 (placebo, maintained orbit)"]];
    ser.forEach(([k, c]) => {
      const pts = dr.years.map((yr, i) => [yr, dr.ratio[k][i], dr.ci[k][i]]).filter((p) => p[1] != null);
      svg.append("path").datum(pts).attr("fill", c).attr("opacity", .15).attr("d", d3.area().x((p) => x(p[0])).y0((p) => y(p[2][0])).y1((p) => y(p[2][1])));
      svg.append("path").datum(pts).attr("fill", "none").attr("stroke", c).attr("stroke-width", 2.4).attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])));
      svg.append("g").selectAll("circle").data(pts).join("circle").attr("cx", (p) => x(p[0])).attr("cy", (p) => y(p[1])).attr("r", 2.6).attr("fill", c);
    });
    const lg = svg.append("g").attr("transform", `translate(${mg.l + 8},${H - mg.b - 52})`);
    ser.forEach(([, c, n], i) => { const g = lg.append("g").attr("transform", `translate(0,${i * 15})`); g.append("rect").attr("width", 12).attr("height", 3).attr("y", 4).attr("fill", c); g.append("text").attr("x", 18).attr("y", 9).attr("font-size", 11).attr("fill", css("--text")).text(n); });
    el.replaceChildren(svg.node());
    const sm = dr.summary, lt = (k, i) => { const v = dr.local_time[k][i]; return `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`; }, L0 = dr.years.indexOf(2016), L1 = dr.years.length - 1;
    $("driftText").innerHTML = `Daytime fire detections relative to VIIRS S-NPP (maintained orbit), 95% bootstrap CI. Median local detection time: Aqua ${lt("Aqua", L0)} → <b>${lt("Aqua", L1)}</b>, Terra ${lt("Terra", L0)} → <b>${lt("Terra", L1)}</b>. ` +
      `By ${sm.last_year}: Aqua <b class="mono">${sm.aqua_change_pct > 0 ? "+" : ""}${sm.aqua_change_pct}%</b>, Terra <b class="mono">${sm.terra_change_pct}%</b>. The placebo stays within ${Math.round((sm.placebo_noaa20_range[0] - 1) * 100)}…+${Math.round((sm.placebo_noaa20_range[1] - 1) * 100)}%. ` +
      `The signs are opposite, as the afternoon fire peak predicts. <b>Orbit drift, not fire, changed MODIS counts</b>, which is why ClearCount does not use MODIS as the reference after 2021.`;
  }

  // ---------- season outlook (analog years) ----------
  function outlook() {
    const A = D.agg, [Y, M] = ym(S.sel), cum = (y) => d3.sum(d3.range(M + 1), (m) => { const i = idxOf(y, m); return i >= 0 && i < D.n ? A.H[i] : 0; });
    const tot = (y) => d3.sum(d3.range(12), (m) => { const i = idxOf(y, m); return i >= 0 && i < D.n ? A.H[i] : 0; });
    const base = d3.range(BASE_Y0, BASE_Y1 + 1).filter((y) => y !== Y), cNow = cum(Y);
    if (M >= 11 || base.length < 8) return null;
    const cs = base.map(cum), pNow = cs.filter((c) => c < cNow).length / cs.length + .5 * cs.filter((c) => c === cNow).length / cs.length;
    const medTot = d3.median(base.map(tot));
    const analogs = base.map((y) => [y, Math.abs((cs.filter((c) => c < cum(y)).length / cs.length) - pNow)]).sort((a, b) => a[1] - b[1]).slice(0, 6).map((a) => a[0]);
    const above = analogs.filter((y) => tot(y) > medTot);
    return { pNow, analogs, above, Y, M };
  }

  // ---------- records ----------
  function renderRecords() {
    const A = D.agg, rows = [];
    for (let y = S.y0; y <= S.y1; y++) for (let m = 0; m < 12; m++) { const i = idxOf(y, m); if (i >= 0 && i < D.n) rows.push({ i, v: A.H[i], m }); }
    const topM = rows.slice().sort((a, b) => b.v - a.v).slice(0, 5);
    const yrs = d3.rollups(rows, (v) => d3.sum(v, (d) => d.v), (d) => ym(d.i)[0]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const mx = topM[0] ? topM[0].v : 1, my = yrs[0] ? yrs[0][1] : 1;
    $("records").innerHTML = `<div class="grid2" style="gap:12px">
      <div><div class="tag" style="margin-bottom:6px">${t("top_months")}</div><table class="t">${topM.map((r) => `<tr class="${r.i === S.sel ? "hl" : ""}"><td>${label(r.i)}</td><td class="mono" style="text-align:right">${fmt(r.v, 0)}</td><td style="width:40%"><div class="bar" style="width:${(r.v / mx) * 100}%"></div></td></tr>`).join("")}</table></div>
      <div><div class="tag" style="margin-bottom:6px">${t("top_years")}</div><table class="t">${yrs.map(([y, v]) => `<tr><td>${y}</td><td class="mono" style="text-align:right">${fmt(v, 0)}</td><td style="width:40%"><div class="bar" style="width:${(v / my) * 100}%"></div></td></tr>`).join("")}</table></div></div>`;
  }

  // ---------- season clock ----------
  function renderSeason() {
    const A = D.agg, years = d3.range(Math.max(2001, S.y0), Math.min(S.y1, 2025) + 1), out = [];
    years.forEach((y) => {
      const mon = d3.range(12).map((m) => { const i = idxOf(y, m); return i >= 0 && i < D.n ? A.H[i] : 0; });
      const tot = d3.sum(mon); if (tot < 5) return;
      const doyAt = (q) => { let c = 0; for (let m = 0; m < 12; m++) { const nc = c + mon[m]; if (nc >= q * tot) { const f = mon[m] ? (q * tot - c) / mon[m] : 0; return (m + f) * 30.44; } c = nc; } return 365; };
      out.push({ y, a: doyAt(.1), b: doyAt(.5), c: doyAt(.9) });
    });
    const el = $("seasonChart"); if (!out.length) { el.innerHTML = `<p class="muted">${t("no_cells")}</p>`; $("seasonText").textContent = ""; return; }
    const W = el.clientWidth || 320, H = 200, m = { l: 40, r: 10, t: 8, b: 22 };
    const x = d3.scaleLinear().domain(d3.extent(out, (d) => d.y)).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, 365]).range([H - m.b, m.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues([0, 90, 181, 273, 365]).tickFormat((d) => MONTHS[S.lang][Math.min(11, Math.round(d / 30.44))]));
    svg.append("g").selectAll("line").data(out).join("line").attr("x1", (d) => x(d.y)).attr("x2", (d) => x(d.y)).attr("y1", (d) => y(d.a)).attr("y2", (d) => y(d.c)).attr("stroke", css("--ember")).attr("stroke-width", 4).attr("stroke-linecap", "round").attr("opacity", .45);
    svg.append("g").selectAll("circle").data(out).join("circle").attr("cx", (d) => x(d.y)).attr("cy", (d) => y(d.b)).attr("r", 3.2).attr("fill", css("--ember-2"));
    const reg = (k) => { const xs = out.map((d) => d.y), ys = out.map((d) => d[k]), mx = d3.mean(xs), my = d3.mean(ys); const b = d3.sum(xs, (v, i) => (v - mx) * (ys[i] - my)) / d3.sum(xs, (v) => (v - mx) ** 2); return { b, a: my - b * mx }; };
    const r = reg("a");
    svg.append("line").attr("x1", x(out[0].y)).attr("x2", x(out[out.length - 1].y)).attr("y1", y(r.a + r.b * out[0].y)).attr("y2", y(r.a + r.b * out[out.length - 1].y)).attr("stroke", css("--sky")).attr("stroke-dasharray", "4 3");
    el.replaceChildren(svg.node());
    const last = out[out.length - 1], dd = (d) => { const dt = new Date(Date.UTC(2001, 0, 1) + d * 864e5); return dt.toLocaleDateString(S.lang, { day: "numeric", month: "short" }); };
    $("seasonText").innerHTML = `${last.y}: ${t("onset")} ≈ <b>${dd(last.a)}</b>, ${t("peak")} ≈ <b>${dd(last.b)}</b>, ${t("end")} ≈ <b>${dd(last.c)}</b>. Onset trend: <b class="mono">${r.b > 0 ? "+" : ""}${fmt(r.b * 10, 1)}</b> days / decade (dashed).`;
  }

  // ---------- events ----------
  function renderEvents() {
    const cols = D.events.cols, rows = D.events.rows.filter((r) => inAOI(r[5], r[6]) && +r[0].slice(0, 4) >= S.y0 && +r[0].slice(0, 4) <= S.y1);
    const [sy, sm] = ym(S.sel); const key = `${sy}-${String(sm + 1).padStart(2, "0")}`;
    const ranked = rows.slice().sort((a, b) => b[3] - a[3]);
    const cur = ranked.find((r) => r[0].slice(0, 7) === key || (r[0].slice(0, 7) <= key && r[1].slice(0, 7) >= key));
    const curRank = cur ? ranked.indexOf(cur) + 1 : null;
    let h = `<p class="muted" style="margin:0 0 8px">${fmt(rows.length, 0)} fire events (≥3 harmonized hotspots) in area, ${S.y0}–${S.y1}.`;
    if (cur) h += ` Largest fire active in <b>${label(S.sel)}</b>: <b>${fmt(cur[3], 0)}</b> harmonized hotspots, ${cur[7]} days — <b style="color:var(--ember-2)">#${curRank}</b> of ${fmt(rows.length, 0)} (top ${fmt((curRank / rows.length) * 100, 1)}%).`;
    h += `</p><table class="t"><thead><tr><th>${t("ev_rank")}</th><th>${t("ev_start")}</th><th>${t("ev_days")}</th><th style="text-align:right">${t("ev_size")}</th><th style="text-align:right">FRP max, MW</th><th>lat, lon</th></tr></thead><tbody>`;
    h += ranked.slice(0, 8).map((r, k) => `<tr class="${r === cur ? "hl" : ""}" data-ll="${r[5]},${r[6]}" style="cursor:pointer"><td class="mono">#${k + 1}</td><td>${r[0]}</td><td class="mono">${r[7]}</td><td class="mono" style="text-align:right">${fmt(r[3], 0)}</td><td class="mono" style="text-align:right">${fmt(r[4], 0)}</td><td class="mono muted">${r[5].toFixed(2)}, ${r[6].toFixed(2)}</td></tr>`).join("");
    $("events").innerHTML = h + "</tbody></table>";
    $("events").querySelectorAll("tr[data-ll]").forEach((tr) => tr.addEventListener("click", () => { const [a, b] = tr.dataset.ll.split(",").map(Number); map.flyTo([a, b], 9); }));
  }

  // ---------- reported ----------
  function renderReported() {
    const nEv = (a, b) => D.events.rows.filter((r) => r[0].slice(0, 7) >= a && r[0].slice(0, 7) <= b).length;
    $("reported").innerHTML = `<table class="t"><thead><tr><th>Period</th><th>Reported (official / press)</th><th style="text-align:right">ClearCount detected</th></tr></thead><tbody>` +
      REPORTED.map((r) => `<tr><td>${r.period}</td><td>${r.what[S.lang] || r.what.en} <a href="${r.src}" target="_blank" rel="noopener">↗</a></td><td class="mono" style="text-align:right">${r.y0 ? fmt(nEv(r.y0, r.y1), 0) + " events" : "–"}</td></tr>`).join("") +
      `</tbody></table><p class="muted" style="font-size:12px;margin:8px 0 0">Satellites detect hotspots in grassland and cropland fires that are often not counted as "forest fires" in official statistics. The two numbers are not expected to match. That gap is part of the point.</p>`;
  }

  // ---------- map ----------
  let map, aoiLayer, cellLayer, flareLayer, drawn, baseLayer, legendEl;
  const REG_COL = ["#f6a04d", "#5ab0ff", "#4fd1a5", "#f472b6", "#ffd166", "#a78bfa", "#94a3b8"];
  const TR_COL = (dir, slope) => (dir < 0 ? (slope < -10 ? "#1d4ed8" : "#60a5fa") : dir > 0 ? (slope > 10 ? "#c2410c" : "#fb923c") : "#9aa3b0");
  function initMap() {
    map = L.map("map", { zoomControl: true, preferCanvas: true, worldCopyJump: true }).setView([48.2, 67], 4);
    setBasemap();
    drawn = new L.FeatureGroup().addTo(map);
    map.addControl(new L.Control.Draw({ draw: { polyline: false, circle: false, marker: false, circlemarker: false,
      rectangle: { shapeOptions: { color: "#ff7a1a", weight: 2 } }, polygon: { shapeOptions: { color: "#ff7a1a", weight: 2 } } }, edit: false }));
    map.on(L.Draw.Event.CREATED, (e) => {
      const ll = e.layer.getLatLngs()[0].map((p) => [p.lat, p.lng]);
      if (e.layerType === "rectangle") { const b = e.layer.getBounds(); setAOI({ type: "bbox", b: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] }, "custom"); }
      else setAOI({ type: "poly", ring: ll }, "custom");
    });
    cellLayer = L.layerGroup().addTo(map);
    const lg = L.control({ position: "bottomleft" });
    lg.onAdd = () => { legendEl = L.DomUtil.create("div", "map-legend"); updateLegend(); return legendEl; };
    lg.addTo(map);
    flareLayer = L.layerGroup().addTo(map);
    D.flares.slice(0, 300).forEach(([la, lo, n]) => L.circleMarker([la, lo], { radius: 2 + Math.min(4, Math.log10(n + 1)), color: "#b78cff", weight: 1.2, fillColor: "#b78cff", fillOpacity: .25 })
      .bindTooltip(`Persistent industrial source<br>${fmt(n, 0)} detections masked`).addTo(flareLayer));
  }
  function setBasemap() {
    const light = document.documentElement.dataset.theme === "light" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: light)").matches);
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${light ? "World_Light_Gray_Base" : "World_Dark_Gray_Base"}/MapServer/tile/{z}/{y}/{x}`, { attribution: "Tiles © Esri, HERE, Garmin, © OpenStreetMap · NASA FIRMS", maxZoom: 16 }).addTo(map);
  }
  function drawAOI() {
    if (aoiLayer) map.removeLayer(aoiLayer);
    const st = { color: "#ff7a1a", weight: 2, fill: false, dashArray: "6 4" };
    aoiLayer = S.aoi.type === "bbox" ? L.rectangle([[S.aoi.b[0], S.aoi.b[1]], [S.aoi.b[2], S.aoi.b[3]]], st) : L.polygon(S.aoi.ring, st);
    aoiLayer.addTo(map);
  }
  function updateLegend() {
    if (!legendEl) return;
    const tail = `<br><i style="background:#b78cff"></i>gas flare / industry (masked)<br><span style="border-top:2px dashed #ff7a1a;display:inline-block;width:16px;vertical-align:3px;margin-right:4px"></span>area of interest`;
    if (S.mapMode === "month") legendEl.innerHTML = `<b>Selected month</b><span class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></span>below · normal · above` + tail;
    else if (S.mapMode === "regions") legendEl.innerHTML = `<b>Regions, selected month</b><span class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></span>below · normal · above own history<br><span class="muted">click a region to select it</span>`;
    else if (S.mapMode === "regime" && D.regimes) legendEl.innerHTML = `<b>Fire regimes (k-means)</b><br>` + D.regimes.clusters.map((c, k) => `<i style="background:${REG_COL[k]}"></i>${c.name}`).join("<br>");
    else legendEl.innerHTML = `<b>${S.mapMode === "raw" ? "Trend in RAW FIRMS data" : "Trend, ClearCount"} 2003–2025</b><br><i style="background:#1d4ed8"></i>significant decrease (&lt;−10%/yr)<br><i style="background:#60a5fa"></i>significant decrease<br><i style="background:#9aa3b0"></i>no significant trend<br><i style="background:#fb923c"></i>significant increase<br><i style="background:#c2410c"></i>significant increase (&gt;+10%/yr)`;
  }
  function renderMapCells() {
    cellLayer.clearLayers(); updateLegend();
    if (S.mapMode !== "month") {
      if (S.mapMode === "regions" && D.regions) { D.regions.regions.filter((r) => r.cells > 3).forEach((r) => { const st = regionStats(r.h, S.sel); L.geoJSON(r.geometry, { style: { weight: 1, color: "#0a0e16", fillColor: pctColor(st.p), fillOpacity: .72 } }).bindTooltip(`${S.lang === "ru" ? r.name_ru : r.name}: ${fmt(st.v, 0)} · percentile ${fmt(st.p * 100, 0)}`).on("click", () => selectRegion(r)).addTo(cellLayer); }); return; }
      if (S.mapMode === "regime" && D.regimes) D.regimes.cells.forEach(([la, lo, c]) => L.rectangle([[la - .5, lo - .5], [la + .5, lo + .5]], { weight: .5, color: "#0a0e16", fillColor: REG_COL[c], fillOpacity: .7 }).bindTooltip(D.regimes.clusters[c].name).addTo(cellLayer));
      else if (D.trends) { const raw = S.mapMode === "raw"; D.trends.cells.forEach(([la, lo, sh, dh, sr, dr]) => { const sl = raw ? sr : sh, dd = raw ? dr : dh; L.rectangle([[la - .5, lo - .5], [la + .5, lo + .5]], { weight: .5, color: "#0a0e16", fillColor: TR_COL(dd, sl), fillOpacity: .75 }).bindTooltip(`${raw ? "Raw FIRMS" : "ClearCount"}: ${sl > 0 ? "+" : ""}${fmt(sl, 1)}%/yr${dd ? " (significant)" : " (not significant)"}`).addTo(cellLayer); }); }
      return;
    } if (typeof clearDay === "function" && dayLayer) clearDay();
    const i = S.sel, [, m] = ym(i), g = D.meta.grid / 2, by = [];
    for (const k of D.agg.sel) {
      const [la, lo, ms, hs] = D.cells[k]; const q = ms.indexOf(i); if (q < 0) continue;
      const v = hs[q]; const base = []; for (let y = BASE_Y0; y <= BASE_Y1; y++) { const j = ms.indexOf(idxOf(y, m)); base.push(j < 0 ? 0 : hs[j]); }
      let lt = 0, eq = 0; base.forEach((x) => { if (x < v) lt++; else if (x === v) eq++; });
      by.push([la, lo, v, (lt + .5 * eq) / base.length]);
    }
    by.forEach(([la, lo, v, p]) => L.rectangle([[la - g, lo - g], [la + g, lo + g]], { weight: 0, fillColor: pctColor(p), fillOpacity: .78 })
      .bindTooltip(`${fmt(v, 1)} harmonized hotspots · ${t("percentile")} ${fmt(p * 100, 0)}`).addTo(cellLayer));
  }

  // ---------- state changes ----------
  function setAOI(aoi, presetId) {
    S.aoi = aoi; S.preset = presetId; $("preset").value = presetId;
    const b = aoiBounds(); ["la0", "lo0", "la1", "lo1"].forEach((id, k) => ($(id).value = b[k].toFixed(2)));
    drawAOI(); aggregate(); renderAll(); writeHash();
    const nCells = D.agg.sel.length;
    $("aoiSummary").textContent = `${fmt(nCells, 0)} grid cells (0.25°) · ${fmt(d3.sum(D.agg.H), 0)} harmonized hotspots · ${fmt(d3.sum(D.agg.R), 0)} raw detections`;
  }
  function select(i, focus) {
    S.sel = i; renderNow(); renderYTD(); renderRegions(); renderML(); renderWeather(); renderCalendar(); renderRecords(); renderEvents(); renderMapCells(); renderDaily(); writeHash();
    if (focus) { const el = document.querySelector("#calendar rect.c.sel"); if (el) el.focus(); }
  }
  function renderAll() { renderNow(); renderYTD(); renderRegions(); renderML(); renderLC(); renderTrends(); renderWeather(); renderDaily(); renderCalendar(); renderRaw(); renderRecords(); renderSeason(); renderEvents(); renderHood(); renderDrift(); renderReported(); renderMapCells(); }

  function writeHash() {
    const b = aoiBounds(); const [y, m] = ym(S.sel);
    const h = new URLSearchParams({ p: S.preset, b: b.map((x) => x.toFixed(2)).join(","), m: `${y}-${String(m + 1).padStart(2, "0")}`, l: S.lang, mode: S.mode });
    history.replaceState(null, "", "#" + h.toString());
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1)); return { p: h.get("p"), b: h.get("b"), m: h.get("m"), l: h.get("l"), mode: h.get("mode") };
  }

  // ---------- i18n / modes / theme ----------
  function applyLang() {
    document.documentElement.lang = S.lang === "kk" ? "kk" : S.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    document.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
    $("langSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === S.lang));
    const sel = $("preset"); sel.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.name[S.lang] || p.name.en}</option>`).join("") + `<option value="custom">${t("preset_custom")}</option>`;
    sel.value = S.preset || "kz";
    $("dataUntil").textContent = `${t("data_until")} ${D.meta ? D.meta.end : ""}.`;
  }

  // ---------- exports ----------
  function download(name, text, type = "text/csv") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function exportCalendarCSV() {
    const A = D.agg; const lines = ["year,month,harmonized_hotspots,raw_firms_detections,percentile_vs_2003_2021,median_2003_2021,mean_2003_2021,cloudy_day_fraction,satellites_mostly_blind"];
    for (let y = S.y0; y <= S.y1; y++) for (let m = 0; m < 12; m++) { const i = idxOf(y, m); if (i < 0 || i >= D.n) continue;
      lines.push([y, m + 1, A.H[i].toFixed(2), A.R[i], pctRank(A.H[i], m).toFixed(3), A.med[m].toFixed(2), A.mean[m].toFixed(2), isFinite(A.B[i]) ? A.B[i].toFixed(2) : "", A.B[i] >= BLIND_HATCH ? 1 : 0].join(",")); }
    const b = aoiBounds();
    download(`clearcount_calendar_${S.preset}_${S.y0}-${S.y1}.csv`, `# ClearCount harmonized burning calendar | area bbox ${b.map((x) => x.toFixed(2)).join(",")} | unit: MODIS-Aqua-equivalent hotspots | source: NASA FIRMS SP + NASA POWER\n` + lines.join("\n"));
  }
  async function exportPointsCSV() {
    const btn = $("expPts"); const est = d3.sum(D.agg.R.filter((_, i) => { const [y] = ym(i); return y >= S.y0 && y <= S.y1; }));
    if (est > 800000 && !confirm(`This area and period contain about ${fmt(est, 0)} detections (a large file). Continue?`)) return;
    btn.disabled = true; const b = aoiBounds(), T = D.pidx.tile, out = [];
    let header = null, done = 0;
    const tiles = Object.entries(D.pidx.tiles).filter(([k]) => { const [a, c] = k.split("_").map(Number); return a + T >= b[0] && a <= b[2] && c + T >= b[1] && c <= b[3]; });
    const jobs = []; tiles.forEach(([k, ys]) => ys.filter((y) => y >= S.y0 && y <= S.y1).forEach((y) => jobs.push(`data/points/${k}_${y}.csv.gz`)));
    for (const url of jobs) {
      const txt = await getText(url); const rows = txt.split("\n"); if (!header) header = rows[0];
      for (let q = 1; q < rows.length; q++) { const r = rows[q]; if (!r) continue; const c1 = r.indexOf(","), c2 = r.indexOf(",", c1 + 1); const la = +r.slice(0, c1), lo = +r.slice(c1 + 1, c2); if (inAOI(la, lo)) out.push(r); }
      done++; btn.querySelector("small").textContent = `${done}/${jobs.length} files…`;
    }
    btn.disabled = false; btn.querySelector("small").textContent = t("exp_pts_s");
    download(`clearcount_hotspots_${S.preset}_${S.y0}-${S.y1}.csv`, (header || "") + "\n" + out.join("\n"));
  }
  function exportPNG() {
    const svg = document.querySelector("#calendar svg"); const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.querySelectorAll("text").forEach((el) => { el.setAttribute("fill", el.getAttribute("fill") || css("--muted")); el.setAttribute("font-family", "Inter, sans-serif"); });
    const w = +svg.getAttribute("width"), h = +svg.getAttribute("height") + 40, sc = 3;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", 8); title.setAttribute("y", +svg.getAttribute("height") + 28); title.setAttribute("fill", css("--text")); title.setAttribute("font-size", 12);
    title.textContent = `ClearCount · ${$("preset").selectedOptions[0].text} · ${S.y0}–${S.y1} · NASA FIRMS + POWER`; clone.appendChild(title); clone.setAttribute("height", h); clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const img = new Image(); const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    img.onload = () => { const c = document.createElement("canvas"); c.width = w * sc; c.height = h * sc; const x = c.getContext("2d"); x.fillStyle = css("--panel"); x.fillRect(0, 0, c.width, c.height); x.scale(sc, sc); x.drawImage(img, 0, 0); c.toBlob((bl) => { const a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = `clearcount_calendar_${S.preset}.png`; a.click(); }); URL.revokeObjectURL(url); };
    img.src = url;
  }

  // ---------- dialogs ----------
  function renderValidation() {
    const v = D.val, a = v.aqua_snpp, cls = (x, g, m) => (x >= g ? "good" : x >= m ? "meh" : "badc");
    const mt = (val, lbl, c = "") => `<div class="metric"><b class="mono ${c}">${val}</b><span>${lbl}</span></div>`;
    $("validationBody").innerHTML = `
      <p>All numbers below come from the pipeline run on the Kazakhstan record. Weak results are shown too, not only the strong ones. Test years were <strong>never used</strong> for fitting.</p>
      <h3>1 · VIIRS S-NPP → MODIS Aqua scale (train ${a.train_years.join("–")}, test ${a.test_years.join("–")})</h3>
      <div class="metric-grid">
        ${mt(a.test_hierarchical.r2_log, "R² (log) on test block-months, ClearCount", cls(a.test_hierarchical.r2_log, .8, .6))}
        ${mt(a.test_naive.r2_log, "R² (log), naive single ratio")}
        ${mt((a.test_hierarchical.bias_pct > 0 ? "+" : "") + a.test_hierarchical.bias_pct + "%", "total bias vs observed Aqua", cls(-Math.abs(a.test_hierarchical.bias_pct), -10, -20))}
        ${mt(a.kappa_p90_hierarchical.kappa, "Cohen's κ: months above p90, ClearCount", cls(a.kappa_p90_hierarchical.kappa, .6, .4))}
        ${mt(a.kappa_p90_naive.kappa, "Cohen's κ, naive ratio")}
        ${mt(a.test_hierarchical.spearman, "Spearman ρ, block-months")}
      </div>
      <p>National Aqua/S-NPP ratio: day <span class="mono">${a.national_ratio_day}</span>, night <span class="mono">${a.national_ratio_night}</span>. In other words, VIIRS sees about ${fmt(1 / a.national_ratio_day, 1)}× more daytime and ${fmt(1 / a.national_ratio_night, 1)}× more night-time hotspots than MODIS over Kazakhstan. We found <strong>no previously published MODIS/VIIRS ratio for Kazakhstan</strong> in our literature search.</p>
      <h3>2 · The 2012 step</h3>
      <div class="metric-grid">
        ${mt(v.step_2012.raw_all_sensors_vs_aqua, "raw sum of all sensors: log-ratio jump at Jan 2012", "badc")}
        ${mt(v.step_2012.harmonized_vs_aqua, "ClearCount: log-ratio jump at Jan 2012", cls(-Math.abs(v.step_2012.harmonized_vs_aqua), -.1, -.25))}
        ${mt(v.pettitt_2006_2017.raw_all.p_value < .001 ? "<0.001" : v.pettitt_2006_2017.raw_all.p_value, "Pettitt p, raw (change at " + v.pettitt_2006_2017.raw_all.change_point + ")")}
      </div>
      <p>The Pettitt change-point test on the ratio to Aqua (2006–2017) gives <span class="mono">p = ${v.pettitt_2006_2017.harmonized.p_value}</span> for ClearCount, against <span class="mono">${v.pettitt_2006_2017.raw_all.p_value < .001 ? "<0.001" : v.pettitt_2006_2017.raw_all.p_value}</span> for the raw sum. A large p means no significant step.</p>
      <h3>3 · Surviving the loss of Suomi NPP (2 Nov 2026)</h3>
      <div class="metric-grid">
        ${mt(v.noaa20_handover.test.r2_log, "R² (log): NOAA-20 → S-NPP, test 2024–25", cls(v.noaa20_handover.test.r2_log, .8, .6))}
        ${mt(v.continuity_snpp_to_noaa20.total_ratio_n20chain_over_snppchain, "NOAA-20 chain / S-NPP chain, total 2024–25 (1 = seamless)")}
        ${mt(v.continuity_snpp_to_noaa20.monthly_spearman, "monthly Spearman ρ between chains")}
      </div>
      <h3>4 · Terra-only bridge (Nov 2000 – Jun 2002)</h3>
      <div class="metric-grid">${mt(v.terra_bridge.test.r2_log, "R² (log), Terra → Aqua, test 2009–11", cls(v.terra_bridge.test.r2_log, .8, .6))}${mt(v.terra_bridge.test.bias_pct + "%", "bias")}${mt(fmt(v.counts.Aqua + v.counts.Terra + v.counts.N + v.counts.N20 + (v.counts.N21 || 0), 0), "landscape-fire detections used")}</div>
      ${v.looks ? `<h3>5 · Why does VIIRS see 5× more fires? (FIRMS swath outlines, ${fmt(333184, 0)} granules from NASA CMR)</h3>
      <div class="metric-grid">${mt(v.looks.detections_ratio_snpp_over_aqua + "×", "daytime detections, S-NPP ÷ Aqua")}${mt(v.looks.looks_ratio_snpp_over_aqua + "×", "more satellite looks (wider 3,040 km swath)")}${mt(v.looks.per_look_sensitivity_ratio + "×", "more detections per look (375 m sensitivity)")}</div>
      <p>The detection ratio is the looks ratio times the per-look sensitivity: ${v.looks.detections_ratio_snpp_over_aqua} = ${v.looks.looks_ratio_snpp_over_aqua} × ${v.looks.per_look_sensitivity_ratio}. In log terms, <b>${fmt(Math.log(v.looks.looks_ratio_snpp_over_aqua) / Math.log(v.looks.detections_ratio_snpp_over_aqua) * 100, 0)}%</b> of the gap comes from how often each satellite looks, and the rest from what it can see per look.</p>` : ""}
      ${D.drift ? `<h3>6 · Orbit-drift detector</h3><div class="metric-grid">${mt((D.drift.summary.aqua_change_pct > 0 ? "+" : "") + D.drift.summary.aqua_change_pct + "%", "Aqua counts by " + D.drift.summary.last_year + " (crossing +" + D.drift.summary.aqua_shift_hours + " h)", "meh")}${mt(D.drift.summary.terra_change_pct + "%", "Terra counts (crossing " + D.drift.summary.terra_shift_hours + " h)", "badc")}${mt(Math.round((D.drift.summary.placebo_noaa20_range[0] - 1) * 100) + "…+" + Math.round((D.drift.summary.placebo_noaa20_range[1] - 1) * 100) + "%", "placebo NOAA-20 range", "good")}</div><p>Both are measured relative to VIIRS S-NPP, whose orbit was maintained, against a 2012–2019 baseline. Opposite signs fit the afternoon fire peak. See the chart in Scientist mode.</p>` : ""}
      ${D.burned ? `<h3>7 · Independent check: NASA burned area (MCD64A1, Apr–Oct)</h3>
      <p>If harmonization works, hotspots per km² burned should stay flat when VIIRS arrives in 2012. The raw FIRMS sum should jump.</p>
      <table class="t mono"><thead><tr><th>year</th><th style="text-align:right">burned km²</th><th style="text-align:right">raw hotspots / 100 km²</th><th style="text-align:right">ClearCount / 100 km²</th></tr></thead><tbody>${D.burned.map((r) => `<tr><td>${r.year}</td><td style="text-align:right">${fmt(r.km2, 0)}</td><td style="text-align:right" class="badc">${fmt(r.raw_per_100km2, 0)}</td><td style="text-align:right" class="good">${fmt(r.harmonized_per_100km2, 1)}</td></tr>`).join("")}</tbody></table>
      <p>The raw ratio rises about <b>${fmt(d3.mean(D.burned.filter((r) => r.year > 2012), (r) => r.raw_per_100km2) / d3.mean(D.burned.filter((r) => r.year < 2012), (r) => r.raw_per_100km2), 1)}×</b> after 2012. ClearCount changes by <b>${fmt((d3.mean(D.burned.filter((r) => r.year > 2012), (r) => r.harmonized_per_100km2) / d3.mean(D.burned.filter((r) => r.year < 2012), (r) => r.harmonized_per_100km2) - 1) * 100, 0)}%</b>, which is within normal year-to-year variation. Burned area itself fell from ${fmt(D.burned[0].km2, 0)} km² (${D.burned[0].year}) to ${fmt(D.burned[D.burned.length - 1].km2, 0)} km² (${D.burned[D.burned.length - 1].year}), consistent with the published decline of Kazakh steppe fires (Hao et al. 2021).</p>` : ""}
      ${D.transfer ? `<h3>8 · Does it work outside Kazakhstan? Transfer test on Mongolia</h3>
      <p>We applied the ratios learned in Kazakhstan, unchanged, to Mongolia's VIIRS hotspots. We then compared the result with Mongolia's own MODIS Aqua record for 2012–2021, on 1° block-months.</p>
      <div class="metric-grid">${mt(D.transfer.kz_transfer_all.r2_log, "R² (log), Kazakhstan ratios in Mongolia", cls(D.transfer.kz_transfer_all.r2_log, .8, .6))}${mt((D.transfer.kz_transfer_all.bias_pct > 0 ? "+" : "") + D.transfer.kz_transfer_all.bias_pct + "%", "total bias, Kazakhstan ratios")}${mt((D.transfer.naive_all.bias_pct > 0 ? "+" : "") + D.transfer.naive_all.bias_pct + "%", "total bias, naive single ratio", "badc")}</div>
      <p>On 2018–2021 the Kazakhstan ratios reach R² ${D.transfer.kz_transfer_2018_21.r2_log}. Mongolia's own in-country calibration reaches ${D.transfer.mongolia_own_2018_21.r2_log}, so the transfer loses almost nothing. Yearly totals (observed Aqua vs ClearCount from VIIRS): ${D.transfer.yearly.slice(0, 5).map(([y, a, k]) => `${y}: ${fmt(a, 0)} vs ${fmt(k, 0)}`).join(" · ")}.</p>` : ""}
      ${D.bc ? `<h3>9 · How much fire did clouds hide?</h3>
      <p>Poisson gradient-boosted model trained on clear days. It predicts a day's harmonized hotspots from activity on the surrounding days, rain (NASA POWER), satellite passes (FIRMS swath outlines), season and the cell's history. It is then applied to cloud-blind days (≥70% cloud).</p>
      <div class="metric-grid">${mt(D.bc.test.r2_log_model, "R² (log), hidden clear days re-estimated (2019–25)", cls(D.bc.test.r2_log_model, .5, .35))}${mt(D.bc.test.r2_log_naive_interpolation, "R² (log), naive mean of neighbouring days")}${mt(fmt(D.bc.blind_share_fire_season * 100, 0) + "%", "fire-season days that were cloud-blind")}</div>
      <p>Artificial-blinding test: clear days in 2019–2025, never seen in training, were hidden and re-estimated. Total bias was ${D.bc.test.total_bias_model_pct > 0 ? "+" : ""}${D.bc.test.total_bias_model_pct}% and has been calibrated out. Estimated hidden share of fire-season hotspots: <b>≈${fmt(D.bc.hidden_share_pct, 0)}%</b> (${D.bc.hidden_share_range_pct.join("–")}% across model variants). <b>The decline in fires is not a cloud artifact.</b> The trend is ${D.bc.trend.observed_sen_pct_per_yr}%/yr observed and ${D.bc.trend.corrected_sen_pct_per_yr}%/yr cloud-corrected, both p < 0.001.</p>` : ""}
      <h3>What this does <em>not</em> prove</h3>
      <ul><li>The tests cover Kazakhstan and Mongolia (steppe, cropland and taiga edge). Tropical or boreal-forest regimes should be recalibrated on their own overlap years, which the pipeline does for any FIRMS country.</li><li>Cloud-hidden estimates assume fire behaves like on comparable clear days with similar rain. They are 1° and daily, so smaller areas inherit whole-cell estimates.</li><li>Aqua after 2021 is affected by orbit drift and is deliberately not used as a reference.</li></ul>`;
  }

  // ---------- init ----------
  async function init() {
    const hs = readHash(); if (hs.l && I18N[hs.l]) S.lang = hs.l; if (hs.mode) S.mode = hs.mode;
    applyLang();
    try { await loadAll(); } catch (e) { $("loading").innerHTML = `<p style="padding:20px">Could not load data (${e.message}). Run the pipeline first.</p>`; return; }
    const years = d3.range(2000, 2000 + Math.floor((D.meta.m0 + D.n - 1) / 12) + 1);
    ["y0", "y1"].forEach((id) => ($(id).innerHTML = years.map((y) => `<option>${y}</option>`).join("")));
    S.y1 = years[years.length - 1]; $("y0").value = S.y0; $("y1").value = S.y1;
    $("stYears").textContent = fmt((D.n) / 12, 0); $("stDet").textContent = fmt(D.val.counts_all || 0, 0);
    $("stFlare").textContent = D.val.flare_share != null ? fmt(D.val.flare_share * 100, 1) + "%" : "–";
    applyLang(); initMap();
    document.body.dataset.mode = S.mode; $("modeSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === S.mode));
    // initial AOI
    let pr = PRESETS.find((p) => p.id === (hs.p || "kz")) || PRESETS[0];
    S.sel = D.n - 1;
    if (hs.m) { const [y, m] = hs.m.split("-").map(Number); const i = idxOf(y, m - 1); if (i >= 0 && i < D.n) S.sel = i; }
    if (hs.p === "custom" && hs.b) { const b = hs.b.split(",").map(Number); setAOI({ type: "bbox", b }, "custom"); }
    else setAOI({ type: "bbox", b: pr.bbox }, pr.id);
    const fitNow = () => { map.invalidateSize(); const b = aoiBounds(); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [16, 16] }); };
    fitNow(); setTimeout(fitNow, 450);
    renderValidation(); renderFindings(); $("aboutBody").innerHTML = ABOUT[S.lang];

    // events
    $("preset").addEventListener("change", (e) => {
      const p = PRESETS.find((q) => q.id === e.target.value); if (!p) return;
      S._autoDay = false; if (p.case) { const [y, m] = p.case.month.split("-").map(Number); S.sel = idxOf(y, m - 1); }
      setAOI({ type: "bbox", b: p.bbox }, p.id); map.flyToBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: [20, 20], duration: .8 });
    });
    $("btnFit").addEventListener("click", () => { const b = aoiBounds(); map.flyToBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [20, 20] }); });
    $("coordForm").addEventListener("submit", (e) => { e.preventDefault(); const v = ["la0", "lo0", "la1", "lo1"].map((id) => parseFloat($(id).value)); if (v.some(isNaN) || v[0] >= v[2] || v[1] >= v[3]) { alert("Enter lat min < lat max and lon min < lon max"); return; } setAOI({ type: "bbox", b: v }, "custom"); map.flyToBounds([[v[0], v[1]], [v[2], v[3]]]); });
    ["y0", "y1"].forEach((id) => $(id).addEventListener("change", () => { S.y0 = +$("y0").value; S.y1 = Math.max(S.y0, +$("y1").value); $("y1").value = S.y1; renderAll(); }));
    $("viewSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.view = b.dataset.view; $("viewSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderCalendar(); });
    $("modeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.mode = b.dataset.mode; document.body.dataset.mode = S.mode; $("modeSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderHood(); renderDrift(); writeHash(); });
    $("langSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.lang = b.dataset.lang; applyLang(); $("aboutBody").innerHTML = ABOUT[S.lang]; renderAll(); renderFindings(); writeHash(); });
    $("chkFlares").addEventListener("change", (e) => (e.target.checked ? flareLayer.addTo(map) : map.removeLayer(flareLayer)));
    $("btnTheme").addEventListener("click", () => { const r = document.documentElement; const cur = r.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); r.dataset.theme = cur === "light" ? "dark" : "light"; try { localStorage.setItem("cc-theme", r.dataset.theme); } catch (_) {} setBasemap(); renderAll(); });
    $("btnValidation").addEventListener("click", () => $("dlgValidation").showModal());
    let playTimer = null, stampCtl = null;
    const stopPlay = () => { clearInterval(playTimer); playTimer = null; $("btnPlay").setAttribute("aria-pressed", "false"); if (stampCtl) { map.removeControl(stampCtl); stampCtl = null; } select(S.sel); };
    $("btnPlay").addEventListener("click", () => {
      if (playTimer) { stopPlay(); return; }
      if (S.mapMode !== "month") $("mapMode").querySelector('[data-mm="month"]').click();
      $("btnPlay").setAttribute("aria-pressed", "true");
      stampCtl = L.control({ position: "topright" }); stampCtl.onAdd = () => { const d = L.DomUtil.create("div", "tl-stamp"); d.id = "tlStamp"; return d; }; stampCtl.addTo(map);
      let i = Math.max(0, idxOf(S.y0, 0)); const end = Math.min(D.n - 1, idxOf(S.y1, 11));
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      playTimer = setInterval(() => {
        S.sel = i; renderMapCells();
        const [yy, mm] = ym(i), v = D.agg.H[i];
        const st = document.getElementById("tlStamp"); if (st) st.innerHTML = `${MONTHS[S.lang][mm]} ${yy}<small>${v > 0 ? `${fmt(v, 0)} harmonized hotspots · percentile ${fmt(pctRank(v, mm) * 100, 0)}` : "no fires detected"}</small>`;
        if (++i > end) stopPlay();
      }, reduce ? 600 : 170);
    });
    $("mapMode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.id === "btnPlay") return; S.mapMode = b.dataset.mm; $("mapMode").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); if (S.mapMode !== "month") map.flyToBounds([[40.5, 46.4], [55.5, 87.4]], { padding: [10, 10], duration: .6 }); renderMapCells(); });
    $("btnShare").addEventListener("click", () => {
      const toast = (msg) => { const tt = document.createElement("div"); tt.className = "toast"; tt.setAttribute("role", "status"); tt.textContent = msg; document.body.appendChild(tt); setTimeout(() => tt.remove(), 2200); };
      try { navigator.clipboard.writeText(location.href).then(() => toast("Link copied"), () => toast(location.href)); } catch (_) { toast(location.href); }
    });
    $("btnAbout").addEventListener("click", () => $("dlgAbout").showModal());
    document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
    $("expCal").addEventListener("click", exportCalendarCSV); $("expPts").addEventListener("click", exportPointsCSV);
    $("expPng").addEventListener("click", exportPNG); $("expPdf").addEventListener("click", () => { document.title = `ClearCount report — ${$("preset").selectedOptions[0].text}`; window.print(); });
    let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { renderRaw(); renderSeason(); renderHood(); renderDrift(); renderYTD(); }, 200); });
    // small API for the guided story (story.js)
    window.CC = {
      lang: () => S.lang,
      go(presetId, month, mode) {
        const p = PRESETS.find((q) => q.id === presetId) || PRESETS[0];
        if (mode && mode !== S.mode) { S.mode = mode; document.body.dataset.mode = mode; $("modeSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.mode === mode)); }
        S._autoDay = false;
        if (month) { const [yy, mm] = month.split("-").map(Number); S.sel = idxOf(yy, mm - 1); } else S.sel = D.n - 1;
        S.y0 = 2001; S.y1 = 2000 + Math.floor((D.meta.m0 + D.n - 1) / 12); $("y0").value = S.y0; $("y1").value = S.y1;
        setAOI({ type: "bbox", b: p.bbox }, p.id);
        map.flyToBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: [16, 16], duration: .7 });
      },
      openValidation: () => $("dlgValidation").showModal(),
      setMapMode: (mm) => { const b = $("mapMode").querySelector(`[data-mm="${mm}"]`); if (b && S.mapMode !== mm) b.click(); },
    };
    if (window.Story) window.Story.init();
    const l = $("loading"); l.style.opacity = 0; setTimeout(() => l.remove(), 400);
  }
  try { const th = localStorage.getItem("cc-theme"); if (th) document.documentElement.dataset.theme = th; } catch (_) {}
  document.addEventListener("DOMContentLoaded", init);
})();
