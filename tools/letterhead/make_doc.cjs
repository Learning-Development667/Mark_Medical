#!/usr/bin/env node
/* Mark 1 Apps letterhead: turns a Markdown file into a Word document on the company letterhead
   (the faint sky header with the logo, the watercolour foot with the company lines), the same look
   as the letter template agreed on 3 November 2026. Every company document goes out on it.

   node tools/letterhead/make_doc.cjs in.md out.docx
   LETTERHEAD_PHONE="0..." adds the phone number under the email (kept out of this public repository;
   it is in the brand rules doc). NODE_PATH must reach the docx package (/opt/node-tools/node_modules here).

   Markdown understood: # title, ## and ### headings, paragraphs with **bold**, - bullets, - [ ] tasks,
   1. numbered lines, <space> on its own line for room to sign, pipe tables (an all-empty header row is dropped), and ![caption](picture.png) on
   its own line for a picture (![caption|300](pic.png) for 300 px wide). Body text Arial 11 pt so it reads the same on any computer and in Pages. */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, AlignmentType, TabStopType,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, LevelFormat } = require('docx');

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('Usage: make_doc.cjs in.md out.docx'); process.exit(1); }
const here = __dirname;
const NAVY = '17263A', SLATE = '4B5B6B', INK = '1C2430', TEAL = '18727A', LINE = 'D5DEE5', MIST = 'EEF3F6', F = 'Arial', PX = 9525;
const TEXT_W = 9638; // A4 less 20 mm each side, in twentieths of a point
const sp = { before: 0, after: 0, line: 276 };

const float = (file, w, h, y, alt) => new ImageRun({ type: 'jpg', data: fs.readFileSync(path.isAbsolute(file) ? file : path.join(here, file)),
  transformation: { width: w, height: h }, altText: { title: alt, description: alt, name: alt },
  floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
    verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: y * PX },
    behindDocument: true, allowOverlap: true, lockAnchor: true, wrap: { type: TextWrappingType.NONE } } });

// **bold** inside a line
const runs = (text, o = {}) => text.split(/(\*\*[^*]+\*\*)/).filter(s => s !== '').map(s => {
  const b = s.startsWith('**') && s.endsWith('**');
  return new TextRun({ text: (b ? s.slice(2, -2) : s).replace(/\\([.\-*_\[\]#])/g, '$1').replace(/&#91;/g, '[').replace(/`/g, ''),
    font: F, size: o.size || 22, color: o.color || INK, bold: o.bold || b });
});

const phone = process.env.LETTERHEAD_PHONE || '';
/* The contact lines are drawn into the header picture itself (bake_header.py, run first; LETTERHEAD_HEADER names the result):
   Pages laid the right-aligned text lines over the logo (7 November 2026, Mark: "this looks shocking"), so the header is one
   picture that no app can rearrange. Without a baked picture the plain header.jpg is used, with no contact lines. */
const headerPic = process.env.LETTERHEAD_HEADER || 'header.jpg';
const header = new Header({ children: [
  new Paragraph({ spacing: { ...sp, line: 240 }, children: [float(headerPic, 794, 145, 0, 'Mark 1 Apps Ltd, makers of My Medical Daybook'), new TextRun({ text: '', size: 18 })] }),
] });
const fl = r => new Paragraph({ spacing: { ...sp, line: 250 }, tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }], children: r });
const ft = (t, o = {}) => new TextRun({ text: t, font: F, size: o.size || 16, color: NAVY, bold: o.bold });
const footer = new Footer({ children: [
  new Paragraph({ spacing: sp, children: [float('footer.jpg', 794, 150, 973, 'Watercolour of trees at dawn'), new TextRun({ text: '', size: 16 })] }),
  fl([ft('Mark 1 Apps Ltd. Registered in England and Wales, company number 17510025.')]),
  fl([ft('Registered office: 71-75 Shelton Street, London WC2H 9JQ.')]),
  fl([ft('ICO registration ZC275185.'), ft('\tmymedicaldaybook.co.uk', { size: 18, bold: true })]),
] });

const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const rule = { style: BorderStyle.SINGLE, size: 4, color: LINE };
function table(rows, whole) {
  const cells = rows.map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  const body = cells.filter((r, i) => i !== 1); // drop the --- row
  let head = true;
  if (body[0].every(c => !c)) { body.shift(); head = false; }
  const n = Math.max(...body.map(r => r.length));
  // at least room for the column's longest word and its heading, so a short column ("After", "Low") never breaks mid-word
  const len = Array.from({ length: n }, (_, i) => Math.max(10, ...body.map(r => (r[i] || '').length),
    ...body.map(r => Math.max(0, ...(r[i] || '').split(/\s+/).map(w => w.length + 5)))));
  const capped = len.map(l => Math.min(l, 60)), sum = capped.reduce((a, b) => a + b, 0);
  const widths = capped.map(l => Math.floor(TEXT_W * l / sum));
  widths[n - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
  return new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: body.map((r, ri) => new TableRow({ tableHeader: head && ri === 0, cantSplit: true,
      children: Array.from({ length: n }, (_, ci) => new TableCell({ width: { size: widths[ci], type: WidthType.DXA },
        borders: { top: rule, bottom: rule, left: none, right: none },
        shading: head && ri === 0 ? { type: ShadingType.CLEAR, fill: MIST, color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({ spacing: sp, keepNext: !!whole && ri < body.length - 1, children: runs(r[ci] || '', { size: 19, bold: (head && ri === 0) || (!head && ci === 0), color: (head && ri === 0) ? NAVY : INK }) })] })) })) });
}

const md = fs.readFileSync(inFile, 'utf8').replace(/\r/g, '').split('\n');
const gap = (after = 120) => new Paragraph({ spacing: { before: 0, after }, children: [] });
/* A heading never sits at the foot of a page with a line or two under it (Mark, 25 November 2026: "when you have a title or
   sub title that close to the bottom of a page you normally just start it on the next page"). Each heading is held, with
   Word's keep-with-next, to the opening of its own section: the next HOLD blocks (an intro line, the first bullets), or up to
   and including a picture and the paragraph under it, never past the next heading or a table. When those do not all fit, the heading starts the next
   page. A table of TABLE_WHOLE rows or fewer is kept in one piece, so no row is left alone on a page. */
const HOLD = 3, TABLE_WHOLE = 20;
const items = []; // { kind: 'head' | 'pic' | 'text' | 'table' | 'gap', boldLine?, make(keep) }
for (let i = 0; i < md.length; i++) {
  const l = md[i];
  if (!l.trim()) continue;
  if (l.trim() === '<space>') { items.push({ kind: 'gap', make: () => gap(480) }); continue; } // room to sign or write by hand
  if (l.startsWith('|')) { const t = []; while (i < md.length && md[i].startsWith('|')) t.push(md[i++]); i--; items.push({ kind: 'table', make: () => table(t, t.length - 1 <= TABLE_WHOLE) }); items.push({ kind: 'gap', make: () => gap(160) }); continue; }
  let m;
  if ((m = l.match(/^!\[(.*)\]\((.+)\)\s*$/))) {
    const file = path.resolve(path.dirname(inFile), m[2]);
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); // PNG size
    const want = Number((m[1].match(/\|(\d+)$/) || [])[1]) || 642; // ![caption|300](pic.png) sets the width
    const dw = Math.min(642, want), dh = Math.round(h * dw / w), alt = m[1].replace(/\|\d+$/, '');
    items.push({ kind: 'pic', make: (keep) => new Paragraph({ spacing: { before: 60, after: 160 }, keepNext: keep, children: [new ImageRun({ type: 'png', data: buf, transformation: { width: dw, height: dh }, altText: { title: alt, description: alt, name: 'picture' } })] }) });
    continue;
  }
  if ((m = l.match(/^# (.+)/))) { const t = m[1]; items.push({ kind: 'head', make: (keep) => new Paragraph({ spacing: { before: 0, after: 80 }, keepNext: keep, children: runs(t, { size: 34, bold: true, color: NAVY }) }) }); continue; }
  if ((m = l.match(/^## (.+)/))) { const t = m[1]; items.push({ kind: 'head', make: (keep) => new Paragraph({ spacing: { before: 240, after: 100 }, keepNext: keep, children: runs(t, { size: 27, bold: true, color: NAVY }) }) }); continue; }
  if ((m = l.match(/^### (.+)/))) { const t = m[1]; items.push({ kind: 'head', make: (keep) => new Paragraph({ spacing: { before: 160, after: 80 }, keepNext: keep, children: runs(t, { size: 23, bold: true, color: TEAL }) }) }); continue; }
  if ((m = l.match(/^- \[( |x)\] (.+)/))) { const done = m[1] === 'x', t = m[2]; items.push({ kind: 'text', make: (keep) => new Paragraph({ keepNext: keep, spacing: { before: 0, after: 80, line: 276 }, indent: { left: 900, hanging: 900 }, children: [new TextRun({ text: (done ? 'Done' : 'To do') + '\t', font: F, size: 22, color: NAVY, bold: true }), ...runs(t)], tabStops: [{ type: TabStopType.LEFT, position: 900 }] }) }); continue; }
  if ((m = l.match(/^- (.+)/))) { const t = m[1]; items.push({ kind: 'text', make: (keep) => new Paragraph({ keepNext: keep, numbering: { reference: 'dots', level: 0 }, spacing: { before: 0, after: 80, line: 276 }, children: runs(t) }) }); continue; }
  // a line that is all bold is a small heading: keep it with what follows
  items.push({ kind: 'text', boldLine: /^\*\*[^*]+\*\*$/.test(l.trim()), make: (keep) => new Paragraph({ spacing: { before: 0, after: 160, line: 288 }, keepNext: keep, children: runs(l) }) });
}
const keep = items.map((it, i) => it.kind === 'head' ? i < items.length - 1 : !!it.boldLine);
for (let i = 0; i < items.length; i++) {
  if (items[i].kind !== 'head' || (items[i + 1] && items[i + 1].kind === 'head')) continue; // the last of a run of headings opens the hold
  const run = [];
  for (let j = i + 1; j < items.length && run.length < HOLD; j++) {
    const k = items[j].kind;
    if (k === 'head' || k === 'table' || k === 'gap') break;
    run.push(j);
    if (k === 'pic') { if (items[j + 1] && items[j + 1].kind === 'text') run.push(j + 1); break; } // a picture and the words that explain it
  }
  run.forEach((j, n) => { keep[j] = n < run.length - 1; });
  // an intro line that leads straight into a sub-heading stays with it (the sub-heading holds its own opening)
  const last = run[run.length - 1];
  const cutShort = run.length < HOLD && !run.some((j) => items[j].kind === 'pic');
  if (cutShort && last !== undefined && items[last + 1] && items[last + 1].kind === 'head') keep[last] = true;
}
const out = items.map((it, i) => it.make(keep[i]));

const doc = new Document({ creator: 'Mark 1 Apps Ltd', title: path.basename(outFile, '.docx'),
  styles: { default: { document: { run: { font: F, size: 22, color: INK } } } },
  numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 280 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 2550, bottom: 2350, left: 1134, right: 1134, header: 900, footer: 420 } } },
    headers: { default: header }, footers: { default: footer }, children: out }] });
Packer.toBuffer(doc).then(b => { fs.writeFileSync(outFile, b); console.log('Made ' + outFile); });
