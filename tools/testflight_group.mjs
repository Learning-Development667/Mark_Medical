/* After a TestFlight upload (v411, Mark: "push the Apple build to TestFlight without me having to do it manually"):
   waits for Apple to finish processing the build, writes its What to Test text (native/ios/what-to-test.txt), adds it to
   the external group Circle Testers and asks for beta review (a group that has passed review is usually approved at once).
   Uses the App Store Connect API key the build uses. Prints ids and states only.
   Env: ASC_KEY_PATH (the .p8), ASC_KEY_ID, ASC_ISSUER_ID, BUILD_NUMBER, optional GROUP_NAME. */
import crypto from 'node:crypto';
import fs from 'node:fs';

const BUNDLE = 'uk.co.mark1apps.daybook';
const GROUP = process.env.GROUP_NAME || 'Circle Testers';
const BUILD = String(process.env.BUILD_NUMBER || '').trim();
const API = 'https://api.appstoreconnect.apple.com/v1';
if (!BUILD) { console.error('BUILD_NUMBER is missing'); process.exit(1); }

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: fs.readFileSync(process.env.ASC_KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64url(sig);
}
async function asc(method, path, body) {
  const res = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, codes: ((json && json.errors) || []).map((e) => e.code).join(',') };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await asc('GET', `/apps?filter[bundleId]=${BUNDLE}&limit=1`);
const appId = app.json && app.json.data && app.json.data[0] && app.json.data[0].id;
if (!appId) { console.error('App not found', app.status, app.codes); process.exit(1); }

/* Apple processes an upload for 5 to 30 minutes; wait up to 45 */
let build = null;
for (let i = 0; i < 90; i++) {
  const r = await asc('GET', `/builds?filter[app]=${appId}&filter[version]=${BUILD}&limit=1`);
  build = r.json && r.json.data && r.json.data[0];
  const state = build && build.attributes.processingState;
  if (state === 'VALID') break;
  if (state === 'FAILED' || state === 'INVALID') { console.error('Build ' + BUILD + ' processing ' + state); process.exit(1); }
  if (i % 4 === 0) console.log('Build ' + BUILD + ': ' + (state || 'not listed yet') + ', waiting');
  build = null;
  await sleep(30000);
}
if (!build) { console.error('Build ' + BUILD + ' was not ready after 45 minutes. Add it to the group by hand.'); process.exit(1); }
console.log('Build ' + BUILD + ' processed');

/* What to Test, in English (U.K.) */
const words = fs.readFileSync(process.env.NOTES_FILE || new URL('../native/ios/what-to-test.txt', import.meta.url), 'utf8').trim(); // the day's notes (tools/release_notes.mjs), else the standing text
const locs = await asc('GET', `/builds/${build.id}/betaBuildLocalizations`);
const gb = ((locs.json && locs.json.data) || []).find((l) => /^en-GB$/i.test(l.attributes.locale));
const wt = gb
  ? await asc('PATCH', `/betaBuildLocalizations/${gb.id}`, { data: { type: 'betaBuildLocalizations', id: gb.id, attributes: { whatsNew: words } } })
  : await asc('POST', '/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-GB', whatsNew: words }, relationships: { build: { data: { type: 'builds', id: build.id } } } } });
console.log('What to Test: ' + (wt.ok ? 'set' : 'not set (' + wt.status + ' ' + wt.codes + ')'));

/* The group */
const groups = await asc('GET', `/betaGroups?filter[app]=${appId}&limit=50`);
const group = ((groups.json && groups.json.data) || []).find((g) => g.attributes.name === GROUP);
if (!group) { console.error('Group not found: ' + GROUP); process.exit(1); }
const add = await asc('POST', `/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
console.log('Added to ' + GROUP + ': ' + (add.ok ? 'yes' : 'no (' + add.status + ' ' + add.codes + ')'));
if (!add.ok) process.exit(1);

/* Beta review: a build already reviewed or not needing it answers with a conflict, which is fine */
const sub = await asc('POST', '/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } });
console.log('Beta review: ' + (sub.ok ? 'submitted' : sub.status === 409 ? 'not needed or already sent' : 'not sent (' + sub.status + ' ' + sub.codes + ')'));
