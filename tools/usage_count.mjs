/* The usage counts, once a night from GitHub Actions (v426). Until v425 the bridge counted them, but the Cloudflare free plan
   allows about 50 database calls a request and each circle needs eight, so from the sixth circle the count stopped part way
   and saved nothing: the Usage page stayed on five circles while seven more had joined with a Beta code (Mark, 5 November).
   Here there is no such limit. Same counts, same document (bridge/usage), same pseudonyms (the first eight characters of a
   salted hash of the circle id, salted with BRIDGE_KEY), so the app's Usage page and the feedback list read it unchanged.
   Counts, never content. The log is public: it prints totals only, never a name, an email, a code, a label or a circle id.
   Needs FIREBASE_SERVICE_ACCOUNT and BRIDGE_KEY (the bridge's own secrets). Usage: node tools/usage_count.mjs */
import { loadServiceAccount, connect, sha256Hex } from './lib/firestore_rest.mjs';

const USAGE_PATH = 'bridge/usage';
const USAGE_HISTORY_DAYS = 90;
const USAGE_WEEK = 7;
const USAGE_MAX_ROWS = 2000;            // past this the document nears Firestore's 1 MB: shard the rows then
const DEMO_HOUSEHOLD = 'demo';
const AI_KINDS = ['document', 'report', 'weekly', 'mood', 'pain', 'programme', 'medicine', 'flare', 'sessions', 'results', 'notes', 'label'];
const AT_ONCE = 8;                      // circles counted side by side

const sa = loadServiceAccount('FIREBASE_SERVICE_ACCOUNT');
const salt = process.env.BRIDGE_KEY || '';
if (!salt) { console.error('BRIDGE_KEY secret is missing: the circle codes would not match the app'); process.exit(1); }
const fs = await connect(sa);

const f = (fields, k) => { const v = fields && fields[k]; if (!v) return null; return v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? null; };
const strVal = (s) => ({ stringValue: String(s) });
const intVal = (n) => ({ integerValue: String(Math.round(Number(n) || 0)) });
const usageVal = (v) => (typeof v === 'string' ? strVal(v) : typeof v === 'object' && v ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, usageVal(x)])) } } : intVal(v));
const londonDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayMinus = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const plain = (v) => (v && v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)])) : (v && (v.stringValue ?? Number(v.integerValue ?? v.doubleValue ?? 0))));

async function countCircle(hh, day) {
  const hid = hh.id;
  const from = dayMinus(day, USAGE_WEEK - 1);
  const days = []; for (let i = 0; i < USAGE_WEEK; i++) days.push(dayMinus(day, i));
  const ref = (id) => ({ referenceValue: fs.docName(`households/${hid}/entries/${id}`) });
  const E = `households/${hid}/entries`;
  const [pf, af0, entries7, latest, sent, members, phones, checkins] = await Promise.all([
    fs.get(`households/${hid}/profile/main`),
    fs.get(`households/${hid}/bridge/explainLog`),
    fs.count(E, { fieldFilter: { field: { fieldPath: 'day' }, op: 'GREATER_THAN_OR_EQUAL', value: strVal(from) } }),
    fs.run(E, { orderBy: [{ field: { fieldPath: 'day' }, direction: 'DESCENDING' }], limit: 1 }),
    fs.count(E, { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: strVal('sent') } }),
    fs.count(`households/${hid}/members`),
    fs.count(`households/${hid}/pushSubs`),
    fs.count(E, { fieldFilter: { field: { fieldPath: '__name__' }, op: 'IN', value: { arrayValue: { values: days.flatMap((d) => [ref(d + '_morning'), ref(d + '_evening')]) } } } })
  ]);
  const p = pf || {};
  const packsMap = p.packs && p.packs.mapValue ? p.packs.mapValue.fields || {} : null;
  const packs = packsMap ? Object.keys(packsMap).filter((k) => packsMap[k].booleanValue) : ['cancer'];
  const af = af0 && f(af0, 'month') === day.slice(0, 7) ? af0 : {};
  const kinds = Object.fromEntries(Object.entries((af.monthKinds && af.monthKinds.mapValue && af.monthKinds.mapValue.fields) || {}).map(([k, v]) => [k, Number(v.integerValue || 0)]));
  return { created: String(f(hh.fields, 'createdAt') || '').slice(0, 10), code: String(f(hh.fields, 'betaCode') || '').slice(0, 24), packs: packs.join(','),
    members, phones, entries7, checkins7: checkins, last: latest.length ? String(f(latest[0].fields, 'day') || '') : '',
    ai: Number(f(af, 'monthReal') || 0) + Number(f(af, 'monthReports') || 0), kinds, sent, setup: !!(f(p, 'setupDone') || packsMap) };
}

const day = londonDay();
const beforeDoc = await fs.get(USAGE_PATH);
const beforeHistory = beforeDoc && beforeDoc.history ? plain(beforeDoc.history) : {};
const households = (await fs.list('households')).filter((hh) => hh.id !== DEMO_HOUSEHOLD).slice(0, USAGE_MAX_ROWS);
const feedback = await fs.count('feedback');
const t = { circles: households.length, new7: 0, new30: 0, active7: 0, logging7: 0, checkins7: 0, checkinSlots: 0, members: 0, phones: 0, aiCircles: 0, aiCalls: 0, sent: 0, setup: 0, feedback, packCancer: 0, packIbd: 0, packGeneral: 0, packMenopause: 0 };
const kinds = Object.fromEntries(AI_KINDS.map((k) => [k, 0]));
const codes = {};
const circles = {};
for (let i = 0; i < households.length; i += AT_ONCE) {
  const part = households.slice(i, i + AT_ONCE);
  const counted = await Promise.all(part.map((hh) => countCircle(hh, day)));
  part.forEach((hh, j) => {
    const c = counted[j];
    const pid = sha256Hex(hh.id + ':' + salt).slice(0, 8);
    circles[pid] = { created: c.created, code: c.code, packs: c.packs, members: c.members, phones: c.phones, entries7: c.entries7, checkins7: c.checkins7, last: c.last, ai: c.ai, sent: c.sent, setup: c.setup ? 1 : 0 };
    if (c.created && c.created >= dayMinus(day, 6)) t.new7++;
    if (c.created && c.created >= dayMinus(day, 29)) t.new30++;
    if (c.entries7 > 0) { t.active7++; t.checkinSlots += USAGE_WEEK * 2; }
    if (c.checkins7 >= USAGE_WEEK) t.logging7++;
    t.checkins7 += c.checkins7; t.members += c.members; t.phones += c.phones; t.sent += c.sent;
    if (c.ai > 0) { t.aiCircles++; t.aiCalls += c.ai; }
    for (const [k, n] of Object.entries(c.kinds)) kinds[k] = (kinds[k] || 0) + n;
    if (c.setup) t.setup++;
    for (const [pk, key] of [['cancer', 'packCancer'], ['ibd', 'packIbd'], ['general', 'packGeneral'], ['menopause', 'packMenopause']]) if (c.packs.split(',').includes(pk)) t[key]++;
    if (c.code) codes[c.code] = (codes[c.code] || 0) + 1;
  });
}
const history = Object.fromEntries(Object.entries(beforeHistory).filter(([d]) => d >= dayMinus(day, USAGE_HISTORY_DAYS - 1)));
history[day] = { circles: t.circles, active7: t.active7, logging7: t.logging7, checkins7: t.checkins7, aiCalls: t.aiCalls, sent: t.sent };
await fs.set(USAGE_PATH, { day: strVal(day), built: { timestampValue: new Date().toISOString() }, totals: usageVal({ ...t, kinds, codes }), history: usageVal(history), circles: usageVal(circles) });
console.log(`Counted ${t.circles} circles for the week to ${day}: ${t.active7} logged something, ${t.members} people, ${Object.keys(codes).length} Beta codes in use.`);
