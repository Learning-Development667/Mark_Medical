/* Care Log bridge.
   Runs on Cloudflare Workers (free plan). Two jobs:
   1. /health   receives Apple Health data pushed by the Health Auto Export app and writes
                steps and sleep into Firestore, so they no longer need typing in.
   2. /ping     a quick "is it alive" check.
   Nutrition lookups (Open Food Facts by barcode) will be added here next.

   Firestore is written through its REST API with a Firebase service account, signed with
   WebCrypto. No Firebase SDK, no build step, nothing to install. */

const ALLOWED_ORIGINS = ['https://learning-development667.github.io'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }));
    try {
      if (url.pathname === '/ping') return withCors(request, json({ ok: true, at: new Date().toISOString() }));
      if (url.pathname === '/health' && request.method === 'POST') return withCors(request, await handleHealth(request, env));
      /* Diagnostic: what the phone last sent and what was written, for checking the field names.
         Opened in a browser with ?key=<BRIDGE_KEY>. Health data only, no secrets. */
      if (url.pathname === '/last' && request.method === 'GET') {
        if (!env.BRIDGE_KEY || url.searchParams.get('key') !== env.BRIDGE_KEY) return json({ error: 'Unauthorised' }, 401);
        const fs = await firestore(env);
        const doc = await fs.get('bridge/last');
        if (!doc) return json({ note: 'Nothing received yet' });
        const f = doc.fields || {};
        let sample = null;
        try { sample = JSON.parse(f.sample && f.sample.stringValue || 'null'); } catch (e) { sample = f.sample && f.sample.stringValue; }
        return json({ receivedAt: f.receivedAt && f.receivedAt.timestampValue, result: f.result && f.result.stringValue, sample });
      }
      /* Sends a test notification to every phone with reminders on: ?key=<BRIDGE_KEY> */
      if (url.pathname === '/push-test' && request.method === 'GET') {
        if (!env.BRIDGE_KEY || url.searchParams.get('key') !== env.BRIDGE_KEY) return json({ error: 'Unauthorised' }, 401);
        const fs = await firestore(env);
        const subs = await fs.list('pushSubs');
        const results = [];
        for (const d of subs) results.push(await sendPush(env, fs, d, { title: 'Daybook', body: 'Reminders are working on this phone.', tag: 'test', url: appUrl('meds') }));
        return json({ phones: subs.length, results });
      }
      /* Runs the reminder check by hand: ?key=<BRIDGE_KEY> */
      if (url.pathname === '/remind-now' && request.method === 'GET') {
        if (!env.BRIDGE_KEY || url.searchParams.get('key') !== env.BRIDGE_KEY) return json({ error: 'Unauthorised' }, 401);
        return json(await runReminders(env));
      }
      return withCors(request, json({ error: 'Not found' }, 404));
    } catch (e) {
      return withCors(request, json({ error: String(e && e.message || e) }, 500));
    }
  },
  /* Cron (wrangler.toml, every five minutes): medicine reminders as push notifications */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).catch((e) => console.error('reminders', e)));
  }
};

/* ------------------------------------------------------------------ */
/* Apple Health inbox                                                    */
/* ------------------------------------------------------------------ */

async function handleHealth(request, env) {
  if (!env.BRIDGE_KEY || request.headers.get('X-Care-Log-Key') !== env.BRIDGE_KEY) return json({ error: 'Unauthorised' }, 401);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Expected JSON' }, 400);

  const fs = await firestore(env);
  /* Keep the last raw payload (trimmed) so the exact shape can be checked after the first real send */
  await fs.set('bridge/last', { receivedAt: nowTs(), sample: strVal(JSON.stringify(body).slice(0, 20000)) });

  const metrics = (body.data && Array.isArray(body.data.metrics)) ? body.data.metrics : [];
  const result = { steps: 0, sleep: 0, nutrition: 0, skipped: [] };
  /* Food totals per day from whatever app writes them into Apple Health (MyFitnessPal, Nutracheck, Apple's own):
     gathered across the four metrics first, then written once per day */
  const foodDays = {};

  for (const m of metrics) {
    const name = String(m.name || '').toLowerCase();
    const rows = Array.isArray(m.data) ? m.data : [];
    if (name === 'step_count' || name === 'steps') {
      /* Steps: one row per day when the app is set to daily aggregation. Sum any finer rows. */
      const perDay = {};
      for (const r of rows) {
        const day = dayOf(r.date);
        if (!day) continue;
        perDay[day] = (perDay[day] || 0) + (Number(r.qty) || 0);
      }
      for (const [day, qty] of Object.entries(perDay)) {
        const steps = Math.round(qty);
        if (steps <= 0) continue;
        await fs.merge('exercise/' + day, { day: strVal(day), steps: intVal(steps), addedBy: strVal('Apple Health'), updatedAt: nowTs() });
        result.steps++;
      }
    } else if (name === 'sleep_analysis' || name === 'sleep') {
      /* Sleep: hours per stage for the night, logged against the morning it ended (Care Log's convention).
         Health Auto Export's field names vary a little between versions, so read them leniently. */
      for (const r of rows) {
        const end = r.sleepEnd || r.inBedEnd || r.date;
        const start = r.sleepStart || r.inBedStart;
        const day = dayOf(end);
        if (!day) continue;
        const hours = (k) => { const v = Number(r[k]); return isFinite(v) ? v : 0; };
        const core = hours('core'), deep = hours('deep'), rem = hours('rem'), awake = hours('awake');
        let asleep = hours('asleep') || hours('totalSleep') || (core + deep + rem);
        if (asleep <= 0) { result.skipped.push('sleep ' + day + ' (no asleep total)'); continue; }
        const mins = (h) => Math.round(h * 60);
        const fields = {
          day: strVal(day), type: strVal('sleep'), value: intVal(mins(asleep)),
          addedBy: strVal('Apple Health'), source: strVal('health-auto-export'),
          at: tsVal(toIso(end) || day + 'T07:00:00Z'), updatedAt: nowTs()
        };
        if (core > 0) fields.core = intVal(mins(core));
        if (deep > 0) fields.deep = intVal(mins(deep));
        if (rem > 0) fields.rem = intVal(mins(rem));
        if (awake > 0) fields.awake = intVal(mins(awake));
        const bedAt = hhmm(start), wokeAt = hhmm(end);
        if (bedAt) fields.bedAt = strVal(bedAt);
        if (wokeAt) fields.wokeAt = strVal(wokeAt);
        /* Deterministic id: a night can only ever be one document, so re-sends update rather than duplicate */
        const existing = await fs.get('entries/' + day + '_sleep');
        if (!existing) fields.createdAt = nowTs();
        await fs.merge('entries/' + day + '_sleep', fields);
        result.sleep++;
      }
    } else if (NUTRITION[name]) {
      const key = NUTRITION[name];
      const units = String(m.units || '').toLowerCase();
      for (const r of rows) {
        const day = dayOf(r.date);
        let qty = Number(r.qty);
        if (!day || !isFinite(qty) || qty <= 0) continue;
        if (key === 'kcal' && units === 'kj') qty = qty / 4.184; // Apple Health stores kcal; the export may be set to kJ
        foodDays[day] = foodDays[day] || {};
        foodDays[day][key] = (foodDays[day][key] || 0) + qty;
      }
    } else {
      result.skipped.push(name || '(unnamed metric)');
    }
  }
  for (const [day, totals] of Object.entries(foodDays)) {
    const fields = { day: strVal(day), source: strVal('apple-health'), addedBy: strVal('Apple Health'), updatedAt: nowTs() };
    for (const k of ['kcal', 'prot', 'carb', 'fat']) if (totals[k] > 0) fields[k] = doubleVal(Math.round(totals[k] * 10) / 10);
    await fs.merge('nutrition/' + day, fields);
    result.nutrition++;
  }
  await fs.merge('bridge/last', { result: strVal(JSON.stringify(result)) });
  return json({ ok: true, ...result });
}

/* Health Auto Export dates look like "2026-09-24 07:05:00 +0100" (local time with offset) */
function dayOf(s) { const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
function hhmm(s) { const m = String(s || '').match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/); return m ? m[1] : null; }
function toIso(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?/);
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3]}:${m[4] || '00'}`;
}

/* ------------------------------------------------------------------ */
/* Firestore REST with a service account                                */
/* ------------------------------------------------------------------ */

let tokenCache = { token: null, exp: 0 };

async function firestore(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing or incomplete');
  const token = await accessToken(sa);
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/`;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  return {
    async get(path) {
      const r = await fetch(base + path, { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Firestore get ' + path + ': ' + r.status + ' ' + await r.text());
      return r.json();
    },
    /* Merge: only the given fields change, anything else on the document stays */
    async merge(path, fields) {
      const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
      const r = await fetch(base + path + '?' + mask, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error('Firestore write ' + path + ': ' + r.status + ' ' + await r.text());
    },
    async set(path, fields) {
      const r = await fetch(base + path, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error('Firestore set ' + path + ': ' + r.status + ' ' + await r.text());
    },
    async remove(path) {
      const r = await fetch(base + path, { method: 'DELETE', headers });
      if (!r.ok && r.status !== 404) throw new Error('Firestore delete ' + path + ': ' + r.status + ' ' + await r.text());
    },
    /* Every document in a collection (a few hundred at most here), as { id, fields } */
    async list(collection) {
      const out = [];
      let pageToken = '';
      do {
        const r = await fetch(base + collection + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), { headers });
        if (r.status === 404) return out;
        if (!r.ok) throw new Error('Firestore list ' + collection + ': ' + r.status + ' ' + await r.text());
        const body = await r.json();
        (body.documents || []).forEach((d) => out.push({ id: d.name.split('/').pop(), fields: d.fields || {} }));
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    /* Documents matching equality filters, e.g. query('entries', { day: '2026-09-28', type: 'med' }) */
    async query(collection, where) {
      const filters = Object.entries(where).map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: String(value) } } }));
      const structuredQuery = { from: [{ collectionId: collection }], where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } }, limit: 500 };
      const r = await fetch(base.replace(/\/$/, '') + ':runQuery', { method: 'POST', headers, body: JSON.stringify({ structuredQuery }) });
      if (!r.ok) throw new Error('Firestore query ' + collection + ': ' + r.status + ' ' + await r.text());
      const rows = await r.json();
      return rows.filter((x) => x.document).map((x) => ({ id: x.document.name.split('/').pop(), fields: x.document.fields || {} }));
    }
  };
}

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + claims));
  const jwt = header + '.' + claims + '.' + b64url(new Uint8Array(sig));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Google token: ' + JSON.stringify(data));
  tokenCache = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
  return data.access_token;
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------------ */
/* Medicine reminders: push notifications at the times set in the app    */
/* ------------------------------------------------------------------ */

const APP_ORIGIN = 'https://learning-development667.github.io';
const appUrl = (tab) => APP_ORIGIN + '/Mark_Medical/' + (tab ? '?tab=' + tab : '');
const TZ = 'Europe/London';
const REMINDER_WINDOW_MIN = 20;   // a time is "due" for this long after it (cron runs every five minutes)
const NUDGE_AFTER_MIN = 30;       // one more notification if still not logged this long after the time
const LOGGED_BEFORE_MIN = 60;     // a dose logged this long before the time counts as taken

/* Local wall-clock time in London as { day: 'YYYY-MM-DD', minutes: since midnight } */
function londonNow(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date || new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10) };
}
const toMinutes = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; };
const f = (fields, k) => { const v = fields[k]; if (!v) return null; return v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? (v.arrayValue ? (v.arrayValue.values || []).map((x) => x.stringValue ?? x.integerValue ?? x.doubleValue) : null); };

async function runReminders(env) {
  if (!env.VAPID_PRIVATE_KEY) return { skipped: 'VAPID_PRIVATE_KEY is not set' };
  const fs = await firestore(env);
  const subs = await fs.list('pushSubs');
  if (!subs.length) return { skipped: 'no phones have reminders on' };
  const now = londonNow();
  const logDoc = await fs.get('bridge/reminderLog');
  const lf = logDoc ? logDoc.fields : {};
  const sent = f(lf, 'day') === now.day && lf.sent && lf.sent.mapValue ? Object.keys(lf.sent.mapValue.fields || {}) : [];
  const sentSet = new Set(sent);
  const medicines = (await fs.list('medicines')).filter((m) => f(m.fields, 'active') !== false && f(m.fields, 'kind') !== 'prn' && (!f(m.fields, 'courseEnd') || f(m.fields, 'courseEnd') >= now.day));
  const doses = await fs.query('entries', { day: now.day, type: 'med' });
  const doseMinutes = (medId) => doses.filter((d) => f(d.fields, 'medId') === medId).map((d) => londonNow(new Date(f(d.fields, 'at'))).minutes);
  const out = [];
  const send = async (key, payload) => {
    for (const sub of subs) out.push({ key, phone: sub.id, result: await sendPush(env, fs, sub, payload) });
    sentSet.add(key);
  };
  for (const m of medicines) {
    const times = (f(m.fields, 'times') || []).map(toMinutes).filter((t) => t != null);
    const name = f(m.fields, 'name') || 'Medicine', dose = f(m.fields, 'dose') || '';
    const taken = doseMinutes(m.id);
    for (const t of times) {
      const key = `${m.id}|${t}`;
      const takenSince = taken.some((x) => x >= t - LOGGED_BEFORE_MIN);
      if (!sentSet.has(key) && now.minutes >= t && now.minutes < t + REMINDER_WINDOW_MIN && !takenSince) {
        await send(key, { title: 'Daybook', body: `${name} ${dose} is due`.trim(), tag: key, url: appUrl('meds') });
      }
      const nudgeKey = key + '|nudge';
      if (!sentSet.has(nudgeKey) && now.minutes >= t + NUDGE_AFTER_MIN && now.minutes < t + NUDGE_AFTER_MIN + REMINDER_WINDOW_MIN && !takenSince) {
        await send(nudgeKey, { title: 'Daybook', body: `Still to take: ${name} ${dose}`.trim(), tag: nudgeKey, url: appUrl('meds') });
      }
    }
  }
  /* One-off reminders from the app ("Remind me in 15 minutes" after a meal) */
  const oneOffs = await fs.list('reminders');
  for (const r of oneOffs) {
    if (f(r.fields, 'sent') === true) { if (new Date(f(r.fields, 'at')).getTime() < Date.now() - 86400000) await fs.remove('reminders/' + r.id); continue; }
    if (new Date(f(r.fields, 'at')).getTime() > Date.now()) continue;
    await send('oneoff|' + r.id, { title: 'Daybook', body: `Reminder: ${f(r.fields, 'medName') || 'medicine'} ${f(r.fields, 'dose') || ''}`.trim(), tag: 'oneoff|' + r.id, url: appUrl('meds') });
    await fs.merge('reminders/' + r.id, { sent: { booleanValue: true } });
  }
  await fs.set('bridge/reminderLog', { day: strVal(now.day), at: { timestampValue: new Date().toISOString() }, sent: { mapValue: { fields: Object.fromEntries([...sentSet].map((k) => [k, { booleanValue: true }])) } } });
  return { day: now.day, minutes: now.minutes, phones: subs.length, medicines: medicines.length, sent: out };
}

/* Web Push (RFC 8030, 8291, 8292) with nothing but WebCrypto: VAPID signature, aes128gcm payload */
const b64urlDecode = (s) => { const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function vapidHeader(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const pub = b64url(concat(new Uint8Array([4]), b64urlDecode(jwk.x), b64urlDecode(jwk.y)));
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_ORIGIN + '/Mark_Medical/' });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${pub}`;
}
async function encryptPayload(sub, text) {
  const clientPub = b64urlDecode(sub.p256dh), auth = b64urlDecode(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, local.privateKey, 256));
  const te = new TextEncoder();
  const ikm = await hkdf(auth, shared, concat(te.encode('WebPush: info\0'), clientPub, localPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(te.encode(text), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record));
  const header = concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([localPub.length]), localPub);
  return concat(header, ct);
}
/* Sends one notification; a dead subscription (404, 410) is removed so it is not tried again */
async function sendPush(env, fs, subDoc, payload) {
  const endpoint = f(subDoc.fields, 'endpoint');
  const keys = subDoc.fields.keys && subDoc.fields.keys.mapValue ? subDoc.fields.keys.mapValue.fields : {};
  const sub = { endpoint, p256dh: f(keys, 'p256dh'), auth: f(keys, 'auth') };
  if (!endpoint || !sub.p256dh || !sub.auth) return 'incomplete subscription';
  try {
    const body = await encryptPayload(sub, JSON.stringify(payload));
    const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high' }, body });
    if (r.status === 404 || r.status === 410) { await fs.remove('pushSubs/' + subDoc.id); return 'gone, removed'; }
    if (!r.ok) return 'push service ' + r.status + ' ' + (await r.text()).slice(0, 120);
    return 'sent';
  } catch (e) { return 'error ' + (e && e.message || e); }
}

/* Firestore's typed JSON */
const strVal = (v) => ({ stringValue: String(v) });
const intVal = (v) => ({ integerValue: String(Math.round(v)) });
const doubleVal = (v) => ({ doubleValue: Number(v) });
/* Health Auto Export metric names for the day's food totals, and the field each lands in (nutrition/{day}) */
const NUTRITION = { dietary_energy: 'kcal', active_energy_dietary: 'kcal', protein: 'prot', carbohydrates: 'carb', total_fat: 'fat' };
const tsVal = (iso) => ({ timestampValue: new Date(iso).toISOString() });
const nowTs = () => ({ timestampValue: new Date().toISOString() });

/* ------------------------------------------------------------------ */
/* Plumbing                                                             */
/* ------------------------------------------------------------------ */

function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
function withCors(request, res) {
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Care-Log-Key');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  return res;
}
