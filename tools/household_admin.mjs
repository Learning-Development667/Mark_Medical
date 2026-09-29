/* Household admin from the Actions tab (.github/workflows/household-admin.yml), with the bridge's
   service account, so no secret leaves GitHub and nobody fights the Firebase console:

   ACTION=create      a new household: HOUSEHOLD_NAME, OWNER_UID (from Authentication > Users),
                      OWNER_NAME, OWNER_RELATION (patient, carer or none). Prints the new id.
   ACTION=add-member  HOUSEHOLD_ID, USER_UID, NAME, ROLE (family, readonly, viewer), RELATION.
                      Re-running updates the record in place. A sign-in already in another
                      household is refused unless MOVE=yes.
   ACTION=remove-member  HOUSEHOLD_ID, USER_UID: the person keeps their sign-in but sees nothing.
   ACTION=new-key     HOUSEHOLD_ID: makes a fresh Apple Health inbox key for the household, links
                      its hash and stores the key under private/health, where the app shows it
                      (More > Settings > Apple Health). The key itself is never printed here.
   ACTION=list        every household with its members. */
import { loadServiceAccount, connect, str, ts, fieldString, newId, newKey, sha256Hex } from './lib/firestore_rest.mjs';

const action = (process.env.ACTION || '').trim();
const env = (k) => (process.env[k] || '').trim();
const uidOk = (u) => /^[A-Za-z0-9]{20,40}$/.test(u);
const relation = (r) => (['patient', 'carer'].includes(r) ? r : '');
const sa = loadServiceAccount('FIREBASE_SERVICE_ACCOUNT');
const fs = await connect(sa);

async function household(hid) {
  const h = await fs.get('households/' + hid);
  if (!h) { console.error('No household ' + hid); process.exit(1); }
  return h;
}
async function addMember(hid, uid, name, role, rel, move) {
  if (!uidOk(uid)) { console.error('UID must be the 28-character id from Authentication > Users'); process.exit(1); }
  if (!name) { console.error('NAME is required'); process.exit(1); }
  if (!['family', 'readonly', 'viewer'].includes(role)) { console.error('ROLE must be family, readonly or viewer'); process.exit(1); }
  const pointer = await fs.get('users/' + uid);
  const current = pointer && fieldString(pointer, 'household');
  if (current && current !== hid && !move) { console.error(`This sign-in already belongs to household ${current}. Set MOVE=yes to move it.`); process.exit(1); }
  if (current && current !== hid) { await fs.deleteMany([`${fs.root}/households/${current}/members/${uid}`]); console.log(`Removed from household ${current}`); }
  await fs.set(`households/${hid}/members/${uid}`, { name: str(name), role: str(role), relation: str(rel), addedBy: str('workflow'), addedAt: ts() });
  await fs.merge('users/' + uid, { household: str(hid) });
  console.log(`households/${hid}/members/${uid}: ${name}, ${role}${rel ? ', ' + rel : ''}`);
}

if (action === 'create') {
  const name = env('HOUSEHOLD_NAME'), uid = env('OWNER_UID');
  if (!name) { console.error('HOUSEHOLD_NAME is required'); process.exit(1); }
  const hid = newId();
  await fs.set('households/' + hid, { name: str(name), owner: str(uid), createdAt: ts() });
  console.log(`Created household ${hid} (${name})`);
  await addMember(hid, uid, env('OWNER_NAME'), 'family', relation(env('OWNER_RELATION')), false);
} else if (action === 'add-member') {
  const hid = env('HOUSEHOLD_ID');
  await household(hid);
  await addMember(hid, env('USER_UID'), env('NAME'), env('ROLE'), relation(env('RELATION')), env('MOVE') === 'yes');
} else if (action === 'remove-member') {
  const hid = env('HOUSEHOLD_ID'), uid = env('USER_UID');
  await household(hid);
  await fs.deleteMany([`${fs.root}/households/${hid}/members/${uid}`, `${fs.root}/users/${uid}`]);
  console.log(`Removed ${uid} from household ${hid}`);
} else if (action === 'new-key') {
  const hid = env('HOUSEHOLD_ID');
  await household(hid);
  const key = newKey();
  const old = await fs.get(`households/${hid}/private/health`);
  if (old && fieldString(old, 'key')) await fs.deleteMany([`${fs.root}/healthKeys/${sha256Hex(fieldString(old, 'key'))}`]);
  await fs.set('healthKeys/' + sha256Hex(key), { household: str(hid), label: str('Made by the workflow'), createdAt: ts() });
  await fs.set(`households/${hid}/private/health`, { key: str(key), createdAt: ts() });
  console.log(`New inbox key for household ${hid} (hash ${sha256Hex(key).slice(0, 8)}...). Read it in the app under More > Settings > Apple Health.`);
} else if (action === 'list') {
  const hs = await fs.list('households');
  for (const h of hs) {
    console.log(`${h.id}  ${fieldString(h.fields, 'name')}`);
    for (const m of await fs.list(`households/${h.id}/members`)) console.log(`   ${m.id}  ${fieldString(m.fields, 'name')}, ${fieldString(m.fields, 'role')}${fieldString(m.fields, 'relation') ? ', ' + fieldString(m.fields, 'relation') : ''}`);
  }
  if (!hs.length) console.log('No households yet.');
} else {
  console.error('ACTION must be create, add-member, remove-member, new-key or list');
  process.exit(1);
}
