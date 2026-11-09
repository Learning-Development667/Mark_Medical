/* Release notes for the daily build (v411): the newest What's new batch in scripts.js, if it is from the last three days,
   grouped New, Improved and Fixed. Writes the TestFlight text (up to 4,000 characters) and Google Play's
   whatsnew/whatsnew-en-GB (Play allows 500, so it holds as many whole items as fit and points to What's new for the rest;
   no item is ever cut part way). Without a recent batch, the TestFlight text falls back to native/ios/what-to-test.txt.
   Usage: node tools/release_notes.mjs <out dir>  ->  <out dir>/testflight.txt, <out dir>/whatsnew/whatsnew-en-GB */
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = process.argv[2] || '.';
const src = fs.readFileSync(path.join(root, 'scripts.js'), 'utf8');
const start = src.indexOf('const WHATS_NEW = [');
const end = src.indexOf('\n];', start);
const WHATS_NEW = Function('return ' + src.slice(start + 'const WHATS_NEW = '.length, end + 2))();
const fallback = fs.readFileSync(path.join(root, 'native/ios/what-to-test.txt'), 'utf8').trim();
const batch = WHATS_NEW[0];
const recent = batch && (Date.now() - new Date(batch.id + 'T12:00:00Z').getTime()) < 3 * 86400000;
const LABEL = { new: 'New', improved: 'Improved', fixed: 'Fixed' };
const groups = ['new', 'improved', 'fixed', undefined].map((t) => ({ t, items: recent ? batch.items.filter((i) => i.tag === t) : [] })).filter((g) => g.items.length);

let tf = fallback;
if (groups.length) {
  tf = 'Thank you for testing Daybook. In this version:\n\n' + groups.map((g) => (LABEL[g.t] || 'Also') + '\n' + g.items.map((i) => '- ' + i.text).join('\n')).join('\n\n')
    + '\n\nYou are welcome to use Daybook for real. It is still in Beta, so keep your own copy of anything vital. Anything confusing or broken, tell us through Provide feedback under More, Help and what\'s new.';
}
const tail = '\nMore under More, Help and what\'s new.';
let play = groups.length ? '' : 'Improvements and fixes. See More, Help and what\'s new in Daybook.';
for (const g of groups) for (const i of g.items) {
  const line = (play ? '\n' : '') + (LABEL[g.t] ? LABEL[g.t] + ': ' : '') + i.text;
  if ((play + line + tail).length <= 500) play += line;
}
if (groups.length) play += tail;
fs.mkdirSync(path.join(out, 'whatsnew'), { recursive: true });
fs.writeFileSync(path.join(out, 'testflight.txt'), tf.slice(0, 4000));
fs.writeFileSync(path.join(out, 'whatsnew', 'whatsnew-en-GB'), play);
console.log('Release notes: ' + (groups.length ? 'batch ' + batch.id + ', ' + groups.reduce((n, g) => n + g.items.length, 0) + ' items' : 'the standing text') + '; Play ' + play.length + ' characters');
