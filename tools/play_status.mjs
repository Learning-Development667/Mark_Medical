/* Read-only: what Google Play holds for Daybook's test tracks (v427, Mark: Android testers see "Item not found"). Opens an
   edit (Play's way of reading a draft), prints each track's releases (build numbers and states), then deletes the edit
   without committing, so nothing changes. Prints build numbers, states and counts only; never a tester's address.
   Needs PLAY_SERVICE_ACCOUNT_JSON. Usage: node tools/play_status.mjs */
import { createSign } from 'node:crypto';

const PKG = 'uk.co.mark1apps.daybook';
const sa = JSON.parse(process.env.PLAY_SERVICE_ACCOUNT_JSON || '{}');
if (!sa.client_email || !sa.private_key) { console.error('PLAY_SERVICE_ACCOUNT_JSON is missing'); process.exit(1); }
const b64 = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 }));
const signer = createSign('RSA-SHA256'); signer.update(head + '.' + claims);
const jwt = head + '.' + claims + '.' + signer.sign(sa.private_key).toString('base64url');
const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt })).json();
if (!tok.access_token) { console.error('No token: ' + (tok.error || 'unknown')); process.exit(1); }
const H = { authorization: 'Bearer ' + tok.access_token, 'content-type': 'application/json' };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const call = async (method, path) => { const r = await fetch(base + path, { method, headers: H }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: ${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {}; };

const edit = await call('POST', '/edits');
try {
  const { tracks = [] } = await call('GET', `/edits/${edit.id}/tracks`);
  for (const t of tracks) {
    const rel = (t.releases || []).map((r) => `${r.name || '(no name)'}: builds ${(r.versionCodes || []).join(', ') || 'none'}, ${r.status}${r.userFraction ? ' ' + Math.round(r.userFraction * 100) + '%' : ''}`);
    console.log(`Track ${t.track}: ${rel.length ? rel.join(' | ') : 'no releases'}`);
  }
  try {
    const testers = await call('GET', `/edits/${edit.id}/testers/internal`);
    console.log(`Internal testers: ${(testers.googleGroups || []).length} Google Groups linked (email lists are not shown by the API)`);
  } catch (e) { console.log('Internal testers: could not be read (' + String(e.message).slice(0, 120) + ')'); }
  try {
    const c = await call('GET', `/edits/${edit.id}/countryAvailability/internal`);
    console.log(`Internal countries: ${(c.countries || []).length}${c.restOfWorld ? ', plus rest of world' : ''}`);
  } catch (e) { console.log('Internal countries: could not be read (' + String(e.message).slice(0, 120) + ')'); }
} finally {
  await call('DELETE', `/edits/${edit.id}`).catch(() => {});
}
