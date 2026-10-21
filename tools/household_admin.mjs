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
   ACTION=list        every household with its members, and the Beta code and "who told you" it came in on.
   ACTION=beta-code   CODE (letters and digits, say BINCEY or SCRI), LABEL (where it goes: "Bincey's patients"),
                      OFF=yes to switch an existing code off (a leaked one), otherwise made or switched on.
   ACTION=beta-codes  every Beta code with its label, state and uses.
   ACTION=unseed-check / unseed  (v248) until v248 every new circle was given the app's starter medicines list,
                      which was Mark's own from September 2026. These list (unseed-check) or delete (unseed) those
                      copies in every circle that came in on a Beta code (Mark's own circle has none), keeping any
                      the circle has renamed or changed the dose of, or logged a dose of.
                      ALL=yes (v253) checks every circle, Beta code or not, naming its members, and leaves alone
                      only HOUSEHOLD_ID (Mark's own, whose medicines are real); unseed with ALL=yes refuses to run
                      without HOUSEHOLD_ID. */
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
} else if (action === 'beta-code') {
  const code = env('CODE').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24), label = env('LABEL'), off = env('OFF') === 'yes';
  if (code.length < 4) { console.error('CODE must be at least four letters or digits'); process.exit(1); }
  const old = await fs.get('betaCodes/' + code);
  if (!old && off) { console.error('No Beta code ' + code); process.exit(1); }
  if (old) await fs.merge('betaCodes/' + code, { active: { booleanValue: !off }, ...(label ? { label: str(label) } : {}) });
  else await fs.set('betaCodes/' + code, { label: str(label || code), active: { booleanValue: true }, uses: { integerValue: '0' }, createdAt: ts() });
  console.log(`Beta code ${code}: ${off ? 'switched off' : old ? 'on' : 'made'}${label ? ', ' + label : ''}. People type it when they create an account; a link that fills it in is ${process.env.APP_URL || 'https://app.mymedicaldaybook.co.uk/'}?beta=${code}`);
} else if (action === 'beta-codes') {
  const codes = await fs.list('betaCodes');
  for (const c of codes) console.log(`${c.id}  ${fieldString(c.fields, 'label')}  ${c.fields.active && c.fields.active.booleanValue === false ? 'off' : 'on'}  used ${(c.fields.uses && c.fields.uses.integerValue) || 0} times`);
  if (!codes.length) console.log('No Beta codes yet. Make one with beta-code.');
} else if (action === 'unseed-check' || action === 'unseed') {
  const SEED = { dalteparin: 'Dalteparin injection', 'co-amoxiclav': 'Co-amoxiclav 500/125mg', creon: 'Creon 25000', oramorph: 'Oramorph 10mg/5ml', diazepam: 'Diazepam', metoclopramide: 'Metoclopramide', chlorphenamine: 'Chlorphenamine', 'menthol-cream': 'Menthol 2% cream', macrogol: 'Macrogol sachets', senna: 'Senna' };
  const apply = action === 'unseed';
  const all = env('ALL') === 'yes', keep = env('HOUSEHOLD_ID');
  if (all && apply && !keep) { console.error('unseed with ALL=yes needs HOUSEHOLD_ID: the circle to leave alone (Mark\'s own)'); process.exit(1); }
  let total = 0;
  for (const h of await fs.list('households')) {
    const code = fieldString(h.fields, 'betaCode') || (all ? 'no Beta code' : '');
    if (all) {
      const who = (await fs.list(`households/${h.id}/members`)).map((m) => `${fieldString(m.fields, 'name')} (${fieldString(m.fields, 'role')}${fieldString(m.fields, 'relation') ? ', ' + fieldString(m.fields, 'relation') : ''})`);
      console.log(`--- ${h.id}  ${fieldString(h.fields, 'name')}  members: ${who.join(', ') || 'none'}`);
      if (h.id === keep) { console.log(`${h.id}: left alone (HOUSEHOLD_ID)`); continue; }
    }
    if (!code) { console.log(`${h.id}  ${fieldString(h.fields, 'name')}: no Beta code, left alone`); continue; }
    const meds = await fs.list(`households/${h.id}/medicines`);
    if (all) console.log(`   medicines in this circle: ${meds.map((m) => fieldString(m.fields, 'name') + (SEED[m.id] ? ' [starter id ' + m.id + ']' : '')).join('; ') || 'none'}`);
    const copies = meds.filter((m) => SEED[m.id] && fieldString(m.fields, 'name') === SEED[m.id]);
    if (!copies.length) { console.log(`${h.id}  ${fieldString(h.fields, 'name')} (${code}): none`); continue; }
    const dosed = new Set((await fs.list(`households/${h.id}/entries`)).filter((e) => fieldString(e.fields, 'type') === 'med').map((e) => fieldString(e.fields, 'medId')));
    const go = copies.filter((m) => !dosed.has(m.id));
    const kept = copies.filter((m) => dosed.has(m.id)).map((m) => m.id);
    console.log(`${h.id}  ${fieldString(h.fields, 'name')} (${code}): ${go.length} starter medicines to ${apply ? 'delete' : 'remove'}${kept.length ? '; kept, doses logged: ' + kept.join(', ') : ''}`);
    if (apply && go.length) await fs.deleteMany(go.map((m) => `${fs.root}/households/${h.id}/medicines/${m.id}`));
    total += go.length;
  }
  console.log(apply ? `Deleted ${total}.` : `${total} would be deleted. Run unseed to delete them.`);
} else if (action === 'food-check') {
  /* Read only, with the person's agreement (Helen, 21 October 2026: a lunch missing from her timeline).
     Prints when things were saved and by whom, never what was eaten: entry types, days, times, the
     author, and for saved meals only their dates and counts. NAME finds the circle by a member's
     first name, or HOUSEHOLD_ID names it. */
  const want = env('NAME').toLowerCase(), days = 3;
  const london = (v) => v ? new Date(v).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
  const tsv = (f, k) => (f && f[k] && f[k].timestampValue) || '';
  let hids = env('HOUSEHOLD_ID') ? [env('HOUSEHOLD_ID')] : [];
  if (!hids.length) {
    if (!want) { console.error('Give NAME (a member\'s first name) or HOUSEHOLD_ID'); process.exit(1); }
    for (const h of await fs.list('households')) {
      const ms = await fs.list(`households/${h.id}/members`);
      if (ms.some((m) => fieldString(m.fields, 'name').toLowerCase().startsWith(want))) hids.push(h.id);
    }
  }
  if (!hids.length) { console.log('No circle with a member called ' + want); process.exit(0); }
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  for (const hid of hids) {
    const ms = await fs.list(`households/${hid}/members`);
    console.log(`=== circle ${hid}, members: ${ms.map((m) => fieldString(m.fields, 'name') + ' (' + fieldString(m.fields, 'role') + ')').join(', ')}`);
    const all = await fs.list(`households/${hid}/entries`);
    const es = all.filter((e) => fieldString(e.fields, 'day') >= since || tsv(e.fields, 'createdAt').slice(0, 10) >= since);
    console.log(`${all.length} entries in the circle in all; food entries on any day: ${all.filter((e) => fieldString(e.fields, 'type') === 'food').map((e) => fieldString(e.fields, 'day')).sort().join(', ') || 'none'}`);
    es.sort((a, b) => tsv(a.fields, 'createdAt').localeCompare(tsv(b.fields, 'createdAt')));
    console.log(`Entries dated or saved from ${since}, in the order they reached the database (type | day | time logged | saved at | by):`);
    for (const e of es) {
      const f = e.fields;
      console.log(`  ${fieldString(f, 'type').padEnd(9)} | ${fieldString(f, 'day')} | ${london(tsv(f, 'at'))} | ${london(tsv(f, 'createdAt'))} | ${fieldString(f, 'addedBy')}${tsv(f, 'updatedAt') ? ' | updated ' + london(tsv(f, 'updatedAt')) : ''}`);
    }
    console.log('Saved meals (no names: created | last logged | updated | uses):');
    for (const m of await fs.list(`households/${hid}/meals`)) {
      const f = m.fields;
      console.log(`  ${london(tsv(f, 'createdAt'))} | ${london(tsv(f, 'lastAt'))} | ${london(tsv(f, 'updatedAt'))} | ${(f.uses && (f.uses.integerValue || f.uses.doubleValue)) || 0} | by ${fieldString(f, 'addedBy')}`);
    }
  }
} else if (action === 'list') {
  const hs = await fs.list('households');
  for (const h of hs) {
    const via = [fieldString(h.fields, 'betaCode'), fieldString(h.fields, 'heardFrom')].filter(Boolean);
    console.log(`${h.id}  ${fieldString(h.fields, 'name')}${via.length ? '  (Beta: ' + via.join(', ') + ')' : ''}`);
    for (const m of await fs.list(`households/${h.id}/members`)) console.log(`   ${m.id}  ${fieldString(m.fields, 'name')}, ${fieldString(m.fields, 'role')}${fieldString(m.fields, 'relation') ? ', ' + fieldString(m.fields, 'relation') : ''}`);
  }
  if (!hs.length) console.log('No households yet.');
} else {
  console.error('ACTION must be create, add-member, remove-member, new-key, beta-code, beta-codes, unseed-check, unseed, food-check or list');
  process.exit(1);
}
