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
function table(rows) {
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
        children: [new Paragraph({ spacing: sp, children: runs(r[ci] || '', { size: 19, bold: (head && ri === 0) || (!head && ci === 0), color: (head && ri === 0) ? NAVY : INK }) })] })) })) });
}

const md = fs.readFileSync(inFile, 'utf8').replace(/\r/g, '').split('\n');
const out = [];
const gap = (after = 120) => new Paragraph({ spacing: { before: 0, after }, children: [] });
for (let i = 0; i < md.length; i++) {
  const l = md[i];
  if (!l.trim()) continue;
  if (l.trim() === '<space>') { out.push(gap(480)); continue; } // room to sign or write by hand
  if (l.startsWith('|')) { const t = []; while (i < md.length && md[i].startsWith('|')) t.push(md[i++]); i--; out.push(table(t), gap(160)); continue; }
  let m;
  if ((m = l.match(/^!\[(.*)\]\((.+)\)\s*$/))) {
    const file = path.resolve(path.dirname(inFile), m[2]);
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); // PNG size
    const want = Number((m[1].match(/\|(\d+)$/) || [])[1]) || 642; // ![caption|300](pic.png) sets the width
    const dw = Math.min(642, want), dh = Math.round(h * dw / w);
    out.push(new Paragraph({ spacing: { before: 60, after: 160 }, keepNext: false, children: [new ImageRun({ type: 'png', data: buf, transformation: { width: dw, height: dh }, altText: { title: m[1].replace(/\|\d+$/, ''), description: m[1].replace(/\|\d+$/, ''), name: 'picture' } })] }));
    continue;
  }
  if ((m = l.match(/^# (.+)/))) { out.push(new Paragraph({ spacing: { before: 0, after: 80 }, keepNext: true, children: runs(m[1], { size: 34, bold: true, color: NAVY }) })); continue; }
  if ((m = l.match(/^## (.+)/))) { out.push(new Paragraph({ spacing: { before: 240, after: 100 }, keepNext: true, children: runs(m[1], { size: 27, bold: true, color: NAVY }) })); continue; }
  if ((m = l.match(/^### (.+)/))) { out.push(new Paragraph({ spacing: { before: 160, after: 80 }, keepNext: true, children: runs(m[1], { size: 23, bold: true, color: TEAL }) })); continue; }
  if ((m = l.match(/^- \[( |x)\] (.+)/))) { out.push(new Paragraph({ spacing: { before: 0, after: 80, line: 276 }, indent: { left: 900, hanging: 900 }, children: [new TextRun({ text: (m[1] === 'x' ? 'Done' : 'To do') + '\t', font: F, size: 22, color: NAVY, bold: true }), ...runs(m[2])], tabStops: [{ type: TabStopType.LEFT, position: 900 }] })); continue; }
  if ((m = l.match(/^- (.+)/))) { out.push(new Paragraph({ numbering: { reference: 'dots', level: 0 }, spacing: { before: 0, after: 80, line: 276 }, children: runs(m[1]) })); continue; }
  // a line that is all bold is a small heading: keep it with what follows
  out.push(new Paragraph({ spacing: { before: 0, after: 160, line: 288 }, keepNext: /^\*\*[^*]+\*\*$/.test(l.trim()), children: runs(l) }));
}

const doc = new Document({ creator: 'Mark 1 Apps Ltd', title: path.basename(outFile, '.docx'),
  styles: { default: { document: { run: { font: F, size: 22, color: INK } } } },
  numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 280 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 2550, bottom: 2350, left: 1134, right: 1134, header: 900, footer: 420 } } },
    headers: { default: header }, footers: { default: footer }, children: out }] });
Packer.toBuffer(doc).then(b => { fs.writeFileSync(outFile, b); console.log('Made ' + outFile); });
