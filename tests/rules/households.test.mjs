/* Break-in tests for firestore.rules: every household's data stays with its own members.
   Runs under `npm test` in this folder (the Firestore emulator, started by firebase-tools). */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

const A = 'houseA', B = 'houseB';
const MARK = 'uid-mark', SHELLEY = 'uid-shelley', HAYLEY = 'uid-hayley', VIV = 'uid-viv', JANE = 'uid-jane', SAM = 'uid-sam';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'daybook-rules-test',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
after(async () => { await env.cleanup(); });

/* Two households and a stranger, seeded with the rules switched off (what the bridge and the workflows do) */
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (path, data) => setDoc(doc(db, path), data);
    await put(`households/${A}`, { name: 'Mark and Shelley', owner: MARK });
    await put(`households/${A}/members/${MARK}`, { name: 'Mark', role: 'family', relation: 'patient' });
    await put(`households/${A}/members/${SHELLEY}`, { name: 'Shelley', role: 'family', relation: 'carer' });
    await put(`households/${A}/members/${HAYLEY}`, { name: 'Hayley', role: 'readonly', relation: '' });
    await put(`households/${A}/members/${VIV}`, { name: 'Viv', role: 'viewer', relation: '' });
    await put(`households/${B}`, { name: 'Jane', owner: JANE });
    await put(`households/${B}/members/${JANE}`, { name: 'Jane', role: 'family', relation: 'patient' });
    for (const [uid, hid] of [[MARK, A], [SHELLEY, A], [HAYLEY, A], [VIV, A], [JANE, B]]) await put(`users/${uid}`, { household: hid });
    await put(`users/${SAM}`, { household: 'nowhere' });
    await put(`households/${A}/entries/e-med`, { type: 'med', day: '2026-09-29', medName: 'Creon', addedBy: 'Mark' });
    await put(`households/${A}/entries/e-food`, { type: 'food', day: '2026-09-29', note: 'Toast', addedBy: 'Mark' });
    await put(`households/${A}/entries/e-note`, { type: 'note', day: '2026-09-29', note: 'Tired', addedBy: 'Mark' });
    await put(`households/${A}/medicines/m1`, { name: 'Creon', dose: '2 capsules', kind: 'scheduled', active: true });
    await put(`households/${A}/documents/d1`, { title: 'Clinic letter', docDate: '2026-09-20', kind: 'text', text: 'Hello' });
    await put(`households/${A}/documents/d1/pages/1`, { data: 'abc', width: 1, height: 1 });
    await put(`households/${A}/profile/main`, { calls: [] });
    await put(`households/${A}/days/2026-09-29`, { chemo: true, mood: 4 });
    await put(`households/${A}/exercise/2026-09-29`, { day: '2026-09-29', steps: 1200 });
    await put(`households/${A}/meals/meal1`, { name: 'Porridge' });
    await put(`households/${A}/nutrition/2026-09-29`, { kcal: 1800 });
    await put(`households/${A}/recordings/r1`, { questionId: 'q1', seconds: 12 });
    await put(`households/${A}/recordings/r1/parts/0`, { n: 0, data: 'abc' });
    await put(`households/${A}/pushSubs/p1`, { endpoint: 'https://push.example/1', private: true });
    await put(`households/${A}/bridge/explainLog`, { day: '2026-09-29', calls: 3 });
    await put(`households/${A}/private/health`, { key: 'secret-key-A' });
    await put(`households/${A}/invites/code1`, { role: 'family', used: false });
    await put(`households/${B}/entries/e-jane`, { type: 'med', day: '2026-09-29', medName: 'Dalteparin', addedBy: 'Jane' });
    await put(`households/${B}/medicines/mj`, { name: 'Dalteparin', kind: 'scheduled', active: true });
    await put(`healthKeys/abc123`, { household: A });
    await put(`inviteCodes/code1`, { household: A });
    await put(`bridge/global`, { day: '2026-09-29', households: 1 });
    /* the pre-v75 shared layout, still guarded during the transition */
    await put(`entries/old1`, { type: 'note', day: '2026-09-01', note: 'Old' });
  });
});

const as = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const read = (uid, path) => getDoc(doc(as(uid), path));
const write = (uid, path, data) => setDoc(doc(as(uid), path), data);
const list = (uid, path) => getDocs(collection(as(uid), path));

/* ---- a family member in their own household ---- */
test('family reads and writes everything in their own household', async () => {
  await assertSucceeds(read(MARK, `households/${A}/entries/e-food`));
  await assertSucceeds(read(MARK, `households/${A}/documents/d1/pages/1`));
  await assertSucceeds(read(MARK, `households/${A}/profile/main`));
  await assertSucceeds(list(MARK, `households/${A}/entries`));
  await assertSucceeds(write(MARK, `households/${A}/entries/new1`, { type: 'note', day: '2026-09-29', note: 'Fine' }));
  await assertSucceeds(write(SHELLEY, `households/${A}/medicines/m2`, { name: 'Paracetamol', kind: 'prn', active: true }));
  await assertSucceeds(updateDoc(doc(as(MARK), `households/${A}/profile/main`), { proteinTarget: 100 }));
  await assertSucceeds(deleteDoc(doc(as(MARK), `households/${A}/meals/meal1`)));
  await assertSucceeds(write(MARK, `households/${A}/pushSubs/p2`, { endpoint: 'https://push.example/2' }));
  await assertSucceeds(write(MARK, `households/${A}/documents/d1/pages/2`, { data: 'x'.repeat(1000), width: 1, height: 1 }));
  await assertSucceeds(read(MARK, `households/${A}`));
  await assertSucceeds(read(MARK, `households/${A}/members/${SHELLEY}`));
  await assertSucceeds(read(MARK, `users/${MARK}`));
});

/* ---- another household ---- */
test('a member of one household cannot read or write another', async () => {
  await assertFails(read(JANE, `households/${A}/entries/e-med`));
  await assertFails(read(JANE, `households/${A}/medicines/m1`));
  await assertFails(read(JANE, `households/${A}/documents/d1`));
  await assertFails(read(JANE, `households/${A}/documents/d1/pages/1`));
  await assertFails(read(JANE, `households/${A}/profile/main`));
  await assertFails(read(JANE, `households/${A}/days/2026-09-29`));
  await assertFails(read(JANE, `households/${A}/exercise/2026-09-29`));
  await assertFails(read(JANE, `households/${A}/recordings/r1/parts/0`));
  await assertFails(read(JANE, `households/${A}/pushSubs/p1`));
  await assertFails(read(JANE, `households/${A}`));
  await assertFails(read(JANE, `households/${A}/members/${MARK}`));
  await assertFails(list(JANE, `households/${A}/entries`));
  await assertFails(getDocs(query(collection(as(JANE), `households/${A}/entries`), where('type', '==', 'med'))));
  await assertFails(write(JANE, `households/${A}/entries/intruder`, { type: 'note', note: 'Hi' }));
  await assertFails(write(JANE, `households/${A}/medicines/m1`, { name: 'Changed' }));
  await assertFails(deleteDoc(doc(as(JANE), `households/${A}/entries/e-med`)));
  await assertFails(read(MARK, `households/${B}/entries/e-jane`));
  await assertFails(read(MARK, `households/${B}/medicines/mj`));
  await assertFails(write(MARK, `households/${B}/entries/x`, { type: 'note' }));
  await assertSucceeds(read(JANE, `households/${B}/entries/e-jane`));
});

/* ---- strangers ---- */
test('a signed-in stranger and an anonymous visitor get nothing', async () => {
  for (const who of [SAM, null]) {
    await assertFails(read(who, `households/${A}/entries/e-med`));
    await assertFails(read(who, `households/${A}/medicines/m1`));
    await assertFails(read(who, `households/${A}`));
    await assertFails(list(who, `households/${A}/entries`));
    await assertFails(list(who, `households`));
    await assertFails(write(who, `households/${A}/entries/x`, { type: 'note' }));
    await assertFails(write(who, `households/newhouse`, { name: 'Mine' }));
    await assertFails(write(who, `households/newhouse/members/${SAM}`, { role: 'family' }));
    await assertFails(read(who, `users/${MARK}`));
    await assertFails(read(who, `healthKeys/abc123`));
  }
  await assertFails(read(null, `users/${SAM}`));
  await assertSucceeds(read(SAM, `users/${SAM}`));
});

/* ---- read only ---- */
test('a read-only member sees everything and writes nothing', async () => {
  await assertSucceeds(read(HAYLEY, `households/${A}/entries/e-food`));
  await assertSucceeds(read(HAYLEY, `households/${A}/entries/e-note`));
  await assertSucceeds(read(HAYLEY, `households/${A}/documents/d1/pages/1`));
  await assertSucceeds(read(HAYLEY, `households/${A}/profile/main`));
  await assertSucceeds(read(HAYLEY, `households/${A}/exercise/2026-09-29`));
  await assertSucceeds(read(HAYLEY, `households/${A}/recordings/r1/parts/0`));
  await assertSucceeds(list(HAYLEY, `households/${A}/entries`));
  await assertFails(write(HAYLEY, `households/${A}/entries/h1`, { type: 'note', note: 'Hi' }));
  await assertFails(updateDoc(doc(as(HAYLEY), `households/${A}/medicines/m1`), { dose: '3 capsules' }));
  await assertFails(deleteDoc(doc(as(HAYLEY), `households/${A}/entries/e-med`)));
  await assertFails(write(HAYLEY, `households/${A}/profile/main`, { calls: [] }));
  await assertFails(write(HAYLEY, `households/${A}/documents/d1/pages/3`, { data: 'abc', width: 1, height: 1 }));
  await assertFails(read(HAYLEY, `households/${A}/pushSubs/p1`));
  await assertFails(write(HAYLEY, `households/${A}/pushSubs/p9`, { endpoint: 'x' }));
  await assertFails(read(HAYLEY, `households/${A}/members/${MARK}`));
  await assertSucceeds(read(HAYLEY, `households/${A}/members/${HAYLEY}`));
});

/* ---- viewer ---- */
test('a viewer sees medicines, the calendar and readings, nothing else', async () => {
  await assertSucceeds(read(VIV, `households/${A}/entries/e-med`));
  await assertSucceeds(read(VIV, `households/${A}/medicines/m1`));
  await assertSucceeds(read(VIV, `households/${A}/days/2026-09-29`));
  await assertSucceeds(getDocs(query(collection(as(VIV), `households/${A}/entries`), where('type', '==', 'med'))));
  await assertFails(read(VIV, `households/${A}/entries/e-food`));
  await assertFails(read(VIV, `households/${A}/entries/e-note`));
  await assertFails(list(VIV, `households/${A}/entries`));
  await assertFails(read(VIV, `households/${A}/documents/d1`));
  await assertFails(read(VIV, `households/${A}/profile/main`));
  await assertFails(read(VIV, `households/${A}/exercise/2026-09-29`));
  await assertFails(read(VIV, `households/${A}/meals/meal1`));
  await assertFails(read(VIV, `households/${A}/nutrition/2026-09-29`));
  await assertFails(read(VIV, `households/${A}/recordings/r1`));
  await assertFails(write(VIV, `households/${A}/entries/v1`, { type: 'med' }));
  await assertFails(write(VIV, `households/${A}/medicines/m1`, { name: 'x' }));
});

/* ---- the records that decide access ---- */
test('nobody can write a household, a members record, a users record, an inbox key or the bridge logs', async () => {
  await assertFails(write(MARK, `households/${A}/members/${SAM}`, { name: 'Sam', role: 'family' }));
  await assertFails(updateDoc(doc(as(MARK), `households/${A}/members/${HAYLEY}`), { role: 'family' }));
  await assertFails(deleteDoc(doc(as(MARK), `households/${A}/members/${VIV}`)));
  await assertFails(write(HAYLEY, `households/${A}/members/${HAYLEY}`, { role: 'family' }));
  await assertFails(write(MARK, `households/${A}`, { name: 'Renamed' }));
  await assertFails(write(MARK, `households/${A}`, { name: 'Renamed', owner: MARK }));
  await assertFails(write(MARK, `households/newone`, { name: 'Second', owner: MARK }));
  await assertFails(write(MARK, `users/${MARK}`, { household: B }));
  await assertFails(write(SAM, `users/${SAM}`, { household: A }));
  await assertFails(read(MARK, `users/${SHELLEY}`));
  await assertFails(read(MARK, `healthKeys/abc123`));
  await assertFails(write(MARK, `healthKeys/zzz`, { household: A }));
  await assertSucceeds(read(MARK, `households/${A}/private/health`));
  await assertFails(write(MARK, `households/${A}/private/health`, { key: 'mine' }));
  await assertFails(read(HAYLEY, `households/${A}/private/health`));
  await assertFails(read(VIV, `households/${A}/private/health`));
  await assertFails(read(JANE, `households/${A}/private/health`));
  await assertFails(read(SAM, `households/${A}/private/health`));
  await assertFails(read(MARK, `households/${A}/bridge/explainLog`));
  await assertFails(write(MARK, `households/${A}/bridge/explainLog`, { calls: 0 }));
  await assertFails(read(MARK, `households/${A}/invites/code1`));
  await assertFails(write(MARK, `households/${A}/invites/code2`, { role: 'family' }));
  await assertFails(list(MARK, `households`));
  await assertFails(read(MARK, `inviteCodes/code1`));
  await assertFails(read(SAM, `inviteCodes/code1`));
  await assertFails(write(SAM, `inviteCodes/mine`, { household: A }));
  await assertFails(read(MARK, `bridge/global`));
  await assertFails(write(MARK, `bridge/global`, { households: 0 }));
});

/* ---- size guard ---- */
test('an oversized page or recording part is refused even for family', async () => {
  await assertFails(write(MARK, `households/${A}/documents/d1/pages/9`, { data: 'x'.repeat(960000), width: 1, height: 1 }));
  await assertFails(write(MARK, `households/${A}/recordings/r1/parts/9`, { n: 9, data: 'x'.repeat(960000) }));
  await assertFails(write(MARK, `households/${A}/documents/d1/pages/8`, { data: 12345, width: 1, height: 1 }));
  await assertSucceeds(write(MARK, `households/${A}/recordings/r1/parts/1`, { n: 1, data: 'x'.repeat(700000) }));
});

/* ---- the transition layout ---- */
test('the old shared layout still answers to the old role records, and to nobody else', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${MARK}`), { household: A, role: 'family', name: 'Mark' });
  });
  await assertSucceeds(read(MARK, `entries/old1`));
  await assertFails(read(JANE, `entries/old1`));
  await assertFails(read(SAM, `entries/old1`));
  await assertFails(read(null, `entries/old1`));
});
