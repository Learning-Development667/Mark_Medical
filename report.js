/* The two-page Notes for the team report (since v117), from the approved design
   (clinical-summary-report.html, October 2026). reportHtml(R) turns the data the app prepares
   (buildTwoPage() in scripts.js) into a complete A4 HTML document: page 1 the latest new symptom,
   eight tiles, the medicines strip, Steady and the questions with room to write; page 2 the
   charts and two weekly cards. Nothing in here works anything out from the readings: every
   number arrives in R already calculated. fitReport() writes it into an iframe, checks that both
   pages fit, and shortens what it is allowed to (writing lines, then questions moved to "plus N
   more", then the weekly entries) until they do; if they still do not, it fails and names the
   section. Exactly two pages, never three. UK English, no em dashes. */

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
.foot{display:flex;justify-content:space-between;font-size:6.6pt;color:var(--slate);border-top:1px solid var(--line);padding-top:1.6mm;margin-top:auto}
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
  const any = cfg.series.some((se) => se.d.some((v) => v != null));
  if (!any) {
    s += `<text x="${L + pw / 2}" y="${T + ph / 2 + 2}" font-size="7" fill="${C.slate}" text-anchor="middle">No readings in this period</text>`;
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
      se.d.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true; });
      s += `<path d="${d}" fill="none" stroke="${se.c}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      se.d.forEach((v, i) => { if (v != null) s += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" fill="${se.c}"/>`; });
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

function weekHtml(w, wide) {
  const items = w.entries.length
    ? `<ul>${w.entries.map((e) => `<li${e.alert ? ' class="alert"' : ''}><time>${esc(e.when)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>`
    : '<p class="none">No written notes this week.</p>';
  return `<div class="week${wide ? ' wide' : ''}" data-sec="${esc(w.title)}"><div class="wh"><h3>${esc(w.title)}</h3><span>${esc(w.range)}</span></div>${w.theme ? `<div class="theme">${esc(w.theme)}</div>` : ''}${items}${w.foot ? `<p class="ai">${esc(w.foot)}</p>` : ''}</div>`;
}

/* R: { title, subtitle, patient, period, prepared, latest?, tiles[8], meds, hospital?, steady?,
   questions[{ team, text, by }], more, lines, otherBy, charts[], days[], weeks[], foot, bar? } */
export function reportHtml(R) {
  const strip = [];
  const medsHtml = `<div data-sec="Medicines"><b>When-needed medicines.</b> ${esc(R.meds)}${R.hospital ? `<br><b>${esc(R.hospital.label)}</b> ${esc(R.hospital.text)}` : ''}</div>`;
  strip.push(medsHtml);
  if (R.steady) strip.push(`<div class="steady" data-sec="Steady"><b>Steady.</b> ${esc(R.steady)}</div>`);
  const qs = R.questions.map((q, i) => questionHtml({ ...q, i: i + 1, lines: R.lines }, false));
  const other = questionHtml({ text: 'Other points from today', by: R.otherBy || 'For anything raised in the appointment', lines: R.lines }, true);
  /* An odd number of questions leaves the Other points card the empty half; otherwise it takes the full width */
  const otherCard = R.questions.length % 2 ? other : other.replace('class="q extra"', 'class="q extra wide"');
  const charts = R.charts.map((c) => `<div class="c" data-sec="${esc(c.title)}"><div class="h"><h3>${esc(c.title)}</h3><span class="stat ${esc(c.tone || '')}">${esc(c.stat)}</span></div>${renderChart(c, R.days)}</div>`).join('');
  const key = `<div class="c key"><b>Key</b><span><i class="sw" style="background:rgba(224,160,48,.45)"></i>Amber: worth mentioning</span><span><i class="sw" style="background:rgba(200,69,59,.45)"></i>Red: raise promptly</span><span><i class="sw" style="background:${C.ink}"></i><i class="sw" style="background:${C.teal}"></i>Blood pressure: dark systolic, teal diastolic</span><span>Sleep bars under 5 h are amber.</span></div>`;
  const weeks = R.weeks.length ? R.weeks.map((w) => weekHtml(w, R.weeks.length === 1)).join('')
    : weekHtml({ title: 'Notes', range: R.period, theme: '', entries: [] }, true).replace('No written notes this week.', 'No written notes in this period.');
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
    <div><h1>${esc(R.title)}</h1><div class="sub">${esc(R.subtitle)}</div></div>
    <div class="who"><strong>${esc(R.patient)}</strong>Period: ${esc(R.period)}<br>Prepared: ${esc(R.prepared)}, from Daybook</div>
  </div>
  ${R.latest ? `<div class="latest" data-sec="Latest"><div class="when">${esc(R.latest.when1)}<br>${esc(R.latest.when2)}</div><div><b>${esc(R.latest.title)}</b>${esc(R.latest.text)}</div></div>` : ''}
  <div data-sec="At a glance">
    <h2 class="sec" style="margin-bottom:2.4mm">At a glance <small>Highlights from simple checks by the app. Not medical advice.</small></h2>
    <div class="tiles">${R.tiles.map(tileHtml).join('')}</div>
  </div>
  <div class="strip${strip.length === 1 ? ' one' : ''}">${strip.join('')}</div>
  <div class="qwrap" data-sec="Questions">
    <h2 class="sec" style="margin-bottom:2.4mm">Questions for the team <small>Space is left under each one to write the reply.</small></h2>
    <div class="qgrid">${qs.join('')}${otherCard}</div>
    ${R.more ? `<p class="more">Plus ${esc(R.more)} more ${R.more === 1 ? 'question' : 'questions'} in the app.</p>` : ''}
  </div>
  <div class="foot"><span>${esc(R.foot)}</span><span>Page 1 of 2</span></div>
</section>
<section class="page" id="page2">
  <div class="runner"><h2>Readings and weekly notes</h2><span>${esc(R.patient)} · ${esc(R.period)}</span></div>
  <div class="cgrid" data-sec="Charts">${charts}${key}</div>
  <div class="wwrap" data-sec="Week by week">
    <h2 class="sec" style="margin-bottom:2.4mm">Week by week <small>${esc(R.weeksNote || 'Each week summarised from the daily notes.')}</small></h2>
    <div class="weeks">${weeks}</div>
  </div>
  <div class="foot"><span>${esc(R.foot)}</span><span>Page 2 of 2</span></div>
</section>
</body>
</html>`;
}

/* Which sections run past their space: anything whose bottom passes the top of its page's foot,
   a card whose own content is taller than the card, or a page whose content is taller than A4 */
export function overflowOf(doc) {
  const out = [];
  doc.querySelectorAll('.page').forEach((page) => {
    const foot = page.querySelector('.foot');
    const limit = foot.getBoundingClientRect().top + 0.5;
    page.querySelectorAll('[data-sec]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > limit || el.scrollHeight > el.clientHeight + 1) out.push(el.dataset.sec);
    });
    if (page.scrollHeight > page.clientHeight + 1 && !out.length) out.push(page.id === 'page1' ? 'Page 1' : 'Page 2');
  });
  return [...new Set(out)];
}

/* Shorten one weekly entry: a sentence off the end, or failing that a cut at a word with an ellipsis */
function shorten(text) {
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (parts && parts.length > 1) return parts.slice(0, -1).join('').trim();
  const cut = text.slice(0, Math.floor(text.length * 0.75)).replace(/\s+\S*$/, '');
  return cut.length < text.length ? cut.replace(/[,;:]$/, '') + '…' : text;
}
/* One step of shortening for the sections that ran over; false when nothing more can give */
export function shrink(R, over) {
  const weekOver = R.weeks.filter((w) => over.includes(w.title) || over.includes('Week by week') || over.includes('Page 2'));
  if (weekOver.length) {
    let changed = false;
    weekOver.forEach((w) => {
      const long = w.entries.slice().sort((a, b) => b.text.length - a.text.length)[0];
      if (long && long.text.length > 110) { const t = shorten(long.text); if (t !== long.text) { long.text = t; changed = true; return; } }
      const drop = w.entries.findIndex((e) => !e.alert);
      if (w.entries.length > 1 && drop >= 0) { w.entries.splice(drop, 1); w.dropped = (w.dropped || 0) + 1; changed = true; return; }
      if (w.theme && w.theme.length > 90) { w.theme = shorten(w.theme); changed = true; }
    });
    if (changed) return true;
  }
  const page1 = over.some((s) => /^Question|^Other points|^Questions|^Page 1|^Medicines|^Steady|^Latest/.test(s));
  if (page1) {
    if (R.lines > 1) { R.lines -= 1; return true; }
    if (R.questions.length > 1) { R.questions.pop(); R.more = (R.more || 0) + 1; return true; }
    if (R.latest && R.latest.text.length > 90) { R.latest.text = shorten(R.latest.text); return true; }
  }
  return false;
}

/* Writes the report into the iframe until it fits; resolves { ok, R, doc } or { ok: false, over } */
export async function fitReport(frame, R, opts = {}) {
  const write = (html) => new Promise((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = html;
  });
  for (let i = 0; i < 60; i++) {
    await write((opts.html || reportHtml)(R));
    const doc = frame.contentDocument;
    doc.documentElement.classList.add('capture');
    if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, opts.fontWait || 3000))]);
    const over = overflowOf(doc);
    if (!over.length) return { ok: true, R, doc };
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
.dq .more{font-size:7pt;color:var(--slate);margin-top:1.4mm}
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

function foodWeekHtml(w, wide) {
  const chips = w.chips.map((c) => `<div class="chip ${c.cls}">${esc(c.top)}<b>${esc(c.val)}</b></div>`).join('');
  const items = w.entries.length ? `<ul>${w.entries.map((e) => `<li><time>${esc(e.when)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>` : '<p class="none">Nothing logged this week.</p>';
  const often = w.often.length ? `<div class="often"><h4>What came up most</h4><ul>${w.often.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></div>` : '';
  return `<div class="week${wide ? ' wide' : ''}" data-sec="${esc(w.title)}"><div class="wh"><h3>${esc(w.title)}</h3><span>${esc(w.range)}</span></div>${w.pills.length ? `<div class="pills">${w.pills.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}${w.theme ? `<div class="theme">${esc(w.theme)}</div>` : ''}${chips ? `<div class="chips">${chips}</div>` : ''}${items}${often}</div>`;
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
    <div><h1>Food diary</h1><div class="sub">What was eaten and drunk, summarised for the dietitian, nurse or doctor.</div></div>
    <div class="who"><strong>${esc(F.patient)}</strong>Logged: ${esc(F.logged)}<br>Prepared: ${esc(F.prepared)}, from Daybook</div>
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
      <div class="pts" data-sec="Points to discuss"><h3>Points to discuss</h3><ul>${F.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
      ${F.questions && F.questions.length ? `<div class="dq" data-sec="Questions"><h3>Questions for the dietitian</h3><ul>${F.questions.map((q) => `<li><b>${esc(q.text)}</b><span>${esc(q.by)}</span></li>`).join('')}</ul>${F.more ? `<p class="more">Plus ${esc(F.more)} more ${F.more === 1 ? 'question' : 'questions'} in the app.</p>` : ''}</div>` : ''}
      <div class="nlines" data-sec="Dietitian notes"><h3>Notes from the dietitian</h3><div class="lines">${(() => { let l = ''; for (let i = 1; i <= 40; i++) l += `<i style="top:calc(${i} * 5.2mm)"></i>`; return l; })()}</div></div>
    </div>
  </div>
  <div class="foot"><span>${esc(F.caveat)}</span><span>Page 1 of 2</span></div>
</section>
<section class="page" id="page2">
  <div class="runner"><h2>Trends and weekly summary</h2><span>${esc(F.patient)} · ${esc(F.period)}</span></div>
  <div class="cgrid" data-sec="Charts">${charts}${key}</div>
  <div class="wwrap" data-sec="Week by week">
    <h2 class="sec" style="margin-bottom:2.2mm">Week by week <small>Weeks match Notes for the team. Chips show protein in grams each day.</small></h2>
    <div class="weeks">${weeks}</div>
  </div>
  <div class="foot"><span>Daybook · Food diary</span><span>Page 2 of 2</span></div>
</section>
</body>
</html>`;
}
export function foodChartSvg(kind, D, o) {
  if (kind === 'stacked') return stackedMacros(D, o.uid);
  return foodBars(o, D, o.uid);
}
/* One step of shortening for the Food diary: the weekly entries first (a sentence off the longest,
   then the earliest entry), then the points to discuss */
export function shrinkFood(F, over) {
  const weekOver = F.weeks.filter((w) => over.includes(w.title) || over.includes('Week by week') || over.includes('Page 2'));
  for (const w of weekOver) {
    const long = w.entries.slice().sort((a, b) => b.text.length - a.text.length)[0];
    if (long && long.text.length > 90) { const t = shorten(long.text); if (t !== long.text) { long.text = t; return true; } }
    if (w.often.length > 2) { w.often.pop(); return true; }
    if (w.entries.length > 2) { w.entries.splice(w.entries[0].lead ? 1 : 0, 1); return true; }
    if (w.often.length) { w.often = []; return true; }
  }
  if (over.some((s) => /Points|Questions|Page 1|Food groups|Drinks|Dietitian/.test(s)) && F.questions && F.questions.length > 1) { F.questions.pop(); F.more = (F.more || 0) + 1; return true; }
  if (over.some((s) => /Points|Questions|Page 1|Food groups|Drinks|Dietitian/.test(s)) && F.points.length > 2) { F.points.pop(); return true; }
  return false;
}
