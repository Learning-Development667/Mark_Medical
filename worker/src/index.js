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

const ALLOWED_ORIGINS = ['https://learning-development667.github.io', 'https://mymedicaldaybook.co.uk', 'https://www.mymedicaldaybook.co.uk', 'https://app.mymedicaldaybook.co.uk']; // the app's origin, and the website's (the Beta code box asks /beta-info) once the domain is live

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
      if (url.pathname === '/beta-info' && request.method === 'GET') return withCors(request, await handleBetaInfo(request, url, env));
      if (url.pathname === '/feedback' && request.method === 'POST') return withCors(request, await handleFeedback(request, env));
      if (url.pathname === '/feedback-info' && request.method === 'POST') return withCors(request, await handleFeedbackInfo(request, env));
      if (url.pathname === '/food' && request.method === 'POST') return withCors(request, await handleFood(request, env));
      if (url.pathname === '/circle-delete' && request.method === 'POST') return withCors(request, await handleCircleDelete(request, env));
      if (url.pathname === '/account-delete' && request.method === 'POST') return withCors(request, await handleAccountDelete(request, env));
      if (url.pathname === '/verify-email' && request.method === 'POST') return withCors(request, await handleVerifyEmail(request, env));
      if (url.pathname === '/send-report' && request.method === 'POST') return withCors(request, await handleSendReport(request, env));
      if (url.pathname === '/invite' && request.method === 'POST') return withCors(request, await handleInvite(request, env));
      if (url.pathname === '/invite-info' && request.method === 'GET') return withCors(request, await handleInviteInfo(url, env));
      if (url.pathname === '/join' && request.method === 'POST') return withCors(request, await handleJoin(request, env));
      if (url.pathname === '/member-remove' && request.method === 'POST') return withCors(request, await handleRemoveMember(request, env));
      if (url.pathname === '/owner-transfer' && request.method === 'POST') return withCors(request, await handleOwnerTransfer(request, env));
      if (url.pathname === '/plan' && request.method === 'POST') return withCors(request, await handlePlan(request, env));
      if (url.pathname === '/usage' && request.method === 'POST') return withCors(request, await handleUsage(request, env));
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
        return json(await runReminders(env, { rebuild: url.searchParams.get('rebuild') === '1' }));
      }
      /* The usage counts (v211), the same document the app's Usage page reads: ?key=<BRIDGE_KEY>, &rebuild=1 counts again now */
      if (url.pathname === '/usage' && request.method === 'GET') {
        if (!env.BRIDGE_KEY || url.searchParams.get('key') !== env.BRIDGE_KEY) return json({ error: 'Unauthorised' }, 401);
        if (url.searchParams.get('rebuild') === '1') return json(await buildUsage(env));
        const fs = await firestore(env);
        return json(readUsageDoc(await fs.get(USAGE_PATH)) || { error: 'none', message: 'No counts yet. Add &rebuild=1 to count now.' });
      }
      /* Daybook Assistant use this month, every circle: ?key=<BRIDGE_KEY> (v209, so the Anthropic bill is never a surprise) */
      if (url.pathname === '/ai-usage' && request.method === 'GET') {
        if (!env.BRIDGE_KEY || url.searchParams.get('key') !== env.BRIDGE_KEY) return json({ error: 'Unauthorised' }, 401);
        return json(await aiUsage(env));
      }
      return withCors(request, json({ error: 'Not found' }, 404));
    } catch (e) {
      console.error('bridge', e && e.message);
      /* (v291) the detail stays in the log: it can name household ids and Google's own error text */
      return withCors(request, json({ error: 'server', message: 'Daybook\'s bridge hit a problem. Try again in a minute.' }, 500));
    }
  },
  /* Cron (wrangler.toml, every five minutes): medicine reminders as push notifications */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).catch((e) => console.error('reminders', e)));
    /* The usage counts (v211), once a night in the quiet hours: the run that lands in the 03:30 London window counts, unless today is already counted */
    const now = londonNow();
    if (now.minutes >= USAGE_AT && now.minutes < USAGE_AT + 5) ctx.waitUntil(buildUsage(env, { ifNotToday: true }).catch((e) => console.error('usage', e)));
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
        /* The person said the watch did not record the whole night (a flat battery, taken off) and typed their own times
           (v279): those stay as the night; a re-send only refreshes the watch's own figures, kept beside them as watch. */
        const short = existing && existing.fields && existing.fields.watchShort && existing.fields.watchShort.booleanValue === true;
        if (short) {
          const keep = ['value', 'bedAt', 'wokeAt', 'awake', 'core', 'deep', 'rem'];
          const w = Object.fromEntries(keep.filter((k) => fields[k]).map((k) => [k, fields[k]]));
          await fs.merge(hp(hid, 'entries/' + day + '_sleep'), { watch: { mapValue: { fields: w } }, updatedAt: fields.updatedAt });
          result.sleep++;
          continue;
        }
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

let tokenCache = {}; // by scope: the datastore token, and since v294 one for Identity Toolkit

async function firestore(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing or incomplete');
  const token = await accessToken(sa);
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/`;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  return {
    /* The full resource name of a document, for referenceValue filters (v211) */
    docName(path) { return `projects/${sa.project_id}/databases/(default)/documents/` + path; },
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
    /* (v295) the names of up to `limit` documents anywhere under a document, in name order: a kindless all-descendants
       query, the one the Admin SDK's recursiveDelete uses, so subcollections (pages, parts) are found too */
    async descendants(parentDoc, limit) {
      const r = await fetch(base + parentDoc + ':runQuery', { method: 'POST', headers, body: JSON.stringify({ structuredQuery: {
        select: { fields: [{ fieldPath: '__name__' }] }, from: [{ allDescendants: true }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit } }) });
      if (!r.ok) throw new Error('Firestore descendants ' + parentDoc + ': ' + r.status + ' ' + await r.text());
      const rows = await r.json();
      return rows.filter((x) => x.document).map((x) => x.document.name);
    },
    /* (v295) delete up to 500 documents in one write, by their full names */
    async deleteMany(names) {
      if (!names.length) return;
      const r = await fetch(base.replace(/\/$/, '') + ':commit', { method: 'POST', headers, body: JSON.stringify({ writes: names.map((n) => ({ delete: n })) }) });
      if (!r.ok) throw new Error('Firestore commit: ' + r.status + ' ' + await r.text());
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
    },
    /* Any structured query on a collection (v211): the query is given whole, the documents come back as { id, fields } */
    async run(collection, structuredQuery) {
      const segs = collection.split('/');
      const collectionId = segs.pop();
      const parent = segs.length ? '/' + segs.join('/') : '';
      const r = await fetch(base.replace(/\/$/, '') + parent + ':runQuery', { method: 'POST', headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], ...structuredQuery } }) });
      if (!r.ok) throw new Error('Firestore query ' + collection + ': ' + r.status + ' ' + await r.text());
      const rows = await r.json();
      return rows.filter((x) => x.document).map((x) => ({ id: x.document.name.split('/').pop(), fields: x.document.fields || {} }));
    },
    /* How many documents match (v211): a count aggregation, billed as one read per thousand matched, never the documents themselves */
    async count(collection, where) {
      const segs = collection.split('/');
      const collectionId = segs.pop();
      const parent = segs.length ? '/' + segs.join('/') : '';
      const structuredQuery = { from: [{ collectionId }] };
      if (where) structuredQuery.where = where;
      const r = await fetch(base.replace(/\/$/, '') + parent + ':runAggregationQuery', { method: 'POST', headers, body: JSON.stringify({ structuredAggregationQuery: { structuredQuery, aggregations: [{ alias: 'n', count: {} }] } }) });
      if (!r.ok) throw new Error('Firestore count ' + collection + ': ' + r.status + ' ' + await r.text());
      const rows = await r.json();
      const row = rows.find((x) => x.result && x.result.aggregateFields);
      return row ? Number(row.result.aggregateFields.n.integerValue || 0) : 0;
    }
  };
}

async function accessToken(sa, scope) {
  scope = scope || 'https://www.googleapis.com/auth/datastore';
  const now = Math.floor(Date.now() / 1000);
  const hit = tokenCache[scope];
  if (hit && hit.token && hit.exp - 60 > now) return hit.token;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email, scope,
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
  tokenCache[scope] = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
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

const APP_ORIGIN = 'https://app.mymedicaldaybook.co.uk'; // since v231; the old github.io address redirects here
const appUrl = (tab) => APP_ORIGIN + '/' + (tab ? '?tab=' + tab : '');
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

/* The reminder plan (v209). Until v208 every five-minute run listed every household and read each one's
   phones, log, profile, medicines and doses (about 25 reads a household, 288 times a day: the free tier's
   whole read allowance at seven households). Now one document, bridge/reminderPlan { day, built,
   households { hid: { phones, nudge, oneOff, times [{ medId, t, name, dose }] } } }, is read once a run,
   and a household is only looked at in the minutes around one of its medicine times, the 10:00 nudge or a
   one-off reminder the app has flagged. The plan is rebuilt from the database once a day (the first run
   after midnight London, or when it is missing), and one household's entry is rebuilt on demand by
   POST /plan { what: 'refresh' } (the app calls it after a medicine, reminder or nudge change) or flagged by
   POST /plan { what: 'oneoff' } (after "Remind me in 15 minutes"). The log is written only when something
   was sent. A phone on an older app still works: its changes are picked up at the daily rebuild. */
const PLAN_PATH = 'bridge/reminderPlan';
function planEntryFromDocs(subs, profile, medicines, oneOffs, day) {
  const active = medicines.filter((m) => f(m.fields, 'active') !== false && f(m.fields, 'kind') !== 'prn' && f(m.fields, 'hospital') !== true && (!f(m.fields, 'courseEnd') || f(m.fields, 'courseEnd') >= day) && !(f(m.fields, 'courseStart') && f(m.fields, 'courseStart') > day));
  const times = [];
  active.forEach((m) => (f(m.fields, 'times') || []).map(toMinutes).filter((t) => t != null).forEach((t) => times.push({ medId: m.id, t, name: f(m.fields, 'name') || 'Medicine', dose: f(m.fields, 'dose') || '' })));
  return { phones: subs.length, nudge: !!(profile && f(profile.fields, 'stretchNudge') === true), oneOff: oneOffs.some((r) => f(r.fields, 'sent') !== true), times };
}
async function buildPlanEntry(fs, hid, day) {
  const subs = await fs.list(hp(hid, 'pushSubs'));
  if (!subs.length) return null;
  const [profile, medicines, oneOffs] = await Promise.all([fs.get(hp(hid, 'profile/main')), fs.list(hp(hid, 'medicines')), fs.list(hp(hid, 'reminders'))]);
  return planEntryFromDocs(subs, profile, medicines, oneOffs, day);
}
const planEntryFields = (e) => ({ mapValue: { fields: {
  phones: { integerValue: String(e.phones) }, nudge: { booleanValue: !!e.nudge }, oneOff: { booleanValue: !!e.oneOff },
  times: { arrayValue: { values: e.times.map((x) => ({ mapValue: { fields: { medId: strVal(x.medId), t: { integerValue: String(x.t) }, name: strVal(x.name), dose: strVal(x.dose) } } })) } }
} } });
function readPlanDoc(doc) {
  if (!doc || !doc.fields) return null;
  const hh = ((doc.fields.households || {}).mapValue || {}).fields || {};
  const households = {};
  Object.keys(hh).forEach((hid) => {
    const e = (hh[hid].mapValue || {}).fields || {};
    const times = ((e.times || {}).arrayValue || {}).values || [];
    households[hid] = { phones: Number(f(e, 'phones') || 0), nudge: f(e, 'nudge') === true, oneOff: f(e, 'oneOff') === true,
      times: times.map((v) => { const t = (v.mapValue || {}).fields || {}; return { medId: f(t, 'medId'), t: Number(f(t, 't')), name: f(t, 'name') || 'Medicine', dose: f(t, 'dose') || '' }; }) };
  });
  return { day: f(doc.fields, 'day'), built: f(doc.fields, 'built'), households };
}
async function writePlan(fs, plan) {
  await fs.set(PLAN_PATH, { day: strVal(plan.day), built: { timestampValue: new Date().toISOString() }, households: { mapValue: { fields: Object.fromEntries(Object.entries(plan.households).map(([hid, e]) => [hid, planEntryFields(e)])) } } });
}
async function buildPlan(fs, day) {
  const households = await fs.list('households');
  const plan = { day, households: {} };
  for (const hh of households) { const e = await buildPlanEntry(fs, hh.id, day); if (e) plan.households[hh.id] = e; }
  await writePlan(fs, plan);
  return plan;
}
/* Whether a household needs looking at this run: the due window and the nudge window of any medicine time, the 10:00 window, or a flagged one-off */
function planEntryDue(e, now) {
  if (e.oneOff) return true;
  if (e.nudge && now.minutes >= STRETCH_NUDGE_AT && now.minutes < STRETCH_NUDGE_AT + REMINDER_WINDOW_MIN) return true;
  return e.times.some((x) => now.minutes >= x.t && now.minutes < x.t + NUDGE_AFTER_MIN + REMINDER_WINDOW_MIN);
}
/* Rebuilds one household's entry in the plan (after a change in the app), or flags its one-off */
async function touchPlan(fs, hid, what) {
  const now = londonNow();
  let plan = readPlanDoc(await fs.get(PLAN_PATH)) || { day: now.day, households: {} };
  if (what === 'oneoff') { if (plan.households[hid]) plan.households[hid].oneOff = true; else { const e = await buildPlanEntry(fs, hid, now.day); if (e) { e.oneOff = true; plan.households[hid] = e; } } }
  else { const e = await buildPlanEntry(fs, hid, now.day); if (e) plan.households[hid] = e; else delete plan.households[hid]; }
  await writePlan(fs, plan);
  return plan.households[hid] || null;
}
async function handlePlan(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ ok: true, demo: true });
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid || me.role !== 'family') return json({ error: 'unauthorised', message: 'Only family members can change reminders.' }, 403);
  const body = await readJson(request);
  const what = body && body.what === 'oneoff' ? 'oneoff' : 'refresh';
  const entry = await touchPlan(fs, me.hid, what);
  return json({ ok: true, what, phones: entry ? entry.phones : 0, times: entry ? entry.times.length : 0 });
}

/* Every household due this run; a phone only ever hears about its own household's medicines */
async function runReminders(env, opts = {}) {
  if (!env.VAPID_PRIVATE_KEY) return { skipped: 'VAPID_PRIVATE_KEY is not set' };
  const fs = await firestore(env);
  const now = londonNow();
  let plan = opts.rebuild ? null : readPlanDoc(await fs.get(PLAN_PATH));
  let rebuilt = false;
  if (!plan || plan.day !== now.day) { plan = await buildPlan(fs, now.day); rebuilt = true; }
  const out = {};
  let changed = false;
  for (const [hid, e] of Object.entries(plan.households)) {
    if (!planEntryDue(e, now)) continue;
    const r = await runHouseholdReminders(env, fs, hid, e, now);
    out[hid] = r;
    if (e.oneOff && r && r.oneOffsPending === false) { e.oneOff = false; changed = true; }
  }
  if (changed) await writePlan(fs, plan);
  return { households: Object.keys(plan.households).length, rebuilt, due: Object.keys(out).length, ...out };
}
async function runHouseholdReminders(env, fs, hid, entry, nowIn) {
  const now = nowIn || londonNow();
  const logDoc = await fs.get(hp(hid, 'bridge/reminderLog'));
  const lf = logDoc ? logDoc.fields : {};
  const sent = f(lf, 'day') === now.day && lf.sent && lf.sent.mapValue ? Object.keys(lf.sent.mapValue.fields || {}) : [];
  const sentSet = new Set(sent);
  const sentBefore = sentSet.size;
  let subs = null;
  const phones = async () => { if (!subs) subs = await fs.list(hp(hid, 'pushSubs')); return subs; };
  /* the medicines and their times come from the plan; a household with no entry (the operator's /remind-now before any plan) is read in full */
  const plan = entry || await buildPlanEntry(fs, hid, now.day);
  if (!plan) return { skipped: 'no phones have reminders on' };
  const timesDue = plan.times.filter((x) => now.minutes >= x.t && now.minutes < x.t + NUDGE_AFTER_MIN + REMINDER_WINDOW_MIN);
  const doses = timesDue.length ? await fs.query(hp(hid, 'entries'), { day: now.day, type: 'med' }) : [];
  const doseMinutes = (medId) => doses.filter((d) => f(d.fields, 'medId') === medId).map((d) => londonNow(new Date(f(d.fields, 'at'))).minutes);
  const out = [];
  /* A private phone (pushSubs/{id}.private, true unless switched off) gets the same notification without the medicine's name or dose */
  const send = async (key, payload, privateBody) => {
    for (const sub of await phones()) out.push({ key, phone: sub.id, private: isPrivateSub(sub), result: await sendPush(env, fs, sub, payloadFor(sub, payload, privateBody)) });
    sentSet.add(key);
  };
  for (const x of timesDue) {
    const { medId, t, name, dose } = x;
    const taken = doseMinutes(medId);
    {
      const key = `${medId}|${t}`;
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
  if (plan.nudge && now.minutes >= STRETCH_NUDGE_AT && now.minutes < STRETCH_NUDGE_AT + REMINDER_WINDOW_MIN && !sentSet.has(nudgeKey)) {
    const profile = await fs.get(hp(hid, 'profile/main'));
    const nudgeOn = !!(profile && f(profile.fields, 'stretchNudge') === true);
    if (nudgeOn) {
      const exEntries = await fs.query(hp(hid, 'entries'), { day: now.day, type: 'exercise' });
      const exDoc = await fs.get(hp(hid, 'exercise/' + now.day));
      const due = stretchNudgeDue({ minutes: now.minutes, nudgeOn, exerciseLogged: exEntries.length > 0, stretchTicked: stretchTickedOn(profile.fields, exDoc ? exDoc.fields : null, now.day), alreadySent: false });
      if (due) await send(nudgeKey, { title: 'Daybook', body: 'Your gentle exercises are there if you feel up to them. No pressure.', tag: nudgeKey, url: appUrl('exercise') }, null);
    }
  }
  /* One-off reminders from the app ("Remind me in 15 minutes" after a meal), only while the plan flags one */
  let oneOffsPending = null;
  if (plan.oneOff) {
    const oneOffs = await fs.list(hp(hid, 'reminders'));
    oneOffsPending = false;
    for (const r of oneOffs) {
      if (f(r.fields, 'sent') === true) { if (new Date(f(r.fields, 'at')).getTime() < Date.now() - 86400000) await fs.remove(hp(hid, 'reminders/' + r.id)); continue; }
      if (new Date(f(r.fields, 'at')).getTime() > Date.now()) { oneOffsPending = true; continue; }
      await send('oneoff|' + r.id, { title: 'Daybook', body: `Reminder: ${f(r.fields, 'medName') || 'medicine'} ${f(r.fields, 'dose') || ''}`.trim(), tag: 'oneoff|' + r.id, url: appUrl('meds') }, 'Reminder: a medicine to take');
      await fs.merge(hp(hid, 'reminders/' + r.id), { sent: { booleanValue: true } });
    }
  }
  if (sentSet.size !== sentBefore || (logDoc && f(lf, 'day') !== now.day && sentSet.size)) await fs.set(hp(hid, 'bridge/reminderLog'), { day: strVal(now.day), at: { timestampValue: new Date().toISOString() }, sent: { mapValue: { fields: Object.fromEntries([...sentSet].map((k) => [k, { booleanValue: true }])) } } });
  return { day: now.day, minutes: now.minutes, phones: plan.phones, due: timesDue.length, sent: out, oneOffsPending };
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
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_ORIGIN + '/' });
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
const EXPLAIN_LIMIT_MONTH = 60;              // calls a month per household on the real project (v209): a budget, not just a brake
/* Never counted against the month (v210, Mark: a circle must always be able to summarise a report it is sending to a clinician):
   the report kinds. Only the day's 40 brakes them. Letters, photos, plans and suggested questions use the month's allowance. */
const EXPLAIN_REPORT_KINDS = ['report', 'weekly', 'mood', 'pain'];
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
  flare: 'You read a flare plan, self-management plan or clinic letter from an inflammatory bowel disease (Crohn\'s or colitis) team, from photos or pasted text, for a patient recording it in an app. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"from": string or null, "given": "YYYY-MM-DD" or null, "steps": string, "when": string, "wait": string}. ' +
    '"from" is who gave the plan (a nurse, a team, a hospital), "given" its date, "steps" what the team told the patient to do when symptoms flare, in their own words tidied into plain UK English sentences, "when" the signs they said should prompt a call (stools a day, blood, temperature, pain, weight), "wait" what to do if it does not settle or out of hours (ring again after so many hours, 111, A&E). ' +
    'Copy only what the document says, never add advice, thresholds or reassurance of your own; an empty string where the document says nothing. No em dashes.',
  results: 'You read test results (blood tests, faecal calprotectin, drug levels) from a results sheet, a clinic letter or an app screenshot, for a patient recording them in an app. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"day": "YYYY-MM-DD" or null, "source": string or null, "results": [{"test": string, "value": string, "unit": string, "range": string or null}]}. ' +
    '"day" is the date the sample was taken (the collection or sample date, else the report date), "source" who issued them (a GP surgery, a hospital, a lab, a team), one item per test with "test" the name as printed, "value" the number as printed (keep a leading < or > when the lab printed one), "unit" as printed, "range" the reference range exactly as printed ("0 - 5", "<50", "120-150") or null when none is printed. ' +
    'Copy only what the document says: never add a range, a flag, a comment or advice of your own, and leave out anything you cannot read clearly. No em dashes.',
  label: 'You read the nutrition panel on a food or drink packet from a photo, for a patient recording what they eat and drink in an app. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"name": string or null, "basis": "100g" or "100ml", "kcal": number or null, "kj": number or null, "prot": number or null, "carb": number or null, "sugar": number or null, "fat": number or null, "sat": number or null, "fibre": number or null, "salt": number or null, "packG": number or null, "packMl": number or null, "servingG": number or null}. ' +
    '"name" is the product name if it is printed in the photo, else null. Take every figure from the per 100 g or per 100 ml column, never the per serving or per portion column, and say which in "basis". "kcal" and "kj" are the energy as printed. "carb" is total carbohydrate, "sugar" the "of which sugars", "sat" the "of which saturates". ' +
    '"packG" or "packMl" is the pack size when it is printed ("500 g", "180 ml"), "servingG" the weight of one serving in grams when printed. Use a full stop for decimals. A figure printed as "<0.5" or "trace" is 0. ' +
    'Never guess a figure that is not printed or cannot be read clearly: use null. No em dashes.',
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
    'The four brief paragraphs are each under 70 words and only say what the scores and notes show: patterns over the period, the swings and what went with them, with dates. Quotes: the three notes that best carry how the person felt (one of them from a low day if there was one), each given whole, never cut short or summarised (up to 200 words), tidied for dictation and typing slips with the meaning and the person\'s own phrasing kept, never rewritten into other words and never invented; "low" is true when that day\'s mood was 4 or under. helped and hardest: up to four themes each, head of two to four words, text under 25 words, drawn from the notes and the weekly checks, naming days or counts where they help. ' +
    'Never diagnose, advise, reassure or interpret beyond what was written; no medical terms the person did not use; no em dashes; UK English.',
  pain: 'You write the key points on the Pain and pain relief report a patient hands to their pain nurse or pain team, from the pain scores, the words written under them and the pain relief doses they logged day by day in a health app, in plain UK English, about the patient by name as given. ' +
    'You are given the period, the pain relief medicines on the list (some have two uses; only doses for pain are listed), then one line per day (pain out of 10 at the morning check-in and the evening check-in, any scores logged between the check-ins with their times, the worst pain of the day out of 10; every pain relief dose with its time, regular ones marked; hours slept; treatment sessions; days in hospital) with that day\'s words under it, each with where in the day it was written and the score it came with. ' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape: {"points": [string], "words": [string]}. ' +
    'points: four or five short key points, each one sentence under 25 words, from the scores, doses and nights only: the level and range over the period with the days at 7 or more, whether it rose or fell, morning against evening, the pain relief taken and how often (and any daily maximum reached), and short nights beside bad days; dates where they help. ' +
    'words: three to five short key points, each under 25 words, from what the patient wrote: where the pain was and how it felt, what made it worse, and what helped or did not, using the patient\'s own phrases where clear (in quotation marks), tidied for dictation slips with the meaning kept, never invented. A clinician must be able to read both lists in under a minute: summarise, never copy whole notes. ' +
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
  return { hid, role: mem ? f(mem.fields, 'role') : null, name: mem ? f(mem.fields, 'name') : null, relation: mem ? (f(mem.fields, 'relation') || '') : '' };
}
/* The care circle (v199): a household is the patient's circle. The patient (the member whose relation is patient) and
   the owner (whoever set it up, until they hand it over) are the only two who invite and remove; everyone else logs. */
async function circleOf(fs, hid) {
  const house = await fs.get('households/' + hid);
  const members = await fs.list(hp(hid, 'members'));
  const patient = members.find((m) => f(m.fields, 'relation') === 'patient');
  const owner = house ? f(house.fields, 'owner') : '';
  return { house, owner, members, patientUid: patient ? patient.path.split('/').pop() : null,
    patientName: (patient && f(patient.fields, 'name')) || (house && (f(house.fields, 'patientName') || f(house.fields, 'name'))) || '' };
}
const runsCircle = (circle, uid, me) => circle.owner === uid || me.relation === 'patient';

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
/* GET /beta-info?code=: whether a Beta code in a link is good, shown on the sign-up screen and the website's Beta box before
   anyone types. Since v330 it never says whose a code is (a label may be a nurse's name, and the codes are words anyone
   could try), and one internet address gets BETA_INFO_A_DAY lookups a day, counted in Cloudflare's own cache at the
   nearest data centre: no database read or write, so it costs nothing. */
const BETA_INFO_A_DAY = 30;
async function betaLookupAllowed(request) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('beta:' + ip)))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
    const key = new Request('https://ratelimit.daybook.invalid/beta-info/' + new Date().toISOString().slice(0, 10) + '/' + hash);
    const cache = caches.default;
    const hit = await cache.match(key);
    const n = hit ? Number(await hit.text()) || 0 : 0;
    if (n >= BETA_INFO_A_DAY) return false;
    await cache.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': 'max-age=86400' } }));
    return true;
  } catch (e) { return true; } // no cache to count in (tests): let it through
}
async function handleBetaInfo(request, url, env) {
  if (!env.BETA_CODES_REQUIRED) return json({ required: false, valid: true });
  if (!(await betaLookupAllowed(request))) return json({ error: 'busy', message: 'Too many tries today. Email support@mymedicaldaybook.co.uk if your code is not working.' }, 429);
  const fs = await firestore(env);
  const rec = await betaCodeRecord(fs, normaliseBetaCode(url.searchParams.get('code')));
  return json(rec ? { required: true, valid: true } : { required: true, valid: false, message: BETA_CODE_MESSAGE });
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

/* Barcode lookup (v172). POST /food { barcode }: any signed-in member (the demo included, it is only a public
   product lookup). The bridge asks Open Food Facts (a free, open database of packaged food, ODbL licence, data
   credited in the app) for that one number and hands back the name, brand and the per 100 g label figures; nothing
   about the person goes with it (the request carries the bridge's own User-Agent, never the sign-in or the household),
   and nothing is kept here beyond Cloudflare's day-long cache of the public answer. A miss is { found: false }, not
   an error: plenty of UK own-brand products are not in the database, and the app then offers to type the label in. */
const OFF_FIELDS = 'code,product_name,product_name_en,brands,quantity,serving_size,nutriments,categories_tags';
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return typeof n === 'number' && isFinite(n) ? n : null; };
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
function mapOffProduct(code, p) {
  const n = (p && p.nutriments) || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null) { const kj = num(n['energy-kj_100g']) != null ? num(n['energy-kj_100g']) : num(n['energy_100g']); if (kj != null) kcal = kj / 4.184; }
  const per100 = { kcal: r1(kcal), prot: r1(num(n['proteins_100g'])), carb: r1(num(n['carbohydrates_100g'])), fat: r1(num(n['fat_100g'])), sat: r1(num(n['saturated-fat_100g'])), sugar: r1(num(n['sugars_100g'])), fibre: r1(num(n['fiber_100g'])), salt: r1(num(n['salt_100g'])) };
  const name = clean(p.product_name || p.product_name_en || '', 90);
  const brand = clean(String(p.brands || '').split(',')[0], 40);
  if (!name && !brand) return { found: false, code };
  const full = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? (brand + ' ' + name).trim() : (name || brand);
  const hasFigures = per100.kcal != null || per100.prot != null || per100.carb != null || per100.fat != null;
  /* a drink (v288): Open Food Facts files it under beverages, so the app can ask how many ml and add it to the day's drinks */
  const cats = Array.isArray(p.categories_tags) ? p.categories_tags : [];
  const drink = cats.some((c) => /^en:(beverages|drinks|plant-based-milks|milks|soups|smoothies|juices|sodas|protein-shakes|milkshakes|dairy-drinks)/.test(String(c)));
  return { found: true, code, name: full, brand, quantity: clean(p.quantity, 40), serving: clean(p.serving_size, 40), per100, hasFigures, drink, source: 'Open Food Facts' };
}
const OFF_HEADERS = { 'User-Agent': 'MyMedicalDaybook/1.0 (support@mymedicaldaybook.co.uk)', Accept: 'application/json' };
const OFF_SEARCH_MAX = 8;
/* Search by name (v201, Mark: "jaffa cake" found only cake in the UK table). POST /food { query }: the typed words go to
   Open Food Facts' text search, UK products first (the countries tag), the world when the UK has nothing; the same
   per 100 g shape as a barcode hit, up to OFF_SEARCH_MAX products, cached a day at the edge. Nothing about the person
   goes with the words. */
async function searchOff(query, uk) {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=' + OFF_SEARCH_MAX
    + '&fields=' + OFF_FIELDS + '&search_terms=' + encodeURIComponent(query)
    + (uk ? '&tagtype_0=countries&tag_contains_0=contains&tag_0=united-kingdom' : '');
  const res = await fetch(url, { headers: OFF_HEADERS, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!res.ok) throw new Error('status ' + res.status);
  const data = await res.json().catch(() => null);
  return ((data && data.products) || []).map((p) => mapOffProduct(String(p.code || ''), p)).filter((p) => p.found && p.name);
}
async function handleFoodSearch(body) {
  const query = clean(body && body.query, 60).replace(/\s+/g, ' ');
  if (query.length < 2) return json({ error: 'bad-request', message: 'Type at least two letters to search.' }, 400);
  try {
    let products = await searchOff(query, true);
    if (!products.length) products = await searchOff(query, false);
    return json({ query, products: products.slice(0, OFF_SEARCH_MAX), source: 'Open Food Facts' });
  } catch (e) {
    console.error('open food facts search', e && e.message);
    return json({ error: 'lookup-failed', message: 'Could not reach the food database just now. Log it as typed for now.' }, 502);
  }
}
async function handleFood(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  const body = await readJson(request);
  if (body && body.query != null && !body.barcode) return handleFoodSearch(body);
  const code = String((body && body.barcode) || '').replace(/\D/g, '');
  if (code.length < 8 || code.length > 14) return json({ error: 'bad-barcode', message: 'That does not look like a barcode number. It has 8 to 14 digits.' }, 400);
  let res;
  try {
    res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + code + '.json?fields=' + OFF_FIELDS, { headers: OFF_HEADERS, cf: { cacheTtl: 86400, cacheEverything: true } });
  } catch (e) { console.error('open food facts', e && e.message); return json({ error: 'lookup-failed', message: 'Could not reach the food database just now. Try again, or type the food in.' }, 502); }
  if (res.status === 404) return json({ found: false, code });
  if (!res.ok) { console.error('open food facts status', res.status); return json({ error: 'lookup-failed', message: 'The food database is busy just now. Try again in a moment, or type the food in.' }, 502); }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!data || data.status === 0 || !data.product) return json({ found: false, code });
  return json(mapOffProduct(code, data.product));
}

/* Send to the team, sent by Daybook (v159). POST /send-report { kind, to, toName, subject, text, filename, pdf (base64),
   fromName }: a family member's report goes out by email from SEND_FROM ("Mark Brown via My Medical Daybook"), through
   Resend (the RESEND_API_KEY secret; without it the route answers "not switched on yet" and the app offers the share
   sheet), with the sender's own sign-in email as the reply address and in copy, so a clinic's reply comes straight back
   to the patient and never to a Mark 1 Apps inbox. Nothing of the report is kept here; the app writes its own "sent"
   record in the household. SEND_A_DAY per household keeps a stuck finger off the free tier. Mark's ask of 13 October
   2026: one tap, the PDF attached, no Mail app hop (a web app cannot attach a file to a mailto: link, and the share
   sheet cannot fill in the recipient, which was why the old route took two hops). */
/* The same words as a plain HTML part (bridge, 20 October 2026, after v246): mail-tester scored a text-only email down ("There is no html version of your
   message"), and filters trust a message with both. Paragraphs at blank lines, line breaks kept, everything escaped; no
   images, links, tracking or styling beyond a readable font, so it reads exactly as the person typed it. */
function reportEmailHtml(text) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paras = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => '<p style="margin:0 0 14px">' + esc(p).replace(/\n/g, '<br>') + '</p>');
  return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#17263A">' + paras.join('') + '</body></html>';
}
/* (v291, the security review) a uid from a request is only ever a Firebase uid: letters and digits. Without this, a crafted
   "../private/health" reached other documents through the REST path. */
const UID_RE = /^[A-Za-z0-9]{1,128}$/;
/* the email addresses saved under Who to contact in the circle (profile/main.calls): the only addresses a report goes to */
async function circleContacts(fs, hid) {
  const prof = await fs.get(hp(hid, 'profile/main'));
  const calls = prof && prof.fields && prof.fields.calls && prof.fields.calls.arrayValue ? prof.fields.calls.arrayValue.values || [] : [];
  return calls.map((c) => (c.mapValue && c.mapValue.fields && c.mapValue.fields.email && c.mapValue.fields.email.stringValue || '').trim().toLowerCase()).filter(Boolean);
}
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
  // v292: a report goes out in this person's name with their address for replies, so the address must be proved theirs once.
  if (!who.emailVerified) return json({ error: 'unverified', message: 'Confirm your email address first: Daybook sends a link once, then reports can be sent.' }, 403);
  /* v246: the free plan allows about 10 ms of CPU a request, and parsing, checking and re-stringifying a report of several pages as
     JSON took 20 to 50 ms, so Cloudflare stopped the request and the phone saw "No connection". The app now sends one line of JSON
     (everything but the PDF), a newline, then the PDF's base64 as plain text. The PDF stays bytes in a Blob from the request to
     Resend: never decoded into a string, parsed or encoded again, so its size costs next to no CPU. An app from before v246
     still sends it all as JSON. */
  let body = null, pdf = null; // pdf: a Blob of the base64's bytes, or a string from the old form
  if (/^text\/plain/i.test(request.headers.get('Content-Type') || '')) {
    let all = null;
    try { all = await request.blob(); } catch (e) { all = null; }
    const head = all ? await all.slice(0, 65536).text() : '';
    const nl = head.indexOf('\n');
    if (nl > 0) {
      try { body = JSON.parse(head.slice(0, nl)); } catch (e) { body = null; }
      pdf = all.slice(new TextEncoder().encode(head.slice(0, nl + 1)).length); // a byte offset: the first line may hold é or £
    }
  } else {
    body = await readJson(request);
    pdf = body && typeof body.pdf === 'string' ? body.pdf : null;
  }
  if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const to = clean(body.to, 120).toLowerCase();
  if (!EMAIL_RE.test(to)) return json({ error: 'bad-request', message: 'Check the email address of the contact.' }, 400);
  /* (v291) only to someone saved under Who to contact, so the reporting address cannot be used to email strangers */
  if (!(await circleContacts(fs, me.hid)).includes(to)) return json({ error: 'not-a-contact', message: 'Reports can only be sent to someone saved under Who to contact. Add them there first.' }, 400);
  /* base64 checked at both ends and by its length, not character by character (that alone cost several ms at this size) */
  const B64 = /^[A-Za-z0-9+/=]*$/;
  const pdfLen = pdf == null ? 0 : typeof pdf === 'string' ? pdf.length : pdf.size;
  const ends = pdf == null ? ['', ''] : typeof pdf === 'string' ? [pdf.slice(0, 4096), pdf.slice(-4096)] : [await pdf.slice(0, 4096).text(), await pdf.slice(Math.max(0, pdf.size - 4096)).text()];
  if (!pdfLen || pdfLen % 4 !== 0 || !B64.test(ends[0]) || !B64.test(ends[1]) || !ends[0].startsWith('JVBERi0')) return json({ error: 'bad-request', message: 'The PDF did not arrive. Try again.' }, 400);
  if (pdfLen > SEND_PDF_CHARS) return json({ error: 'too-large', message: 'That PDF is too large to email. Use a shorter range.' }, 413);
  const toName = clean(body.toName, 80);
  const subject = clean(body.subject, 150) || 'Notes from My Medical Daybook';
  const text = String(body.text || '').replace(/\r/g, '').trim().slice(0, 6000);
  /* (v291) always a PDF (its base64 starts with %PDF- above), always named .pdf, and the sender's name must be the member's own */
  const filename = (clean(body.filename, 90).replace(/[^\w .()-]/g, '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'Daybook report') + '.pdf';
  const asked = clean(body.fromName, 60);
  const own = String(me.name || '').toLowerCase();
  const fromName = (own && /^[\p{L} .'-]{1,40}$/u.test(asked) && (asked.toLowerCase() === own || asked.toLowerCase().startsWith(own + ' ')) ? asked : me.name) || 'A Daybook member';
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
    /* everything but the PDF through JSON.stringify, then the base64 (which needs no escaping) put in between as bytes, so the
       megabytes are never walked by JavaScript */
    const shell = JSON.stringify({ from, to: [toName ? `${toName.replace(/["<>,]/g, '')} <${to}>` : to], cc: [who.email], reply_to: who.email, subject, text, html: reportEmailHtml(text), attachments: [{ filename, content: '__DAYBOOK_PDF__' }], headers: { 'X-Entity-Ref-ID': randomCode().slice(0, 16) } });
    const at = shell.indexOf('"__DAYBOOK_PDF__"');
    r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: new Blob([shell.slice(0, at) + '"', pdf, '"' + shell.slice(at + '"__DAYBOOK_PDF__"'.length)]) });
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

/* Delete (v295, ROADMAP action 8, Apple's rule for apps with accounts). POST /circle-delete { confirm: "DELETE" }: the patient,
   or whoever set the circle up, erases the whole circle: every document under households/{hid} (subcollections too), the
   circle's invite lookups, its Apple Health key lookup, every member's pointer to it, then the circle itself and the caller's
   own sign-in. Others in the circle keep their sign-ins and land on the "not in a care circle" screen. Done in rounds of 500
   (the free plan allows 50 outside calls a request), so the app calls again while `done` is false; bridge/deleting-{uid}
   remembers which circle, since the caller's own pointer goes in the first round. The operator's own circle (the one holding
   BRIDGE_KEY) is refused: months of Mark's records are not one mistyped word from gone. */
const DELETE_ROUNDS = 10;
async function deleteSignIn(sa, uid) {
  const token = await accessToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + encodeURIComponent(sa.project_id) + '/accounts:delete', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: uid }) });
  if (!r.ok) throw new Error('accounts:delete ' + r.status + ' ' + (await r.text()).slice(0, 300));
}
async function handleCircleDelete(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'The demo is wiped every night by itself.' }, 403);
  const { who, fs, sa } = a;
  const body = await readJson(request);
  if (!body || body.confirm !== 'DELETE') return json({ error: 'bad-request', message: 'Type DELETE to confirm.' }, 400);
  const markPath = 'bridge/deleting-' + who.uid;
  const mark = await fs.get(markPath);
  let hid = mark ? f(mark.fields, 'household') : null;
  if (!hid) {
    const me = await memberOf(fs, who.uid);
    if (!me.hid || !me.role) return json({ error: 'unauthorised', message: 'This sign-in is not in a care circle.' }, 403);
    const circle = await circleOf(fs, me.hid);
    if (!circle.house || !runsCircle(circle, who.uid, me)) return json({ error: 'unauthorised', message: 'Only the patient, or whoever set the circle up, can delete the whole circle. You can leave it and delete your own sign-in instead.' }, 403);
    if (env.BRIDGE_KEY && await householdForKey(fs, env.BRIDGE_KEY) === me.hid) return json({ error: 'operator', message: "This is the operator's own circle, so it cannot be deleted from the app. Mark 1 Apps Ltd can do it on request." }, 403);
    hid = me.hid;
    await fs.set(markPath, { household: strVal(hid), startedAt: nowTs() });
    const names = [];
    for (const inv of await fs.list(hp(hid, 'invites'))) names.push(fs.docName('inviteCodes/' + inv.id));
    const priv = await fs.get(hp(hid, 'private/health'));
    const key = priv && f(priv.fields, 'key');
    if (key) names.push(fs.docName('healthKeys/' + await sha256Hex(key)));
    for (const m of circle.members) {
      const uid = m.path.split('/').pop();
      if (!UID_RE.test(uid)) continue;
      const ptr = uid === who.uid ? { fields: { household: strVal(hid) } } : await fs.get('users/' + uid);
      if (ptr && f(ptr.fields, 'household') === hid) names.push(fs.docName('users/' + uid));
    }
    await fs.deleteMany(names);
  }
  let deleted = 0, done = false;
  for (let i = 0; i < DELETE_ROUNDS; i++) {
    const names = await fs.descendants('households/' + hid, 500);
    if (!names.length) { done = true; break; }
    await fs.deleteMany(names);
    deleted += names.length;
  }
  if (!done) return json({ ok: true, done: false, deleted });
  await fs.deleteMany([fs.docName('households/' + hid), fs.docName('bridge/verify-' + who.uid), fs.docName(markPath)]);
  try { await deleteSignIn(sa, who.uid); }
  catch (e) { console.error('circle-delete: sign-in', e && e.message); return json({ ok: true, done: true, deleted, signIn: false }); }
  return json({ ok: true, done: true, deleted, signIn: true });
}
/* POST /account-delete { confirm: "DELETE" } (v295): anyone but the person who runs the circle leaves it and deletes their own
   sign-in. What they logged stays with the circle: the records are the patient's, whoever typed them in. Someone who runs a
   circle with others in it is told to hand it over first, or delete the whole circle. */
async function handleAccountDelete(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'The demo sign-in is shared and cannot be deleted.' }, 403);
  const { who, fs, sa } = a;
  const body = await readJson(request);
  if (!body || body.confirm !== 'DELETE') return json({ error: 'bad-request', message: 'Type DELETE to confirm.' }, 400);
  const me = await memberOf(fs, who.uid);
  if (me.hid && me.role) {
    const circle = await circleOf(fs, me.hid);
    if (circle.house && runsCircle(circle, who.uid, me)) return json({ error: 'runs-circle', message: 'You run this care circle. Hand it to someone else in Settings first, or delete the whole circle.' }, 409);
    await fs.remove(hp(me.hid, 'members/' + who.uid));
    for (const sub of await fs.list(hp(me.hid, 'pushSubs'))) if (f(sub.fields, 'uid') === who.uid) await fs.remove(sub.path);
  }
  await fs.deleteMany([fs.docName('users/' + who.uid), fs.docName('bridge/verify-' + who.uid)]);
  try { await deleteSignIn(sa, who.uid); }
  catch (e) { console.error('account-delete: sign-in', e && e.message); return json({ ok: true, signIn: false }); }
  return json({ ok: true, signIn: true });
}

/* POST /verify-email (v294): the "confirm your email" message, sent by Daybook through Resend from SEND_FROM, branded, instead of
   Firebase's plain one from noreply@care-log-3d05a.firebaseapp.com (which landed in Mark's junk and named the project). The
   link is made by Identity Toolkit (accounts:sendOobCode with returnOobLink, so Google sends nothing itself) and pointed at the
   app as ?verify=CODE, where applyActionCode() confirms it. Without the Resend key the app falls back to Firebase's own email. */
const VERIFY_A_DAY = 5;
/* (v296) the app icon at 144px, carried in the email itself (an inline image, cid:daybook-logo) so a mail app that blocks
   pictures from the internet, as Apple Mail does for a new sender or the junk folder, still shows it. icons/email-logo.jpg. */
const EMAIL_LOGO_JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCACQAJADASIAAhEBAxEB/8QAHAAAAAcBAQAAAAAAAAAAAAAAAAECAwQFBgcI/8QAPRAAAQIEBAQEBAIIBgMAAAAAAQIDAAQFEQYSITEiQVFhBxNxgRQykaEIFSNCUmJygrHBJJKi0eHwFjNT/8QAGwEAAgMBAQEAAAAAAAAAAAAAAwQAAgUBBgf/xAAvEQACAgECBAUDAgcAAAAAAAAAAQIDEQQhBRIxURNBYZHBInGBBqEyUrHR4fDx/9oADAMBAAIRAxEAPwD3HB6wB7wCNYTGgEwLkc4HKAbRDoL3O8C8FA0iEwNrSQbgX6wkG5/tD3LaGVE+bYnaLxYGccCxB8oTcW1g83KOoqEbQR3gzveCixViFHS5iM4uJCzpEN3TlHUCm9hpS9ydoZUs3tr6wpROaI61cRgiQpOQ75nLWCK+8R8/K9h3gweRMXBcxqvWDG/aCA0gxvCJvggoVaE2iECgbwNbwesQglTjSHEIWtIU4bISTYqI6Qh5OoWN9oh1uTdnaOtEunM+ghxsXsSRyB5X/wBoYoNRdqVGC5nSYbUW3L6G42JHIxSNmLORlp1Zq51+QVuc+CojzyXC2rRKVDcEmJks+JiTafTs4hK/qIrcRyJqOHX5NDzTLpyrbU6oJTmBuL9t4sJVCGZFlhpYWlptKAUm+wtF483iPthfICXL4K75ftsSLw03MNPNZ2XErQSRmTtobGMri6qVA1CQw7SEKcmZzM47k/UbBsLnkkm9z0HeNFJS/wAHTWJXPn8tASVAbnmfrFoWOU3FLZf1OTq5Kozb3fRenckK05xGdF+W0PE3hpd4YE5MhORGXpofW8TXR127c4iKScxvtFkKzQxbi/vDiRrbnAUg3tb3g0DWLA0jUwaYImydIJBv2hE9AOEczCbX2hdoBT1iEEc4ztTxMqgTQRWJQmXcVZt+XF7juDz7XvGktDT0uzMy6mZhlt5tYspDiQpJ9jA7IykvoeGEqlCL+tZQ3KTkrPyDc5KPodYcGZKwbC3foex2jKVTEoU+6mlhLDSlcc2lIzvEaXT2/eOvSJVblpOi0cUukS6JVM44VOpbvqkAX3Ol+Eel4z6JFcwvhI6ZT/3aMnX6yyGKo9fPHwaej0tTzZL+Hyz8lNNTahNLedSXTfVajnUfcwludQtwGXdclHgMyHGzkI+nLsY0v5KyoFt65RbrvGSxFKTFJlzMIQXW02CsuuS5tf7xmxc4/VI2K3XY+SJoqRjryZ9uSrobsohsTybWBJ0zjkL89o02IK/IYep4mZ0kuKJS0wkjM6ochfYDmTtHn/Es+mQqrSkDOg2Stsk2VrrmEdiwBNN13DKV1RhmZm6a8qWaedbClBspSpNiextfnljc0OqsnmpvfyZj8V4bVSo6lL6fNLb/AJ6kzD1ZrdfeE67JtSFPTeySCtbx5AKNtBuSBbkLxoVe2sOKF9zqNIRlNyDGtXFxWG8s8zqJqcsxjhDKmwRxfaGlouMwHuIlkWBBhGQkc4LkWcSGtIAtCG0nNqRElbdwT/SEIFj112jpTl3LpSuekIQ4Qd7HeCWoaQnQp21hVLY1HLcmNuBadNLbw6BpFchZbVmG4+4ielSVC6TpHMYLxlkTMGYS1/h2UuKvaylZQP8AeKX4vEYmnL06WQwm/G4oAW63zQvGOI2cJ4EqeIH0hXwjJU2g653CQlCfdRH3jx+iqOYvxROMePHiFixik+deVappDFMUgi4S8poFxB7FIT+9BI6SVq5k2kuwtdxOvTTVTSbffZe53jxF8YfDrDdQlhOYjlZydbQpBkaar4l4qJGgSneMc3jvxYxYgKwF4ZKpEuv5alih34ceqWfnP0MXtEY8EvDbDyalh6ZwzT5RY0mpRwTDzun7YzOqJ6XjneK/xOutlxnAWGiRe35lWj5af4gwg5iDyK1J9IpDQRssco1tv16fHyDv4s6a1G69RXaPX98v2SOnYdwN4hoqDGIMW+JKpubZOZdMlmAxJFFjdJ/W3IOYjS1opsR+JOGGah+Vt1NM/MBaUPCnqTMtIUTYJWtJyg35Ak9o824h8SMXY3eTKVurz1WWtRtIM/opYEHdLLdgofxX9Y3/AIeYRxHUy1MuUth9ttWdKE/o5dsj5czm10nWybm4gms4bVy81zw8bJbfAnw79Q2qxV6ODcW95Sy36437ev4NtW6bKmaU447mSRmVn4lFV9dO20bnwvqco+zVqbTpsS1SfQlUuXWs6LNggkgHVQzai+2vaIkrgil09Am8TVJc84rX4dBKG1dggcbnrF+maeUylmnSbNKlk6Ju2krI7JHCn3v6Rj6bTKqXO3uer4hxmeoh4SWI+u7fwv3LeVpuNGZ0Ln8RsOBSuEJIShXbLljUIQ6lgectC3OZSmw+kc+UktpceZfdXME5i4+orUT6nb2sI3VHn0VSiS88nQuJstPNKwbKT7EGNKjCbxn8vJj23u7ZpL7JIfF7wsIF72gK0VC0gWuIZyAURtaOHaIjibOabHeLBQ4YhPjiO3SOplLES1WI0MEk2TrDOfuYWFG2sUwH5hX63WHmXFIJHIwxfXlC0qAGu0TB1SOOficxH+XYBpVIanHJVc7Oee48hnzvLQ0NFLRzRnUkH0jz61Xam7KJmqlQVzLCAbVGhK+JZe00zJ+dNr/KY6Z4n1heIvxATNPSVqlaU21IpCbWKreY77XWAf4YymIsNYXkHlT8tJGUmEDOtyTeWxwgXJISe3baNXTxUK4pnjuI2O/UTmui29v8mCqdZU/X5pAuiVl5dttKFILfG4Qs5k6HMBlGu1zGIxJUG5enu+QSkmyLk62KtQe8WEpUnn8PzFSnVKDs6+5NLKidMx4b/wAoH0jBTvxS5B6ccRnQXAsX/ZzfN/TSH1tExGuezHqeofCPD9CnMJ0SvUSk0qbS7KJaflqitekyglLilKR83ENEHhGmkduarFcbkXhPGlSiGmwWmqeyogJBGbVWgIGuieR2jyJ4G4jqjDFRoclMzKcxROtNMsodUpR4HDZRFrWQdOsehqPN1qcmWp+pfmMwy2eP4lxphuxFiQ03cqNibBRAjymri4WyUj3OhvXhR5NjpLEm2wPPuXHFDidWSpSvU72ioqM661Um2kfKrcxKoM8HqT8O4sKdlVlhaj+tb5VehFjFfUUpNYDulimFmNSe2Sf5qVWObcWOsaPBU4Uzk7TFaBQE00P9Kx9cp9zGNSopcJ135xZ0icEliWmzqTwF7yXTtwr4T66lJ9ovXLDTJB7o6cpFyIUlNh0hSgUnX0MDY3MO5GsCFHlEV8XG3aJCla7Qw4Mx0uPSOpgpoaF7w8kXGn2iK25mO8PpVblFmgcZCrwxUJ+XpdHm6nNKCWJRhcw4TtlQkqP2EPX10vHIfxLYmVQPAebp8u5lmq5MN0tGU2ORV1vH/Igj+aOwg5SUe5W+5VVysfkjgmBK+7XK3OVyohQemVOVB0rve6yVqI6gCw9orcd1d5eGppxlP6eeVkAuR8+ntZN9Ii4abU1RVJSA0t5SJdaQd2ySpY+g+8VWIakZzF0shtKfhpUKfdbJ1zWy+9r7e8bnIubY8FG1uG/3KaeYafo7UlLhDaUt+XnFzpzA31/3MV87RFIwrNlRzfo/LFzZKVW0Rbe3T7xrRTEuvpLarpKtVCwsCLqOuoCufPnCazLqlJZmSDSVNrNgVDRKT1v/ANMG67CSzF5KPwGpNYrfjHKStEu4puVmZh3Q8TSGiop91BAHciPT0pUEs1BDaDZqYQHEjlprp7GKj8GWCRTJTEuNnmSHXHE0iVKhslB8x238xbH8sW2MKS5QMV1OnsjWUmTMSwPNh3jSPutPtHmuJ/VZ9tj3Wgq5NNGzvuW1PnFU7ELjFiEvotfkSnUf6Tb2iXMTIcqDag4VakEEai8UipxtMuxUVC/lpJJG5KQVD3Kcw94mLy5g824HGQEqSsG4Uki4MZbY7ktSohzQ8J5xLYQVyym1Ei40PMf8xXtLEwwFJGW33iwlCcgubEG0WTOo6rQKiKvh+XnFW823lvJ6OJ0V9d/eJy2k2ui6T66RjMEzRZqk1InRD6A8k7cadD9Rb6Rtje0Mxk2jRrxOOSIq+ax0MIAudYcXdSrmHGm0EZlAmD5wgXLl4KVpWVN9h2h9LwURrFe++GkAXFz1hEo8pTxIg+DPU8bF0k3jyr+J2t/mXilRsMoXdqlyXxK0j/7TCrAn0bbH+aPUra0hs+YrKkaqPQczHhmrYulsQeLVaqNZyypqE+t9hUxwpW1cJasrawQlPprDOjhmfN2M3jd2NOq11k/2/wBwPIZNOpzCkBIU0kvZBpckZduuw945hQ51dSxZPPMA+W2rylgkHMQeIp9CI2/iJiBmiMTq2ChQQ1dtLdiM50SQed1FJMcuoL5p3kNS9kA/pH3HNfMVe2VI69o008s8u4pVv2/udnp4YbaHl2ellXUtxSlGygNt9db+m2sVNWeQtYYSkONBQzq0NiO56dO8M06ozC6GttltfmrBSUIVchVtwDvz09Y13h7hVmtYwlpGZDTrSZpC511K8yJdoG5APU2IsOsdlJQTkwdcJXSVcep6x8JcMpwl4P0Kiqbyvhj4mYzbl10+Yq/fiA9oz3jNReKmYkbQAgE0+aPZRzNKPosKT/OI3rWJaGXLifQByHlrsO3yxFxOmj4nwXU6J+YM3mWSlC9eBwcSFbclBJjzNuZtt+Z9LjXBU+HF9Fhfg4Awhb8m4wEpKmjfLtcpNxb1EW2HltqZepDqrFhflsK6oPEg/QxX0x8Jn5Zx66C6oNOJGuVeot9RaJEzLuSFel3jolxHkFCTrcHMg25aXH8sJSQlE0kvKraK0r1ygEfWH2AQ6RqANDfmYNuptPSWd1AQ6E3KQL3/AOYeQWCBlUk3tYbk35ADc9o4gyRZUuaMnVWppIzKbuuw3IGp+1x7x1FC0ONJW2QpCgFJPUHaMTQ8KzjyhM1IqlWFJt5A0dUP3j+qO2/pG1Q2hppLTaQlCQEpSNgBoIPBND9EWluMKbUFn12h9KQlIAg+esCCOWQkYJbmGfcKyb3t/WDlHcrwBNgeUJVYm4Gm3rCAg+cF3Nhy6w8eey85HcUuTLuAqzLU55tNQekXmpZKlhJUtSCAL8ib2BPMiPEk9T5ZMk5MpSqUU2oMu0+elQ6hDtuJKmycyFdbe28e3zT/AInMoOgFWtlJvYxkcUeEGHsUOmbqlJlpmbFss004pp7TbjFr+hvB9Pcq8pinENFPUpSh1R4NxR8J8LJyXwMnKFx4uueQteQIbSCLhZI+ZQ+kWeF8D41xTON/+P0V38vJF518BlnpcLVqrrwgx67kfATCUm60/MYYTPPsqztvT7ofWk+5t9o1yKGxKkslK2VDSx5dLQees/kE6uEvC8b2OK4V8GqPRmmXcTzi6i82klMq1dtkHnfXMs+pt2jpshMSUhJtylLpaGWG+FLbLYQkD0AjQS2GpJT2ZZccsSQFKuLncxopalSraEpS2kAdISsuct5M1tNo4w2gsGGVVqiZlKW5RaE7knl2i7bnpgJT5hIuADrtGkdpbJaytoG3SK6YphAASkjva0A50x3wZR8zgWN8NzsnjeZXS0FTM7/igj4xbYzE8QCbW310POLWkSD4k3peYdl23nUhxoNI2eRxJzuLJUo6EAXA1jpVRwnJVVCUTzPmKaVmbWFFKknqCNobkPDuiNzQeUxMTV9fLmXlLR/lO/vC06svK6FI1SyU0u3MVF8sU+TWslI8x5y6GmibGxO5UNiB01IjT0akijPl8TLj00vd4nLk7IA+URqGcPvuMDyi00kaAKBH0sIly2HVtrzzD7a+gSDHFCMeg7CmXXBBllVtSvMbmH/LI0Kl3H0MaSUVNltImLK0+e1rwhqQyrBKk2H7IsYm2A0tFmxqEGgX5QOd+UHpCTv/AGjgQwyxrt7iDQgFfSJK2bGwH94bUkpOsPZPOuOCXL5tD/eJouU/0iFLEnaLBA4NtO0VYzWthh021VuNoRdKhxJSelxeDmFC1wdP7RHC+UdKyeGTG2mCf/U31vliW2hsDRCR7RBZUSImIP8AzFJBqmSEgAgDQdokt6i1/vEVBOYCJadBYQCY9VuKAFtAIFh0g4HpFA4AO8FYwfrA9ftEIFBwII7xCB3JgjyP9IL3vB3vEIf/2Q==';
async function handleVerifyEmail(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'The demo does not send email.' }, 403);
  const { who, fs, sa } = a;
  if (!who.email) return json({ error: 'no-email', message: 'This sign-in has no email address.' }, 400);
  if (who.emailVerified) return json({ ok: true, already: true });
  if (!env.RESEND_API_KEY) return json({ error: 'not-set-up', message: 'Daybook cannot send this email yet.' }, 503);
  const day = londonNow().day;
  const logPath = 'bridge/verify-' + who.uid;
  const logDoc = await fs.get(logPath);
  const count = logDoc && f(logDoc.fields, 'day') === day ? Number(f(logDoc.fields, 'count') || 0) : 0;
  if (count >= VERIFY_A_DAY) return json({ error: 'limit', message: 'That is enough links for one day. Use the newest one, or try again tomorrow.' }, 429);
  await fs.set(logPath, { day: strVal(day), count: intVal(count + 1), updatedAt: nowTs() });
  let code = '';
  try {
    const token = await accessToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + encodeURIComponent(sa.project_id) + '/accounts:sendOobCode', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'VERIFY_EMAIL', email: who.email, returnOobLink: true }) });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.oobLink) throw new Error('sendOobCode ' + r.status + ' ' + JSON.stringify(data && data.error || data).slice(0, 300));
    code = new URL(data.oobLink).searchParams.get('oobCode') || '';
    if (!code) throw new Error('no oobCode in the link');
  } catch (e) {
    console.error('verify-email: link', e && e.message);
    return json({ error: 'link', message: 'Could not make the link just now. Try again in a minute.' }, 502);
  }
  const me = await memberOf(fs, who.uid);
  const name = clean(me.name, 40);
  const link = APP_ORIGIN + '/?verify=' + encodeURIComponent(code);
  const subject = 'Confirm your email for My Medical Daybook';
  const text = (name ? 'Hello ' + name + ',' : 'Hello,') + '\n\n' + VERIFY_WORDS + '\n\nConfirm my email:\n' + link + '\n\n' + VERIFY_IGNORE +
    '\n\nMy Medical Daybook\nYour companion between appointments\nMark 1 Apps Ltd, registered in England and Wales, company number 17510025.';
  let r;
  try {
    r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'My Medical Daybook <' + (env.SEND_FROM || SEND_FROM) + '>', to: [who.email], subject, text, html: verifyEmailHtml(name, link),
        attachments: [{ filename: 'daybook.jpg', content: EMAIL_LOGO_JPG, content_type: 'image/jpeg', content_id: 'daybook-logo' }],
        headers: { 'X-Entity-Ref-ID': randomCode().slice(0, 16) } }) });
  } catch (e) {
    console.error('verify-email: no reach', e && e.message);
    return json({ error: 'unreachable', message: 'The email service could not be reached. Try again in a minute.' }, 502);
  }
  if (!r.ok) {
    console.error('verify-email: refused', r.status, await r.text().catch(() => ''));
    return json({ error: 'refused', message: 'The email service would not send it just now. Try again in a minute.' }, 502);
  }
  return json({ ok: true, to: who.email });
}
const VERIFY_WORDS = 'Please confirm this is your email address. Daybook sends your reports to your care team in your name, and their replies come back to this address, so we check it is really yours. You only need to do this once.';
const VERIFY_IGNORE = 'If you did not ask for this, you can ignore this email. Nothing will be sent in your name.';
/* The confirm email's HTML: the app icon from the app's own address, the name in a serif, one teal button and the link in words
   under it for a mail app that hides buttons. Tables and inline styles only, which is what email apps understand. */
function verifyEmailHtml(name, link) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm your email</title></head>' +
    '<body style="margin:0;padding:0;background:#F6F4EF">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4EF"><tr><td align="center" style="padding:28px 14px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;border:1px solid #D5DEE5">' +
    '<tr><td align="center" style="padding:30px 28px 6px"><img src="cid:daybook-logo" width="72" height="72" alt="Daybook" style="display:block;border:0;border-radius:16px"></td></tr>' +
    '<tr><td align="center" style="padding:10px 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;color:#18727A;text-transform:uppercase">My Medical</td></tr>' +
    '<tr><td align="center" style="padding:2px 28px 0;font-family:Georgia,\'Times New Roman\',serif;font-size:34px;font-weight:bold;color:#17263A">Daybook</td></tr>' +
    '<tr><td align="center" style="padding:4px 28px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#4B5B6B">Your companion between appointments</td></tr>' +
    '<tr><td style="padding:0 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#17263A">' +
    '<p style="margin:0 0 14px">' + (name ? 'Hello ' + esc(name) + ',' : 'Hello,') + '</p>' +
    '<p style="margin:0 0 22px">' + esc(VERIFY_WORDS) + '</p></td></tr>' +
    '<tr><td align="center" style="padding:0 28px 22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:12px;background:#1E7F86">' +
    '<a href="' + esc(link) + '" style="display:inline-block;padding:15px 30px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:12px">Confirm my email</a>' +
    '</td></tr></table></td></tr>' +
    '<tr><td style="padding:0 28px 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#56667A">If the button does not work, copy this link into your browser:<br>' +
    '<a href="' + esc(link) + '" style="color:#18727A;word-break:break-all">' + esc(link) + '</a></td></tr>' +
    '<tr><td style="padding:12px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#56667A">' + esc(VERIFY_IGNORE) + '</td></tr>' +
    '</table>' +
    '<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#56667A">My Medical Daybook is made by Mark 1 Apps Ltd,<br>registered in England and Wales, company number 17510025.</p>' +
    '</td></tr></table></body></html>';
}

/* POST /household { name, relation, forName?, carerAgreed?, betaCode?, heardFrom? }: a sign-in with no circle makes its own and becomes its
   owner. Since v199 a carer setting one up for someone else names them (forName) and confirms they have that person's agreement, or
   are acting for someone who cannot decide for themselves; the confirmation is kept on the circle (consent) with the time. */
async function handleCreateHousehold(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'The demo has one shared household.' }, 403);
  const { who, fs } = a;
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const name = clean(body.name, 40);
  if (!name) return json({ error: 'bad-request', message: 'A first name is needed.' }, 400);
  const current = await memberOf(fs, who.uid);
  if (current.hid) return json({ error: 'already', message: 'This sign-in is already in a care circle.', household: current.hid }, 409);
  const relation = relationOf(body.relation) === 'carer' ? 'carer' : 'patient';
  const forName = clean(body.forName, 40);
  if (relation === 'carer' && body.carerAgreed !== true) return json({ error: 'bad-request', message: 'Please confirm that the person you care for has agreed, or cannot decide this for themselves and you are acting for them.' }, 400);
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
  if (made >= HOUSEHOLDS_A_DAY) return json({ error: 'limit', message: 'Daybook cannot take more new care circles today. Try again tomorrow.' }, 429);
  await fs.set('bridge/global', { day: strVal(day), households: intVal(made + 1), updatedAt: nowTs() });
  const hid = randomCode().slice(0, 20);
  const house = { name: strVal(relation === 'carer' && forName ? forName : name), owner: strVal(who.uid), createdAt: nowTs() };
  if (relation === 'carer') {
    if (forName) house.patientName = strVal(forName);
    house.consent = { mapValue: { fields: { by: strVal(who.uid), byName: strVal(name), at: nowTs(), kind: strVal('carer') } } };
  }
  if (beta) house.betaCode = strVal(beta.code);
  if (heardFrom) house.heardFrom = strVal(heardFrom);
  await fs.set('households/' + hid, house);
  await fs.set(hp(hid, 'members/' + who.uid), { name: strVal(name), role: strVal('family'), relation: strVal(relation), addedBy: strVal('sign-up'), addedAt: nowTs() });
  await fs.merge('users/' + who.uid, { household: strVal(hid), name: strVal(name) });
  if (beta) await fs.merge('betaCodes/' + beta.code, { uses: intVal(beta.uses + 1), lastUsedAt: nowTs() });
  return json({ ok: true, household: hid });
}

/* POST /invite { name, role, relation }: the patient, or the owner, makes a one-use link that expires in a week (v199: family members who are neither cannot) */
async function handleInvite(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Invites are not available in the demo.' }, 403);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid || me.role !== 'family') return json({ error: 'unauthorised', message: 'Only the patient, or whoever set the circle up, can invite someone.' }, 403);
  const circle = await circleOf(fs, me.hid);
  if (!runsCircle(circle, who.uid, me)) return json({ error: 'unauthorised', message: 'Only the patient, or whoever set the circle up, can invite someone.' }, 403);
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const role = ROLES.includes(body.role) ? body.role : 'readonly';
  const name = clean(body.name, 40);
  const relation = relationOf(body.relation);
  if (relation === 'patient' && circle.patientUid) return json({ error: 'bad-request', message: 'This circle already has its patient.' }, 400);
  const code = randomCode();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
  await fs.set(hp(me.hid, 'invites/' + code), { name: strVal(name), role: strVal(role), relation: strVal(relation), createdBy: strVal(who.uid), createdByName: strVal(me.name || ''), createdByRelation: strVal(me.relation || ''), createdAt: nowTs(), expiresAt: { timestampValue: expiresAt }, used: { booleanValue: false } });
  await fs.set('inviteCodes/' + code, { household: strVal(me.hid), expiresAt: { timestampValue: expiresAt } });
  return json({ ok: true, code, url: appUrl() + '?invite=' + code, expiresAt, householdName: circle.patientName, patientName: circle.patientName, fromRelation: me.relation || '' });
}

/* GET /invite-info?code=: what an invite link is for, shown before anyone signs up (the code itself is the secret) */
async function handleInviteInfo(url, env) {
  const code = clean(url.searchParams.get('code'), 40);
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(code)) return json({ valid: false, message: 'That invite link is not right.' });
  const fs = await firestore(env);
  const inv = await loadInvite(fs, code);
  if (!inv.ok) return json({ valid: false, message: inv.message });
  return json({ valid: true, householdName: inv.householdName, patientName: inv.householdName, name: f(inv.fields, 'name'), role: f(inv.fields, 'role'), relation: f(inv.fields, 'relation') || '', from: f(inv.fields, 'createdByName'), fromRelation: f(inv.fields, 'createdByRelation') || '' });
}
async function loadInvite(fs, code) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(code || ''))) return { ok: false, message: 'That invite link is not right.' };
  const idx = await fs.get('inviteCodes/' + code);
  const hid = idx && f(idx.fields, 'household');
  if (!hid) return { ok: false, message: 'That invite link has been used or is not right.' };
  const inv = await fs.get(hp(hid, 'invites/' + code));
  if (!inv) return { ok: false, message: 'That invite link is not right.' };
  if (f(inv.fields, 'used') === true) return { ok: false, message: 'That invite link has already been used.' };
  if (new Date(f(inv.fields, 'expiresAt')).getTime() < Date.now()) return { ok: false, message: 'That invite link has expired. Ask for a new one.' };
  const circle = await circleOf(fs, hid);
  return { ok: true, hid, fields: inv.fields, householdName: circle.patientName };
}

/* POST /join { code, name? }: a sign-in with no household joins the one the invite is for */
async function handleJoin(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Invites are not available in the demo.' }, 403);
  const { who, fs } = a;
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const code = clean(body.code, 40);
  const current = await memberOf(fs, who.uid);
  if (current.hid) return json({ error: 'already', message: 'This sign-in is already in a care circle. Sign out and create a new sign-in to join another.' }, 409);
  const inv = await loadInvite(fs, code);
  if (!inv.ok) return json({ error: 'invite', message: inv.message }, 400);
  const name = clean(body.name, 40) || f(inv.fields, 'name') || 'Member';
  await fs.set(hp(inv.hid, 'members/' + who.uid), { name: strVal(name), role: strVal(f(inv.fields, 'role') || 'readonly'), relation: strVal(f(inv.fields, 'relation') || ''), addedBy: strVal(f(inv.fields, 'createdBy') || 'invite'), addedAt: nowTs() });
  await fs.merge('users/' + who.uid, { household: strVal(inv.hid), name: strVal(name) });
  await fs.merge(hp(inv.hid, 'invites/' + code), { used: { booleanValue: true }, usedBy: strVal(who.uid), usedAt: nowTs() });
  await fs.remove('inviteCodes/' + code);
  return json({ ok: true, household: inv.hid, householdName: inv.householdName, patientName: inv.householdName, name, role: f(inv.fields, 'role') });
}

/* POST /owner-transfer { uid } (v199): the owner hands the circle to another family member (the patient, in the app), or the
   patient takes charge of a circle a carer set up for them (uid is their own; refused while the owner is the patient). */
/* Every circle's Daybook Assistant use this month, for the operator: calls, tokens in and out, and a rough cost in pence
   (claude-opus-5-5 is $4 in and $20 out per million tokens, taken at about 80p to the dollar; the Anthropic Console has the real bill) */
const AI_PENCE_PER_MTOK_IN = 320, AI_PENCE_PER_MTOK_OUT = 1600;
async function aiUsage(env) {
  const fs = await firestore(env);
  const month = londonNow().day.slice(0, 7);
  const households = await fs.list('households');
  const rows = [];
  let calls = 0, tin = 0, tout = 0;
  for (const hh of households) {
    const d = await fs.get(hp(hh.id, 'bridge/explainLog'));
    if (!d || !d.fields || f(d.fields, 'month') !== month) continue;
    const c = Number(f(d.fields, 'monthReal') || 0), rp = Number(f(d.fields, 'monthReports') || 0), i = Number(f(d.fields, 'monthTokensIn') || 0), o = Number(f(d.fields, 'monthTokensOut') || 0);
    calls += c + rp; tin += i; tout += o;
    rows.push({ household: hh.id, name: f(hh.fields, 'name') || '', calls: c + rp, reports: rp, other: c, tokensIn: i, tokensOut: o, pence: Math.round((i * AI_PENCE_PER_MTOK_IN + o * AI_PENCE_PER_MTOK_OUT) / 1e6) });
  }
  rows.sort((a, b) => b.calls - a.calls);
  return { month, households: households.length, active: rows.length, calls, tokensIn: tin, tokensOut: tout, pence: Math.round((tin * AI_PENCE_PER_MTOK_IN + tout * AI_PENCE_PER_MTOK_OUT) / 1e6), limitPerHousehold: EXPLAIN_LIMIT_MONTH, rows };
}
/* ------------------------------------------------------------------ */
/* The usage counts (v211): the operator's dashboard                     */
/* ------------------------------------------------------------------ */
/* Mark, 18 October 2026: a dashboard only he can see, "so I can track what's being used and what it's for", within GDPR.
   Counts, never content: how many circles, how many logged anything this week, how many did their check-ins, which
   features and which Daybook Assistant kinds were used, how many reports were sent. Nothing a person wrote, no names,
   no email addresses. Per-circle rows carry a pseudonym (the first eight characters of a salted hash of the circle id,
   the salt being BRIDGE_KEY, so the rows cannot be tied back to a circle from the page) and only this week's counts;
   the totals are kept for USAGE_HISTORY_DAYS days so a trend can be read. Counted once a night (USAGE_AT, London)
   into bridge/usage, the bridge's own top-level document, which the rules deny to everyone; about 20 reads a circle.
   Read by POST /usage from a sign-in in the operator's own circle (the household whose inbox key is BRIDGE_KEY), and
   by nobody else: the row under More never shows for another circle, and the bridge refuses them if they ask. */
const USAGE_PATH = 'bridge/usage';
const USAGE_AT = 3 * 60 + 30;           // 03:30 London, inside the five-minute cron
const USAGE_HISTORY_DAYS = 90;
const USAGE_WEEK = 7;
const USAGE_MAX_ROWS = 2000;            // past this the document nears Firestore's 1 MB: shard the rows then
const AI_KINDS = ['document', 'report', 'weekly', 'mood', 'pain', 'programme', 'medicine', 'flare', 'results', 'notes'];
const dayMinus = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
function readUsageDoc(doc) {
  if (!doc || !doc.fields) return null;
  const F = doc.fields;
  const num = (v) => Number(v && (v.integerValue ?? v.doubleValue) || 0);
  const map = (v) => Object.fromEntries(Object.entries((v && v.mapValue && v.mapValue.fields) || {}).map(([k, x]) => [k, x.mapValue ? map(x) : (x.stringValue ?? num(x))]));
  return { day: f(F, 'day'), built: f(F, 'built'), totals: map(F.totals), history: map(F.history), circles: map(F.circles) };
}
const usageVal = (v) => (typeof v === 'string' ? strVal(v) : typeof v === 'object' && v ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, usageVal(x)])) } } : intVal(Number(v) || 0));
/* One circle's counts for the week to "day": reads its household record (given), profile, Assistant log, the check-ins by id,
   one count of this week's entries, the latest entry's day, one count of reports sent and of phones. About 20 reads. */
async function countCircle(fs, hh, day) {
  const hid = hh.id;
  const from = dayMinus(day, USAGE_WEEK - 1);
  const days = []; for (let i = 0; i < USAGE_WEEK; i++) days.push(dayMinus(day, i));
  const docRef = (id) => fs.docName(hp(hid, 'entries/' + id));
  const [profile, ai, entries7, latest, sent, members, phones, checkins] = await Promise.all([
    fs.get(hp(hid, 'profile/main')),
    fs.get(hp(hid, 'bridge/explainLog')),
    fs.count(hp(hid, 'entries'), { fieldFilter: { field: { fieldPath: 'day' }, op: 'GREATER_THAN_OR_EQUAL', value: strVal(from) } }),
    fs.run(hp(hid, 'entries'), { orderBy: [{ field: { fieldPath: 'day' }, direction: 'DESCENDING' }], limit: 1 }),
    fs.count(hp(hid, 'entries'), { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: strVal('sent') } }),
    fs.count(hp(hid, 'members')),
    fs.count(hp(hid, 'pushSubs')),
    /* the week's check-ins by their deterministic ids ({day}_morning, {day}_evening): one count on the built-in index, no composite index needed */
    fs.count(hp(hid, 'entries'), { fieldFilter: { field: { fieldPath: '__name__' }, op: 'IN', value: { arrayValue: { values: days.flatMap((d) => [docRef(d + '_morning'), docRef(d + '_evening')]).map((n) => ({ referenceValue: n })) } } } })
  ]);
  const pf = (profile && profile.fields) || {};
  const packsMap = pf.packs && pf.packs.mapValue ? pf.packs.mapValue.fields : null;
  const packs = packsMap ? Object.keys(packsMap).filter((k) => packsMap[k].booleanValue) : ['cancer'];
  const month = day.slice(0, 7);
  const af = (ai && ai.fields && f(ai.fields, 'month') === month) ? ai.fields : {};
  const kinds = Object.fromEntries(Object.entries((af.monthKinds && af.monthKinds.mapValue && af.monthKinds.mapValue.fields) || {}).map(([k, v]) => [k, Number(v.integerValue || 0)]));
  const aiMonth = Number(f(af, 'monthReal') || 0) + Number(f(af, 'monthReports') || 0);
  const created = (f(hh.fields, 'createdAt') || '').slice(0, 10);
  return { created, code: String(f(hh.fields, 'betaCode') || '').slice(0, 24), packs: packs.join(','), members, phones, entries7, checkins7: checkins, last: latest.length ? String(f(latest[0].fields, 'day') || '') : '', ai: aiMonth, kinds, sent, setup: !!(f(pf, 'setupDone') || packsMap) };
}
async function buildUsage(env, opts) {
  opts = opts || {};
  const fs = await firestore(env);
  const day = londonNow().day;
  const before = readUsageDoc(await fs.get(USAGE_PATH));
  if (opts.ifNotToday && before && before.day === day) return { skipped: 'already counted today', day };
  const households = (await fs.list('households')).filter((hh) => hh.id !== DEMO_HOUSEHOLD).slice(0, USAGE_MAX_ROWS);
  const feedback = await fs.count('feedback');
  const circles = {};
  const t = { circles: households.length, new7: 0, new30: 0, active7: 0, logging7: 0, checkins7: 0, checkinSlots: 0, members: 0, phones: 0, aiCircles: 0, aiCalls: 0, sent: 0, setup: 0, feedback, packCancer: 0, packIbd: 0, packMenopause: 0 };
  const kinds = Object.fromEntries(AI_KINDS.map((k) => [k, 0]));
  const codes = {};
  for (const hh of households) {
    const c = await countCircle(fs, hh, day);
    const pid = (await sha256Hex(hh.id + ':' + (env.BRIDGE_KEY || ''))).slice(0, 8);
    circles[pid] = { created: c.created, code: c.code, packs: c.packs, members: c.members, phones: c.phones, entries7: c.entries7, checkins7: c.checkins7, last: c.last, ai: c.ai, sent: c.sent, setup: c.setup ? 1 : 0 };
    if (c.created && c.created >= dayMinus(day, 6)) t.new7++;
    if (c.created && c.created >= dayMinus(day, 29)) t.new30++;
    if (c.entries7 > 0) { t.active7++; t.checkinSlots += USAGE_WEEK * 2; }
    if (c.checkins7 >= USAGE_WEEK) t.logging7++;
    t.checkins7 += c.checkins7; t.members += c.members; t.phones += c.phones; t.sent += c.sent;
    if (c.ai > 0) { t.aiCircles++; t.aiCalls += c.ai; }
    for (const [k, n] of Object.entries(c.kinds)) kinds[k] = (kinds[k] || 0) + n;
    if (c.setup) t.setup++;
    if (c.packs.includes('cancer')) t.packCancer++;
    if (c.packs.includes('ibd')) t.packIbd++;
    if (c.packs.includes('menopause')) t.packMenopause++;
    if (c.code) codes[c.code] = (codes[c.code] || 0) + 1;
  }
  const history = Object.fromEntries(Object.entries((before && before.history) || {}).filter(([d]) => d >= dayMinus(day, USAGE_HISTORY_DAYS - 1)));
  history[day] = { circles: t.circles, active7: t.active7, logging7: t.logging7, checkins7: t.checkins7, aiCalls: t.aiCalls, sent: t.sent };
  const totals = { ...t, kinds, codes };
  await fs.set(USAGE_PATH, { day: strVal(day), built: nowTs(), totals: usageVal(totals), history: usageVal(history), circles: usageVal(circles) });
  return { day, built: new Date().toISOString(), totals, history, circles };
}
/* POST /usage { what: 'check' | 'read' | 'rebuild' }: the operator's circle only (the household whose inbox key is BRIDGE_KEY) */
async function handleUsage(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'unauthorised', operator: false }, 403);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  const opHid = env.BRIDGE_KEY ? await householdForKey(fs, env.BRIDGE_KEY) : null;
  if (!me.hid || !opHid || me.hid !== opHid) return json({ error: 'unauthorised', operator: false, message: 'Only the operator\'s own circle can see the usage counts.' }, 403);
  const body = (await readJson(request)) || {};
  if (body.what === 'check') return json({ operator: true });
  if (body.what === 'rebuild') return json({ operator: true, usage: await buildUsage(env) });
  return json({ operator: true, usage: readUsageDoc(await fs.get(USAGE_PATH)) });
}

async function handleOwnerTransfer(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Not available in the demo.' }, 403);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid) return json({ error: 'unauthorised', message: 'This sign-in is not in a care circle.' }, 403);
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const uid = clean(body.uid, 60);
  if (!UID_RE.test(uid)) return json({ error: 'bad-request', message: 'That person is not a family member of this circle.' }, 400);
  const circle = await circleOf(fs, me.hid);
  if (!circle.house) return json({ error: 'bad-request', message: 'The circle could not be read.' }, 400);
  const target = circle.members.find((m) => m.path.split('/').pop() === uid);
  if (!target || f(target.fields, 'role') !== 'family') return json({ error: 'bad-request', message: 'That person is not a family member of this circle.' }, 400);
  const ownerIsPatient = circle.owner === circle.patientUid;
  const claiming = uid === who.uid && me.relation === 'patient' && !ownerIsPatient;
  if (circle.owner !== who.uid && !claiming) return json({ error: 'unauthorised', message: 'Only whoever set the circle up can hand it over.' }, 403);
  if (uid === circle.owner) return json({ ok: true, owner: uid });
  await fs.merge('households/' + me.hid, { owner: strVal(uid), ownerChangedAt: nowTs(), ownerChangedBy: strVal(who.uid) });
  return json({ ok: true, owner: uid });
}

/* POST /member-remove { uid }: the owner, or the patient, takes someone out (never themselves, and only the patient can remove the patient) */
async function handleRemoveMember(request, env) {
  const a = await whoIs(request, env); if (a.error) return a.error;
  if (a.demo) return json({ error: 'demo', message: 'Not available in the demo.' }, 403);
  const { who, fs } = a;
  const me = await memberOf(fs, who.uid);
  if (!me.hid) return json({ error: 'unauthorised', message: 'This sign-in is not in a care circle.' }, 403);
  const circle = await circleOf(fs, me.hid);
  if (!circle.house || !runsCircle(circle, who.uid, me)) return json({ error: 'unauthorised', message: 'Only the patient, or whoever set the circle up, can remove someone.' }, 403);
  const body = await readJson(request); if (!body) return json({ error: 'bad-request', message: 'Could not read what was sent.' }, 400);
  const uid = clean(body.uid, 60);
  if (!UID_RE.test(uid)) return json({ error: 'bad-request', message: 'That person is not in this circle.' }, 400);
  if (!uid || uid === who.uid) return json({ error: 'bad-request', message: 'You cannot remove yourself.' }, 400);
  if (uid === circle.owner) return json({ error: 'bad-request', message: 'Whoever set the circle up cannot be removed.' }, 400);
  if (uid === circle.patientUid && me.relation !== 'patient') return json({ error: 'bad-request', message: 'The patient cannot be removed from their own circle.' }, 400);
  const target = await fs.get(hp(me.hid, 'members/' + uid));
  if (!target) return json({ error: 'bad-request', message: 'That person is not in this circle.' }, 400);
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
  const kind = ['notes', 'programme', 'medicine', 'weekly', 'report', 'mood', 'pain', 'flare', 'results', 'label'].includes(body.kind) ? body.kind : 'document';
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
  if (used >= (demo ? EXPLAIN_LIMIT_DEMO : EXPLAIN_LIMIT_REAL)) return json({ error: 'limit', message: demo ? 'The demo has used Daybook Assistant for today. Try again tomorrow, or use Send to my AI app.' : 'Your care circle has used Daybook Assistant\'s requests for today (' + EXPLAIN_LIMIT_REAL + ' a day). Use Send to my AI app, or try again tomorrow.' }, 429);
  /* The month's count (v209): kept on the same document across days, reset when the month changes */
  const month = day.slice(0, 7);
  const allFields = (logDoc && logDoc.fields) || {};
  const monthUsed = (allFields.month && allFields.month.stringValue === month) ? Number(allFields.monthReal && allFields.monthReal.integerValue || 0) : 0;
  const monthTokIn = (allFields.month && allFields.month.stringValue === month) ? Number(allFields.monthTokensIn && allFields.monthTokensIn.integerValue || 0) : 0;
  const monthTokOut = (allFields.month && allFields.month.stringValue === month) ? Number(allFields.monthTokensOut && allFields.monthTokensOut.integerValue || 0) : 0;
  const reportKind = EXPLAIN_REPORT_KINDS.includes(kind);
  const monthReports = (allFields.month && allFields.month.stringValue === month) ? Number(allFields.monthReports && allFields.monthReports.integerValue || 0) : 0;
  /* Which features were used this month (v211, for the operator's Usage page): a count per kind, never what was sent */
  const monthKinds = (allFields.month && allFields.month.stringValue === month && allFields.monthKinds && allFields.monthKinds.mapValue) ? { ...(allFields.monthKinds.mapValue.fields || {}) } : {};
  if (!demo) monthKinds[kind] = intVal(Number(monthKinds[kind] && monthKinds[kind].integerValue || 0) + 1);
  if (!demo && !reportKind && monthUsed >= EXPLAIN_LIMIT_MONTH) return json({ error: 'limit', message: 'Your care circle has used this month\'s Daybook Assistant allowance for letters, photos and suggested questions (' + EXPLAIN_LIMIT_MONTH + '). It starts again on the 1st. The summaries on the reports still work, and Send to my AI app is there for the rest.' }, 429);
  await fs.set(hp(hid, 'bridge/explainLog'), { day: { stringValue: day }, real: { integerValue: String(n('real') + (demo ? 0 : 1)) }, demo: { integerValue: String(n('demo') + (demo ? 1 : 0)) }, tokensIn: { integerValue: String(n('tokensIn')) }, tokensOut: { integerValue: String(n('tokensOut')) }, month: { stringValue: month }, monthReal: { integerValue: String(monthUsed + (demo || reportKind ? 0 : 1)) }, monthReports: { integerValue: String(monthReports + (demo || !reportKind ? 0 : 1)) }, monthTokensIn: { integerValue: String(monthTokIn) }, monthTokensOut: { integerValue: String(monthTokOut) }, monthKinds: { mapValue: { fields: monthKinds } }, updatedAt: { timestampValue: new Date().toISOString() } });

  const content = pages.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
  const head = kind === 'document'
    ? 'Document: ' + String(body.title || 'Untitled').slice(0, 200) + (body.date ? ' (dated ' + String(body.date).slice(0, 40) + ').' : '.')
    : kind === 'programme' ? 'The exercise or physiotherapy plan follows, as page photos or as text.'
    : kind === 'medicine' ? 'A photo of a medicine follows.'
    : kind === 'label' ? 'A photo of the nutrition panel on a food or drink packet follows.'
    : kind === 'flare' ? 'The flare plan or letter follows, as page photos or as text.'
    : kind === 'results' ? 'The test results follow, as page photos or as text: a results sheet, a clinic letter or a screenshot from an app.'
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
  await fs.merge(hp(hid, 'bridge/explainLog'), { tokensIn: { integerValue: String(n('tokensIn') + reply.usage.input) }, tokensOut: { integerValue: String(n('tokensOut') + reply.usage.output) }, monthTokensIn: { integerValue: String(monthTokIn + reply.usage.input) }, monthTokensOut: { integerValue: String(monthTokOut + reply.usage.output) } }).catch(() => {});
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
  return { uid: claims.sub, project: claims.aud, email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '', emailVerified: claims.email_verified === true };
}
async function googleKey(kid, fetchFn) {
  const now = Date.now();
  /* (v291) an unknown key id refetches at most once a minute, so a stream of junk tokens cannot make a fetch each */
  const known = googleKeys.keys && googleKeys.keys.find((k) => k.kid === kid);
  if (!googleKeys.keys || googleKeys.exp < now || (!known && now - (googleKeys.fetched || 0) > 60000)) {
    const r = await fetchFn('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    if (!r.ok) throw new Error('keys ' + r.status);
    const data = await r.json();
    const m = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '');
    googleKeys = { keys: data.keys || [], exp: now + (m ? Number(m[1]) : 3600) * 1000, fetched: now };
  }
  return googleKeys.keys.find((k) => k.kid === kid) || null;
}

/* For the test harness only (scratchpad): nothing in the app or the workflow uses these */
export const _test = { verifyEmailHtml, mapOffProduct, handleFood, verifyFirebaseToken, askClaude, aiErrorMessage, EXPLAIN_SYSTEM, distanceKm, payloadFor, sha256Hex, hp, stretchNudgeDue, stretchTickedOn, planEntryFromDocs, planEntryDue, readPlanDoc, planEntryFields, runReminders, runHouseholdReminders, touchPlan, firestore, buildUsage, countCircle, readUsageDoc, handleUsage, USAGE_PATH };

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
