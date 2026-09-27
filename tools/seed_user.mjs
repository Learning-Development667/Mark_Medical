/* Writes (or updates) one users/{uid} account record in Firestore, using the
   same service account the bridge uses. Run by .github/workflows/seed-user.yml
   from the Actions tab, so the secret never leaves GitHub and nobody has to
   fight the console's "Start a collection" dialog.

   Environment: FIREBASE_SERVICE_ACCOUNT (the service account JSON), plus
   USER_UID, NAME, ROLE ("family" | "readonly" | "viewer") and RELATION
   ("patient" | "carer" | ""). Prints the record it wrote. */

import { createSign } from 'node:crypto';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.client_email || !sa.private_key || !sa.project_id) {
  console.error('FIREBASE_SERVICE_ACCOUNT secret is missing or incomplete');
  process.exit(1);
}
const uid = (process.env.USER_UID || '').trim();
const name = (process.env.NAME || '').trim();
const role = (process.env.ROLE || '').trim();
const relation = (process.env.RELATION || '').trim();
if (!/^[A-Za-z0-9]{20,40}$/.test(uid)) { console.error('UID must be the 28-character id from Authentication > Users, got: ' + JSON.stringify(uid)); process.exit(1); }
if (!name) { console.error('NAME is required'); process.exit(1); }
if (!['family', 'readonly', 'viewer'].includes(role)) { console.error('ROLE must be family, readonly or viewer'); process.exit(1); }
if (!['patient', 'carer', ''].includes(relation)) { console.error('RELATION must be patient, carer or empty'); process.exit(1); }

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

const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=name&updateMask.fieldPaths=role&updateMask.fieldPaths=relation`;
const fields = { name: { stringValue: name }, role: { stringValue: role }, relation: { stringValue: relation } };
const res = await fetch(url, { method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
if (!res.ok) { console.error('Firestore refused the write: ' + res.status + ' ' + await res.text()); process.exit(1); }
const doc = await res.json();
console.log('Wrote users/' + uid);
console.log('  name:     ' + doc.fields.name.stringValue);
console.log('  role:     ' + doc.fields.role.stringValue);
console.log('  relation: ' + (doc.fields.relation.stringValue || '(none)'));
