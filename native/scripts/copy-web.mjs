// Copies Daybook's web files from the repository root into native/www,
// which Capacitor puts inside the iPhone app. Run before every build
// (npm run sync does it). www is not kept in git: it is made from the root.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'www');

const FILES = ['index.html', 'scripts.js', 'styles.css', 'report.js', 'sw.js', 'manifest.json', 'config.js'];
const DIRS = ['icons', 'guide', 'data', 'vendor'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) {
  if (!existsSync(join(root, f))) throw new Error('Missing ' + f);
  cpSync(join(root, f), join(out, f));
}
for (const d of DIRS) cpSync(join(root, d), join(out, d), { recursive: true });
console.log('Copied the web app into', out);
