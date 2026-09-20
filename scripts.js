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

const APP_VERSION = '15';
const PAGE_LIMIT_BYTES = 850 * 1024;   // base64 characters per page document (hard cap is 900 KB)
const TEXT_LIMIT_BYTES = 800 * 1024;
const PAGE_MAX_DIM = 1600;
const MAX_PAGES = 30;

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
  { face: '\u{1F61E}', label: 'Rough' },
  { face: '\u{1F615}', label: 'Low' },
  { face: '\u{1F610}', label: 'OK' },
  { face: '\u{1F642}', label: 'Good' },
  { face: '\u{1F604}', label: 'Great' }
];

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
  foodRange: 14,
  notesRange: 14,
  notesText: '',
  meals: [],
  currentDoc: null,
  docsReturn: 'more',
  days: {},
  cheers: [],
  exercise: {},
  exerciseDay: todayStr(),
  chemoMonth: todayStr().slice(0, 7),
  demo: false,
  demoPages: {}
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
    state.demo = false;
    $('signin').hidden = true;
    $('app').hidden = false;
    $('user-chip').textContent = state.name;
    $('more-user').textContent = `${state.name} (${user.email})`;
    $('guest-pill').hidden = true;
    $('signin-password').value = '';
    await startData();
  } else if (!state.demo) {
    stopData();
    state.user = null;
    $('app').hidden = true;
    $('signin').hidden = false;
  }
});

/* Guest preview: no Firebase account, no Firestore access, ever. Everything
   this shows is made-up (see buildDemoFixture); nothing typed here is saved. */
function enterPreview() {
  state.demo = true;
  state.name = 'Guest';
  $('signin').hidden = true;
  $('app').hidden = false;
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
  await seedMedicinesIfEmpty();
  watchMedicines();
  watchRecent();
  watchDay();
  watchDocuments();
  watchProfile();
  watchDays();
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

  const entries = [
    e(-9, '08:00', 'Shelley', { type: 'temp', value: 36.9 }),
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
    renderTodayMood();
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
  const highlight = name === 'docs' ? (state.docsReturn || 'more') : (name === 'food' || name === 'notes') ? 'more' : name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === highlight));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  window.scrollTo(0, 0);
  if (name === 'vitals') renderVitals();
  if (name === 'food') renderFoodDiary();
  if (name === 'notes') renderNotesReport();
  if (name === 'chemo') renderChemo();
  if (name === 'exercise') renderExercise();
  if (name === 'docs') showDocsList();
}

/* Documents is reached from More (and chemo plan documents from Chemo); remember where to go back to. */
function openDocs(from) {
  state.docsReturn = from || 'more';
  showTab('docs');
}

$('sheet').addEventListener('click', (ev) => { if (ev.target.hasAttribute('data-close')) closeSheet(); });

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
  renderTodayMood();
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
  if (e.type === 'weight' && e.note) bits.push(e.note);
  if (e.type === 'vitals' && e.note) bits.push(e.note);
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

  if (type === 'drink') {
    const what = h('input', { type: 'text', placeholder: 'What was it?', value: 'Water' });
    const ml = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '10', value: '200' });
    const whatPresets = presets(['Water', 'Tea', 'Coffee', 'Squash', 'Juice', 'Milk', 'Supplement drink'], what, 'Water');
    const mlPresets = presets(['50', '100', '150', '200', '250', '300', { value: '568', label: '568 pint' }, { value: '750', label: '750 bottle' }], ml, '200');
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
    const meals = sortedMeals();
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
      h('label', { class: 'check' }, remember, h('span', { text: 'Remember this meal for next time' }))
    );
    getData = () => {
      const name = what.value.trim();
      if (!name) return null;
      const detail = parts.value.trim();
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

  const titles = { drink: 'Drink', food: 'Food', weight: 'Weight', note: 'Note', vitals: 'Vitals' };
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Save');
  save.addEventListener('click', async () => {
    const data = getData();
    if (!data) { toast('Please check the value'); return; }
    const at = atFromInputs(day, time.value);
    const list = Array.isArray(data) ? data : [data];
    closeSheet();
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
  if (!state.meals.length) list.append(h('p', { class: 'empty', text: 'No saved meals yet. Log some food with "Remember this meal" ticked and it will appear here.' }));
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

$('more-food').addEventListener('click', () => showTab('food'));
$('food-back').addEventListener('click', () => showTab('more'));
$('food-print').addEventListener('click', () => window.print());
document.querySelectorAll('#view-food .seg').forEach((b) => b.addEventListener('click', () => {
  state.foodRange = parseInt(b.dataset.range, 10);
  document.querySelectorAll('#view-food .seg').forEach((x) => x.classList.toggle('is-active', x === b));
  renderFoodDiary();
}));

function fmtMl(ml) {
  return ml >= 1000 ? (ml / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' L' : ml + ' ml';
}

/* Every entry from a day onwards; null if the read failed */
async function loadEntriesFrom(from) {
  if (state.demo) return state.recentEntries.filter((e) => e.day >= from);
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('day', '>=', from)));
    return snap.docs.map((d) => d.data());
  } catch (e) { console.error(e); return null; }
}

async function renderFoodDiary() {
  const today = todayStr();
  const from = addDays(today, -(state.foodRange - 1));
  $('food-sub').textContent = `Last ${state.foodRange} days, from ${fmtDayNum(from)}`;
  const entries = await loadEntriesFrom(from);
  if (!entries) return;
  const byDay = {};
  entries.forEach((e) => {
    if (e.type !== 'food' && e.type !== 'drink') return;
    (byDay[e.day] = byDay[e.day] || []).push(e);
  });
  const logged = Object.keys(byDay).sort();
  const sections = [];
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
      sections.push(h('section', { class: 'diary-day' },
        h('h3', { class: 'diary-title' }, fmtDayLong(day), h('small', { text: day === today ? 'Today' : fmtDayNum(day) })),
        h('p', { class: 'diary-sum', text: sum }),
        foods.length ? h('ul', { class: 'timeline' }, ...foods.map(diaryRow)) : null
      ));
    }
  }
  $('food-days').replaceChildren(...sections);
  $('food-empty').hidden = sections.length > 0;
}

function diaryRow(e) {
  return h('li', { class: 'entry type-food' },
    h('span', { class: 'entry-time', text: fmtTime(entryDate(e)) }),
    h('div', { class: 'entry-main' },
      h('div', { class: 'entry-title', text: e.note || 'Food' }),
      h('div', { class: 'entry-sub', text: [e.amount, e.detail, 'by ' + (e.addedBy || 'unknown')].filter(Boolean).join(' · ') })
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

$('more-notes').addEventListener('click', () => showTab('notes'));
$('notes-back').addEventListener('click', () => showTab('more'));
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

$('notes-download').addEventListener('click', () => {
  if (!state.notesText) return;
  const blob = new Blob([state.notesText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: 'care-log-notes-' + todayStr() + '.txt' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

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
    const notes = list.filter((e) => e.type === 'note' || (e.note && ['temp', 'weight', 'vitals', 'med'].includes(e.type)))
      .map((e) => ({ time: fmtTime(entryDate(e)), who: e.addedBy || 'unknown', text: e.note, context: e.type === 'note' ? '' : noteContext(e) }));
    const mood = info.mood ? MOODS[info.mood - 1].label : '';
    const readings = dayReadings(list);
    const prn = dayPrn(list);
    if (!notes.length && !mood && !info.good && !readings) continue;
    days.push({ day, mood, good: info.good || '', readings, prn, notes });
  }

  const lines = [NOTES_PROMPT, '', `Care Log notes, ${fmtDayNum(from)} to ${fmtDayNum(today)}`, '', 'Worth mentioning from the readings:'];
  if (flags.length) flags.forEach((f) => lines.push('- ' + f.text));
  else lines.push('- Nothing out of the ordinary in the readings for this period.');
  lines.push('', 'Notes by day:');
  days.forEach((d) => {
    lines.push('', `${fmtDayLong(d.day)} (${fmtDayNum(d.day)})`);
    if (d.mood || d.good) lines.push('Feeling: ' + [d.mood, d.good ? 'One good thing: ' + d.good : ''].filter(Boolean).join('. '));
    if (d.readings) lines.push('Readings: ' + d.readings);
    if (d.prn) lines.push('When-needed medicines: ' + d.prn);
    d.notes.forEach((n) => lines.push(`- ${n.time} ${n.who}${n.context ? ' (' + n.context + ')' : ''}: ${n.text}`));
  });
  return { flags, days, text: lines.join('\n') };
}

async function renderNotesReport() {
  const today = todayStr();
  const from = addDays(today, -(state.notesRange - 1));
  $('notes-sub').textContent = `Last ${state.notesRange} days, from ${fmtDayNum(from)}`;
  const entries = await loadEntriesFrom(from);
  if (!entries) return;
  const report = buildNotesReport(entries, from, today);
  state.notesText = report.text;

  const levelWord = { red: 'Check', amber: 'Mention', teal: 'Context' };
  $('notes-flags').replaceChildren(...report.flags.map((f) => h('div', { class: 'flag is-' + f.level },
    h('span', { class: 'pill pill-' + f.level, text: levelWord[f.level] }),
    h('span', { class: 'flag-text', text: f.text })
  )));
  if (!report.flags.length) $('notes-flags').append(h('p', { class: 'muted', text: 'Nothing out of the ordinary in the readings for this period.' }));

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

/* Today's mood, from the Chemo Party Plan day record, shown as a one-line card */
function renderTodayMood() {
  const info = state.days[state.selectedDay] || {};
  const m = info.mood ? MOODS[info.mood - 1] : null;
  $('today-mood-face').textContent = m ? m.face : '\u{1F642}';
  if (m) {
    $('today-mood-title').textContent = 'Feeling ' + m.label.toLowerCase() + (info.good ? '. ' + info.good : '');
    $('today-mood-sub').textContent = state.selectedDay === todayStr() ? 'Tap to change' : 'Tap to edit';
  } else {
    $('today-mood-title').textContent = state.selectedDay === todayStr() ? 'How are you feeling today?' : 'No mood logged for this day';
    $('today-mood-sub').textContent = 'Tap to log a mood and one good thing';
  }
}
$('today-mood').addEventListener('click', () => openDaySheet(state.selectedDay));

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
  card.append(status);

  /* Every dose given today, as tappable chips (tap one to see or delete it) */
  const todays = state.recentEntries.filter((e) => e.type === 'med' && e.medId === m.id && e.day === today).sort((a, b) => entryDate(a) - entryDate(b));
  if (todays.length) {
    card.append(h('div', { class: 'med-times' },
      h('span', { class: 'med-times-label', text: 'Today' }),
      ...todays.map((e) => h('button', { class: 'med-time', type: 'button', 'aria-label': `Dose at ${fmtTime(entryDate(e))}, tap for options`, onclick: () => entryOptions(e) },
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
    $('vt-temp-value').replaceChildren(Number(t.value).toFixed(1), h('small', { text: '\u00B0C' }));
    $('vt-temp-sub').textContent = whenLabel(t);
    tile.classList.add(tempClass(t.value) || 'is-green');
  } else { $('vt-temp-value').textContent = '--'; $('vt-temp-sub').textContent = 'none yet'; }

  const hr = latest((e) => e.type === 'vitals' && e.heartRate);
  if (hr) { $('vt-heart-value').replaceChildren(String(Math.round(hr.heartRate)), h('small', { text: 'bpm' })); $('vt-heart-sub').textContent = whenLabel(hr); }
  else { $('vt-heart-value').textContent = '--'; $('vt-heart-sub').textContent = 'none yet'; }

  const bp = latest((e) => e.type === 'vitals' && e.systolic && e.diastolic);
  if (bp) { $('vt-bp-value').textContent = Math.round(bp.systolic) + '/' + Math.round(bp.diastolic); $('vt-bp-sub').textContent = whenLabel(bp); }
  else { $('vt-bp-value').textContent = '--'; $('vt-bp-sub').textContent = 'none yet'; }

  const ox = latest((e) => e.type === 'vitals' && e.oxygen);
  if (ox) { $('vt-oxygen-value').replaceChildren(String(Math.round(ox.oxygen)), h('small', { text: '%' })); $('vt-oxygen-sub').textContent = whenLabel(ox); }
  else { $('vt-oxygen-value').textContent = '--'; $('vt-oxygen-sub').textContent = 'none yet'; }
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

  /* Vitals: heart rate, blood pressure and oxygen, all logged together from a
     manual reading. Each is its own chart, points in time, same layout as temperature. */
  const vitalsEntries = entries.filter((e) => e.type === 'vitals');
  const xAxis = () => ({ type: 'linear', min: start, max: end, grid: { color: line }, ticks: { maxRotation: 0, autoSkip: true, callback: (v) => { const t = tickDays.indexOf(v); return t >= 0 ? dayLabel(days[t]) : ''; }, stepSize: 864e5 }, afterBuildTicks: (axis) => { axis.ticks = tickDays.map((t) => ({ value: t })); } });
  const pointTitle = (items) => items.length ? new Date(items[0].raw.x).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  const hPoints = vitalsEntries.filter((e) => e.heartRate).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.heartRate) }));
  makeChart('heart', {
    type: 'line',
    data: { datasets: [{ label: 'Heart rate', data: hPoints, borderColor: teal, backgroundColor: teal, pointRadius: 5, pointHoverRadius: 7, tension: 0.25, showLine: hPoints.length > 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: xAxis(), y: { beginAtZero: false, grid: { color: line }, ticks: { callback: (v) => v + ' bpm' } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: pointTitle, label: (item) => Math.round(item.raw.y) + ' bpm' } } }
    }
  });

  const bpEntries = vitalsEntries.filter((e) => e.systolic && e.diastolic);
  const sysPoints = bpEntries.map((e) => ({ x: entryDate(e).getTime(), y: Number(e.systolic) }));
  const diaPoints = bpEntries.map((e) => ({ x: entryDate(e).getTime(), y: Number(e.diastolic) }));
  makeChart('bp', {
    type: 'line',
    data: { datasets: [
      { label: 'Systolic', data: sysPoints, borderColor: teal, backgroundColor: teal, pointRadius: 5, pointHoverRadius: 7, tension: 0.25, showLine: sysPoints.length > 1 },
      { label: 'Diastolic', data: diaPoints, borderColor: amber, backgroundColor: amber, pointRadius: 5, pointHoverRadius: 7, tension: 0.25, showLine: diaPoints.length > 1 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: xAxis(), y: { beginAtZero: false, grid: { color: line }, ticks: { callback: (v) => v + ' mmHg' } } },
      plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { title: pointTitle, label: (item) => item.dataset.label + ': ' + Math.round(item.raw.y) + ' mmHg' } } }
    }
  });

  const o2Points = vitalsEntries.filter((e) => e.oxygen).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.oxygen) }));
  makeChart('oxygen', {
    type: 'line',
    data: { datasets: [{ label: 'Oxygen', data: o2Points, borderColor: teal, backgroundColor: teal, pointRadius: 5, pointHoverRadius: 7, tension: 0.25, showLine: o2Points.length > 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: xAxis(), y: { min: 80, max: 100, grid: { color: line }, ticks: { callback: (v) => v + '%' } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: pointTitle, label: (item) => Math.round(item.raw.y) + '%' } } }
    }
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
$('docs-back').addEventListener('click', () => showTab(state.docsReturn || 'more'));
$('more-docs').addEventListener('click', () => openDocs('more'));
$('chemo-doc-add').addEventListener('click', () => openAddDocument('chemo'));

function docItem(d) {
  return h('button', { class: 'docitem', type: 'button', onclick: () => { if ($('view-docs').hidden) openDocs(d.category === 'chemo' ? 'chemo' : 'more'); openDocument(d.id); } },
    h('span', { class: 'docitem-icon', text: d.kind === 'text' ? '\u{1F4C4}' : '\u{1F5BC}' }),
    h('div', { class: 'docitem-main' },
      h('div', { class: 'docitem-title', text: d.title }),
      h('div', { class: 'docitem-sub', text: [fmtDayNum(d.docDate || ''), d.category === 'chemo' ? 'Chemo plan' : null, d.kind === 'text' ? 'Text' : (d.pageCount === 1 ? '1 page' : d.pageCount + ' pages'), d.explanation ? 'Explained' : 'No explanation yet'].filter(Boolean).join(' \u00B7 ') })
    ),
    h('span', { class: 'pill ' + (d.explanation ? 'pill-green' : 'pill-amber'), text: d.explanation ? '\u2713' : '?' })
  );
}

function renderChemoDocs() {
  const docs = state.documents.filter((d) => d.category === 'chemo');
  $('chemo-docs').replaceChildren(...docs.map((d) => h('li', null, docItem(d))));
  $('chemo-docs-empty').hidden = docs.length > 0;
}

function renderDocsList() {
  const list = $('docs-list');
  list.replaceChildren(...state.documents.map((d) => h('li', null, docItem(d))));
  renderChemoDocs();
  $('docs-empty').hidden = state.documents.length > 0;
  if (state.currentDoc) {
    const d = state.documents.find((x) => x.id === state.currentDoc.id);
    if (!d) showDocsList();
  }
}

$('doc-add').addEventListener('click', () => openAddDocument('general'));

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

  const title = h('input', { type: 'text', placeholder: 'e.g. Oncology letter', required: true });
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
        category: category === 'chemo' ? 'chemo' : 'general',
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
  openSheet(category === 'chemo' ? 'Add the chemo plan' : 'Add document', body);
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
    if (!state.currentDoc.pages.length) pagesEl.append(h('p', { class: 'empty', text: 'No pages found.' }));
    return;
  }
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
    cells.push(h('button', { class: cls.join(' '), type: 'button', 'aria-label': label, onclick: () => openDaySheet(key) },
      h('span', { class: 'cal-num', text: String(d) }),
      info.mood ? h('span', { class: 'cal-face', text: MOODS[info.mood - 1].face }) : null
    ));
  }
  $('cal-grid').replaceChildren(...cells);
}

/* One sheet per calendar day: chemo session, session done, mood, one good thing */
function openDaySheet(key) {
  const info = state.days[key] || {};
  let mood = info.mood || 0;
  const cbChemo = h('input', { type: 'checkbox' });
  cbChemo.checked = !!info.chemo;
  const cbDone = h('input', { type: 'checkbox' });
  cbDone.checked = !!info.chemoDone;
  const doneRow = h('label', { class: 'check' }, cbDone, h('span', { text: 'Session done' }));
  const syncDone = () => { doneRow.hidden = !cbChemo.checked; if (!cbChemo.checked) cbDone.checked = false; };
  cbChemo.addEventListener('change', syncDone);
  syncDone();

  const moodBtns = MOODS.map((mo, i) => h('button', { class: 'mood' + (mood === i + 1 ? ' is-active' : ''), type: 'button', onclick: () => {
    mood = mood === i + 1 ? 0 : i + 1;
    moodBtns.forEach((b, j) => b.classList.toggle('is-active', mood === j + 1));
  } }, h('span', { class: 'face', text: mo.face }), mo.label));
  const good = h('input', { type: 'text', value: info.good || '', placeholder: 'e.g. Sat in the garden for an hour', maxlength: '140' });

  const body = h('div', null,
    h('label', { class: 'check' }, cbChemo, h('span', { text: 'Chemo session this day' })),
    doneRow,
    h('span', { class: 'fieldlabel', text: 'Mood' }),
    h('div', { class: 'moods' }, ...moodBtns),
    field('One good thing today', good),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const wasDone = !!info.chemoDone;
      const data = {
        chemo: cbChemo.checked,
        chemoDone: cbChemo.checked && cbDone.checked,
        mood: mood || null,
        good: good.value.trim(),
        updatedBy: state.name,
        updatedAt: serverTimestamp()
      };
      closeSheet();
      if (state.demo) {
        state.days[key] = { ...state.days[key], ...data };
        renderChemo(); renderTodayMood();
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
    (info.chemo || info.mood || info.good) ? h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: async () => {
      closeSheet();
      if (state.demo) { delete state.days[key]; renderChemo(); renderTodayMood(); toast('Day cleared'); return; }
      try { await deleteDoc(doc(db, 'days', key)); toast('Day cleared'); } catch (e) { console.error(e); toast('Could not clear'); }
    } }, 'Clear this day') : null,
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
  list.replaceChildren(...state.cheers.map((c) => {
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
  }));
  $('cheers-empty').hidden = state.cheers.length > 0;
}

/* A short, calm confetti burst when a session is marked done. Skipped for reduced motion. */
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('confetti');
  const ctx = c.getContext('2d');
  c.width = window.innerWidth; c.height = window.innerHeight;
  c.hidden = false;
  const colours = [cssVar('--teal'), cssVar('--green'), cssVar('--amber'), '#6A5A8E', '#3E7FA6'];
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
  if (rec.steps) { $('ex-steps-value').textContent = Number(rec.steps).toLocaleString('en-GB'); $('ex-steps-sub').textContent = 'steps'; }
  else { $('ex-steps-value').textContent = '--'; $('ex-steps-sub').textContent = 'not logged'; }

  const streak = exerciseStreak();
  $('ex-streak-value').textContent = String(streak);
  $('ex-streak-sub').textContent = streak === 1 ? 'day all done' : 'days all done';
  $('ex-streak-tile').classList.toggle('is-green', streak > 0);

  const g = goals();
  const done = rec.done || {};
  $('ex-goals').replaceChildren(...GOAL_ROWS.map((row) => h('button', { class: 'goal' + (done[row.key] ? ' is-done' : ''), type: 'button', 'aria-pressed': done[row.key] ? 'true' : 'false', onclick: () => toggleGoal(day, row.key) },
    h('span', { class: 'goal-box', text: done[row.key] ? '✓' : '' }),
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

$('ex-steps-edit').addEventListener('click', () => {
  const day = state.exerciseDay;
  const rec = exerciseFor(day);
  const input = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '1', value: rec.steps ? String(rec.steps) : '', placeholder: '0' });
  const body = h('div', null,
    h('p', { class: 'muted', text: fmtDayLong(day) }),
    h('div', { class: 'bigvalue' }, input, h('span', { class: 'unit', text: 'steps' })),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const v = parseInt(input.value, 10);
      if (isNaN(v) || v < 0) { toast('Please check the number'); return; }
      closeSheet();
      if (state.demo) { state.exercise[day] = { ...rec, day, steps: v }; renderExercise(); toast('Steps saved'); return; }
      try { await setDoc(doc(db, 'exercise', day), { day, steps: v, addedBy: state.name, updatedAt: serverTimestamp() }, { merge: true }); toast('Steps saved'); }
      catch (e) { console.error(e); toast('Could not save'); }
    } }, 'Save'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Steps', body);
});

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
  const Chart = window.Chart;
  Chart.defaults.font.family = cssVar('--font-mono') || 'monospace';
  Chart.defaults.font.size = 13;
  Chart.defaults.color = cssVar('--ink-soft');
  makeChart('steps', {
    type: 'bar',
    data: { labels: days.map((d) => parseDay(d).toLocaleDateString('en-GB', { weekday: 'short' })), datasets: [{ label: 'Steps', data: days.map((d) => Number(exerciseFor(d).steps) || 0), backgroundColor: cssVar('--teal'), borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: cssVar('--line') } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => Number(i.raw).toLocaleString('en-GB') + ' steps' } } } }
  });
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
