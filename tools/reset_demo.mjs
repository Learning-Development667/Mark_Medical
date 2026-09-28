/* Wipes the demo project's data so the next visitor starts from the example data again.
   The app itself reseeds (seedDemoIfEmpty in scripts.js) when it finds the demo empty, so
   this only deletes. Run nightly by .github/workflows/reset-demo.yml, or by hand from the
   Actions tab. Never point it at the real project: it takes the DEMO service account only.

   Environment: DEMO_SERVICE_ACCOUNT (the demo project's service account JSON). */

import { createSign } from 'node:crypto';

const sa = JSON.parse(process.env.DEMO_SERVICE_ACCOUNT || '{}');
if (!sa.client_email || !sa.private_key || !sa.project_id) {
  console.error('DEMO_SERVICE_ACCOUNT secret is missing or incomplete');
  process.exit(1);
}
if (process.env.REAL_PROJECT_ID && sa.project_id === process.env.REAL_PROJECT_ID) {
  console.error('Refusing to wipe: this service account belongs to the real project');
  process.exit(1);
}

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
const signer = createSign('RSA-SHA256');
signer.update(header + '.' + claims);
const jwt = header + '.' + claims + '.' + signer.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
});
if (!tokenRes.ok) { console.error('Could not get a token: ' + tokenRes.status + ' ' + await tokenRes.text()); process.exit(1); }
const { access_token: token } = await tokenRes.json();

const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };

/* Every document name in a collection path ("entries", "documents/abc/pages") */
async function listNames(path) {
  const names = [];
  let pageToken = '';
  do {
    const url = `${base}/${path}?pageSize=300&mask.fieldPaths=__name__${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
    const res = await fetch(url, { headers });
    if (res.status === 404) return names;
    if (!res.ok) throw new Error(`List ${path} failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    (body.documents || []).forEach((d) => names.push(d.name));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return names;
}
async function deleteAll(names) {
  for (let i = 0; i < names.length; i += 400) {
    const res = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: names.slice(i, i + 400).map((name) => ({ delete: name })) }) });
    if (!res.ok) throw new Error(`Delete failed: ${res.status} ${await res.text()}`);
  }
}

/* Subcollections first (document pages), then the collections. users is left alone: the guest's record, if any. */
let total = 0;
const docNames = await listNames('documents');
for (const name of docNames) {
  const id = name.split('/').pop();
  const pages = await listNames(`documents/${id}/pages`);
  await deleteAll(pages);
  total += pages.length;
}
for (const col of ['entries', 'medicines', 'documents', 'profile', 'days', 'cheers', 'exercise', 'meals', 'nutrition', 'bridge']) {
  const names = await listNames(col);
  await deleteAll(names);
  total += names.length;
  console.log(`${col}: ${names.length} deleted`);
}
console.log(`Demo wiped: ${total} documents removed from ${sa.project_id}. The app reseeds the example data on the next visit.`);
