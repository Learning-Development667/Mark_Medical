/* Moves the pre-v75 shared data into one household (households/{id}/...), in three separate
   runs from the Actions tab (.github/workflows/households.yml), never touching what it copies:

   ACTION=copy     creates the household (or reuses HOUSEHOLD_ID), copies every collection and
                   subcollection into it, makes a members record from every users/{uid} record,
                   points each users/{uid}.household at it, links the bridge's current inbox key
                   (BRIDGE_KEY, hashed) and stores that key under private/health so the app can
                   show it. Safe to run again: it copies by the same ids, so a second run only
                   catches anything added since.
   ACTION=verify   counts the old and the new side by side and fails if they differ.
   ACTION=cleanup  deletes the OLD top-level data after a fresh verify. Needs
                   CONFIRM="delete the old data" as well. Never touches households/ or users/.

   Environment: FIREBASE_SERVICE_ACCOUNT, ACTION, HOUSEHOLD_ID?, HOUSEHOLD_NAME?, BRIDGE_KEY?, CONFIRM? */
import { loadServiceAccount, connect, str, ts, fieldString, newId, sha256Hex } from './lib/firestore_rest.mjs';

const COLLECTIONS = ['entries', 'medicines', 'documents', 'recordings', 'profile', 'days', 'exercise', 'meals', 'nutrition', 'pushSubs', 'reminders'];
const SUBS = { documents: 'pages', recordings: 'parts' };
const BIG = new Set(['pages', 'parts']); // up to 900 KB each: list them in small pages

const action = (process.env.ACTION || '').trim();
if (!['copy', 'verify', 'cleanup'].includes(action)) { console.error('ACTION must be copy, verify or cleanup'); process.exit(1); }
const sa = loadServiceAccount('FIREBASE_SERVICE_ACCOUNT');
const fs = await connect(sa);

/* Which household: the one given, else the only one that exists, else (copy only) a new one */
async function resolveHousehold() {
  let hid = (process.env.HOUSEHOLD_ID || '').trim();
  const existing = await fs.list('households', { namesOnly: true });
  if (!hid && existing.length === 1) hid = existing[0].id;
  if (!hid && existing.length > 1) { console.error('More than one household exists; set HOUSEHOLD_ID: ' + existing.map((h) => h.id).join(', ')); process.exit(1); }
  if (!hid) {
    if (action !== 'copy') { console.error('No household yet. Run copy first.'); process.exit(1); }
    hid = newId();
    const users = await fs.list('users');
    const owner = users.find((u) => fieldString(u.fields, 'relation') === 'patient') || users.find((u) => fieldString(u.fields, 'role') === 'family') || users[0];
    await fs.set('households/' + hid, { name: str((process.env.HOUSEHOLD_NAME || '').trim() || 'Our household'), owner: str(owner ? owner.id : ''), createdAt: ts() });
    console.log('Created household ' + hid);
  }
  return hid;
}

async function copyCollection(hid, col) {
  const docs = await fs.list(col, { pageSize: BIG.has(col.split('/').pop()) ? 10 : 300 });
  if (docs.length) await fs.putMany(docs.map((d) => ({ path: `households/${hid}/${d.path}`, fields: d.fields })));
  return docs;
}

async function counts(hid) {
  const rows = [];
  for (const col of COLLECTIONS) {
    const oldDocs = await fs.list(col, { namesOnly: true });
    const newDocs = await fs.list(`households/${hid}/${col}`, { namesOnly: true });
    rows.push({ col, old: oldDocs.length, moved: newDocs.length });
    if (SUBS[col]) {
      let o = 0, n = 0;
      for (const d of oldDocs) o += (await fs.list(`${col}/${d.id}/${SUBS[col]}`, { namesOnly: true })).length;
      for (const d of newDocs) n += (await fs.list(`households/${hid}/${col}/${d.id}/${SUBS[col]}`, { namesOnly: true })).length;
      rows.push({ col: `${col}/*/${SUBS[col]}`, old: o, moved: n });
    }
  }
  return rows;
}

function report(rows) {
  let ok = true;
  for (const r of rows) {
    const flag = r.moved >= r.old ? 'ok' : 'MISSING';
    if (r.moved < r.old) ok = false;
    console.log(`${r.col.padEnd(22)} old ${String(r.old).padStart(5)}   in household ${String(r.moved).padStart(5)}   ${flag}`);
  }
  return ok;
}

const hid = await resolveHousehold();
console.log('Household: ' + hid);

if (action === 'copy') {
  /* members and pointers from the old users/{uid} records */
  const users = await fs.list('users');
  for (const u of users) {
    const role = fieldString(u.fields, 'role');
    if (!['family', 'readonly', 'viewer'].includes(role)) continue;
    await fs.set(`households/${hid}/members/${u.id}`, { name: str(fieldString(u.fields, 'name') || 'Unknown'), role: str(role), relation: str(fieldString(u.fields, 'relation')), addedBy: str('migration'), addedAt: ts() });
    await fs.merge(`users/${u.id}`, { household: str(hid) });
    console.log(`member ${u.id}: ${fieldString(u.fields, 'name')} (${role})`);
  }
  /* the data, collection by collection, subcollections after their parents */
  for (const col of COLLECTIONS) {
    const docs = await copyCollection(hid, col);
    let subCount = 0;
    if (SUBS[col]) for (const d of docs) subCount += (await copyCollection(hid, `${col}/${d.id}/${SUBS[col]}`)).length;
    console.log(`${col}: ${docs.length} copied${SUBS[col] ? `, ${subCount} ${SUBS[col]}` : ''}`);
  }
  /* the bridge's inbox key, so Health Auto Export keeps working unchanged */
  const key = (process.env.BRIDGE_KEY || '').trim();
  if (key) {
    await fs.set('healthKeys/' + sha256Hex(key), { household: str(hid), label: str('Original bridge key'), createdAt: ts() });
    await fs.set(`households/${hid}/private/health`, { key: str(key), createdAt: ts() });
    console.log('Inbox key linked (hash ' + sha256Hex(key).slice(0, 8) + '...)');
  } else console.log('No BRIDGE_KEY given: the inbox key was not linked');
  console.log('');
  const ok = report(await counts(hid));
  console.log(ok ? '\nCopy complete. Next: publish the rules, push the app, then run verify and cleanup.' : '\nSome documents did not copy: run copy again.');
  process.exit(ok ? 0 : 1);
}

if (action === 'verify') {
  const ok = report(await counts(hid));
  const members = await fs.list(`households/${hid}/members`);
  console.log(`members: ${members.length}`);
  const keys = await fs.list('healthKeys', { namesOnly: true });
  console.log(`inbox keys linked: ${keys.length}`);
  console.log(ok ? '\nEverything in the old layout is present in the household.' : '\nMISSING documents: run copy again before cleanup.');
  process.exit(ok ? 0 : 1);
}

if (action === 'cleanup') {
  if ((process.env.CONFIRM || '').trim() !== 'delete the old data') { console.error('Refusing: CONFIRM must be exactly "delete the old data"'); process.exit(1); }
  const ok = report(await counts(hid));
  if (!ok) { console.error('\nNot everything has been copied. Run copy again first.'); process.exit(1); }
  let total = 0;
  for (const col of COLLECTIONS) {
    const docs = await fs.list(col, { namesOnly: true });
    if (SUBS[col]) for (const d of docs) { const kids = await fs.list(`${col}/${d.id}/${SUBS[col]}`, { namesOnly: true }); await fs.deleteMany(kids.map((k) => k.name)); total += kids.length; }
    await fs.deleteMany(docs.map((d) => d.name));
    total += docs.length;
    console.log(`${col}: ${docs.length} old documents deleted`);
  }
  for (const col of ['bridge', 'cheers']) { const docs = await fs.list(col, { namesOnly: true }); await fs.deleteMany(docs.map((d) => d.name)); total += docs.length; }
  console.log(`\nOld layout removed: ${total} documents. Now remove the TRANSITION block from firestore.rules and publish.`);
}
