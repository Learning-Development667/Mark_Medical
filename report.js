/* The Notes for the team report (since v117), from the approved design
   (clinical-summary-report.html, October 2026). reportHtml(R) turns the data the app prepares
   (buildTwoPage() in scripts.js) into a complete A4 HTML document: page 1 the latest new symptom,
   eight tiles, the medicines strip, Steady and the questions with room to write; page 2 the
   charts and the weekly cards. Nothing in here works anything out from the readings: every
   number arrives in R already calculated. fitReport() writes it into an iframe and checks that the
   pages fit. Since v236 nothing is ever cut short or left out: what page 1 or page 2 cannot hold
   (the weeks, the questions, last of all the latest note) moves to pages after the second, and
   spillTail() carries those on page after page. Only the writing lines under each question shrink,
   from three to one. If something still does not fit it fails and names the section.
   UK English, no em dashes. */

const C = { ink: '#17263A', slate: '#5B6B7C', line: '#D5DEE5', teal: '#1E7F86', amber: '#E0A030', red: '#C8453B', green: '#3F8F6B' };
export const REPORT_COLOURS = C;

const CSS = `
:root{
  --ink:#17263A; --slate:#5B6B7C; --mist:#EEF3F6; --line:#D5DEE5;
  --teal:#1E7F86; --teal-soft:#DDEEEF;
  --amber:#E0A030; --amber-soft:#FBF0D9;
  --red:#C8453B; --red-soft:#F8E1DE;
  --green:#3F8F6B; --green-soft:#E1F1E9;
}
*{box-sizing:border-box;margin:0;padding:0}
html{background:#9AA7B2;-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{font-family:Inter,"Segoe UI",Arial,sans-serif;color:var(--ink);font-size:8.6pt;line-height:1.38;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.01em}
@page{size:A4;margin:0}
.page{width:210mm;height:297mm;margin:10mm auto;background:#fff;padding:9mm 11mm 7mm;display:flex;flex-direction:column;gap:3.4mm;overflow:hidden;position:relative;box-shadow:0 6px 30px rgba(0,0,0,.25)}
html.capture{background:#fff}
html.capture .page{margin:0;box-shadow:none}
.bar{position:sticky;top:0;z-index:2;display:flex;gap:12px;justify-content:center;align-items:center;padding:10px 16px;background:#17263A;color:#fff;font-size:15px}
.bar button{font:600 16px Inter,Arial,sans-serif;min-height:44px;padding:0 20px;border-radius:22px;border:0;background:#fff;color:#17263A;cursor:pointer}
@media print{html{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}.bar{display:none}}
.masthead{display:flex;justify-content:space-between;align-items:flex-end;gap:6mm;padding-bottom:2.6mm;border-bottom:1.6px solid var(--ink)}
.masthead h1{font-size:21pt;line-height:1.05}
.titlerow{display:flex;align-items:baseline;flex-wrap:wrap;column-gap:3mm;row-gap:.6mm}
.madeby{font-size:8.6pt;color:var(--slate);white-space:nowrap}
.madeby b{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:10.5pt;color:var(--teal)}
.masthead .sub{color:var(--slate);font-size:8.6pt;margin-top:1.5mm}
.who{text-align:right;font-size:8pt;color:var(--slate);line-height:1.5;flex:none}
.who strong{display:block;color:var(--ink);font-size:11pt;font-family:Fraunces,Georgia,serif;font-weight:600}
.runner{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:2mm;border-bottom:1.2px solid var(--ink)}
.runner h2{font-size:13pt}
.runner span{color:var(--slate);font-size:7.6pt}
h2.sec{font-size:12.5pt;display:flex;align-items:baseline;gap:3mm}
h2.sec small{font-family:Inter,sans-serif;font-weight:400;font-size:7.6pt;color:var(--slate);letter-spacing:0}
.latest{display:flex;gap:4mm;align-items:center;background:var(--red-soft);border-left:1.6mm solid var(--red);border-radius:0 2mm 2mm 0;padding:2.4mm 4mm}
.latest b{font-family:Fraunces,Georgia,serif;font-size:10.5pt;display:block;margin-bottom:.4mm}
.latest .when{flex:none;font-weight:600;color:var(--red);font-size:8pt;width:19mm;line-height:1.25}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:2.6mm}
.tile{border-radius:2mm;padding:2.4mm 3.2mm 2.2mm;background:var(--mist);border-top:1.1mm solid var(--line);min-height:17.5mm;display:flex;flex-direction:column;justify-content:space-between}
.tile.red{background:var(--red-soft);border-top-color:var(--red)}
.tile.amber{background:var(--amber-soft);border-top-color:var(--amber)}
.tile.green{background:var(--green-soft);border-top-color:var(--green)}
.tile .k{font-size:7.4pt;color:var(--slate);font-weight:500}
.tile .v{font-family:Fraunces,Georgia,serif;font-size:16pt;line-height:1.05;margin:.8mm 0}
.tile .v em{font-style:normal;font-size:8.5pt;font-family:Inter,sans-serif;font-weight:500;color:var(--slate);margin-left:.6mm}
.tile .n{font-size:7.4pt;line-height:1.3}
.strip{display:grid;grid-template-columns:1.25fr 1fr;gap:2.6mm}
.strip.one{grid-template-columns:1fr}
.strip>div{border:1px solid var(--line);border-radius:2mm;padding:2.6mm 3.2mm;font-size:7.8pt;line-height:1.45}
.strip b{font-weight:600}
.strip .steady{background:var(--green-soft);border-color:transparent}
.qwrap{flex:1;display:flex;flex-direction:column;min-height:0}
.qgrid{display:grid;grid-template-columns:1fr 1fr;gap:3mm;flex:1;grid-auto-rows:1fr}
.q{border:1px solid var(--line);border-radius:2.4mm;padding:2.4mm 3.6mm 1.8mm;display:flex;flex-direction:column;background:#fff;min-height:0}
.q.wide{grid-column:1/-1}
.q header{display:flex;gap:2.6mm;align-items:flex-start}
.q .no{flex:none;min-width:6.4mm;height:6.4mm;padding:0 1mm;border-radius:3.2mm;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:600;font-size:8pt;margin-top:.2mm}
.q h3{font-family:Inter,sans-serif;font-size:8.7pt;font-weight:600;letter-spacing:0;line-height:1.35}
.q .by{font-size:7pt;color:var(--slate);margin-top:.6mm}
.q .team{display:inline-block;font-size:6.6pt;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--teal);background:var(--teal-soft);border-radius:1.4mm;padding:.3mm 1.6mm;margin-bottom:.8mm}
.q .lines{flex:1;margin-top:1.2mm;position:relative;overflow:hidden}
.q .lines i{position:absolute;left:0;right:0;height:0;border-top:1px solid var(--line)}
.q.extra{background:var(--teal-soft);border-color:transparent}
.q.extra .no{background:var(--teal)}
.q.extra .lines i{border-top-color:rgba(30,127,134,.35)}
.more{font-size:7.2pt;color:var(--slate);margin-top:1.6mm}
.qwrap .none{font-size:9pt;color:var(--slate);margin:0 0 2.4mm}
.cgrid{display:grid;grid-template-columns:1fr 1fr;gap:2.6mm}
.c{border:1px solid var(--line);border-radius:2.2mm;padding:1.8mm 3mm 1.2mm;position:relative}
.c .h{display:flex;justify-content:space-between;align-items:baseline;gap:2mm}
.c h3{font-family:Inter,sans-serif;font-size:8pt;font-weight:600;letter-spacing:0}
.c .stat{font-size:7.2pt;font-weight:600;padding:.3mm 1.8mm;border-radius:10mm;background:var(--mist);color:var(--ink);white-space:nowrap}
.c .stat.red{background:var(--red-soft);color:var(--red)}
.c .stat.amber{background:var(--amber-soft);color:#8A5E10}
.c .stat.green{background:var(--green-soft);color:var(--green)}
.c svg{display:block;width:100%;height:auto;margin-top:.6mm}
.key{grid-column:1/-1;background:var(--mist);border-color:transparent;font-size:7pt;line-height:1.4;color:var(--slate);display:flex;flex-wrap:wrap;align-items:center;column-gap:5mm;row-gap:.6mm;padding:1.8mm 3.4mm}
.key.half{grid-column:auto;align-content:center}
.c .blegend{display:flex;flex-wrap:wrap;column-gap:3mm;row-gap:.4mm;font-size:6.6pt;color:var(--slate);margin-top:.6mm}
.c .blegend i{display:inline-block;width:3.4mm;height:1.6mm;border-radius:.5mm;margin-right:1mm;vertical-align:middle}
.key b{color:var(--ink);font-weight:600}
.sw{display:inline-block;width:3mm;height:3mm;border-radius:.6mm;vertical-align:-.5mm;margin-right:1.4mm}
.wwrap{flex:1;display:flex;flex-direction:column;min-height:0}
.weeks{display:grid;grid-template-columns:1fr 1fr;gap:3mm;flex:1;min-height:0}
.week{border-radius:2.4mm;background:var(--mist);padding:2.4mm 3.4mm;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.week.wide{grid-column:1/-1}
.week .wh{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.6mm}
.week h3{font-size:10.5pt}
.week .wh span{font-size:7.2pt;color:var(--slate)}
.week .theme{font-size:7.6pt;font-weight:500;margin-bottom:1.8mm;padding-bottom:1.6mm;border-bottom:1px solid var(--line)}
.week ul{list-style:none;display:flex;flex-direction:column;gap:1mm}
.week li{display:grid;grid-template-columns:11.5mm 1fr;gap:1.6mm;font-size:7.5pt;line-height:1.33}
.week li time{font-weight:600;color:var(--teal)}
.week li.alert time{color:var(--red)}
.week li.alert{background:var(--red-soft);margin:0 -1.6mm;padding:.8mm 1.6mm;border-radius:1mm}
.week .ai{font-size:6.6pt;color:var(--slate);margin-top:auto;padding-top:1.4mm}
.week .none{color:var(--slate)}
.foot{display:flex;justify-content:space-between;font-size:6.6pt;color:var(--slate);border-top:1px solid var(--line);padding-top:1.6mm;margin-top:auto;align-items:baseline;gap:4mm}
.foot .made{white-space:nowrap}
.foot .made b{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:7.6pt;color:var(--teal)}
.qwrap.nat{flex:none}
.qgrid.nat{flex:none;grid-auto-rows:auto}
.weeks.nat{display:flex;flex-direction:column;flex:none;gap:3mm}
.week.nat{flex:none;overflow:visible}
.tailh{margin:.6mm 0 0}
.carerbox{flex:none;background:#FBF3EC;border-left:1.2mm solid #C2703D;border-radius:0 2.4mm 2.4mm 0}
.carerbox li time{color:#9A5527}
.carerbox li b{font-weight:600}
.carerbox li .cmood{display:block}
.carerbox li .ctext{display:block;margin-top:.4mm}
.fxbox{flex:none;background:#FBF6EA;border-left:1.2mm solid #E0A030;border-radius:0 2.4mm 2.4mm 0}
.fxbox li time{color:#8A5E10}
.fxbox li b{font-weight:600}
.fxbox li .cmood{display:block}
.fxbox li .ctext{display:block;margin-top:.4mm}
.tail .more{margin:0}
`;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const num = (v) => (Math.round(v * 10) / 10).toString();

/* One chart, as in the design: a config per chart (title, pill, tone, axis, bands, series), drawn
   as SVG. A null in a series is a day with no reading, which breaks the line. */
export function renderChart(cfg, days) {
  const W = 300, H = 96, L = 22, R = 6, T = 6, B = 14;
  const pw = W - L - R, ph = H - T - B, n = days.length;
  const x = (i) => L + (n === 1 ? pw / 2 : i * pw / (n - 1));
  const span = cfg.max - cfg.min || 1;
  const y = (v) => T + ph - ((v - cfg.min) / span) * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title + '. ' + cfg.stat)}">`;
  (cfg.bands || []).forEach((b) => {
    const top = Math.min(b.to, cfg.max), bottom = Math.max(b.from, cfg.min);
    if (top <= bottom) return;
    s += `<rect x="${L}" y="${y(top).toFixed(1)}" width="${pw}" height="${(y(bottom) - y(top)).toFixed(1)}" fill="${b.c}" opacity=".16"/>`;
  });
  cfg.ticks.forEach((t) => {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${C.line}" stroke-width=".6"/>`;
    s += `<text x="${L - 3}" y="${(y(t) + 2.4).toFixed(1)}" font-size="6.4" fill="${C.slate}" text-anchor="end">${esc(cfg.tickFmt ? cfg.tickFmt(t) : t)}</text>`;
  });
  const marks = n <= 1 ? [0] : [...new Set([0, 0.23, 0.46, 0.69, 1].map((f) => Math.round(f * (n - 1))))];
  marks.forEach((i) => {
    const anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
    s += `<text x="${x(i).toFixed(1)}" y="${H - 3}" font-size="6.2" fill="${C.slate}" text-anchor="${anchor}">${esc(days[i])}</text>`;
  });
  /* small marks under the plot for the days passed in cfg.marks (treatment sessions on the mood chart, v155) */
  (cfg.marks || []).forEach((i) => { if (i >= 0 && i < n) s += `<path d="M${(x(i) - 1.6).toFixed(1)} ${(T + ph + 2.2).toFixed(1)} L${(x(i) + 1.6).toFixed(1)} ${(T + ph + 2.2).toFixed(1)} L${x(i).toFixed(1)} ${(T + ph - 0.4).toFixed(1)} Z" fill="${C.ink}"/>`; });
  /* small teal dots below those for the days in cfg.dots (fasting days on the Crohn's bowel chart, v258) */
  (cfg.dots || []).forEach((i) => { if (i >= 0 && i < n) s += `<circle cx="${x(i).toFixed(1)}" cy="${(T + ph + 4.6).toFixed(1)}" r="1.15" fill="${cfg.dotC || C.teal}"/>`; });
  const any = cfg.series.some((se) => se.d.some((v) => v != null));
  if (!any) {
    s += `<text x="${L + pw / 2}" y="${T + ph / 2 + 2}" font-size="7" fill="${C.slate}" text-anchor="middle">No readings in this period</text>`;
  } else if (cfg.type === 'stack') {
    /* stacked bars, one colour per series from the bottom up (v286, the bowel chart on Notes for the team) */
    const bw = Math.max(1.2, Math.min(14, pw / n * 0.62));
    for (let i = 0; i < n; i++) {
      let base = 0;
      cfg.series.forEach((se) => {
        const v = se.d[i];
        if (!v) return;
        const top = y(Math.min(base + v, cfg.max)), bot = y(Math.min(base, cfg.max));
        s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bot - top).toFixed(1)}" fill="${se.c}"/>`;
        base += v;
      });
    }
  } else if (cfg.type === 'bars') {
    const bw = Math.max(1.2, Math.min(14, pw / n * 0.62));
    cfg.series[0].d.forEach((v, i) => {
      if (v == null) return;
      const col = cfg.flagBelow && v < cfg.flagBelow ? C.amber : cfg.series[0].c;
      const top = y(Math.min(v, cfg.max));
      s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(cfg.min) - top).toFixed(1)}" rx="1" fill="${col}"/>`;
    });
  } else {
    const r = n > 60 ? 0.9 : n > 31 ? 1.2 : 1.6;
    cfg.series.forEach((se) => {
      let d = '', pen = false;
      /* The line runs from reading to reading across days with none (v152): the dots mark the readings, the line
         only joins them, as the app's own charts do; a gap read as a broken chart, not as a day with nothing logged */
      se.d.forEach((v, i) => { if (v == null) return; d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true; });
      /* se.hollow: points alone, as rings (readings between the check-ins, v289); se.dash: a dashed line */
      if (!se.hollow) s += `<path d="${d}" fill="none" stroke="${se.c}" stroke-width="1.5"${se.dash ? ' stroke-dasharray="3 2"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      se.d.forEach((v, i) => { if (v != null) s += se.hollow ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r + 0.4}" fill="#fff" stroke="${se.c}" stroke-width="1"/>` : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" fill="${se.c}"/>`; });
    });
  }
  return s + '</svg>';
}

function lines(n) {
  let s = '';
  for (let i = 1; i <= n; i++) s += `<i style="top:calc(${i} * 4.6mm)"></i>`;
  return s;
}

function tileHtml(t) {
  return `<div class="tile ${esc(t.tone || '')}" data-k="${esc(t.k)}"><div class="k">${esc(t.k)}</div><div class="v">${esc(t.v)}${t.unit ? `<em>${esc(t.unit)}</em>` : ''}</div><div class="n">${esc(t.note)}</div></div>`;
}

/* A question card: who it is for as a small label (v133; a number until then), the question, who asked it and when, then ruled lines to write the reply */
function questionHtml(q, extra) {
  return `<article class="q${extra ? ' extra' : ''}" data-sec="${extra ? 'Other points' : 'Question ' + esc(q.i)}"><header>${extra ? '<div class="no">+</div>' : ''}<div>${q.team ? `<div class="team">${esc(q.team)}</div>` : ''}<h3>${esc(q.text)}</h3><div class="by">${esc(q.by)}</div></div></header><div class="lines" style="min-height:${(q.lines || 1) * 4.6 + 2.4}mm">${lines(40)}</div></article>`;
}

function weekHtml(w, wide, o = {}) {
  const from = o.from || 0, to = o.to == null ? w.entries.length : o.to;
  const shown = w.entries.slice(from, to);
  const items = w.entries.length
    ? `<ul>${shown.map((e) => `<li${e.alert ? ' class="alert"' : ''}><time>${esc(e.when)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>`
    : '<p class="none">No written notes this week.</p>';
  const last = to >= w.entries.length;
  return `<div class="week${wide ? ' wide' : ''}${o.nat ? ' nat' : ''}" data-sec="${esc(w.title)}"${o.ti == null ? '' : ` data-ti="${o.ti}"`}><div class="wh"><h3>${esc(w.title)}${from ? ' <small>(continued)</small>' : ''}</h3><span>${esc(w.range)}</span></div>${w.theme && !from ? `<div class="theme">${esc(w.theme)}</div>` : ''}${items}${w.foot && last ? `<p class="ai">${esc(w.foot)}</p>` : ''}</div>`;
}

/* The carer's own mood scores and observations, kept apart from the patient's (v237). C: { title, range, summary, note,
   days: [{ when, moods, texts: [string] }] }. Every observation is printed whole; a long list carries on, headed "continued". */
function carerHtml(C, o = {}) {
  const cls = o.cls || 'carerbox';
  const from = o.from || 0, to = o.to == null ? C.days.length : o.to;
  const shown = C.days.slice(from, to);
  const last = to >= C.days.length;
  const items = `<ul>${shown.map((d) => `<li><time>${esc(d.when)}</time><span>${d.moods ? `<b class="cmood">${esc(d.moods)}</b>` : ''}${d.texts.map((t) => `<span class="ctext">${esc(t)}</span>`).join('')}</span></li>`).join('')}</ul>`;
  return `<div class="week ${cls} wide${o.nat ? ' nat' : ''}" data-sec="${esc(C.title)}"${o.ti == null ? '' : ` data-ti="${o.ti}"`}><div class="wh"><h3>${esc(C.title)}${from ? ' <small>(continued)</small>' : ''}</h3><span>${esc(C.range)}</span></div>${C.summary && !from ? `<div class="theme">${esc(C.summary)}</div>` : ''}${items}${C.note && last ? `<p class="ai">${esc(C.note)}</p>` : ''}</div>`;
}

/* The pages after the two fixed ones (since v236). Nothing on a report is cut short: whatever page 1 or page 2
   cannot hold is laid out here, page after page, in the order it was moved: the latest note when page 1 could
   not hold it, the questions that did not fit, then the weekly notes (a long week carries on, headed
   "continued"). R.tailPages is [[item, ...], ...] and is changed by spillTail() until every page fits. */
function tailItems(R) {
  const items = [];
  if (R.latestMoved && R.latest) items.push({ k: 'l' });
  (R.extraQ || []).forEach((_, n) => items.push({ k: 'q', n }));
  if (R.weeksPage3) R.weeks.forEach((w, n) => items.push({ k: 'w', n, from: 0, to: w.entries.length }));
  if (R.fx && R.fxTail) items.push({ k: 'f', from: 0, to: R.fx.days.length });
  if (R.carer && R.carerTail) items.push({ k: 'c', from: 0, to: R.carer.days.length });
  return items;
}
export function tailPagesOf(R) {
  if (!R.tailPages) { const items = tailItems(R); R.tailPages = items.length ? [items] : []; }
  return R.tailPages;
}
function tailPageHtml(R, items, p, total) {
  let body = '', qs = [], seenQ = false, seenW = false;
  const flushQ = () => {
    if (!qs.length) return;
    body += `${seenQ ? '' : '<h2 class="sec tailh" style="margin-bottom:2.4mm">More questions for the team <small>Space is left under each one to write the reply.</small></h2>'}<div class="qwrap nat" data-sec="More questions"><div class="qgrid nat">${qs.join('')}</div></div>`;
    seenQ = true; qs = [];
  };
  items.forEach((it, ti) => {
    if (it.k === 'q') {
      const q = R.extraQ[it.n];
      qs.push(questionHtml({ ...q, i: R.questions.length + it.n + 1, lines: Math.max(R.lines, 3) }, false).replace(/data-sec="Question /, `data-ti="${ti}" data-sec="More question `));
      return;
    }
    flushQ();
    if (it.k === 'f') {
      body += `<div class="weeks nat">${carerHtml(R.fx, { nat: true, ti, from: it.from, to: it.to, cls: 'fxbox' })}</div>`;
      return;
    }
    if (it.k === 'c') {
      body += `<div class="weeks nat">${carerHtml(R.carer, { nat: true, ti, from: it.from, to: it.to })}</div>`;
      return;
    }
    if (it.k === 'l') {
      const L = R.latest;
      body += `<div class="latest" data-ti="${ti}" data-sec="Latest"><div class="when">${esc(L.when1)}<br>${esc(L.when2)}</div><div><b>${esc(L.title)}</b>${esc(L.text)}</div></div>`;
      return;
    }
    if (!seenW) body += `<h2 class="sec tailh" style="margin-bottom:2.4mm">Week by week <small>${esc(R.weeksNote || 'Each week summarised from the daily notes.')}</small></h2>`;
    seenW = true;
    body += `<div class="weeks nat">${weekHtml(R.weeks[it.n], true, { nat: true, ti, from: it.from, to: it.to })}</div>`;
  });
  flushQ();
  const kinds = new Set(items.map((i) => i.k));
  const hasQ = kinds.has('q') || kinds.has('l'), hasW = kinds.has('w'), hasC = kinds.has('c');
  let base = hasQ && hasW ? 'More questions, and the weekly notes' : hasQ ? 'More questions for the team' : hasW ? (p > 0 ? 'Weekly notes, continued' : 'Weekly notes') : '';
  if (kinds.has('f')) base = base ? 'Side effects after treatment, and ' + base.charAt(0).toLowerCase() + base.slice(1) : 'Side effects after treatment';
  const title = hasC ? (base ? base + ", and the carer's view" : "The carer's view") : base;
  return `<section class="page tail" id="page${3 + p}">
  <div class="runner"><h2>${title}</h2><span>${esc(R.patient)} · ${esc(R.period)}</span></div>
  ${body}
  <div class="foot"><span>${esc(R.foot)}</span>${madeBy(3 + p, total)}</div>
</section>`;
}

/* R: { title, subtitle, patient, period, prepared, latest?, tiles[8], meds, hospital?, steady?,
   questions[{ team, text, by }], more, lines, otherBy, charts[], days[], weeks[], foot, bar? } */
/* A chart's key, under it inside its card (v289; the Pain report too since v322). c.legend: [{ c: colour or
   'amber'/'red' for the band shades, t: words, dot?, ring?, line?, tri? (a treatment-session triangle) }] */
function chartLegend(c) {
  const AMB = 'rgba(224,160,48,.45)', RD = 'rgba(200,69,59,.45)';
  const sw = (it) => it.c === 'amber' ? AMB : it.c === 'red' ? RD : it.c;
  if (!c.legend || !c.legend.length) return '';
  return `<div class="blegend">${c.legend.map((it) => it.tri
    ? `<span><i style="width:0;height:0;border-radius:0;background:none;border-left:1.2mm solid transparent;border-right:1.2mm solid transparent;border-bottom:1.8mm solid ${it.c || '#17263A'}"></i>${esc(it.t)}</span>`
    : `<span><i style="background:${it.ring ? '#fff' : sw(it)}${it.ring ? ';width:1.8mm;height:1.8mm;border-radius:50%;box-sizing:border-box;border:.25mm solid ' + sw(it) : it.dot ? ';width:1.6mm;height:1.6mm;border-radius:50%' : it.line ? ';height:.7mm' : ''}"></i>${esc(it.t)}</span>`).join('')}</div>`;
}

export function reportHtml(R) {
  const strip = [];
  const medsHtml = `<div data-sec="Medicines"><b>When-needed medicines.</b> ${esc(R.meds)}${R.hospital ? `<br><b>${esc(R.hospital.label)}</b> ${esc(R.hospital.text)}` : ''}</div>`;
  strip.push(medsHtml);
  if (R.sideFx) strip.push(`<div data-sec="Side effects"><b>${R.fx ? 'Other side effects logged.' : 'Side effects logged.'}</b> ${esc(R.sideFx)}</div>`);
  if (R.results) strip.push(`<div data-sec="Results"><b>Results, as the team gave them.</b> ${esc(R.results)}</div>`);
  if (R.steady) strip.push(`<div class="steady" data-sec="Steady"><b>Steady.</b> ${esc(R.steady)}</div>`);
  const qs = R.questions.map((q, i) => questionHtml({ ...q, i: i + 1, lines: R.lines }, false));
  /* No "Other points from today" card since v272 (Mark: not needed); an odd last question takes the full width */
  if (qs.length % 2) qs[qs.length - 1] = qs[qs.length - 1].replace('class="q"', 'class="q wide"');
  /* Pages after the second (v207, v236): whatever pages 1 and 2 cannot hold is laid out after them, never cut.
     Questions moved there keep their numbers on from page 1. */
  const tail = tailPagesOf(R);
  const total = 2 + tail.length;
  const extraN = (R.extraQ || []).length;
  const olderLine = R.older ? `<p class="more">${esc(R.older === 1 ? '1 older question is' : R.older + ' older questions are')} still open in the app, asked before ${esc(R.olderFrom || 'this period')}.</p>` : '';
  const noneLine = R.questions.length ? '' : '<p class="none" data-sec="No questions">No new questions this time.</p>';
  /* Every chart carries its own key under it, inside its card (v287 for the bowels, v289 for all, Mark: "the key to the
     chart should sit underneath the chart and be inside the same rectangle"). c.legend: [{ c: colour, t: words, dot?, ring?, line? }] */
  const legend = chartLegend;
  const charts = R.charts.map((c) => `<div class="c" data-sec="${esc(c.title)}"><div class="h"><h3>${esc(c.title)}</h3><span class="stat ${esc(c.tone || '')}">${esc(c.stat)}</span></div>${renderChart(c, R.days)}${legend(c)}</div>`).join('');
  const key = '';
  const weeks = R.weeks.length ? R.weeks.map((w) => weekHtml(w, R.weeks.length === 1)).join('')
    : weekHtml({ title: 'Notes', range: R.period, theme: '', entries: [] }, true).replace('No written notes this week.', 'No written notes in this period.');
  const weeksHtml = `<div class="wwrap" data-sec="Week by week">
    <h2 class="sec" style="margin-bottom:2.4mm">Week by week <small>${esc(R.weeksNote || 'Each week summarised from the daily notes.')}</small></h2>
    <div class="weeks">${weeks}</div>
  </div>`;
  const bar = R.bar ? `<div class="bar"><span>${esc(R.bar)}</span><button type="button" onclick="window.print()">Print or save as PDF</button></div>` : '';
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${esc(R.title)} | ${esc(R.patient)} | ${esc(R.period)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
${bar}
<section class="page" id="page1">
  <div class="masthead" data-sec="Masthead">
    <div><div class="titlerow"><h1>${esc(R.title)}</h1><span class="madeby">Created with <b>My Medical Daybook</b></span></div><div class="sub">${esc(R.subtitle)}</div></div>
    <div class="who"><strong>${esc(R.patient)}</strong>Period: ${esc(R.period)}<br>Prepared: ${esc(R.prepared)}</div>
  </div>
  ${R.latest && !R.latestMoved ? `<div class="latest" data-sec="Latest"><div class="when">${esc(R.latest.when1)}<br>${esc(R.latest.when2)}</div><div><b>${esc(R.latest.title)}</b>${esc(R.latest.text)}</div></div>` : ''}
  <div data-sec="At a glance">
    <h2 class="sec" style="margin-bottom:2.4mm">At a glance <small>Averages for the period. Every reading is on the charts on page 2. Not medical advice.</small></h2>
    <div class="tiles">${R.tiles.map(tileHtml).join('')}</div>
  </div>
  <div class="strip${strip.length === 1 ? ' one' : ''}">${strip.join('')}</div>
  <div class="qwrap${R.questions.length ? '' : ' nat'}" data-sec="Questions">
    <h2 class="sec" style="margin-bottom:2.4mm">Questions for the team <small>Space is left under each one to write the reply.</small></h2>
    ${noneLine}<div class="qgrid">${qs.join('')}</div>
    ${extraN ? `<p class="more">${esc(extraN === 1 ? 'One more question' : extraN + ' more questions')} on page 3.</p>` : ''}
    ${R.latestMoved ? '<p class="more">The latest note is in full on page 3.</p>' : ''}
    ${olderLine}
  </div>
  ${R.carer && R.carerPage1 ? carerHtml(R.carer) : ''}
  <div class="foot"><span>${esc(R.foot)}</span>${madeBy(1, total)}</div>
</section>
<section class="page" id="page2">
  <div class="runner"><h2>${R.weeksPage3 ? 'Readings' : 'Readings and weekly notes'}</h2><span>${esc(R.patient)} · ${esc(R.period)}</span></div>
  <div class="cgrid" data-sec="Charts">${charts}${key}</div>
  ${R.fx && !R.fxTail ? carerHtml(R.fx, { cls: 'fxbox' }) : ''}
  ${R.weeksPage3 ? '' : weeksHtml}
  ${R.carer && !R.carerTail && !R.carerPage1 ? carerHtml(R.carer) : ''}
  <div class="foot"><span>${esc(R.foot)}</span>${madeBy(2, total)}</div>
</section>
${tail.map((items, p) => tailPageHtml(R, items, p, total)).join('\n')}
</body>
</html>`;
}

/* The credit on every page, beside the page number (v139, Mark: the reports go to clinicians and
   dietitians, so they say where they came from), and right after the title on page 1 (v140, Mark: the
   first thing the reader sees, so they start asking what the app is). The full name, as on the cover. */
const madeBy = (n, total = 2) => `<span class="made">Created with <b>My Medical Daybook</b> · Page ${n} of ${total}</span>`;

/* Which sections run past their space: anything whose bottom passes the top of its page's foot,
   a card whose own content is taller than the card, or a page whose content is taller than A4.
   The pages after the second are laid out by spillTail() and are not judged here. */
export function overflowOf(doc) {
  const out = [];
  doc.querySelectorAll('.page:not(.tail)').forEach((page) => {
    const foot = page.querySelector('.foot');
    const limit = foot.getBoundingClientRect().top + 0.5;
    page.querySelectorAll('[data-sec]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > limit || el.scrollHeight > el.clientHeight + 1) out.push(el.dataset.sec);
    });
    if (page.scrollHeight > page.clientHeight + 1 && !out.length) out.push('Page ' + page.id.replace('page', ''));
  });
  return [...new Set(out)];
}

/* Where the content of a page may reach: the page's bottom less its padding, the foot and the gap above it */
function pageLimit(doc, page) {
  const cs = doc.defaultView.getComputedStyle(page);
  const foot = page.querySelector('.foot').getBoundingClientRect();
  return page.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - foot.height - (parseFloat(cs.rowGap) || 0) - 1;
}

/* Moves whatever runs past a tail page's end onto the next page, and says whether it changed anything: the
   first item (or entry of a week) that does not fit starts the next page. Returns 'stuck' when one item alone is
   taller than a page. Used by the Notes for the team and the Food diary alike (items carry data-ti). */
export function spillTail(doc, R) {
  const pages = [...doc.querySelectorAll('.page.tail')];
  for (let p = 0; p < pages.length; p++) {
    const limit = pageLimit(doc, pages[p]);
    const bad = [...pages[p].querySelectorAll('[data-ti]')].find((e) => e.getBoundingClientRect().bottom > limit);
    if (!bad) continue;
    const idx = Number(bad.dataset.ti);
    const items = R.tailPages[p];
    const it = items[idx];
    if ((it.k === 'w' || it.k === 'c') && it.to - it.from > 1) {
      let keep = [...bad.querySelectorAll('li')].filter((li) => li.getBoundingClientRect().bottom <= limit).length;
      if (!keep && !idx) keep = 1;
      if (keep && keep < it.to - it.from) {
        const after = items.splice(idx);
        items.push({ ...it, to: it.from + keep });
        (R.tailPages[p + 1] = R.tailPages[p + 1] || []).unshift({ ...it, from: it.from + keep }, ...after.slice(1));
        return true;
      }
    }
    if (!idx) return 'stuck';
    (R.tailPages[p + 1] = R.tailPages[p + 1] || []).unshift(...items.splice(idx));
    return true;
  }
  return false;
}

/* One step of making room for the sections that ran over; false when nothing more can give. Nothing is ever
   cut short or left out (v236, Mark: "if you cant read the full content the thing is pointless"): the weeks move
   to the pages after the second, then page 1 gives up its writing lines and its questions, and last of all the
   latest note, which is then printed in full after them. */
export function shrink(R, over) {
  /* The carer's area (v237) gives way first, and uses the space there is (v275, Mark: "always create an efficient
     report using space to its best"): if page 2 is full it tries page 1, under the questions, where a short list of
     questions leaves room; only when page 1 cannot hold it either does it move whole to the pages after the second.
     The weeks stay where they were. */
  if (R.carer && !R.carerTail && !R.carerPage1 && over.some((s) => s === R.carer.title || s === 'Week by week' || s === 'Page 2' || R.weeks.some((w) => w.title === s))) {
    R.carerPage1 = true; R.tailPages = null; return true;
  }
  if (R.carer && R.carerPage1 && over.some((s) => s === R.carer.title || /^Question|^Questions|^No questions|^Page 1|^Medicines|^Steady|^Latest|^Side effects|^Results/.test(s))) {
    R.carerPage1 = false; R.carerTail = true; R.tailPages = null; return true;
  }
  if (!R.weeksPage3 && R.weeks.some((w) => over.includes(w.title) || over.includes('Week by week') || over.includes('Page 2') || (R.fx && over.includes(R.fx.title)))) {
    R.weeksPage3 = true; R.tailPages = null; return true;
  }
  /* the side effects after treatment (v289) stay on page 2 under the charts until the weeks have gone; then they move too */
  if (R.fx && !R.fxTail && R.weeksPage3 && over.some((s) => s === R.fx.title || s === 'Page 2' || s === 'Charts')) {
    R.fxTail = true; R.tailPages = null; return true;
  }
  const page1 = over.some((s) => /^Question|^Other points|^Questions|^No questions|^Page 1|^Medicines|^Steady|^Latest|^Side effects|^Results/.test(s));
  if (page1) {
    if (R.lines > 2) { R.lines -= 1; return true; }
    if (R.questions.length) { R.extraQ = R.extraQ || []; R.extraQ.unshift(R.questions.pop()); R.tailPages = null; return true; }
    if (R.lines > 1) { R.lines -= 1; return true; }
    if (R.latest && !R.latestMoved) { R.latestMoved = true; R.tailPages = null; return true; }
  }
  return false;
}

/* Writes the report into the iframe until it fits; resolves { ok, R, doc } or { ok: false, over } */
export async function fitReport(frame, R, opts = {}) {
  const write = (html) => new Promise((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = html;
  });
  for (let i = 0; i < 120; i++) {
    await write((opts.html || reportHtml)(R));
    const doc = frame.contentDocument;
    doc.documentElement.classList.add('capture');
    if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, opts.fontWait || 3000))]);
    const over = overflowOf(doc);
    if (!over.length) {
      const spilled = spillTail(doc, R);
      if (spilled === 'stuck') return { ok: false, over: ['A page after the second'], R, doc };
      if (spilled) continue;
      return { ok: true, R, doc };
    }
    if (!(opts.shrink || shrink)(R, over)) return { ok: false, over, R, doc };
  }
  return { ok: false, over: ['Report'], R };
}

/* ------------------------------------------------------------------ */
/* The two-page Food diary (since v119), from the approved design      */
/* (food-diary-report.html). The same page, type and colours as Notes  */
/* for the team. Every figure arrives in F already worked out          */
/* (buildFoodReport() in scripts.js); here it is only drawn.            */
/* ------------------------------------------------------------------ */
const FOOD_CSS = `
body.food .banner{display:flex;gap:4mm;align-items:center;background:var(--teal-soft);border-left:1.6mm solid var(--teal);border-radius:0 2mm 2mm 0;padding:2.4mm 4mm}
body.food .banner b{font-family:Fraunces,Georgia,serif;font-size:10.5pt;display:block;margin-bottom:.4mm}
body.food .banner .when{flex:none;font-weight:600;color:var(--teal);font-size:8pt;width:19mm;line-height:1.25}
body.food .tile{padding:2.6mm 3.2mm 2.4mm;min-height:21mm}
body.food .tile .v{font-size:18pt}
body.food .tile .v em{margin-left:.8mm}
.card{border:1px solid var(--line);border-radius:2.4mm;padding:2.6mm 3.4mm}
.card svg{display:block;width:100%;height:auto}
.cardhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1mm;gap:2mm}
.cardhead h3{font-family:Inter,sans-serif;font-size:8.4pt;font-weight:600;letter-spacing:0}
.cardhead span{font-size:7pt;color:var(--slate)}
.two{flex:1;display:grid;grid-template-columns:1.2fr 1fr;gap:3mm;min-height:0}
.col{display:flex;flex-direction:column;gap:3mm;min-height:0}
.grow{flex:1;display:flex;flex-direction:column;min-height:0}
.matrix{display:grid;grid-template-columns:19mm 1fr 10mm;column-gap:1.4mm;row-gap:.9mm;align-items:center}
.matrix .lab{font-size:7.3pt;white-space:nowrap}
.matrix .cnt{font-size:7pt;color:var(--slate);text-align:right;white-space:nowrap}
.matrix .cells{display:grid;gap:.7mm}
.matrix .cells i{aspect-ratio:1;border-radius:.7mm;background:var(--mist)}
.matrix .cells i.on{background:var(--teal)}
.matrix .cells i.warn{background:var(--amber)}
.matrix .days{font-size:5.4pt;color:var(--slate);text-align:center;line-height:1}
.matrix .grp{grid-column:1/-1;font-size:7pt;font-weight:600;color:#8A5E10;margin-top:1mm}
.matrix .grp.good{color:var(--teal)}
.note{font-size:6.8pt;color:var(--slate);line-height:1.4;margin-top:2mm}
.pts{background:var(--mist);border-radius:2.4mm;padding:2.8mm 3.4mm}
.pts h3{font-size:10.5pt;margin-bottom:1.8mm}
.pts ul{list-style:none;display:flex;flex-direction:column;gap:1.4mm}
.pts li{display:grid;grid-template-columns:2.6mm 1fr;gap:1.6mm;font-size:7.7pt;line-height:1.38}
.pts li::before{content:"";width:1.7mm;height:1.7mm;border-radius:50%;background:var(--amber);margin-top:1.4mm}
.dq{background:var(--surface,#fff);border:1px solid var(--line);border-radius:2.4mm;padding:2.8mm 3.4mm}
.dq h3{font-size:10.5pt;margin-bottom:1.8mm}
.dq ul{list-style:none;display:flex;flex-direction:column;gap:1.6mm}
.dq li{font-size:7.7pt;line-height:1.38}
.dq li b{display:block;font-weight:600}
.dq li span{font-size:7pt;color:var(--slate)}
.dq .more,.pts .more{font-size:7pt;color:var(--slate);margin-top:1.4mm}
.pts.nat,.dq.nat{flex:none}
.dq.nat+.pts.nat,.pts.nat+.dq.nat{margin-top:0}
.nlines{background:var(--teal-soft);border-radius:2.4mm;padding:2.8mm 3.4mm;display:flex;flex-direction:column;flex:1;min-height:14mm}
.nlines h3{font-family:Inter,sans-serif;font-size:8.4pt;font-weight:600;letter-spacing:0}
.nlines .lines{flex:1;margin-top:1.4mm;position:relative;overflow:hidden}
.nlines .lines i{position:absolute;left:0;right:0;height:0;border-top:1px solid rgba(30,127,134,.35)}
body.food .c .stat.amber{background:var(--amber-soft);color:#8A5E10}
.sw.hatch{background:#1E7F86;overflow:hidden;vertical-align:-.5mm}
.c.key svg.sw{display:inline-block;width:3mm;height:3mm;margin:0 1.4mm 0 0}
.pills{display:flex;gap:1.4mm;flex-wrap:wrap;margin-bottom:1.6mm}
.pills span{font-size:6.8pt;font-weight:600;background:#fff;border-radius:10mm;padding:.3mm 2mm}
body.food .week{padding:2.8mm 3.4mm}
body.food .week .wh{margin-bottom:1.2mm}
body.food .week .theme{font-size:8.2pt}
.chips{display:grid;grid-template-columns:repeat(7,1fr);gap:1mm;margin-bottom:2mm}
.chip{border-radius:1.4mm;padding:1.6mm .4mm;text-align:center;font-size:6pt;line-height:1.25;background:#fff;color:var(--slate);border:1px solid transparent}
.chip b{display:block;font-size:8pt;color:var(--ink);font-weight:600}
.chip.met{background:var(--green-soft)}
.chip.met b{color:var(--green)}
.chip.near{background:var(--teal-soft)}
.chip.na{background:var(--mist);border:1px solid var(--line)}
.chip.part{background:#fff;border:1px dashed var(--slate)}
.chip.none{background:transparent;border:1px solid var(--line)}
body.food .week ul{gap:2mm}
body.food .week li{grid-template-columns:13mm 1fr;gap:1.8mm;font-size:8.2pt;line-height:1.4}
.often{background:#fff;border-radius:2mm;padding:2.2mm 3mm;margin-top:auto}
.often h4{font-family:Inter,sans-serif;font-size:7.6pt;font-weight:600;margin-bottom:1mm}
.often ul{gap:.8mm}
body.food .often li{display:block;font-size:7.8pt;line-height:1.35;padding-left:3mm;position:relative}
.often li::before{content:"";position:absolute;left:0;top:1.3mm;width:1.5mm;height:1.5mm;border-radius:50%;background:var(--teal)}
body.food .foot{gap:6mm}
`;

/* Hatching drawn as plain white lines across a bar. Never an SVG <pattern> or an SVG picture as a CSS
   background: iPhone Safari marks a canvas drawn with those as unsafe, and the PDF then fails with
   "The operation is insecure" (Mark's Food diary, v121). */
function hatchLines(x, y, w, h) {
  let s = '';
  for (let k = -h; k < w; k += 3) {
    const t0 = Math.max(0, -k / h), t1 = Math.min(1, (w - k) / h);
    if (t1 <= t0) continue;
    s += `<line x1="${(x + k + h * t0).toFixed(2)}" y1="${(y + h - h * t0).toFixed(2)}" x2="${(x + k + h * t1).toFixed(2)}" y2="${(y + h - h * t1).toFixed(2)}" stroke="#fff" stroke-width="1.1" opacity=".85"/>`;
  }
  return s;
}
/* Bars, one per day, from a config: max, ticks, get, colour, hatch, values above, a dashed line, a note */
export function foodBars(o, D, uid) {
  const W = o.W, H = o.H, L = o.L || 24, R = 6, T = o.T || 8, B = 13, pw = W - L - R, ph = H - T - B, n = D.length;
  const x = (i) => L + (i + 0.5) * pw / n, bw = pw / n * 0.64;
  const y = (v) => T + ph - (Math.min(v, o.max) / o.max) * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">`;
  o.ticks.forEach((t) => {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${C.line}" stroke-width=".6"/>`;
    s += `<text x="${L - 3}" y="${(y(t) + 2.4).toFixed(1)}" font-size="6.4" fill="${C.slate}" text-anchor="end">${esc(o.tickFmt ? o.tickFmt(t) : t)}</text>`;
  });
  const any = D.some((d) => o.get(d) != null);
  if (!any) s += `<text x="${L + pw / 2}" y="${T + ph / 2}" font-size="7" fill="${C.slate}" text-anchor="middle">${esc(o.empty || 'Nothing to show in this period')}</text>`;
  else D.forEach((d, i) => {
    const v = o.get(d);
    if (v == null) {
      if (d.leftOut) s += `<text x="${x(i).toFixed(1)}" y="${y(o.max * 0.08).toFixed(1)}" font-size="9" fill="${C.slate}" text-anchor="middle">?</text>`;
      return;
    }
    const h = Math.max(0, y(0) - y(v));
    s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.2" fill="${o.color(v, d, i)}"/>`;
    if (o.hatch && o.hatch(d)) s += hatchLines(x(i) - bw / 2, y(v), bw, h);
    if (o.values) s += `<text x="${x(i).toFixed(1)}" y="${(y(v) - 2.2).toFixed(1)}" font-size="6.2" fill="${C.ink}" stroke="#fff" stroke-width="2.4" paint-order="stroke" text-anchor="middle" font-weight="600">${esc(o.fmt ? o.fmt(v) : v)}</text>`;
  });
  if (o.line) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(o.line.v).toFixed(1)}" y2="${y(o.line.v).toFixed(1)}" stroke="${C.ink}" stroke-width=".9" stroke-dasharray="3 2.4"/>`;
    s += `<text x="${W - R}" y="${(y(o.line.v) - 2.4).toFixed(1)}" font-size="6.4" fill="${C.ink}" text-anchor="end" font-weight="600">${esc(o.line.t)}</text>`;
  }
  if (o.callout && D[o.callout.i]) {
    const i = o.callout.i, right = x(i) + bw / 2 + 3, leftSide = right > W - 110;
    s += `<text x="${(leftSide ? x(i) - bw / 2 - 3 : right).toFixed(1)}" y="${T + 9}" font-size="6.2" fill="${C.slate}" text-anchor="${leftSide ? 'end' : 'start'}">${esc(o.callout.t)}</text>`;
  }
  const marks = !n ? [] : o.all ? D.map((_, i) => i) : [...new Set([0, 0.33, 0.66, 1].map((f) => Math.round(f * (n - 1))))];
  marks.forEach((i) => { s += `<text x="${x(i).toFixed(1)}" y="${H - 3}" font-size="${o.all ? 5.6 : 6.2}" fill="${C.slate}" text-anchor="middle">${esc(o.all ? D[i].short : D[i].label)}</text>`; });
  return s + '</svg>';
}
/* Protein, carbs and fat stacked, one bar a day */
function stackedMacros(D, uid) {
  const W = 300, H = 138, L = 24, R = 6, T = 8, B = 13, pw = W - L - R, ph = H - T - B, n = D.length;
  const top = Math.max(200, ...D.map((d) => (d.p == null ? 0 : d.p + d.c + d.f)));
  const max = Math.ceil(top / 200) * 200;
  const x = (i) => L + (i + 0.5) * pw / n, bw = pw / n * 0.64, y = (v) => T + ph - (v / max) * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Protein, carbs and fat each day">`;
  [0, max / 2, max].forEach((t) => { s += `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${C.line}" stroke-width=".6"/><text x="${L - 3}" y="${(y(t) + 2.4).toFixed(1)}" font-size="6.4" fill="${C.slate}" text-anchor="end">${t}</text>`; });
  if (!D.some((d) => d.p != null)) s += `<text x="${L + pw / 2}" y="${T + ph / 2}" font-size="7" fill="${C.slate}" text-anchor="middle">No food totals in this period</text>`;
  D.forEach((d, i) => {
    if (d.p == null) { if (d.leftOut) s += `<text x="${x(i).toFixed(1)}" y="${y(max * 0.08).toFixed(1)}" font-size="9" fill="${C.slate}" text-anchor="middle">?</text>`; return; }
    let base = 0;
    [[d.p, C.teal], [d.c, '#8FA6B8'], [d.f, C.amber]].forEach(([v, c]) => { s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(base) - y(base + v)).toFixed(1)}" fill="${c}"/>`; base += v; });
    if (d.u > 0 || d.partial) s += hatchLines(x(i) - bw / 2, y(base), bw, y(0) - y(base));
  });
  (n ? [...new Set([0, 0.33, 0.66, 1].map((f) => Math.round(f * (n - 1))))] : []).forEach((i) => { s += `<text x="${x(i).toFixed(1)}" y="${H - 3}" font-size="6.2" fill="${C.slate}" text-anchor="middle">${esc(D[i].label)}</text>`; });
  return s + '</svg>';
}

function foodWeekHtml(w, wide, o = {}) {
  const from = o.from || 0, to = o.to == null ? w.entries.length : o.to, first = !from, last = to >= w.entries.length;
  const chips = w.chips.map((c) => `<div class="chip ${c.cls}">${esc(c.top)}<b>${esc(c.val)}</b></div>`).join('');
  const items = w.entries.length ? `<ul>${w.entries.slice(from, to).map((e) => `<li><time>${esc(e.when)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>` : '<p class="none">Nothing logged this week.</p>';
  const often = w.often.length && last ? `<div class="often"><h4>What came up most</h4><ul>${w.often.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<div class="week${wide ? ' wide' : ''}${o.nat ? ' nat' : ''}" data-sec="${esc(w.title)}"${o.ti == null ? '' : ` data-ti="${o.ti}"`}><div class="wh"><h3>${esc(w.title)}${from ? ' <small>(continued)</small>' : ''}</h3><span>${esc(w.range)}</span></div>${first && w.pills.length ? `<div class="pills">${w.pills.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}${first && w.theme ? `<div class="theme">${esc(w.theme)}</div>` : ''}${first && chips ? `<div class="chips">${chips}</div>` : ''}${items}${often}</div>`;
}

/* The pages after the second (v236): the dietitian questions and points to discuss that page 1 could not hold,
   then the weeks when page 2 could not hold them. Same machinery as the Notes for the team (spillTail()). */
function foodTailItems(F) {
  const items = [];
  (F.extraQ || []).forEach((_, n) => items.push({ k: 'dq', n }));
  (F.extraPts || []).forEach((_, n) => items.push({ k: 'pt', n }));
  if (F.weeksPage3) F.weeks.forEach((w, n) => items.push({ k: 'w', n, from: 0, to: w.entries.length }));
  return items;
}
function foodTailPages(F) {
  if (!F.tailPages) { const items = foodTailItems(F); F.tailPages = items.length ? [items] : []; }
  return F.tailPages;
}
function foodTailPageHtml(F, items, p, total) {
  let body = '', dq = [], pts = [], seenDq = false, seenPt = false, seenW = false;
  const flush = () => {
    if (dq.length) { body += `<div class="dq nat" data-sec="Questions">${seenDq ? '' : '<h3>More questions for the dietitian</h3>'}<ul>${dq.join('')}</ul></div>`; seenDq = true; dq = []; }
    if (pts.length) { body += `<div class="pts nat" data-sec="Points to discuss">${seenPt ? '' : '<h3>More points to discuss</h3>'}<ul>${pts.join('')}</ul></div>`; seenPt = true; pts = []; }
  };
  items.forEach((it, ti) => {
    if (it.k === 'dq') { if (pts.length) flush(); const q = F.extraQ[it.n]; dq.push(`<li data-ti="${ti}"><b>${esc(q.text)}</b><span>${esc(q.by)}</span></li>`); return; }
    if (it.k === 'pt') { if (dq.length) flush(); pts.push(`<li data-ti="${ti}">${esc(F.extraPts[it.n])}</li>`); return; }
    flush();
    if (!seenW) body += '<h2 class="sec tailh" style="margin-bottom:2.2mm">Week by week <small>Weeks match Notes for the team. Chips show protein in grams each day.</small></h2>';
    seenW = true;
    body += `<div class="weeks nat">${foodWeekHtml(F.weeks[it.n], true, { nat: true, ti, from: it.from, to: it.to })}</div>`;
  });
  flush();
  const kinds = new Set(items.map((i) => i.k));
  const hasText = kinds.has('dq') || kinds.has('pt'), hasW = kinds.has('w');
  const title = hasText && hasW ? 'More to discuss, and the weekly summary' : hasText ? 'More to discuss' : (p > 0 ? 'Weekly summary, continued' : 'Weekly summary');
  return `<section class="page tail" id="page${3 + p}">
  <div class="runner"><h2>${title}</h2><span>${esc(F.patient)} · ${esc(F.period)}</span></div>
  ${body}
  <div class="foot"><span>Food diary</span>${madeBy(3 + p, total)}</div>
</section>`;
}

/* F: { patient, logged, prepared, period, banner { when1, when2, title, text }, tiles[4], days[] ({ label, short, p, k, c, f, l, e, u, partial, leftOut }),
   target, callout?, grid { labels[], rows[{ n, g, s }] , days }, points[], weeks[], foot, bar? } */
export function foodReportHtml(F) {
  const D = F.days;
  const target = F.target;
  const protein = foodBars({ W: 640, H: 150, L: 24, T: 12, max: F.pMax, ticks: F.pTicks, label: 'Protein each day', get: (d) => d.p, values: D.length <= 21, all: D.length <= 21,
    color: (v) => (target && v >= target ? C.green : C.teal), hatch: (d) => d.u > 0 || d.partial, line: target ? { v: target, t: 'Target ' + target + ' g' } : null, callout: F.callout,
    empty: 'No protein figures. Switch on the calorie and macro estimates in Settings, or add day totals from a food app.' }, D, 'p');
  const drinks = foodBars({ W: 300, H: 152, max: F.lMax, ticks: F.lTicks, label: 'Drinks each day', get: (d) => d.l, color: (v) => (v >= 4 ? C.amber : '#8FA6B8'), hatch: (d) => d.partial, line: { v: 4, t: '4 L' }, empty: 'No drinks logged' }, D, 'l');
  const G = F.grid;
  let grid = '';
  if (G.rows.length) {
    const cols = `grid-template-columns:repeat(${G.days.length},1fr)`;
    grid = `<div></div><div class="cells days" style="${cols}">${G.days.map((d) => `<span>${esc(d)}</span>`).join('')}</div><div></div>`;
    let last = '';
    G.rows.forEach((t) => {
      if (t.g !== last) { grid += `<div class="grp ${t.g === 'good' ? 'good' : ''}">${t.g === 'good' ? 'Food groups' : 'Worth a look (per 100 g of each food)'}</div>`; last = t.g; }
      const cells = t.s.split('').map((c) => `<i class="${c === '1' ? (t.g === 'good' ? 'on' : 'warn') : ''}"></i>`).join('');
      const n = t.s.split('').filter((c) => c === '1').length;
      grid += `<div class="lab">${esc(t.n)}</div><div class="cells" style="${cols}">${cells}</div><div class="cnt">${n} of ${t.s.length}</div>`;
    });
  }
  const charts = F.charts.map((c) => `<div class="c" data-sec="${esc(c.title)}"><div class="h"><h3>${esc(c.title)}</h3><span class="stat ${esc(c.tone || '')}">${esc(c.stat)}</span></div>${c.svg}</div>`).join('');
  const key = `<div class="c key"><b>Key</b><span><svg class="sw hatch" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" fill="#1E7F86"/>${hatchLines(0, 0, 12, 12)}</svg>Hatched: some items had no nutrition data, or the day is still in progress, so the total may be low</span>${D.some((d) => d.leftOut) ? '<span><b>?</b> totals left out (see Points to discuss)</span>' : ''}<span><i class="sw" style="background:#1E7F86"></i>Protein <i class="sw" style="background:#8FA6B8;margin-left:2mm"></i>Carbs <i class="sw" style="background:#E0A030;margin-left:2mm"></i>Fat</span></div>`;
  const tail = foodTailPages(F);
  const total = 2 + tail.length;
  const extraQn = (F.extraQ || []).length, extraPn = (F.extraPts || []).length;
  const weeks = F.weeks.length ? F.weeks.map((w) => foodWeekHtml(w, F.weeks.length === 1)).join('')
    : foodWeekHtml({ title: 'Food', range: F.period, pills: [], theme: '', chips: [], entries: [], often: [] }, true);
  const bar = F.bar ? `<div class="bar"><span>${esc(F.bar)}</span><button type="button" onclick="window.print()">Print or save as PDF</button></div>` : '';
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Food diary | ${esc(F.patient)} | ${esc(F.period)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}${FOOD_CSS}</style>
</head>
<body class="food">
${bar}
<section class="page" id="page1">
  <div class="masthead" data-sec="Masthead">
    <div><div class="titlerow"><h1>Food diary</h1><span class="madeby">Created with <b>My Medical Daybook</b></span></div><div class="sub">What was eaten and drunk, summarised for the dietitian, nurse or doctor.</div></div>
    <div class="who"><strong>${esc(F.patient)}</strong>Logged: ${esc(F.logged)}<br>Prepared: ${esc(F.prepared)}</div>
  </div>
  <div class="banner" data-sec="Banner"><div class="when">${esc(F.banner.when1)}<br>${esc(F.banner.when2)}</div><div><b>${esc(F.banner.title)}</b>${esc(F.banner.text)}</div></div>
  <div class="tiles" data-sec="Tiles">${F.tiles.map(tileHtml).join('')}</div>
  <div class="card" data-sec="Protein chart"><div class="cardhead"><h3>${esc(target ? 'Protein each day against the ' + target + ' g target' : 'Protein each day')}</h3><span>${esc(target ? 'Green: target met' : 'No target set')}</span></div>${protein}</div>
  <div class="two">
    <div class="col">
      <div class="card" data-sec="Food groups"><div class="cardhead"><h3>Food groups, day by day</h3><span>${esc(G.span)}</span></div>${grid ? `<div class="matrix">${grid}</div>` : '<p class="note">No foods matched the food table in this period.</p>'}<div class="note">Tags follow UK food label rules per 100 g of each food, not portion sizes. A protein tag means a protein food was eaten, not that the target was met.</div></div>
      <div class="card grow" data-sec="Drinks chart"><div class="cardhead"><h3>Drinks each day (litres)</h3><span>Amber: 4 L or over</span></div>${drinks}</div>
    </div>
    <div class="col">
      <div class="pts" data-sec="Points to discuss"><h3>Points to discuss</h3><ul>${F.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>${extraPn ? `<p class="more">${esc(extraPn === 1 ? 'One more point' : extraPn + ' more points')} on page 3.</p>` : ''}</div>
      ${(F.questions && F.questions.length) || extraQn ? `<div class="dq" data-sec="Questions"><h3>Questions for the dietitian</h3>${F.questions && F.questions.length ? `<ul>${F.questions.map((q) => `<li><b>${esc(q.text)}</b><span>${esc(q.by)}</span></li>`).join('')}</ul>` : ''}${extraQn ? `<p class="more">${esc(extraQn === 1 ? 'One more question' : extraQn + ' more questions')} on page 3.</p>` : ''}</div>` : ''}
      <div class="nlines" data-sec="Dietitian notes"><h3>Notes from the dietitian</h3><div class="lines">${(() => { let l = ''; for (let i = 1; i <= 40; i++) l += `<i style="top:calc(${i} * 5.2mm)"></i>`; return l; })()}</div></div>
    </div>
  </div>
  <div class="foot"><span>${esc(F.caveat)}</span>${madeBy(1, total)}</div>
</section>
<section class="page" id="page2">
  <div class="runner"><h2>${F.weeksPage3 ? 'Trends' : 'Trends and weekly summary'}</h2><span>${esc(F.patient)} · ${esc(F.period)}</span></div>
  <div class="cgrid" data-sec="Charts">${charts}${key}</div>
  ${F.weeksPage3 ? '' : `<div class="wwrap" data-sec="Week by week">
    <h2 class="sec" style="margin-bottom:2.2mm">Week by week <small>Weeks match Notes for the team. Chips show protein in grams each day.</small></h2>
    <div class="weeks">${weeks}</div>
  </div>`}
  <div class="foot"><span>Food diary</span>${madeBy(2, total)}</div>
</section>
${tail.map((items, p) => foodTailPageHtml(F, items, p, total)).join('\n')}
</body>
</html>`;
}
export function foodChartSvg(kind, D, o) {
  if (kind === 'stacked') return stackedMacros(D, o.uid);
  return foodBars(o, D, o.uid);
}
/* One step of making room for the Food diary; nothing is cut (v236): the weeks move to the pages after the
   second, then the dietitian questions and the points to discuss that page 1 cannot hold go there too */
export function shrinkFood(F, over) {
  if (!F.weeksPage3 && F.weeks.some((w) => over.includes(w.title) || over.includes('Week by week') || over.includes('Page 2'))) { F.weeksPage3 = true; F.tailPages = null; return true; }
  if (over.some((s) => /Points|Questions|Page 1|Food groups|Drinks|Dietitian/.test(s))) {
    if (F.questions && F.questions.length) { F.extraQ = F.extraQ || []; F.extraQ.unshift(F.questions.pop()); F.tailPages = null; return true; }
    if (F.points.length > 1) { F.extraPts = F.extraPts || []; F.extraPts.unshift(F.points.pop()); F.tailPages = null; return true; }
  }
  return false;
}


/* ------------------------------------------------------------------ */
/* Medicine history (v142, the look rebuilt in v143 from Mark's design, */
/* report/meds-design.pdf in the scratchpad): four tiles, then Taking   */
/* now as one table grouped Regular and When needed, each row with a    */
/* bar of the last 14 days, then Finished, stopped and given in         */
/* hospital as one table with a status label above each name, then a    */
/* panel of ruled lines for the team's medicine changes. Unlike the two */
/* reports it is as many A4 pages as it needs: fitMedsReport() measures */
/* the rows in the frame and moves whatever passes a page's foot onto   */
/* the next page, repeating the table heading there. Every figure       */
/* arrives in M already worked out (buildMedsReport() in scripts.js).   */
/* ------------------------------------------------------------------ */
const MEDS_CSS = `
.tile.teal{background:var(--teal-soft);border-top-color:var(--teal)}
.mtable{width:100%;border-collapse:collapse;table-layout:fixed;border-top:1px solid var(--line)}
.mtable th{font-size:6.4pt;text-transform:uppercase;letter-spacing:.08em;color:var(--slate);text-align:left;font-weight:600;padding:1.2mm 2mm;background:var(--mist);border-bottom:1.3px solid var(--ink)}
.mtable td{padding:2.2mm 2mm 2mm;border-bottom:1px solid var(--line);vertical-align:top;font-size:8.2pt;line-height:1.35;overflow-wrap:anywhere}
.mtable th+th,.mtable td+td{border-left:1px solid var(--line)}
.mtable th:first-child,.mtable td:first-child{padding-left:0}
.mtable tr.alt td{background:#F8F9FA}
.mtable td b{font-weight:600}
.mtable .sm{display:block;font-size:7pt;color:var(--slate);margin-top:.4mm}
.mtable .also{display:inline-block;font-size:6.6pt;color:var(--slate);background:var(--mist);border-radius:2mm;padding:.2mm 2mm;margin-top:.8mm}
.mtable col.c1{width:27%}.mtable col.c2{width:31%}.mtable col.c3{width:19%}.mtable col.c4{width:23%}
.mtable tr.grp td{background:var(--mist);padding:1.2mm 0;font-size:7.2pt;color:var(--slate)}
.mtable tr.grp td+td{border-left:0}
.mpill{display:inline-block;font-size:6.8pt;font-weight:600;border-radius:2.4mm;padding:.3mm 2.2mm;margin-right:1.6mm;background:var(--mist);color:var(--slate)}
tr.grp .mpill{margin-left:0}
.mpill.teal{background:var(--teal-soft);color:#16656B}
.mpill.amber{background:var(--amber-soft);color:#8A5E10}
.mpill.green{background:var(--green-soft);color:#2D7354}
.mpill.red{background:var(--red-soft);color:#B0372E}
.mpill.slate{background:var(--mist);color:var(--slate);border:1px solid var(--line)}
.mtable td .mpill.tag{display:block;width:fit-content;margin:0 0 1.2mm;padding:.4mm 2.4mm}
.mbar{height:1.5mm;border-radius:.75mm;background:var(--line);margin:1.2mm 0 .6mm;overflow:hidden}
.mbar i{display:block;height:100%;background:var(--teal);border-radius:.75mm}
.mbody{flex:1;display:flex;flex-direction:column;gap:5mm;min-height:0}
.msec h2{margin-bottom:2mm}
.mnone{color:var(--slate)}
.mnotes{background:var(--teal-soft);border-radius:2.4mm;padding:3mm 3.6mm;display:flex;flex-direction:column;flex:1;min-height:42mm}
.mnotes h3{font-family:Inter,sans-serif;font-size:8.6pt;font-weight:600;letter-spacing:0}
.mnotes .lines{flex:1;margin-top:1.4mm;position:relative;overflow:hidden}
.mnotes .lines i{position:absolute;left:0;right:0;height:0;border-top:1px solid rgba(30,127,134,.35)}
`;
function medsRow(r, i) {
  const sm = (t) => (t ? `<span class="sm">${esc(t)}</span>` : '');
  const bar = r.bar == null ? '' : `<div class="mbar"><i style="width:${Math.round(Math.max(0, Math.min(1, r.bar)) * 100)}%"></i></div>`;
  return `<tr data-i="${i}"${r.alt ? ' class="alt"' : ''}>`
    + `<td>${r.tag ? `<span class="mpill tag ${esc(r.tag.cls)}">${esc(r.tag.text)}</span>` : ''}<b>${esc(r.name)}</b>${sm(r.purpose)}</td>`
    + `<td>${esc(r.dose || '')}${r.lines.map(sm).join('')}${(r.also || []).map((a) => `<span class="also">${esc(a)}</span>`).join('<br>')}</td>`
    + `<td>${esc(r.taken)}${sm(r.takenSub)}</td>`
    + `<td><b>${esc(r.doses)}</b>${r.dosesSub.map(sm).join('')}${bar}${sm(r.last14)}${r.fx ? `<span class="also">${esc(r.fx)}</span>` : ''}</td></tr>`;
}
const MEDS_HEAD = '<table class="mtable"><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup><thead><tr><th>Medicine</th><th>Dose and how often</th><th>Taken</th><th>Doses logged</th></tr></thead><tbody>';
const medsGroupRow = (g, i, cont) => `<tr class="grp"${i === null ? '' : ` data-i="${i}"`}><td colspan="4"><span class="mpill ${esc(g.cls)}">${esc(g.label)}</span>${esc(cont ? 'continued' : g.note + ' · ' + g.rows.length)}</td></tr>`;
/* M: { patient, upTo, prepared, tiles[], sections[{ title, note, groups[{ label, note, cls, rows[] }] }],
   items[] (flat: { t: 'sec'|'grp'|'row'|'notes', s, g, r }), pages[[item index]] } */
export function medsReportHtml(M) {
  const total = M.pages.length;
  const pages = M.pages.map((idx, p) => {
    let html = '', open = null;
    const close = () => { if (open !== null) { html += '</tbody></table></div>'; open = null; } };
    idx.forEach((i) => {
      const it = M.items[i];
      if (it.t === 'notes') {
        close();
        /* only as many lines as the panel holds (fitMedsReport() counts them): ruled lines that run past
           the paper, even clipped, make Chrome print a blank page after the report */
        let l = ''; for (let k = 1; k <= (M.noteLines == null ? 6 : M.noteLines); k++) l += `<i style="top:calc(${k} * 7mm)"></i>`;
        html += `<div class="mnotes" data-i="${i}"><h3>Medicine changes and notes from the team</h3><div class="lines">${l}</div></div>`;
        return;
      }
      const sec = M.sections[it.s];
      if (it.t === 'sec' || open !== it.s) {
        close();
        const cont = it.t !== 'sec';
        html += `<div class="msec"><h2 class="sec"${cont ? '' : ` data-i="${i}"`}>${esc(sec.title)}${cont ? ', continued' : sec.note ? ` <small>${esc(sec.note)}</small>` : ''}</h2>${MEDS_HEAD}`;
        open = it.s;
        /* a page that starts part way through a group says so */
        if (it.t === 'row' && sec.groups[it.g].label) html += medsGroupRow(sec.groups[it.g], null, true);
      }
      if (it.t === 'grp') html += medsGroupRow(sec.groups[it.g], i, false);
      if (it.t === 'row') html += medsRow(sec.groups[it.g].rows[it.r], i);
    });
    close();
    if (!M.sections.length) html = '<p class="mnone">No medicines on the list yet.</p>' + html;
    const bars = idx.some((i) => { const it = M.items[i]; return it.t === 'row' && M.sections[it.s].groups[it.g].rows[it.r].bar != null; });
    const tiles = p === 0 && M.tiles.length ? `<div class="tiles">${M.tiles.map(tileHtml).join('')}</div>` : '';
    const top = p === 0
      ? `<div class="masthead"><div><div class="titlerow"><h1>Medicine history</h1><span class="madeby">Created with <b>My Medical Daybook</b></span></div><div class="sub">Every medicine on the list, with its dose, how often and the doses logged, including finished courses.</div></div><div class="who"><strong>${esc(M.patient)}</strong>Up to: ${esc(M.upTo)}<br>Prepared: ${esc(M.prepared)}</div></div>${tiles}`
      : `<div class="runner"><h2>Medicine history</h2><span>${esc(M.patient)} · up to ${esc(M.upTo)}</span></div>`;
    return `<section class="page" id="page${p + 1}">${top}<div class="mbody">${html}</div><div class="foot"><span>Doses as logged in Daybook. Not medical advice.${bars ? ' Bars: the last 14 days, doses taken against due or days used.' : ''}</span>${madeBy(p + 1, total)}</div></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Medicine history, ${esc(M.patient)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}${MEDS_CSS}</style>
</head>
<body class="meds">
${pages}
</body>
</html>`;
}
/* Lays the rows out page by page: renders, finds the first heading or row whose bottom passes its
   page's foot, moves it (and the section and group headings above it, never left alone at a page's
   foot) and everything after it to the next page, and renders again, until every page fits */
export function fitMedsReport(frame, M, opts = {}) { return paginate(frame, M, medsReportHtml, opts); }
async function paginate(frame, M, render, opts = {}) {
  const write = (html) => new Promise((resolve) => { frame.onload = () => resolve(); frame.srcdoc = html; });
  M.pages = [M.items.map((_, i) => i)];
  M.noteLines = null;
  for (let pass = 0; pass < 200; pass++) {
    await write(render(M));
    const doc = frame.contentDocument;
    doc.documentElement.classList.add('capture');
    if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, opts.fontWait || 3000))]);
    let moved = false;
    const pages = [...doc.querySelectorAll('.page')];
    for (let p = 0; p < pages.length && !moved; p++) {
      /* the page's own bottom too, not only the footer's top (v275): on an overfull page the footer is pushed past the
         paper in some layouts, and every item then sat above it, so a Mood report printed as one page with its last
         weeks cut off */
      const foot = pages[p].querySelector('.foot'), pr = pages[p].getBoundingClientRect(), pcs = doc.defaultView.getComputedStyle(pages[p]);
      const limit = Math.min(foot.getBoundingClientRect().top, pr.top + pages[p].clientHeight - parseFloat(pcs.paddingBottom || 0) - foot.offsetHeight - 6) - 1;
      const els = [...pages[p].querySelectorAll('[data-i]')].filter((e) => e.dataset.i !== '');
      /* the notes panel stretches to fill its page, so it is judged by its smallest height */
      const bottom = (e) => (e.classList.contains('mnotes') ? e.getBoundingClientRect().top + parseFloat(doc.defaultView.getComputedStyle(e).minHeight) : e.getBoundingClientRect().bottom);
      const bad = els.find((e) => bottom(e) > limit);
      if (!bad) continue;
      const idx = M.pages[p];
      let at = idx.indexOf(Number(bad.dataset.i));
      while (at > 0 && /^(sec|grp)$/.test(M.items[idx[at - 1]].t)) at -= 1; // keep headings with their first row
      /* page 1 has its masthead, tiles and charts above the first item, so that item can still start page 2 (v258: the
         Crohn's report's brief, with a fasting paragraph, no longer fitted under the charts and the report failed) */
      if (at <= 0 && p > 0) return { ok: false, over: ['Page ' + (p + 1)], R: M, doc }; // one row taller than a page
      if (at < 0) at = 0;
      const rest = idx.splice(at);
      if (M.pages[p + 1]) M.pages[p + 1].unshift(...rest); else M.pages.push(rest);
      moved = true;
    }
    if (!moved) {
      const box = doc.querySelector('.mnotes .lines');
      const n = box ? Math.max(0, Math.floor((box.getBoundingClientRect().height * 25.4 / 96 - 1) / 7)) : 0;
      if (box && n !== M.noteLines) { M.noteLines = n; continue; }
      return { ok: true, R: M, doc };
    }
  }
  return { ok: false, over: ['Report'], R: M };
}

/* ------------------------------------------------------------------ */
/* The Mood and wellbeing report (since v155, 12 October 2026).        */
/* Mark, before a therapy session: "it might have been useful if I    */
/* could have had a report like the others." The house style, as many */
/* A4 pages as it needs: tiles, the mood chart with the sessions      */
/* marked, then the words behind the scores in time order, one good   */
/* thing each day, sleep and energy, questions labelled Wellbeing and */
/* a panel to write on. Every figure arrives in W already worked out  */
/* (buildMoodReport() in scripts.js). Paginated by paginate().        */
/* ------------------------------------------------------------------ */
const MOOD_CSS = `
.tiles.mood{grid-template-columns:repeat(5,1fr);gap:2.2mm}
.tiles.mood .tile .v{font-size:13pt}
.tiles.mood .tile.has-avg .v{font-size:10pt}
.tiles.mood .tile .avg{font-family:Fraunces,Georgia,serif;font-size:17pt;line-height:1;margin:.4mm 0 .8mm}
.tiles.mood .tile .avg em{font-style:normal;font-size:7pt;font-family:Inter,sans-serif;font-weight:500;color:var(--slate);margin-left:.8mm}
.tiles.mood .tile.red .avg{color:var(--red)}
.tiles.mood .tile.amber .avg{color:#8A5E10}
.tiles.mood .tile.green .avg{color:#2D7354}
.c.wide{margin-top:1mm}
.c .legend{display:flex;flex-wrap:wrap;gap:3.6mm;font-size:6.8pt;color:var(--slate);margin-top:1mm}
.c .legend i{display:inline-block;width:4mm;height:1.3mm;border-radius:.6mm;margin-right:1.2mm;vertical-align:middle}
.c .legend i.swb{height:2.6mm;border-radius:.4mm}
.c .legend i.ring{width:2.2mm;height:2.2mm;border-radius:50%;background:#fff;border:.5mm solid #8A5E10}
.c .legend .tri{display:inline-block;width:0;height:0;border-left:1.4mm solid transparent;border-right:1.4mm solid transparent;border-bottom:2.2mm solid var(--ink);margin-right:1.2mm;vertical-align:middle}
.wbody{flex:1;display:flex;flex-direction:column;gap:3.6mm;min-height:0}
.wsec{display:flex;flex-direction:column;gap:1.8mm}
.brief{display:grid;grid-template-columns:1fr 1fr;gap:2.2mm 5mm;font-size:8.3pt;line-height:1.42}
.brief p b{font-weight:600}
.quotes{display:grid;grid-template-columns:repeat(3,1fr);gap:2.6mm}
.quotes.two{grid-template-columns:1fr 1fr}
.quotes.one{grid-template-columns:1fr}
.quote{background:var(--mist);border-radius:2mm;padding:2.4mm 3mm;font-size:8pt;line-height:1.4}
.quote time{display:block;font-size:6.9pt;color:var(--slate);font-weight:600;margin-bottom:.8mm}
.quote.low{background:var(--amber-soft)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.two ul{padding-left:4mm;font-size:8.2pt;line-height:1.45;margin:0}
.two li+li{margin-top:.8mm}
.two li b{font-weight:600}
.wkhead,.wkrow{display:grid;grid-template-columns:22mm 22mm 24mm 24mm 20mm 1fr;gap:2mm;align-items:start}
.wkhead{font-size:6.6pt;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);background:var(--mist);padding:1.6mm 2mm;border-bottom:1.3px solid var(--ink);font-weight:600}
.wkrow{padding:1.8mm 2mm;border-bottom:1px solid var(--line);font-size:7.9pt;line-height:1.35}
.wkrow .n{font-variant-numeric:tabular-nums;white-space:nowrap}
.crow{display:grid;grid-template-columns:14mm 1fr;gap:2mm;padding:1.8mm 2mm;border-bottom:1px solid var(--line);font-size:7.9pt;line-height:1.35;border-left:1.2mm solid #C2703D;background:#FBF3EC}
.crow time{font-weight:600;color:#9A5527}
.cnote{font-size:7.9pt;color:var(--slate);margin:0 0 1.6mm}
.crow b{display:block;font-weight:600}
.crow .ctext{display:block;margin-top:.4mm}
.morow{display:grid;grid-template-columns:24mm 10mm 1fr;gap:2mm;padding:1.8mm 2mm;border-bottom:1px solid var(--line);font-size:7.9pt;line-height:1.35;border-left:1.2mm solid #E0A030;background:#FBF6EA}
.morow.hi{border-left-color:#1E7F86;background:#EEF6F6}
.morow time{font-weight:600;color:var(--slate)}
.morow b{font-family:Fraunces,serif;font-weight:600;font-size:9.5pt;color:#8A5E10}
.morow.hi b{color:#18727A}
.morow .sm{display:block;margin-top:.4mm}
.wkrow .sm{display:block;color:var(--slate);font-size:7.1pt}
.wkrow .dots i{display:inline-block;width:2.2mm;height:2.2mm;border-radius:50%;background:var(--line);margin-right:.6mm;vertical-align:middle}
.wkrow .dots i.on{background:var(--teal)}
.wkrow .dots i.warm{background:#C2703D}
.wq{display:grid;grid-template-columns:1fr 1fr;gap:2.6mm}
.mnotes{background:var(--teal-soft);border-radius:2.4mm;padding:3mm 3.6mm;display:flex;flex-direction:column;flex:1;min-height:42mm}
.mnotes h3{font-family:Inter,sans-serif;font-size:8.6pt;font-weight:600;letter-spacing:0}
.mnotes .lines{flex:1;margin-top:1.4mm;position:relative;overflow:hidden}
.mnotes .lines i{position:absolute;left:0;right:0;height:0;border-top:1px solid rgba(30,127,134,.35)}
`;
/* The mood chart (v156): one axis 0 to 10 for mood (teal line, the low days ringed), the day's worst pain (terracotta,
   dashed) and hours asleep (mist bars); the treatment sessions as ink triangles under the plot, hospital days shaded.
   Teal and terracotta pass the colour-vision separation check; ink and teal, the v155 pair, did not read apart. */
function moodChart(c, days) {
  const n = days.length, W = 180, H = 62, L = 9, R = 2, T = 3, B = 9, pw = W - L - R, ph = H - T - B;
  const x = (i) => L + (n > 1 ? i * pw / (n - 1) : pw / 2), y = (v) => T + ph - Math.max(0, Math.min(10, v)) / 10 * ph;
  const step = n > 1 ? pw / (n - 1) : pw;
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,sans-serif" role="img" aria-label="Mood, with pain and sleep behind it">`;
  /* hospital days as a shaded band, runs merged */
  const hosp = (c.hospital || []).slice().sort((a, b) => a - b);
  for (let k = 0; k < hosp.length; k++) {
    let a = hosp[k], b = a; while (k + 1 < hosp.length && hosp[k + 1] === b + 1) { k++; b = hosp[k]; }
    s += `<rect x="${(x(a) - step / 2).toFixed(1)}" y="${T}" width="${((b - a + 1) * step).toFixed(1)}" height="${ph}" fill="#F8E1DE"/>`;
    s += `<text x="${x((a + b) / 2).toFixed(1)}" y="${T + 3.2}" font-size="2.8" fill="#B0372E" text-anchor="middle" font-weight="600">In hospital</text>`;
  }
  [0, 5, 10].forEach((t) => { s += `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#E3E9EE" stroke-width=".3"/><text x="${L - 1.5}" y="${(y(t) + 1.1).toFixed(1)}" font-size="3" fill="#5B6B7C" text-anchor="end">${t}</text>`; });
  const bw = Math.min(step * 0.55, 4);
  (c.sleep || []).forEach((v, i) => { if (v != null) s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(ph - (y(v) - T)).toFixed(1)}" rx=".5" fill="#CFE4E6"/>`; });
  const path = (arr) => { let d = '', pen = false; arr.forEach((v, i) => { if (v == null) return; d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; }); return d; };
  if ((c.pain || []).some((v) => v != null)) s += `<path d="${path(c.pain)}" fill="none" stroke="#C2703D" stroke-width=".9" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="1.6 1.1"/>`;
  if ((c.mood || []).some((v) => v != null)) {
    s += `<path d="${path(c.mood)}" fill="none" stroke="#1E7F86" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>`;
    const low = new Set(c.low || []);
    c.mood.forEach((v, i) => { if (v == null) return; s += low.has(i) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.9" fill="#fff" stroke="#8A5E10" stroke-width=".9"/>` : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1" fill="#1E7F86"/>`; });
  }
  (c.sessions || []).forEach((i) => { s += `<path d="M${(x(i) - 1.6).toFixed(1)} ${(T + ph + 2.4).toFixed(1)} L${(x(i) + 1.6).toFixed(1)} ${(T + ph + 2.4).toFixed(1)} L${x(i).toFixed(1)} ${(T + ph - .2).toFixed(1)} Z" fill="#17263A"/>`; });
  const want = Math.min(n, 6), shown = [];
  for (let k = 0; k < want; k++) shown.push(Math.round(k * (n - 1) / Math.max(1, want - 1)));
  [...new Set(shown)].forEach((i) => { s += `<text x="${x(i).toFixed(1)}" y="${H - 1.8}" font-size="3" fill="#5B6B7C" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(days[i])}</text>`; });
  if (!(c.mood || []).some((v) => v != null) && !(c.pain || []).some((v) => v != null)) s += `<text x="${(L + pw / 2).toFixed(1)}" y="${(T + ph / 2).toFixed(1)}" font-size="3.4" fill="#5B6B7C" text-anchor="middle">No mood scores in this period</text>`;
  return s + '</svg>';
}
const SW = (bg) => `<i style="background:${bg}"></i>`;
/* the week table's columns: the taps' three or mood and low days, sleep, and the sentence only with a weekly check (v157) */
const wkCols = (C) => (C.taps ? '22mm 22mm 24mm 24mm 20mm' : '26mm 24mm 24mm 24mm') + (C.checks ? ' 1fr' : '');
/* W: { patient, period, prepared, tiles[{ k, v, unit, n, tone }], chart { mood[], pain[], sleep[], sessions[], hospital[], low[], stat, tone }, days[],
   brief[{ head, text }], briefNote, quotes[{ when, text, low }], quotesNote, helped[{ head, text }], hardest[], weeks[{ label, low{ n, sub, warm }, worried, enjoyed, sleep, sleepSub, sentence, sub }],
   questions[{ team, text, by }], items[{ t: 'brief'|'quotes'|'two'|'sec'|'wk'|'q'|'notes', s, r, q }], pages[[item index]], noteLines } */
export function moodReportHtml(W) {
  const total = W.pages.length;
  const dots = (d) => `<span class="dots">${[1, 2, 3, 4].map((k) => `<i class="${k <= d.n ? (d.warm ? 'on warm' : 'on') : ''}"></i>`).join('')}</span>`;
  const list = (l) => `<ul>${l.map((x) => `<li>${x.head ? `<b>${esc(x.head)}.</b> ` : ''}${esc(x.text)}</li>`).join('')}</ul>`;
  const pages = W.pages.map((idx, p) => {
    let html = '', open = null;
    const close = () => { if (open) { html += '</div>'; open = null; } };
    idx.forEach((i) => {
      const it = W.items[i];
      if (it.t === 'brief') { close(); html += `<div class="wsec" data-i="${i}"><h2 class="sec">The period in brief <small>${esc(W.briefNote)}</small></h2><div class="brief">${W.brief.map((b) => `<p>${b.head ? `<b>${esc(b.head)}.</b> ` : ''}${esc(b.text)}</p>`).join('')}</div></div>`; return; }
      if (it.t === 'quotes') { close(); html += `<div class="wsec" data-i="${i}"><h2 class="sec">In ${esc(W.patient)}'s own words <small>${esc(W.quotesNote)}</small></h2><div class="quotes${W.quotes.length === 2 ? ' two' : W.quotes.length === 1 ? ' one' : ''}">${W.quotes.map((q) => `<div class="quote${q.low ? ' low' : ''}">${q.when ? `<time>${esc(q.when)}</time>` : ''}“${esc(q.text)}”</div>`).join('')}</div></div>`; return; }
      if (it.t === 'two') { close(); html += `<div class="two" data-i="${i}"><div class="wsec"><h2 class="sec">What helped</h2>${W.helped.length ? list(W.helped) : '<p class="sm">Nothing written yet.</p>'}</div><div class="wsec"><h2 class="sec">What was hardest</h2>${W.hardest.length ? list(W.hardest) : '<p class="sm">Nothing written yet.</p>'}</div></div>`; return; }
      if (it.t === 'notes') {
        close();
        let l = ''; for (let k = 1; k <= (W.noteLines == null ? 6 : W.noteLines); k++) l += `<i style="top:calc(${k} * 7mm)"></i>`;
        html += `<div class="mnotes" data-i="${i}"><h3>Notes from the session</h3><div class="lines">${l}</div></div>`;
        return;
      }
      if (it.t === 'sec' || (it.t === 'wk' && open !== 'weeks') || (it.t === 'q' && open !== 'q') || (it.t === 'cd' && open !== 'carer') || (it.t === 'mo' && open !== 'moments')) {
        close();
        const which = it.t === 'sec' ? it.s : it.t === 'wk' ? 'weeks' : it.t === 'cd' ? 'carer' : it.t === 'mo' ? 'moments' : 'q';
        const cont = it.t !== 'sec';
        const title = which === 'weeks' ? 'Week by week' : which === 'carer' ? esc(W.carer.title) : which === 'moments' ? 'The highs and lows, in ' + esc(W.patient) + "'s words" : 'Questions';
        const C = W.cols || { taps: true, checks: true };
        const note = which === 'carer' ? '' : which === 'moments' ? (W.momentsLeft ? 'The five lowest and five highest moods with words beside them. ' + W.momentsLeft + ' more ' + (W.momentsLeft === 1 ? 'is' : 'are') + ' on the Mood screen in Daybook.' : 'Every mood of 4 or under, or 8 or over, with the words written beside it.') : which === 'weeks' ? (C.taps ? 'The evening taps (how much, out of four: not at all to a lot) and sleep' : 'Mood, low days and sleep') + (C.checks ? ', and the weekly check in ' + esc(W.patient) + "'s words." : ', week by week.') : 'Labelled Wellbeing in the app. Space under each to write the reply.';
        html += `<div class="wsec"><h2 class="sec"${cont ? '' : ` data-i="${i}"`}>${title}${cont ? ', continued' : ` <small>${note}</small>`}</h2>`;
        if (which === 'carer' && !cont) html += `<p class="cnote">${esc((W.carer.summary + ' ' + W.carer.note).trim())}</p>`;
        if (which === 'weeks') html += `<div class="wkhead" style="grid-template-columns:${wkCols(C)}"><span>Week</span>${C.taps ? '<span>Felt low</span><span>Worried or on edge</span><span>Enjoyed something</span>' : '<span>Mood</span><span>Low days</span>'}<span>Sleep</span>${C.checks ? '<span>The week in a sentence</span>' : ''}</div>`;
        if (which === 'q') html += '<div class="wq">';
        open = which;
        if (it.t === 'sec') return;
      }
      if (it.t === 'mo') {
        const x = W.moments[it.r];
        html += `<div class="morow${x.high ? ' hi' : ''}" data-i="${i}"><time>${esc(x.when)}</time><b>${x.v}/10</b><span>“${esc(x.text)}”<span class="sm">${esc(x.from[0].toUpperCase() + x.from.slice(1))}</span></span></div>`;
        return;
      }
      if (it.t === 'cd') {
        const d = W.carer.days[it.r];
        html += `<div class="crow" data-i="${i}"><time>${esc(d.when)}</time><span>${d.moods ? `<b>${esc(d.moods)}</b>` : ''}${d.texts.map((t) => `<span class="ctext">${esc(t)}</span>`).join('')}</span></div>`;
        return;
      }
      if (it.t === 'wk') {
        const w = W.weeks[it.r];
        const cell = (d) => (d.n ? `${dots(d)}<span class="sm">${esc(d.sub)}</span>` : '<span class="sm">No taps</span>');
        const C = W.cols || { taps: true, checks: true };
        const mid = C.taps ? `<span>${cell(w.low)}</span><span>${cell(w.worried)}</span><span>${cell(w.enjoyed)}</span>` : `<span class="n">${esc(w.mood)}${w.moodSub ? `<span class="sm">${esc(w.moodSub)}</span>` : ''}</span><span class="n">${esc(w.lowDays)}${w.lowSub ? `<span class="sm">${esc(w.lowSub)}</span>` : ''}</span>`;
        const last = C.checks ? `<span>${w.sentence ? '“' + esc(w.sentence) + '”' : '<span class="sm">No weekly check</span>'}${w.sub ? `<span class="sm">${esc(w.sub)}</span>` : ''}${w.carer ? `<span class="sm">${esc(w.carer)}</span>` : ''}</span>` : '';
        html += `<div class="wkrow" style="grid-template-columns:${wkCols(C)}" data-i="${i}"><span class="n">${esc(w.label)}</span>${mid}<span class="n">${esc(w.sleep)}${w.sleepSub ? `<span class="sm">${esc(w.sleepSub)}</span>` : ''}</span>${last}</div>`;
      }
      /* the card's own three ruled lines, never the 40 clipped ones: rules running past the paper, even clipped, make Chrome print a blank page after the last */
      if (it.t === 'q') { const q = W.questions[it.q]; html += `<article class="q" data-i="${i}"><header><div>${q.team ? `<div class="team">${esc(q.team)}</div>` : ''}<h3>${esc(q.text)}</h3><div class="by">${esc(q.by)}</div></div></header><div class="lines" style="min-height:16.2mm">${lines(3)}</div></article>`; }
    });
    if (open === 'q') html += '</div>';
    close();
    const c = W.chart;
    const legend = `<div class="legend"><span>${SW('#1E7F86')}Mood (1 to 10), the day's average</span><span>${SW('#C2703D')}Worst pain (0 to 10)</span><span><i class="swb" style="background:#CFE4E6"></i>Hours asleep</span>${c.sessions.length ? '<span><i class="tri"></i>Treatment session</span>' : ''}${c.hospital.length ? '<span><i class="swb" style="background:#F8E1DE"></i>In hospital</span>' : ''}${c.low.length ? '<span><i class="ring"></i>Mood 4 or under</span>' : ''}</div>`;
    const first = p === 0
      ? `<div class="masthead"><div><div class="titlerow"><h1>Mood and wellbeing</h1><span class="madeby">Created with <b>My Medical Daybook</b></span></div><div class="sub">How the period has felt, in scores and in ${esc(W.patient)}'s own words, for a therapist, counsellor or GP.</div></div><div class="who"><strong>${esc(W.patient)}</strong>Period: ${esc(W.period)}<br>Prepared: ${esc(W.prepared)}</div></div>`
        + `<div class="tiles mood">${W.tiles.map((t) => `<div class="tile ${esc(t.tone || '')}${t.avg ? ' has-avg' : ''}"><div class="k">${esc(t.k)}</div><div class="v">${esc(t.v)}${t.unit ? `<em>${esc(t.unit)}</em>` : ''}</div>${t.avg ? `<div class="avg">${esc(t.avg)}<em>average mood</em></div>` : ''}<div class="n">${esc(t.n)}</div></div>`).join('')}</div>`
        + `<div class="c wide"><div class="h"><h3>Mood, with pain and sleep behind it</h3><span class="stat ${esc(c.tone || '')}">${esc(c.stat)}</span></div>${moodChart(c, W.days)}${legend}</div>`
      : `<div class="runner"><h2>Mood and wellbeing</h2><span>${esc(W.patient)} · ${esc(W.period)}</span></div>`;
    return `<section class="page" id="page${p + 1}">${first}<div class="wbody">${html}</div><div class="foot"><span>Scores and words as logged in Daybook${W.briefNote.startsWith('Written by') ? '; the brief is written by an AI helper and checked by ' + esc(W.patient) : ''}. Not medical advice.</span>${madeBy(p + 1, total)}</div></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Mood and wellbeing, ${esc(W.patient)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}${MOOD_CSS}</style>
</head>
<body class="mood">
${pages}
</body>
</html>`;
}
export function fitMoodReport(frame, W, opts = {}) { return paginate(frame, W, moodReportHtml, opts); }

/* ------------------------------------------------------------------ */
/* The Pain and pain relief report (v161, 13 October 2026). Mark, for  */
/* his pain nurse: "a report like the other reports I do." The house  */
/* style, as many A4 pages as it needs. Every figure arrives in P      */
/* already worked out (buildPainReport() in scripts.js). Paginated by  */
/* paginate(). The words under the pain scores print as written.      */
/* ------------------------------------------------------------------ */
const PAIN_CSS = `
.tiles.pain .tile .v{font-size:14.5pt}
.cgrid.pain{margin-top:1mm}
.cgrid.pain .c{padding-bottom:.6mm}
.c .legend{display:flex;flex-wrap:wrap;gap:3.6mm;font-size:6.8pt;color:var(--slate);margin-top:1mm}
.c .legend i{display:inline-block;width:4mm;height:1.3mm;border-radius:.6mm;margin-right:1.2mm;vertical-align:middle}
.c .legend i.swb{width:1.6mm;height:3.4mm;border-radius:.4mm}
.c .legend .tri{display:inline-block;width:0;height:0;border-left:1.4mm solid transparent;border-right:1.4mm solid transparent;border-top:2.2mm solid var(--ink);margin-right:1.2mm;vertical-align:middle}
.wbody{flex:1;display:flex;flex-direction:column;gap:3.6mm;min-height:0}
.wsec{display:flex;flex-direction:column;gap:1.8mm}
.keys{display:grid;grid-template-columns:1fr 1fr;gap:5mm;align-items:start}
.keys h3{font-family:Inter,sans-serif;font-size:7pt;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);margin-bottom:1.2mm}
.keys h3 small{text-transform:none;letter-spacing:0;font-weight:400}
.keys ul{list-style:none;display:flex;flex-direction:column;gap:1.3mm}
.keys li{position:relative;padding-left:3.4mm;font-size:8.2pt;line-height:1.4}
.keys li::before{content:"";position:absolute;left:0;top:1.6mm;width:1.5mm;height:1.5mm;border-radius:50%;background:var(--teal)}
.keys .said li::before{background:#C2703D}
.when{display:flex;flex-direction:column;gap:2mm}
.when svg.hours{width:100%;height:auto;display:block}
.when ul{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:1.3mm 5mm;font-size:8pt;line-height:1.4}
.when li.nights{grid-column:1 / -1;border-top:1px solid var(--line);padding-top:1.3mm}
.rhead,.rrow{display:grid;grid-template-columns:1.5fr 1.6fr 1fr;gap:2mm;align-items:start}
.rhead{font-size:6.6pt;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);background:var(--mist);padding:1.4mm 2mm;border-bottom:1.3px solid var(--ink);font-weight:600}
.rrow{padding:1.6mm 2mm;border-bottom:1px solid var(--line);font-size:7.7pt;line-height:1.35}
.rrow .sm{display:block;color:var(--slate);font-size:7pt}
.rrow .pill{display:inline-block;font-size:6.4pt;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border-radius:1.4mm;padding:.2mm 1.4mm;margin-bottom:.5mm;background:var(--teal-soft);color:var(--teal)}
.rrow .pill.prn{background:var(--amber-soft);color:#8A5E10}
.words{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:1.2mm 5mm}
.words li{display:grid;grid-template-columns:30mm 1fr;gap:2mm;font-size:7.7pt;line-height:1.36;padding:1.2mm 0;border-bottom:1px solid var(--line)}
.words li time{font-weight:600;color:var(--teal);font-size:7.1pt;line-height:1.3}
.words li time b{display:block;color:var(--slate);font-weight:500}
.words li.bad time{color:var(--red)}
.wkhead,.wkrow{display:grid;grid-template-columns:24mm 24mm 22mm 22mm 1fr 24mm;gap:2mm;align-items:start}
.wkhead{font-size:6.6pt;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);background:var(--mist);padding:1.6mm 2mm;border-bottom:1.3px solid var(--ink);font-weight:600}
.wkrow{padding:1.8mm 2mm;border-bottom:1px solid var(--line);font-size:7.9pt;line-height:1.35}
.wkrow .n{font-variant-numeric:tabular-nums;white-space:nowrap}
.wkrow .sm{display:block;color:var(--slate);font-size:7.1pt}
.wq{display:grid;grid-template-columns:1fr 1fr;gap:2.6mm}
.mnotes{background:var(--teal-soft);border-radius:2.4mm;padding:3mm 3.6mm;display:flex;flex-direction:column;flex:1;min-height:30mm}
.mnotes h3{font-family:Inter,sans-serif;font-size:8.6pt;font-weight:600;letter-spacing:0}
.mnotes .lines{flex:1;margin-top:1.4mm;position:relative;overflow:hidden}
.mnotes .lines i{position:absolute;left:0;right:0;height:0;border-top:1px solid rgba(30,127,134,.35)}
`;
/* P: { patient, period, prepared, tiles[], charts[renderChart configs, six of them: morning check-in, evening check-in, worst pain of the day, pain between check-ins, doses a day, hours asleep], key, days[],
   points[string], said[string], briefNote, saidNote, ai, relief[{ name, dose, how, uses, kind, n, days, most, maxPerDay, hitMax, last, usesNote }], weeks[{ label, pain, painSub, bad, worst, worstSub, relief, nights }],
   questions[{ team, text, by }], items[{ t: 'keys'|'relief'|'when'|'sec'|'wk'|'q', s, r, q }], pages[[item index]], hourly[24], timing[{ text }], nightLine }
   v264: the notes panel gave way to When the top-up doses were taken (Mark).
   Key points since v263 (Mark: the notes in full were "way too long"); By time of day went (pain is scored at the two check-ins). */
/* 24 bars, one an hour, the night, morning, afternoon and evening shaded in turn (v264) */
function hourBars(h, span) {
  const W = 700, H = 118, L = 22, R = 690, T = 16, B = 84, max = Math.max(1, ...h), bw = (R - L) / 24;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="hours" role="img" aria-label="When-needed doses by hour of the day, ${span} days added together">`;
  ['Night', 'Morning', 'Afternoon', 'Evening'].forEach((q, k) => {
    const x = L + k * 6 * bw;
    if (k % 2 === 0) s += `<rect x="${x}" y="${T - 6}" width="${6 * bw}" height="${B - T + 6}" fill="#EEF3F6"/>`;
    s += `<text x="${x + 3 * bw}" y="${H - 4}" text-anchor="middle" font-size="12" fill="#4B5B6B">${q}</text>`;
    s += `<text x="${x}" y="${B + 13}" text-anchor="middle" font-size="10.5" fill="#4B5B6B">${String(k * 6).padStart(2, '0')}:00</text>`;
  });
  s += `<text x="${R}" y="${B + 13}" text-anchor="end" font-size="10.5" fill="#4B5B6B">24:00</text>`;
  s += `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#D5DEE5"/>`;
  h.forEach((n, i) => {
    if (!n) return;
    const bh = (B - T) * n / max, x = L + i * bw + 2;
    s += `<rect x="${x.toFixed(1)}" y="${(B - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="#C2703D"/>`;
    s += `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${(B - bh - 2).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#17263A">${n}</text>`;
  });
  return s + '</svg>';
}
export function painReportHtml(P) {
  const total = P.pages.length;
  const pages = P.pages.map((idx, p) => {
    let html = '', open = null;
    const close = () => { if (open) { html += open === 'q' ? '</div></div>' : '</div>'; open = null; } };
    idx.forEach((i) => {
      const it = P.items[i];
      if (it.t === 'keys') {
        close();
        const li = (l) => (l || []).map((x) => `<li>${esc(x)}</li>`).join('');
        html += `<div class="wsec" data-i="${i}"><h2 class="sec">Key points <small>Over the ${P.spanDays} days, ${esc(P.spanDates)}. ${esc(P.briefNote || '')}</small></h2><div class="keys"><div><h3>From the scores and doses</h3><ul>${li(P.points)}</ul></div><div class="said"><h3>In ${esc(P.patient)}'s words${P.saidNote ? ` <small>${esc(P.saidNote)}</small>` : ''}</h3><ul>${li(P.said)}</ul></div></div></div>`;
        return;
      }
      if (it.t === 'relief') {
        close();
        const rows = P.relief.length ? P.relief.map((r) => `<div class="rrow"><span><span class="pill${r.kind === 'When needed' ? ' prn' : ''}">${esc(r.kind)}</span><br>${esc(r.name)}<span class="sm">${esc(r.dose)}${r.how ? ' · ' + esc(r.how) : ''}${r.uses ? ' · for ' + esc(r.uses.toLowerCase()) : ''}</span></span><span class="n">${r.n ? `<b>${esc(String(r.n))}</b> ${r.n === 1 ? 'dose' : 'doses'}<span class="sm">on ${r.days} of the days${r.most > 1 ? ', up to ' + r.most + ' a day' : ''}${r.hitMax ? ' (the maximum)' : ''}${r.usesNote ? '; ' + esc(r.usesNote) : ''}</span>` : 'None<span class="sm">in this period</span>'}</span><span>${r.last ? 'Last ' + esc(r.last) : ''}${r.maxPerDay ? `<span class="sm">At most ${r.maxPerDay} a day</span>` : ''}</span></div>`).join('') : '<p class="sm" style="font-size:7.7pt;color:var(--slate)">No pain relief medicine on the list, or none logged.</p>';
        html += `<div class="wsec" data-i="${i}"><h2 class="sec">Pain relief <small>Every dose logged over the ${P.spanDays} days, ${esc(P.spanDates)}.</small></h2><div class="rhead"><span>Medicine</span><span>Doses</span><span>Last</span></div>${rows}</div>`;
        return;
      }
      if (it.t === 'when') {
        close();
        const lines = (P.timing || []).length ? P.timing.map((t) => `<li>${esc(t.text)}</li>`).join('') : '<li>No when-needed pain relief logged in this period.</li>';
        html += `<div class="wsec" data-i="${i}"><h2 class="sec">When the top-up doses were taken, over the ${P.spanDays} days <small>${esc(P.spanDates)} added together: each bar is how many doses fell in that hour across all ${P.spanDays} days, not in one day.</small></h2><div class="when">${hourBars(P.hourly || [], P.spanDays)}<ul>${lines}<li class="nights"><b>Nights.</b> ${esc(P.nightLine || '')}</li></ul></div></div>`;
        return;
      }
      if (it.t === 'notes') {
        close();
        let l = ''; for (let k = 1; k <= (P.noteLines == null ? 6 : P.noteLines); k++) l += `<i style="top:calc(${k} * 7mm)"></i>`;
        html += `<div class="mnotes" data-i="${i}"><h3>Notes from the appointment</h3><div class="lines">${l}</div></div>`;
        return;
      }
      if (it.t === 'sec' || (it.t === 'wk' && open !== 'weeks') || (it.t === 'q' && open !== 'q')) {
        close();
        const which = it.t === 'sec' ? it.s : it.t === 'wk' ? 'weeks' : 'q';
        const cont = it.t !== 'sec';
        const title = which === 'weeks' ? 'Week by week' : 'Questions';
        const note = which === 'weeks' ? 'Average pain, days at 7 or more, the worst pain of the day, the relief taken and the nights.' : 'Labelled Pain team in the app. Space under each to write the reply.';
        html += `<div class="wsec"><h2 class="sec"${cont ? '' : ` data-i="${i}"`}>${title}${cont ? ', continued' : ` <small>${note}</small>`}</h2>`;
        if (which === 'weeks') html += '<div class="wkhead"><span>Week</span><span>Average pain</span><span>Days at 7+</span><span>Worst pain</span><span>Pain relief</span><span>Nights</span></div>';
        if (which === 'q') html += '<div class="wq">';
        open = which;
        if (it.t === 'sec') return;
      }
      if (it.t === 'wk') {
        const w = P.weeks[it.r];
        html += `<div class="wkrow" data-i="${i}"><span class="n">${esc(w.label)}</span><span class="n">${esc(w.pain)}<span class="sm">${esc(w.painSub)}</span></span><span class="n">${esc(w.bad)}</span><span class="n">${esc(w.worst)}${w.worstSub ? `<span class="sm">${esc(w.worstSub)}</span>` : ''}</span><span>${esc(w.relief)}</span><span>${esc(w.nights)}</span></div>`;
      }
      if (it.t === 'q') { const q = P.questions[it.q]; html += `<article class="q" data-i="${i}"><header><div>${q.team ? `<div class="team">${esc(q.team)}</div>` : ''}<h3>${esc(q.text)}</h3><div class="by">${esc(q.by)}</div></div></header><div class="lines" style="min-height:16.2mm">${lines(3)}</div></article>`; }
    });
    close();
    const charts = (P.charts || []).map((c) => `<div class="c"><div class="h"><h3>${esc(c.title)}</h3><span class="stat ${esc(c.tone || '')}">${esc(c.stat)}</span></div>${renderChart(c, P.days)}${chartLegend(c)}</div>`).join('');
    const key = P.key ? `<div class="c key">${P.key}</div>` : '';
    const first = p === 0
      ? `<div class="masthead"><div><div class="titlerow"><h1>Pain and pain relief</h1><span class="madeby">Created with <b>My Medical Daybook</b></span></div><div class="sub">Over the ${P.spanDays} days, ${esc(P.spanDates)}: pain scores from the morning and evening check-ins, key points from ${esc(P.patient)}'s own words, and the pain relief taken, for the pain nurse or team.</div></div><div class="who"><strong>${esc(P.patient)}</strong>Period: ${esc(P.period)}<br>Prepared: ${esc(P.prepared)}</div></div>`
        + `<div class="tiles pain">${P.tiles.map((t) => `<div class="tile ${esc(t.tone || '')}"><div class="k">${esc(t.k)}</div><div class="v">${esc(t.v)}${t.unit ? `<em>${esc(t.unit)}</em>` : ''}</div><div class="n">${esc(t.n)}</div></div>`).join('')}</div>`
        + `<div class="cgrid pain">${charts}${key}</div>`
      : `<div class="runner"><h2>Pain and pain relief</h2><span>${esc(P.patient)} · ${esc(P.period)}</span></div>`;
    return `<section class="page" id="page${p + 1}">${first}<div class="wbody">${html}</div><div class="foot"><span>Scores, words and doses as logged in Daybook${P.ai ? '; the key points are written by an AI helper and checked by ' + esc(P.patient) : ''}. Not medical advice.</span>${madeBy(p + 1, total)}</div></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Pain and pain relief, ${esc(P.patient)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}${PAIN_CSS}</style>
</head>
<body class="pain">
${pages}
</body>
</html>`;
}
export function fitPainReport(frame, P, opts = {}) { return paginate(frame, P, painReportHtml, opts); }

/* ------------------------------------------------------------------ */
/* The Crohn's and colitis report (v220, build 4 of Mark's Crohn's plan). The house style, as many A4   */
/* pages as it needs: tiles, four charts, the treatment and flare strip, then the brief, the weeks, the  */
/* flare log, outside the gut, results as the team gave them, the Gastro questions and a panel to write */
/* on. Everything arrives in I already worked out (buildIbdReport() in scripts.js). Paginated by paginate(). */
/* ------------------------------------------------------------------ */
const IBD_CSS = `
.tiles.ibd .tile .v{font-size:14.5pt}
.cgrid.ibd{margin-top:1mm}
.strip.ibd{grid-template-columns:1fr 1fr;margin-top:1mm}
.strip.ibd.three{grid-template-columns:1.1fr 1fr 1fr}
.strip.ibd>div{font-size:7.4pt;line-height:1.4}
.strip.ibd .pre{display:block;font-size:6.6pt;letter-spacing:.06em;text-transform:uppercase;color:var(--teal);font-weight:600;margin-bottom:.6mm}
.wbody{flex:1;display:flex;flex-direction:column;gap:3.6mm;min-height:0}
.brief{display:grid;grid-template-columns:1fr 1fr;gap:2.2mm 5mm;font-size:8.3pt;line-height:1.42}
.brief p b{font-weight:600}
.wsec{display:flex;flex-direction:column;gap:1.8mm}
.wkhead,.wkrow{display:grid;grid-template-columns:24mm 22mm 28mm 30mm 18mm 1fr;gap:2mm;align-items:start}
.wkhead{font-size:6.6pt;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);background:var(--mist);padding:1.6mm 2mm;border-bottom:1.3px solid var(--ink);font-weight:600}
.wkrow{padding:1.8mm 2mm;border-bottom:1px solid var(--line);font-size:7.9pt;line-height:1.35}
.wkrow .n{font-variant-numeric:tabular-nums;white-space:nowrap}
.wkrow .sm{display:block;color:var(--slate);font-size:7.1pt}
.loglist{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:1.2mm 5mm}
.loglist.one{grid-template-columns:1fr}
.loglist li{display:grid;grid-template-columns:30mm 1fr;gap:2mm;font-size:7.7pt;line-height:1.36;padding:1.2mm 0;border-bottom:1px solid var(--line)}
.loglist li time{font-weight:600;color:var(--teal);font-size:7.1pt;line-height:1.3}
.wq{display:grid;grid-template-columns:1fr 1fr;gap:2.6mm}
.mnotes{background:var(--teal-soft);border-radius:2.4mm;padding:3mm 3.6mm;display:flex;flex-direction:column;flex:1;min-height:30mm}
.mnotes h3{font-family:Inter,sans-serif;font-size:8.6pt;font-weight:600;letter-spacing:0}
.mnotes .lines{flex:1;margin-top:1.4mm;position:relative;overflow:hidden}
.mnotes .lines i{position:absolute;left:0;right:0;height:0;border-top:1px solid rgba(30,127,134,.35)}
`;
/* I: { patient, period, prepared, condition, tiles[], charts[4], key, days[], strip[{ head, text }], brief[{ head, text }], weeks[], flareLog[{ when, text }],
   outside[{ when, text }], results[{ when, text }], questions[{ team, text, by }], items[{ t: 'brief'|'sec'|'wk'|'fl'|'out'|'res'|'q'|'notes', s, r, q }], pages[[item index]], noteLines, stoma } */
export function ibdReportHtml(I) {
  const total = I.pages.length;
  const LISTS = { flare: ['The flare log', 'Flare days marked from I think I\'m flaring, and every call to the advice line with what they said.', 'fl', 'flareLog', 'one'], outside: ['Outside the gut', 'The weekly check-in question: joints, eyes, skin, mouth ulcers and around the bottom.', 'out', 'outside', ''], results: ['Results, as the team gave them', 'Every result recorded in this period, with the lab\'s range where it was printed. Not interpreted.', 'res', 'results', 'one'] };
  const pages = I.pages.map((idx, p) => {
    let html = '', open = null;
    const close = () => { if (open) { html += LISTS[open] ? '</ul></div>' : open === 'q' ? '</div></div>' : '</div>'; open = null; } };
    idx.forEach((i) => {
      const it = I.items[i];
      if (it.t === 'brief') { close(); html += `<div class="wsec" data-i="${i}"><h2 class="sec">The period in brief <small>Worked out by the app from what was logged. Facts, not an opinion.</small></h2><div class="brief">${(I.brief || []).map((b) => `<p>${b.head ? `<b>${esc(b.head)}.</b> ` : ''}${esc(b.text)}</p>`).join('')}</div></div>`; return; }
      if (it.t === 'notes') {
        close();
        let l = ''; for (let k = 1; k <= (I.noteLines == null ? 6 : I.noteLines); k++) l += `<i style="top:calc(${k} * 7mm)"></i>`;
        html += `<div class="mnotes" data-i="${i}"><h3>Notes from the appointment</h3><div class="lines">${l}</div></div>`;
        return;
      }
      const listKind = it.t === 'fl' ? 'flare' : it.t === 'out' ? 'outside' : it.t === 'res' ? 'results' : it.t === 'wk' ? 'weeks' : it.t === 'q' ? 'q' : null;
      if (it.t === 'sec' || (listKind && open !== listKind)) {
        close();
        const which = it.t === 'sec' ? it.s : listKind;
        const cont = it.t !== 'sec';
        const L = LISTS[which];
        const title = L ? L[0] : which === 'weeks' ? 'Week by week' : 'Questions for the gastro team';
        const note = L ? L[1] : which === 'weeks' ? ((I.stoma ? 'Bag emptied' : 'Bowel movements') + ' a day, blood, urgency, weight and what else happened that week.') : 'Labelled Gastro in the app. Space under each to write the reply.';
        html += `<div class="wsec"><h2 class="sec"${cont ? '' : ` data-i="${i}"`}>${esc(title)}${cont ? ', continued' : ` <small>${esc(note)}</small>`}</h2>`;
        if (L) html += `<ul class="loglist ${L[4]}">`;
        if (which === 'weeks') html += `<div class="wkhead"><span>Week</span><span>A day</span><span>Blood</span><span>Urgency</span><span>Weight</span><span>Also</span></div>`;
        if (which === 'q') html += '<div class="wq">';
        open = which;
        if (it.t === 'sec') return;
      }
      if (it.t === 'wk') {
        const w = I.weeks[it.r];
        html += `<div class="wkrow" data-i="${i}"><span class="n">${esc(w.label)}</span><span class="n">${esc(w.aDay)}<span class="sm">${esc(w.aDaySub)}</span></span><span>${esc(w.blood)}</span><span>${esc(w.urgency)}</span><span class="n">${esc(w.weight)}</span><span>${esc(w.other || '')}</span></div>`;
      }
      if (LISTS[open] && it.t === LISTS[open][2]) { const r = I[LISTS[open][3]][it.r]; html += `<li data-i="${i}"><time>${esc(r.when)}</time><span>${esc(r.text)}</span></li>`; }
      if (it.t === 'q') { const q = I.questions[it.q]; html += `<article class="q" data-i="${i}"><header><div>${q.team ? `<div class="team">${esc(q.team)}</div>` : ''}<h3>${esc(q.text)}</h3><div class="by">${esc(q.by)}</div></div></header><div class="lines" style="min-height:16.2mm">${lines(3)}</div></article>`; }
    });
    close();
    const charts = (I.charts || []).map((c) => `<div class="c"><div class="h"><h3>${esc(c.title)}</h3><span class="stat ${esc(c.tone || '')}">${esc(c.stat)}</span></div>${renderChart(c, I.days)}</div>`).join('');
    const key = `<div class="c key">${I.key || ''}</div>`;
    const strip = `<div class="strip ibd${I.strip.length > 2 ? ' three' : ''}">${I.strip.map((s) => `<div data-sec="${esc(s.head)}"><span class="pre">${esc(s.head)}</span>${esc(s.text)}</div>`).join('')}</div>`;
    const first = p === 0
      ? `<div class="masthead"><div><div class="titlerow"><h1>Crohn's and colitis</h1><span class="madeby">Created with <b>My Medical Daybook</b></span></div><div class="sub">Bowels, blood and urgency against ${esc(I.patient)}'s usual, flares, treatment and results as logged, for the IBD team.${I.condition ? ' ' + esc(I.condition.charAt(0).toUpperCase() + I.condition.slice(1)) + '.' : ''}</div></div><div class="who"><strong>${esc(I.patient)}</strong>Period: ${esc(I.period)}<br>Prepared: ${esc(I.prepared)}</div></div>`
        + `<div class="tiles ibd">${I.tiles.map((t) => `<div class="tile ${esc(t.tone || '')}"><div class="k">${esc(t.k)}</div><div class="v">${esc(t.v)}${t.unit ? `<em>${esc(t.unit)}</em>` : ''}</div><div class="n">${esc(t.n)}</div></div>`).join('')}</div>`
        + `<div class="cgrid ibd">${charts}${key}</div>` + strip
      : `<div class="runner"><h2>Crohn's and colitis</h2><span>${esc(I.patient)} · ${esc(I.period)}</span></div>`;
    return `<section class="page" id="page${p + 1}">${first}<div class="wbody">${html}</div><div class="foot"><span>As logged in Daybook, against ${esc(I.patient)}'s own usual. Results as the team gave them. Not medical advice.</span>${madeBy(p + 1, total)}</div></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Crohn's and colitis, ${esc(I.patient)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}${IBD_CSS}</style>
</head>
<body class="ibd">
${pages}
</body>
</html>`;
}
export function fitIbdReport(frame, I, opts = {}) { return paginate(frame, I, ibdReportHtml, opts); }
