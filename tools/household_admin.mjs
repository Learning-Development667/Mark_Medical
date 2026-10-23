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
   ACTION=beta-code   CODE (letters and digits, say WARD1), LABEL (where it goes: "Ward 1 patients"),
                      OFF=yes to switch an existing code off (a leaked one), otherwise made or switched on.
   ACTION=beta-codes  every Beta code with its label, state and uses.
   ACTION=dose-use-check / dose-use  (v267) DOSE_USE "Diazepam | 21:00-01:00 | Sleep | Pain": what each logged dose was for, by its time.
   ACTION=unseed-check / unseed  (v248) until v248 every new circle was given the app's starter medicines list,
                      which was Mark's own from September 2026. These list (unseed-check) or delete (unseed) those
                      copies in every circle that came in on a Beta code (Mark's own circle has none), keeping any
                      the circle has renamed or changed the dose of, or logged a dose of.
                      ALL=yes (v253) checks every circle, Beta code or not, naming its members, and leaves alone
                      only HOUSEHOLD_ID (Mark's own, whose medicines are real); unseed with ALL=yes refuses to run
                      without HOUSEHOLD_ID.

   PUBLIC LOGS (v291, the security review of 23 October 2026): this repository is public, so anyone can read
   every Actions run's log. Nothing printed here may name a person, a medicine, a Beta code, a label or a time
   anything was taken or eaten: ids, counts and states only. A circle is found by HOUSEHOLD_ID (from list), never
   by a person's name. */
import { loadServiceAccount, connect, str, ts, fieldString, newId, newKey, sha256Hex } from './lib/firestore_rest.mjs';

const action = (process.env.ACTION || '').trim();
const env = (k) => (process.env[k] || '').trim();
const uidOk = (u) => /^[A-Za-z0-9]{20,40}$/.test(u);
const relation = (r) => (['patient', 'carer'].includes(r) ? r : '');
const hidden = (s) => (s ? String(s).slice(0, 2) + '***' : '');
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
  console.log(`households/${hid}: member ${hidden(uid)} saved, ${role}${rel ? ', ' + rel : ''}`);
}

if (action === 'create') {
  const name = env('HOUSEHOLD_NAME'), uid = env('OWNER_UID');
  if (!name) { console.error('HOUSEHOLD_NAME is required'); process.exit(1); }
  const hid = newId();
  await fs.set('households/' + hid, { name: str(name), owner: str(uid), createdAt: ts() });
  console.log(`Created household ${hid}`);
  await addMember(hid, uid, env('OWNER_NAME'), 'family', relation(env('OWNER_RELATION')), false);
} else if (action === 'add-member') {
  const hid = env('HOUSEHOLD_ID');
  await household(hid);
  await addMember(hid, env('USER_UID'), env('NAME'), env('ROLE'), relation(env('RELATION')), env('MOVE') === 'yes');
} else if (action === 'remove-member') {
  const hid = env('HOUSEHOLD_ID'), uid = env('USER_UID');
  await household(hid);
  await fs.deleteMany([`${fs.root}/households/${hid}/members/${uid}`, `${fs.root}/users/${uid}`]);
  console.log(`Removed member ${hidden(uid)} from household ${hid}`);
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
  console.log(`Beta code ${hidden(code)}: ${off ? 'switched off' : old ? 'on' : 'made'}. People type it when they create an account, or use the link https://app.mymedicaldaybook.co.uk/?beta= followed by the code.`);
} else if (action === 'beta-codes') {
  const codes = await fs.list('betaCodes');
  for (const c of codes) console.log(`${hidden(c.id)}  ${c.fields.active && c.fields.active.booleanValue === false ? 'off' : 'on'}  used ${(c.fields.uses && c.fields.uses.integerValue) || 0} times`);
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
      const who = (await fs.list(`households/${h.id}/members`)).length;
      console.log(`--- ${h.id}  ${who} member${who === 1 ? '' : 's'}`);
      if (h.id === keep) { console.log(`${h.id}: left alone (HOUSEHOLD_ID)`); continue; }
    }
    if (!code) { console.log(`${h.id}: no Beta code, left alone`); continue; }
    const meds = await fs.list(`households/${h.id}/medicines`);
    const copies = meds.filter((m) => SEED[m.id] && fieldString(m.fields, 'name') === SEED[m.id]);
    if (!copies.length) { console.log(`${h.id}: none`); continue; }
    const dosed = new Set((await fs.list(`households/${h.id}/entries`)).filter((e) => fieldString(e.fields, 'type') === 'med').map((e) => fieldString(e.fields, 'medId')));
    const go = copies.filter((m) => !dosed.has(m.id));
    const kept = copies.filter((m) => dosed.has(m.id)).map((m) => m.id);
    console.log(`${h.id}: ${go.length} starter medicines to ${apply ? 'delete' : 'remove'}${kept.length ? '; ' + kept.length + ' kept, doses logged' : ''}`);
    if (apply && go.length) await fs.deleteMany(go.map((m) => `${fs.root}/households/${h.id}/medicines/${m.id}`));
    total += go.length;
  }
  console.log(apply ? `Deleted ${total}.` : `${total} would be deleted. Run unseed to delete them.`);
} else if (action === 'food-check') {
  /* Read only, with the person's agreement (a Beta tester, 21 October 2026: a lunch missing from the timeline). Since v291 it
     prints counts only (the log is public): entries a day by type over the last three days, and how many saved meals,
     never what was eaten, when, or by whom. HOUSEHOLD_ID names the circle. */
  const hid = env('HOUSEHOLD_ID');
  if (!hid) { console.error('Give HOUSEHOLD_ID (from list)'); process.exit(1); }
  await household(hid);
  const tsv = (f, k) => (f && f[k] && f[k].timestampValue) || '';
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const all = await fs.list(`households/${hid}/entries`);
  const es = all.filter((e) => fieldString(e.fields, 'day') >= since || tsv(e.fields, 'createdAt').slice(0, 10) >= since);
  const byDay = {};
  for (const e of es) { const d = fieldString(e.fields, 'day'), t = fieldString(e.fields, 'type'); byDay[d] = byDay[d] || {}; byDay[d][t] = (byDay[d][t] || 0) + 1; }
  console.log(`Circle ${hid}: ${all.length} entries in all; ${all.filter((e) => fieldString(e.fields, 'type') === 'food').length} food entries on any day.`);
  for (const d of Object.keys(byDay).sort()) console.log(`  ${d}: ${Object.entries(byDay[d]).map(([t, n]) => t + ' ' + n).join(', ')}`);
  console.log(`Saved meals: ${(await fs.list(`households/${hid}/meals`)).length}.`);
} else if (action === 'dose-use-check' || action === 'dose-use') {
  /* (v267) Mark, 22 October 2026: "Every diazepam I have taken between 2100hrs and 0100hrs has been for sleep. The rest
     has been pain." Marks each logged dose of one medicine with what it was for (forUse, v263) by the London time it
     was taken. DOSE_USE is "Medicine | 21:00-01:00 | use inside | use outside". dose-use-check lists and changes
     nothing; dose-use saves it, and gives the medicine the second use only when it has none (never over what the person set). NAME (a member's first name) must find one circle, or give HOUSEHOLD_ID. */
  const apply = action === 'dose-use';
  const parts = env('DOSE_USE').split('|').map((x) => x.trim());
  const m = (parts[1] || '').match(/^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/);
  if (parts.length < 4 || !parts[0] || !m || !parts[2] || !parts[3]) { console.error('DOSE_USE must read like: Diazepam | 21:00-01:00 | Sleep | Pain'); process.exit(1); }
  const [medWord, , useIn, useOut] = parts;
  const startMin = Number(m[1]) * 60 + Number(m[2] || 0), endMin = Number(m[3]) * 60 + Number(m[4] || 0);
  const inWindow = (mins) => (startMin <= endMin ? mins >= startMin && mins < endMin : mins >= startMin || mins < endMin);
  const hid = env('HOUSEHOLD_ID');
  if (!hid) { console.error('Give HOUSEHOLD_ID (from list)'); process.exit(1); }
  await household(hid);
  const meds = (await fs.list(`households/${hid}/medicines`)).filter((x) => fieldString(x.fields, 'name').toLowerCase().includes(medWord.toLowerCase()));
  const medIds = new Set(meds.map((x) => x.id));
  console.log(`Circle ${hid}: ${meds.length} matching medicine${meds.length === 1 ? '' : 's'}.`);
  const tsv = (f, k) => (f && f[k] && f[k].timestampValue) || '';
  const doses = (await fs.list(`households/${hid}/entries`)).filter((e) => fieldString(e.fields, 'type') === 'med'
    && (medIds.has(fieldString(e.fields, 'medId')) || fieldString(e.fields, 'medName').toLowerCase().includes(medWord.toLowerCase())));
  const counts = { [useIn]: 0, [useOut]: 0 }, writes = [];
  doses.sort((a, b) => tsv(a.fields, 'at').localeCompare(tsv(b.fields, 'at')));
  for (const e of doses) {
    const at = tsv(e.fields, 'at');
    if (!at) continue;
    const [hh, mm] = new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    const use = inWindow(hh * 60 + mm) ? useIn : useOut;
    counts[use] += 1;
    const was = fieldString(e.fields, 'forUse');
    if (was !== use) writes.push([e.id, use]);
  }
  console.log(`${doses.length} doses: ${counts[useIn]} inside the window, ${counts[useOut]} outside. ${writes.length} to ${apply ? 'save' : 'change'}.`);
  if (apply) {
    for (const [id, use] of writes) await fs.merge(`households/${hid}/entries/${id}`, { forUse: str(use), updatedAt: ts() });
    /* the medicine's two uses are only filled in when it has none yet: never write over what the person set */
    const unset = meds.filter((x) => !fieldString(x.fields, 'alsoFor'));
    for (const x of unset) await fs.merge(`households/${hid}/medicines/${x.id}`, { purpose: str(fieldString(x.fields, 'purpose') || useIn), alsoFor: str(useOut) });
    console.log(`Saved ${writes.length} doses.` + (unset.length ? ` Gave ${unset.length} medicine${unset.length === 1 ? '' : 's'} a second use.` : ' The medicine\'s own uses were left as they are.'));
  } else console.log('Nothing changed. Run dose-use to save it.');
} else if (action === 'list') {
  const hs = await fs.list('households');
  for (const h of hs) {
    const via = [fieldString(h.fields, 'betaCode'), fieldString(h.fields, 'heardFrom')].filter(Boolean);
    const ms = await fs.list(`households/${h.id}/members`);
    console.log(`${h.id}  ${ms.length} member${ms.length === 1 ? '' : 's'}${via.length ? '  (Beta code ' + hidden(via[0]) + ')' : ''}`);
    for (const m of ms) console.log(`   ${hidden(m.id)}  ${fieldString(m.fields, 'role')}${fieldString(m.fields, 'relation') ? ', ' + fieldString(m.fields, 'relation') : ''}`);
  }
  if (!hs.length) console.log('No households yet.');
} else {
  console.error('ACTION must be create, add-member, remove-member, new-key, beta-code, beta-codes, unseed-check, unseed, food-check, dose-use-check, dose-use or list');
  process.exit(1);
}
