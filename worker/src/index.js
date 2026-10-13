/* Care Log bridge.
   Runs on Cloudflare Workers (free plan). Two jobs:
   1. /health   receives Apple Health data pushed by the Health Auto Export app and writes
                steps and sleep into Firestore, so they no longer need typing in.
   2. /ping     a quick "is it alive" check.
   3. /explain  "Explain in Daybook": a signed-in family member sends a letter (text or page
                photos) or the Notes for the team text, and the bridge asks Claude for a plain
                English explanation or a list of questions with the ANTHROPIC_API_KEY secret.
   Medicine reminders run on a cron (see below). Nutrition lookups (Open Food Facts by barcode)
   will be added here next.

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
      if (url.pathname === '/explain' && request.method === 'POST') return withCors(request, await handleExplain(request, env));
      /* Households (since v78): sign-up, invites, joining, removing a member. The app never writes
         the records that decide access; these do, with the service account, after checking who asks. */
      if (url.pathname === '/household' && request.method === 'POST') return withCors(request, await handleCreateHousehold(request, env));
      if (url.pathname === '/beta-info' && request.method === 'GET') return withCors(request, await handleBetaInfo(url, env));
      if (url.pathname === '/feedback' && request.method === 'POST') return withCors(request, await handleFeedback(request, env));
      if (url.pathname === '/feedback-info' && request.method === 'POST') return withCors(request, await handleFeedbackInfo(request, env));
      if (url.pathname === '/send-report' && request.method === 'POST') return withCors(request, await handleSendReport(request, env));
      if (url.pathname === '/invite' && request.method === 'POST') return withCors(request, await handleInvite(request, env));
      if (url.pathname === '/invite-info' && request.method === 'GET') return withCors(request, await handleInviteInfo(url, env));
      if (url.pathname === '/join' && request.method === 'POST') return withCors(request, await handleJoin(request, env));
      if (url.pathname === '/member-remove' && request.method === 'POST') return withCors(request, await handleRemoveMember(request, env));
      /* Diagnostic: what the phone last sent and what was written, for checking the field names.
         Opened in a browser with ?key=<the household's inbox key>. Health data only, no secrets. */
      if (url.pathname === '/last' && request.method === 'GET') {
        const fs = await firestore(env);
        const hid = await householdForKey(fs, url.searchParams.get('key') || '');
        if (!hid) return json({ error: 'Unauthorised' }, 401);
        const doc = await fs.get(hp(hid, 'bridge/last'));
        if (!doc) return json({ note: 'Nothing received yet' });
        const f = doc.fields || {};
        let sample = null;
        try { sample = JSON.parse(f.sample && f.sample.stringValue || 'null'); } catch (e) { sample = f.sample && f.sample.stringValue; }
        return json({ receivedAt: f.receivedAt && f.receivedAt.timestampValue, result: f.result && f.result.stringValue, sample });
      }
      /* Sends a test notification to every phone with reminders on in that key's household: ?key=<the household's inbox key> */
      if (url.pathname === '/push-test' && request.method === 'GET') {
        const fs = await firestore(env);
        const hid = await householdForKey(fs, url.searchParams.get('key') || '');
        if (!hid) return json({ error: 'Unauthorised' }, 401);
        const subs = await fs.list(hp(hid, 'pushSubs'));
        const results = [];
        for (const d of subs) results.push(await sendPush(env, fs, d, { title: 'Daybook', body: 'Reminders are working on this phone.', tag: 'test', url: appUrl('meds') }));
        return json({ phones: subs.length, results });
      }
      /* Runs the reminder check by hand for every household: ?key=<BRIDGE_KEY> (the operator's key) */
      if (url.pathname === '/remind-now' && request.method === 'GET') {
        if (!env.BRIDGE_KEY || url.searchParams.get('key') !== env.BRIDGE_KEY) return json({ error: 'Unauthorised' }, 401);
        return json(await runReminders(env));
      }
      return withCors(request, json({ error: 'Not found' }, 404));
    } catch (e) {
      console.error('bridge', e && e.message);
      return withCors(request, json({ error: String(e && e.message || e), message: 'Daybook\'s bridge hit a problem: ' + String(e && e.message || e).slice(0, 160) }, 500));
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

/* Every household has its own inbox key (since v75): the key travels in the X-Care-Log-Key header,
   its SHA-256 hash is looked up in healthKeys/{hash} { household }, and the send lands in that
   household alone. The keys themselves are never stored, only their hashes. */
async function householdForKey(fs, key) {
  if (!key) return null;
  const rec = await fs.get('healthKeys/' + await sha256Hex(key));
  return rec && f(rec.fields, 'household') || null;
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/* households/{hid}/... */
const hp = (hid, path) => 'households/' + hid + '/' + path;

async function handleHealth(request, env) {
  const key = request.headers.get('X-Care-Log-Key') || '';
  if (!key) return json({ error: 'Unauthorised' }, 401);
  const fs = await firestore(env);
  const hid = await householdForKey(fs, key);
  if (!hid) return json({ error: 'Unauthorised', message: 'This key is not linked to a household. Link it with the household workflow on the Actions tab.' }, 401);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Expected JSON' }, 400);

  /* Keep the last raw payload (trimmed) so the exact shape can be checked after the first real send */
  await fs.set(hp(hid, 'bridge/last'), { receivedAt: nowTs(), sample: strVal(JSON.stringify(body).slice(0, 20000)) });

  const metrics = (body.data && Array.isArray(body.data.metrics)) ? body.data.metrics : [];
  const result = { steps: 0, sleep: 0, nutrition: 0, workouts: 0, weight: 0, skipped: [] };
  /* Food totals per day from whatever app writes them into Apple Health (MyFitnessPal, Nutracheck, Apple's own):
     gathered across the four metrics first, then written once per day */
  const foodDays = {};
  /* Weight and BMI per day: the day's last reading of each, written once per day (see after the loop) */
  const bodyDays = {};

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
        await fs.merge(hp(hid, 'exercise/' + day), { day: strVal(day), steps: intVal(steps), addedBy: strVal('Apple Health'), updatedAt: nowTs() });
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
        const existing = await fs.get(hp(hid, 'entries/' + day + '_sleep'));
        if (!existing) fields.createdAt = nowTs();
        await fs.merge(hp(hid, 'entries/' + day + '_sleep'), fields);
        result.sleep++;
      }
    } else if (WEIGHT_METRICS.includes(name) || BMI_METRICS.includes(name)) {
      /* Weight (kg whatever unit Health used: lb and st converted) and BMI: the latest reading of each day */
      const isBmi = BMI_METRICS.includes(name);
      const units = String(m.units || 'kg').toLowerCase().trim();
      const perUnit = isBmi ? 1 : /^(lb|lbs|pounds?)$/.test(units) ? 0.45359237 : /^(st|stone)$/.test(units) ? 6.35029318 : /^g$/.test(units) ? 0.001 : 1;
      for (const r of rows) {
        const day = dayOf(r.date);
        const qty = Number(r.qty) * perUnit;
        if (!day || !isFinite(qty) || qty <= 0) continue;
        if (isBmi ? (qty < 10 || qty > 80) : (qty < 20 || qty > 300)) { result.skipped.push(name + ' ' + day + ' (out of range)'); continue; }
        const b = bodyDays[day] = bodyDays[day] || {};
        const at = toIso(r.date) || day + 'T08:00:00Z';
        const k = isBmi ? 'bmi' : 'kg';
        if (!b[k] || Date.parse(at) >= Date.parse(b[k].at)) b[k] = { v: qty, at };
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
  /* Workouts (walks, swims, anything logged on the watch or phone): the day's list, replaced on each send.
     Distances are stored in km whatever unit Health used (pool swims come in metres or yards).
     Health Auto Export sends them under data.workouts when Workouts is ticked in the automation. */
  const workouts = (body.data && Array.isArray(body.data.workouts)) ? body.data.workouts : [];
  const workoutDays = {};
  for (const w of workouts) {
    const day = dayOf(w.start || w.date);
    if (!day) continue;
    const startMs = Date.parse(toIso(w.start) || ''), endMs = Date.parse(toIso(w.end) || '');
    let minutes = isFinite(startMs) && isFinite(endMs) && endMs > startMs ? (endMs - startMs) / 60000 : Number(w.duration) || 0;
    if (!(isFinite(startMs) && isFinite(endMs) && endMs > startMs) && minutes > 600) minutes = minutes / 60; // a bare duration that large is seconds
    const item = { name: strVal(String(w.name || w.workoutActivityType || 'Workout').slice(0, 60)), minutes: intVal(Math.round(minutes)) };
    const km = distanceKm(w.distance || w.swimDistance || w.totalDistance);
    if (km > 0) item.km = doubleVal(km);
    const kcal = w.activeEnergyBurned && Number(w.activeEnergyBurned.qty);
    if (isFinite(kcal) && kcal > 0) item.kcal = intVal(Math.round(kcal));
    const st = hhmm(w.start);
    if (st) item.start = strVal(st);
    (workoutDays[day] = workoutDays[day] || []).push({ mapValue: { fields: item } });
  }
  for (const [day, list] of Object.entries(workoutDays)) {
    await fs.merge(hp(hid, 'exercise/' + day), { day: strVal(day), workouts: { arrayValue: { values: list } }, addedBy: strVal('Apple Health'), updatedAt: nowTs() });
    result.workouts++;
  }
  for (const [day, totals] of Object.entries(foodDays)) {
    const fields = { day: strVal(day), source: strVal('apple-health'), addedBy: strVal('Apple Health'), updatedAt: nowTs() };
    for (const k of ['kcal', 'prot', 'carb', 'fat']) if (totals[k] > 0) fields[k] = doubleVal(Math.round(totals[k] * 10) / 10);
    await fs.merge(hp(hid, 'nutrition/' + day), fields);
    result.nutrition++;
  }
  /* Weight entries from Apple Health: one per day, entries/{day}_weight (deterministic, so re-sends update it),
     a type "weight" entry like one typed in, with the day's BMI on it when Health has one. A BMI on a day with
     no weight in this send is added to that day's existing entry, or left out until a weight arrives. */
  for (const [day, b] of Object.entries(bodyDays)) {
    const path = hp(hid, 'entries/' + day + '_weight');
    const existing = await fs.get(path);
    if (!b.kg && !existing) { result.skipped.push('bmi ' + day + ' (no weight that day)'); continue; }
    const fields = { day: strVal(day), type: strVal('weight'), addedBy: strVal('Apple Health'), source: strVal('health-auto-export'), updatedAt: nowTs() };
    if (b.kg) { fields.value = doubleVal(Math.round(b.kg.v * 10) / 10); fields.at = tsVal(b.kg.at); }
    if (b.bmi) fields.bmi = doubleVal(Math.round(b.bmi.v * 10) / 10);
    if (!existing) fields.createdAt = nowTs();
    await fs.merge(path, fields);
    result.weight++;
  }
  await fs.merge(hp(hid, 'bridge/last'), { result: strVal(JSON.stringify(result)) });
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
        (body.documents || []).forEach((d) => out.push({ id: d.name.split('/').pop(), path: d.name.split('/documents/')[1], fields: d.fields || {} }));
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    /* Documents matching equality filters, e.g. query('entries', { day: '2026-09-28', type: 'med' }) */
    /* The path may be a subcollection ("households/abc/entries"): the last segment is the collection, the rest its parent document */
    async query(collection, where) {
      const segs = collection.split('/');
      const collectionId = segs.pop();
      const parent = segs.length ? '/' + segs.join('/') : '';
      const filters = Object.entries(where).map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: String(value) } } }));
      const structuredQuery = { from: [{ collectionId }], where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } }, limit: 500 };
      const r = await fetch(base.replace(/\/$/, '') + parent + ':runQuery', { method: 'POST', headers, body: JSON.stringify({ structuredQuery }) });
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
/* Gentle nudge (v83): one notification at 10:00 London time when the household has switched it on
   (profile/main.stretchNudge) and nothing has been logged on the Exercise tab that day: no exercise entry
   from the picker and no programme stretch ticked. Sent once a day, within the same 20 minute window. */
const STRETCH_NUDGE_AT = 10 * 60;
function stretchNudgeDue({ minutes, nudgeOn, exerciseLogged, stretchTicked, alreadySent }) {
  if (!nudgeOn || alreadySent) return false;
  if (minutes < STRETCH_NUDGE_AT || minutes >= STRETCH_NUDGE_AT + REMINDER_WINDOW_MIN) return false;
  return !exerciseLogged && !stretchTicked;
}
/* Whether any programme item in the stretch section due that weekday is ticked in exercise/{day}.done */
function stretchTickedOn(profileFields, exerciseFields, day) {
  try {
    const items = ((((profileFields || {}).programme || {}).mapValue || {}).fields || {}).items;
    const list = items && items.arrayValue ? (items.arrayValue.values || []) : [];
    const done = ((((exerciseFields || {}).done || {}).mapValue || {}).fields) || {};
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
    return list.some((v) => {
      const fl = (v.mapValue || {}).fields || {};
      if (f(fl, 'section') !== 'stretch') return false;
      const days = f(fl, 'days') || [];
      if (days.length && !days.map(Number).includes(weekday)) return false;
      const id = f(fl, 'id');
      return !!(id && done[id] && done[id].booleanValue === true);
    });
  } catch (e) { return false; }
}

/* Local wall-clock time in London as { day: 'YYYY-MM-DD', minutes: since midnight } */
function londonNow(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date || new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10) };
}
const toMinutes = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; };
const f = (fields, k) => { const v = fields[k]; if (!v) return null; return v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? (v.arrayValue ? (v.arrayValue.values || []).map((x) => x.stringValue ?? x.integerValue ?? x.doubleValue) : null); };

function isPrivateSub(sub) { return f(sub.fields, 'private') !== false; }
function payloadFor(sub, payload, privateBody) { return privateBody && isPrivateSub(sub) ? { ...payload, body: privateBody } : payload; }

/* Every household in turn; a phone only ever hears about its own household's medicines */
async function runReminders(env) {
  if (!env.VAPID_PRIVATE_KEY) return { skipped: 'VAPID_PRIVATE_KEY is not set' };
  const fs = await firestore(env);
  const households = await fs.list('households');
  const out = {};
  for (const hh of households) out[hh.id] = await runHouseholdReminders(env, fs, hh.id);
  return { households: households.length, ...out };
}
async function runHouseholdReminders(env, fs, hid) {
  const subs = await fs.list(hp(hid, 'pushSubs'));
  if (!subs.length) return { skipped: 'no phones have reminders on' };
  const now = londonNow();
  const logDoc = await fs.get(hp(hid, 'bridge/reminderLog'));
  const lf = logDoc ? logDoc.fields : {};
  const sent = f(lf, 'day') === now.day && lf.sent && lf.sent.mapValue ? Object.keys(lf.sent.mapValue.fields || {}) : [];
  const sentSet = new Set(sent);
  const profile = await fs.get(hp(hid, 'profile/main')); // read for the 10:00 exercise nudge
  const medicines = (await fs.list(hp(hid, 'medicines'))).filter((m) => f(m.fields, 'active') !== false && f(m.fields, 'kind') !== 'prn' && (!f(m.fields, 'courseEnd') || f(m.fields, 'courseEnd') >= now.day));
  const doses = await fs.query(hp(hid, 'entries'), { day: now.day, type: 'med' });
  const doseMinutes = (medId) => doses.filter((d) => f(d.fields, 'medId') === medId).map((d) => londonNow(new Date(f(d.fields, 'at'))).minutes);
  const out = [];
  /* A private phone (pushSubs/{id}.private, true unless switched off) gets the same notification without the medicine's name or dose */
  const send = async (key, payload, privateBody) => {
    for (const sub of subs) out.push({ key, phone: sub.id, private: isPrivateSub(sub), result: await sendPush(env, fs, sub, payloadFor(sub, payload, privateBody)) });
    sentSet.add(key);
  };
  for (const m of medicines) {
    if (f(m.fields, 'hospital') === true) continue; // given by the nurses: no reminders
    const times = (f(m.fields, 'times') || []).map(toMinutes).filter((t) => t != null);
    const name = f(m.fields, 'name') || 'Medicine', dose = f(m.fields, 'dose') || '';
    const taken = doseMinutes(m.id);
    for (const t of times) {
      const key = `${m.id}|${t}`;
      const takenSince = taken.some((x) => x >= t - LOGGED_BEFORE_MIN);
      if (!sentSet.has(key) && now.minutes >= t && now.minutes < t + REMINDER_WINDOW_MIN && !takenSince) {
        await send(key, { title: 'Daybook', body: `${name} ${dose} is due`.trim(), tag: key, url: appUrl('meds') }, 'A medicine is due');
      }
      const nudgeKey = key + '|nudge';
      if (!sentSet.has(nudgeKey) && now.minutes >= t + NUDGE_AFTER_MIN && now.minutes < t + NUDGE_AFTER_MIN + REMINDER_WINDOW_MIN && !takenSince) {
        await send(nudgeKey, { title: 'Daybook', body: `Still to take: ${name} ${dose}`.trim(), tag: nudgeKey, url: appUrl('meds') }, 'A medicine is still to take');
      }
    }
  }
  /* The gentle nudge at 10:00, household-wide, no medicine named, so the same body for a private phone */
  const nudgeKey = 'stretch|' + now.day;
  if (now.minutes >= STRETCH_NUDGE_AT && now.minutes < STRETCH_NUDGE_AT + REMINDER_WINDOW_MIN && !sentSet.has(nudgeKey)) {
    const nudgeOn = !!(profile && f(profile.fields, 'stretchNudge') === true);
    if (nudgeOn) {
      const exEntries = await fs.query(hp(hid, 'entries'), { day: now.day, type: 'exercise' });
      const exDoc = await fs.get(hp(hid, 'exercise/' + now.day));
      const due = stretchNudgeDue({ minutes: now.minutes, nudgeOn, exerciseLogged: exEntries.length > 0, stretchTicked: stretchTickedOn(profile.fields, exDoc ? exDoc.fields : null, now.day), alreadySent: false });
      if (due) await send(nudgeKey, { title: 'Daybook', body: 'Your gentle exercises are there if you feel up to them. No pressure.', tag: nudgeKey, url: appUrl('exercise') }, null);
    }
  }
  /* One-off reminders from the app ("Remind me in 15 minutes" after a meal) */
  const oneOffs = await fs.list(hp(hid, 'reminders'));
  for (const r of oneOffs) {
    if (f(r.fields, 'sent') === true) { if (new Date(f(r.fields, 'at')).getTime() < Date.now() - 86400000) await fs.remove(hp(hid, 'reminders/' + r.id)); continue; }
    if (new Date(f(r.fields, 'at')).getTime() > Date.now()) continue;
    await send('oneoff|' + r.id, { title: 'Daybook', body: `Reminder: ${f(r.fields, 'medName') || 'medicine'} ${f(r.fields, 'dose') || ''}`.trim(), tag: 'oneoff|' + r.id, url: appUrl('meds') }, 'Reminder: a medicine to take');
    await fs.merge(hp(hid, 'reminders/' + r.id), { sent: { booleanValue: true } });
  }
  await fs.set(hp(hid, 'bridge/reminderLog'), { day: strVal(now.day), at: { timestampValue: new Date().toISOString() }, sent: { mapValue: { fields: Object.fromEntries([...sentSet].map((k) => [k, { booleanValue: true }])) } } });
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
    if (r.status === 404 || r.status === 410) { await fs.remove(subDoc.path || ('pushSubs/' + subDoc.id)); return 'gone, removed'; }
    if (!r.ok) return 'push service ' + r.status + ' ' + (await r.text()).slice(0, 120);
    return 'sent';
  } catch (e) { return 'error ' + (e && e.message || e); }
}

/* Firestore's typed JSON */
const strVal = (v) => ({ stringValue: String(v) });
const intVal = (v) => ({ integerValue: String(Math.round(v)) });
const doubleVal = (v) => ({ doubleValue: Number(v) });
/* Health Auto Export metric names for the day's food totals, and the field each lands in (nutrition/{day}) */
/* A Health distance { qty, units } in km, to the metre: km, miles, metres, yards and feet */
function distanceKm(d) {
  const qty = d && Number(d.qty);
  if (!isFinite(qty) || qty <= 0) return 0;
  const u = String(d.units || 'km').toLowerCase().trim();
  const perUnit = /^mi/.test(u) ? 1.609344 : /^(m|meters?|metres?)$/.test(u) ? 0.001 : /^(yd|yds|yards?)$/.test(u) ? 0.0009144 : /^(ft|feet|foot)$/.test(u) ? 0.0003048 : 1;
  return Math.round(qty * perUnit * 1000) / 1000;
}

/* Health Auto Export metric names for body weight and body mass index (lower-cased) */
const WEIGHT_METRICS = ['weight_body_mass', 'body_mass', 'weight'];
const BMI_METRICS = ['body_mass_index', 'bmi'];
const NUTRITION = { dietary_energy: 'kcal', active_energy_dietary: 'kcal', protein: 'prot', carbohydrates: 'carb', total_fat: 'fat' };
const tsVal = (iso) => ({ timestampValue: new Date(iso).toISOString() });
const nowTs = () => ({ timestampValue: new Date().toISOString() });

/* ------------------------------------------------------------------ */
/* Explain in Daybook: a plain English explanation or a list of questions */
/* ------------------------------------------------------------------ */
/* The app sends the signed-in person's Firebase ID token (Authorization: Bearer). The bridge
   checks the token against Google's public keys, accepts the real project (family accounts
   only, read from users/{uid}) and the shared demo project (any signed-in guest), keeps a
   daily count in bridge/explainLog so a bug or a busy demo day cannot run the credit down,
   and calls the Messages API over plain fetch: no SDK, no dependency, the key never leaves
   here. Nothing about the letter is stored; the reply goes straight back to the phone. */

const EXPLAIN_MODEL = 'claude-opus-5-5';
const EXPLAIN_MAX_TOKENS = 4000;             // a letter's explanation or a question list; also the cost cap per call
const EXPLAIN_LIMIT_REAL = 40;               // calls a day per household on the real project
const EXPLAIN_LIMIT_DEMO = 12;               // calls a day from the shared demo (its guest sign-in is public)
const DEMO_HOUSEHOLD = 'demo';               // the demo project's one household (DEMO_HOUSEHOLD in scripts.js)
const EXPLAIN_MAX_PAGES = 8;
const EXPLAIN_MAX_PAGE_CHARS = 1300000;      // base64 JPEG per page (the app keeps pages under 900 KB)
const EXPLAIN_MAX_TEXT_CHARS = 60000;

const EXPLAIN_SYSTEM = {
  document: 'You explain medical letters, results and documents to a patient and their family in plain, calm UK English. ' +
    'Say what the document says, what it means for day-to-day care, anything that needs doing and by when, and end with a short list headed "Worth asking the team:" of questions they might raise. ' +
    'Short paragraphs, everyday words, no jargon without a plain explanation in brackets, no em dashes, no headings other than that one, no preamble and no sign-off. ' +
    'Do not guess at anything the document does not say. Do not give medical advice or reassurance the document does not support; if something looks urgent, say clearly that they should contact the team. ' +
    'Reply with the explanation only, ready to be shown in the app as it is.',
  programme: 'You read exercise sheets and physiotherapy plans from photos (printed or handwritten), PDF pages or pasted text, for a patient who is recording them in an app. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"from": string or null, "given": "YYYY-MM-DD" or null, "physio": true or false, "notes": string, "items": [{"name": string, "kind": "reps" or "seconds" or "minutes" or "sets" or "lengths" or "distance" or "do", "amount": number, "sets": number or null, "pool": number or null, "unit": "km" or "m" or null, "time": number or null, "days": [numbers 0 to 6, 0 = Sunday] or null, "note": string}]}. ' +
    '"from" is who gave the plan (a physiotherapist, a service), "given" the date on it, "physio" true when it is a physiotherapy plan, "notes" the general instructions on the sheet in one or two plain UK English sentences, or an empty string. ' +
    'One item per exercise, in the order on the sheet. "sets" means sets of repetitions and amount is then the reps per set. "lengths" is swimming lengths: amount is the number of lengths and pool the pool length in metres (25 if not stated). "distance" is a distance to cover: amount in the unit given by "unit". "time" is a target time in minutes for a lengths or distance item, or null. Use "do" with amount 1 for an exercise with no count. days is null when it is every day. Put frequency such as "twice a day" and any holds or cautions in the item note. Leave out anything that is not an exercise. No em dashes.',
  medicine: 'You read a photo of a medicine for a patient recording it in an app: a hospital drip bag, a box, a bottle, a blister pack or a pharmacy dispensing label. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"name": string, "amount": string or null, "route": "drip" or "injection" or "mouth" or "skin" or "inhaled" or "other" or null, "how": string or null, "purpose": string or null, "whenNeeded": true or false, "perDay": number or null, "maxPerDay": number or null, "minGapHours": number or null}. ' +
    '"name" is the medicine as a patient would say it, with its strength when that is part of the name ("Sodium chloride 0.9%", "Paracetamol 500 mg"). "amount" is the amount in one dose or in the container ("1000 ml", "2 tablets"). "route" is how it is given: drip for an intravenous infusion bag. ' +
    '"how" is the directions on a dispensing label in plain UK English, or null when there are none (a hospital bag or a manufacturer\'s box has none). "purpose" only if it is printed. "whenNeeded" true only when the label says when needed or as required. perDay, maxPerDay and minGapHours only when the directions give them. ' +
    'Never guess anything that is not printed: use null. No em dashes.',
  weekly: 'You summarise a patient\'s own care notes, written day by day in a health app, so their oncologist or specialist nurse can read them in a minute before an appointment, in plain UK English. ' +
    'The notes come grouped by week, each group headed "Week from YYYY-MM-DD". For each week give two to four short points of what stood out: symptoms and how bad they were, anything new or changing, anything the patient or carer was worried about. Keep their own words where they are clear. Leave out routine answers such as "nothing new". ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"weeks": [{"from": "YYYY-MM-DD", "points": [string]}]}, one entry per week given, in the same order, "from" copied from its heading. Each point under 20 words. ' +
    'Do not add advice, interpretation, diagnosis or reassurance, and do not add anything the notes do not say. No em dashes.',
  mood: 'You write the Mood and wellbeing report a patient hands to a therapist, counsellor or GP, from the scores and notes they logged day by day in a health app, in plain UK English, in the first person about the patient by name as given. ' +
    'You are given the period, the conditions the app is set up for, then one line per day (mood morning and evening out of 10; worst pain out of 10; hours slept; three evening taps, felt low, worried or on edge and enjoyed something, each 0 not at all to 3 a lot; treatment sessions; days in hospital) with that day\'s notes under it (what is behind the mood, how rested, how was today, one good thing), then the weekly checks. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"brief": [{"head": "Overall", "text": string}, {"head": "What lifted mood", "text": string}, {"head": "What pulled it down", "text": string}, {"head": "Sleep and pain", "text": string}], "quotes": [{"when": "D Mon, morning" or "D Mon, evening", "text": string, "low": true or false}], "helped": [{"head": string, "text": string}], "hardest": [{"head": string, "text": string}]}. ' +
    'The four brief paragraphs are each under 70 words and only say what the scores and notes show: patterns over the period, the swings and what went with them, with dates. Quotes: the three notes that best carry how the person felt (one of them from a low day if there was one), each under 45 words, tidied for dictation and typing slips with the meaning and the person\'s own phrasing kept, never rewritten into other words and never invented; "low" is true when that day\'s mood was 4 or under. helped and hardest: up to four themes each, head of two to four words, text under 25 words, drawn from the notes and the weekly checks, naming days or counts where they help. ' +
    'Never diagnose, advise, reassure or interpret beyond what was written; no medical terms the person did not use; no em dashes; UK English.',
  pain: 'You write the brief at the top of the Pain and pain relief report a patient hands to their pain nurse or pain team, from the pain scores, the words written under them and the pain relief doses they logged day by day in a health app, in plain UK English, about the patient by name as given. ' +
    'You are given the period, the pain relief medicines on the list, then one line per day (pain right now out of 10 at the morning check-in, the evening check-in and any readings between times; the worst pain that day out of 10; every pain relief dose with its time, regular ones marked; hours slept; treatment sessions; days in hospital) with that day\'s words under it, each with where in the day it was written and the score it came with. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"brief": [{"head": "Overall", "text": string}, {"head": "Where and when", "text": string}, {"head": "Pain relief", "text": string}, {"head": "Sleep", "text": string}]}. ' +
    'Each paragraph is under 70 words and only says what the scores, words and doses show, with dates: Overall, the level over the period, the range, the days at 7 or more and whether the second half differed from the first; Where and when, where the pain was and what made it better or worse in the patient\'s own words, and the time of day it ran highest; Pain relief, what was taken, how often, whether a daily maximum was reached, and anything the words say about whether it helped; Sleep, the nights, short nights and whether they fell beside days of high pain. Use the patient\'s own phrases for where and how the pain felt, tidied for dictation slips with the meaning kept, never invented. ' +
    'Never diagnose, advise, reassure, suggest a change of medicine or interpret beyond what was written; no medical terms the person did not use; no em dashes; UK English.',
  report: 'You prepare the notes part of a two-page summary a patient hands to their oncologist or specialist nurse, from the patient\'s and carer\'s own care notes written day by day in a health app, in plain UK English. ' +
    'You are given the report period, the medicines on the list, the open questions for the team and the notes, grouped into weeks headed "Week N, YYYY-MM-DD to YYYY-MM-DD", each note with who wrote it, the date and time. ' +
    'For each week write one theme sentence under 20 words summarising the week, then at most six short dated entries in date order, each one to three short lines (under 40 words). Summarise, do not copy every note: merge days with similar content into one entry with a "to" date, leave out routine answers such as "nothing new", keep the patient\'s meaning and their own words where they are clear, and where the patient raised a question inside a note keep it as a question. Mark an entry alert when it records a new or worsening symptom, a hospital visit or admission, or a high reading the note itself mentions. ' +
    'Latest: if the single most recent note in the period describes a new or worsening symptom, give it as a title under 10 words and a text under 35 words with its day and time; otherwise null. ' +
    'Questions: return each open question with only its spelling, obvious typos and punctuation corrected, in UK English, keeping the person\'s own wording and every part of it; never shorten or merge them. ' +
    'Correct misspelt or misheard medicine names everywhere to the standard name (for example dakteparun to dalteparin, oromorph to Oramorph, Diazipam to diazepam), with generic names in lower case and brand names capitalised. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"latest": {"day": "YYYY-MM-DD", "time": "HH:MM", "title": string, "text": string} or null, "weeks": [{"from": "YYYY-MM-DD", "theme": string, "entries": [{"day": "YYYY-MM-DD", "to": "YYYY-MM-DD" or null, "text": string, "alert": boolean}]}], "questions": [{"n": number, "text": string}]}, one week entry per week given, "from" copied from its heading. ' +
    'Do not add advice, interpretation, diagnosis or reassurance, and nothing the notes do not say. Dates as "5 Oct". No em dashes.',
  notes: 'You turn a patient\'s care notes into a short, clear list of questions to ask their oncologist or specialist nurse at the next appointment, in plain UK English. ' +
    'Read the questions already listed, the summary and the day notes. Reply with a numbered list of at most eight questions, one per line, most important first, each specific to what the notes actually show and short enough to ask in a ten-minute appointment. ' +
    'Do not repeat a question the person has already written down. No preamble, no explanation, no headings, no em dashes, nothing after the list.'
};

/* Who is asking: the Firebase ID token in the Authorization header, checked against Google's keys.
   Returns { who: { uid, project }, demo, fs, sa } or a Response to send straight back. */
async function whoIs(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!idToken) return { error: json({ error: 'unauthorised', message: 'Sign in first.' }, 401) };
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const projects = [sa.project_id, env.DEMO_PROJECT_ID].filter(Boolean);
  let who;
  try { who = await verifyFirebaseToken(idToken, projects); }
  catch (e) { return { error: json({ error: 'unauthorised', message: 'Could not check who you are. Sign out and in again.' }, 401) }; }
  const demo = !!env.DEMO_PROJECT_ID && who.project === env.DEMO_PROJECT_ID && who.project !== sa.project_id;
  const fs = await firestore(env);
  return { who, demo, fs, sa };
}
async function readJson(request) { try { return await request.json(); } catch (e) { return null; } }
const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const ROLES = ['family', 'readonly', 'viewer'];
const relationOf = (r) => (['patient', 'carer'].includes(r) ? r : '');
const INVITE_DAYS = 7;
const HOUSEHOLDS_A_DAY = 20; // new households a day across everyone, so a bored stranger cannot fill the free tier
function randomCode() { const b = new Uint8Array(18); crypto.getRandomValues(b); return b64url(b); }
async function memberOf(fs, uid) {
  const rec = await fs.get('users/' + uid);
  const hid = rec && f(rec.fields, 'household');
  if (!hid) return { hid: null };
  const mem = await fs.get(hp(hid, 'members/' + uid));
  return { hid, role: mem ? f(mem.fields, 'role') : null, name: mem ? f(mem.fields, 'name') : null };
}

/* Beta codes (since v152): while BETA_CODES_REQUIRED is set in wrangler.toml, a new household needs a code from
   betaCodes/{CODE} { label, active, uses, createdAt, lastUsedAt } (made with the Household admin workflow,
   one per route in: a ward, a clinic, a WhatsApp group), so Mark knows where each Beta circle came from
   without knowing anyone's name in advance. Joining an existing household with an invite needs no code.
   The code is stored on the household with "who told you" (heardFrom), both free text for Mark's own eyes. */
const BETA_CODE_MESSAGE = 'The Beta is by invitation. Type the Beta code from whoever told you about Daybook, or email support@mymedicaldaybook.co.uk and say who that was.';
const normaliseBetaCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
async function betaCodeRecord(fs, code) {
  if (!code) return null;
  const rec = await fs.get('betaCodes/' + code);
  if (!rec || f(rec.fields, 'active') === false) return null;
  return { code, label: f(rec.fields, 'label') || '', uses: Number(f(rec.fields, 'uses') || 0) };
}
/* GET /beta-info?code=: whether a Beta code in a link is good, and whose it is, shown on the sign-up screen before anyone types */
async function handleBetaInfo(url, env) {
  if (!env.BETA_CODES_REQUIRED) return json({ required: false, valid: true });
  const fs = await firestore(env);
  const rec = await betaCodeRecord(fs, normaliseBetaCode(url.searchParams.get('code')));
  return json(rec ? { required: true, valid: true, label: rec.label } : { required: true, valid: false, message: BETA_CODE_MESSAGE });
}

/* Tell Mark what you think (v153, the Beta feedback). POST /feedback { kind "note"|"survey", text, image? (base64 JPEG),
   answers? (the first-day questions), screen, version, device }: any member of a household, written by the service
   account to the top-level feedback/{id} collection, which the rules deny to everyone, so only Mark reads it (the Firebase
   console for now). Then one push to every phone in the operator's household (the one BRIDGE_KEY is the inbox key of),
   naming nothing from the feedback itself. FEEDBACK_A_DAY per household keeps a stuck finger from filling the free tier. */
const FEEDBACK_A_DAY = 40;
const FEEDBACK_IMAGE_CHARS = 900000;
async function handleFeedback(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Feedback is not taken from the demo. Email support@mymedicaldaybook.co.uk instead.' }, 403);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid || !me.role) return json({ error: 'unauthorised', message: 'This sign-in is not in a Daybook household.' }, 403);
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const kind = body.kind === 'survey' ? 'survey' : 'note';
  const text = String(body.text || '').trim().slice(0, 4000);
  const image = typeof body.image === 'string' && /^[A-Za-z0-9+/=]+$/.test(body.image) ? body.image.slice(0, FEEDBACK_IMAGE_CHARS) : '';
  const answers = body.answers && typeof body.answers === 'object' ? JSON.stringify(body.answers).slice(0, 4000) : '';
  if (!text && !image && !answers) return json({ error: 'bad-request', message: 'Say something first, or add a picture.' }, 400);
  const day = londonNow().day;
  const logDoc = await fs.get(hp(me.hid, 'bridge/feedbackLog'));
  const logFields = logDoc ? logDoc.fields : {};
  const count = f(logFields, 'day') === day ? Number(f(logFields, 'count') || 0) : 0;
  if (count >= FEEDBACK_A_DAY) return json({ error: 'limit', message: 'That is plenty for one day, thank you. Email support@mymedicaldaybook.co.uk if it cannot wait.' }, 429);
  await fs.set(hp(me.hid, 'bridge/feedbackLog'), { day: strVal(day), count: intVal(count + 1), updatedAt: nowTs() });
  const id = randomCode().slice(0, 20);
  const rec = { household: strVal(me.hid), uid: strVal(who.uid), name: strVal(me.name || ''), role: strVal(me.role), kind: strVal(kind), text: strVal(text), screen: strVal(clean(body.screen, 80)), version: strVal(clean(body.version, 12)), device: strVal(clean(body.device, 160)), at: nowTs() };
  if (image) rec.image = strVal(image);
  if (answers) rec.answers = strVal(answers);
  await fs.set('feedback/' + id, rec);
  /* a push to Mark's phones (never the sender's own household, so his and Shelley's tests do not ping him) */
  let pushed = 0;
  if (env.VAPID_PRIVATE_KEY && env.BRIDGE_KEY) {
    const opHid = await householdForKey(fs, env.BRIDGE_KEY);
    if (opHid && opHid !== me.hid) {
      const subs = await fs.list(hp(opHid, 'pushSubs'));
      for (const sub of subs) { const r = await sendPush(env, fs, sub, { title: 'Daybook feedback', body: kind === 'survey' ? 'A Beta circle has answered the first-day questions.' : 'New feedback from a Beta circle.', tag: 'feedback', url: appUrl() }); if (r === 'sent') pushed++; }
    }
  }
  return json({ ok: true, id, pushed });
}
/* POST /feedback-info: how else to reach Mark during the Beta; the phone number is a Worker secret, shown to signed-in members only */
async function handleFeedbackInfo(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  return json({ email: 'support@mymedicaldaybook.co.uk', phone: a.demo ? null : (env.BETA_PHONE || null) });
}

/* Send to the team, sent by Daybook (v159). POST /send-report { kind, to, toName, subject, text, filename, pdf (base64),
   fromName }: a family member's report goes out by email from SEND_FROM ("Mark Brown via My Medical Daybook"), through
   Resend (the RESEND_API_KEY secret; without it the route answers "not switched on yet" and the app offers the share
   sheet), with the sender's own sign-in email as the reply address and in copy, so a clinic's reply comes straight back
   to the patient and never to a Mark 1 Apps inbox. Nothing of the report is kept here; the app writes its own "sent"
   record in the household. SEND_A_DAY per household keeps a stuck finger off the free tier. Mark's ask of 13 October
   2026: one tap, the PDF attached, no Mail app hop (a web app cannot attach a file to a mailto: link, and the share
   sheet cannot fill in the recipient, which was why the old route took two hops). */
const SEND_FROM = 'reporting@mymedicaldaybook.co.uk';
const SEND_A_DAY = 20;
const SEND_PDF_CHARS = 8000000; // about 6 MB of PDF; the reports are about 1 MB
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function handleSendReport(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'The demo cannot send email. Use Send from my own Mail app.' }, 403);
  if (!env.RESEND_API_KEY) return json({ error: 'not-set-up', message: 'Sending from Daybook is not switched on yet. Use Send from my own Mail app.' }, 503);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid || !me.role) return json({ error: 'unauthorised', message: 'This sign-in is not in a Daybook household.' }, 403);
  if (me.role !== 'family') return json({ error: 'unauthorised', message: 'Only a family member can send a report.' }, 403);
  if (!who.email || !EMAIL_RE.test(who.email)) return json({ error: 'no-email', message: 'This sign-in has no email address for replies to go to.' }, 400);
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const to = clean(body.to, 120).toLowerCase();
  if (!EMAIL_RE.test(to)) return json({ error: 'bad-request', message: 'Check the email address of the contact.' }, 400);
  const pdf = typeof body.pdf === 'string' && /^[A-Za-z0-9+/=]+$/.test(body.pdf) ? body.pdf : '';
  if (!pdf) return json({ error: 'bad-request', message: 'The PDF did not arrive. Try again.' }, 400);
  if (pdf.length > SEND_PDF_CHARS) return json({ error: 'too-large', message: 'That PDF is too large to email. Use a shorter range.' }, 413);
  const toName = clean(body.toName, 80);
  const subject = clean(body.subject, 150) || 'Notes from My Medical Daybook';
  const text = String(body.text || '').replace(/\r/g, '').trim().slice(0, 6000);
  const filename = clean(body.filename, 90).replace(/[^\w .()-]/g, '') || 'Daybook report.pdf';
  const fromName = clean(body.fromName, 60) || me.name || 'A Daybook member';
  const kind = clean(body.kind, 12);
  const day = londonNow().day;
  const logDoc = await fs.get(hp(me.hid, 'bridge/sendLog'));
  const logFields = logDoc ? logDoc.fields : {};
  const count = f(logFields, 'day') === day ? Number(f(logFields, 'count') || 0) : 0;
  if (count >= SEND_A_DAY) return json({ error: 'limit', message: 'That is the limit of emails for one day. Use Send from my own Mail app for the rest.' }, 429);
  await fs.set(hp(me.hid, 'bridge/sendLog'), { day: strVal(day), count: intVal(count + 1), updatedAt: nowTs() });
  const from = `${fromName.replace(/["<>]/g, '')} via My Medical Daybook <${env.SEND_FROM || SEND_FROM}>`;
  let r, data = null;
  try {
    r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [toName ? `${toName.replace(/["<>,]/g, '')} <${to}>` : to], cc: [who.email], reply_to: who.email, subject, text, attachments: [{ filename, content: pdf }], headers: { 'X-Entity-Ref-ID': randomCode().slice(0, 16) } }) });
    try { data = await r.json(); } catch (e) { data = null; }
  } catch (e) {
    console.error('send-report: no reach', e && e.message);
    return json({ error: 'unreachable', message: 'The email service could not be reached. Try again, or use Send from my own Mail app.' }, 502);
  }
  if (!r.ok) {
    console.error('send-report: refused', r.status, data && (data.message || data.name));
    const why = r.status === 401 || r.status === 403 ? 'the sending key was not accepted' : r.status === 422 ? 'the email service refused it' : r.status === 429 ? 'the email service is busy' : 'the email service said ' + r.status;
    return json({ error: 'refused', message: `Could not send (${why}). Use Send from my own Mail app for now.` }, 502);
  }
  return json({ ok: true, id: (data && data.id) || null, to, copyTo: who.email, at: new Date().toISOString(), kind });
}

/* POST /household { name, relation, householdName?, betaCode?, heardFrom? }: a sign-in with no household makes its own and becomes its family owner */
async function handleCreateHousehold(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'The demo has one shared household.' }, 403);
  const { who, fs } = a;
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const name = clean(body.name, 40);
  if (!name) return json({ error: 'bad-request', message: 'A first name is needed.' }, 400);
  const current = await memberOf(fs, who.uid);
  if (current.hid) return json({ error: 'already', message: 'This sign-in is already in a household.', household: current.hid }, 409);
  const betaCode = normaliseBetaCode(body.betaCode);
  let beta = null;
  if (env.BETA_CODES_REQUIRED) {
    beta = await betaCodeRecord(fs, betaCode);
    if (!beta) return json({ error: 'beta', message: BETA_CODE_MESSAGE }, 400);
  }
  const heardFrom = clean(body.heardFrom, 80);
  const day = londonNow().day;
  const g = await fs.get('bridge/global');
  const made = g && f(g.fields, 'day') === day ? Number(f(g.fields, 'households') || 0) : 0;
  if (made >= HOUSEHOLDS_A_DAY) return json({ error: 'limit', message: 'Daybook cannot take more new households today. Try again tomorrow.' }, 429);
  await fs.set('bridge/global', { day: strVal(day), households: intVal(made + 1), updatedAt: nowTs() });
  const hid = randomCode().slice(0, 20);
  const house = { name: strVal(clean(body.householdName, 60) || name), owner: strVal(who.uid), createdAt: nowTs() };
  if (beta) house.betaCode = strVal(beta.code);
  if (heardFrom) house.heardFrom = strVal(heardFrom);
  await fs.set('households/' + hid, house);
  await fs.set(hp(hid, 'members/' + who.uid), { name: strVal(name), role: strVal('family'), relation: strVal(relationOf(body.relation)), addedBy: strVal('sign-up'), addedAt: nowTs() });
  await fs.merge('users/' + who.uid, { household: strVal(hid), name: strVal(name) });
  if (beta) await fs.merge('betaCodes/' + beta.code, { uses: intVal(beta.uses + 1), lastUsedAt: nowTs() });
  return json({ ok: true, household: hid });
}

/* POST /invite { name, role, relation }: a family member makes a one-use link that expires in a week */
async function handleInvite(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Invites are not available in the demo.' }, 403);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid || me.role !== 'family') return json({ error: 'unauthorised', message: 'Only family members can invite someone.' }, 403);
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const role = ROLES.includes(body.role) ? body.role : 'readonly';
  const name = clean(body.name, 40);
  const code = randomCode();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
  const house = await fs.get('households/' + me.hid);
  await fs.set(hp(me.hid, 'invites/' + code), { name: strVal(name), role: strVal(role), relation: strVal(relationOf(body.relation)), createdBy: strVal(who.uid), createdByName: strVal(me.name || ''), createdAt: nowTs(), expiresAt: { timestampValue: expiresAt }, used: { booleanValue: false } });
  await fs.set('inviteCodes/' + code, { household: strVal(me.hid), expiresAt: { timestampValue: expiresAt } });
  return json({ ok: true, code, url: appUrl() + '?invite=' + code, expiresAt, householdName: house ? f(house.fields, 'name') : '' });
}

/* GET /invite-info?code=: what an invite link is for, shown before anyone signs up (the code itself is the secret) */
async function handleInviteInfo(url, env) {
  const code = clean(url.searchParams.get('code'), 40);
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(code)) return json({ valid: false, message: 'That invite link is not right.' });
  const fs = await firestore(env);
  const inv = await loadInvite(fs, code);
  if (!inv.ok) return json({ valid: false, message: inv.message });
  return json({ valid: true, householdName: inv.householdName, name: f(inv.fields, 'name'), role: f(inv.fields, 'role'), from: f(inv.fields, 'createdByName') });
}
async function loadInvite(fs, code) {
  const idx = await fs.get('inviteCodes/' + code);
  const hid = idx && f(idx.fields, 'household');
  if (!hid) return { ok: false, message: 'That invite link has been used or is not right.' };
  const inv = await fs.get(hp(hid, 'invites/' + code));
  if (!inv) return { ok: false, message: 'That invite link is not right.' };
  if (f(inv.fields, 'used') === true) return { ok: false, message: 'That invite link has already been used.' };
  if (new Date(f(inv.fields, 'expiresAt')).getTime() < Date.now()) return { ok: false, message: 'That invite link has expired. Ask for a new one.' };
  const house = await fs.get('households/' + hid);
  return { ok: true, hid, fields: inv.fields, householdName: house ? f(house.fields, 'name') : '' };
}

/* POST /join { code, name? }: a sign-in with no household joins the one the invite is for */
async function handleJoin(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Invites are not available in the demo.' }, 403);
  const { who, fs } = a;
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const code = clean(body.code, 40);
  const current = await memberOf(fs, who.uid);
  if (current.hid) return json({ error: 'already', message: 'This sign-in is already in a household. Sign out and create a new sign-in to join another.' }, 409);
  const inv = await loadInvite(fs, code);
  if (!inv.ok) return json({ error: 'invite', message: inv.message }, 400);
  const name = clean(body.name, 40) || f(inv.fields, 'name') || 'Member';
  await fs.set(hp(inv.hid, 'members/' + who.uid), { name: strVal(name), role: strVal(f(inv.fields, 'role') || 'readonly'), relation: strVal(f(inv.fields, 'relation') || ''), addedBy: strVal(f(inv.fields, 'createdBy') || 'invite'), addedAt: nowTs() });
  await fs.merge('users/' + who.uid, { household: strVal(inv.hid), name: strVal(name) });
  await fs.merge(hp(inv.hid, 'invites/' + code), { used: { booleanValue: true }, usedBy: strVal(who.uid), usedAt: nowTs() });
  await fs.remove('inviteCodes/' + code);
  return json({ ok: true, household: inv.hid, householdName: inv.householdName, name, role: f(inv.fields, 'role') });
}

/* POST /member-remove { uid }: the household's owner takes someone out (never themselves) */
async function handleRemoveMember(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Not available in the demo.' }, 403);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid) return json({ error: 'unauthorised', message: 'This sign-in is not in a household.' }, 403);
  const house = await fs.get('households/' + me.hid);
  if (!house || f(house.fields, 'owner') !== who.uid) return json({ error: 'unauthorised', message: 'Only the household owner can remove someone.' }, 403);
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const uid = clean(body.uid, 60);
  if (!uid || uid === who.uid) return json({ error: 'bad-request', message: 'The owner cannot be removed.' }, 400);
  const target = await fs.get(hp(me.hid, 'members/' + uid));
  if (!target) return json({ error: 'bad-request', message: 'That person is not in this household.' }, 400);
  await fs.remove(hp(me.hid, 'members/' + uid));
  await fs.remove('users/' + uid);
  const subs = await fs.list(hp(me.hid, 'pushSubs'));
  for (const sub of subs) if (f(sub.fields, 'uid') === uid) await fs.remove(sub.path);
  return json({ ok: true });
}

async function handleExplain(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not-set-up', message: 'Daybook Assistant is not switched on yet. Use Send to my AI app for now.' }, 503);
  const auth = request.headers.get('Authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!idToken) return json({ error: 'unauthorised', message: 'Sign in to use Daybook Assistant.' }, 401);
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const projects = [sa.project_id, env.DEMO_PROJECT_ID].filter(Boolean);
  let who;
  try { who = await verifyFirebaseToken(idToken, projects); }
  catch (e) { return json({ error: 'unauthorised', message: 'Could not check who you are. Sign out and in again.' }, 401); }
  const demo = !!env.DEMO_PROJECT_ID && who.project === env.DEMO_PROJECT_ID && who.project !== sa.project_id;
  const fs = await firestore(env);
  let hid = DEMO_HOUSEHOLD;
  if (!demo) {
    const rec = await fs.get('users/' + who.uid);
    hid = rec && f(rec.fields, 'household');
    if (!hid) return json({ error: 'unauthorised', message: 'This account is not in a Daybook household yet.' }, 403);
    const mem = await fs.get(hp(hid, 'members/' + who.uid));
    if (!mem || f(mem.fields, 'role') !== 'family') return json({ error: 'unauthorised', message: 'Only family members of the household can use Daybook Assistant.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad-request', message: 'Could not read what was sent. Try again.' }, 400); }
  const kind = ['notes', 'programme', 'medicine', 'weekly', 'report', 'mood', 'pain'].includes(body.kind) ? body.kind : 'document';
  const text = String(body.text || '').slice(0, EXPLAIN_MAX_TEXT_CHARS);
  const pages = Array.isArray(body.pages) ? body.pages.slice(0, EXPLAIN_MAX_PAGES).filter((p) => typeof p === 'string' && p.length > 100 && p.length <= EXPLAIN_MAX_PAGE_CHARS) : [];
  if (!text.trim() && !pages.length) return json({ error: 'bad-request', message: 'Nothing to explain.' }, 400);

  /* The daily count, bumped before the call so parallel taps cannot slip past it */
  const day = londonNow().day;
  const logDoc = await fs.get(hp(hid, 'bridge/explainLog'));
  /* not called f: that name is the module's field reader, used above for the household and role */
  const logFields = (logDoc && logDoc.fields && logDoc.fields.day && logDoc.fields.day.stringValue === day) ? logDoc.fields : {};
  const n = (k) => Number(logFields[k] && logFields[k].integerValue || 0);
  const used = demo ? n('demo') : n('real');
  if (used >= (demo ? EXPLAIN_LIMIT_DEMO : EXPLAIN_LIMIT_REAL)) return json({ error: 'limit', message: demo ? 'The demo has used Daybook Assistant for today. Try again tomorrow, or use Send to my AI app.' : 'Your household has used Daybook Assistant\'s requests for today (' + EXPLAIN_LIMIT_REAL + ' a day). Use Send to my AI app, or try again tomorrow.' }, 429);
  await fs.set(hp(hid, 'bridge/explainLog'), { day: { stringValue: day }, real: { integerValue: String(n('real') + (demo ? 0 : 1)) }, demo: { integerValue: String(n('demo') + (demo ? 1 : 0)) }, tokensIn: { integerValue: String(n('tokensIn')) }, tokensOut: { integerValue: String(n('tokensOut')) }, updatedAt: { timestampValue: new Date().toISOString() } });

  const content = pages.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
  const head = kind === 'document'
    ? 'Document: ' + String(body.title || 'Untitled').slice(0, 200) + (body.date ? ' (dated ' + String(body.date).slice(0, 40) + ').' : '.')
    : kind === 'programme' ? 'The exercise or physiotherapy plan follows, as page photos or as text.'
    : kind === 'medicine' ? 'A photo of a medicine follows.'
    : kind === 'weekly' ? 'Care notes from Daybook, grouped by week.'
    : kind === 'report' ? 'Care notes and open questions from Daybook, for the two-page report.'
    : kind === 'mood' ? 'Scores and notes from Daybook, day by day, for the Mood and wellbeing report.'
    : kind === 'pain' ? 'Pain scores, words and pain relief doses from Daybook, day by day, for the Pain and pain relief report.' : 'Care notes from Daybook.';
  content.push({ type: 'text', text: head + (text.trim() ? '\n\n' + text : '\n\n(The document is in the attached page photos.)') });
  let reply;
  try { reply = await askClaude(env, EXPLAIN_SYSTEM[kind], content); }
  catch (e) {
    /* Say what actually went wrong, and give the day's count back, since nothing was explained */
    console.error('explain', e && e.message);
    await fs.merge(hp(hid, 'bridge/explainLog'), demo ? { demo: { integerValue: String(used) } } : { real: { integerValue: String(used) } }).catch(() => {});
    return json({ error: 'ai', status: e && e.status || 0, message: aiErrorMessage(e && e.status, e && (e.apiMessage || e.message)) }, 502);
  }
  if (reply.refused) return json({ error: 'refused', message: 'Daybook Assistant declined this one. Try Send to my AI app instead.' }, 422);
  /* Usage for Mark's own accounting (tokens only, never the text) */
  await fs.merge(hp(hid, 'bridge/explainLog'), { tokensIn: { integerValue: String(n('tokensIn') + reply.usage.input) }, tokensOut: { integerValue: String(n('tokensOut') + reply.usage.output) } }).catch(() => {});
  return json({ text: reply.text, model: reply.model, usage: reply.usage, cut: reply.cut });
}

/* One call to the Messages API. Adaptive thinking is on by default on this model; the
   server-side fallback re-runs a declined request on another model inside the same call. */
async function askClaude(env, system, content) {
  const body = { model: EXPLAIN_MODEL, max_tokens: EXPLAIN_MAX_TOKENS, system, messages: [{ role: 'user', content }] };
  const headers = { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
  let r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { ...headers, 'anthropic-beta': 'server-side-fallback-2026-07-01' }, body: JSON.stringify({ ...body, fallbacks: 'default' }) });
  if (r.status === 400) {
    const errText = await r.text();
    if (!/fallback/i.test(errText)) throw claudeError(400, errText);
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) }); // an account without the fallback beta
  }
  if (!r.ok) throw claudeError(r.status, await r.text());
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return {
    text, model: data.model, refused: data.stop_reason === 'refusal' || !text, cut: data.stop_reason === 'max_tokens',
    usage: { input: Number(data.usage && data.usage.input_tokens || 0), output: Number(data.usage && data.usage.output_tokens || 0) }
  };
}

function claudeError(status, raw) {
  let apiMessage = '';
  try { apiMessage = (JSON.parse(raw).error || {}).message || ''; } catch (e) { apiMessage = String(raw || '').slice(0, 200); }
  const err = new Error('Claude API ' + status + ': ' + String(raw || '').slice(0, 300));
  err.status = status; err.apiMessage = apiMessage;
  return err;
}

/* The AI service's refusals in words a person can act on (the raw reason goes to the worker's log) */
function aiErrorMessage(status, apiMessage) {
  const why = String(apiMessage || '');
  /* The first sentence is for whoever tapped the button; the part in brackets is for whoever runs Daybook (v116) */
  const down = 'Daybook Assistant is not working just now. Use Send to my AI app, and let whoever set up Daybook know';
  if (status === 401) return down + ' (the AI key was not accepted: make a new key in the Anthropic Console and save it as the ANTHROPIC_API_KEY secret).';
  if (/credit balance/i.test(why)) return down + ' (the AI account has no credit left: add credit in the Anthropic Console under Billing).';
  if (status === 403) return down + ' (the AI key is not allowed to do this: check it in the Anthropic Console).';
  if (status === 404) return down + ' (the AI model Daybook asks for is not available on this account).';
  if (status === 413 || /too large|too long/i.test(why)) return 'That was too large to send. Try a closer photo of just the label.';
  if (status === 429) return 'Daybook Assistant has reached its limit for now. Try again in a minute.';
  if (status >= 500) return 'Daybook Assistant is busy just now. Try again in a minute.';
  if (!status) return 'The bridge could not reach Daybook Assistant. Try again in a moment.';
  return 'Daybook Assistant turned this down (' + (why.slice(0, 140) || 'error ' + status) + ').';
}

/* Firebase ID token check: RS256 against Google's published keys, the project as audience */
let googleKeys = { keys: null, exp: 0 };
async function verifyFirebaseToken(token, projects, fetchFn) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('alg');
  const now = Math.floor(Date.now() / 1000);
  if (!(claims.exp > now) || !(claims.iat <= now + 300)) throw new Error('expired');
  if (!projects.includes(claims.aud) || claims.iss !== 'https://securetoken.google.com/' + claims.aud) throw new Error('audience');
  if (!claims.sub || typeof claims.sub !== 'string') throw new Error('subject');
  const jwk = await googleKey(header.kid, fetchFn || fetch);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('signature');
  return { uid: claims.sub, project: claims.aud, email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '' };
}
async function googleKey(kid, fetchFn) {
  const now = Date.now();
  if (!googleKeys.keys || googleKeys.exp < now || !googleKeys.keys.find((k) => k.kid === kid)) {
    const r = await fetchFn('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    if (!r.ok) throw new Error('keys ' + r.status);
    const data = await r.json();
    const m = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '');
    googleKeys = { keys: data.keys || [], exp: now + (m ? Number(m[1]) : 3600) * 1000 };
  }
  return googleKeys.keys.find((k) => k.kid === kid) || null;
}

/* For the test harness only (scratchpad): nothing in the app or the workflow uses these */
export const _test = { verifyFirebaseToken, askClaude, aiErrorMessage, EXPLAIN_SYSTEM, distanceKm, payloadFor, sha256Hex, hp, stretchNudgeDue, stretchTickedOn };

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
