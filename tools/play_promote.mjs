/* Puts the build just uploaded to internal testing on open testing (the beta track) as well (v457, Mark, 15 November 2026: "lets
   make sure its the most recent version and that this is always current"). Opens an edit, reads the internal track's newest
   build number, sets the beta track to that build with the same release notes, and commits; Google then reviews the open-testing
   release (it does not email when it is approved: check Publishing overview). Prints build numbers and states only.
   Needs PLAY_SERVICE_ACCOUNT_JSON. Usage: node tools/play_promote.mjs */
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
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
};
const edit = await call('POST', '/edits');
let committed = false;
try {
  const internal = await call('GET', `/edits/${edit.id}/tracks/internal`);
  const rel = (internal.releases || []).filter((r) => (r.versionCodes || []).length)
    .sort((a, b) => Math.max(...b.versionCodes.map(Number)) - Math.max(...a.versionCodes.map(Number)))[0];
  if (!rel) throw new Error('no build on internal testing');
  const code = String(Math.max(...rel.versionCodes.map(Number)));
  const beta = await call('GET', `/edits/${edit.id}/tracks/beta`).catch(() => ({ releases: [] }));
  const current = Math.max(0, ...(beta.releases || []).flatMap((r) => (r.versionCodes || []).map(Number)));
  if (Number(code) <= current) { console.log(`Open testing already has build ${current}; nothing to do`); }
  else {
    await call('PUT', `/edits/${edit.id}/tracks/beta`, { track: 'beta', releases: [{ name: rel.name || code, versionCodes: [code], status: 'completed', releaseNotes: rel.releaseNotes || [] }] });
    /* (v472) held: committed but not sent for review, for when Play Console has a rejection open or a declaration to change;
       Mark then presses Send changes for review in Publishing overview */
    await call('POST', `/edits/${edit.id}:commit` + (process.env.HOLD_FOR_REVIEW === 'true' ? '?changesNotSentForReview=true' : ''));
    committed = true;
    console.log(`Open testing: build ${code} ${process.env.HOLD_FOR_REVIEW === 'true' ? 'saved, waiting for Send changes for review in Play Console' : "sent for Google's review"} (was build ${current || 'none'})`);
  }
} finally {
  if (!committed) await call('DELETE', `/edits/${edit.id}`).catch(() => {});
}
