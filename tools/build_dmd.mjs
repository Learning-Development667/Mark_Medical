/* Builds data/dmd.json, the NHS Dictionary of Medicines and Devices (dm+d) trimmed to medicine names, for the
   suggestions in Add medicine (v391). Run by .github/workflows/build-dmd.yml with the TRUD_API_KEY secret (a free NHS
   TRUD account subscribed to "NHSBSA dm+d"; Open Government Licence). Keeps the generic products that have a medicine
   behind them (VMPs with a VTM, so dressings and appliances are left out) and the branded ones (AMPs) of those, names
   only, de-duplicated, A to Z. Prints counts and the release name only. Node 20, no packages; unzip from the runner. */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const KEY = process.env.TRUD_API_KEY;
const ITEM = process.env.DMD_ITEM || '24'; // TRUD's item number for "NHSBSA dm+d"
if (!KEY) { console.error('TRUD_API_KEY is not set'); process.exit(1); }

const api = `https://isd.digital.nhs.uk/trud/api/v1/keys/${encodeURIComponent(KEY)}/items/${ITEM}/releases?latest`;
const meta = await (await fetch(api)).json().catch(() => null);
const rel = meta && Array.isArray(meta.releases) && meta.releases[0];
if (!rel || !rel.archiveFileUrl) { console.error('No release found (check the subscription and the item number)'); process.exit(1); }
console.log('Release:', rel.name || rel.id, rel.releaseDate || '');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmd-'));
const zip = path.join(dir, 'dmd.zip');
const res = await fetch(rel.archiveFileUrl);
if (!res.ok) { console.error('Download failed:', res.status); process.exit(1); }
fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
let files = walk(dir);
const find = (re) => files.find((f) => re.test(path.basename(f)));
if (!find(/^f_vmp2_.*\.xml$/i)) { // the XML may sit in a zip inside the release
  files.filter((f) => f.endsWith('.zip') && f !== zip).forEach((z) => execFileSync('unzip', ['-o', '-q', z, '-d', path.join(dir, path.basename(z, '.zip'))]));
  files = walk(dir);
}
const vmpFile = find(/^f_vmp2_.*\.xml$/i), ampFile = find(/^f_amp2_.*\.xml$/i);
if (!vmpFile || !ampFile) { console.error('The VMP or AMP file is missing from the release'); process.exit(1); }

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (block, t) => { const m = block.match(new RegExp('<' + t + '>([^<]*)</' + t + '>')); return m ? unxml(m[1]).trim() : ''; };
const blocks = (text, t) => text.split('<' + t + '>').slice(1).map((b) => b.split('</' + t + '>')[0]);

const vmpText = fs.readFileSync(vmpFile, 'utf8');
const kept = new Set();
const names = new Set();
for (const b of blocks(vmpText, 'VMP')) {
  if (tag(b, 'INVALID') === '1' || !tag(b, 'VTMID')) continue;
  const nm = tag(b, 'NM');
  if (!nm) continue;
  kept.add(tag(b, 'VPID'));
  names.add(nm);
}
const generic = names.size;
const ampText = fs.readFileSync(ampFile, 'utf8');
for (const b of blocks(ampText, 'AMP')) {
  if (tag(b, 'INVALID') === '1' || !kept.has(tag(b, 'VPID'))) continue;
  const nm = tag(b, 'NM');
  if (nm) names.add(nm);
}
const list = [...names].sort((a, b) => a.localeCompare(b, 'en-GB'));
const out = { source: 'NHS Dictionary of Medicines and Devices (dm+d), NHS Business Services Authority, Open Government Licence v3.0', release: String(rel.name || ''), releaseDate: String(rel.releaseDate || ''), names: list };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/dmd.json', JSON.stringify(out));
console.log('Generic products:', generic, '| names in all:', list.length, '| file:', Math.round(fs.statSync('data/dmd.json').size / 1024), 'KB');
