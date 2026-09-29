/* Firestore over REST with a service account, for the Actions-tab tools (no SDK, no dependency).
   The same JWT dance the bridge does, in Node. Every function takes plain paths like
   "households/abc/entries" and returns or writes Firestore's own JSON field values. */
import { createSign, randomBytes, createHash } from 'node:crypto';

export function loadServiceAccount(envName) {
  const sa = JSON.parse(process.env[envName] || '{}');
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    console.error(`${envName} secret is missing or incomplete`);
    process.exit(1);
  }
  return sa;
}

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function connect(sa) {
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
  if (!tokenRes.ok) throw new Error('Could not get a token: ' + tokenRes.status + ' ' + await tokenRes.text());
  const { access_token: token } = await tokenRes.json();
  const root = `projects/${sa.project_id}/databases/(default)/documents`;
  const base = `https://firestore.googleapis.com/v1/${root}`;
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };

  return {
    root,
    /* One document's fields, or null */
    async get(path) {
      const res = await fetch(`${base}/${path}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Get ${path} failed: ${res.status} ${await res.text()}`);
      return (await res.json()).fields || {};
    },
    /* Every document in a collection as { id, path, fields }; namesOnly skips the fields (cheap for counting and deleting) */
    async list(path, { namesOnly = false, pageSize = 300 } = {}) {
      const out = [];
      let pageToken = '';
      do {
        const url = `${base}/${path}?pageSize=${pageSize}${namesOnly ? '&mask.fieldPaths=__name__' : ''}${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
        const res = await fetch(url, { headers });
        if (res.status === 404) return out;
        if (!res.ok) throw new Error(`List ${path} failed: ${res.status} ${await res.text()}`);
        const body = await res.json();
        (body.documents || []).forEach((d) => out.push({ id: d.name.split('/').pop(), path: d.name.split('/documents/')[1], name: d.name, fields: d.fields || {} }));
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    /* Replace a document (or create it) */
    async set(path, fields) {
      const res = await fetch(`${base}/${path}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
      if (!res.ok) throw new Error(`Set ${path} failed: ${res.status} ${await res.text()}`);
    },
    /* Change only the given fields */
    async merge(path, fields) {
      const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
      const res = await fetch(`${base}/${path}?${mask}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
      if (!res.ok) throw new Error(`Merge ${path} failed: ${res.status} ${await res.text()}`);
    },
    /* Copy whole documents in batches, keeping under Firestore's 10 MB request limit (document pages are big) */
    async putMany(docs) {
      let batch = [], bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const res = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: batch }) });
        if (!res.ok) throw new Error(`Commit failed: ${res.status} ${await res.text()}`);
        batch = []; bytes = 0;
      };
      for (const d of docs) {
        const write = { update: { name: `${root}/${d.path}`, fields: d.fields } };
        const size = JSON.stringify(write).length;
        if (batch.length >= 200 || bytes + size > 8000000) await flush();
        batch.push(write); bytes += size;
      }
      await flush();
    },
    async deleteMany(names) {
      for (let i = 0; i < names.length; i += 400) {
        const res = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: names.slice(i, i + 400).map((name) => ({ delete: name })) }) });
        if (!res.ok) throw new Error(`Delete failed: ${res.status} ${await res.text()}`);
      }
    }
  };
}

export const str = (s) => ({ stringValue: String(s) });
export const ts = (d) => ({ timestampValue: (d || new Date()).toISOString() });
export const fieldString = (fields, k) => (fields && fields[k] && fields[k].stringValue) || '';
export const newId = () => randomBytes(15).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
export const newKey = () => randomBytes(32).toString('base64url');
export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
