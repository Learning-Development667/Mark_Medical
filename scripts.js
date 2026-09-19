/* Care Log
   Vanilla JS, Firebase v10 modular (Auth + Firestore only). No server, no paid services.
   See CLAUDE.md for the standards and the COST RULE. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const APP_VERSION = '4';
const PAGE_LIMIT_BYTES = 850 * 1024;   // base64 characters per page document (hard cap is 900 KB)
const TEXT_LIMIT_BYTES = 800 * 1024;
const PAGE_MAX_DIM = 1600;

const CDN = {
  chart: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
};

const SEED_MEDICINES = [
  { id: 'dalteparin', name: 'Dalteparin injection', dose: '7,500 units', how: 'Twice a day, morning and evening', purpose: 'Blood clots in lungs', kind: 'scheduled', perDay: 2 },
  { id: 'co-amoxiclav', name: 'Co-amoxiclav 500/125mg', dose: '1 tablet', how: 'Three times a day, 5-day course', purpose: 'Infection', kind: 'scheduled', perDay: 3, courseEnd: '2026-09-23' },
  { id: 'creon', name: 'Creon 25000', dose: '2 capsules', how: 'With each meal', purpose: 'Helps digest food', kind: 'scheduled', perDay: 3 },
  { id: 'oramorph', name: 'Oramorph 10mg/5ml', dose: '2.5 ml (5 mg)', how: 'Every 4 hours when needed', purpose: 'Pain', kind: 'prn', minGapHours: 4 },
  { id: 'diazepam', name: 'Diazepam', dose: '5 mg', how: 'As on the label', purpose: 'As prescribed', kind: 'prn' },
  { id: 'metoclopramide', name: 'Metoclopramide', dose: '10 mg', how: 'Up to 3 times a day when needed', purpose: 'Sickness', kind: 'prn', maxPerDay: 3 },
  { id: 'chlorphenamine', name: 'Chlorphenamine', dose: '4 mg', how: 'Up to 4 times a day when needed', purpose: 'Itching', kind: 'prn', maxPerDay: 4 },
  { id: 'menthol-cream', name: 'Menthol 2% cream', dose: 'Apply to skin', how: 'Three times a day', purpose: 'Itching', kind: 'scheduled', perDay: 3 },
  { id: 'macrogol', name: 'Macrogol sachets', dose: '2 sachets, each in 125 ml water', how: 'Twice a day', purpose: 'Constipation', kind: 'scheduled', perDay: 2 },
  { id: 'senna', name: 'Senna', dose: '15 mg', how: 'At night', purpose: 'Constipation', kind: 'scheduled', perDay: 1 }
];

const CLAUDE_PROMPT = 'Please explain this medical document in plain English for a patient and their family. ' +
  'Tell us what it says, what it means for day-to-day care, anything we need to act on, and any questions we might want to ask the medical team. ' +
  'Keep it calm and clear.';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function dayStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); }
function todayStr() { return dayStr(new Date()); }
function fmtTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtDayLong(s) { return parseDay(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); }
function fmtDayShort(s) { return parseDay(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtDayNum(s) { return parseDay(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function tempClass(v) { if (v >= 38) return 'is-red'; if (v >= 37.5) return 'is-amber'; return ''; }
function tempWord(v) { if (v >= 38) return 'High. 38.0 or above'; if (v >= 37.5) return 'Raised. Keep an eye on it'; return 'Normal range'; }
function entryDate(e) { return e.at && typeof e.at.toDate === 'function' ? e.at.toDate() : new Date(); }
function hoursAgo(d) { return (Date.now() - d.getTime()) / 36e5; }

function loadScript(src) {
  if (loadScript.cache[src]) return loadScript.cache[src];
  loadScript.cache[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  return loadScript.cache[src];
}
loadScript.cache = {};

/* Toast */
let toastTimer = null;
function toast(text, action) {
  const t = $('toast'), a = $('toast-action');
  $('toast-text').textContent = text;
  if (action) {
    a.textContent = action.label;
    a.hidden = false;
    a.onclick = () => { hideToast(); action.onClick(); };
  } else {
    a.hidden = true;
    a.onclick = null;
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}
function hideToast() { $('toast').hidden = true; }

/* Sheet */
function openSheet(title, body) {
  $('sheet-title').textContent = title;
  const b = $('sheet-body');
  b.replaceChildren(body);
  $('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  const first = b.querySelector('input:not([type=hidden]), textarea');
  if (first && first.type !== 'file' && window.matchMedia('(min-width: 700px)').matches) first.focus();
}
function closeSheet() {
  $('sheet').hidden = true;
  $('sheet-body').replaceChildren();
  document.body.style.overflow = '';
}

function confirmSheet(title, message, okLabel, danger) {
  return new Promise((resolve) => {
    const body = h('div', null,
      h('p', { text: message }),
      h('button', { class: 'btn btn-block ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => { closeSheet(); resolve(true); } }, okLabel),
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { closeSheet(); resolve(false); } }, 'Cancel')
    );
    openSheet(title, body);
  });
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', { text: label }), input);
}

function timeInput(defaultDay) {
  const now = new Date();
  const value = defaultDay === todayStr() ? fmtTime(now) : '12:00';
  return h('input', { type: 'time', value, required: true });
}

function atFromInputs(day, timeValue) {
  const [hh, mm] = (timeValue || '12:00').split(':').map(Number);
  const d = parseDay(day);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

/* ------------------------------------------------------------------ */
/* Firebase                                                             */
/* ------------------------------------------------------------------ */

const CONFIG = window.CARE_LOG_CONFIG;
if (!CONFIG || !CONFIG.firebase || !CONFIG.firebase.apiKey || CONFIG.firebase.apiKey === 'YOUR_API_KEY') {
  $('noconfig').hidden = false;
  throw new Error('Care Log: config.js missing or incomplete');
}

const app = initializeApp(CONFIG.firebase);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const USERS = {};
for (const [email, name] of Object.entries(CONFIG.users || {})) USERS[email.toLowerCase()] = name;

const state = {
  user: null,
  name: '',
  selectedDay: todayStr(),
  medicines: [],
  recentFrom: null,
  recentEntries: [],
  dayEntries: [],
  documents: [],
  profile: { calls: [] },
  unsub: {},
  charts: {},
  trendRange: 7,
  currentDoc: null
};

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

function nameFor(email) {
  const key = (email || '').toLowerCase();
  if (USERS[key]) return USERS[key];
  return key.split('@')[0] || 'Unknown';
}

function isAllowed(email) {
  return Boolean(email) && Object.prototype.hasOwnProperty.call(USERS, email.toLowerCase());
}

$('signin-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('signin-button'), err = $('signin-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Signing in';
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, $('signin-email').value.trim(), $('signin-password').value);
  } catch (e) {
    err.textContent = friendlyAuthError(e);
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

function friendlyAuthError(e) {
  const code = (e && e.code) || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Email or password not recognised.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a few minutes and try again.';
  if (code.includes('network')) return 'No connection. Check the signal and try again.';
  return 'Could not sign in. ' + (e && e.message ? e.message : '');
}

onAuthStateChanged(auth, async (user) => {
  if (user && !isAllowed(user.email)) {
    await signOut(auth);
    $('signin-error').textContent = 'This account is not permitted to use Care Log.';
    $('signin-error').hidden = false;
    return;
  }
  if (user) {
    state.user = user;
    state.name = nameFor(user.email);
    $('signin').hidden = true;
    $('app').hidden = false;
    $('user-chip').textContent = state.name;
    $('more-user').textContent = `${state.name} (${user.email})`;
    $('signin-password').value = '';
    await startData();
  } else {
    stopData();
    state.user = null;
    $('app').hidden = true;
    $('signin').hidden = false;
  }
});

$('signout').addEventListener('click', async () => {
  if (await confirmSheet('Sign out', 'You will need your password to sign back in.', 'Sign out', true)) signOut(auth);
});

/* ------------------------------------------------------------------ */
/* Data                                                                 */
/* ------------------------------------------------------------------ */

async function startData() {
  await seedMedicinesIfEmpty();
  watchMedicines();
  watchRecent();
  watchDay();
  watchDocuments();
  watchProfile();
}

function stopData() {
  for (const k of Object.keys(state.unsub)) { try { state.unsub[k](); } catch (e) { /* ignore */ } }
  state.unsub = {};
}

async function seedMedicinesIfEmpty() {
  try {
    const snap = await getDocs(collection(db, 'medicines'));
    if (!snap.empty) return;
    const batch = writeBatch(db);
    SEED_MEDICINES.forEach((m, i) => {
      const { id, ...data } = m;
      batch.set(doc(db, 'medicines', id), { ...data, active: true, order: i + 1 });
    });
    await batch.commit();
  } catch (e) {
    console.warn('Seed skipped', e);
  }
}

function watchMedicines() {
  state.unsub.meds = onSnapshot(collection(db, 'medicines'), (snap) => {
    state.medicines = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
    renderMeds();
    renderTiles();
  }, (e) => console.error(e));
}

function watchRecent() {
  const from = addDays(todayStr(), -1);
  if (state.recentFrom === from) return;
  state.recentFrom = from;
  if (state.unsub.recent) state.unsub.recent();
  const q = query(collection(db, 'entries'), where('day', '>=', from));
  state.unsub.recent = onSnapshot(q, (snap) => {
    state.recentEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    sortEntries(state.recentEntries);
    if (state.selectedDay >= state.recentFrom) {
      state.dayEntries = state.recentEntries.filter((e) => e.day === state.selectedDay);
      renderToday();
    }
    renderMeds();
  }, (e) => console.error(e));
}

function watchDay() {
  if (state.unsub.day) { state.unsub.day(); delete state.unsub.day; }
  renderDayLabel();
  if (state.recentFrom && state.selectedDay >= state.recentFrom) {
    state.dayEntries = state.recentEntries.filter((e) => e.day === state.selectedDay);
    renderToday();
    return;
  }
  state.dayEntries = [];
  renderToday();
  const q = query(collection(db, 'entries'), where('day', '==', state.selectedDay));
  state.unsub.day = onSnapshot(q, (snap) => {
    state.dayEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    sortEntries(state.dayEntries);
    renderToday();
  }, (e) => console.error(e));
}

function sortEntries(list) {
  list.sort((a, b) => entryDate(b) - entryDate(a));
}

function watchDocuments() {
  state.unsub.docs = onSnapshot(collection(db, 'documents'), (snap) => {
    state.documents = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.docDate || '').localeCompare(a.docDate || ''));
    renderDocsList();
  }, (e) => console.error(e));
}

function watchProfile() {
  state.unsub.profile = onSnapshot(doc(db, 'profile', 'main'), (snap) => {
    state.profile = snap.exists() ? snap.data() : { calls: [] };
    renderCalls();
  }, (e) => console.error(e));
}

async function addEntry(data) {
  const at = data.at instanceof Date ? data.at : new Date();
  const entry = {
    ...data,
    day: dayStr(at),
    at: Timestamp.fromDate(at),
    addedBy: state.name,
    createdAt: serverTimestamp()
  };
  const ref = doc(collection(db, 'entries'));
  setDoc(ref, entry).catch((e) => { console.error(e); toast('Could not save. It will retry when online.'); });
  return ref.id;
}

function deleteEntry(id) {
  return deleteDoc(doc(db, 'entries', id));
}

/* ------------------------------------------------------------------ */
/* Navigation                                                           */
/* ------------------------------------------------------------------ */

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  window.scrollTo(0, 0);
  if (name === 'trends') renderTrends();
  if (name === 'docs') showDocsList();
}

$('sheet').addEventListener('click', (ev) => { if (ev.target.hasAttribute('data-close')) closeSheet(); });

/* ------------------------------------------------------------------ */
/* Today                                                                */
/* ------------------------------------------------------------------ */

$('day-prev').addEventListener('click', () => { state.selectedDay = addDays(state.selectedDay, -1); watchDay(); });
$('day-next').addEventListener('click', () => {
  if (state.selectedDay >= todayStr()) return;
  state.selectedDay = addDays(state.selectedDay, 1); watchDay();
});
$('day-label').addEventListener('click', () => { state.selectedDay = todayStr(); watchDay(); });

function renderDayLabel() {
  const today = todayStr();
  const lbl = $('day-label');
  let small = fmtDayNum(state.selectedDay);
  if (state.selectedDay === today) small = 'Today';
  else if (state.selectedDay === addDays(today, -1)) small = 'Yesterday';
  lbl.replaceChildren(fmtDayLong(state.selectedDay), h('small', { text: small }));
  $('day-next').disabled = state.selectedDay >= today;
  $('day-next').style.visibility = state.selectedDay >= today ? 'hidden' : 'visible';
}

function renderToday() {
  renderTiles();
  const list = $('timeline');
  list.replaceChildren(...state.dayEntries.map(renderEntry));
  $('timeline-empty').hidden = state.dayEntries.length > 0;
}

function entryTitle(e) {
  switch (e.type) {
    case 'med': return [h('span', { text: e.medName || 'Medicine' })];
    case 'temp': return [h('span', { class: 'val ' + tempClass(e.value), text: Number(e.value).toFixed(1) + ' °C' })];
    case 'drink': return [h('span', { text: e.note || 'Drink' }), e.value ? h('span', { class: 'val', text: '  ' + e.value + ' ml' }) : null];
    case 'food': return [h('span', { text: e.note || 'Food' })];
    case 'weight': return [h('span', { class: 'val', text: Number(e.value).toFixed(1) + ' kg' })];
    default: return [h('span', { text: e.note || 'Note' })];
  }
}

function entrySub(e) {
  const bits = [];
  if (e.type === 'med' && e.dose) bits.push(e.dose);
  if (e.type === 'med' && e.note) bits.push(e.note);
  if (e.type === 'temp' && e.note) bits.push(e.note);
  if (e.type === 'food' && e.amount) bits.push(e.amount);
  if (e.type === 'weight' && e.note) bits.push(e.note);
  bits.push('by ' + (e.addedBy || 'unknown'));
  return bits.join(' · ');
}

function renderEntry(e) {
  const d = entryDate(e);
  const cls = 'entry type-' + e.type + (e.type === 'temp' ? ' ' + tempClass(e.value) : '');
  return h('li', { class: cls },
    h('span', { class: 'entry-time', text: fmtTime(d) }),
    h('div', { class: 'entry-main' },
      h('div', { class: 'entry-title' }, ...entryTitle(e)),
      h('div', { class: 'entry-sub', text: entrySub(e) })
    ),
    h('button', { class: 'entry-menu', type: 'button', 'aria-label': 'Entry options', onclick: () => entryOptions(e) }, '⋯')
  );
}

function entryOptions(e) {
  const d = entryDate(e);
  const body = h('div', null,
    h('p', null, h('strong', null, ...entryTitle(e).map((n) => n.cloneNode(true)))),
    h('p', { class: 'muted', text: `${fmtDayLong(e.day)} at ${fmtTime(d)}. ${entrySub(e)}` }),
    h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: async () => {
      closeSheet();
      await deleteEntry(e.id);
      toast('Entry deleted');
    } }, 'Delete this entry'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Entry', body);
}

function renderTiles() {
  const entries = state.dayEntries;
  const temps = entries.filter((e) => e.type === 'temp');
  const tileT = $('tile-temp');
  tileT.classList.remove('is-red', 'is-amber', 'is-green');
  if (temps.length) {
    const t = temps[0];
    $('tile-temp-value').replaceChildren(Number(t.value).toFixed(1), h('small', { text: '°C' }));
    $('tile-temp-sub').textContent = 'at ' + fmtTime(entryDate(t));
    const c = tempClass(t.value);
    tileT.classList.add(c || 'is-green');
  } else {
    $('tile-temp-value').textContent = '--';
    $('tile-temp-sub').textContent = 'none today';
  }

  const drinks = entries.filter((e) => e.type === 'drink');
  const ml = drinks.reduce((s, e) => s + (Number(e.value) || 0), 0);
  $('tile-drink-value').replaceChildren(ml >= 1000 ? (ml / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(ml), h('small', { text: ml >= 1000 ? 'L' : 'ml' }));
  $('tile-drink-sub').textContent = drinks.length === 1 ? '1 drink' : drinks.length + ' drinks';

  const sched = activeScheduled(state.selectedDay);
  const need = sched.reduce((s, m) => s + (m.perDay || 1), 0);
  const done = sched.reduce((s, m) => s + Math.min(m.perDay || 1, countMedOnDay(m.id, state.selectedDay)), 0);
  $('tile-meds-value').textContent = `${done} of ${need}`;
  const tileM = $('tile-meds');
  tileM.classList.toggle('is-green', need > 0 && done >= need);
  $('tile-meds-sub').textContent = need > 0 && done >= need ? 'all done' : 'doses taken';
}

/* Quick add */
document.querySelectorAll('.qa').forEach((b) => b.addEventListener('click', () => openAdd(b.dataset.add)));

function openAdd(type) {
  const day = state.selectedDay;
  const time = timeInput(day);
  const note = h('input', { type: 'text', placeholder: 'Optional note' });
  const body = h('div', null);
  let getData;

  if (type === 'temp') {
    const last = state.recentEntries.find((e) => e.type === 'temp');
    const input = h('input', { type: 'number', step: '0.1', min: '34', max: '42', inputmode: 'decimal', value: last ? Number(last.value).toFixed(1) : '37.0', required: true });
    const hint = h('p', { class: 'hint' });
    const update = () => { const v = parseFloat(input.value); hint.textContent = isNaN(v) ? '' : tempWord(v); hint.style.color = v >= 38 ? 'var(--red)' : v >= 37.5 ? 'var(--amber)' : 'var(--green)'; };
    const step = (n) => { const v = parseFloat(input.value) || 37; input.value = (Math.round((v + n) * 10) / 10).toFixed(1); update(); };
    input.addEventListener('input', update);
    update();
    body.append(
      h('div', { class: 'bigvalue' },
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Down', onclick: () => step(-0.1) }, '−'),
        input, h('span', { class: 'unit', text: '°C' }),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Up', onclick: () => step(0.1) }, '+')
      ),
      hint,
      field('Time', time), field('Note', note)
    );
    getData = () => {
      const v = parseFloat(input.value);
      if (isNaN(v) || v < 30 || v > 45) return null;
      return { type: 'temp', value: Math.round(v * 10) / 10, note: note.value.trim() };
    };
  }

  if (type === 'drink') {
    const what = h('input', { type: 'text', placeholder: 'What was it?', value: 'Water' });
    const ml = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '10', value: '200' });
    const whatPresets = presets(['Water', 'Tea', 'Coffee', 'Squash', 'Juice', 'Milk', 'Supplement drink'], what, 'Water');
    const mlPresets = presets(['50', '100', '150', '200', '250', '300'], ml, '200');
    body.append(
      field('Drink', what), whatPresets,
      field('Amount (ml)', ml), mlPresets,
      field('Time', time)
    );
    getData = () => {
      const v = parseInt(ml.value, 10);
      return { type: 'drink', value: isNaN(v) ? 0 : v, note: what.value.trim() || 'Drink' };
    };
  }

  if (type === 'food') {
    const what = h('input', { type: 'text', placeholder: 'What was eaten?', required: true });
    const amount = h('input', { type: 'hidden', value: 'About half' });
    const amountPresets = presets(['A few mouthfuls', 'About half', 'Most of it', 'All of it'], amount, 'About half');
    body.append(field('Food', what), h('p', { class: 'field' }, h('span', { text: 'How much' })), amountPresets, field('Time', time));
    getData = () => {
      if (!what.value.trim()) return null;
      return { type: 'food', note: what.value.trim(), amount: amount.value };
    };
  }

  if (type === 'weight') {
    const last = state.recentEntries.find((e) => e.type === 'weight');
    const input = h('input', { type: 'number', step: '0.1', min: '20', max: '250', inputmode: 'decimal', value: last ? Number(last.value).toFixed(1) : '', placeholder: '0.0', required: true });
    body.append(
      h('div', { class: 'bigvalue' }, input, h('span', { class: 'unit', text: 'kg' })),
      field('Time', time), field('Note', note)
    );
    getData = () => {
      const v = parseFloat(input.value);
      if (isNaN(v) || v <= 0) return null;
      return { type: 'weight', value: Math.round(v * 10) / 10, note: note.value.trim() };
    };
  }

  if (type === 'note') {
    const text = h('textarea', { rows: '4', placeholder: 'How things are, symptoms, questions for the team' });
    body.append(field('Note', text), field('Time', time));
    getData = () => {
      if (!text.value.trim()) return null;
      return { type: 'note', note: text.value.trim() };
    };
  }

  const titles = { temp: 'Temperature', drink: 'Drink', food: 'Food', weight: 'Weight', note: 'Note' };
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Save');
  save.addEventListener('click', async () => {
    const data = getData();
    if (!data) { toast('Please check the value'); return; }
    data.at = atFromInputs(day, time.value);
    closeSheet();
    const id = await addEntry(data);
    toast(titles[type] + ' saved', { label: 'Undo', onClick: () => deleteEntry(id) });
  });
  body.append(save, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel'));
  openSheet(titles[type], body);
}

function presets(values, input, initial) {
  const wrap = h('div', { class: 'presets' });
  const buttons = values.map((v) => h('button', { class: 'preset' + (v === initial ? ' is-active' : ''), type: 'button', text: v }));
  const mark = (value) => buttons.forEach((b) => b.classList.toggle('is-active', b.textContent === value));
  buttons.forEach((b) => b.addEventListener('click', () => { input.value = b.textContent; mark(b.textContent); }));
  input.addEventListener('input', () => mark(input.value));
  wrap.append(...buttons);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Medicines                                                            */
/* ------------------------------------------------------------------ */

function activeScheduled(day) {
  return state.medicines.filter((m) => m.active !== false && m.kind === 'scheduled' && (!m.courseEnd || m.courseEnd >= day));
}
function activePrn() {
  return state.medicines.filter((m) => m.active !== false && m.kind === 'prn');
}
function countMedOnDay(medId, day) {
  const src = day >= (state.recentFrom || '') ? state.recentEntries : state.dayEntries;
  return src.filter((e) => e.type === 'med' && e.medId === medId && e.day === day).length;
}
function lastMedEntry(medId) {
  return state.recentEntries.find((e) => e.type === 'med' && e.medId === medId) || null;
}

function renderMeds() {
  const today = todayStr();
  const sched = activeScheduled(today);
  const prn = activePrn();
  $('meds-scheduled').replaceChildren(...sched.map((m) => medCard(m, today)));
  if (!sched.length) $('meds-scheduled').append(h('p', { class: 'empty', text: 'No scheduled medicines.' }));
  $('meds-prn').replaceChildren(...prn.map((m) => medCard(m, today)));
  if (!prn.length) $('meds-prn').append(h('p', { class: 'empty', text: 'No when-needed medicines.' }));
}

function prnStatus(m) {
  const today = todayStr();
  const last = lastMedEntry(m.id);
  const countToday = countMedOnDay(m.id, today);
  if (m.maxPerDay && countToday >= m.maxPerDay) return { level: 'red', text: `Maximum ${m.maxPerDay} today reached`, block: true };
  if (m.minGapHours && last) {
    const d = entryDate(last);
    const since = hoursAgo(d);
    if (since < m.minGapHours) {
      const next = new Date(d.getTime() + m.minGapHours * 36e5);
      return { level: 'amber', text: 'Next from ' + fmtTime(next), block: true };
    }
  }
  return { level: 'green', text: 'Can be given now', block: false };
}

function medCard(m, today) {
  const count = countMedOnDay(m.id, today);
  const last = lastMedEntry(m.id);
  const card = h('div', { class: 'card med' });
  const head = h('div', { class: 'med-head' },
    h('div', null,
      h('div', { class: 'med-name', text: m.name }),
      h('div', { class: 'med-dose', text: m.dose }),
      h('div', { class: 'med-how', text: m.how })
    ),
    m.purpose ? h('span', { class: 'med-purpose', text: m.purpose }) : null
  );
  card.append(head);

  const status = h('div', { class: 'med-status' });
  if (m.kind === 'scheduled') {
    const perDay = m.perDay || 1;
    const dots = h('div', { class: 'dots' });
    for (let i = 0; i < perDay; i++) dots.append(h('span', { class: 'dot' + (i < count ? ' is-done' : '') }));
    status.append(dots, h('span', { class: 'med-last', text: `${Math.min(count, perDay)} of ${perDay} today` }));
    if (count >= perDay) { card.classList.add('is-complete'); status.append(h('span', { class: 'pill pill-green', text: 'Done for today' })); }
    if (m.courseEnd) status.append(h('span', { class: 'pill pill-teal', text: 'Course ends ' + fmtDayShort(m.courseEnd) }));
  } else {
    const s = prnStatus(m);
    status.append(h('span', { class: 'pill pill-' + s.level, text: s.text }));
    if (m.maxPerDay) status.append(h('span', { class: 'med-last', text: `${count} of ${m.maxPerDay} today` }));
  }
  if (last) {
    const d = entryDate(last);
    const when = last.day === today ? fmtTime(d) : fmtDayShort(last.day) + ' ' + fmtTime(d);
    status.append(h('span', { class: 'med-last', text: 'Last ' + when + ' (' + (last.addedBy || '') + ')' }));
  }
  card.append(status);

  card.append(h('div', { class: 'med-actions' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => logMed(m) }, 'Log now'),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => logMedAtTime(m) }, 'Other time')
  ));
  return card;
}

async function logMed(m, at, note) {
  if (m.kind === 'prn' && !at) {
    const s = prnStatus(m);
    if (s.block) {
      const ok = await confirmSheet(m.name, s.text + '. Log it anyway?', 'Log anyway', s.level === 'red');
      if (!ok) return;
    }
  }
  const id = await addEntry({ type: 'med', medId: m.id, medName: m.name, dose: m.dose, note: note || '', at: at || new Date() });
  toast(m.name + ' logged', { label: 'Undo', onClick: () => deleteEntry(id) });
}

function logMedAtTime(m) {
  const day = h('input', { type: 'date', value: todayStr(), max: todayStr() });
  const time = timeInput(todayStr());
  const note = h('input', { type: 'text', placeholder: 'Optional note' });
  const body = h('div', null,
    h('p', { class: 'muted', text: m.dose + '. ' + m.how }),
    h('div', { class: 'field-row' }, field('Date', day), field('Time', time)),
    field('Note', note),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => {
      if (!day.value) { toast('Please choose a date'); return; }
      closeSheet();
      logMed(m, atFromInputs(day.value, time.value), note.value.trim());
    } }, 'Save'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet(m.name, body);
}

/* Manage medicines */
$('meds-manage').addEventListener('click', openManageMeds);

function openManageMeds() {
  const list = h('div', { class: 'medlist' });
  state.medicines.forEach((m) => {
    list.append(h('div', { class: 'medrow' + (m.active === false ? ' is-inactive' : '') },
      h('span', { class: 'medrow-name', text: m.name }),
      h('span', { class: 'pill ' + (m.kind === 'prn' ? 'pill-amber' : 'pill-teal'), text: m.kind === 'prn' ? 'When needed' : 'Scheduled' }),
      h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => openEditMed(m) }, 'Edit')
    ));
  });
  const body = h('div', null,
    list,
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => openEditMed(null) }, 'Add a medicine'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Close')
  );
  openSheet('Manage medicines', body);
}

function openEditMed(m) {
  const isNew = !m;
  m = m || { name: '', dose: '', how: '', purpose: '', kind: 'scheduled', perDay: 1, active: true };
  const name = h('input', { type: 'text', value: m.name, required: true });
  const dose = h('input', { type: 'text', value: m.dose || '' });
  const how = h('input', { type: 'text', value: m.how || '' });
  const purpose = h('input', { type: 'text', value: m.purpose || '' });
  const kind = h('select', null, h('option', { value: 'scheduled', text: 'Scheduled (regular doses)' }), h('option', { value: 'prn', text: 'When needed' }));
  kind.value = m.kind || 'scheduled';
  const perDay = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '12', value: m.perDay || 1 });
  const courseEnd = h('input', { type: 'date', value: m.courseEnd || '' });
  const minGap = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.5', value: m.minGapHours || '' , placeholder: 'none' });
  const maxPerDay = h('input', { type: 'number', inputmode: 'numeric', min: '0', value: m.maxPerDay || '', placeholder: 'none' });
  const active = h('input', { type: 'checkbox' });
  active.checked = m.active !== false;

  const schedFields = h('div', null, field('Doses per day', perDay), field('Course ends (optional)', courseEnd));
  const prnFields = h('div', null, field('Minimum hours between doses', minGap), field('Maximum doses per day', maxPerDay));
  const sync = () => { schedFields.hidden = kind.value !== 'scheduled'; prnFields.hidden = kind.value !== 'prn'; };
  kind.addEventListener('change', sync);
  sync();

  const body = h('div', null,
    field('Name', name), field('Dose', dose), field('How and when', how), field('What it is for', purpose),
    field('Type', kind), schedFields, prnFields,
    isNew ? null : h('label', { class: 'check' }, active, h('span', { text: 'Currently in use' })),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      if (!name.value.trim()) { toast('Please enter a name'); return; }
      const data = {
        name: name.value.trim(), dose: dose.value.trim(), how: how.value.trim(), purpose: purpose.value.trim(),
        kind: kind.value, active: active.checked,
        order: m.order || (Math.max(0, ...state.medicines.map((x) => x.order || 0)) + 1)
      };
      if (kind.value === 'scheduled') {
        data.perDay = Math.max(1, parseInt(perDay.value, 10) || 1);
        data.courseEnd = courseEnd.value || null;
        data.minGapHours = null; data.maxPerDay = null;
      } else {
        data.minGapHours = parseFloat(minGap.value) || null;
        data.maxPerDay = parseInt(maxPerDay.value, 10) || null;
        data.perDay = null; data.courseEnd = null;
      }
      const ref = isNew ? doc(collection(db, 'medicines')) : doc(db, 'medicines', m.id);
      closeSheet();
      try {
        await setDoc(ref, data, { merge: true });
        toast(isNew ? 'Medicine added' : 'Medicine updated');
      } catch (e) { console.error(e); toast('Could not save medicine'); }
    } }, isNew ? 'Add medicine' : 'Save changes'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: openManageMeds }, 'Back')
  );
  openSheet(isNew ? 'Add medicine' : 'Edit medicine', body);
}

/* ------------------------------------------------------------------ */
/* Trends                                                               */
/* ------------------------------------------------------------------ */

document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
  state.trendRange = parseInt(b.dataset.range, 10);
  document.querySelectorAll('.seg').forEach((x) => x.classList.toggle('is-active', x === b));
  renderTrends();
}));

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

async function renderTrends() {
  try {
    await loadScript(CDN.chart);
  } catch (e) { toast('Charts need a connection'); return; }
  const from = addDays(todayStr(), -(state.trendRange - 1));
  let entries;
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('day', '>=', from)));
    entries = snap.docs.map((d) => d.data());
  } catch (e) { console.error(e); return; }
  entries.sort((a, b) => entryDate(a) - entryDate(b));

  const ink = cssVar('--ink-soft'), line = cssVar('--line'), teal = cssVar('--teal'), red = cssVar('--red'), amber = cssVar('--amber');
  const Chart = window.Chart;
  Chart.defaults.font.family = cssVar('--font-mono') || 'monospace';
  Chart.defaults.font.size = 13;
  Chart.defaults.color = ink;

  const days = [];
  for (let i = 0; i < state.trendRange; i++) days.push(addDays(from, i));
  const dayLabel = (s) => parseDay(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  /* Temperature: points in time across the range */
  const temps = entries.filter((e) => e.type === 'temp');
  const tPoints = temps.map((e) => ({ x: entryDate(e).getTime(), y: Number(e.value) }));
  const start = parseDay(from).getTime(), end = parseDay(addDays(todayStr(), 1)).getTime();
  const tickDays = days.map((s) => parseDay(s).getTime());
  makeChart('temp', {
    type: 'line',
    data: { datasets: [
      { label: 'Temperature', data: tPoints, borderColor: teal, backgroundColor: teal, pointRadius: 5, pointHoverRadius: 7, tension: 0.25,
        pointBackgroundColor: (ctx) => { const v = ctx.raw && ctx.raw.y; return v >= 38 ? red : v >= 37.5 ? amber : teal; },
        pointBorderColor: (ctx) => { const v = ctx.raw && ctx.raw.y; return v >= 38 ? red : v >= 37.5 ? amber : teal; } },
      { label: '38.0', data: [{ x: start, y: 38 }, { x: end, y: 38 }], borderColor: red, borderDash: [6, 6], pointRadius: 0, borderWidth: 2 },
      { label: '37.5', data: [{ x: start, y: 37.5 }, { x: end, y: 37.5 }], borderColor: amber, borderDash: [4, 6], pointRadius: 0, borderWidth: 2 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { type: 'linear', min: start, max: end, grid: { color: line }, ticks: { maxRotation: 0, autoSkip: true, callback: (v) => { const t = tickDays.indexOf(v); return t >= 0 ? dayLabel(days[t]) : ''; }, stepSize: 864e5 }, afterBuildTicks: (axis) => { axis.ticks = tickDays.map((t) => ({ value: t })); } },
        y: { min: 35, max: 40.5, grid: { color: line }, ticks: { stepSize: 0.5, callback: (v) => v.toFixed(1) } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: (items) => items.length ? new Date(items[0].raw.x).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '',
        label: (item) => item.raw.y.toFixed(1) + ' °C'
      } } }
    }
  });

  /* Drinks per day */
  const perDay = days.map((d) => entries.filter((e) => e.type === 'drink' && e.day === d).reduce((s, e) => s + (Number(e.value) || 0), 0));
  makeChart('drink', {
    type: 'bar',
    data: { labels: days.map(dayLabel), datasets: [{ label: 'ml', data: perDay, backgroundColor: teal, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true, grid: { color: line }, ticks: { callback: (v) => v + ' ml' } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => i.raw + ' ml' } } } }
  });

  /* Weight */
  const weights = entries.filter((e) => e.type === 'weight');
  makeChart('weight', {
    type: 'line',
    data: { labels: weights.map((e) => dayLabel(e.day)), datasets: [{ label: 'kg', data: weights.map((e) => Number(e.value)), borderColor: teal, backgroundColor: teal, pointRadius: 5, tension: 0.25 }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { grid: { color: line }, ticks: { callback: (v) => v + ' kg' } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => Number(i.raw).toFixed(1) + ' kg' } } } }
  });
}

function makeChart(key, cfg) {
  if (state.charts[key]) { state.charts[key].destroy(); }
  const canvas = $('chart-' + key);
  state.charts[key] = new window.Chart(canvas.getContext('2d'), cfg);
}

/* ------------------------------------------------------------------ */
/* Documents                                                            */
/* ------------------------------------------------------------------ */

function showDocsList() {
  state.currentDoc = null;
  $('doc-detail').hidden = true;
  $('docs-list-wrap').hidden = false;
}

$('doc-back').addEventListener('click', showDocsList);

function renderDocsList() {
  const list = $('docs-list');
  list.replaceChildren(...state.documents.map((d) => h('li', null,
    h('button', { class: 'docitem', type: 'button', onclick: () => openDocument(d.id) },
      h('span', { class: 'docitem-icon', text: d.kind === 'text' ? '📄' : '🖼' }),
      h('div', { class: 'docitem-main' },
        h('div', { class: 'docitem-title', text: d.title }),
        h('div', { class: 'docitem-sub', text: [fmtDayNum(d.docDate || ''), d.kind === 'text' ? 'Text' : (d.pageCount === 1 ? '1 page' : d.pageCount + ' pages'), d.explanation ? 'Explained' : 'No explanation yet'].join(' · ') })
      ),
      h('span', { class: 'pill ' + (d.explanation ? 'pill-green' : 'pill-amber'), text: d.explanation ? '✓' : '?' })
    )
  )));
  $('docs-empty').hidden = state.documents.length > 0;
  if (state.currentDoc) {
    const d = state.documents.find((x) => x.id === state.currentDoc.id);
    if (!d) showDocsList();
  }
}

$('doc-add').addEventListener('click', openAddDocument);

function openAddDocument() {
  const title = h('input', { type: 'text', placeholder: 'e.g. Oncology letter', required: true });
  const date = h('input', { type: 'date', value: todayStr() });
  const file = h('input', { type: 'file', accept: 'image/*,.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain', multiple: true });
  const progress = h('div', { class: 'progress' }, h('span', { text: '' }), h('div', { class: 'progress-bar' }, h('div')));
  progress.hidden = true;
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Save document');
  const cancel = h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel');
  const setProgress = (text, frac) => { progress.hidden = false; progress.firstChild.textContent = text; progress.querySelector('.progress-bar > div').style.width = Math.round((frac || 0) * 100) + '%'; };

  save.addEventListener('click', async () => {
    if (!title.value.trim()) { toast('Please give it a title'); return; }
    if (!file.files.length) { toast('Please choose a photo or file'); return; }
    save.disabled = true; cancel.disabled = true;
    try {
      const result = await processFiles(Array.from(file.files), setProgress);
      setProgress('Saving', 0.95);
      await saveDocument(title.value.trim(), date.value || todayStr(), result);
      closeSheet();
      toast('Document saved');
    } catch (e) {
      console.error(e);
      toast(e.message || 'Could not process that file');
      save.disabled = false; cancel.disabled = false;
      progress.hidden = true;
    }
  });

  const body = h('div', null,
    field('Title', title), field('Date on the document', date),
    field('Photos or file', file),
    h('p', { class: 'hint', text: 'Photos, PDF, Word (.docx) or text. Photos and PDF pages are shrunk to fit. One document at a time.' }),
    progress, save, cancel
  );
  openSheet('Add document', body);
}

async function processFiles(files, onProgress) {
  const pages = [];
  let text = '';
  let kind = 'images';
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isDocx = (f) => /\.docx$/i.test(f.name) || f.type.includes('wordprocessingml');
  const isTxt = (f) => f.type === 'text/plain' || /\.txt$/i.test(f.name);

  if (files.some(isDocx) || files.some(isTxt)) {
    if (files.length > 1) throw new Error('Text files must be added one at a time');
    kind = 'text';
    const f = files[0];
    onProgress('Reading text', 0.3);
    if (isDocx(f)) {
      await loadScript(CDN.mammoth);
      const res = await window.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
      text = res.value || '';
    } else {
      text = await f.text();
    }
    text = text.replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error('No text found in that file');
    if (new Blob([text]).size > TEXT_LIMIT_BYTES) {
      text = text.slice(0, TEXT_LIMIT_BYTES * 0.9) + '\n\n[Text cut short to fit the size limit]';
    }
    return { kind, text, pages };
  }

  let step = 0;
  const total = files.length;
  for (const f of files) {
    if (isPdf(f)) {
      onProgress('Opening PDF', step / total);
      await loadScript(CDN.pdf);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
      const pdf = await window.pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        onProgress(`PDF page ${p} of ${pdf.numPages}`, (step + (p - 1) / pdf.numPages) / total);
        const page = await pdf.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, PAGE_MAX_DIM / Math.max(base.width, base.height));
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        pages.push(await compressCanvas(canvas));
      }
    } else if (f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)) {
      onProgress(`Photo ${step + 1} of ${total}`, step / total);
      const canvas = await imageToCanvas(f);
      pages.push(await compressCanvas(canvas));
    } else {
      throw new Error('Unsupported file: ' + f.name);
    }
    step++;
  }
  if (!pages.length) throw new Error('Nothing to save');
  return { kind, text: '', pages };
}

function imageToCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PAGE_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

async function compressCanvas(canvas) {
  const qualities = [0.8, 0.7, 0.6, 0.5, 0.4];
  let current = canvas;
  for (let round = 0; round < 6; round++) {
    for (const q of qualities) {
      const dataUrl = current.toDataURL('image/jpeg', q);
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (b64.length <= PAGE_LIMIT_BYTES) return { data: b64, width: current.width, height: current.height };
    }
    const next = document.createElement('canvas');
    next.width = Math.round(current.width * 0.8);
    next.height = Math.round(current.height * 0.8);
    next.getContext('2d').drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  throw new Error('Could not shrink a page enough to store it');
}

async function saveDocument(title, docDate, result) {
  const data = {
    title, docDate, kind: result.kind, pageCount: result.pages.length,
    explanation: '', addedBy: state.name, addedAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  if (result.kind === 'text') data.text = result.text;
  const ref = await addDoc(collection(db, 'documents'), data);
  for (let i = 0; i < result.pages.length; i++) {
    const p = result.pages[i];
    await setDoc(doc(db, 'documents', ref.id, 'pages', String(i + 1)), { n: i + 1, data: p.data, width: p.width, height: p.height });
  }
}

async function openDocument(id) {
  const d = state.documents.find((x) => x.id === id);
  if (!d) return;
  state.currentDoc = { id, pages: [] };
  $('docs-list-wrap').hidden = true;
  $('doc-detail').hidden = false;
  $('doc-title').textContent = d.title;
  $('doc-meta').textContent = `${fmtDayNum(d.docDate || '')} · added by ${d.addedBy || ''}`;
  $('doc-explanation').value = d.explanation || '';
  const pagesEl = $('doc-pages'), textEl = $('doc-text');
  pagesEl.replaceChildren();
  textEl.hidden = true;
  window.scrollTo(0, 0);
  if (d.kind === 'text') {
    textEl.textContent = d.text || '';
    textEl.hidden = false;
    return;
  }
  pagesEl.append(h('p', { class: 'muted', text: 'Loading pages' }));
  try {
    const snap = await getDocs(query(collection(db, 'documents', id, 'pages'), orderBy('n')));
    if (!state.currentDoc || state.currentDoc.id !== id) return;
    state.currentDoc.pages = snap.docs.map((p) => p.data());
    pagesEl.replaceChildren(...state.currentDoc.pages.map((p, i) => h('img', { src: 'data:image/jpeg;base64,' + p.data, alt: `Page ${i + 1}`, width: p.width, height: p.height, loading: 'lazy' })));
    if (!state.currentDoc.pages.length) pagesEl.append(h('p', { class: 'empty', text: 'No pages found.' }));
  } catch (e) {
    console.error(e);
    pagesEl.replaceChildren(h('p', { class: 'error', text: 'Could not load the pages.' }));
  }
}

function currentDocRecord() {
  return state.currentDoc ? state.documents.find((x) => x.id === state.currentDoc.id) : null;
}

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function promptFor(d) {
  return `${CLAUDE_PROMPT}\n\nDocument: ${d.title} (dated ${fmtDayNum(d.docDate || '')}).`;
}

$('doc-share').addEventListener('click', async () => {
  const d = currentDocRecord();
  if (!d) return;
  const text = d.kind === 'text' ? promptFor(d) + '\n\n' + (d.text || '') : promptFor(d);
  const payload = { title: d.title, text };
  if (d.kind !== 'text' && state.currentDoc.pages.length) {
    payload.files = state.currentDoc.pages.map((p, i) => new File([b64ToBlob(p.data, 'image/jpeg')], `${slug(d.title)}-page-${i + 1}.jpg`, { type: 'image/jpeg' }));
    if (!(navigator.canShare && navigator.canShare({ files: payload.files }))) delete payload.files;
  }
  if (!navigator.share) {
    await copyText(text);
    toast('Sharing is not available here. Prompt copied instead.');
    return;
  }
  try {
    await navigator.share(payload);
  } catch (e) {
    if (e && e.name !== 'AbortError') { await copyText(text); toast('Could not share. Prompt copied instead.'); }
  }
});

$('doc-copy').addEventListener('click', async () => {
  const d = currentDocRecord();
  if (!d) return;
  const text = d.kind === 'text' ? promptFor(d) + '\n\n' + (d.text || '') : promptFor(d) + '\n\n(Attach the page photos in Claude.)';
  await copyText(text);
  toast('Copied. Paste it into the Claude app.');
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
  }
}

function slug(s) { return (s || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document'; }

$('doc-save-explanation').addEventListener('click', async () => {
  const d = currentDocRecord();
  if (!d) return;
  const btn = $('doc-save-explanation');
  btn.disabled = true;
  try {
    await updateDoc(doc(db, 'documents', d.id), { explanation: $('doc-explanation').value.trim(), updatedAt: serverTimestamp() });
    toast('Explanation saved');
  } catch (e) { console.error(e); toast('Could not save'); }
  btn.disabled = false;
});

$('doc-delete').addEventListener('click', async () => {
  const d = currentDocRecord();
  if (!d) return;
  if (!(await confirmSheet('Delete document', `Delete "${d.title}" and its explanation? This cannot be undone.`, 'Delete', true))) return;
  try {
    const snap = await getDocs(collection(db, 'documents', d.id, 'pages'));
    for (const p of snap.docs) await deleteDoc(p.ref);
    await deleteDoc(doc(db, 'documents', d.id));
    showDocsList();
    toast('Document deleted');
  } catch (e) { console.error(e); toast('Could not delete'); }
});

/* ------------------------------------------------------------------ */
/* More: calls and profile                                              */
/* ------------------------------------------------------------------ */

function renderCalls() {
  const wrap = $('calls');
  const calls = (state.profile && state.profile.calls) || [];
  wrap.replaceChildren(...calls.map((c) => h('div', { class: 'card callcard' },
    h('div', null, h('div', { class: 'call-label', text: c.label }), h('div', { class: 'call-number', text: c.number })),
    h('a', { class: 'btn btn-primary', href: 'tel:' + String(c.number || '').replace(/[^+\d]/g, '') }, 'Call')
  )));
  if (!calls.length) wrap.append(h('p', { class: 'empty', text: 'No numbers saved yet. Add the ward, hospice or GP so they are one tap away.' }));
}

$('calls-edit').addEventListener('click', () => {
  const rows = h('div', { class: 'editlist' });
  const addRow = (c) => {
    const label = h('input', { type: 'text', value: (c && c.label) || '', placeholder: 'e.g. Ward' });
    const number = h('input', { type: 'tel', value: (c && c.number) || '', placeholder: '01234 567890' });
    const row = h('div', { class: 'editrow' }, field('Name', label), field('Number', number),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove', onclick: () => row.remove() }, '×'));
    rows.append(row);
  };
  ((state.profile && state.profile.calls) || []).forEach(addRow);
  if (!rows.children.length) addRow(null);
  const body = h('div', null,
    rows,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => addRow(null) }, 'Add another'),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const calls = [];
      rows.querySelectorAll('.editrow').forEach((r) => {
        const [l, n] = r.querySelectorAll('input');
        if (l.value.trim() && n.value.trim()) calls.push({ label: l.value.trim(), number: n.value.trim() });
      });
      closeSheet();
      try { await setDoc(doc(db, 'profile', 'main'), { calls }, { merge: true }); toast('Numbers saved'); }
      catch (e) { console.error(e); toast('Could not save'); }
    } }, 'Save'),
    h('button', { class: 'btn btn-link btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Who to call', body);
});

/* ------------------------------------------------------------------ */
/* Housekeeping                                                         */
/* ------------------------------------------------------------------ */

$('app-version').textContent = 'Version ' + APP_VERSION;

function updateOnline() { $('offline-pill').hidden = navigator.onLine; }
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

/* Roll over at midnight or when the app comes back to the foreground */
function checkDayRollover() {
  if (!state.user) return;
  const today = todayStr();
  const expectedFrom = addDays(today, -1);
  if (state.recentFrom && state.recentFrom !== expectedFrom) {
    const previousToday = addDays(state.recentFrom, 1);
    if (state.selectedDay === previousToday) state.selectedDay = today;
    watchRecent();
    watchDay();
  }
  renderMeds();
}
setInterval(checkDayRollover, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayRollover(); });

/* Service worker: registered with the GitHub Pages scope /Mark_Medical/ (derived from the page URL so it also works locally) */
if ('serviceWorker' in navigator) {
  const scope = new URL('./', location.href).pathname;
  navigator.serviceWorker.register('sw.js', { scope }).catch((e) => console.warn('SW registration failed', e));
}
