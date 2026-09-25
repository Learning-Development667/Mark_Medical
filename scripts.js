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
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const APP_VERSION = '34';
/* Printed PDFs are always on white paper, so they use the light teal regardless of the screen's colour scheme */
const PDF_TEAL = '#1E5F74';
const PAGE_LIMIT_BYTES = 850 * 1024;   // base64 characters per page document (hard cap is 900 KB)
const TEXT_LIMIT_BYTES = 800 * 1024;
const PAGE_MAX_DIM = 1600;
const MAX_PAGES = 30;

const CDN = {
  chart: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
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

const CLAUDE_INTRO = 'Please explain this medical document in plain English for a patient and their family. ' +
  'Tell us what it says, what it means for day-to-day care, anything we need to act on, and any questions we might want to ask the medical team. ' +
  'Keep it calm and clear.';

const CLAUDE_FORMAT = 'Reply using exactly this format, so it can be pasted straight back into Care Log:\n\n' +
  '=== CARE LOG DOCUMENT ===\n' +
  'Title: <a short title for this document>\n' +
  'Date: <the date on the document, YYYY-MM-DD>\n' +
  'Explanation:\n' +
  '<your explanation, in plain English, as multi-line text>\n' +
  '=== END ===';

const NOT_MEDICAL_ADVICE = 'This explanation is for context only. It is not medical advice. Always check changes with the medical team.';

/* Mood scale for the Chemo Party Plan, 1 (rough) to 5 (great). */
const MOODS = [
  { label: 'Rough' },
  { label: 'Low' },
  { label: 'OK' },
  { label: 'Good' },
  { label: 'Great' }
];

/* Mood on the chemo calendar: a filled dot (OK, Good, Great) or a ring (Low, Rough)
   on a calm teal-to-warm scale. Shape and colour both carry it; never emoji. */
function moodMark(level) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', 'cal-face mood-' + level);
  svg.setAttribute('aria-hidden', 'true');
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', '6'); c.setAttribute('cy', '6');
  c.setAttribute('r', level >= 3 ? '5' : '4');
  c.setAttribute('class', level >= 3 ? 'mood-fill' : 'mood-ring');
  svg.append(c);
  return svg;
}

/* Daily exercise goals. Defaults are what Mark asked for; editable in the app and
   stored on profile/main.exerciseGoals. Plank is stored in seconds. */
const GOAL_DEFAULTS = { pressups: 20, situps: 20, plankSeconds: 60, squats: 2 };
const GOAL_ROWS = [
  { key: 'pressups', label: 'Press-ups', goal: 'pressups', fmt: (n) => n + ' a day' },
  { key: 'situps', label: 'Sit-ups', goal: 'situps', fmt: (n) => n + ' a day' },
  { key: 'plank', label: 'Plank', goal: 'plankSeconds', fmt: (sec) => sec % 60 === 0 ? (sec / 60) + (sec === 60 ? ' minute' : ' minutes') : sec + ' seconds' },
  { key: 'squats', label: 'Squats', goal: 'squats', fmt: (n) => n + ' a day' }
];

const CARE_LOG_BLOCK_RE = /===\s*CARE LOG DOCUMENT\s*===\s*\nTitle:\s*(.*)\nDate:\s*(\d{4}-\d{2}-\d{2})\nExplanation:\s*\n([\s\S]*?)\n===\s*END\s*===/g;

function parseCareLogBlocks(text) {
  const clean = (text || '').replace(/\r\n/g, '\n');
  const out = [];
  let m;
  CARE_LOG_BLOCK_RE.lastIndex = 0;
  while ((m = CARE_LOG_BLOCK_RE.exec(clean))) {
    out.push({ title: m[1].trim(), date: m[2].trim(), explanation: m[3].trim() });
  }
  return out;
}

/* Reads the clipboard into an Explanation textarea, smart-filling title and date
   when the paste contains a === CARE LOG DOCUMENT === block. Falls back to
   focusing the textarea (for a manual long-press paste) if clipboard access fails. */
async function pasteSummaryInto({ titleEl, dateEl, explanationEl, onFilled }) {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    explanationEl.focus();
    toast('Could not read the clipboard. Long-press the box below and paste.');
    return;
  }
  if (!text || !text.trim()) {
    explanationEl.focus();
    toast('Clipboard is empty. Long-press the box below and paste.');
    return;
  }
  const blocks = parseCareLogBlocks(text);
  if (blocks.length) {
    const first = blocks[0];
    if (titleEl && first.title) titleEl.value = first.title;
    if (dateEl && first.date) dateEl.value = first.date;
    explanationEl.value = first.explanation;
    toast(blocks.length > 1 ? 'Only the first letter was used. Add the others one at a time.' : 'Summary filled in');
  } else {
    explanationEl.value = text.trim();
    toast('Pasted into Explanation');
  }
  explanationEl.dispatchEvent(new Event('input'));
  if (onFilled) onFilled();
}

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

function icon(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
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

/* Counts a tile value up on first paint and eases between values after that.
   Repaints instantly when the value has not changed, and under reduced motion. */
function countTo(el, target, opts) {
  const o = Object.assign({ decimals: 0, unit: '', duration: 650 }, opts || {});
  const fmt = o.format || ((n) => n.toFixed(o.decimals));
  const paint = (n) => { el.replaceChildren(fmt(n)); if (o.unit) el.append(h('small', { text: o.unit })); };
  const prev = el.dataset.count === undefined ? 0 : Number(el.dataset.count);
  const same = el.dataset.painted === '1' && prev === target;
  el.dataset.count = String(target);
  el.dataset.painted = '1';
  if (same || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { paint(target); return; }
  if (el._raf) cancelAnimationFrame(el._raf);
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const t = Math.min(1, (now - start) / o.duration);
    paint(prev + (target - prev) * ease(t));
    if (t < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}
function clearCount(el, text) { el.textContent = text; el.dataset.count = '0'; el.dataset.painted = '0'; if (el._raf) cancelAnimationFrame(el._raf); }
function fmtHm(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const hh = Math.floor(m / 60), mm = m % 60;
  if (!hh) return mm + ' min';
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

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
function openSheet(title, body, onClose) {
  $('sheet-title').textContent = title;
  const b = $('sheet-body');
  b.replaceChildren(body);
  $('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  /* Runs (fire-and-forget, same as the rest of the app's save calls) however the sheet is
     closed: Done, the round X, or tapping the backdrop, not just a screen's own Save button. */
  state.sheetOnClose = onClose || null;
  const first = b.querySelector('input:not([type=hidden]), textarea');
  if (first && first.type !== 'file' && window.matchMedia('(min-width: 700px)').matches) first.focus();
}
function closeSheet() {
  if (state.sheetOnClose) { const fn = state.sheetOnClose; state.sheetOnClose = null; fn(); }
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

/* config.js users map: a value is either a plain name (full family access) or
   { name, role: "viewer" } for someone with read-only access to Meds, Chemo
   and Trends only. Never anything else, and never a write. */
const USERS = {};
for (const [email, entry] of Object.entries(CONFIG.users || {})) {
  const key = email.toLowerCase();
  USERS[key] = typeof entry === 'string' ? { name: entry, role: 'family' } : { name: entry.name, role: entry.role || 'family' };
}

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
  foodRange: 14,
  notesRange: 14,
  notesText: '',
  notesPdf: null,
  foodPdf: null,
  meals: [],
  currentDoc: null,
  docsReturn: 'more',
  reportReturn: 'vitals',
  days: {},
  cheers: [],
  exercise: {},
  exerciseDay: todayStr(),
  chemoMonth: todayStr().slice(0, 7),
  demo: false,
  demoPages: {},
  viewer: false
};

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

function nameFor(email) {
  const key = (email || '').toLowerCase();
  if (USERS[key]) return USERS[key].name;
  return key.split('@')[0] || 'Unknown';
}

function isViewerEmail(email) {
  const key = (email || '').toLowerCase();
  return Boolean(USERS[key]) && USERS[key].role === 'viewer';
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
    state.demo = false;
    state.viewer = isViewerEmail(user.email);
    $('signin').hidden = true;
    $('app').hidden = false;
    requestAnimationFrame(moveTabIndicator);
    $('user-chip').textContent = state.name;
    $('more-user').textContent = `${state.name} (${user.email})`;
    $('guest-pill').hidden = true;
    $('viewer-pill').hidden = !state.viewer;
    $('signin-password').value = '';
    setViewerMode(state.viewer);
    if (!state.viewer) showTab('today'); // always a known landing tab, even right after a viewer session on the same device
    await startData();
  } else if (!state.demo) {
    stopData();
    state.user = null;
    state.viewer = false;
    setViewerMode(false);
    $('app').hidden = true;
    $('signin').hidden = false;
  }
});

/* Viewer mode: read-only relatives see Meds, Chemo and Trends only, with every
   add/edit/delete control on those three hidden, and land on Meds rather than
   Today (which mixes in food, drink and personal notes they were not given). */
function setViewerMode(on) {
  document.body.classList.toggle('is-viewer', on);
  $('tabs').classList.toggle('tabs-3', on);
  document.querySelectorAll('.tab[data-tab="today"], .tab[data-tab="exercise"], .tab[data-tab="more"]').forEach((b) => { b.hidden = on; });
  if (on) showTab('meds');
}

/* Guest preview: no Firebase account, no Firestore access, ever. Everything
   this shows is made-up (see buildDemoFixture); nothing typed here is saved. */
function enterPreview() {
  state.demo = true;
  state.name = 'Guest';
  state.viewer = false;
  setViewerMode(false);
  $('signin').hidden = true;
  $('app').hidden = false;
  requestAnimationFrame(moveTabIndicator);
  $('user-chip').textContent = 'Guest';
  $('more-user').textContent = 'Guest (preview, nothing saved)';
  $('guest-pill').hidden = false;
  startDemoData();
}
$('guest-button').addEventListener('click', enterPreview);

function exitPreview() {
  stopData();
  state.demo = false;
  $('guest-pill').hidden = true;
  $('app').hidden = true;
  $('signin').hidden = false;
}

$('signout').addEventListener('click', async () => {
  if (state.demo) {
    if (await confirmSheet('Leave preview', 'Go back to the sign-in screen?', 'Leave preview', false)) exitPreview();
    return;
  }
  if (await confirmSheet('Sign out', 'You will need your password to sign back in.', 'Sign out', true)) signOut(auth);
});

/* ------------------------------------------------------------------ */
/* Data                                                                 */
/* ------------------------------------------------------------------ */

async function startData() {
  watchMedicines();
  watchRecent();
  watchDay();
  watchDays();
  if (state.viewer) return; // Meds, Chemo (via watchDays above) and Trends only, nothing else, no writes
  await seedMedicinesIfEmpty();
  watchDocuments();
  watchProfile();
  watchCheers();
  watchExercise();
  watchMeals();
}

function stopData() {
  for (const k of Object.keys(state.unsub)) { try { state.unsub[k](); } catch (e) { /* ignore */ } }
  state.unsub = {};
}

/* ------------------------------------------------------------------ */
/* Guest preview mode                                                    */
/* A signed-in user whose display name (mapped in config.js) is exactly  */
/* "Guest" never touches Firestore. Everything is realistic made-up data,*/
/* held only in memory, and every quick add, edit and delete above       */
/* writes into that same in-memory state instead of the real database,  */
/* so the whole app is fully explorable without ever exposing Mark's or  */
/* Shelley's real health information.                                   */
/* ------------------------------------------------------------------ */

function demoTs(d) { return { toDate: () => d }; }
let demoIdSeq = 1;
function fakeId(prefix) { return prefix + '-demo-' + (demoIdSeq++); }

function buildDemoFixture() {
  const day = (offset) => addDays(todayStr(), offset);
  const at = (offset, hhmm) => { const [hh, mm] = hhmm.split(':').map(Number); const d = parseDay(day(offset)); d.setHours(hh, mm, 0, 0); return d; };
  const e = (offset, hhmm, who, fields) => ({
    id: fakeId('entry'), day: day(offset), at: demoTs(at(offset, hhmm)), addedBy: who, createdAt: demoTs(at(offset, hhmm)), note: '', ...fields
  });
  const ci = (offset, slot, fields) => {
    const when = at(offset, slot === 'morning' ? '08:30' : '21:00');
    return { id: day(offset) + '_' + slot, type: 'checkin', slot, day: day(offset), at: demoTs(when), addedBy: 'Mark', createdAt: demoTs(when), updatedAt: demoTs(when), ...fields };
  };

  const entries = [
    e(-9, '08:00', 'Shelley', { type: 'temp', value: 36.9 }),
    e(-6, '07:40', 'Mark', { type: 'sleep', value: 410 }),
    e(-5, '07:45', 'Mark', { type: 'sleep', value: 430, deep: 65, rem: 50, core: 290, awake: 25 }),
    e(-4, '08:05', 'Mark', { type: 'sleep', value: 275, note: 'Up twice with back pain' }),
    e(-3, '07:30', 'Mark', { type: 'sleep', value: 395 }),
    e(-1, '07:50', 'Mark', { type: 'sleep', value: 440 }),
    e(0, '07:55', 'Mark', { type: 'sleep', value: 428, deep: 70, rem: 53, core: 305, awake: 25, bedAt: '22:10', wokeAt: '07:05' }),
    e(-9, '09:00', 'Mark', { type: 'vitals', heartRate: 76 }),
    e(-9, '07:30', 'Mark', { type: 'weight', value: 78.8 }),
    e(-8, '10:00', 'Shelley', { type: 'drink', value: 300, note: 'Water' }),
    e(-8, '08:00', 'Mark', { type: 'food', note: 'Porridge', detail: 'honey and banana', amount: 'All of it' }),
    e(-8, '18:30', 'Shelley', { type: 'food', note: 'Homity pie', detail: 'peas, mash, gravy', amount: 'About half' }),
    e(-7, '15:00', 'Mark', { type: 'temp', value: 37.7, note: 'Felt shivery after lunch' }),
    e(-7, '15:05', 'Mark', { type: 'vitals', heartRate: 104, systolic: 128, diastolic: 82, oxygen: 95 }),
    e(-7, '20:30', 'Shelley', { type: 'med', medId: 'oramorph', medName: 'Oramorph 10mg/5ml', dose: '2.5 ml (5 mg)', note: 'Back pain, worse lying down' }),
    e(-7, '15:10', 'Mark', { type: 'note', note: 'A bit more tired after today’s session.' }),
    e(-6, '08:00', 'Shelley', { type: 'temp', value: 37.0 }),
    e(-6, '07:30', 'Mark', { type: 'weight', value: 78.5 }),
    e(-6, '09:00', 'Mark', { type: 'drink', value: 200, note: 'Tea' }),
    e(-5, '08:30', 'Shelley', { type: 'vitals', heartRate: 72, systolic: 116, diastolic: 74, oxygen: 98 }),
    e(-5, '13:00', 'Mark', { type: 'food', note: 'Soup', amount: 'Most of it' }),
    e(-4, '08:00', 'Mark', { type: 'temp', value: 36.8 }),
    e(-4, '11:00', 'Shelley', { type: 'drink', value: 250, note: 'Water' }),
    e(-3, '09:00', 'Mark', { type: 'vitals', heartRate: 80, systolic: 122, diastolic: 79, oxygen: 96 }),
    e(-3, '07:30', 'Shelley', { type: 'weight', value: 78.6 }),
    e(-3, '14:00', 'Mark', { type: 'note', note: 'Rested and read a book in the garden.' }),
    e(-2, '08:00', 'Shelley', { type: 'temp', value: 36.9 }),
    e(-2, '08:15', 'Mark', { type: 'food', note: 'Scrambled egg on toast', detail: 'two eggs, wholemeal toast', amount: 'Most of it' }),
    e(-2, '15:00', 'Shelley', { type: 'food', note: 'Grapes', amount: 'A few mouthfuls' }),
    e(-1, '14:00', 'Mark', { type: 'temp', value: 37.6 }),
    e(-1, '14:05', 'Mark', { type: 'vitals', heartRate: 84, systolic: 124, diastolic: 80, oxygen: 95 }),
    e(-1, '16:00', 'Shelley', { type: 'drink', value: 200, note: 'Squash' }),
    e(0, '08:00', 'Mark', { type: 'med', medId: 'dalteparin', medName: 'Dalteparin injection', dose: '7,500 units' }),
    e(0, '08:10', 'Mark', { type: 'temp', value: 36.8 }),
    e(0, '08:12', 'Mark', { type: 'vitals', heartRate: 74, systolic: 118, diastolic: 76, oxygen: 97 }),
    e(0, '08:15', 'Mark', { type: 'med', medId: 'creon', medName: 'Creon 25000', dose: '2 capsules' }),
    e(0, '08:20', 'Mark', { type: 'food', note: 'Toast and scrambled egg', amount: 'Most of it' }),
    e(0, '08:25', 'Mark', { type: 'note', note: 'Slept well, a little tired by afternoon.' }),
    e(-2, '15:30', 'Mark', { type: 'pain', value: 7, note: 'Back, worse sitting' }),
    e(0, '11:40', 'Mark', { type: 'pain', value: 4 }),
    ci(-6, 'morning', { sleep: 6, sleepHours: 6.5, pain: 3, mood: 6, symptoms: '', lookingForward: 'A walk if the weather holds' }),
    ci(-6, 'evening', { pain: 4, mood: 6, worstPain: 5, sickness: 3, appetite: 5, energy: 4, symptoms: '', settled: '', goodThing: 'Fish and chips on the bench' }),
    ci(-5, 'morning', { sleep: 7, sleepHours: 7, pain: 2, mood: 7, symptoms: '', lookingForward: '' }),
    ci(-5, 'evening', { pain: 3, mood: 7, worstPain: 4, sickness: 2, appetite: 6, energy: 5, symptoms: '', settled: 'The sickness has eased', goodThing: 'Beat Shelley at cards' }),
    ci(-2, 'morning', { sleep: 4, sleepHours: 4.5, pain: 6, mood: 4, symptoms: 'Back pain woke me twice', lookingForward: '' }),
    ci(-2, 'evening', { pain: 7, mood: 4, worstPain: 8, sickness: 6, appetite: 2, energy: 3, symptoms: 'Felt sick most of the afternoon', settled: '', goodThing: 'Shelley made soup' }),
    ci(-1, 'morning', { sleep: 6, sleepHours: 7.5, pain: 4, mood: 6, symptoms: '', lookingForward: 'Quiet day' }),
    ci(-1, 'evening', { pain: 3, mood: 6, worstPain: 5, sickness: 3, appetite: 5, energy: 5, symptoms: '', settled: 'Back is easier than yesterday', goodThing: 'Sun on the patio' }),
    ci(0, 'morning', { sleep: 7, sleepHours: 7, pain: 3, mood: 7, symptoms: '', lookingForward: 'Hayley visiting later' }),
    e(0, '09:00', 'Shelley', { type: 'drink', value: 250, note: 'Water' })
  ];

  const documents = [{
    id: fakeId('doc'), category: 'general', kind: 'text',
    title: 'Oncology clinic letter (example)', docDate: day(-6),
    text: 'Dear Dr Example,\n\nThank you for reviewing this patient in clinic today. The recent CT scan shows stable disease with no new areas of concern. Bloods are within an acceptable range. We will continue the current treatment plan and review again after the next cycle.\n\nKind regards,\nDr Example',
    explanation: 'This is a sample explanation, showing what a pasted reply from Claude might look like.\n\nIn plain English, this letter says the recent scan looked the same as before, which is good news, it means things have not got worse since the last check. Bloods were fine too. Nothing needs to change with treatment right now, and the next check-in will be after the next round.\n\nWorth asking the team: what would a change on the next scan actually mean for the plan.',
    addedBy: 'Shelley', addedAt: demoTs(at(-6, '11:00')), updatedAt: demoTs(at(-6, '11:20'))
  }];

  const days = {};
  days[day(-10)] = { chemo: true, chemoDone: true, mood: 4, good: 'Watched a film with Shelley', updatedBy: 'Mark', updatedAt: demoTs(at(-10, '18:00')) };
  days[day(-7)] = { mood: 2, good: 'Shelley made soup', updatedBy: 'Mark', updatedAt: demoTs(at(-7, '19:00')) };
  days[day(-3)] = { chemo: true, chemoDone: true, mood: 3, good: 'Short walk in the garden', updatedBy: 'Mark', updatedAt: demoTs(at(-3, '18:00')) };
  days[day(4)] = { chemo: true, chemoDone: false, updatedBy: 'Mark', updatedAt: demoTs(at(-1, '09:00')) };
  days[day(0)] = { mood: 4, good: 'Cup of tea in the sun with Shelley', updatedBy: 'Mark', updatedAt: demoTs(at(0, '08:30')) };

  const cheers = [
    { id: fakeId('cheer'), text: 'Proud of you for today, ice cream later?', addedBy: 'Shelley', createdAt: demoTs(at(0, '09:15')) },
    { id: fakeId('cheer'), text: 'Feeling good today, thank you for the company yesterday x', addedBy: 'Mark', createdAt: demoTs(at(-1, '19:00')) },
    { id: fakeId('cheer'), text: 'That walk in the garden was lovely. Same again tomorrow?', addedBy: 'Shelley', createdAt: demoTs(at(-3, '17:30')) }
  ];

  const doneAll = { pressups: true, situps: true, plank: true, squats: true };
  const exercise = {};
  exercise[day(-2)] = { day: day(-2), steps: 2100, done: doneAll };
  exercise[day(-1)] = { day: day(-1), steps: 2800, done: doneAll };
  exercise[day(0)] = { day: day(0), steps: 1200, done: { pressups: true, situps: true, plank: false, squats: false } };
  exercise[day(-4)] = { day: day(-4), steps: 1600, done: { pressups: true, situps: false, plank: false, squats: true } };
  exercise[day(-6)] = { day: day(-6), steps: 900, done: {} };

  const profile = { calls: [{ label: 'Oncology ward (example)', number: '01234 567890' }, { label: 'Hospice at home (example)', number: '01234 567891' }] };

  const meals = [
    { id: fakeId('meal'), name: 'Porridge', parts: 'honey and banana', addedBy: 'Mark' },
    { id: fakeId('meal'), name: 'Homity pie', parts: 'peas, mash, gravy', addedBy: 'Shelley' },
    { id: fakeId('meal'), name: 'Scrambled egg on toast', parts: 'two eggs, wholemeal toast', addedBy: 'Mark' },
    { id: fakeId('meal'), name: 'Grapes', parts: '', addedBy: 'Shelley' },
    { id: fakeId('meal'), name: 'Cheese and crackers', parts: 'cheddar, water biscuits', addedBy: 'Shelley' }
  ];

  return { entries, documents, days, cheers, exercise, profile, meals };
}

function startDemoData() {
  const fixture = buildDemoFixture();
  state.medicines = SEED_MEDICINES.map((m, i) => ({ ...m, active: true, order: i + 1 }));
  state.recentFrom = addDays(todayStr(), -40);
  state.recentEntries = fixture.entries;
  sortEntries(state.recentEntries);
  state.dayEntries = state.recentEntries.filter((x) => x.day === state.selectedDay);
  state.documents = fixture.documents;
  state.demoPages = {};
  state.days = fixture.days;
  state.cheers = fixture.cheers;
  state.exercise = fixture.exercise;
  state.profile = fixture.profile;
  state.meals = fixture.meals;

  renderMeds();
  renderDayLabel();
  renderToday();
  renderDocsList();
  renderChemo();
  renderExercise();
  toast('Preview mode: made-up example data, nothing you do here is saved.');
  renderCalls();
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
    if (!$('view-vitals').hidden) renderVitals();
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
    renderExercise();
  }, (e) => console.error(e));
}

function watchDays() {
  state.unsub.days = onSnapshot(collection(db, 'days'), (snap) => {
    const days = {};
    snap.docs.forEach((d) => { days[d.id] = d.data(); });
    state.days = days;
    renderChemo();
  }, (e) => console.error(e));
}

function watchCheers() {
  state.unsub.cheers = onSnapshot(query(collection(db, 'cheers'), orderBy('createdAt', 'desc'), limit(50)), (snap) => {
    state.cheers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCheers();
  }, (e) => console.error(e));
}

function watchExercise() {
  state.unsub.exercise = onSnapshot(collection(db, 'exercise'), (snap) => {
    const ex = {};
    snap.docs.forEach((d) => { ex[d.id] = d.data(); });
    state.exercise = ex;
    renderExercise();
  }, (e) => console.error(e));
}

function watchMeals() {
  state.unsub.meals = onSnapshot(collection(db, 'meals'), (snap) => {
    state.meals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }, (e) => console.error(e));
}

async function addEntry(data) {
  const at = data.at instanceof Date ? data.at : new Date();
  const entry = {
    ...data,
    day: dayStr(at),
    at: state.demo ? demoTs(at) : Timestamp.fromDate(at),
    addedBy: state.name,
    createdAt: state.demo ? demoTs(new Date()) : serverTimestamp()
  };
  if (state.demo) {
    const id = fakeId('entry');
    state.recentEntries.push({ id, ...entry });
    sortEntries(state.recentEntries);
    state.dayEntries = state.recentEntries.filter((e) => e.day === state.selectedDay);
    renderToday();
    renderMeds();
    if (!$('view-vitals').hidden) renderVitals();
    return id;
  }
  const ref = doc(collection(db, 'entries'));
  setDoc(ref, entry).catch((e) => { console.error(e); toast('Could not save. It will retry when online.'); });
  return ref.id;
}

/* Change fields on an existing entry (used when a night already has an Apple Health sleep entry) */
async function updateEntry(id, data) {
  const at = data.at instanceof Date ? data.at : null;
  const fields = { ...data };
  delete fields.at;
  if (state.demo) {
    const e = state.recentEntries.find((x) => x.id === id);
    if (e) { Object.assign(e, fields); if (at) e.at = demoTs(at); }
    sortEntries(state.recentEntries);
    state.dayEntries = state.recentEntries.filter((x) => x.day === state.selectedDay);
    renderToday();
    if (!$('view-vitals').hidden) renderVitals();
    return;
  }
  const patch = { ...fields, updatedAt: serverTimestamp() };
  if (at) patch.at = Timestamp.fromDate(at);
  await updateDoc(doc(db, 'entries', id), patch);
}

function deleteEntry(id) {
  if (state.demo) {
    state.recentEntries = state.recentEntries.filter((e) => e.id !== id);
    state.dayEntries = state.dayEntries.filter((e) => e.id !== id);
    renderToday();
    renderMeds();
    return Promise.resolve();
  }
  return deleteDoc(doc(db, 'entries', id));
}

/* ------------------------------------------------------------------ */
/* Navigation                                                           */
/* ------------------------------------------------------------------ */

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

function showTab(name) {
  /* Report pages highlight the tab they were opened from (Documents can be reached from a report too) */
  let highlight = name;
  if (name === 'docs') highlight = state.docsReturn || 'more';
  if (highlight === 'food' || highlight === 'notes') highlight = state.reportReturn || 'vitals';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === highlight));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  window.scrollTo(0, 0);
  enterView(document.querySelector('.view[data-view="' + name + '"]'));
  moveTabIndicator();
  requestAnimationFrame(moveTabIndicator);
  if (name === 'vitals') renderVitals();
  if (name === 'food') renderFoodDiary();
  if (name === 'notes') renderNotesReport();
  if (name === 'chemo') renderChemo();
  if (name === 'exercise') renderExercise();
  if (name === 'docs') showDocsList();
}

/* Screen entrance: each major block of the view fades in and rises, 50ms apart (CSS does the motion) */
function enterView(view) {
  if (!view) return;
  view.classList.remove('is-entering');
  void view.offsetWidth;
  Array.from(view.children).forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 8))));
  view.classList.add('is-entering');
}

/* The tab bar's indicator slides to sit under the active tab */
function moveTabIndicator() {
  const ind = $('tab-indicator');
  const tab = document.querySelector('.tab.is-active:not([hidden])');
  if (!ind || !tab || !tab.offsetWidth) return;
  const w = Math.round(tab.offsetWidth * 0.5);
  ind.style.width = w + 'px';
  ind.style.transform = 'translateX(' + Math.round(tab.offsetLeft + (tab.offsetWidth - w) / 2) + 'px)';
}
window.addEventListener('resize', moveTabIndicator);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveTabIndicator);

/* Only rows that are new to the screen animate in; rows already shown stay put on data updates */
const seenIds = { entries: new Set(), cheers: new Set(), docs: new Set() };
function markNew(el, set, id, i) {
  if (!set.has(id)) { set.add(id); el.classList.add('is-new'); el.style.setProperty('--i', String(Math.min(i, 10))); }
  return el;
}

/* Documents is reached from More (and chemo plan documents from Chemo); remember where to go back to. */
function openDocs(from) {
  state.docsReturn = from || 'more';
  showTab('docs');
}

$('sheet').addEventListener('click', (ev) => { if (ev.target.hasAttribute('data-close')) closeSheet(); });
$('sheet-close').addEventListener('click', closeSheet);

/* ------------------------------------------------------------------ */
/* Today                                                                */
/* ------------------------------------------------------------------ */

$('day-prev').addEventListener('click', () => { state.selectedDay = addDays(state.selectedDay, -1); refreshDay(); });
$('day-next').addEventListener('click', () => {
  if (state.selectedDay >= todayStr()) return;
  state.selectedDay = addDays(state.selectedDay, 1); refreshDay();
});
$('day-label').addEventListener('click', () => { state.selectedDay = todayStr(); refreshDay(); });

/* Switching day: a live Firestore listener normally, or a local recompute in guest preview mode. */
function refreshDay() {
  if (state.demo) {
    renderDayLabel();
    state.dayEntries = state.recentEntries.filter((e) => e.day === state.selectedDay);
    renderToday();
    return;
  }
  watchDay();
}

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
  renderCheckins();
  const list = $('timeline');
  let fresh = 0;
  list.replaceChildren(...state.dayEntries.map((e) => {
    const el = renderEntry(e);
    const id = e.id || (e.type + ':' + entryDate(e).getTime());
    return seenIds.entries.has(id) ? el : markNew(el, seenIds.entries, id, fresh++);
  }));
  $('timeline-empty').hidden = state.dayEntries.length > 0;
}

function entryTitle(e) {
  switch (e.type) {
    case 'med': return [h('span', { text: e.medName || 'Medicine' })];
    case 'temp': return [h('span', { class: 'val ' + tempClass(e.value), text: Number(e.value).toFixed(1) + ' °C' })];
    case 'drink': return [h('span', { text: e.note || 'Drink' }), e.value ? h('span', { class: 'val', text: '  ' + e.value + ' ml' }) : null];
    case 'food': return [h('span', { text: e.note || 'Food' })];
    case 'sleep': return [h('span', { class: 'val', text: fmtHm(e.value) }), h('span', { text: ' asleep' })];
    case 'checkin': return [h('span', { text: slotWord(e.slot) + ' check-in' })];
    case 'pain': return [h('span', { class: 'val', text: 'Pain ' + e.value + '/10' })];
    case 'weight': return [h('span', { class: 'val', text: Number(e.value).toFixed(1) + ' kg' })];
    case 'vitals': {
      const parts = [];
      if (e.heartRate) parts.push(Math.round(e.heartRate) + ' bpm');
      if (e.systolic && e.diastolic) parts.push(Math.round(e.systolic) + '/' + Math.round(e.diastolic));
      if (e.oxygen) parts.push(Math.round(e.oxygen) + '% O2');
      return [h('span', { class: 'val', text: parts.join('  ·  ') || 'Vitals' })];
    }
    default: return [h('span', { text: e.note || 'Note' })];
  }
}

function entrySub(e) {
  const bits = [];
  if (e.type === 'med' && e.dose) bits.push(e.dose);
  if (e.type === 'med' && e.note) bits.push(e.note);
  if (e.type === 'temp' && e.note) bits.push(e.note);
  if (e.type === 'food' && e.amount) bits.push(e.amount);
  if (e.type === 'food' && e.detail) bits.push(e.detail);
  if (e.type === 'sleep') {
    if (e.bedAt || e.wokeAt) bits.push((e.bedAt || '?') + ' to ' + (e.wokeAt || '?'));
    const s = sleepStages(e); if (s) bits.push(s);
    if (e.note) bits.push(e.note);
  }
  if (e.type === 'checkin') { const s = checkinSummary(e); if (s) bits.push(s); }
  if (e.type === 'pain' && e.note) bits.push(e.note);
  if (e.type === 'weight' && e.note) bits.push(e.note);
  if (e.type === 'vitals' && e.note) bits.push(e.note);
  bits.push('by ' + (e.addedBy || 'unknown'));
  return bits.join(' · ');
}

function sleepStages(e) {
  return [['awake', 'Awake'], ['rem', 'REM'], ['core', 'Core'], ['deep', 'Deep']]
    .filter(([k]) => e[k]).map(([k, label]) => label + ' ' + fmtHm(e[k])).join(' · ');
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
    countTo($('tile-temp-value'), Number(t.value), { decimals: 1, unit: '°C' });
    $('tile-temp-sub').textContent = 'at ' + fmtTime(entryDate(t));
    const c = tempClass(t.value);
    tileT.classList.add(c || 'is-green');
  } else {
    clearCount($('tile-temp-value'), '--');
    $('tile-temp-sub').textContent = 'none today';
  }

  const drinks = entries.filter((e) => e.type === 'drink');
  const ml = drinks.reduce((s, e) => s + (Number(e.value) || 0), 0);
  countTo($('tile-drink-value'), ml, { unit: ml >= 1000 ? 'L' : 'ml', format: (n) => ml >= 1000 ? (n / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(n)) });
  $('tile-drink-sub').textContent = drinks.length === 1 ? '1 drink' : drinks.length + ' drinks';

  const sched = activeScheduled(state.selectedDay);
  const need = sched.reduce((s, m) => s + (m.perDay || 1), 0);
  const done = sched.reduce((s, m) => s + Math.min(m.perDay || 1, countMedOnDay(m.id, state.selectedDay)), 0);
  countTo($('tile-meds-value'), done, { format: (n) => Math.round(n) + ' of ' + need });
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
  let editId = null;

  if (type === 'drink') {
    const what = h('input', { type: 'text', placeholder: 'What was it?', value: 'Water' });
    const ml = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '10', value: '200' });
    const whatPresets = presets(['Water', 'Tea', 'Coffee', 'Squash', 'Juice', 'Milk', 'Supplement drink'], what, 'Water');
    const mlPresets = presets(['50', '100', '150', '200', '250', { value: '300', label: '300 cup' }, { value: '568', label: '568 pint' }, { value: '750', label: '750 bottle' }], ml, '200');
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
    loadFoodTable();
    const meals = sortedMeals();
    const warn = h('div', { class: 'nudge' });
    warn.hidden = true;
    let nudged = false;
    const what = h('input', { type: 'text', placeholder: 'What was eaten?', required: true, list: 'meal-names', autocomplete: 'off' });
    const names = h('datalist', { id: 'meal-names' }, ...meals.map((m) => h('option', { value: m.name })));
    const parts = h('input', { type: 'text', placeholder: 'e.g. peas, mash, gravy' });
    const amount = h('input', { type: 'hidden', value: 'About half' });
    const amountPresets = presets(['A few mouthfuls', 'About half', 'Most of it', 'All of it'], amount, 'About half');
    const remember = h('input', { type: 'checkbox' });
    remember.checked = true;
    /* Typing or tapping a saved meal fills in what goes with it; the meal
       buttons set the input first, then this runs on the bubbled click. */
    const applyMeal = () => { const m = findMeal(what.value); if (m) parts.value = m.parts || ''; };
    what.addEventListener('input', applyMeal);
    what.addEventListener('change', applyMeal);
    const mealButtons = meals.length ? presets(meals.map((m) => m.name), what, '') : null;
    if (mealButtons) mealButtons.addEventListener('click', applyMeal);
    body.append(
      field('Food', what), names,
      mealButtons || h('p', { class: 'hint', text: 'Meals you log are remembered and appear here as quick buttons.' }),
      field('What is in it (optional)', parts),
      h('p', { class: 'field' }, h('span', { text: 'How much' })), amountPresets,
      field('Time', time),
      h('label', { class: 'check' }, remember, h('span', { text: 'Remember this meal for next time' })),
      warn
    );
    getData = () => {
      const name = what.value.trim();
      if (!name) return null;
      const detail = parts.value.trim();
      /* Something vague like "picky lunch" cannot be broken down: ask once for what was in it */
      if (foodIndex && !detail && !nudged && !entryNutrition(foodIndex, { note: name }).matches.length) {
        nudged = true;
        warn.replaceChildren(
          h('p', { text: `"${name}" is not in the food table yet, so the diary can't add nutrition tags for it. That's fine, it still saves either way.` }),
          h('p', { class: 'hint', text: 'Add what is in it above for a better match, or save it as it is.' }),
          h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => save.click() }, 'Save without tags')
        );
        warn.hidden = false;
        parts.focus();
        return { hold: true };
      }
      if (remember.checked) {
        const existing = findMeal(name);
        if (!existing || (existing.parts || '') !== detail) saveMeal(existing ? existing.id : null, existing ? existing.name : name, detail);
      }
      const data = { type: 'food', note: name, amount: amount.value };
      if (detail) data.detail = detail;
      return data;
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

  if (type === 'sleep') {
    /* Hours and minutes pairs, read straight off the Apple Health sleep screen */
    const hm = (label) => {
      const hh = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '24', placeholder: '0' });
      const mm = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '59', placeholder: '0' });
      const row = h('div', null, h('span', { class: 'fieldlabel', text: label }), h('div', { class: 'field-row' }, field('Hours', hh), field('Minutes', mm)));
      const minutes = () => (hh.value === '' && mm.value === '') ? null : (parseInt(hh.value, 10) || 0) * 60 + (parseInt(mm.value, 10) || 0);
      const onChange = (fn) => { hh.addEventListener('input', fn); mm.addEventListener('input', fn); };
      const set = (mins) => { const m = Math.max(0, Math.round(Number(mins) || 0)); hh.value = String(Math.floor(m / 60)); mm.value = String(m % 60); };
      return { row, minutes, onChange, set };
    };
    const asleep = hm('Time asleep');
    const stages = { awake: hm('Awake'), rem: hm('REM'), core: hm('Core'), deep: hm('Deep') };
    const stagesWrap = h('div', { class: 'stages' }, ...Object.values(stages).map((s) => s.row));
    /* If this morning already has a sleep entry (Apple Health sends one automatically), edit it rather than add a second */
    const existing = state.dayEntries.find((e) => e.type === 'sleep') || null;
    const last = existing || state.recentEntries.find((e) => e.type === 'sleep');
    const bed = h('input', { type: 'time', value: (last && last.bedAt) || '' });
    const woke = h('input', { type: 'time', value: (existing && existing.wokeAt) || '' });
    if (existing) {
      editId = existing.id;
      asleep.set(existing.value);
      Object.keys(stages).forEach((k) => { if (existing[k]) stages[k].set(existing[k]); });
      note.value = existing.note || '';
      if (woke.value) time.value = woke.value;
    }
    const wokeHint = h('p', { class: 'hint', text: 'Worked out from bedtime plus time asleep (and any time awake). Change it if it is wrong.' });
    /* Woke at fills itself in from bedtime plus the night's sleep until it is typed in by hand */
    let wokeByHand = Boolean(existing && existing.wokeAt);
    const workOutWoke = () => {
      if (wokeByHand || !bed.value) return;
      const slept = asleep.minutes();
      if (slept === null || slept <= 0) return;
      const [bh, bm] = bed.value.split(':').map(Number);
      const total = (bh * 60 + bm + slept + (stages.awake.minutes() || 0)) % (24 * 60);
      woke.value = pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
      time.value = woke.value;
    };
    bed.addEventListener('input', workOutWoke);
    asleep.onChange(workOutWoke);
    stages.awake.onChange(workOutWoke);
    /* The entry's own time is the wake-up time, so the timeline shows it where the night ended */
    woke.addEventListener('input', () => { wokeByHand = !!woke.value; if (woke.value) time.value = woke.value; });
    body.append(
      h('p', { class: 'hint', text: existing && existing.addedBy === 'Apple Health'
        ? 'Apple Health sent this night automatically. Change anything that is wrong and save.'
        : existing ? 'Editing the sleep already logged for this morning.' : 'Last night, logged against this morning. Type in what Apple Health shows.' }),
      field('In bed at', bed),
      asleep.row,
      h('span', { class: 'fieldlabel', text: 'The four stages, in the order Apple Health lists them' }),
      stagesWrap,
      field('Woke at', woke),
      wokeHint,
      field('Note', note)
    );
    getData = () => {
      const v = asleep.minutes();
      if (v === null || v <= 0 || v > 24 * 60) return null;
      const data = { type: 'sleep', value: v, note: note.value.trim() };
      Object.keys(stages).forEach((k) => { const m = stages[k].minutes(); if (m !== null && m > 0) data[k] = m; });
      if (bed.value) data.bedAt = bed.value;
      if (woke.value) data.wokeAt = woke.value;
      return data;
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

  if (type === 'vitals') {
    const lastT = state.recentEntries.find((e) => e.type === 'temp');
    const temp = h('input', { type: 'number', step: '0.1', min: '34', max: '42', inputmode: 'decimal', placeholder: lastT ? Number(lastT.value).toFixed(1) : '37.0' });
    const tHint = h('p', { class: 'hint' });
    const tUpdate = () => {
      const v = parseFloat(temp.value);
      tHint.textContent = isNaN(v) ? 'Leave blank if not taken' : tempWord(v);
      tHint.style.color = isNaN(v) ? '' : v >= 38 ? 'var(--red)' : v >= 37.5 ? 'var(--amber)' : 'var(--green)';
    };
    const tStep = (n) => {
      const base = parseFloat(temp.value);
      const v = isNaN(base) ? (lastT ? Number(lastT.value) : 37) : base;
      temp.value = (Math.round((v + n) * 10) / 10).toFixed(1);
      tUpdate();
    };
    temp.addEventListener('input', tUpdate);
    tUpdate();
    const hr = h('input', { type: 'number', inputmode: 'numeric', min: '30', max: '220', step: '1', placeholder: '0' });
    const sys = h('input', { type: 'number', inputmode: 'numeric', min: '50', max: '250', step: '1', placeholder: '0' });
    const dia = h('input', { type: 'number', inputmode: 'numeric', min: '30', max: '150', step: '1', placeholder: '0' });
    const o2 = h('input', { type: 'number', inputmode: 'numeric', min: '50', max: '100', step: '1', placeholder: '0' });
    body.append(
      h('p', { class: 'hint', text: 'Fill in whichever readings you have. At least one is needed to save.' }),
      h('span', { class: 'fieldlabel', text: 'Temperature (\u00B0C)' }),
      h('div', { class: 'bigvalue' },
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Down', onclick: () => tStep(-0.1) }, '\u2212'),
        temp, h('span', { class: 'unit', text: '\u00B0C' }),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Up', onclick: () => tStep(0.1) }, '+')
      ),
      tHint,
      field('Heart rate (bpm)', hr),
      h('div', { class: 'field-row' }, field('Systolic', sys), field('Diastolic', dia)),
      field('Oxygen (%)', o2),
      field('Time', time), field('Note', note)
    );
    getData = () => {
      const out = [];
      const noteV = note.value.trim();
      const tV = parseFloat(temp.value);
      if (!isNaN(tV)) {
        if (tV < 30 || tV > 45) return null;
        out.push({ type: 'temp', value: Math.round(tV * 10) / 10, note: noteV });
      }
      const hrV = parseInt(hr.value, 10);
      const sysV = parseInt(sys.value, 10);
      const diaV = parseInt(dia.value, 10);
      const o2V = parseInt(o2.value, 10);
      const data = { type: 'vitals', note: noteV };
      let has = false;
      if (!isNaN(hrV) && hrV > 0) { data.heartRate = hrV; has = true; }
      if (!isNaN(sysV) && sysV > 0 && !isNaN(diaV) && diaV > 0) { data.systolic = sysV; data.diastolic = diaV; has = true; }
      if (!isNaN(o2V) && o2V > 0) { data.oxygen = o2V; has = true; }
      if (has) out.push(data);
      return out.length ? out : null;
    };
  }

  const titles = { drink: 'Drink', food: 'Food', weight: 'Weight', note: 'Note', vitals: 'Vitals', sleep: 'Sleep' };
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Save');
  save.addEventListener('click', async () => {
    const data = getData();
    if (data && data.hold) return;
    if (!data) { toast('Please check the value'); return; }
    const at = atFromInputs(day, time.value);
    const list = Array.isArray(data) ? data : [data];
    closeSheet();
    if (editId) {
      try { await updateEntry(editId, { ...list[0], at }); toast(titles[type] + ' updated'); }
      catch (e) { console.error(e); toast('Could not save'); }
      return;
    }
    const ids = [];
    for (const d of list) { d.at = at; ids.push(await addEntry(d)); }
    toast(titles[type] + ' saved', { label: 'Undo', onClick: () => ids.forEach((id) => deleteEntry(id)) });
  });
  body.append(save, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel'));
  openSheet(titles[type], body);
}

/* Each value is a string, or { value, label } when the button should read differently from what it fills in */
function presets(values, input, initial) {
  const wrap = h('div', { class: 'presets' });
  const items = values.map((v) => (typeof v === 'object' ? v : { value: v, label: v }));
  const buttons = items.map((it) => h('button', { class: 'preset' + (it.value === initial ? ' is-active' : ''), type: 'button', text: it.label, dataset: { value: it.value } }));
  const mark = (value) => buttons.forEach((b) => b.classList.toggle('is-active', b.dataset.value === value));
  buttons.forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.value; mark(b.dataset.value); }));
  input.addEventListener('input', () => mark(input.value));
  wrap.append(...buttons);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Saved meals: remembered the first time a food is logged, then offered */
/* as quick buttons and autocomplete with what goes with them filled in  */
/* ------------------------------------------------------------------ */

function findMeal(name) {
  const n = String(name || '').trim().toLowerCase();
  return n ? state.meals.find((m) => (m.name || '').toLowerCase() === n) || null : null;
}
function sortedMeals() {
  return state.meals.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function saveMeal(id, name, parts) {
  if (state.demo) {
    const m = id ? state.meals.find((x) => x.id === id) : null;
    if (m) { m.name = name; m.parts = parts; }
    else state.meals.push({ id: fakeId('meal'), name, parts, addedBy: state.name });
    return Promise.resolve();
  }
  const ref = id ? doc(db, 'meals', id) : doc(collection(db, 'meals'));
  const data = { name, parts, updatedAt: serverTimestamp() };
  if (!id) { data.addedBy = state.name; data.createdAt = serverTimestamp(); }
  return setDoc(ref, data, { merge: true }).catch((e) => { console.error(e); toast('Could not save the meal'); });
}

function deleteMeal(id) {
  if (state.demo) { state.meals = state.meals.filter((m) => m.id !== id); return Promise.resolve(); }
  return deleteDoc(doc(db, 'meals', id)).catch((e) => { console.error(e); toast('Could not remove the meal'); });
}

$('more-meals').addEventListener('click', openManageMeals);

function openManageMeals() {
  const list = h('div', { class: 'medlist' });
  sortedMeals().forEach((m) => list.append(h('div', { class: 'medrow' },
    h('span', { class: 'medrow-name' }, m.name, m.parts ? h('small', { class: 'medrow-sub', text: m.parts }) : null),
    h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => openEditMeal(m) }, 'Edit')
  )));
  if (!state.meals.length) list.append(h('p', { class: 'empty', 'data-art': 'meal', text: 'No saved meals yet. Log some food with "Remember this meal" ticked and it will appear here.' }));
  const body = h('div', null,
    h('p', { class: 'hint', text: 'Saved meals show as quick buttons when logging food, with what goes with them filled in.' }),
    list,
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => openEditMeal(null) }, 'Add a meal'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Close')
  );
  openSheet('Saved meals', body);
}

function openEditMeal(m) {
  const isNew = !m;
  const name = h('input', { type: 'text', value: m ? m.name : '', required: true, placeholder: 'e.g. Homity pie' });
  const parts = h('input', { type: 'text', value: m ? (m.parts || '') : '', placeholder: 'e.g. peas, mash, gravy' });
  const body = h('div', null,
    field('Meal', name), field('What is in it (optional)', parts),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const n = name.value.trim();
      if (!n) { toast('Please enter a name'); return; }
      const dup = findMeal(n);
      if (dup && (isNew || dup.id !== m.id)) { toast('That meal is already saved'); return; }
      closeSheet();
      await saveMeal(isNew ? null : m.id, n, parts.value.trim());
      toast(isNew ? 'Meal saved' : 'Meal updated');
    } }, isNew ? 'Save meal' : 'Save changes'),
    isNew ? null : h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: async () => {
      closeSheet();
      await deleteMeal(m.id);
      toast('Meal removed');
    } }, 'Remove this meal'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: openManageMeals }, 'Back')
  );
  openSheet(isNew ? 'Add a meal' : 'Edit meal', body);
}

/* ------------------------------------------------------------------ */
/* Food diary: everything eaten, day by day, with each day's drinks total */
/* ------------------------------------------------------------------ */

function openReport(name, from) {
  state.reportReturn = from || 'vitals';
  showTab(name);
}
$('rep-food').addEventListener('click', () => openReport('food', 'vitals'));
$('rep-notes').addEventListener('click', () => openReport('notes', 'vitals'));
$('rep-docs').addEventListener('click', () => openDocs('vitals'));
$('food-back').addEventListener('click', () => showTab(state.reportReturn || 'vitals'));
$('food-print').addEventListener('click', () => window.print());
document.querySelectorAll('#view-food .seg').forEach((b) => b.addEventListener('click', () => {
  state.foodRange = parseInt(b.dataset.range, 10);
  document.querySelectorAll('#view-food .seg').forEach((x) => x.classList.toggle('is-active', x === b));
  renderFoodDiary();
}));

function fmtMl(ml) {
  return ml >= 1000 ? (ml / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' L' : ml + ' ml';
}

/* Builds a simple text PDF (title, subtitle, then heading / sub / muted / text
   blocks) and hands it to the share sheet where available, so on the phone it
   can go straight to Files, Mail or AirDrop; otherwise it downloads. */
async function savePdf(filename, title, subtitle, blocks) {
  try { await loadScript(CDN.jspdf); } catch (e) { toast('Saving a PDF needs a connection'); return; }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const M = 48, maxW = W - M * 2;
  let y = M;
  const footer = () => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(120);
    pdf.text(`Care Log · ${title} · page ${pdf.getNumberOfPages()}`, M, H - 24);
  };
  const write = (text, size, style, color, gapAfter) => {
    pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(color);
    const lh = size * 1.35;
    pdf.splitTextToSize(String(text), maxW).forEach((ln) => {
      if (y + lh > H - 48) { footer(); pdf.addPage(); y = M; pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(color); }
      pdf.text(ln, M, y + size);
      y += lh;
    });
    y += gapAfter;
  };
  write(title, 22, 'bold', PDF_TEAL, 2);
  write(subtitle, 11, 'normal', 100, 14);
  /* Two-column table: left column wraps, right column is short tags; a light rule under each row */
  const table = (b) => {
    const widths = b.widths || [0.64, 0.36];
    const gap = 10, size = 10.5, lh = size * 1.35, pad = 4;
    const colW = widths.map((w) => maxW * w - gap / 2);
    const xs = [M, M + maxW * widths[0] + gap / 2];
    const row = (cells, bold, colour) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(colour);
      const lines = cells.map((c, i) => pdf.splitTextToSize(String(c || ''), colW[i]));
      const rh = Math.max(...lines.map((l) => l.length), 1) * lh + pad * 2;
      if (y + rh > H - 48) { footer(); pdf.addPage(); y = M; pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(colour); }
      lines.forEach((l, i) => l.forEach((ln, k) => pdf.text(ln, xs[i], y + pad + size + k * lh)));
      y += rh;
      pdf.setDrawColor(215); pdf.setLineWidth(0.5); pdf.line(M, y, M + maxW, y);
    };
    if (b.head) row(b.head, true, 90);
    b.rows.forEach((r) => row(r, false, 0));
    y += 6;
  };
  blocks.forEach((b) => {
    if (b.kind === 'heading') { y += 8; write(b.text, 14, 'bold', PDF_TEAL, 4); }
    else if (b.kind === 'sub') { y += 4; write(b.text, 12, 'bold', 0, 2); }
    else if (b.kind === 'muted') write(b.text, 10.5, 'normal', 110, 3);
    else if (b.kind === 'table') table(b);
    else write(b.text, 11, 'normal', 0, 4);
  });
  footer();
  const blob = pdf.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('PDF saved');
}

/* Every entry from a day onwards; null if the read failed */
async function loadEntriesFrom(from) {
  if (state.demo) return state.recentEntries.filter((e) => e.day >= from);
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('day', '>=', from)));
    return snap.docs.map((d) => d.data());
  } catch (e) { console.error(e); return null; }
}

/* ---------- Nutrition: the UK food table (CoFID) and simple label-style tags ---------- */
/* The table itself is data/cofid.json, built from the official spreadsheet by
   .github/workflows/build-cofid.yml. Matching is plain word lookup: the words you typed
   against the table's own names, with a curated alias list for everyday phrasing.
   Tags follow UK label rules per 100 g, so they say what a food is like, not how much was eaten. */

/* Everyday names mapped to the table's own names. A phrase maps to one or more searches;
   each search is a list of regexes tried in order against the table names. */
const FOOD_ALIASES = {
  'toast': [[/^bread, white, toasted/i]],
  'white toast': [[/^bread, white, toasted/i]],
  'brown toast': [[/^bread, wholemeal, toasted/i]],
  'wholemeal toast': [[/^bread, wholemeal, toasted/i]],
  'granary toast': [[/^bread, granary/i, /^bread, wholemeal, toasted/i]],
  'bread': [[/^bread, white, average/i]],
  'white bread': [[/^bread, white, average/i]],
  'brown bread': [[/^bread, brown, average/i, /^bread, wholemeal, average/i]],
  'wholemeal bread': [[/^bread, wholemeal, average/i]],
  'granary bread': [[/^bread, granary/i, /^bread, wholemeal, average/i]],
  'roll': [[/^bread rolls, white, soft/i, /^bread rolls, white/i]],
  'bread roll': [[/^bread rolls, white, soft/i, /^bread rolls, white/i]],
  'bagel': [[/^bagels, plain/i]],
  'crumpet': [[/^crumpets, toasted/i]],
  'shredded wheat': [[/^breakfast cereal, shredded wheat type, unfortified$/i, /shredded wheat/i]],
  'weetabix': [[/weetabix type, fortified/i]],
  'porridge': [[/^porridge, made with milk and water/i, /^porridge, made with whole milk/i, /^porridge/i]],
  'oats': [[/^porridge oats, unfortified$/i]],
  'cornflakes': [[/^breakfast cereal, cornflakes, fortified$/i]],
  'cereal': [[/^breakfast cereal, cornflakes, fortified$/i]],
  'granola': [[/crunchy\/crispy muesli type cereal, with nuts/i]],
  'muesli': [[/^muesli, swiss style, no added sugar/i, /^muesli/i]],
  'yop': [[/^yogurt, drinking/i, /^yogurt, low fat, fruit/i]],
  'yoghurt drink': [[/^yogurt, drinking/i, /^yogurt, low fat, fruit/i]],
  'yogurt drink': [[/^yogurt, drinking/i, /^yogurt, low fat, fruit/i]],
  'yoghurt': [[/^yogurt, low fat, fruit/i]],
  'yogurt': [[/^yogurt, low fat, fruit/i]],
  'greek yoghurt': [[/^yogurt, greek style, plain/i]],
  'greek yogurt': [[/^yogurt, greek style, plain/i]],
  'natural yoghurt': [[/^yogurt, whole milk, plain/i]],
  'cheese': [[/^cheese, cheddar, english/i]],
  'cheddar': [[/^cheese, cheddar, english/i]],
  'brie': [[/^cheese, brie$/i, /^cheese, brie/i]],
  'feta': [[/^cheese, feta/i]],
  'mozzarella': [[/^cheese, mozzarella/i]],
  'cottage cheese': [[/^cheese, cottage, plain/i, /^cheese, cottage/i]],
  'cream cheese': [[/^cheese, cream|^cheese, soft/i, /^cheese spread, plain$/i]],
  'egg': [[/^eggs, chicken, whole, boiled/i]],
  'eggs': [[/^eggs, chicken, whole, boiled/i]],
  'boiled egg': [[/^eggs, chicken, whole, boiled/i]],
  'poached egg': [[/^eggs, chicken, whole, poached/i]],
  'poached eggs': [[/^eggs, chicken, whole, poached/i]],
  'boiled eggs': [[/^eggs, chicken, whole, boiled/i]],
  'fried eggs': [[/^eggs, chicken, whole, fried in sunflower oil/i]],
  'scrambled eggs': [[/^eggs, chicken, scrambled, with semi-skimmed milk/i, /^eggs, chicken, scrambled/i]],
  'fried egg': [[/^eggs, chicken, whole, fried in sunflower oil/i]],
  'scrambled egg': [[/^eggs, chicken, scrambled, with semi-skimmed milk/i, /^eggs, chicken, scrambled/i]],
  'omelette': [[/^omelette, plain, homemade/i]],
  'bacon': [[/^bacon rashers, back, grilled$/i, /^bacon rashers, back, .*grilled/i]],
  'sausage': [[/^sausages, pork, chilled, grilled/i]],
  'sausages': [[/^sausages, pork, chilled, grilled/i]],
  'ham': [[/^ham$/i]],
  'chicken': [[/^chicken, breast, grilled with skin, meat only/i, /^chicken, breast, grilled/i]],
  'chicken breast': [[/^chicken, breast, grilled with skin, meat only/i, /^chicken, breast, grilled/i]],
  'roast chicken': [[/^chicken, light meat, roasted$/i, /^chicken, .*roasted, meat only/i]],
  'chicken thigh': [[/^chicken, thigh, .*roasted, meat only|^chicken, dark meat, roasted/i]],
  'turkey': [[/^turkey, breast, fillet, grilled, meat only/i]],
  'beef': [[/^beef, topside, roasted, lean$|^beef, .*roasted, lean$/i, /^beef, rump steak, grilled, lean/i]],
  'roast beef': [[/^beef, topside, roasted, lean$|^beef, .*roasted, lean$/i]],
  'steak': [[/^beef, rump steak, grilled, lean$/i, /^beef, .*steak, grilled, lean/i]],
  'mince': [[/^beef, mince, extra lean, stewed/i, /^beef, mince, stewed/i]],
  'lamb': [[/^lamb, leg joint, roasted, lean$/i, /^lamb, .*grilled, lean$/i]],
  'pork': [[/^pork, leg joint, roasted, lean$/i, /^pork, loin chops, grilled, lean$/i, /^pork, .*roasted, lean/i]],
  'gammon': [[/^ham, gammon joint, boiled/i]],
  'salmon': [[/^salmon, farmed, flesh only, grilled$/i, /^salmon, farmed, flesh only, baked/i]],
  'tuna': [[/^tuna, canned in brine, drained/i]],
  'cod': [[/^cod, flesh only, baked$/i, /^cod, flesh only, grilled/i]],
  'haddock': [[/^haddock, flesh only, .*grilled|^haddock, flesh only, .*baked/i, /^haddock/i]],
  'fish': [[/^cod, flesh only, baked$/i]],
  'fish fingers': [[/^fish fingers, cod, grilled/i]],
  'fish finger': [[/^fish fingers, cod, grilled/i]],
  'prawns': [[/^prawns, king, purchased cooked$/i]],
  'prawn': [[/^prawns, king, purchased cooked$/i]],
  'mash': [[/^potatoes, old, mashed with butter/i]],
  'mashed potato': [[/^potatoes, old, mashed with butter/i]],
  'maris piper mash': [[/^potatoes, old, mashed with butter/i]],
  'potato': [[/^potatoes, old, boiled in unsalted water, flesh only|^potatoes, old, boiled/i]],
  'potatoes': [[/^potatoes, old, boiled in unsalted water, flesh only|^potatoes, old, boiled/i]],
  'new potatoes': [[/^potatoes, new and salad, boiled in unsalted water, flesh and skin/i]],
  'roast potatoes': [[/^potatoes, old, roasted in rapeseed oil/i]],
  'roast potato': [[/^potatoes, old, roasted in rapeseed oil/i]],
  'jacket potato': [[/^potatoes, old, baked, flesh and skin$/i]],
  'baked potato': [[/^potatoes, old, baked, flesh and skin$/i]],
  'chips': [[/^potato chips, oven ready, no batter, baked/i]],
  'oven chips': [[/^potato chips, oven ready, no batter, baked/i]],
  'sweet potato': [[/^sweet potato, baked/i]],
  'rice': [[/^rice, white, basmati, boiled in unsalted water/i]],
  'white rice': [[/^rice, white, basmati, boiled in unsalted water/i]],
  'brown rice': [[/^rice, brown, .*boiled in unsalted water/i]],
  'pasta': [[/^pasta, white, dried, boiled in unsalted water/i]],
  'spaghetti': [[/^pasta, white, spaghetti, .*boiled|^spaghetti, white, .*boiled/i, /^pasta, white, dried, boiled/i]],
  'wholewheat pasta': [[/^pasta, wholewheat, .*boiled|^pasta, wholemeal/i]],
  'noodles': [[/^noodles, egg, .*boiled in unsalted water/i, /^noodles/i]],
  'couscous': [[/^couscous, plain, cooked/i]],
  'quinoa': [[/^quinoa/i]],
  'pizza': [[/^pizza, cheese and tomato, retail/i]],
  'cookie': [[/^biscuits, cookies, chocolate chip, standard/i]],
  'cookies': [[/^biscuits, cookies, chocolate chip, standard/i]],
  'biscuit': [[/^biscuits, digestive, plain/i]],
  'biscuits': [[/^biscuits, digestive, plain/i]],
  'digestive': [[/^biscuits, digestive, plain/i]],
  'crisps': [[/^potato crisps, fried in sunflower oil/i]],
  'chocolate': [[/^chocolate, milk$/i]],
  'cake': [[/^cake, sponge, homemade/i]],
  'scone': [[/^scones, plain, homemade/i]],
  'flapjack': [[/^flapjacks, retail$/i]],
  'croissant': [[/^croissants/i]],
  'pastries': [[/^pastries, danish, retail/i]],
  'pastry': [[/^pastries, danish, retail/i]],
  'danish pastry': [[/^pastries, danish, retail/i]],
  'sausage roll': [[/^sausage roll, flaky pastry, ready-to-eat, retail/i]],
  'pasty': [[/^cornish pasty, retail/i]],
  'ice cream': [[/^ice cream, dairy, vanilla, soft scoop/i]],
  'custard': [[/^custard, made up with semi-skimmed milk/i, /^custard, made up/i]],
  'jam': [[/^jam, fruit with edible seeds/i]],
  'honey': [[/^honey$/i]],
  'marmite': [[/^yeast extract/i]],
  'peanut butter': [[/^peanut butter/i]],
  'butter': [[/^butter, salted/i]],
  'olive oil': [[/^oil, olive/i]],
  'almonds': [[/^almonds, whole kernels/i]],
  'almond': [[/^almonds, whole kernels/i]],
  'peanuts': [[/^peanuts, kernel only, plain, unsalted/i]],
  'cashews': [[/^cashew nuts, plain/i, /^cashew/i]],
  'walnuts': [[/^walnuts/i]],
  'nuts': [[/^nuts, mixed/i]],
  'mixed nuts': [[/^nuts, mixed/i]],
  'raisins': [[/^raisins, dried/i]],
  'dried fruit': [[/^raisins, dried/i]],
  'grapes': [[/^grapes, average$/i]],
  'grape': [[/^grapes, average$/i]],
  'banana': [[/^bananas, flesh only$/i]],
  'apple': [[/^apples, eating, raw, flesh and skin$/i]],
  'pear': [[/^pears, average, raw, flesh and skin/i, /^pears, average, raw, flesh only/i]],
  'orange': [[/^oranges, flesh only$/i]],
  'satsuma': [[/^satsumas, flesh only|^tangerines, flesh only|^clementines/i, /^oranges, flesh only$/i]],
  'clementine': [[/^clementines|^satsumas, flesh only/i, /^oranges, flesh only$/i]],
  'cherry': [[/^cherries, flesh and skin, raw$/i]],
  'cherries': [[/^cherries, flesh and skin, raw$/i]],
  'strawberry': [[/^strawberries, raw/i]],
  'strawberries': [[/^strawberries, raw/i]],
  'blueberries': [[/^blueberries/i]],
  'raspberries': [[/^raspberries, raw/i]],
  'melon': [[/^melon, canteloupe-type, flesh only$/i, /^melon, .*flesh only$/i]],
  'pineapple': [[/^pineapple, raw, flesh only|^pineapple, fresh/i, /^pineapple, canned in juice/i]],
  'mango': [[/^mangoes, ripe, flesh only, raw$/i]],
  'kiwi': [[/^kiwi fruit, flesh only, raw$/i]],
  'peach': [[/^peaches, raw, flesh and skin|^peaches, flesh and skin/i]],
  'plum': [[/^plums, average, raw|^plums, .*raw/i]],
  'fruit': [[/^apples, eating, raw, flesh and skin$/i]],
  'avocado': [[/^avocado, hass, flesh only$/i]],
  'avacado': [[/^avocado, hass, flesh only$/i]],
  'tomato': [[/^tomatoes, standard, raw/i]],
  'tomatoes': [[/^tomatoes, standard, raw/i]],
  'cucumber': [[/^cucumber, raw/i]],
  'lettuce': [[/^lettuce, average, raw/i]],
  'salad': [[/^lettuce, average, raw/i], [/^tomatoes, standard, raw/i], [/^cucumber, raw/i]],
  'coleslaw': [[/^coleslaw, not low calorie, retail/i]],
  'beetroot': [[/^beetroot, cooked in unsalted water/i, /^beetroot, pickled/i]],
  'carrot': [[/^carrots, old, boiled in unsalted water/i]],
  'carrots': [[/^carrots, old, boiled in unsalted water/i]],
  'peas': [[/^peas, frozen, boiled in unsalted water/i]],
  'broccoli': [[/^broccoli, green, boiled in unsalted water/i]],
  'tenderstem broccoli': [[/^broccoli, green, boiled in unsalted water/i]],
  'tenderstem': [[/^broccoli, green, boiled in unsalted water/i]],
  'cauliflower': [[/^cauliflower, boiled in unsalted water/i]],
  'cabbage': [[/^cabbage, average, boiled in unsalted water|^cabbage, .*boiled in unsalted water/i]],
  'sprouts': [[/^brussels sprouts, boiled in unsalted water/i]],
  'brussels sprouts': [[/^brussels sprouts, boiled in unsalted water/i]],
  'green beans': [[/^green beans\/french beans, .*boiled in unsalted water|^beans, green.*boiled|^french beans, .*boiled/i, /^green beans/i]],
  'sweetcorn': [[/^sweetcorn kernels, canned in water, drained/i]],
  'spinach': [[/^spinach, mature, boiled in unsalted water/i, /^spinach, baby, raw/i]],
  'onion': [[/^onions, raw$/i, /^onions, fried in/i]],
  'onions': [[/^onions, raw$/i, /^onions, fried in/i]],
  'pepper': [[/^peppers, capsicum, red, raw|^peppers, capsicum, green, raw/i]],
  'peppers': [[/^peppers, capsicum, red, raw|^peppers, capsicum, green, raw/i]],
  'mushroom': [[/^mushrooms, white, raw/i]],
  'mushrooms': [[/^mushrooms, white, raw/i]],
  'leek': [[/^leeks, boiled in unsalted water/i, /^leeks/i]],
  'leak': [[/^leeks, boiled in unsalted water/i, /^leeks/i]],
  'leeks': [[/^leeks, boiled in unsalted water/i, /^leeks/i]],
  'parsnip': [[/^parsnip, roasted in rapeseed oil|^parsnip, boiled/i]],
  'parsnips': [[/^parsnip, roasted in rapeseed oil|^parsnip, boiled/i]],
  'baked beans': [[/^baked beans, canned in tomato sauce$/i]],
  'beans': [[/^baked beans, canned in tomato sauce$/i]],
  'lentils': [[/^lentils, red, split, dried, boiled in unsalted water/i]],
  'chickpeas': [[/^beans, chick peas, canned, re-heated, drained/i, /^beans, chick peas, .*boiled/i]],
  'chick peas': [[/^beans, chick peas, canned, re-heated, drained/i, /^beans, chick peas, .*boiled/i]],
  'hummus': [[/^houmous/i]],
  'houmous': [[/^houmous/i]],
  'olives': [[/^olives, green, in brine, drained, flesh and skin$/i]],
  'olive': [[/^olives, green, in brine, drained, flesh and skin$/i]],
  'soup': [[/^soup, vegetable, .*homemade|^soup, carrot and orange, homemade/i, /^soup, .*carton, chilled/i]],
  'tomato soup': [[/^soup, tomato, carton, chilled/i]],
  'chicken soup': [[/^soup, chicken, cream of, canned/i]],
  'leek and potato soup': [[/^soup, leek and potato|^leek and potato soup/i, /^soup, vegetable, .*homemade/i]],
  'gravy': [[/^gravy instant granules, made up with water/i]],
  'milk': [[/^milk, semi-skimmed, pasteurised, average/i]],
  'semi skimmed milk': [[/^milk, semi-skimmed, pasteurised, average/i]],
  'whole milk': [[/^milk, whole, pasteurised, average/i]],
  'complan': [[/^complan powder, sweet, made up with semi-skimmed milk/i]],
  'fortisip': [[/^complan powder, sweet, made up with semi-skimmed milk/i]],
  'ensure': [[/^complan powder, sweet, made up with semi-skimmed milk/i]],
  'supplement drink': [[/^complan powder, sweet, made up with semi-skimmed milk/i]],
  'nutrition drink': [[/^complan powder, sweet, made up with semi-skimmed milk/i]],
  'build up': [[/^build up, powder, shake/i]],
  'protein shake': [[/^build up, powder, shake/i]],
  'smoothie': [[/^smoothies/i]],
  'orange juice': [[/^orange juice, chilled/i]],
  'apple juice': [[/^apple juice, clear/i]],
  'squash': [[/^fruit juice drink\/squash, diluted/i]],
  'tortilla': [[/^tortilla, wheat, soft/i]],
  'wrap': [[/^tortilla, wheat, soft/i]],
  'fajita': [[/^fajita, chicken, meat only/i], [/^tortilla, wheat, soft/i], [/^peppers, capsicum, red, raw|^peppers, capsicum, green, raw/i]],
  'fajitas': [[/^fajita, chicken, meat only/i], [/^tortilla, wheat, soft/i], [/^peppers, capsicum, red, raw|^peppers, capsicum, green, raw/i]],
  'chicken fajitas': [[/^fajita, chicken, meat only/i], [/^tortilla, wheat, soft/i], [/^peppers, capsicum, red, raw|^peppers, capsicum, green, raw/i]],
  'curry': [[/^curry, chicken, average, takeaway|^curry, chicken korma, homemade/i]],
  'chicken curry': [[/^curry, chicken, average, takeaway|^curry, chicken korma, homemade/i]],
  'chilli': [[/^chilli con carne, homemade/i]],
  'chilli con carne': [[/^chilli con carne, homemade/i]],
  'bolognese': [[/^spaghetti bolognese, homemade|^bolognese sauce \(with meat\), homemade/i]],
  'spaghetti bolognese': [[/^spaghetti bolognese, homemade|^bolognese sauce \(with meat\), homemade/i]],
  'lasagne': [[/^lasagne, homemade$/i]],
  "shepherd's pie": [[/^shepherd's pie, homemade/i]],
  'shepherds pie': [[/^shepherd's pie, homemade/i]],
  'cottage pie': [[/^shepherd's pie, homemade/i]],
  'fish pie': [[/^pie, fish, white fish, homemade/i]],
  'chicken pie': [[/^pie, chicken, individual, baked/i]],
  'quiche': [[/^quiche, lorraine, homemade/i]],
  'macaroni cheese': [[/^macaroni cheese, homemade/i]],
  'stew': [[/^beef stew, homemade|^stew, beef/i, /^casserole, beef/i]],
  'casserole': [[/^casserole, chicken|^casserole, beef/i]],
  'sandwich': [[/^bread, white, average/i]],
  'sandwiches': [[/^bread, white, average/i]],
  'roast': [[/^chicken, light meat, roasted$/i, /^chicken, .*roasted, meat only/i], [/^potatoes, old, roasted in rapeseed oil/i], [/^carrots, old, boiled in unsalted water/i], [/^broccoli, green, boiled in unsalted water/i], [/^gravy instant granules, made up with water/i]],
  'chicken roast': [[/^chicken, light meat, roasted$/i, /^chicken, .*roasted, meat only/i], [/^potatoes, old, roasted in rapeseed oil/i], [/^carrots, old, boiled in unsalted water/i], [/^broccoli, green, boiled in unsalted water/i], [/^gravy instant granules, made up with water/i]],
  'roast dinner': [[/^chicken, light meat, roasted$/i, /^chicken, .*roasted, meat only/i], [/^potatoes, old, roasted in rapeseed oil/i], [/^carrots, old, boiled in unsalted water/i], [/^broccoli, green, boiled in unsalted water/i], [/^gravy instant granules, made up with water/i]],
  'chicken roast dinner': [[/^chicken, light meat, roasted$/i, /^chicken, .*roasted, meat only/i], [/^potatoes, old, roasted in rapeseed oil/i], [/^carrots, old, boiled in unsalted water/i], [/^broccoli, green, boiled in unsalted water/i], [/^gravy instant granules, made up with water/i]],
  'sunday roast': [[/^chicken, light meat, roasted$/i, /^chicken, .*roasted, meat only/i], [/^potatoes, old, roasted in rapeseed oil/i], [/^carrots, old, boiled in unsalted water/i], [/^broccoli, green, boiled in unsalted water/i], [/^gravy instant granules, made up with water/i]],
  'full english': [[/^bacon rashers, back, grilled$/i], [/^sausages, pork, chilled, grilled/i], [/^eggs, chicken, whole, fried in sunflower oil/i], [/^baked beans, canned in tomato sauce$/i], [/^bread, white, toasted/i]],
  'homity pie': [[/^potatoes, old, mashed with butter/i], [/^cheese, cheddar, english/i], [/^onions, fried in/i], [/^pastry, shortcrust, cooked, homemade|^pastry, shortcrust/i]],
  'oatcakes': [[/^oatcakes, plain, retail/i]],
  'oatcake': [[/^oatcakes, plain, retail/i]],
  'crackers': [[/^cream crackers/i]],
  'cracker': [[/^cream crackers/i]],
  'rice cakes': [[/^rice cakes|^rice cake/i, /^cream crackers/i]],
  'popcorn': [[/^popcorn, plain|^popcorn, candied/i]],
};

/* Words that carry no food meaning on their own */
const FOOD_STOP = new Set(['and', 'with', 'of', 'on', 'in', 'the', 'a', 'an', 'x', 'some', 'plain', 'small', 'large', 'big', 'half', 'slice', 'slices', 'piece', 'pieces', 'bowl', 'cup', 'glass', 'portion', 'handful', 'few', 'bit', 'bits', 'homemade', 'fresh', 'hot', 'cold', 'leftover', 'leftovers', 'lunch', 'dinner', 'breakfast', 'tea', 'supper', 'snack', 'meal', 'picky', 'mixed', 'little', 'lots', 'more', 'extra', 'it', 'all', 'most', 'my', 'for', 'from', 'at', 'to']);

const COOKING_WORDS = new Set(['roast', 'roasted', 'grilled', 'fried', 'boiled', 'baked', 'poached', 'scrambled', 'steamed', 'mashed', 'cooked', 'toasted', 'chopped', 'sliced', 'diced', 'raw', 'warm', 'whole', 'tinned', 'canned', 'frozen', 'dried', 'grated', 'melted', 'buttered', 'bowl', 'cup', 'mug', 'plate', 'tin', 'pot', 'tub', 'bag', 'packet']);

const IRREGULAR_SINGULAR = { tomatoes: 'tomato', potatoes: 'potato', cherries: 'cherry', strawberries: 'strawberry', raspberries: 'raspberry', blueberries: 'blueberries', pastries: 'pastries', leaves: 'leaf', olives: 'olives', grapes: 'grapes', peas: 'peas', chips: 'chips', crisps: 'crisps', beans: 'beans', nuts: 'nuts', oats: 'oats', noodles: 'noodles', sprouts: 'sprouts', lentils: 'lentils', chickpeas: 'chickpeas', prawns: 'prawns', biscuits: 'biscuits', cookies: 'cookies', crackers: 'crackers', oatcakes: 'oatcakes', raisins: 'raisins', almonds: 'almonds', peanuts: 'peanuts', walnuts: 'walnuts', cashews: 'cashews', carrots: 'carrots', peppers: 'peppers', mushrooms: 'mushrooms', onions: 'onions', leeks: 'leeks', parsnips: 'parsnips', sausages: 'sausages', fajitas: 'fajitas', sandwiches: 'sandwiches' };

function foodSingular(w) {
  if (IRREGULAR_SINGULAR[w]) return IRREGULAR_SINGULAR[w];
  if (w === 'eggs') return 'egg';
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/* Lowercase, drop quantities and punctuation, keep words */
function foodClean(s) {
  return String(s || '').toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\b\d+(\.\d+)?\s*(g|kg|ml|l|oz|x|grams?|mls?)\b/g, ' ')
    .replace(/\bx\s*\d+\b|\b\d+\s*x\b/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Build the lookup once from the table: alias phrases and the table's own head words */
/* Foods added by hand from a product's own nutrition label, for branded things the official
   table was never going to have (it only covers generic whole foods and dishes). Added when
   asked, from a photo of the label; per 100 g, so they go through the same lookup and tagging
   as everything else. Their own aliases take priority over a generic guess. */
const ADDED_FOODS = [
  {
    c: 'added-1', n: 'Whey protein powder, Gold Standard, strawberry', g: null,
    kcal: 378, prot: 79, fat: 4.2, sat: 1.4, carb: 5.5, sugar: 3.3, starch: null, fibre: null, salt: 0.24,
    aliases: ['gold standard whey protein', 'whey protein powder', 'whey protein', 'protein powder', 'whey powder', 'whey']
  }
];

function buildFoodIndex(table) {
  const foods = table.foods;
  const byHead = new Map();
  const add = (key, food, weight) => {
    if (!key) return;
    const list = byHead.get(key) || [];
    list.push({ food, weight });
    byHead.set(key, list);
  };
  foods.forEach((f) => {
    const name = f.n.toLowerCase();
    const head = name.split(',')[0].trim();
    add(head, f, 2);
    const short = head.split(/ in | with | and | on | from /)[0].trim();
    if (short !== head) add(short, f, 1);
    const sing = short.split(' ').map(foodSingular).join(' ');
    if (sing !== short) add(sing, f, 1);
  });
  const find = (regexes) => {
    for (const re of regexes) { const hit = foods.find((f) => re.test(f.n)); if (hit) return hit; }
    return null;
  };
  /* Resolve every alias now, so lookups are cheap and misses are visible */
  const alias = new Map();
  Object.entries(FOOD_ALIASES).forEach(([phrase, searches]) => {
    const hits = searches.map(find).filter(Boolean);
    if (hits.length) alias.set(phrase, hits);
  });
  /* Hand-added foods register their own aliases directly, no searching needed, and take
     priority over a generic table guess for the same phrase */
  ADDED_FOODS.forEach((f) => { (f.aliases || []).forEach((phrase) => alias.set(phrase, [f])); });
  const keys = [...alias.keys(), ...byHead.keys()];
  return { foods: [...foods, ...ADDED_FOODS], byHead, alias, keys, find };
}

/* Best table row for a plain head word: prefer plain, cooked, average forms over dishes and oddities */
function pickRepresentative(list, key) {
  let best = null, bestScore = -Infinity;
  for (const { food, weight } of list) {
    const n = food.n.toLowerCase();
    let s = weight * 10;
    if (n.split(',')[0].trim() === key) s += 10;
    if (/\baverage\b/.test(n)) s += 6;
    if (/flesh only|flesh and skin/.test(n)) s += 2;
    if (/\braw\b/.test(n) && /^(F|D)/.test(food.g || '')) s += 3;
    if (/\braw\b/.test(n) && /^(M|J|C|A)/.test(food.g || '')) s -= 6;
    if (/boiled in unsalted water|grilled|baked|roasted|steamed/.test(n)) s += 2;
    if (/weighed with|dried|canned|powder|frozen, raw|uncooked|concentrate|essence|flavoured|homemade|retail|takeaway/.test(n)) s -= 3;
    if (/sauce|pie|curry|soup|sandwich|salad,|stuffed|with sugar|in syrup|fried/.test(n)) s -= 4;
    if (n.length > 60) s -= 2;
    if (s > bestScore) { bestScore = s; best = food; }
  }
  return best;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

function lookupPhrase(index, phrase) {
  if (!phrase) return null;
  if (index.alias.has(phrase)) return index.alias.get(phrase);
  const sing = phrase.split(' ').map(foodSingular).join(' ');
  if (index.alias.has(sing)) return index.alias.get(sing);
  const list = index.byHead.get(phrase) || index.byHead.get(sing);
  if (list) { const f = pickRepresentative(list, phrase); return f ? [f] : null; }
  return null;
}

/* A typo one or two letters out from a known name, for words long enough to be safe */
function fuzzyPhrase(index, word) {
  if (word.length < 5 || COOKING_WORDS.has(word)) return null;
  let best = null, bestD = 3;
  for (const k of index.keys) {
    if (k.includes(' ') || Math.abs(k.length - word.length) > 2) continue;
    const d = editDistance(word, k);
    if (d < bestD) { bestD = d; best = k; if (d === 1) break; }
  }
  return best && bestD <= (word.length >= 8 ? 2 : 1) ? lookupPhrase(index, best) : null;
}

/* Turn a food entry's text into matched table rows and the phrases nothing was found for */
function matchFoodText(index, text) {
  const clean = foodClean(text);
  const raw = clean.split(/\s+(?:and|with|on|in|plus|or)\s+|,|;|\/|&|\+/).map((p) => p.trim()).filter(Boolean);
  const phrases = [];
  const seenRaw = new Set();
  /* A whole phrase such as "chicken roast dinner" can be an alias before any tidying */
  const pre = [];
  for (const p of raw) {
    if (index.alias.has(p)) { pre.push(p); continue; }
    const stripped = p.split(' ').filter((w) => !FOOD_STOP.has(w) && !COOKING_WORDS.has(w) || ['peas', 'oats', 'beans', 'nuts', 'roast', 'whole'].includes(w)).join(' ').trim();
    if (stripped && !seenRaw.has(stripped)) { seenRaw.add(stripped); phrases.push(stripped); }
  }
  const seen = new Set();
  const matches = [];
  const unmatched = [];
  const take = (foods, phrase) => { foods.forEach((f) => { if (!seen.has(f.c)) { seen.add(f.c); matches.push({ phrase, food: f }); } }); };
  pre.forEach((p) => take(index.alias.get(p), p));
  for (const phrase of phrases) {
    let hit = lookupPhrase(index, phrase);
    if (hit) { take(hit, phrase); continue; }
    const words = phrase.split(' ');
    let any = false;
    /* two-word windows first (e.g. "poached egg", "roast potatoes"), then single words */
    for (let i = 0; i < words.length - 1; i++) {
      const two = words[i] + ' ' + words[i + 1];
      const h2 = lookupPhrase(index, two);
      if (h2) { take(h2, two); any = true; words[i] = words[i + 1] = null; i++; }
    }
    for (const w of words) {
      if (!w || COOKING_WORDS.has(w)) continue;
      const h1 = lookupPhrase(index, w) || fuzzyPhrase(index, w);
      if (h1) { take(h1, w); any = true; }
    }
    if (!any) unmatched.push(phrase);
  }
  return { matches, unmatched };
}

/* ---- Tags: UK label thresholds per 100 g, plus what kind of food it is ---- */
const FOOD_TAG_ORDER = ['Protein', 'Fibre', 'Wholegrain', 'Fruit and veg', 'Dairy', 'Starchy carbs', 'Good fats', 'High sugar', 'High fat', 'High sat fat'];

function foodTags(f) {
  const tags = [];
  const g = f.g || '';
  const fibre = f.fibre != null ? f.fibre : f.nsp;
  const kcal = f.kcal || 0;
  const protShare = kcal > 0 ? (f.prot || 0) * 4 / kcal : 0;
  const name = f.n.toLowerCase();
  const fruitVeg = (/^F/.test(g) || (/^D/.test(g) && !/^DA/.test(g))) && !/juice|squash|smoothie/.test(name);
  const starchy = (/^A/.test(g) && !/^(AM|AN|AO|AP|AS)/.test(g)) || /^DA/.test(g);
  const dairy = /^B/.test(g) && !/^(BP|BR|BTM)/.test(g);
  const wholegrain = starchy && /wholemeal|wholegrain|whole ?wheat|brown|oat|porridge|shredded wheat|weetabix|bran|granary|rye|seeded|muesli/.test(name);
  /* Small-amount foods (sauces, spreads, sugars, oils, herbs) do not earn tags on their own */
  const minor = /^(S|W|H|O)/.test(g);
  if (minor) return tags;
  if ((f.prot || 0) >= 10 || (protShare >= 0.2 && (f.prot || 0) >= 5)) tags.push('Protein');
  /* Source of fibre: over 3 g per 100 g, or 1.5 g per 100 kcal (the second catches fruit and veg) */
  if (fibre != null && (fibre > 3 || (kcal > 0 && fibre >= 1 && fibre / kcal * 100 >= 1.5))) tags.push('Fibre');
  if (wholegrain) tags.push('Wholegrain');
  if (fruitVeg) tags.push('Fruit and veg');
  if (dairy) tags.push('Dairy');
  if (starchy && !wholegrain) tags.push('Starchy carbs');
  const fat = f.fat || 0, sat = f.sat || 0;
  const oily = /^(G|JC)/.test(g) || /avocado|salmon|mackerel|sardine|pilchard|trout|herring|kipper|tuna, canned in .*oil/.test(name);
  if (oily && fat >= 5 && (sat === 0 || sat / fat < 0.35)) tags.push('Good fats');
  else if (fat > 17.5) tags.push('High fat');
  if (sat > 5) tags.push('High sat fat');
  if ((f.sugar || 0) > 22.5 && !fruitVeg) tags.push('High sugar');
  return tags;
}

/* Per entry: union of its components' tags, in a fixed order */
function entryNutrition(index, entry) {
  const text = [entry.note, entry.detail].filter(Boolean).join(', ');
  const { matches, unmatched } = matchFoodText(index, text);
  const set = new Set();
  matches.forEach((m) => foodTags(m.food).forEach((t) => set.add(t)));
  return { tags: FOOD_TAG_ORDER.filter((t) => set.has(t)), matches, unmatched };
}

/* Per day: how many entries carried each tag */
function tagCounts(entriesNutrition) {
  const counts = {};
  entriesNutrition.forEach((n) => n.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  return counts;
}

/* The table is fetched once, when the Food sheet or the Food diary first needs it */
let foodIndex = null;
let foodIndexPromise = null;
function loadFoodTable() {
  if (foodIndex) return Promise.resolve(foodIndex);
  if (!foodIndexPromise) {
    foodIndexPromise = fetch('data/cofid.json?v=' + APP_VERSION).then((r) => (r.ok ? r.json() : null))
      .then((t) => { foodIndex = t && t.foods ? buildFoodIndex(t) : null; return foodIndex; })
      .catch(() => null);
  }
  return foodIndexPromise;
}

async function renderFoodDiary() {
  const today = todayStr();
  const from = addDays(today, -(state.foodRange - 1));
  $('food-sub').textContent = `Last ${state.foodRange} days, from ${fmtDayNum(from)}`;
  const entries = await loadEntriesFrom(from);
  if (!entries) return;
  const index = await loadFoodTable();
  const byDay = {};
  entries.forEach((e) => {
    if (e.type !== 'food' && e.type !== 'drink') return;
    (byDay[e.day] = byDay[e.day] || []).push(e);
  });
  const logged = Object.keys(byDay).sort();
  const sections = [];
  const blocks = [];
  const daysWith = {};
  let dayCount = 0;
  if (logged.length) {
    /* Every day from the first logged one to today, so a day with nothing eaten still shows */
    for (let day = today; day >= logged[0]; day = addDays(day, -1)) {
      const list = (byDay[day] || []).slice().sort((a, b) => entryDate(a) - entryDate(b));
      const foods = list.filter((e) => e.type === 'food');
      const drinks = list.filter((e) => e.type === 'drink');
      const ml = drinks.reduce((s, e) => s + (Number(e.value) || 0), 0);
      const sum = [
        foods.length === 0 ? 'Nothing eaten logged' : foods.length === 1 ? '1 food entry' : foods.length + ' food entries',
        drinks.length ? 'drinks ' + fmtMl(ml) : 'no drinks logged'
      ].join(' · ');
      const nutri = foods.map((e) => (index ? entryNutrition(index, e) : null));
      const counts = tagCounts(nutri.filter(Boolean));
      const tagLine = FOOD_TAG_ORDER.filter((t) => counts[t]).map((t) => t + ' ' + counts[t]).join(' · ');
      dayCount++;
      Object.keys(counts).forEach((t) => { daysWith[t] = (daysWith[t] || 0) + 1; });
      sections.push(h('section', { class: 'diary-day' },
        h('h3', { class: 'diary-title' }, fmtDayLong(day), h('small', { text: day === today ? 'Today' : fmtDayNum(day) })),
        h('p', { class: 'diary-sum', text: sum }),
        tagLine ? h('p', { class: 'diary-tags', text: tagLine }) : null,
        foods.length ? h('ul', { class: 'timeline' }, ...foods.map((e, i) => diaryRow(e, nutri[i]))) : null
      ));
      blocks.push({ kind: 'sub', text: `${fmtDayLong(day)} (${fmtDayNum(day)})` }, { kind: 'muted', text: sum + (tagLine ? ' · ' + tagLine : '') });
      if (foods.length) blocks.push({ kind: 'table', head: ['What was eaten', 'Nutrition'], rows: foods.map((e, i) => [
        `${fmtTime(entryDate(e))}  ${e.note || 'Food'}${e.amount ? ', ' + e.amount.toLowerCase() : ''}${e.detail ? ' (' + e.detail + ')' : ''}, by ${e.addedBy || 'unknown'}`,
        nutri[i] && nutri[i].tags.length ? nutri[i].tags.join(', ') : (nutri[i] && !nutri[i].matches.length ? 'Not in the food table' : '')
      ]) });
    }
  }
  /* Overview: on how many of the days each kind of food turned up */
  const overview = $('food-overview');
  if (dayCount && index) {
    overview.hidden = false;
    overview.replaceChildren(h('div', { class: 'nutri-grid' }, ...FOOD_TAG_ORDER.map((t) => h('div', { class: 'nutri-cell' + (daysWith[t] ? '' : ' is-zero') },
      h('span', { class: 'tile-label', text: t }),
      h('span', { class: 'nutri-value' }, String(daysWith[t] || 0), h('small', { text: ' of ' + dayCount + ' days' }))
    ))));
    blocks.unshift({ kind: 'muted', text: 'Days with: ' + FOOD_TAG_ORDER.map((t) => `${t} ${daysWith[t] || 0} of ${dayCount}`).join(' · ') + '. Tags follow UK food label rules per 100 g of each food named, from the McCance and Widdowson food table. Not portion sizes, not medical advice.' });
  } else { overview.hidden = true; overview.replaceChildren(); }
  $('food-days').replaceChildren(...sections);
  $('food-empty').hidden = sections.length > 0;
  state.foodPdf = { filename: 'care-log-food-diary-' + today + '.pdf', title: 'Food diary', subtitle: `${fmtDayNum(from)} to ${fmtDayNum(today)}, printed ${fmtDayNum(today)}`, blocks };
}

$('food-pdf').addEventListener('click', () => { if (state.foodPdf) savePdf(state.foodPdf.filename, state.foodPdf.title, state.foodPdf.subtitle, state.foodPdf.blocks); });

function diaryRow(e, nutri) {
  const watch = (t) => /^High /.test(t);
  return h('li', { class: 'entry type-food' },
    h('span', { class: 'entry-time', text: fmtTime(entryDate(e)) }),
    h('div', { class: 'entry-main' },
      h('div', { class: 'entry-title', text: e.note || 'Food' }),
      h('div', { class: 'entry-sub', text: [e.amount, e.detail, 'by ' + (e.addedBy || 'unknown')].filter(Boolean).join(' · ') }),
      nutri && nutri.tags.length ? h('div', { class: 'tags' }, ...nutri.tags.map((t) => h('span', { class: 'tag' + (watch(t) ? ' is-watch' : ''), text: t }))) : null,
      nutri && !nutri.matches.length ? h('div', { class: 'unmatched', text: 'Not in the food table yet' })
        : nutri && nutri.unmatched.length ? h('div', { class: 'unmatched', text: 'Not recognised: ' + nutri.unmatched.join(', ') }) : null
    )
  );
}

/* ------------------------------------------------------------------ */
/* Notes for the team: every note collated by day, with mood, readings   */
/* and when-needed doses for context, plus simple checks on the vitals.  */
/* Sent to Claude to be turned into questions for the oncologist/nurse.  */
/* ------------------------------------------------------------------ */

const NOTES_PROMPT = 'Please turn these care notes into a short, clear list of questions to ask my oncologist or specialist nurse at the next appointment. ' +
  'Group them by topic, put the most important first, and keep the wording plain. ' +
  'If anything here looks like it should be checked before the next appointment, say so clearly at the top. ' +
  'The "worth mentioning" items are simple threshold checks made by the app, not a diagnosis.';

$('notes-back').addEventListener('click', () => showTab(state.reportReturn || 'vitals'));
$('notes-print').addEventListener('click', () => window.print());
document.querySelectorAll('#view-notes .seg').forEach((b) => b.addEventListener('click', () => {
  state.notesRange = parseInt(b.dataset.range, 10);
  document.querySelectorAll('#view-notes .seg').forEach((x) => x.classList.toggle('is-active', x === b));
  renderNotesReport();
}));

$('notes-share').addEventListener('click', async () => {
  const text = state.notesText;
  if (!text) return;
  if (!navigator.share) {
    await copyText(text);
    toast('Sharing is not available here. Copied instead.');
    return;
  }
  try {
    await navigator.share({ title: 'Care Log notes', text });
  } catch (e) {
    if (e && e.name !== 'AbortError') { await copyText(text); toast('Could not share. Copied instead.'); }
  }
});

$('notes-copy').addEventListener('click', async () => {
  if (!state.notesText) return;
  await copyText(state.notesText);
  toast('Copied. Paste it into the Claude app.');
});

$('notes-pdf').addEventListener('click', () => { if (state.notesPdf) savePdf(state.notesPdf.filename, state.notesPdf.title, state.notesPdf.subtitle, state.notesPdf.blocks); });

/* The PDF is for people (the clinic, the folder), so it carries the report without the request to Claude */
function notesPdfBlocks(report) {
  const blocks = [{ kind: 'heading', text: 'Worth mentioning' }, { kind: 'muted', text: 'Simple checks on the readings made by the app, not medical advice.' }];
  if (report.flags.length) report.flags.forEach((f) => blocks.push({ kind: 'text', text: '• ' + f.text }));
  else blocks.push({ kind: 'text', text: 'Nothing out of the ordinary in the readings for this period.' });
  blocks.push({ kind: 'heading', text: 'Letters and documents' });
  if (report.docs.length) report.docs.forEach((d) => {
    blocks.push({ kind: 'sub', text: `${fmtDayNum(d.docDate)} · ${d.title}${d.category === 'chemo' ? ' (chemo plan)' : ''}` });
    blocks.push({ kind: 'text', text: (d.explanation || '').trim() || 'No explanation saved yet.' });
  });
  else blocks.push({ kind: 'text', text: 'None saved for this period.' });
  blocks.push({ kind: 'heading', text: 'Notes by day' });
  report.days.forEach((d) => {
    blocks.push({ kind: 'sub', text: `${fmtDayLong(d.day)} (${fmtDayNum(d.day)})` });
    if (d.mood || d.good) blocks.push({ kind: 'muted', text: 'Feeling: ' + [d.mood, d.good ? 'One good thing: ' + d.good : ''].filter(Boolean).join('. ') });
    if (d.readings) blocks.push({ kind: 'muted', text: 'Readings: ' + d.readings });
    if (d.prn) blocks.push({ kind: 'muted', text: 'When-needed medicines: ' + d.prn });
    d.notes.forEach((n) => blocks.push({ kind: 'text', text: `${n.time} ${n.who}${n.context ? ' (' + n.context + ')' : ''}: ${n.text}` }));
  });
  return blocks;
}

function listDays(days) { return days.map(fmtDayShort).join(', '); }
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

/* Plain-language threshold checks. Red and amber follow the app's temperature
   colours; teal is context worth passing on rather than a concern. */
function vitalsFlags(entries, rangeDays, today) {
  const flags = [];
  const when = (e) => fmtDayShort(e.day) + ' at ' + fmtTime(entryDate(e));
  const sorted = entries.slice().sort((a, b) => entryDate(a) - entryDate(b));

  sorted.forEach((e) => {
    if (e.type === 'temp') {
      const v = Number(e.value);
      if (v >= 38) flags.push({ level: 'red', text: `High temperature ${v.toFixed(1)} °C on ${when(e)}` });
      else if (v >= 37.5) flags.push({ level: 'amber', text: `Raised temperature ${v.toFixed(1)} °C on ${when(e)}` });
    }
    if (e.type === 'vitals') {
      const hr = Number(e.heartRate) || 0, sys = Number(e.systolic) || 0, dia = Number(e.diastolic) || 0, ox = Number(e.oxygen) || 0;
      if (hr >= 120) flags.push({ level: 'red', text: `Fast heart rate ${Math.round(hr)} bpm on ${when(e)}` });
      else if (hr >= 100) flags.push({ level: 'amber', text: `Heart rate on the high side, ${Math.round(hr)} bpm on ${when(e)}` });
      else if (hr && hr <= 50) flags.push({ level: 'amber', text: `Slow heart rate ${Math.round(hr)} bpm on ${when(e)}` });
      if (sys && dia) {
        if (sys >= 160 || dia >= 100) flags.push({ level: 'red', text: `High blood pressure ${Math.round(sys)}/${Math.round(dia)} on ${when(e)}` });
        else if (sys >= 140 || dia >= 90) flags.push({ level: 'amber', text: `Blood pressure on the high side, ${Math.round(sys)}/${Math.round(dia)} on ${when(e)}` });
        else if (sys <= 90) flags.push({ level: 'amber', text: `Low blood pressure ${Math.round(sys)}/${Math.round(dia)} on ${when(e)}` });
      }
      if (ox && ox <= 90) flags.push({ level: 'red', text: `Low oxygen ${Math.round(ox)}% on ${when(e)}` });
      else if (ox && ox <= 93) flags.push({ level: 'amber', text: `Oxygen a little low, ${Math.round(ox)}% on ${when(e)}` });
    }
  });

  sorted.filter((e) => e.type === 'checkin').forEach((e) => {
    const where = `at the ${e.slot} check-in on ${fmtDayShort(e.day)}`;
    if (e.pain >= 7) flags.push({ level: 'red', text: `Bad pain, ${e.pain}/10 ${where}` });
    else if (e.pain >= 5) flags.push({ level: 'amber', text: `Pain ${e.pain}/10 ${where}` });
    if (e.worstPain >= 7) flags.push({ level: 'red', text: `Worst pain ${e.worstPain}/10 on ${fmtDayShort(e.day)}` });
    if (e.sickness >= 6) flags.push({ level: 'amber', text: `Sickness ${e.sickness}/10 on ${fmtDayShort(e.day)}` });
    if (e.appetite != null && e.appetite <= 3) flags.push({ level: 'amber', text: `Appetite low, ${e.appetite}/10 on ${fmtDayShort(e.day)}` });
    if (e.energy != null && e.energy <= 3) flags.push({ level: 'amber', text: `Energy low, ${e.energy}/10 on ${fmtDayShort(e.day)}` });
  });
  sorted.filter((e) => e.type === 'pain' && Number(e.value) >= 7)
    .forEach((e) => flags.push({ level: 'red', text: `Bad pain, ${e.value}/10 logged on ${when(e)}` }));

  sorted.filter((e) => e.type === 'sleep' && Number(e.value) > 0 && Number(e.value) < 300)
    .forEach((e) => flags.push({ level: 'amber', text: `Short night, ${fmtHm(e.value)} asleep before ${fmtDayShort(e.day)}` }));

  const weights = sorted.filter((e) => e.type === 'weight');
  if (weights.length >= 2) {
    const first = Number(weights[0].value), last = Number(weights[weights.length - 1].value);
    const drop = first - last;
    if (drop >= 2) flags.push({ level: drop >= 4 ? 'red' : 'amber', text: `Weight down ${drop.toFixed(1)} kg over the period, ${first.toFixed(1)} kg on ${fmtDayShort(weights[0].day)} to ${last.toFixed(1)} kg on ${fmtDayShort(weights[weights.length - 1].day)}` });
  }

  /* Intake: only days that were actually logged, and not today, which is still going */
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  const loggedDays = Object.keys(byDay).filter((d) => d < today).sort();
  const lowDrink = loggedDays.filter((d) => byDay[d].some((e) => e.type === 'drink') && byDay[d].filter((e) => e.type === 'drink').reduce((s, e) => s + (Number(e.value) || 0), 0) < 1000);
  const noFood = loggedDays.filter((d) => !byDay[d].some((e) => e.type === 'food'));
  if (lowDrink.length) flags.push({ level: 'amber', text: `Under 1 litre of drinks logged on ${plural(lowDrink.length, 'day')}: ${listDays(lowDrink)}` });
  if (noFood.length) flags.push({ level: 'amber', text: `Nothing eaten logged on ${plural(noFood.length, 'day')}: ${listDays(noFood)}` });

  activePrn().forEach((m) => {
    const perDay = {};
    entries.filter((e) => e.type === 'med' && e.medId === m.id).forEach((e) => { perDay[e.day] = (perDay[e.day] || 0) + 1; });
    const days = Object.keys(perDay).sort();
    if (!days.length) return;
    const most = days.reduce((a, b) => (perDay[b] > perDay[a] ? b : a));
    const hitMax = m.maxPerDay && perDay[most] >= m.maxPerDay;
    flags.push({ level: hitMax ? 'amber' : 'teal', text: `${m.name} needed on ${days.length} of ${rangeDays} days, most on ${fmtDayShort(most)} (${plural(perDay[most], 'dose')}${hitMax ? ', the daily maximum' : ''})` });
  });

  const lowMood = Object.keys(state.days).filter((d) => d >= addDays(today, -(rangeDays - 1)) && d <= today && state.days[d].mood && state.days[d].mood <= 2).sort();
  if (lowMood.length) flags.push({ level: 'amber', text: `Felt rough or low on ${plural(lowMood.length, 'day')}: ${listDays(lowMood)}` });

  const rank = { red: 0, amber: 1, teal: 2 };
  return flags.sort((a, b) => rank[a.level] - rank[b.level]);
}

function noteContext(e) {
  switch (e.type) {
    case 'temp': return 'with temperature ' + Number(e.value).toFixed(1) + ' °C';
    case 'weight': return 'with weight ' + Number(e.value).toFixed(1) + ' kg';
    case 'vitals': {
      const p = [];
      if (e.heartRate) p.push(Math.round(e.heartRate) + ' bpm');
      if (e.systolic && e.diastolic) p.push(Math.round(e.systolic) + '/' + Math.round(e.diastolic));
      if (e.oxygen) p.push(Math.round(e.oxygen) + '% oxygen');
      return 'with vitals ' + p.join(', ');
    }
    case 'med': return 'with ' + (e.medName || 'a medicine');
    case 'pain': return 'with pain ' + e.value + '/10';
    default: return '';
  }
}

function dayReadings(list) {
  const bits = [];
  const temps = list.filter((e) => e.type === 'temp').map((e) => Number(e.value));
  if (temps.length) { const lo = Math.min(...temps), hi = Math.max(...temps); bits.push('Temp ' + (lo === hi ? lo.toFixed(1) : lo.toFixed(1) + ' to ' + hi.toFixed(1)) + ' °C'); }
  const hrs = list.filter((e) => e.type === 'vitals' && e.heartRate).map((e) => Math.round(e.heartRate));
  if (hrs.length) { const lo = Math.min(...hrs), hi = Math.max(...hrs); bits.push('HR ' + (lo === hi ? lo : lo + ' to ' + hi) + ' bpm'); }
  const bp = list.filter((e) => e.type === 'vitals' && e.systolic && e.diastolic).pop();
  if (bp) bits.push('BP ' + Math.round(bp.systolic) + '/' + Math.round(bp.diastolic));
  const ox = list.filter((e) => e.type === 'vitals' && e.oxygen).map((e) => Math.round(e.oxygen));
  if (ox.length) bits.push('O2 ' + Math.min(...ox) + '%');
  const w = list.filter((e) => e.type === 'weight').pop();
  if (w) bits.push('Weight ' + Number(w.value).toFixed(1) + ' kg');
  const sl = list.filter((e) => e.type === 'sleep').pop();
  if (sl) bits.push('Sleep ' + fmtHm(sl.value));
  const am = list.find((e) => e.type === 'checkin' && e.slot === 'morning');
  const pm = list.find((e) => e.type === 'checkin' && e.slot === 'evening');
  const pair = (k, label) => {
    const parts = [am && am[k] != null ? 'am ' + am[k] : null, pm && pm[k] != null ? 'pm ' + pm[k] : null].filter(Boolean);
    if (parts.length) bits.push(label + ' ' + parts.join(', ') + '/10');
  };
  pair('pain', 'Pain');
  pair('mood', 'Mood');
  if (pm && pm.worstPain != null) bits.push('Worst pain ' + pm.worstPain + '/10');
  if (pm && pm.sickness != null) bits.push('Sickness ' + pm.sickness + '/10');
  if (pm && pm.appetite != null) bits.push('Appetite ' + pm.appetite + '/10');
  if (pm && pm.energy != null) bits.push('Energy ' + pm.energy + '/10');
  if (am && am.sleep != null) bits.push('Sleep score ' + am.sleep + '/10' + (am.sleepHours != null ? ' (' + am.sleepHours + ' h)' : ''));
  const spots = list.filter((e) => e.type === 'pain');
  if (spots.length) bits.push('Extra pain readings ' + spots.map((e) => e.value).join(', '));
  const ml = list.filter((e) => e.type === 'drink').reduce((s, e) => s + (Number(e.value) || 0), 0);
  if (ml) bits.push('Drinks ' + fmtMl(ml));
  const food = list.filter((e) => e.type === 'food').length;
  if (food) bits.push(food === 1 ? '1 food entry' : food + ' food entries');
  return bits.join(' · ');
}

function dayPrn(list) {
  const counts = {};
  list.filter((e) => e.type === 'med').forEach((e) => {
    const m = state.medicines.find((x) => x.id === e.medId);
    if (m && m.kind === 'prn') counts[e.medName || m.name] = (counts[e.medName || m.name] || 0) + 1;
  });
  return Object.keys(counts).map((n) => n + ' x' + counts[n]).join(', ');
}

function buildNotesReport(entries, from, today) {
  const rangeDays = state.notesRange;
  const flags = vitalsFlags(entries, rangeDays, today);
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  const days = [];
  for (let day = from; day <= today; day = addDays(day, 1)) {
    const list = (byDay[day] || []).slice().sort((a, b) => entryDate(a) - entryDate(b));
    const info = state.days[day] || {};
    const notes = list.filter((e) => e.type === 'note' || (e.note && ['temp', 'weight', 'vitals', 'med', 'pain'].includes(e.type)))
      .map((e) => ({ time: fmtTime(entryDate(e)), who: e.addedBy || 'unknown', text: e.note, context: e.type === 'note' ? '' : noteContext(e) }));
    list.filter((e) => e.type === 'checkin').forEach((e) => {
      CHECKIN_TEXT_KEYS.forEach(([k, label]) => {
        if (e[k]) notes.push({ time: fmtTime(entryDate(e)), who: e.addedBy || 'unknown', text: label + ': ' + e[k], context: e.slot + ' check-in' });
      });
    });
    notes.sort((a, b) => a.time.localeCompare(b.time));
    const mood = info.mood ? MOODS[info.mood - 1].label : '';
    const readings = dayReadings(list);
    const prn = dayPrn(list);
    if (!notes.length && !mood && !info.good && !readings) continue;
    days.push({ day, mood, good: info.good || '', readings, prn, notes });
  }

  const docs = state.documents.filter((d) => d.category !== 'exemption' && d.docDate && d.docDate >= from && d.docDate <= today)
    .sort((a, b) => (a.docDate || '').localeCompare(b.docDate || ''));

  const lines = [NOTES_PROMPT, '', `Care Log notes, ${fmtDayNum(from)} to ${fmtDayNum(today)}`, '', 'Worth mentioning from the readings:'];
  if (flags.length) flags.forEach((f) => lines.push('- ' + f.text));
  else lines.push('- Nothing out of the ordinary in the readings for this period.');
  lines.push('', 'Letters and documents in this period:');
  if (docs.length) docs.forEach((d) => {
    lines.push('', `${fmtDayNum(d.docDate)}: ${d.title}${d.category === 'chemo' ? ' (chemo plan)' : ''}`);
    lines.push((d.explanation || '').trim() || 'No explanation saved yet.');
  });
  else lines.push('- None saved for this period.');
  lines.push('', 'Notes by day:');
  days.forEach((d) => {
    lines.push('', `${fmtDayLong(d.day)} (${fmtDayNum(d.day)})`);
    if (d.mood || d.good) lines.push('Feeling: ' + [d.mood, d.good ? 'One good thing: ' + d.good : ''].filter(Boolean).join('. '));
    if (d.readings) lines.push('Readings: ' + d.readings);
    if (d.prn) lines.push('When-needed medicines: ' + d.prn);
    d.notes.forEach((n) => lines.push(`- ${n.time} ${n.who}${n.context ? ' (' + n.context + ')' : ''}: ${n.text}`));
  });
  return { flags, docs, days, text: lines.join('\n') };
}

async function renderNotesReport() {
  const today = todayStr();
  const from = addDays(today, -(state.notesRange - 1));
  $('notes-sub').textContent = `Last ${state.notesRange} days, from ${fmtDayNum(from)}`;
  const entries = await loadEntriesFrom(from);
  if (!entries) return;
  const report = buildNotesReport(entries, from, today);
  state.notesText = report.text;
  state.notesPdf = { filename: 'care-log-notes-' + today + '.pdf', title: 'Notes for the team', subtitle: `${fmtDayNum(from)} to ${fmtDayNum(today)}, printed ${fmtDayNum(today)}`, blocks: notesPdfBlocks(report) };

  const levelWord = { red: 'Check', amber: 'Mention', teal: 'Context' };
  $('notes-flags').replaceChildren(...report.flags.map((f) => h('div', { class: 'flag is-' + f.level },
    h('span', { class: 'pill pill-' + f.level, text: levelWord[f.level] }),
    h('span', { class: 'flag-text', text: f.text })
  )));
  if (!report.flags.length) $('notes-flags').append(h('p', { class: 'muted', text: 'Nothing out of the ordinary in the readings for this period.' }));

  $('notes-docs').replaceChildren(...report.docs.map((d) => {
    const text = (d.explanation || '').trim();
    const short = text.length > 260 ? text.slice(0, 260).replace(/\s+\S*$/, '') + '…' : text;
    return h('div', { class: 'card' },
      h('div', { class: 'docitem-title', text: d.title }),
      h('div', { class: 'docitem-sub', text: fmtDayNum(d.docDate) + (d.category === 'chemo' ? ' · Chemo plan' : '') }),
      h('p', { class: (text ? '' : 'muted'), text: short || 'No explanation saved yet.' }),
      h('button', { class: 'btn btn-link', type: 'button', onclick: () => { openDocs('notes'); openDocument(d.id); } }, 'Open the document')
    );
  }));
  if (!report.docs.length) $('notes-docs').append(h('p', { class: 'muted', text: 'No letters or documents dated in this period.' }));

  const shown = report.days.slice().reverse();
  $('notes-days').replaceChildren(...shown.map((d) => h('section', { class: 'diary-day' },
    h('h3', { class: 'diary-title' }, fmtDayLong(d.day), h('small', { text: d.day === today ? 'Today' : fmtDayNum(d.day) })),
    (d.mood || d.good) ? h('p', { class: 'diary-sum', text: 'Feeling ' + [d.mood.toLowerCase(), d.good].filter(Boolean).join('. ') }) : null,
    d.readings ? h('p', { class: 'diary-sum', text: d.readings }) : null,
    d.prn ? h('p', { class: 'diary-sum', text: 'When needed: ' + d.prn }) : null,
    d.notes.length ? h('ul', { class: 'timeline' }, ...d.notes.map((n) => h('li', { class: 'entry type-note' },
      h('span', { class: 'entry-time', text: n.time }),
      h('div', { class: 'entry-main' },
        h('div', { class: 'entry-title', text: n.text }),
        h('div', { class: 'entry-sub', text: [n.context, 'by ' + n.who].filter(Boolean).join(' · ') })
      )
    ))) : null
  )));
  $('notes-empty').hidden = report.days.length > 0;
}

/* ------------------------------------------------------------------ */
/* Daily check-ins: morning and evening, one question per screen.        */
/* Stored in entries as {day}_{slot} (type "checkin", one field per      */
/* answer; a skipped slider is null, skipped text is ""), so a day and    */
/* slot can only ever have one document and reopening edits it. Mood is   */
/* mirrored to days/{day}.mood (1 to 5) so the Chemo calendar, the report */
/* and the flags keep working unchanged.                                  */
/* ------------------------------------------------------------------ */

const CHECKIN_QUESTIONS = {
  morning: [
    { key: 'sleep', kind: 'sleep', q: 'How did you sleep?', low: '1 terribly', high: '10 brilliantly' },
    { key: 'pain', kind: 'pain', q: 'Pain right now', low: '1 none', high: '10 worst' },
    { key: 'mood', kind: 'slider', q: 'How is your mood?', low: '1 rough', high: '10 great' },
    { key: 'symptoms', kind: 'text', q: 'Any new or worse symptoms overnight?', ph: 'e.g. more sick than usual, a new ache' },
    { key: 'lookingForward', kind: 'text', q: 'What are you looking forward to today?', ph: 'e.g. a walk in the garden, a visitor' }
  ],
  evening: [
    { key: 'pain', kind: 'pain', q: 'Pain right now', low: '1 none', high: '10 worst' },
    { key: 'mood', kind: 'slider', q: 'How is your mood?', low: '1 rough', high: '10 great' },
    { key: 'worstPain', kind: 'pain', q: 'Worst pain today', low: '1 none', high: '10 worst' },
    { key: 'sickness', kind: 'pain', q: 'Sickness today', low: '1 none', high: '10 severe' },
    { key: 'appetite', kind: 'slider', q: 'Appetite today', low: '1 nothing', high: '10 normal' },
    { key: 'energy', kind: 'slider', q: 'Energy today', low: '1 wiped out', high: '10 plenty' },
    { key: 'symptoms', kind: 'text', q: 'Any new or worse symptoms today?', ph: 'e.g. felt sick after lunch, back worse' },
    { key: 'settled', kind: 'text', q: 'Anything that has settled since yesterday?', ph: 'e.g. the sickness has eased' },
    { key: 'goodThing', kind: 'text', q: 'One good thing about today', ph: 'e.g. sat in the garden for an hour' }
  ]
};
const CHECKIN_LABELS = {
  sleep: 'Sleep', sleepHours: 'Hours slept', pain: 'Pain now', mood: 'Mood', symptoms: 'New or worse symptoms',
  lookingForward: 'Looking forward to', worstPain: 'Worst pain', sickness: 'Sickness', appetite: 'Appetite',
  energy: 'Energy', settled: 'Settled since yesterday', goodThing: 'One good thing'
};
const CHECKIN_TEXT_KEYS = [['symptoms', 'New or worse symptoms'], ['settled', 'Settled since yesterday'], ['lookingForward', 'Looking forward to'], ['goodThing', 'One good thing']];

function checkinId(day, slot) { return day + '_' + slot; }
function findCheckin(day, slot) {
  const id = checkinId(day, slot);
  return state.dayEntries.find((e) => e.id === id) || state.recentEntries.find((e) => e.id === id) || null;
}
function dueSlot() { return new Date().getHours() < 15 ? 'morning' : 'evening'; }
function slotWord(slot) { return slot === 'morning' ? 'Morning' : 'Evening'; }

function checkinSummary(e) {
  const bits = [];
  if (e.sleep != null) bits.push('Sleep ' + e.sleep + (e.sleepHours != null ? ' (' + e.sleepHours + ' h)' : ''));
  if (e.pain != null) bits.push('Pain ' + e.pain);
  if (e.mood != null) bits.push('Mood ' + e.mood);
  if (e.worstPain != null) bits.push('Worst pain ' + e.worstPain);
  if (e.sickness != null) bits.push('Sickness ' + e.sickness);
  if (e.appetite != null) bits.push('Appetite ' + e.appetite);
  if (e.energy != null) bits.push('Energy ' + e.energy);
  return bits.join(' · ');
}

function renderCheckins() {
  const day = state.selectedDay, isToday = day === todayStr();
  ['morning', 'evening'].forEach((slot) => {
    const row = $('checkin-' + slot), sub = $('checkin-' + slot + '-sub');
    const c = findCheckin(day, slot);
    row.classList.remove('is-due', 'is-done');
    if (c) {
      row.classList.add('is-done');
      sub.replaceChildren(h('span', { class: 'checkin-done' }, icon('check'), 'Done ' + fmtTime(entryDate(c))), ' · tap to change');
    } else if (isToday && dueSlot() === slot) { row.classList.add('is-due'); sub.textContent = 'Due now, about a minute'; }
    else if (isToday && slot === 'morning') sub.textContent = 'Missed this morning, tap to fill in';
    else if (isToday) sub.textContent = 'Later today';
    else sub.textContent = 'Not filled in, tap to add';
  });
}
$('checkin-morning').addEventListener('click', () => openCheckin('morning', state.selectedDay));
$('checkin-evening').addEventListener('click', () => openCheckin('evening', state.selectedDay));

function sliderBlock(q, current, onChange) {
  const num = h('div', { class: 'wiz-num' + (current == null ? ' is-unset' : ''), text: current == null ? 'Slide to answer' : String(current) });
  const range = h('input', { type: 'range', class: 'slider' + (q.kind === 'pain' ? ' is-pain' : ''), min: '1', max: '10', step: '1', value: String(current == null ? 5 : current), 'aria-label': q.q });
  let touched = current != null;
  range.addEventListener('input', () => { touched = true; num.textContent = range.value; num.classList.remove('is-unset'); if (onChange) onChange(); });
  const nodes = [num, range, h('div', { class: 'wiz-anchors' }, h('span', { text: q.low }), h('span', { text: q.high }))];
  return { nodes, value: () => (touched ? parseInt(range.value, 10) : null) };
}

function openCheckin(slot, initialDay) {
  const today = todayStr();
  let day = initialDay > today ? today : initialDay;
  const qs = CHECKIN_QUESTIONS[slot];
  let answers = {}, existing = null, step = 0, dir = 1;

  const load = () => {
    existing = findCheckin(day, slot);
    answers = {};
    qs.forEach((q) => { answers[q.key] = existing && existing[q.key] !== undefined ? existing[q.key] : (q.kind === 'text' ? '' : null); });
    answers.sleepHours = existing && existing.sleepHours != null ? existing.sleepHours : null;
  };
  load();

  const body = h('div', null);

  function render() {
    const wrap = h('div', { class: 'wiz-step' + (dir < 0 ? ' is-back' : '') });
    if (step < qs.length) {
      const q = qs[step];
      if (step === 0) {
        const options = [[today, 'Today'], [addDays(today, -1), 'Yesterday']];
        if (day !== today && day !== addDays(today, -1)) options.unshift([day, fmtDayShort(day)]);
        wrap.append(h('div', { class: 'wiz-day' }, ...options.map(([d, label]) =>
          h('button', { class: 'preset' + (d === day ? ' is-active' : ''), type: 'button', onclick: () => { if (d !== day) { day = d; load(); render(); } } }, label))));
      }
      const bar = h('div', { class: 'progress-bar' }, h('div'));
      bar.firstChild.style.width = Math.round(((step + 1) / (qs.length + 1)) * 100) + '%';
      wrap.append(h('div', { class: 'wiz-progress' }, h('span', { text: `${step + 1} of ${qs.length}` }), bar));
      wrap.append(h('p', { class: 'wiz-q', text: q.q }));

      let getVal;
      if (q.kind === 'text') {
        const ta = h('textarea', { rows: '3', placeholder: q.ph || '' });
        ta.value = answers[q.key] || '';
        wrap.append(h('p', { class: 'wiz-hint', text: 'Optional. Skip if there is nothing to say.' }), ta);
        getVal = () => ta.value.trim();
      } else {
        const sl = sliderBlock(q, answers[q.key]);
        wrap.append(...sl.nodes);
        let hours = null;
        if (q.kind === 'sleep') {
          hours = h('input', { type: 'number', inputmode: 'decimal', min: '0', max: '24', step: '0.5', placeholder: 'e.g. 7', value: answers.sleepHours != null ? String(answers.sleepHours) : '' });
          wrap.append(field('Roughly how many hours (optional)', hours));
        }
        getVal = () => {
          if (hours) { const hv = parseFloat(hours.value); answers.sleepHours = isNaN(hv) ? null : hv; }
          return sl.value();
        };
      }
      const go = (n, d) => { dir = d; step = n; render(); };
      const back = h('button', { class: 'btn btn-secondary btn-back', type: 'button', disabled: step === 0, onclick: () => { answers[q.key] = getVal(); go(step - 1, -1); } }, 'Back');
      const skip = h('button', { class: 'btn-link wiz-skip', type: 'button', onclick: () => { if (q.kind === 'sleep') getVal(); answers[q.key] = q.kind === 'text' ? '' : null; go(step + 1, 1); } }, 'Skip');
      const next = h('button', { class: 'btn btn-primary btn-next', type: 'button', onclick: () => { answers[q.key] = getVal(); go(step + 1, 1); } }, step === qs.length - 1 ? 'Review' : 'Next');
      wrap.append(h('div', { class: 'wiz-buttons' }, back, skip, next));
    } else {
      const bar = h('div', { class: 'progress-bar' }, h('div'));
      bar.firstChild.style.width = '100%';
      wrap.append(h('div', { class: 'wiz-progress' }, h('span', { text: 'Review' }), bar));
      wrap.append(h('p', { class: 'wiz-q', text: fmtDayLong(day) + (day === today ? ', today' : '') }));
      wrap.append(h('p', { class: 'wiz-hint', text: 'Tap an answer to change it.' }));
      const list = h('ul', { class: 'wiz-summary' });
      qs.forEach((q, i) => {
        const v = answers[q.key];
        const skipped = q.kind === 'text' ? !v : v == null;
        const shown = skipped ? 'Skipped' : (q.kind === 'text' ? v : String(v) + (q.kind === 'sleep' && answers.sleepHours != null ? ' · ' + answers.sleepHours + ' h' : ''));
        list.append(h('li', null, h('button', { type: 'button', onclick: () => { dir = -1; step = i; render(); } },
          h('span', { class: 'k', text: CHECKIN_LABELS[q.key] }),
          h('span', { class: 'v' + (skipped ? ' is-skipped' : (q.kind === 'text' ? '' : ' is-num')), text: shown }))));
      });
      wrap.append(list);
      const save = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
        save.disabled = true;
        await saveCheckin(slot, day, answers, existing);
        closeSheet();
      } }, existing ? 'Save changes' : 'Save check-in');
      wrap.append(save, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { dir = -1; step = qs.length - 1; render(); } }, 'Back'));
    }
    body.replaceChildren(wrap);
    const panel = document.querySelector('.sheet-panel');
    if (panel) panel.scrollTop = 0;
  }
  render();
  openSheet(slotWord(slot) + ' check-in', body);
}

async function saveCheckin(slot, day, answers, existing) {
  const id = checkinId(day, slot);
  const today = todayStr();
  const at = existing ? entryDate(existing) : atFromInputs(day, day === today ? fmtTime(new Date()) : (slot === 'morning' ? '09:00' : '21:00'));
  const data = { type: 'checkin', slot, day, addedBy: state.name };
  CHECKIN_QUESTIONS[slot].forEach((q) => { data[q.key] = answers[q.key]; });
  if (slot === 'morning') data.sleepHours = answers.sleepHours;
  const mirror = {};
  if (data.mood != null) mirror.mood = Math.max(1, Math.min(5, Math.ceil(data.mood / 2)));
  if (slot === 'evening' && data.goodThing) mirror.good = data.goodThing;
  const label = slotWord(slot) + ' check-in ' + (existing ? 'updated' : 'saved');

  if (state.demo) {
    const now = new Date();
    const entry = { id, ...data, at: demoTs(at), createdAt: existing ? existing.createdAt : demoTs(now), updatedAt: demoTs(now) };
    state.recentEntries = state.recentEntries.filter((e) => e.id !== id);
    state.recentEntries.push(entry);
    sortEntries(state.recentEntries);
    state.dayEntries = state.recentEntries.filter((e) => e.day === state.selectedDay);
    if (Object.keys(mirror).length) state.days[day] = { ...(state.days[day] || {}), ...mirror };
    renderToday(); renderChemo();
    if (!$('view-vitals').hidden) renderVitals();
    toast(label);
    return;
  }
  try {
    await setDoc(doc(db, 'entries', id), {
      ...data,
      at: Timestamp.fromDate(at),
      createdAt: existing && existing.createdAt ? existing.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    if (Object.keys(mirror).length) await setDoc(doc(db, 'days', day), { ...mirror, updatedBy: state.name, updatedAt: serverTimestamp() }, { merge: true });
    toast(label);
  } catch (e) { console.error(e); toast('Could not save the check-in'); }
}

/* Extra pain readings during the day: ordinary timestamped entries, separate from the check-in scores */
$('pain-now').addEventListener('click', () => {
  const day = state.selectedDay;
  const time = timeInput(day);
  const note = h('input', { type: 'text', placeholder: 'Where, or what helped (optional)' });
  const sl = sliderBlock({ kind: 'pain', q: 'Pain right now', low: '1 none', high: '10 worst' }, null);
  const body = h('div', null,
    h('p', { class: 'wiz-q', text: 'Pain right now' }),
    ...sl.nodes,
    field('Time', time), field('Note', note),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const v = sl.value();
      if (v == null) { toast('Slide to a number first'); return; }
      const at = atFromInputs(day, time.value);
      closeSheet();
      const id = await addEntry({ type: 'pain', value: v, note: note.value.trim(), at });
      toast('Pain ' + v + '/10 logged', { label: 'Undo', onClick: () => deleteEntry(id) });
    } }, 'Save'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Log pain', body);
});

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
  if (!sched.length) $('meds-scheduled').append(h('p', { class: 'empty', 'data-art': 'pill', text: 'No scheduled medicines.' }));
  $('meds-prn').replaceChildren(...prn.map((m) => medCard(m, today)));
  if (!prn.length) $('meds-prn').append(h('p', { class: 'empty', 'data-art': 'pill', text: 'No when-needed medicines.' }));
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
  card.append(status);

  /* Every dose given today, as tappable chips (tap one to see or delete it) */
  const todays = state.recentEntries.filter((e) => e.type === 'med' && e.medId === m.id && e.day === today).sort((a, b) => entryDate(a) - entryDate(b));
  if (todays.length) {
    card.append(h('div', { class: 'med-times' },
      h('span', { class: 'med-times-label', text: 'Today' }),
      ...todays.map((e) => state.viewer
        ? h('span', { class: 'med-time med-time-view', text: fmtTime(entryDate(e)) + ' · ' + (e.addedBy || '') })
        : h('button', { class: 'med-time', type: 'button', 'aria-label': `Dose at ${fmtTime(entryDate(e))}, tap for options`, onclick: () => entryOptions(e) },
          fmtTime(entryDate(e)) + ' · ' + (e.addedBy || '')))
    ));
  } else if (last) {
    status.append(h('span', { class: 'med-last', text: 'Last ' + fmtDayShort(last.day) + ' ' + fmtTime(entryDate(last)) + ' (' + (last.addedBy || '') + ')' }));
  }

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
      closeSheet();
      if (state.demo) {
        if (isNew) state.medicines.push({ id: fakeId('med'), ...data });
        else Object.assign(state.medicines.find((x) => x.id === m.id) || {}, data);
        renderMeds();
        toast(isNew ? 'Medicine added' : 'Medicine updated');
        return;
      }
      const ref = isNew ? doc(collection(db, 'medicines')) : doc(db, 'medicines', m.id);
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
/* Vitals: latest readings and every trend chart                         */
/* ------------------------------------------------------------------ */

$('vitals-log').addEventListener('click', () => openAdd('vitals'));

document.querySelectorAll('#view-vitals .seg').forEach((b) => b.addEventListener('click', () => {
  state.trendRange = parseInt(b.dataset.range, 10);
  document.querySelectorAll('#view-vitals .seg').forEach((x) => x.classList.toggle('is-active', x === b));
  renderVitals();
}));

function whenLabel(e) {
  const d = entryDate(e);
  return (e.day === todayStr() ? 'today' : fmtDayShort(e.day)) + ' ' + fmtTime(d);
}

function renderVitalsLatest(entries) {
  const latest = (pred) => { for (let i = entries.length - 1; i >= 0; i--) if (pred(entries[i])) return entries[i]; return null; };
  const t = latest((e) => e.type === 'temp');
  const tile = $('vt-temp');
  tile.classList.remove('is-red', 'is-amber', 'is-green');
  if (t) {
    countTo($('vt-temp-value'), Number(t.value), { decimals: 1, unit: '\u00B0C' });
    $('vt-temp-sub').textContent = whenLabel(t);
    tile.classList.add(tempClass(t.value) || 'is-green');
  } else { clearCount($('vt-temp-value'), '--'); $('vt-temp-sub').textContent = 'none yet'; }

  const hr = latest((e) => e.type === 'vitals' && e.heartRate);
  if (hr) { countTo($('vt-heart-value'), Math.round(hr.heartRate), { unit: 'bpm' }); $('vt-heart-sub').textContent = whenLabel(hr); }
  else { clearCount($('vt-heart-value'), '--'); $('vt-heart-sub').textContent = 'none yet'; }

  const pn = latest((e) => (e.type === 'checkin' && e.pain != null) || e.type === 'pain');
  if (pn) {
    countTo($('vt-pain-value'), Number(pn.type === 'pain' ? pn.value : pn.pain), { unit: '/10' });
    $('vt-pain-sub').textContent = whenLabel(pn) + (pn.type === 'pain' ? ' reading' : ' check-in');
  } else { clearCount($('vt-pain-value'), '--'); $('vt-pain-sub').textContent = 'none yet'; }

  const md = latest((e) => e.type === 'checkin' && e.mood != null);
  if (md) { countTo($('vt-mood-value'), Number(md.mood), { unit: '/10' }); $('vt-mood-sub').textContent = whenLabel(md) + ' check-in'; }
  else { clearCount($('vt-mood-value'), '--'); $('vt-mood-sub').textContent = 'none yet'; }

  const bp = latest((e) => e.type === 'vitals' && e.systolic && e.diastolic);
  if (bp) { $('vt-bp-value').textContent = Math.round(bp.systolic) + '/' + Math.round(bp.diastolic); $('vt-bp-sub').textContent = whenLabel(bp); }
  else { $('vt-bp-value').textContent = '--'; $('vt-bp-sub').textContent = 'none yet'; }

  const ox = latest((e) => e.type === 'vitals' && e.oxygen);
  if (ox) { countTo($('vt-oxygen-value'), Math.round(ox.oxygen), { unit: '%' }); $('vt-oxygen-sub').textContent = whenLabel(ox); }
  else { clearCount($('vt-oxygen-value'), '--'); $('vt-oxygen-sub').textContent = 'none yet'; }

  const sl = latest((e) => e.type === 'sleep');
  if (sl) { $('vt-sleep-value').textContent = fmtHm(sl.value); $('vt-sleep-sub').textContent = sl.day === todayStr() ? 'last night' : 'night before ' + fmtDayShort(sl.day); }
  else { $('vt-sleep-value').textContent = '--'; $('vt-sleep-sub').textContent = 'none yet'; }

  const w = latest((e) => e.type === 'weight');
  if (w) { countTo($('vt-weight-value'), Number(w.value), { decimals: 1, unit: 'kg' }); $('vt-weight-sub').textContent = whenLabel(w); }
  else { clearCount($('vt-weight-value'), '--'); $('vt-weight-sub').textContent = 'none yet'; }
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

async function renderVitals() {
  const from = addDays(todayStr(), -(state.trendRange - 1));
  const entries = await loadEntriesFrom(from);
  if (!entries) return;
  entries.sort((a, b) => entryDate(a) - entryDate(b));
  renderVitalsLatest(entries);
  /* Latest readings are shown above regardless; only the charts need the library. */
  try {
    await loadScript(CDN.chart);
  } catch (e) { toast('Charts need a connection'); return; }

  const T = chartTheme();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const days = [];
  for (let i = 0; i < state.trendRange; i++) days.push(addDays(from, i));
  const dayLabel = (s) => parseDay(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const start = parseDay(from).getTime(), end = parseDay(addDays(todayStr(), 1)).getTime();
  const tickDays = days.map((s) => parseDay(s).getTime());
  const timeAxis = () => Object.assign(xAxisBase(T), { type: 'linear', min: start, max: end, ticks: Object.assign(xAxisBase(T).ticks, { callback: (v) => { const t = tickDays.indexOf(v); return t >= 0 ? dayLabel(days[t]) : ''; }, stepSize: 864e5 }), afterBuildTicks: (axis) => { axis.ticks = tickDays.map((t) => ({ value: t })); } });
  const pointTitle = (items) => items.length ? new Date(items[0].raw.x).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const lineOptions = (yAxis, tooltip, legend, pointCount) => ({
    responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, right: 10 } },
    interaction: { mode: 'nearest', intersect: false },
    animation: reduced ? false : drawIn(pointCount),
    scales: { x: timeAxis(), y: yAxis },
    plugins: { legend: legend ? legendStyle(T) : { display: false }, tooltip: Object.assign(tooltipStyle(T), { callbacks: tooltip, filter: (item) => !String(item.dataset.label).startsWith('band') }) }
  });

  /* Temperature: points in time across the range, with the 37.5 amber and 38.0 red thresholds as soft bands */
  const temps = entries.filter((e) => e.type === 'temp');
  const tPoints = temps.map((e) => ({ x: entryDate(e).getTime(), y: Number(e.value) }));
  const tempColour = (v) => v >= 38 ? T.red : v >= 37.5 ? T.amber : T.teal;
  const tLast = tPoints.length - 1;
  makeChart('temp', {
    type: 'line',
    data: { datasets: [
      lineSeries(T, T.teal, tPoints, { label: 'Temperature',
        pointBackgroundColor: (c) => { const v = c.raw && c.raw.y; return c.dataIndex === tLast ? tempColour(v) : hexAlpha(tempColour(v), 0.7); },
        pointBorderColor: (c) => c.dataIndex === tLast ? T.surface : 'transparent' }),
      bandSeries(start, end, 38, 37.5, hexAlpha(T.amber, 0.16), 'band-amber'),
      bandSeries(start, end, 40.5, 38, hexAlpha(T.red, 0.12), 'band-red')
    ] },
    options: lineOptions(Object.assign(yAxisBase(T), { min: 35, max: 40.5, ticks: Object.assign(yAxisBase(T).ticks, { stepSize: 1, maxTicksLimit: 8, includeBounds: false, callback: (v) => v.toFixed(1) }) }), {
      title: pointTitle, label: (item) => item.raw.y.toFixed(1) + ' °C'
    }, false, tPoints.length)
  });

  /* Drinks per day */
  const perDay = days.map((d) => entries.filter((e) => e.type === 'drink' && e.day === d).reduce((s, e) => s + (Number(e.value) || 0), 0));
  makeChart('drink', barChart(T, days.map(dayLabel), perDay, { unit: (v) => v + ' ml', reduced }));

  /* Weight */
  const weights = entries.filter((e) => e.type === 'weight');
  const wPoints = weights.map((e) => Number(e.value));
  makeChart('weight', {
    type: 'line',
    data: { labels: weights.map((e) => dayLabel(e.day)), datasets: [lineSeries(T, T.teal, wPoints, { label: 'kg' })] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, right: 10 } },
      interaction: { mode: 'nearest', intersect: false },
      animation: reduced ? false : drawIn(wPoints.length),
      scales: { x: xAxisBase(T), y: Object.assign(yAxisBase(T), { grace: '15%', ticks: Object.assign(yAxisBase(T).ticks, { precision: 1, callback: (v) => v + ' kg' }) }) },
      plugins: { legend: { display: false }, tooltip: Object.assign(tooltipStyle(T), { callbacks: { label: (i) => Number(i.raw).toFixed(1) + ' kg' } }) } }
  });

  /* Sleep: hours asleep per night, stacked by stage (deep, core, REM). Bar height always
     equals the logged hours asleep, same as before; any night without a stage breakdown
     (or only partly tagged) fills the rest as "Not broken down" so old entries still show.
     Awake-in-bed minutes are not part of the total (they are time in bed, not asleep) and
     appear in the tooltip instead. */
  const sleepEntries = days.map((d) => entries.filter((x) => x.type === 'sleep' && x.day === d).pop() || null);
  const hoursOf = (mins) => Math.round(Number(mins || 0) / 6) / 10;
  const deepH = sleepEntries.map((e) => e ? hoursOf(e.deep) : null);
  const coreH = sleepEntries.map((e) => e ? hoursOf(e.core) : null);
  const remH = sleepEntries.map((e) => e ? hoursOf(e.rem) : null);
  /* Remainder worked out in whole minutes first, so rounding the stages does not leave a phantom sliver */
  const otherH = sleepEntries.map((e) => e ? hoursOf(Math.max(0, (Number(e.value) || 0) - (Number(e.deep) || 0) - (Number(e.core) || 0) - (Number(e.rem) || 0))) : null);
  const awakeMins = sleepEntries.map((e) => (e && e.awake) ? Number(e.awake) : 0);
  const sleepStageSet = (label, data, colour) => ({ label, data, backgroundColor: hexAlpha(colour, 0.85), borderColor: T.surface, borderWidth: 1.5, borderRadius: 4, borderSkipped: false, stack: 'sleep', maxBarThickness: 28 });
  makeChart('sleep', {
    type: 'bar',
    data: { labels: days.map(dayLabel), datasets: [
      sleepStageSet('Deep', deepH, cssVar('--sleep-deep')),
      sleepStageSet('Core', coreH, cssVar('--sleep-core')),
      sleepStageSet('REM', remH, cssVar('--sleep-rem')),
      sleepStageSet('Not broken down', otherH, T.muted)
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, right: 4 } },
      animation: reduced ? false : { duration: 700, easing: 'easeOutQuart' },
      scales: {
        x: Object.assign(xAxisBase(T), { stacked: true }),
        y: Object.assign(yAxisBase(T), { stacked: true, beginAtZero: true, suggestedMax: 9, ticks: Object.assign(yAxisBase(T).ticks, { callback: (v) => v + ' h' }) })
      },
      plugins: {
        legend: (() => { const L = legendStyle(T); L.labels = Object.assign({}, L.labels, { filter: (item, data) => data.datasets[item.datasetIndex].data.some((v) => v > 0) }); return L; })(),
        tooltip: Object.assign(tooltipStyle(T), { callbacks: {
          label: (item) => item.raw > 0 ? item.dataset.label + ': ' + fmtHm(item.raw * 60) : null,
          footer: (items) => { const m = awakeMins[items[0].dataIndex]; return m > 0 ? 'Also ' + fmtHm(m) + ' awake in bed' : ''; }
        } })
      }
    }
  });

  /* Vitals: heart rate, blood pressure and oxygen, all logged together from a
     manual reading. Each is its own chart, points in time, same layout as temperature. */
  const vitalsEntries = entries.filter((e) => e.type === 'vitals');

  const hPoints = vitalsEntries.filter((e) => e.heartRate).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.heartRate) }));
  makeChart('heart', {
    type: 'line',
    data: { datasets: [lineSeries(T, T.teal, hPoints, { label: 'Heart rate' })] },
    options: lineOptions(Object.assign(yAxisBase(T), { beginAtZero: false, ticks: Object.assign(yAxisBase(T).ticks, { callback: (v) => v + ' bpm' }) }), { title: pointTitle, label: (item) => Math.round(item.raw.y) + ' bpm' }, false, hPoints.length)
  });

  const bpEntries = vitalsEntries.filter((e) => e.systolic && e.diastolic);
  const sysPoints = bpEntries.map((e) => ({ x: entryDate(e).getTime(), y: Number(e.systolic) }));
  const diaPoints = bpEntries.map((e) => ({ x: entryDate(e).getTime(), y: Number(e.diastolic) }));
  makeChart('bp', {
    type: 'line',
    data: { datasets: [
      lineSeries(T, T.teal, sysPoints, { label: 'Systolic' }),
      lineSeries(T, T.warm, diaPoints, { label: 'Diastolic' })
    ] },
    options: lineOptions(Object.assign(yAxisBase(T), { beginAtZero: false, ticks: Object.assign(yAxisBase(T).ticks, { callback: (v) => v + ' mmHg' }) }), { title: pointTitle, label: (item) => item.dataset.label + ': ' + Math.round(item.raw.y) + ' mmHg' }, true, sysPoints.length)
  });

  const o2Points = vitalsEntries.filter((e) => e.oxygen).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.oxygen) }));
  makeChart('oxygen', {
    type: 'line',
    data: { datasets: [lineSeries(T, T.teal, o2Points, { label: 'Oxygen' })] },
    options: lineOptions(Object.assign(yAxisBase(T), { min: 80, max: 100, ticks: Object.assign(yAxisBase(T).ticks, { callback: (v) => v + '%' }) }), { title: pointTitle, label: (item) => Math.round(item.raw.y) + '%' }, false, o2Points.length)
  });

  /* Pain: the check-in scores make the line; extra readings are hollow warm points. A calm scale, no red. */
  const ciPain = entries.filter((e) => e.type === 'checkin' && e.pain != null).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.pain) }));
  const spotPain = entries.filter((e) => e.type === 'pain').map((e) => ({ x: entryDate(e).getTime(), y: Number(e.value) }));
  const tenScale = () => Object.assign(yAxisBase(T), { min: 0, max: 10, ticks: Object.assign(yAxisBase(T).ticks, { stepSize: 2, maxTicksLimit: 6 }) });
  makeChart('pain', {
    type: 'line',
    data: { datasets: [
      lineSeries(T, T.teal, ciPain, { label: 'Check-in' }),
      { label: 'Extra reading', data: spotPain, borderColor: T.warm, backgroundColor: T.surface, pointBackgroundColor: T.surface, pointBorderColor: T.warm, pointRadius: 4, pointHoverRadius: 7, pointBorderWidth: 2, pointHitRadius: 12, showLine: false, fill: false }
    ] },
    options: lineOptions(tenScale(), { title: pointTitle, label: (item) => item.dataset.label + ': ' + item.raw.y + '/10' }, true, ciPain.length)
  });

  const ciMood = entries.filter((e) => e.type === 'checkin' && e.mood != null).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.mood) }));
  makeChart('mood', {
    type: 'line',
    data: { datasets: [lineSeries(T, T.teal, ciMood, { label: 'Mood' })] },
    options: lineOptions(tenScale(), { title: pointTitle, label: (item) => item.raw.y + '/10' }, false, ciMood.length)
  });
}

/* ---- Chart styling shared by every chart: calm lines, gradient fills, subtle points, a lit last point ---- */
function hexAlpha(hex, a) {
  const c = String(hex).replace('#', '');
  if (c.length !== 6 && c.length !== 3) return hex;
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function chartTheme() {
  const Chart = window.Chart;
  Chart.defaults.font.family = cssVar('--font-mono') || 'monospace';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = cssVar('--text-muted');
  return {
    teal: cssVar('--teal'), warm: cssVar('--warm'), red: cssVar('--danger'), amber: cssVar('--warning'),
    surface: cssVar('--surface'), ink: cssVar('--text-primary'), muted: cssVar('--text-muted'),
    grid: hexAlpha(cssVar('--border-subtle'), 0.6), body: cssVar('--font-body'), mono: cssVar('--font-mono')
  };
}
function xAxisBase(T) { return { grid: { display: false }, border: { display: false }, ticks: { color: T.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, padding: 6, font: { size: 11 } } }; }
function yAxisBase(T) { return { grid: { color: T.grid, drawTicks: false }, border: { display: false }, ticks: { color: T.muted, maxTicksLimit: 5, padding: 8, font: { size: 11 } } }; }
function legendStyle(T) { return { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 18, color: cssVar('--text-secondary'), font: { family: T.body, size: 13 } } }; }
function tooltipStyle(T) { return { backgroundColor: T.ink, titleColor: T.surface, bodyColor: T.surface, titleFont: { family: T.mono, size: 11 }, bodyFont: { family: T.body, size: 14, weight: '600' }, padding: 10, cornerRadius: 8, displayColors: false }; }
function areaFill(colour) {
  return (ctx) => {
    const area = ctx.chart.chartArea;
    if (!area) return hexAlpha(colour, 0.12);
    const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, hexAlpha(colour, 0.26));
    g.addColorStop(1, hexAlpha(colour, 0));
    return g;
  };
}
function lineSeries(T, colour, data, extra) {
  const last = data.length - 1;
  return Object.assign({
    data, borderColor: colour, borderWidth: 2.5, borderCapStyle: 'round', borderJoinStyle: 'round',
    tension: 0.3, cubicInterpolationMode: 'monotone', fill: 'origin', backgroundColor: areaFill(colour),
    pointRadius: (c) => c.dataIndex === last ? 5 : 2.5, pointHoverRadius: 7, pointHitRadius: 12,
    pointBackgroundColor: (c) => c.dataIndex === last ? colour : hexAlpha(colour, 0.6),
    pointBorderColor: (c) => c.dataIndex === last ? T.surface : 'transparent', pointBorderWidth: 2,
    showLine: data.length > 1
  }, extra || {});
}
/* A soft filled band between two values, drawn behind the line and kept out of the tooltip */
function bandSeries(start, end, top, bottom, colour, label) {
  return { label, data: [{ x: start, y: top }, { x: end, y: top }], borderWidth: 0, pointRadius: 0, pointHitRadius: 0, pointHoverRadius: 0, tension: 0, animation: false, fill: { target: { value: bottom }, above: colour, below: colour }, backgroundColor: colour };
}
/* Lines draw in left to right, the area fill following behind them (the Chart.js progressive-line pattern) */
function drawIn(pointCount) {
  const total = 900, step = total / Math.max(1, pointCount);
  const started = (key) => (ctx) => { if (ctx.type !== 'data' || ctx[key]) return 0; ctx[key] = true; return ctx.index * step; };
  return {
    x: { type: 'number', easing: 'linear', duration: step, from: NaN, delay: started('xStarted') },
    y: { type: 'number', easing: 'linear', duration: step, delay: started('yStarted'),
      from: (ctx) => {
        const base = ctx.chart.scales.y.getPixelForValue(ctx.chart.scales.y.min);
        if (ctx.type !== 'data' || ctx.index === 0) return base;
        const meta = ctx.chart.getDatasetMeta(ctx.datasetIndex);
        const prev = meta && meta.data && meta.data[ctx.index - 1];
        return prev && typeof prev.getProps === 'function' ? prev.getProps(['y'], true).y : base;
      } }
  };
}
function barChart(T, labels, data, o) {
  const last = (() => { for (let i = data.length - 1; i >= 0; i--) if (data[i] != null && data[i] > 0) return i; return -1; })();
  return {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: (c) => c.dataIndex === last ? T.teal : hexAlpha(T.teal, 0.6), borderRadius: 6, borderSkipped: 'bottom', maxBarThickness: 28 }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, right: 4 } },
      animation: o.reduced ? false : { duration: 700, easing: 'easeOutQuart' },
      scales: { x: xAxisBase(T), y: Object.assign(yAxisBase(T), { beginAtZero: true, suggestedMax: o.suggestedMax, ticks: Object.assign(yAxisBase(T).ticks, { callback: o.unit }) }) },
      plugins: { legend: { display: false }, tooltip: Object.assign(tooltipStyle(T), { callbacks: { label: (i) => (o.tip || o.unit)(i.raw) } }) } }
  };
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

$('doc-edit').addEventListener('click', () => {
  const d = currentDocRecord();
  if (!d) return;
  const title = h('input', { type: 'text', value: d.title || '', required: true });
  const date = h('input', { type: 'date', value: d.docDate || todayStr() });
  const category = h('select', null,
    h('option', { value: 'general', text: 'General' }),
    h('option', { value: 'chemo', text: 'Chemo plan (also shown on the Chemo tab)' }),
    h('option', { value: 'exemption', text: 'Exemption certificate (also shown on the Meds tab)' })
  );
  category.value = d.category === 'chemo' ? 'chemo' : d.category === 'exemption' ? 'exemption' : 'general';
  const body = h('div', null,
    field('Title', title), field('Date on the document', date), field('Category', category),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const t = title.value.trim();
      if (!t) { toast('Please enter a title'); return; }
      const data = { title: t, docDate: date.value || todayStr(), category: category.value };
      closeSheet();
      if (state.demo) {
        Object.assign(d, data);
        state.documents.sort((a, b) => (b.docDate || '').localeCompare(a.docDate || ''));
        renderDocsList();
      } else {
        try { await updateDoc(doc(db, 'documents', d.id), { ...data, updatedAt: serverTimestamp() }); }
        catch (e) { console.error(e); toast('Could not save the changes'); return; }
      }
      $('doc-title').textContent = t;
      $('doc-meta').textContent = `${fmtDayNum(data.docDate)} · added by ${d.addedBy || ''}`;
      toast('Details updated');
    } }, 'Save changes'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Edit details', body);
});
$('docs-back').addEventListener('click', () => showTab(state.docsReturn || 'more'));
$('more-docs').addEventListener('click', () => openDocs('more'));
$('chemo-doc-add').addEventListener('click', () => openAddDocument('chemo'));

function docItem(d, i) {
  return markNew(docItemEl(d), seenIds.docs, d.id, i || 0);
}

function docItemEl(d) {
  return h('button', { class: 'docitem', type: 'button', onclick: () => { if ($('view-docs').hidden) openDocs(d.category === 'chemo' ? 'chemo' : d.category === 'exemption' ? 'meds' : 'more'); openDocument(d.id); } },
    icon(d.kind === 'text' ? 'doc' : 'image', 'docitem-icon'),
    h('div', { class: 'docitem-main' },
      h('div', { class: 'docitem-title', text: d.title }),
      h('div', { class: 'docitem-sub', text: [fmtDayNum(d.docDate || ''), d.category === 'chemo' ? 'Chemo plan' : d.category === 'exemption' ? 'Exemption certificate' : null, d.kind === 'text' ? 'Text' : (d.pageCount === 1 ? '1 page' : d.pageCount + ' pages'), d.explanation ? 'Explained' : 'No explanation yet'].filter(Boolean).join(' \u00B7 ') })
    ),
    h('span', { class: 'pill ' + (d.explanation ? 'pill-green' : 'pill-amber'), 'aria-label': d.explanation ? 'Explained' : 'No explanation yet' }, d.explanation ? icon('check') : '?')
  );
}

function renderChemoDocs() {
  const docs = state.documents.filter((d) => d.category === 'chemo');
  $('chemo-docs').replaceChildren(...docs.map((d, i) => h('li', null, docItem(d, i))));
  $('chemo-docs-empty').hidden = docs.length > 0;
}

function renderMedsDocs() {
  const docs = state.documents.filter((d) => d.category === 'exemption');
  $('meds-docs').replaceChildren(...docs.map((d, i) => h('li', null, docItem(d, i))));
  $('meds-docs-empty').hidden = docs.length > 0;
}

function renderDocsList() {
  const list = $('docs-list');
  list.replaceChildren(...state.documents.map((d, i) => h('li', null, docItem(d, i))));
  renderChemoDocs();
  renderMedsDocs();
  $('docs-empty').hidden = state.documents.length > 0;
  if (state.currentDoc) {
    const d = state.documents.find((x) => x.id === state.currentDoc.id);
    if (!d) showDocsList();
  }
}

$('doc-add').addEventListener('click', () => openAddDocument('general'));
$('meds-doc-add').addEventListener('click', () => openAddDocument('exemption'));

/* One-screen add: choose photos or a PDF, give a title and date, paste Claude's
   summary (smart-filling title, date and explanation when it is in the Care Log
   block format), then save the document and its pages together in one batch. */
function openAddDocument(category) {
  let staged = null; // { kind: 'images', pages: [{data,width,height}] } once files are processed

  const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf', multiple: true, style: 'display:none' });
  const chooseBtn = h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => fileInput.click() }, 'Choose photos or PDF');
  const fileProgress = h('div', { class: 'progress' }, h('span', { text: '' }), h('div', { class: 'progress-bar' }, h('div')));
  fileProgress.hidden = true;
  const setFileProgress = (text, frac) => { fileProgress.hidden = false; fileProgress.firstChild.textContent = text; fileProgress.querySelector('.progress-bar > div').style.width = Math.round((frac || 0) * 100) + '%'; };
  const thumbs = h('div', { class: 'thumbs' });
  const pageCountLabel = h('p', { class: 'muted mono' });
  pageCountLabel.hidden = true;

  const title = h('input', { type: 'text', placeholder: 'e.g. Oncology letter', required: true, value: category === 'exemption' ? 'NHS Medical Exemption Certificate' : '' });
  const date = h('input', { type: 'date', value: todayStr() });

  const explanation = h('textarea', { rows: '8', placeholder: 'Paste Claude’s explanation here, or use Paste summary above' });
  const pasteBtn = h('button', { class: 'btn btn-secondary btn-block', type: 'button' }, 'Paste summary');

  const save = h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, 'Save');
  const cancel = h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel');
  const saveProgress = h('div', { class: 'progress' }, h('span', { text: '' }), h('div', { class: 'progress-bar' }, h('div')));
  saveProgress.hidden = true;
  const setSaveProgress = (text, frac) => { saveProgress.hidden = false; saveProgress.firstChild.textContent = text; saveProgress.querySelector('.progress-bar > div').style.width = Math.round((frac || 0) * 100) + '%'; };

  function renderThumbs() {
    const pages = (staged && staged.pages) || [];
    thumbs.replaceChildren(...pages.map((p, i) => h('img', { class: 'thumb', src: 'data:image/jpeg;base64,' + p.data, alt: 'Page ' + (i + 1) })));
    pageCountLabel.hidden = pages.length === 0;
    pageCountLabel.textContent = pages.length === 1 ? '1 page ready' : pages.length + ' pages ready';
  }

  function updateSaveEnabled() {
    const hasTitle = title.value.trim().length > 0;
    const hasPages = Boolean(staged && ((staged.pages && staged.pages.length) || (staged.kind === 'text' && staged.text)));
    const hasExplanation = explanation.value.trim().length > 0;
    save.disabled = !(hasTitle && (hasPages || hasExplanation));
  }

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    chooseBtn.disabled = true;
    setFileProgress('Processing', 0);
    try {
      staged = await processFiles(Array.from(fileInput.files), setFileProgress);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Could not process that file');
      staged = null;
    }
    chooseBtn.disabled = false;
    fileProgress.hidden = true;
    renderThumbs();
    updateSaveEnabled();
  });

  title.addEventListener('input', updateSaveEnabled);
  explanation.addEventListener('input', updateSaveEnabled);
  pasteBtn.addEventListener('click', () => pasteSummaryInto({ titleEl: title, dateEl: date, explanationEl: explanation, onFilled: updateSaveEnabled }));

  save.addEventListener('click', async () => {
    if (save.disabled) return;
    save.disabled = true; cancel.disabled = true;
    setSaveProgress('Saving', 0.6);
    try {
      await saveDocumentBatch({
        category: category === 'chemo' ? 'chemo' : category === 'exemption' ? 'exemption' : 'general',
        title: title.value.trim(),
        docDate: date.value || todayStr(),
        explanation: explanation.value.trim(),
        kind: (staged && staged.kind) || 'images',
        pages: (staged && staged.pages) || [],
        text: (staged && staged.text) || ''
      });
      setSaveProgress('Saved', 1);
      setTimeout(() => { closeSheet(); toast('Document saved'); }, 400);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Could not save');
      save.disabled = false; cancel.disabled = false;
      saveProgress.hidden = true;
    }
  });

  const body = h('div', null,
    fileInput, chooseBtn, fileProgress, thumbs, pageCountLabel,
    h('p', { class: 'hint', text: 'Photos or a PDF, up to 30 pages. A document can be saved with no pages if it just has a pasted summary.' }),
    field('Title', title), field('Date on the document', date),
    h('h3', { class: 'section-title', text: 'Explanation' }),
    pasteBtn, explanation,
    h('p', { class: 'hint', text: NOT_MEDICAL_ADVICE }),
    save, saveProgress, cancel
  );
  openSheet(category === 'chemo' ? 'Add the chemo plan' : category === 'exemption' ? 'Add exemption certificate' : 'Add document', body);
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
        if (pages.length >= MAX_PAGES) throw new Error(`Too many pages. The limit is ${MAX_PAGES} pages per document.`);
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
      if (pages.length >= MAX_PAGES) throw new Error(`Too many pages. The limit is ${MAX_PAGES} pages per document.`);
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

/* Writes the document record and every page of its pages subcollection in a
   single Firestore batch, so the two never end up out of step. */
async function saveDocumentBatch({ category, title, docDate, explanation, kind, pages, text }) {
  const data = {
    title, docDate, kind: kind || 'images', category: category || 'general', pageCount: pages.length,
    explanation: explanation || '', addedBy: state.name, addedAt: state.demo ? demoTs(new Date()) : serverTimestamp(), updatedAt: state.demo ? demoTs(new Date()) : serverTimestamp()
  };
  if (kind === 'text' && text) data.text = text;
  if (state.demo) {
    const id = fakeId('doc');
    state.documents.unshift({ id, ...data });
    state.demoPages[id] = pages;
    renderDocsList();
    return id;
  }
  const ref = doc(collection(db, 'documents'));
  const batch = writeBatch(db);
  batch.set(ref, data);
  pages.forEach((p, i) => {
    batch.set(doc(db, 'documents', ref.id, 'pages', String(i + 1)), { n: i + 1, data: p.data, width: p.width, height: p.height });
  });
  await batch.commit();
  return ref.id;
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
  if (state.demo) {
    state.currentDoc.pages = state.demoPages[id] || [];
    pagesEl.replaceChildren(...state.currentDoc.pages.map((p, i) => h('img', { src: 'data:image/jpeg;base64,' + p.data, alt: `Page ${i + 1}`, width: p.width, height: p.height, loading: 'lazy' })));
    if (!state.currentDoc.pages.length) pagesEl.append(h('p', { class: 'empty', 'data-art': 'doc', text: 'No pages found.' }));
    return;
  }
  try {
    const snap = await getDocs(query(collection(db, 'documents', id, 'pages'), orderBy('n')));
    if (!state.currentDoc || state.currentDoc.id !== id) return;
    state.currentDoc.pages = snap.docs.map((p) => p.data());
    pagesEl.replaceChildren(...state.currentDoc.pages.map((p, i) => h('img', { src: 'data:image/jpeg;base64,' + p.data, alt: `Page ${i + 1}`, width: p.width, height: p.height, loading: 'lazy' })));
    if (!state.currentDoc.pages.length) pagesEl.append(h('p', { class: 'empty', 'data-art': 'doc', text: 'No pages found.' }));
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
  return `${CLAUDE_INTRO}\n\nDocument: ${d.title} (dated ${fmtDayNum(d.docDate || '')}).\n\n${CLAUDE_FORMAT}`;
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

$('doc-paste-summary').addEventListener('click', () => {
  if (!currentDocRecord()) return;
  pasteSummaryInto({ explanationEl: $('doc-explanation') });
});

$('doc-save-explanation').addEventListener('click', async () => {
  const d = currentDocRecord();
  if (!d) return;
  const btn = $('doc-save-explanation');
  btn.disabled = true;
  const text = $('doc-explanation').value.trim();
  if (state.demo) { d.explanation = text; renderDocsList(); toast('Explanation saved'); btn.disabled = false; return; }
  try {
    await updateDoc(doc(db, 'documents', d.id), { explanation: text, updatedAt: serverTimestamp() });
    toast('Explanation saved');
  } catch (e) { console.error(e); toast('Could not save'); }
  btn.disabled = false;
});

$('doc-delete').addEventListener('click', async () => {
  const d = currentDocRecord();
  if (!d) return;
  if (!(await confirmSheet('Delete document', `Delete "${d.title}" and its explanation? This cannot be undone.`, 'Delete', true))) return;
  if (state.demo) {
    delete state.demoPages[d.id];
    state.documents = state.documents.filter((x) => x.id !== d.id);
    showDocsList();
    toast('Document deleted');
    return;
  }
  try {
    const snap = await getDocs(collection(db, 'documents', d.id, 'pages'));
    for (const p of snap.docs) await deleteDoc(p.ref);
    await deleteDoc(doc(db, 'documents', d.id));
    showDocsList();
    toast('Document deleted');
  } catch (e) { console.error(e); toast('Could not delete'); }
});

/* ------------------------------------------------------------------ */
/* Chemo Party Plan: calendar, mood, cheer board                         */
/* ------------------------------------------------------------------ */

function renderChemo() {
  renderChemoProgress();
  renderCalendar();
  renderCheers();
  renderChemoDocs();
}

function renderChemoProgress() {
  const keys = Object.keys(state.days).filter((k) => state.days[k].chemo).sort();
  const planned = keys.length;
  const done = keys.filter((k) => state.days[k].chemoDone).length;
  $('chemo-count').textContent = `${done} of ${planned} done`;
  $('chemo-bar').style.width = planned ? Math.round((done / planned) * 100) + '%' : '0%';
  const today = todayStr();
  const upcoming = keys.filter((k) => !state.days[k].chemoDone && k >= today);
  let text;
  if (!planned) text = 'Tap a day on the calendar to mark a chemo session.';
  else if (upcoming.length) {
    const next = upcoming[0];
    const gap = Math.round((parseDay(next) - parseDay(today)) / 864e5);
    text = next === today ? 'Next session: today.' : `Next session: ${fmtDayLong(next)}, ${gap === 1 ? 'tomorrow' : 'in ' + gap + ' days'}.`;
  } else text = done === planned ? 'Every session done. That is a proper milestone.' : 'No upcoming sessions marked.';
  $('chemo-next').textContent = text;
}

$('cal-prev').addEventListener('click', () => { state.chemoMonth = shiftMonth(state.chemoMonth, -1); renderCalendar(); });
$('cal-next').addEventListener('click', () => { state.chemoMonth = shiftMonth(state.chemoMonth, 1); renderCalendar(); });
$('cal-title').addEventListener('click', () => { state.chemoMonth = todayStr().slice(0, 7); renderCalendar(); });

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function renderCalendar() {
  const [y, m] = state.chemoMonth.split('-').map(Number);
  $('cal-title').textContent = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const startDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayStr();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(h('div', { class: 'cal-cell is-empty' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad2(m)}-${pad2(d)}`;
    const info = state.days[key] || {};
    const cls = ['cal-cell'];
    if (key === today) cls.push('is-today');
    if (info.chemo) cls.push('is-chemo');
    if (info.chemoDone) cls.push('is-done');
    const label = [fmtDayLong(key), info.chemo ? (info.chemoDone ? 'chemo session done' : 'chemo session') : null, info.mood ? 'mood ' + MOODS[info.mood - 1].label : null].filter(Boolean).join(', ');
    cells.push(h('button', { class: cls.join(' '), type: 'button', 'aria-label': label, disabled: state.viewer, onclick: () => openDaySheet(key) },
      h('span', { class: 'cal-num', text: String(d) }),
      info.mood ? moodMark(info.mood) : null
    ));
  }
  $('cal-grid').replaceChildren(...cells);
}

/* One sheet per calendar day: chemo session, session done, mood, one good thing */
function openDaySheet(key) {
  const info = state.days[key] || {};
  const cbChemo = h('input', { type: 'checkbox' });
  cbChemo.checked = !!info.chemo;
  const cbDone = h('input', { type: 'checkbox' });
  cbDone.checked = !!info.chemoDone;
  const doneRow = h('label', { class: 'check' }, cbDone, h('span', { text: 'Session done' }));
  const syncDone = () => { doneRow.hidden = !cbChemo.checked; if (!cbChemo.checked) cbDone.checked = false; };
  cbChemo.addEventListener('change', syncDone);
  syncDone();

  const moodInfo = info.mood ? 'Mood that day: ' + MOODS[info.mood - 1].label.toLowerCase() + (info.good ? '. ' + info.good : '') : '';

  const body = h('div', null,
    h('label', { class: 'check' }, cbChemo, h('span', { text: 'Chemo session this day' })),
    doneRow,
    h('p', { class: 'hint', text: (moodInfo ? moodInfo + ' ' : '') + 'Mood and one good thing come from the daily check-ins on Today.' }),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const wasDone = !!info.chemoDone;
      const data = { chemo: cbChemo.checked, chemoDone: cbChemo.checked && cbDone.checked, updatedBy: state.name, updatedAt: serverTimestamp() };
      closeSheet();
      if (state.demo) {
        state.days[key] = { ...state.days[key], ...data };
        renderChemo();
        if (data.chemoDone && !wasDone) { confetti(); toast('One more session done. Well done.'); }
        else toast('Saved');
        return;
      }
      try {
        await setDoc(doc(db, 'days', key), data, { merge: true });
        if (data.chemoDone && !wasDone) { confetti(); toast('One more session done. Well done.'); }
        else toast('Saved');
      } catch (e) { console.error(e); toast('Could not save'); }
    } }, 'Save'),
    info.chemo ? h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: async () => {
      closeSheet();
      const data = { chemo: false, chemoDone: false, updatedBy: state.name, updatedAt: serverTimestamp() };
      if (state.demo) { state.days[key] = { ...state.days[key], chemo: false, chemoDone: false }; renderChemo(); toast('Session removed'); return; }
      try { await setDoc(doc(db, 'days', key), data, { merge: true }); toast('Session removed'); } catch (e) { console.error(e); toast('Could not clear'); }
    } }, 'Remove the session from this day') : null,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet(fmtDayLong(key), body);
}

/* Cheer board */
$('cheer-post').addEventListener('click', postCheer);
$('cheer-text').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); postCheer(); } });

async function postCheer() {
  const input = $('cheer-text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (state.demo) {
    state.cheers.unshift({ id: fakeId('cheer'), text, addedBy: state.name, createdAt: demoTs(new Date()) });
    renderCheers();
    return;
  }
  try {
    await setDoc(doc(collection(db, 'cheers')), { text, addedBy: state.name, createdAt: serverTimestamp() });
  } catch (e) { console.error(e); toast('Could not post'); }
}

function renderCheers() {
  const list = $('cheers');
  let fresh = 0;
  list.replaceChildren(...state.cheers.map((c) => markNew(cheerRow(c), seenIds.cheers, c.id, seenIds.cheers.has(c.id) ? 0 : fresh++)));
  $('cheers-empty').hidden = state.cheers.length > 0;
}

function cheerRow(c) {
  {
    const when = c.createdAt && typeof c.createdAt.toDate === 'function'
      ? c.createdAt.toDate().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'just now';
    return h('li', { class: 'cheer' },
      h('div', { class: 'cheer-body' },
        h('div', { class: 'cheer-text', text: c.text }),
        h('div', { class: 'cheer-meta', text: (c.addedBy || '') + ' · ' + when })
      ),
      c.addedBy === state.name ? h('button', { class: 'cheer-del', type: 'button', 'aria-label': 'Remove note', onclick: async () => {
        if (await confirmSheet('Remove note', 'Take this note off the board?', 'Remove', true)) deleteDoc(doc(db, 'cheers', c.id));
      } }, '×') : null
    );
  }
}

/* A short, calm confetti burst when a session is marked done. Skipped for reduced motion. */
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('confetti');
  const ctx = c.getContext('2d');
  c.width = window.innerWidth; c.height = window.innerHeight;
  c.hidden = false;
  const colours = [cssVar('--teal'), cssVar('--success'), cssVar('--warm'), cssVar('--cat-weight'), cssVar('--cat-drink')];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.4,
    vx: (Math.random() - 0.5) * 2.5, vy: 2.5 + Math.random() * 3.5,
    w: 6 + Math.random() * 6, hh: 3 + Math.random() * 3,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
    colour: colours[Math.floor(Math.random() * colours.length)]
  }));
  const start = performance.now();
  function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.colour;
      ctx.fillRect(-p.w / 2, -p.hh / 2, p.w, p.hh); ctx.restore();
    }
    if (t - start < 2400) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, c.width, c.height); c.hidden = true; }
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Exercise: steps by hand, daily goals, streak                          */
/* ------------------------------------------------------------------ */

function goals() { return { ...GOAL_DEFAULTS, ...((state.profile && state.profile.exerciseGoals) || {}) }; }
function exerciseFor(day) { return state.exercise[day] || {}; }
function allGoalsDone(day) { const d = exerciseFor(day).done || {}; return GOAL_ROWS.every((g) => d[g.key]); }

function exerciseStreak() {
  let n = 0;
  let d = todayStr();
  if (!allGoalsDone(d)) d = addDays(d, -1);
  while (allGoalsDone(d) && n < 3660) { n++; d = addDays(d, -1); }
  return n;
}

$('ex-prev').addEventListener('click', () => { state.exerciseDay = addDays(state.exerciseDay, -1); renderExercise(); });
$('ex-next').addEventListener('click', () => { if (state.exerciseDay < todayStr()) { state.exerciseDay = addDays(state.exerciseDay, 1); renderExercise(); } });
$('ex-label').addEventListener('click', () => { state.exerciseDay = todayStr(); renderExercise(); });

function renderExercise() {
  const day = state.exerciseDay;
  const today = todayStr();
  const lbl = $('ex-label');
  lbl.replaceChildren(fmtDayLong(day), h('small', { text: day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : fmtDayNum(day) }));
  $('ex-next').style.visibility = day >= today ? 'hidden' : 'visible';

  const rec = exerciseFor(day);
  if (rec.steps) { countTo($('ex-steps-value'), Number(rec.steps), { format: (n) => Math.round(n).toLocaleString('en-GB') }); $('ex-steps-sub').textContent = 'steps'; }
  else { clearCount($('ex-steps-value'), '--'); $('ex-steps-sub').textContent = 'not logged'; }

  const streak = exerciseStreak();
  countTo($('ex-streak-value'), streak);
  $('ex-streak-sub').textContent = streak === 1 ? 'day all done' : 'days all done';
  $('ex-streak-tile').classList.toggle('is-green', streak > 0);

  const g = goals();
  const done = rec.done || {};
  $('ex-goals').replaceChildren(...GOAL_ROWS.map((row) => h('button', { class: 'goal' + (done[row.key] ? ' is-done' : ''), type: 'button', 'aria-pressed': done[row.key] ? 'true' : 'false', onclick: () => toggleGoal(day, row.key) },
    h('span', { class: 'goal-box' }, done[row.key] ? icon('check') : null),
    h('span', { class: 'goal-label', text: row.label }),
    h('span', { class: 'goal-target', text: row.fmt(g[row.goal]) })
  )));
  renderStepsChart();
}

async function toggleGoal(day, key) {
  const rec = exerciseFor(day);
  const done = { ...(rec.done || {}) };
  done[key] = !done[key];
  const nowAll = GOAL_ROWS.every((g) => done[g.key]);
  const wasAll = allGoalsDone(day);
  if (state.demo) {
    state.exercise[day] = { ...rec, day, done };
    renderExercise();
    if (nowAll && !wasAll) toast('All four done. Nice work.');
    return;
  }
  try {
    await setDoc(doc(db, 'exercise', day), { day, done, addedBy: state.name, updatedAt: serverTimestamp() }, { merge: true });
    if (nowAll && !wasAll) toast('All four done. Nice work.');
  } catch (e) { console.error(e); toast('Could not save'); }
}

$('ex-steps-edit').addEventListener('click', () => openStepsSheet(state.exerciseDay));

/* Steps can be logged for any past day: the sheet has its own day picker, so
   yesterday's count can go in the next morning without hunting for the arrows. */
/* A real calendar, same look as the Chemo one, so any past day can be tapped
   directly rather than hunting through Today/Yesterday presets or a native
   date wheel. Days already logged show green; today has a ring; the chosen
   day is filled in teal; future days are disabled. */
function openStepsSheet(initialDay) {
  const today = todayStr();
  let day = initialDay > today ? today : initialDay;
  let month = day.slice(0, 7);

  const input = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '1', placeholder: '0' });
  const dayLabel = h('p', { class: 'muted' });
  const calTitle = h('button', { class: 'cal-title', type: 'button', 'aria-label': 'Go to this month' });
  const calGrid = h('div', { class: 'cal-grid' });
  const calPrev = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Previous month', text: '‹' });
  const calNext = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Next month', text: '›' });

  const syncInput = () => {
    const rec = exerciseFor(day);
    input.value = rec.steps ? String(rec.steps) : '';
    dayLabel.textContent = fmtDayLong(day) + (day === today ? ' (today)' : '');
  };

  /* Saves steps for one day without touching whichever day is on screen afterwards.
     Used by both the Save button and the day-switch guard below. */
  async function saveStepsFor(targetDay, v) {
    const rec = exerciseFor(targetDay);
    if (!state.demo) {
      try { await setDoc(doc(db, 'exercise', targetDay), { day: targetDay, steps: v, addedBy: state.name, updatedAt: serverTimestamp() }, { merge: true }); }
      catch (e) { console.error(e); return false; }
    }
    state.exercise[targetDay] = { ...rec, day: targetDay, steps: v };
    return true;
  }

  /* If the box has a typed value that has not been saved for the day it belongs to,
     save it before moving on, so switching days never silently drops what was typed. */
  async function saveIfDirty() {
    const raw = input.value.trim();
    if (raw === '') return;
    const v = parseInt(raw, 10);
    if (isNaN(v) || v < 0) return;
    if (v === (exerciseFor(day).steps || 0)) return;
    const savedDay = day;
    const ok = await saveStepsFor(savedDay, v);
    if (ok) { renderExercise(); toast(fmtDayShort(savedDay) + ': ' + v.toLocaleString('en-GB') + ' steps saved'); }
    else toast('Could not save ' + fmtDayShort(savedDay));
  }

  function renderCal() {
    const [y, m] = month.split('-').map(Number);
    calTitle.textContent = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    calNext.disabled = month >= today.slice(0, 7);
    const startDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(h('div', { class: 'cal-cell is-empty' }));
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${pad2(m)}-${pad2(d)}`;
      const future = key > today;
      const logged = Boolean(exerciseFor(key).steps);
      const cls = ['cal-cell'];
      if (key === today) cls.push('is-today');
      if (key === day) cls.push('is-selected');
      if (logged) cls.push('is-logged');
      cells.push(h('button', {
        class: cls.join(' '), type: 'button', disabled: future,
        'aria-label': fmtDayLong(key) + (logged ? ', steps logged' : ''),
        onclick: async () => { await saveIfDirty(); day = key; renderCal(); syncInput(); }
      }, h('span', { class: 'cal-num', text: String(d) })));
    }
    calGrid.replaceChildren(...cells);
  }
  calPrev.addEventListener('click', () => { month = shiftMonth(month, -1); renderCal(); });
  calNext.addEventListener('click', () => { if (month < today.slice(0, 7)) { month = shiftMonth(month, 1); renderCal(); } });
  calTitle.addEventListener('click', () => { month = today.slice(0, 7); renderCal(); });
  renderCal();
  syncInput();

  const body = h('div', null,
    h('div', { class: 'card cal' },
      h('div', { class: 'cal-head' }, calPrev, calTitle, calNext),
      h('div', { class: 'cal-dow' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dw) => h('span', { text: dw }))),
      calGrid,
      h('p', { class: 'cal-key' }, h('span', { class: 'key-dot key-done' }), ' Already logged')
    ),
    dayLabel,
    h('div', { class: 'bigvalue' }, input, h('span', { class: 'unit', text: 'steps' })),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const v = parseInt(input.value, 10);
      if (isNaN(v) || v < 0) { toast('Please check the number'); return; }
      const savedDay = day;
      const ok = await saveStepsFor(savedDay, v);
      if (!ok) { toast('Could not save'); return; }
      state.exerciseDay = savedDay;
      renderExercise();
      renderCal();
      toast(fmtDayShort(savedDay) + ': ' + v.toLocaleString('en-GB') + ' steps saved');
    } }, 'Save'),
    h('p', { class: 'hint', text: 'Save keeps this open, so you can pick another day and carry on.' }),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Done')
  );
  openSheet('Steps', body, saveIfDirty);
}

$('ex-goals-edit').addEventListener('click', () => {
  const g = goals();
  const pressups = h('input', { type: 'number', inputmode: 'numeric', min: '0', value: String(g.pressups) });
  const situps = h('input', { type: 'number', inputmode: 'numeric', min: '0', value: String(g.situps) });
  const plank = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '5', value: String(g.plankSeconds) });
  const squats = h('input', { type: 'number', inputmode: 'numeric', min: '0', value: String(g.squats) });
  const body = h('div', null,
    h('p', { class: 'hint', text: 'Set what a full day looks like. Worth checking these with the oncology team first.' }),
    field('Press-ups a day', pressups), field('Sit-ups a day', situps), field('Plank (seconds)', plank), field('Squats a day', squats),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const exerciseGoals = {
        pressups: Math.max(0, parseInt(pressups.value, 10) || 0),
        situps: Math.max(0, parseInt(situps.value, 10) || 0),
        plankSeconds: Math.max(0, parseInt(plank.value, 10) || 0),
        squats: Math.max(0, parseInt(squats.value, 10) || 0)
      };
      closeSheet();
      if (state.demo) { state.profile = { ...state.profile, exerciseGoals }; renderExercise(); toast('Goals saved'); return; }
      try { await setDoc(doc(db, 'profile', 'main'), { exerciseGoals }, { merge: true }); toast('Goals saved'); }
      catch (e) { console.error(e); toast('Could not save'); }
    } }, 'Save'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Daily goals', body);
});

async function renderStepsChart() {
  if ($('view-exercise').hidden) return;
  try { await loadScript(CDN.chart); } catch (e) { return; }
  const end = state.exerciseDay;
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(end, -i));
  const T = chartTheme();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  makeChart('steps', barChart(T, days.map((d) => parseDay(d).toLocaleDateString('en-GB', { weekday: 'short' })), days.map((d) => Number(exerciseFor(d).steps) || 0), { unit: (v) => Number(v).toLocaleString('en-GB'), tip: (v) => Number(v).toLocaleString('en-GB') + ' steps', reduced }));
}

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
  if (!calls.length) wrap.append(h('p', { class: 'empty', 'data-art': 'call', text: 'No numbers saved yet. Add the ward, hospice or GP so they are one tap away.' }));
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
      if (state.demo) { state.profile = { ...state.profile, calls }; renderCalls(); toast('Numbers saved'); return; }
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
  if (!state.user || state.demo) return;
  const today = todayStr();
  const expectedFrom = addDays(today, -1);
  if (state.recentFrom && state.recentFrom !== expectedFrom) {
    const previousToday = addDays(state.recentFrom, 1);
    if (state.selectedDay === previousToday) state.selectedDay = today;
    if (state.exerciseDay === previousToday) state.exerciseDay = today;
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

/* A ?guest link drops straight into the preview, no tap needed, for sharing.
   The parameter is dropped from the address bar so a later refresh (after
   leaving the preview) lands on the ordinary sign-in screen instead. This
   runs last, after every top-level declaration the demo path needs (such
   as demoIdSeq) has been initialised. */
if (new URLSearchParams(location.search).has('guest')) {
  history.replaceState(null, '', location.pathname + location.hash);
  enterPreview();
}
