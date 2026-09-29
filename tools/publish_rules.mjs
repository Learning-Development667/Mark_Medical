/* Publishes a rules file to Firestore through the Firebase Rules REST API, with a service account:
   create a ruleset from the file, then point the "cloud.firestore" release at it. This needs only
   the rules permissions the Admin SDK service account already has; firebase-tools' own deploy also
   asks Service Usage whether Firestore is enabled, which that account is not allowed to do.

   Environment: SERVICE_ACCOUNT (the project's service account JSON), RULES_FILE (path). */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const sa = JSON.parse(process.env.SERVICE_ACCOUNT || '{}');
if (!sa.client_email || !sa.private_key || !sa.project_id) { console.error('SERVICE_ACCOUNT secret is missing or incomplete'); process.exit(1); }
const file = process.env.RULES_FILE || 'firestore.rules';
const source = readFileSync(file, 'utf8');

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
const signer = createSign('RSA-SHA256');
signer.update(header + '.' + claims);
const jwt = header + '.' + claims + '.' + signer.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
if (!tokenRes.ok) { console.error('Could not get a token: ' + tokenRes.status + ' ' + await tokenRes.text()); process.exit(1); }
const { access_token: token } = await tokenRes.json();
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
const base = `https://firebaserules.googleapis.com/v1/projects/${sa.project_id}`;

/* 1. A ruleset from the file (the service compiles it and refuses a file with errors) */
const rs = await fetch(`${base}/rulesets`, { method: 'POST', headers, body: JSON.stringify({ source: { files: [{ name: file.split('/').pop(), content: source }] } }) });
if (!rs.ok) { console.error('Could not create the ruleset: ' + rs.status + ' ' + await rs.text()); process.exit(1); }
const ruleset = await rs.json();
console.log('Ruleset ' + ruleset.name.split('/').pop() + ' compiled from ' + file);

/* 2. Point the Firestore release at it (create it if the project has never had one) */
const releaseName = `projects/${sa.project_id}/releases/cloud.firestore`;
let rel = await fetch(`https://firebaserules.googleapis.com/v1/${releaseName}`, { method: 'PATCH', headers, body: JSON.stringify({ release: { name: releaseName, rulesetName: ruleset.name } }) });
if (rel.status === 404) rel = await fetch(`${base}/releases`, { method: 'POST', headers, body: JSON.stringify({ name: releaseName, rulesetName: ruleset.name }) });
if (!rel.ok) { console.error('Could not publish the release: ' + rel.status + ' ' + await rel.text()); process.exit(1); }
console.log(`Published ${file} to ${sa.project_id}. Live now.`);
