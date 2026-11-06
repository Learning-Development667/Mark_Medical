/* Daily backups of the real database (v428, the DPIA's backup action; Mark: "start with backups"). Firestore's own scheduled
   backups: one copy a day, each kept 14 days, stored by Google in the database's own region (London). Restoring makes a NEW
   database from a backup (Google Cloud console, Firestore, Disaster recovery, or gcloud firestore databases restore), so a
   restore never overwrites the live one by accident.
   Usage: node tools/backups.mjs check | setup. setup makes the daily schedule if there is none; both print the schedule
   and the backups held (dates and states only). Needs FIREBASE_SERVICE_ACCOUNT. */
import { createSign } from 'node:crypto';

const what = process.argv[2] || 'check';
const RETAIN_DAYS = 14;
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.client_email || !sa.private_key || !sa.project_id) { console.error('FIREBASE_SERVICE_ACCOUNT is missing'); process.exit(1); }
const b64 = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 }));
const signer = createSign('RSA-SHA256'); signer.update(head + '.' + claims);
const jwt = head + '.' + claims + '.' + signer.sign(sa.private_key).toString('base64url');
const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt })).json();
if (!tok.access_token) { console.error('No token: ' + (tok.error || 'unknown')); process.exit(1); }
const H = { authorization: 'Bearer ' + tok.access_token, 'content-type': 'application/json' };
const api = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id;
const call = async (method, path, body) => {
  const r = await fetch(api + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
};

const db = await call('GET', '/databases/(default)');
console.log(`Database: ${db.locationId}, point-in-time recovery ${db.pointInTimeRecoveryEnablement || 'unknown'}`);
let { backupSchedules: schedules = [] } = await call('GET', '/databases/(default)/backupSchedules');
const daily = schedules.find((s) => s.dailyRecurrence);
if (!daily && what === 'setup') {
  const made = await call('POST', '/databases/(default)/backupSchedules', { retention: RETAIN_DAYS * 86400 + 's', dailyRecurrence: {} });
  console.log('Made the daily backup schedule');
  schedules = [made];
}
if (!schedules.length) console.log('No backup schedule. Run with setup to make the daily one.');
for (const s of schedules) console.log(`Schedule: ${s.dailyRecurrence ? 'daily' : s.weeklyRecurrence ? 'weekly on ' + s.weeklyRecurrence.day : 'other'}, each kept ${Math.round(parseInt(s.retention, 10) / 86400)} days, since ${String(s.createTime || '').slice(0, 10)}`);
const { backups = [] } = await call('GET', `/locations/${db.locationId}/backups`);
const mine = backups.filter((b) => String(b.database || '').endsWith('/databases/(default)')).sort((a, b) => String(b.snapshotTime).localeCompare(String(a.snapshotTime)));
console.log(`Backups held: ${mine.length}${mine.length ? ', newest ' + String(mine[0].snapshotTime).slice(0, 16).replace('T', ' ') + ' UTC (' + mine[0].state + ')' : ' (the first appears within a day of the schedule being made)'}`);
/* The Monday check fails loudly (a red run, so GitHub emails Mark) when there is no schedule, or the newest backup is over two days old */
if (what === 'check') {
  const age = mine.length ? (Date.now() - Date.parse(mine[0].snapshotTime)) / 864e5 : Infinity;
  if (!schedules.length || (age > 2 && schedules.every((s) => Date.now() - Date.parse(s.createTime) > 2 * 864e5))) { console.error('Backups are not running as they should'); process.exit(1); }
}
