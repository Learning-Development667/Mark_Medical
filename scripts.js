/* Care Log
   Vanilla JS, Firebase v10 modular (Auth + Firestore only). No server, no paid services.
   See CLAUDE.md for the standards and the COST RULE. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, inMemoryPersistence, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const APP_VERSION = '67';
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

const CLAUDE_FORMAT = 'Reply using exactly this format, so it can be pasted straight back into Daybook:\n\n' +
  '=== CARE LOG DOCUMENT ===\n' +
  'Title: <a short title for this document>\n' +
  'Date: <the date on the document, YYYY-MM-DD>\n' +
  'Explanation:\n' +
  '<your explanation, in plain English, as multi-line text>\n' +
  '=== END ===';

const NOT_MEDICAL_ADVICE = 'This explanation is for context only. It is not medical advice. Always check changes with the medical team.';

/* Mood scale for the Chemo plan, 1 (rough) to 5 (great). */
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
function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
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
  toastTimer = setTimeout(hideToast, action ? 10000 : 4000);
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
     closed: Done, the round X, tapping the backdrop or Escape, not just a screen's own Save button. */
  state.sheetOnClose = onClose || null;
  /* A dialog for everyone (WCAG 2.4.3): the page behind is inert while it is open, focus moves
     into it, and goes back to whatever opened it when it closes. On phones focus lands on the
     title rather than the first field, so the keyboard does not pop up uninvited. */
  state.sheetOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  for (const el of document.querySelectorAll('.skip-link, .topbar, #main, #tabs')) el.inert = true;
  const first = b.querySelector('input:not([type=hidden]), textarea');
  if (first && first.type !== 'file' && window.matchMedia('(min-width: 700px)').matches) first.focus();
  else $('sheet-title').focus({ preventScroll: true });
}
function closeSheet() {
  if (state.sheetOnClose) { const fn = state.sheetOnClose; state.sheetOnClose = null; fn(); }
  $('sheet').hidden = true;
  $('sheet-body').replaceChildren();
  document.body.style.overflow = '';
  for (const el of document.querySelectorAll('.skip-link, .topbar, #main, #tabs')) el.inert = false;
  const back = state.sheetOpener; state.sheetOpener = null;
  if (back && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
}
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('sheet').hidden) { ev.preventDefault(); closeSheet(); } });
function confirmSheet(title, message, okLabel, danger) {
  return new Promise((resolve) => {
    let result = false; // closing any other way (the X, the backdrop, Escape) counts as Cancel
    const body = h('div', null,
      h('p', { text: message }),
      h('button', { class: 'btn btn-block ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => { result = true; closeSheet(); } }, okLabel),
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
    );
    openSheet(title, body, () => resolve(result));
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
  throw new Error('Daybook: config.js missing or incomplete');
}

const app = initializeApp(CONFIG.firebase);
const mainAuth = getAuth(app);
const mainDb = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
/* Everything below reads auth and db at call time, so the Guest button can point them at the
   separate demo project for the length of a demo session (see enterLiveDemo) and back again. */
let auth = mainAuth;
let db = mainDb;
/* The shared, usable demo: a second Firebase project of its own, with a guest sign-in whose
   details are public by design (window.DAYBOOK_DEMO in config.js). Without it, Guest is the
   in-memory preview. Nothing here can reach the real project: different app, different database. */
const DEMO = window.DAYBOOK_DEMO && window.DAYBOOK_DEMO.firebase && window.DAYBOOK_DEMO.firebase.apiKey ? window.DAYBOOK_DEMO : null;

/* Accounts are data, not code (since v44): users/{uid} in Firestore holds
   { name, role, relation }. role is "family" (full access), "readonly" (sees
   everything, writes nothing) or "viewer" (a narrow read-only slice);
   relation is "patient", "carer" or "". Records are written from the Actions
   tab ("Seed a user record") or in the console, never by the app, and the
   rules gate every collection on them, so no email address lives in the
   code or on the site. */
const ACCOUNT_CACHE_KEY = 'daybook.account.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Reads users/{uid}. Returns the account, or { missing: true } only when the server
   itself says there is no record, or { error: true } when it could not be checked
   (no signal, a timeout). A poor connection must never look like "not set up":
   until v52 any error here signed the person out. A copy of the last good record is
   kept on the phone so a weak signal at start-up still opens the app straight away. */
async function loadAccount(user) {
  if (state.demoLive) return { name: 'Guest', role: 'family', relation: '' };
  const cacheKey = ACCOUNT_CACHE_KEY + user.uid;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) { cached = null; }
  const delays = [0, 1500, 3000, 6000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt]);
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        const account = { name: d.name || (user.email || '').split('@')[0] || 'Unknown', role: d.role || 'family', relation: d.relation || '' };
        try { localStorage.setItem(cacheKey, JSON.stringify(account)); } catch (e) { /* storage full or blocked: nothing lost */ }
        return account;
      }
      if (!snap.metadata || !snap.metadata.fromCache) return { missing: true }; // the server answered: no record
      // "no record" from the local cache only means it was never fetched; treat as unknown
    } catch (e) { console.error(e); }
    if (cached && cached.name) return cached;
  }
  return { error: true };
}

const state = {
  user: null,
  account: null,
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
  foodRangeMode: 'preset',
  notesRangeMode: 'preset',
  foodCustomFrom: null,
  foodCustomTo: null,
  notesCustomFrom: null,
  notesCustomTo: null,
  notesText: '',
  notesPdf: null,
  foodPdf: null,
  meals: [],
  currentDoc: null,
  docsReturn: 'more',
  reportReturn: 'vitals',
  days: {},
  exercise: {},
  nutrition: {},
  exerciseDay: todayStr(),
  chemoMonth: todayStr().slice(0, 7),
  cycleMeasure: 'energy',
  cycleEntries: null,
  cycleFrom: null,
  cycleFetched: 0,
  demo: false,
  demoPages: {},
  demoRecordings: [],
  viewer: false,
  readOnly: false
};

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

$('signin-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('signin-button'), err = $('signin-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Signing in';
  try {
    if (auth.currentUser) { await enterApp(auth.currentUser); return; } // signed in, account check failed last time: try it again
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

onAuthStateChanged(auth, (user) => enterApp(user));

/* Runs on every sign-in state change, and again from the Sign in button when a
   signed-in person's account could not be checked the first time. */
async function enterApp(user) {
  const account = user ? await loadAccount(user) : null;
  if (user && account && account.missing) {
    await signOut(auth);
    $('signin-error').textContent = 'This account is not set up for Daybook yet.';
    $('signin-error').hidden = false;
    return;
  }
  if (user && account && account.error) {
    // Still signed in; nothing is thrown away. Sign in tries the check again.
    $('signin-error').textContent = 'Could not reach Daybook to check your account. Check the signal, then tap Sign in to try again.';
    $('signin-error').hidden = false;
    $('app').hidden = true;
    $('signin').hidden = false;
    return;
  }
  if (user) {
    state.user = user;
    state.account = account;
    state.name = account.name;
    state.demo = false;
    state.viewer = account.role === 'viewer';
    state.readOnly = account.role === 'readonly';
    $('signin-error').hidden = true;
    $('signin').hidden = true;
    $('app').hidden = false;
    requestAnimationFrame(moveTabIndicator);
    $('user-chip').textContent = state.name;
    $('more-user').textContent = `${state.name}${account.relation ? ', ' + account.relation : ''} (${user.email})`;
    $('guest-pill').hidden = true;
    $('viewer-pill').hidden = !state.viewer;
    $('readonly-pill').hidden = !state.readOnly;
    $('signin-password').value = '';
    setViewerMode(state.viewer);
    setReadOnlyMode(state.readOnly);
    if (!state.viewer) showTab('today'); // always a known landing tab, even right after a viewer session on the same device
    const wanted = new URLSearchParams(location.search).get('tab');
    if (wanted && PAGE_TITLES[wanted] && !state.viewer) { showTab(wanted); history.replaceState(null, '', location.pathname + location.hash); }
    await startData();
    syncReminders();
  } else if (!state.demo) {
    stopData();
    state.user = null;
    state.account = null;
    state.viewer = false;
    state.readOnly = false;
    setViewerMode(false);
    setReadOnlyMode(false);
    $('app').hidden = true;
    $('signin').hidden = false;
  }
}

/* Viewer mode: read-only relatives see Meds, Chemo and Trends only, with every
   add/edit/delete control on those three hidden, and land on Meds rather than
   Today (which mixes in food, drink and personal notes they were not given). */
function setViewerMode(on) {
  document.body.classList.toggle('is-viewer', on);
  $('tabs').classList.toggle('tabs-3', on);
  document.querySelectorAll('.tab[data-tab="today"], .tab[data-tab="exercise"], .tab[data-tab="more"]').forEach((b) => { b.hidden = on; });
  if (on) showTab('meds');
}

/* Read-only mode: sees every tab and every report exactly like a family member,
   but every add/edit/delete control anywhere in the app is hidden (body.is-readonly
   in styles.css). Unlike viewer mode, nothing is hidden or narrowed, and it lands
   on Today like a normal sign-in. */
function setReadOnlyMode(on) {
  document.body.classList.toggle('is-readonly', on);
}

/* Guest preview: no Firebase account, no Firestore access, ever. Everything
   this shows is made-up (see buildDemoFixture); nothing typed here is saved. */
function enterPreview() {
  state.demo = true;
  state.name = 'Guest';
  state.viewer = false;
  state.readOnly = false;
  setViewerMode(false);
  setReadOnlyMode(false);
  $('signin').hidden = true;
  $('app').hidden = false;
  requestAnimationFrame(moveTabIndicator);
  $('user-chip').textContent = 'Guest';
  $('more-user').textContent = 'Guest (preview, nothing saved)';
  $('guest-pill').hidden = false;
  startDemoData();
  syncReminders();
}
$('guest-button').addEventListener('click', () => (DEMO ? enterLiveDemo() : enterPreview()));
if (DEMO) $('guest-hint').textContent = 'Try the app for real on a shared demo with example data. No sign-in needed. Anything you add can be seen by other visitors and is wiped every night, so no real details please.';

function exitPreview() {
  stopData();
  state.demo = false;
  $('guest-pill').hidden = true;
  $('app').hidden = true;
  $('signin').hidden = false;
}

/* Live demo: sign in to the demo project as its guest, seed it with the example data if it is
   empty (the nightly reset only wipes), then run the app exactly as for a family member. */
let demoApp = null, demoAuth = null, demoDb = null;
async function enterLiveDemo() {
  const btn = $('guest-button');
  btn.disabled = true;
  btn.textContent = 'Opening the demo';
  try {
    if (!demoApp) {
      demoApp = initializeApp(DEMO.firebase, 'demo');
      demoAuth = getAuth(demoApp);
      demoDb = initializeFirestore(demoApp, { localCache: memoryLocalCache() });
    }
    await setPersistence(demoAuth, inMemoryPersistence);
    const cred = await signInWithEmailAndPassword(demoAuth, DEMO.email, DEMO.password);
    auth = demoAuth;
    db = demoDb;
    state.demoLive = true;
    await seedDemoIfEmpty();
    await enterApp(cred.user);
    $('guest-pill').textContent = 'Demo';
    $('guest-pill').hidden = false;
    $('more-user').textContent = 'Guest (shared demo, wiped every night)';
    toast('Shared demo: others can see what you add, and it is wiped every night. No real details please.');
  } catch (e) {
    console.error(e);
    auth = mainAuth;
    db = mainDb;
    state.demoLive = false;
    toast('The demo could not be opened. Check the signal and try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guest';
  }
}
async function exitLiveDemo() {
  stopData();
  try { await signOut(demoAuth); } catch (e) { /* already out */ }
  auth = mainAuth;
  db = mainDb;
  state.demoLive = false;
  state.user = null;
  state.account = null;
  $('guest-pill').hidden = true;
  $('guest-pill').textContent = 'Preview';
  $('app').hidden = true;
  $('signin').hidden = false;
}
/* The same made-up data the preview uses, written once into the demo project when it is empty */
function demoClean(v) {
  if (v && typeof v === 'object' && typeof v.toDate === 'function') return Timestamp.fromDate(v.toDate());
  if (Array.isArray(v)) return v.map(demoClean);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, demoClean(x)]));
  return v;
}
async function writeDemo(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach(([col, id, data]) => batch.set(doc(db, col, id), demoClean(data)));
    await batch.commit();
  }
}
/* A demo seeded before the carer's view existed gets the check-ins and sessions of the cycle chart added once */
async function topUpDemo() {
  const carer = await getDocs(query(collection(db, 'entries'), where('slot', '==', 'carer'), limit(1)));
  if (!carer.empty) return;
  const fixture = buildDemoFixture();
  const writes = [];
  fixture.entries.filter((e) => e.type === 'checkin').forEach((e) => { const { id, ...data } = e; writes.push(['entries', id, data]); });
  Object.entries(fixture.days).forEach(([k, d]) => { if (d.chemo) writes.push(['days', k, d]); });
  await writeDemo(writes);
}
async function seedDemoIfEmpty() {
  const snap = await getDocs(collection(db, 'medicines'));
  if (!snap.empty) { await topUpDemo(); return; }
  const fixture = buildDemoFixture();
  const writes = [];
  SEED_MEDICINES.forEach((m, i) => { const { id, ...data } = m; writes.push(['medicines', id, { ...data, active: true, order: i + 1 }]); });
  fixture.entries.forEach((e) => { const { id, ...data } = e; writes.push(['entries', id, data]); });
  fixture.documents.forEach((d) => { const { id, ...data } = d; writes.push(['documents', id, { ...data, pageCount: 0 }]); });
  Object.entries(fixture.days).forEach(([k, d]) => writes.push(['days', k, d]));
  Object.entries(fixture.exercise).forEach(([k, d]) => writes.push(['exercise', k, { ...d, addedBy: 'Mark' }]));
  fixture.meals.forEach((m) => { const { id, ...data } = m; writes.push(['meals', id, data]); });
  writes.push(['profile', 'main', fixture.profile]);
  await writeDemo(writes);
}

$('signout').addEventListener('click', async () => {
  if (state.demo) {
    if (await confirmSheet('Leave preview', 'Go back to the sign-in screen?', 'Leave preview', false)) exitPreview();
    return;
  }
  if (state.demoLive) {
    if (await confirmSheet('Leave the demo', 'Go back to the sign-in screen?', 'Leave the demo', false)) exitLiveDemo();
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
  if (!state.readOnly) await seedMedicinesIfEmpty(); // a write; read-only sees whatever is already there
  watchDocuments();
  watchProfile();
  watchExercise();
  watchNutrition();
  watchMeals();
  watchQuestions();
}

function stopData() {
  for (const k of Object.keys(state.unsub)) { try { state.unsub[k](); } catch (e) { /* ignore */ } }
  state.unsub = {};
  // watchRecent() skips resubscribing while recentFrom still matches, so clear it: until v52 a
  // sign-out and sign-in without a reload left the recent-entries feed dead, hiding new entries.
  state.recentFrom = null;
  state.recentEntries = [];
  state.dayEntries = [];
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
    const when = at(offset, slot === 'morning' ? '08:30' : slot === 'carer' ? '20:30' : '21:00');
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
    e(-17, '12:30', 'Shelley', { type: 'food', note: 'Cheese and crackers', detail: 'cheddar, water biscuits', amount: 'About half' }),
    e(-16, '13:00', 'Shelley', { type: 'food', note: 'Soup', amount: 'A few mouthfuls' }),
    e(-15, '18:00', 'Shelley', { type: 'food', note: 'Toast', amount: 'About half' }),
    e(-14, '12:30', 'Mark', { type: 'food', note: 'Soup', amount: 'Most of it' }),
    e(-13, '18:30', 'Shelley', { type: 'food', note: 'Homity pie', detail: 'peas, mash, gravy', amount: 'All of it' }),
    e(-12, '08:00', 'Mark', { type: 'food', note: 'Porridge', detail: 'honey and banana', amount: 'All of it' }),
    e(-11, '18:30', 'Mark', { type: 'food', note: 'Fish and chips', amount: 'Most of it' }),
    e(-9, '13:00', 'Shelley', { type: 'food', note: 'Soup', amount: 'About half' }),
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
    /* Three weekly cycles (sessions on -17, -10 and -3): energy and appetite dip on days 1 and 2, sickness peaks, all back by day 4 or 5 */
    ci(-17, 'evening', { pain: 3, mood: 6, worstPain: 4, sickness: 4, appetite: 4, energy: 5, symptoms: '', settled: '', goodThing: 'Session went smoothly' }),
    ci(-16, 'morning', { sleep: 5, sleepHours: 5.5, pain: 3, mood: 5, symptoms: '', lookingForward: '' }),
    ci(-16, 'evening', { pain: 4, mood: 4, worstPain: 5, sickness: 6, appetite: 3, energy: 3, symptoms: 'Queasy from mid morning', settled: '', goodThing: 'A nap that actually helped' }),
    ci(-16, 'carer', { addedBy: 'Shelley', energy: 3, sickness: 6, appetite: 2, pain: 4, mood: 4, noticed: 'Very pale, slept most of the afternoon' }),
    ci(-15, 'morning', { sleep: 4, sleepHours: 5, pain: 4, mood: 4, symptoms: 'Sick twice in the night', lookingForward: '' }),
    ci(-15, 'evening', { pain: 4, mood: 4, worstPain: 5, sickness: 7, appetite: 2, energy: 2, symptoms: 'Sick again after lunch', settled: '', goodThing: 'Hayley rang' }),
    ci(-15, 'carer', { addedBy: 'Shelley', energy: 2, sickness: 7, appetite: 2, pain: 4, mood: 3, noticed: 'Hardly ate, kept water down in the evening' }),
    ci(-14, 'evening', { pain: 3, mood: 5, worstPain: 4, sickness: 5, appetite: 3, energy: 3, symptoms: '', settled: 'Sickness easing', goodThing: 'Sat outside for ten minutes' }),
    ci(-13, 'morning', { sleep: 6, sleepHours: 7, pain: 3, mood: 6, symptoms: '', lookingForward: 'Feeling more like myself' }),
    ci(-13, 'evening', { pain: 3, mood: 6, worstPain: 4, sickness: 3, appetite: 5, energy: 5, symptoms: '', settled: 'Appetite coming back', goodThing: 'Ate a proper dinner' }),
    ci(-13, 'carer', { addedBy: 'Shelley', energy: 5, sickness: 3, appetite: 5, pain: 3, mood: 6, noticed: 'Colour back, cleared his plate' }),
    ci(-12, 'evening', { pain: 2, mood: 7, worstPain: 3, sickness: 2, appetite: 6, energy: 6, symptoms: '', settled: '', goodThing: 'Walk to the end of the road' }),
    ci(-12, 'carer', { addedBy: 'Shelley', energy: 6, sickness: 2, appetite: 6, pain: 2, mood: 7, noticed: '' }),
    ci(-11, 'evening', { pain: 2, mood: 7, worstPain: 3, sickness: 2, appetite: 7, energy: 7, symptoms: '', settled: '', goodThing: 'Best day of the week' }),
    ci(-10, 'evening', { pain: 3, mood: 6, worstPain: 4, sickness: 4, appetite: 4, energy: 5, symptoms: '', settled: '', goodThing: 'Watched a film with Shelley' }),
    ci(-9, 'morning', { sleep: 5, sleepHours: 6, pain: 3, mood: 5, symptoms: '', lookingForward: '' }),
    ci(-9, 'evening', { pain: 4, mood: 4, worstPain: 5, sickness: 6, appetite: 3, energy: 3, symptoms: 'Queasy again, like last time', settled: '', goodThing: 'Ginger tea helped' }),
    ci(-9, 'carer', { addedBy: 'Shelley', energy: 3, sickness: 6, appetite: 3, pain: 4, mood: 4, noticed: 'Same pattern as the last cycle, day one is the hard one' }),
    ci(-8, 'morning', { sleep: 4, sleepHours: 5, pain: 4, mood: 4, symptoms: '', lookingForward: '' }),
    ci(-8, 'evening', { pain: 4, mood: 4, worstPain: 5, sickness: 6, appetite: 2, energy: 3, symptoms: '', settled: '', goodThing: 'Shelley made soup' }),
    ci(-8, 'carer', { addedBy: 'Shelley', energy: 3, sickness: 6, appetite: 2, pain: 4, mood: 4, noticed: 'Managed half the soup' }),
    ci(-7, 'evening', { pain: 4, mood: 5, worstPain: 5, sickness: 5, appetite: 3, energy: 3, symptoms: 'Shivery after lunch, temperature 37.7', settled: '', goodThing: '' }),
    ci(-6, 'carer', { addedBy: 'Shelley', energy: 4, sickness: 3, appetite: 5, pain: 4, mood: 6, noticed: 'Brighter today, wanted to go out' }),
    ci(-5, 'carer', { addedBy: 'Shelley', energy: 5, sickness: 2, appetite: 6, pain: 3, mood: 7, noticed: '' }),
    ci(-4, 'evening', { pain: 3, mood: 7, worstPain: 4, sickness: 2, appetite: 6, energy: 6, symptoms: '', settled: '', goodThing: 'Pub lunch, most of it' }),
    ci(-3, 'evening', { pain: 3, mood: 6, worstPain: 4, sickness: 4, appetite: 4, energy: 5, symptoms: '', settled: '', goodThing: 'Short walk in the garden' }),
    ci(-2, 'carer', { addedBy: 'Shelley', energy: 3, sickness: 6, appetite: 2, pain: 6, mood: 4, noticed: 'Back pain worse than the last two cycles, sick most of the afternoon' }),
    ci(-1, 'carer', { addedBy: 'Shelley', energy: 4, sickness: 3, appetite: 5, pain: 4, mood: 6, noticed: 'Better than yesterday, sat out in the sun' }),
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
    explanation: 'This is a sample explanation, showing what a pasted reply from an AI app might look like.\n\nIn plain English, this letter says the recent scan looked the same as before, which is good news, it means things have not got worse since the last check. Bloods were fine too. Nothing needs to change with treatment right now, and the next check-in will be after the next round.\n\nWorth asking the team: what would a change on the next scan actually mean for the plan.',
    addedBy: 'Shelley', addedAt: demoTs(at(-6, '11:00')), updatedAt: demoTs(at(-6, '11:20'))
  }];

  const days = {};
  days[day(-17)] = { chemo: true, treatment: 'chemo', chemoDone: true, mood: 3, good: 'Session went smoothly', updatedBy: 'Mark', updatedAt: demoTs(at(-17, '18:00')) };
  days[day(-10)] = { chemo: true, treatment: 'chemo', chemoDone: true, mood: 4, good: 'Watched a film with Shelley', updatedBy: 'Mark', updatedAt: demoTs(at(-10, '18:00')) };
  days[day(-7)] = { mood: 2, good: 'Shelley made soup', updatedBy: 'Mark', updatedAt: demoTs(at(-7, '19:00')) };
  days[day(-3)] = { chemo: true, treatment: 'chemo', chemoDone: true, mood: 3, good: 'Short walk in the garden', updatedBy: 'Mark', updatedAt: demoTs(at(-3, '18:00')) };
  days[day(4)] = { chemo: true, treatment: 'chemo', chemoDone: false, updatedBy: 'Mark', updatedAt: demoTs(at(-1, '09:00')) };
  days[day(0)] = { mood: 4, good: 'Cup of tea in the sun with Shelley', updatedBy: 'Mark', updatedAt: demoTs(at(0, '08:30')) };

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

  return { entries, documents, days, exercise, profile, meals };
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
  state.demoRecordings = [];
  state.days = fixture.days;
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
  syncSettings();
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
    syncSettings();
  }, (e) => console.error(e));
}

/* ---- Settings (More > Settings): the Food toggle, shared in profile/main ---- */
function syncSettings() {
  const on = detailedNutritionOn();
  ['settings-nutrition', 'food-nutrition'].forEach((id) => { const box = $(id); if (box.checked !== on) box.checked = on; });
  const target = $('settings-protein');
  if (document.activeElement !== target) target.value = proteinTarget() ? String(proteinTarget()) : '';
  /* Today's timeline reads the setting when it draws, so redraw it, and any open report */
  renderToday();
  if (!$('view-food').hidden) renderFoodDiary();
  if (!$('view-notes').hidden) renderNotesReport();
}

/* The same account-wide setting, switchable from Settings and from the top of the Food diary */
async function setDetailedNutrition(detailedNutrition, input) {
  if (state.demo) { state.profile = { ...state.profile, detailedNutrition }; syncSettings(); toast(detailedNutrition ? 'Estimates on' : 'Estimates off'); return; }
  try { await setDoc(doc(db, 'profile', 'main'), { detailedNutrition }, { merge: true }); toast(detailedNutrition ? 'Estimates on' : 'Estimates off'); }
  catch (e) { console.error(e); toast('Could not save the setting'); input.checked = !detailedNutrition; }
}
$('settings-nutrition').addEventListener('change', (ev) => setDetailedNutrition(ev.target.checked, ev.target));
$('settings-protein').addEventListener('change', async (ev) => {
  const n = Math.round(parseFloat(ev.target.value));
  const proteinTarget = n > 0 ? n : null;
  if (state.demo) { state.profile = { ...state.profile, proteinTarget }; syncSettings(); toast(proteinTarget ? 'Protein target saved' : 'Protein target cleared'); return; }
  try { await setDoc(doc(db, 'profile', 'main'), { proteinTarget }, { merge: true }); toast(proteinTarget ? 'Protein target saved' : 'Protein target cleared'); }
  catch (e) { console.error(e); toast('Could not save the target'); }
});
$('food-nutrition').addEventListener('change', (ev) => setDetailedNutrition(ev.target.checked, ev.target));

function watchDays() {
  state.unsub.days = onSnapshot(collection(db, 'days'), (snap) => {
    const days = {};
    snap.docs.forEach((d) => { days[d.id] = d.data(); });
    state.days = days;
    renderChemo();
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

/* Day totals from a food app: nutrition/{day} ({ kcal, prot, carb, fat, source }),
   written by the bridge from Apple Health or typed in from the Food diary.
   Where a day has one, it is used instead of the app's own estimate. */
function watchNutrition() {
  state.unsub.nutrition = onSnapshot(collection(db, 'nutrition'), (snap) => {
    const n = {};
    snap.docs.forEach((d) => { n[d.id] = d.data(); });
    state.nutrition = n;
    if (!$('view-food').hidden) renderFoodDiary();
    if (!$('view-notes').hidden) renderNotesReport();
  }, (e) => console.error(e));
}
function loggedTotals(day) {
  const n = state.nutrition[day];
  return n && Number(n.kcal) > 0 ? { kcal: Number(n.kcal) || 0, prot: Number(n.prot) || 0, carb: Number(n.carb) || 0, fat: Number(n.fat) || 0, source: n.source || 'manual' } : null;
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

/* The topbar carries the page name ("Care Log: Food diary"), so the report
   pages and the Chemo tab no longer need a heading of their own */
const PAGE_TITLES = { today: 'Today', meds: 'Medicines', vitals: 'Trends', chemo: 'Treatment plan', exercise: 'Exercise', more: 'More', food: 'Food diary', notes: 'Team notes', docs: 'Documents', settings: 'Settings' };
function setBrand(page) {
  $('brand').replaceChildren('Daybook', page ? h('span', { class: 'brand-page', text: ': ' + page }) : null);
  document.title = page ? 'Daybook: ' + page : 'Daybook';
}

function showTab(name) {
  /* Report pages highlight the tab they were opened from (Documents can be reached from a report too) */
  let highlight = name;
  if (name === 'docs') highlight = state.docsReturn || 'more';
  if (name === 'settings') highlight = 'more';
  if (highlight === 'food' || highlight === 'notes') highlight = state.reportReturn || 'vitals';
  document.querySelectorAll('.tab').forEach((b) => { const on = b.dataset.tab === highlight; b.classList.toggle('is-active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  setBrand(PAGE_TITLES[name] || '');
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
/* Today is the view showing before any tab is tapped, so the topbar starts with its name */
setBrand(PAGE_TITLES.today);

/* Only rows that are new to the screen animate in; rows already shown stay put on data updates */
const seenIds = { entries: new Set(), docs: new Set() };
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

/* The Meds tab shares Today's selected day, so a day picked on either one shows
   its own medicine adherence for that day, not always "right now". */
$('meds-day-prev').addEventListener('click', () => { state.selectedDay = addDays(state.selectedDay, -1); refreshDay(); });
$('meds-day-next').addEventListener('click', () => {
  if (state.selectedDay >= todayStr()) return;
  state.selectedDay = addDays(state.selectedDay, 1); refreshDay();
});
$('meds-day-label').addEventListener('click', () => { state.selectedDay = todayStr(); refreshDay(); });

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
  let small = fmtDayNum(state.selectedDay);
  if (state.selectedDay === today) small = 'Today';
  else if (state.selectedDay === addDays(today, -1)) small = 'Yesterday';
  const isFuture = state.selectedDay >= today;
  ['day', 'meds-day'].forEach((prefix) => {
    $(prefix + '-label').replaceChildren(fmtDayLong(state.selectedDay), h('small', { text: small }));
    $(prefix + '-next').disabled = isFuture;
    $(prefix + '-next').style.visibility = isFuture ? 'hidden' : 'visible';
  });
}

function detailedNutritionOn() { return Boolean(state.profile && state.profile.detailedNutrition); }

/* Today's timeline is drawn synchronously, so the food table is fetched in
   the background the first time it is needed and the list redrawn once. */
function ensureFoodIndexForToday() {
  if (!detailedNutritionOn() || foodIndex) return;
  loadFoodTable().then((idx) => { if (idx) renderToday(); });
}

function renderToday() {
  ensureFoodIndexForToday();
  renderTiles();
  renderCheckins();
  renderMeds();
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
    case 'checkin': return [h('span', { text: checkinTitle(e.slot) })];
    case 'pain': return [h('span', { class: 'val', text: 'Pain ' + e.value + '/10' })];
    case 'question': return [h('span', { text: e.note || 'Question' })];
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
  if (e.type === 'food') { const q = quantityText(e); if (q) bits.push(q); else if (e.amount) bits.push(e.amount); }
  if (e.type === 'food' && e.detail) bits.push(e.detail);
  if (e.type === 'food' && detailedNutritionOn() && foodIndex) {
    const m = entryMacros(foodIndex, e);
    if (m.any) bits.push('about ' + Math.round(m.totals.kcal) + ' kcal, ' + Math.round(m.totals.prot) + ' g protein');
  }
  if (e.type === 'sleep') {
    if (e.bedAt || e.wokeAt) bits.push((e.bedAt || '?') + ' to ' + (e.wokeAt || '?'));
    const s = sleepStages(e); if (s) bits.push(s);
    if (e.note) bits.push(e.note);
  }
  if (e.type === 'checkin') { const s = checkinSummary(e); if (s) bits.push(s); }
  if (e.type === 'pain' && e.note) bits.push(e.note);
  if (e.type === 'question') bits.push(e.answered ? 'Question for the team, answered' : 'Question for the team');
  if (e.type === 'question' && e.answerText) bits.push('Answer: ' + excerpt(e.answerText, 90));
  if (e.type === 'question' && e.recordings) bits.push(plural(e.recordings, 'recording'));
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
    state.readOnly ? null : h('button', { class: 'entry-menu', type: 'button', 'aria-label': 'Entry options', onclick: () => entryOptions(e) }, '⋯')
  );
}

/* Types openAdd() can pre-fill and update in place, given the original entry */
const EDITABLE_ENTRY_TYPES = ['food', 'drink', 'weight', 'note', 'question'];

function entryOptions(e) {
  const d = entryDate(e);
  const canEdit = EDITABLE_ENTRY_TYPES.includes(e.type);
  const body = h('div', null,
    h('p', null, h('strong', null, ...entryTitle(e).map((n) => n.cloneNode(true)))),
    h('p', { class: 'muted', text: `${fmtDayLong(e.day)} at ${fmtTime(d)}. ${entrySub(e)}` }),
    canEdit ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => openAdd(e.type, e) }, 'Edit') : null,
    e.type === 'question' && !state.readOnly ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { closeSheet(); openAnswerSheet(e); } }, 'Record or write the answer') : null,
    e.type === 'question' ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: async () => {
      closeSheet();
      await updateEntry(e.id, { answered: !e.answered });
      toast(e.answered ? 'Question reopened' : 'Marked as answered');
      if (!$('view-notes').hidden) renderNotesReport();
    } }, e.answered ? 'Reopen this question' : 'Mark as answered') : null,
    h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: async () => {
      closeSheet();
      await deleteEntry(e.id);
      toast('Entry deleted');
      if (!$('view-food').hidden) renderFoodDiary();
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


/* ---- Speech to text: a big "Tap to speak" button under a text box ----
   Uses the browser's own speech recognition (Safari on iPhone: Apple's, on
   device where the phone supports it; Chrome: Google's), so nothing of ours
   sits in between, no key and no cost. Words appear in the box as they are
   recognised and can be edited afterwards like anything typed. The button is
   not shown where the browser has no support; the keyboard's own microphone
   still works in every box. */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
function speakButton(target) {
  if (!SpeechRec) return null;
  const label = h('span', { class: 'speakbtn-label', text: 'Tap to speak' });
  const btn = h('button', { class: 'speakbtn', type: 'button', 'aria-pressed': 'false' }, icon('mic'), label);
  let rec = null;
  const setState = (on) => { btn.classList.toggle('is-listening', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); label.textContent = on ? 'Listening, tap to stop' : 'Tap to speak'; };
  btn.addEventListener('click', () => {
    if (rec) { try { rec.stop(); } catch (e) { /* already stopping */ } return; }
    const base = target.value.trim();
    const join = (t) => (base ? base + ' ' : '') + t.trim();
    rec = new SpeechRec();
    rec.lang = 'en-GB';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      let text = '';
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript + (ev.results[i].isFinal ? ' ' : '');
      target.value = join(text);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Allow the microphone for this site to speak your notes');
      else if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Could not hear that. Try again, or type it.');
    };
    rec.onend = () => { rec = null; setState(false); target.focus(); };
    try { rec.start(); setState(true); } catch (e) { rec = null; toast('Speech is not available here. The keyboard microphone still works.'); }
  });
  return btn;
}

function openAdd(type, editEntry) {
  const day = editEntry ? editEntry.day : state.selectedDay;
  const time = timeInput(day);
  if (editEntry) time.value = fmtTime(entryDate(editEntry));
  const note = h('input', { type: 'text', placeholder: 'Optional note', value: (editEntry && editEntry.note) || '' });
  const body = h('div', null);
  let getData;
  let editId = editEntry ? editEntry.id : null;

  if (type === 'drink') {
    const whatDefault = (editEntry && editEntry.note) || 'Water';
    const mlDefault = editEntry ? String(editEntry.value || 0) : '200';
    const what = h('input', { type: 'text', placeholder: 'What was it?', value: whatDefault });
    const ml = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '10', value: mlDefault });
    const whatPresets = presets(['Water', 'Tea', 'Coffee', 'Squash', 'Juice', 'Milk', 'Supplement drink'], what, whatDefault);
    const mlPresets = presets(['50', '100', '150', '200', '250', { value: '300', label: '300 cup' }, { value: '568', label: '568 pint' }, { value: '900', label: '900 bottle' }], ml, mlDefault);
    const howMany = stepper(1, 1, 1, 'How many');
    body.append(
      field('Drink', what), whatPresets,
      field('Amount of each (ml)', ml), mlPresets,
      h('p', { class: 'fieldlabel', text: 'How many' }), howMany.el,
      field('Time', time)
    );
    getData = () => {
      const v = parseInt(ml.value, 10);
      const n = howMany.value();
      return { type: 'drink', value: isNaN(v) ? 0 : Math.round(v * n), note: what.value.trim() || 'Drink' };
    };
  }

  if (type === 'food') {
    loadFoodTable();
    const warn = h('div', { class: 'nudge' });
    warn.hidden = true;
    let nudged = false;
    const amountDefault = (editEntry && editEntry.amount) || 'About half';
    const what = h('input', { type: 'text', placeholder: 'What was eaten?', required: true, autocomplete: 'off', value: (editEntry && editEntry.note) || '' });
    const parts = h('input', { type: 'text', placeholder: 'e.g. peas, mash, gravy', value: (editEntry && editEntry.detail) || '' });
    const amount = h('input', { type: 'hidden', value: amountDefault });
    const amountPresets = presets(['A few mouthfuls', 'About half', 'Most of it', 'All of it'], amount, amountDefault);
    const amountBlock = h('div', null, h('p', { class: 'field' }, h('span', { text: 'How much was eaten' })), amountPresets);

    /* Quantities and estimates. portionsState is keyed by component (see macroComponentKey) and holds
       { size: 'S'|'M'|'L', qty: null | { unit: 'piece'|'g', n, each?, name, many? }, override: null | { kcal, prot, carb, fat, per, grams } }.
       Pieces and grams are stored whatever the Food setting says (they are amounts, not estimates);
       sizes, overrides and the estimate itself only matter with the setting on. Rows are rebuilt
       when the text changes; typing inside a row only refreshes the totals line, so focus is never lost. */
    const macroOn = Boolean(state.profile && state.profile.detailedNutrition);
    let portionsState = editEntry && editEntry.portions ? JSON.parse(JSON.stringify(editEntry.portions)) : {};
    let lastComponents = [];
    let pendingCount = null; // a count parsed out of the name ("2 x kiwi"), applied to the first countable row
    const rowsWrap = h('div', { class: 'qtyrows' });
    const totalsEl = h('p', { class: 'macro-total' });
    totalsEl.hidden = true;
    const draft = () => ({ note: what.value, detail: parts.value, amount: amount.value, portions: portionsState });
    const refreshTotals = () => {
      if (!macroOn || !foodIndex) return;
      const m = entryMacros(foodIndex, draft());
      if (!lastComponents.length) { totalsEl.hidden = true; return; }
      totalsEl.hidden = false;
      totalsEl.textContent = m.any
        ? 'Estimated: ' + fmtMacroLine(m.totals) + (m.excluded.length ? '. Not counted: ' + m.excluded.join(', ') : '')
        : 'No estimate for this yet. Enter it from the packet if you want one.';
    };
    const overridePanel = (c, portion, rebuild) => {
      const ov = portion.override;
      const perBtns = [
        h('button', { class: 'preset', type: 'button', text: 'Per portion' }),
        h('button', { class: 'preset', type: 'button', text: 'Per 100 g' })
      ];
      const markPer = () => { perBtns[0].classList.toggle('is-active', ov.per !== '100g'); perBtns[1].classList.toggle('is-active', ov.per === '100g'); grams.parentElement.hidden = ov.per !== '100g'; };
      perBtns[0].addEventListener('click', () => { ov.per = 'portion'; markPer(); refreshTotals(); });
      perBtns[1].addEventListener('click', () => { ov.per = '100g'; markPer(); refreshTotals(); });
      const grams = h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '1', placeholder: '0', value: ov.grams != null ? String(ov.grams) : '' });
      grams.addEventListener('input', () => { ov.grams = grams.value === '' ? null : parseFloat(grams.value); refreshTotals(); });
      const num = (label, key, step) => {
        const inp = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: step || '0.1', placeholder: '0', value: ov[key] != null ? String(ov[key]) : '' });
        inp.addEventListener('input', () => { ov[key] = inp.value === '' ? null : parseFloat(inp.value); refreshTotals(); });
        return field(label, inp);
      };
      const gramsField = field('Weight eaten (g)', grams);
      const panel = h('div', { class: 'override' },
        h('p', { class: 'macro-row-label', text: 'From the packet' }),
        h('div', { class: 'presets' }, ...perBtns),
        gramsField,
        h('div', { class: 'field-row' }, num('Calories (kcal)', 'kcal', '1'), num('Protein (g)', 'prot')),
        h('div', { class: 'field-row' }, num('Carbs (g)', 'carb'), num('Fat (g)', 'fat')),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => {
            const g = ov.per === '100g' ? 100 : (parseFloat(grams.value) || 0);
            if (!g) { grams.parentElement.hidden = false; grams.focus(); toast('Add the weight eaten so it can be saved per 100 g'); return; }
            const f = 100 / g;
            const per100 = { kcal: (ov.kcal || 0) * f, prot: (ov.prot || 0) * f, carb: (ov.carb || 0) * f, fat: (ov.fat || 0) * f };
            await saveCustomFood(c.phrase, per100);
            toast(`"${c.phrase}" saved to My foods`);
          } }, 'Save to my foods'),
          h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: () => { portion.override = null; rebuild(); } }, 'Use the table estimate')
        ),
        h('p', { class: 'hint', text: 'Per portion means the whole amount eaten; per 100 g is scaled by the weight above. Saving to My foods keeps the per 100 g figures under this name for next time.' })
      );
      markPer();
      return panel;
    };
    /* One row per component: How many (pieces), How much (grams) or Small/Medium/Large, plus the packet override */
    const componentRow = (c, rebuild) => {
      const portion = portionsState[c.key] || (portionsState[c.key] = { size: 'M', override: null, qty: defaultQty(c.phrase, c.food, what.value + ', ' + parts.value) });
      if (portion.qty === undefined) portion.qty = defaultQty(c.phrase, c.food, what.value + ', ' + parts.value);
      const scale = amountScale(amount.value);
      const custom = customFoodByName(c.phrase);
      const group = c.food ? portionGroupFor(c.food) : { label: 'Anything else', sizes: [60, 120, 200] };
      const label = c.food ? c.food.n : c.phrase;
      const known = Boolean(c.food || custom);
      const sub = portion.qty ? (portion.qty.unit === 'piece' ? `about ${portion.qty.each} g each, estimate` : 'weighed') : custom ? 'From My foods' : c.food ? 'Typical portion, estimate' : 'Not in the food table';
      const row = h('div', { class: 'macro-row' }, h('p', { class: 'macro-row-label' }, label, h('small', { text: sub })));
      if (portion.override) { row.append(overridePanel(c, portion, rebuild)); return row; }
      if (portion.qty && portion.qty.unit === 'piece') {
        const q = portion.qty;
        const st = stepper(q.n, 0.5, 1, 'How many ' + q.many, (v) => { q.n = v; st.unitEl.textContent = v === 1 ? q.name : q.many; refreshTotals(); }, q.n === 1 ? q.name : q.many);
        row.append(h('p', { class: 'fieldlabel', text: 'How many' }), st.el);
      } else if (portion.qty && portion.qty.unit === 'g') {
        const q = portion.qty;
        const st = stepper(q.n, 0, 10, 'How much in grams', (v) => { q.n = v; refreshTotals(); }, 'g');
        row.append(h('p', { class: 'fieldlabel', text: 'How much' }), st.el,
          h('div', { class: 'presets' }, ...[['20', 'small handful 20 g'], ['30', 'handful 30 g'], ['50', '50 g'], ['100', '100 g']].map(([v, l]) => h('button', { class: 'preset', type: 'button', text: l, onclick: () => st.set(parseFloat(v)) }))));
      } else if (known && macroOn) {
        row.append(
          h('div', { class: 'presets' }, ...['S', 'M', 'L'].map((size) => h('button', {
            class: 'preset' + (portion.size === size ? ' is-active' : ''), type: 'button',
            onclick: () => { portion.size = size; rebuild(); }
          }, `${PORTION_SIZE_NAME[size]} ${portionGrams(c.food, size, scale)} g`))),
          h('p', { class: 'hint', text: group.label + (scale < 1 ? `, scaled for "${amount.value.toLowerCase()}"` : '') })
        );
      } else if (macroOn) {
        row.append(h('p', { class: 'hint', text: 'No figures for this, so it is left out of the estimate unless entered from the packet.' }));
      }
      if (macroOn) row.append(h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: () => {
        portion.override = { kcal: null, prot: null, carb: null, fat: null, per: 'portion', grams: portionGrams(c.food, portion.size, scale, portion.qty) };
        rebuild();
      } }, 'Enter from the packet'));
      return row;
    };
    const rebuildRows = () => {
      if (!foodIndex) { rowsWrap.replaceChildren(); return; }
      const m = entryMacros(foodIndex, draft());
      lastComponents = m.components;
      const keep = new Set(m.components.map((c) => c.key));
      Object.keys(portionsState).forEach((k) => { if (!keep.has(k)) delete portionsState[k]; });
      if (pendingCount != null) {
        for (const c of m.components) {
          const portion = portionsState[c.key] || (portionsState[c.key] = { size: 'M', override: null, qty: defaultQty(c.phrase, c.food, what.value + ', ' + parts.value) });
          if (portion.qty && portion.qty.unit === 'piece') { portion.qty.n = pendingCount; break; }
        }
        pendingCount = null;
      }
      const rows = m.components.map((c) => componentRow(c, rebuildRows)).filter((r) => r.childElementCount > 1);
      rowsWrap.replaceChildren(...rows);
      /* "How much was eaten" only matters when something is sized rather than counted or weighed */
      const needsAmount = !m.components.length || m.components.some((c) => !(portionsState[c.key] && portionsState[c.key].qty && !portionsState[c.key].override));
      amountBlock.hidden = !needsAmount;
      refreshTotals();
    };
    parts.addEventListener('input', rebuildRows);
    amountPresets.addEventListener('click', rebuildRows); // the S/M/L grams scale with how much was eaten
    loadFoodTable().then(() => { if (!details.hidden) rebuildRows(); });

    /* Stage one, pick: the search box with Recent and the meals usually logged at this
       time of day under it, replaced by live matches (saved meals, My foods, the UK food
       table) as soon as typing starts. Stage two, details: the chosen meal at the top,
       what is in it, one quantity row per food, the estimate, and the time tucked away. */
    const pick = h('div', { class: 'pick' });
    const list = h('div', { class: 'picklist' });
    const details = h('div', { class: 'fooddetails' });
    details.hidden = true;
    const chosenName = h('p', { class: 'chosen-name' });
    const heading = (t) => h('p', { class: 'pick-head', text: t });
    const pickRow = (title, sub, onPick) => h('button', { class: 'pickrow', type: 'button', onclick: onPick },
      h('span', { class: 'pickrow-main' }, h('span', { class: 'pickrow-title', text: title }), sub ? h('span', { class: 'pickrow-sub', text: sub }) : null),
      icon('chevron'));
    let pickedRawName = null; // a saved meal chosen under an old name with a number in it, renamed on save
    const showDetails = () => {
      chosenName.textContent = what.value.trim();
      pick.hidden = true;
      details.hidden = false;
      rebuildRows();
    };
    const choose = (rawName, meal) => {
      const parsed = parseQuantityName(rawName);
      pickedRawName = meal && parsed.name.toLowerCase() !== String(meal.name || '').toLowerCase() ? meal.name : null;
      what.value = parsed.name;
      pendingCount = parsed.count;
      if (meal) parts.value = meal.parts || '';
      portionsState = meal && meal.portions ? JSON.parse(JSON.stringify(meal.portions)) : {};
      showDetails();
    };
    const cleanName = (n) => parseQuantityName(n).name;
    const renderPick = () => {
      const q = what.value.trim().toLowerCase();
      const rows = [];
      if (!q) {
        const recent = recentFoods(5);
        const seen = new Set(recent.map((r) => r.name.toLowerCase()));
        if (recent.length) {
          rows.push(heading('Recent'));
          recent.forEach((r) => rows.push(pickRow(cleanName(r.name), r.parts || '', () => choose(r.name, r))));
        }
        const slot = mealSlot(time.value);
        const often = usualMeals(slot, seen, 4);
        if (often.length) {
          rows.push(heading(MEAL_SLOT_LABEL[slot]));
          often.forEach((m) => rows.push(pickRow(cleanName(m.name), m.parts || '', () => choose(m.name, m))));
        }
        if (!rows.length) rows.push(h('p', { class: 'hint', text: 'Type what was eaten. Meals you log are remembered and offered here next time.' }));
      } else {
        const typed = what.value.trim();
        const cleaned = parseQuantityName(typed);
        const exact = findMeal(typed) || findMeal(cleaned.name);
        const mealHits = state.meals.filter((m) => (m.name || '').toLowerCase().includes(q) || cleanName(m.name).toLowerCase().includes(cleaned.name.toLowerCase()))
          .sort((a, b) => Number((b.name || '').toLowerCase().startsWith(q)) - Number((a.name || '').toLowerCase().startsWith(q)) || (a.name || '').localeCompare(b.name || ''))
          .slice(0, 5);
        if (!exact) rows.push(pickRow(cleaned.count ? `Log ${fmtQtyNumber(cleaned.count)} ${cleaned.name}` : `Log "${typed}"`, 'As typed', () => choose(typed, null)));
        mealHits.forEach((m) => rows.push(pickRow(cleanName(m.name), m.parts || 'Saved meal', () => choose(cleaned.count ? `${cleaned.count} x ${m.name}` : m.name, m))));
        const customHits = ((state.profile && state.profile.customFoods) || []).filter((f) => (f.name || '').toLowerCase().includes(q)).slice(0, 3);
        customHits.forEach((f) => rows.push(pickRow(f.name, 'My foods', () => choose(f.name, null))));
        const tq = cleaned.name.toLowerCase();
        if (foodIndex && tq.length >= 2) {
          const taken = new Set([...mealHits.map((m) => m.name.toLowerCase()), ...customHits.map((f) => f.name.toLowerCase())]);
          const tableHits = foodIndex.foods.filter((f) => f.n && f.n.toLowerCase().includes(tq) && !taken.has(f.n.toLowerCase()))
            .map((f) => ({ f, rank: f.n.toLowerCase().startsWith(tq) ? 0 : new RegExp('\\b' + tq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(f.n.toLowerCase()) ? 1 : 2 }))
            .sort((a, b) => a.rank - b.rank || a.f.n.length - b.f.n.length)
            .slice(0, 6);
          if (tableHits.length) { rows.push(heading('UK food table')); tableHits.forEach(({ f }) => rows.push(pickRow(f.n, '', () => choose(cleaned.count ? `${cleaned.count} x ${f.n}` : f.n, null)))); }
        }
      }
      list.replaceChildren(...rows);
    };
    what.addEventListener('input', renderPick);
    what.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && what.value.trim()) { ev.preventDefault(); choose(what.value.trim(), findMeal(what.value) || findMeal(cleanName(what.value))); } });
    loadFoodTable().then(() => { if (!pick.hidden) renderPick(); });
    pick.append(field('Food', what), list);

    /* The time is shown as a line, and only becomes a field when it needs changing */
    const timeField = field('Time', time);
    timeField.hidden = !editEntry;
    const timeShown = h('b', { text: time.value });
    time.addEventListener('input', () => { timeShown.textContent = time.value; });
    const timeLine = h('p', { class: 'hint timeline-note' }, 'Time ', timeShown, ' ',
      h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: () => { timeLine.hidden = true; timeField.hidden = false; time.focus(); } }, 'Change'));
    timeLine.hidden = Boolean(editEntry);
    details.append(
      h('div', { class: 'chosen' }, chosenName,
        h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: () => { details.hidden = true; pick.hidden = false; renderPick(); what.focus(); } }, 'Change')),
      field('What is in it (optional)', parts),
      rowsWrap,
      amountBlock,
      totalsEl,
      timeLine, timeField,
      warn
    );
    body.append(pick, details);
    if (editEntry) showDetails(); else renderPick();

    getData = () => {
      if (details.hidden) { /* still on the pick stage: take what was typed */
        if (!what.value.trim()) return null;
        choose(what.value.trim(), findMeal(what.value) || findMeal(cleanName(what.value)));
        return { hold: true };
      }
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
      /* Only the components still on screen are kept. Pieces and grams are stored whatever the setting;
         sizes and overrides only mean something with it on, so with it off only rows with a quantity are kept. */
      const kept = lastComponents.map((c) => [c.key, portionsState[c.key]]).filter(([, p]) => p && (macroOn || (p.qty && p.qty.n > 0)));
      const portions = kept.length ? Object.fromEntries(kept.map(([k, p]) => [k, { size: p.size || 'M', override: p.override || null, qty: p.qty || null }])) : null;
      if (amountBlock.hidden) amount.value = 'All of it';
      /* Every meal is remembered, with when it is usually eaten; a meal chosen under an old
         name with a number in it ("2 x kiwi") is renamed to the clean one */
      const existing = findMeal(name) || (pickedRawName ? findMeal(pickedRawName) : null);
      saveMeal(existing ? existing.id : null, name, detail, portions, mealSlot(time.value), existing);
      const data = { type: 'food', note: name, amount: amount.value };
      if (detail) data.detail = detail;
      if (portions) data.portions = portions;
      return data;
    };
  }

  if (type === 'pain') {
    const sl = sliderBlock({ kind: 'pain', q: 'Pain right now', low: '1 none', high: '10 worst' }, editEntry ? editEntry.value : null);
    const painNote = h('input', { type: 'text', placeholder: 'Where, or what helped (optional)', value: (editEntry && editEntry.note) || '' });
    body.append(h('p', { class: 'wiz-q', text: 'Pain right now' }), ...sl.nodes, field('Time', time), field('Note', painNote));
    getData = () => {
      const v = sl.value();
      if (v == null) { toast('Slide to a number first'); return { hold: true }; }
      return { type: 'pain', value: v, note: painNote.value.trim() };
    };
  }

  if (type === 'weight') {
    const last = state.recentEntries.find((e) => e.type === 'weight');
    const input = h('input', { type: 'number', step: '0.1', min: '20', max: '250', inputmode: 'decimal', value: editEntry ? Number(editEntry.value).toFixed(1) : (last ? Number(last.value).toFixed(1) : ''), placeholder: '0.0', required: true });
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
    const text = h('textarea', { rows: '4', placeholder: 'How things are, symptoms, anything worth remembering' });
    if (editEntry) text.value = editEntry.note || '';
    body.append(field('Note', text), speakButton(text) || '', field('Time', time));
    getData = () => {
      if (!text.value.trim()) return null;
      return { type: 'note', note: text.value.trim() };
    };
  }

  /* A question for the oncologist or nurse: it goes to the top of Notes for the
     team and stays there, whatever the range, until marked as answered */
  if (type === 'question') {
    const text = h('textarea', { rows: '4', placeholder: 'What do you want to ask the oncologist or nurse?' });
    if (editEntry) text.value = editEntry.note || '';
    body.append(
      h('p', { class: 'hint', text: 'Goes to the top of Notes for the team, and stays there until it is marked as answered.' }),
      field('Question', text), speakButton(text) || '', field('Time', time)
    );
    getData = () => {
      if (!text.value.trim()) return null;
      return { type: 'question', note: text.value.trim(), answered: Boolean(editEntry && editEntry.answered) };
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
    const lastW = state.recentEntries.find((e) => e.type === 'weight');
    const wt = h('input', { type: 'number', step: '0.1', min: '20', max: '250', inputmode: 'decimal', placeholder: lastW ? Number(lastW.value).toFixed(1) : '0.0' });
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
      field('Weight (kg)', wt),
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
      const wV = parseFloat(wt.value);
      if (!isNaN(wV) && wV > 0) out.push({ type: 'weight', value: Math.round(wV * 10) / 10, note: noteV });
      return out.length ? out : null;
    };
  }

  const titles = { drink: 'Drink', food: 'Food', weight: 'Weight', note: 'Note', vitals: 'Vitals', sleep: 'Sleep', question: 'Question for the team', pain: 'Log pain' };
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
      if (!$('view-food').hidden) renderFoodDiary();
      return;
    }
    const ids = [];
    for (const d of list) { d.at = at; ids.push(await addEntry(d)); }
    toast(titles[type] + ' saved', { label: 'Undo', onClick: () => ids.forEach((id) => deleteEntry(id)) });
    if (!$('view-food').hidden) renderFoodDiary();
    if (type === 'food') promptMealMeds(at);
  });
  body.append(save, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel'));
  openSheet(titles[type], body);
}

/* A minus / number / plus control. step is the button step; the number can also be typed (halves are fine) */
function stepper(initial, min, step, label, onChange, unit) {
  const input = h('input', { type: 'number', inputmode: 'decimal', min: String(min), step: 'any', value: String(initial), 'aria-label': label });
  const set = (v) => { input.value = fmtQtyNumber(Math.max(min, v)); if (onChange) onChange(parseFloat(input.value)); };
  const unitEl = unit ? h('span', { class: 'unit', text: unit }) : null;
  const el = h('div', { class: 'stepper' },
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Fewer', onclick: () => { const v = parseFloat(input.value) || 0; set(v - step < min && v > min ? min : v - step); } }, '\u2212'),
    input, unitEl,
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'More', onclick: () => set((parseFloat(input.value) || 0) + step) }, '+')
  );
  input.addEventListener('input', () => { if (onChange) onChange(parseFloat(input.value) || 0); });
  return { el, unitEl, value: () => parseFloat(input.value) || 0, set };
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

/* Meal-time slots, from the time being logged: which saved meals to offer first */
const MEAL_SLOT_LABEL = { breakfast: 'Usual for breakfast', lunch: 'Usual for lunch', dinner: 'Usual for dinner', snack: 'Usual snacks' };
function mealSlot(hhmm) {
  const hour = parseInt(String(hhmm || '').slice(0, 2), 10);
  if (isNaN(hour)) return 'snack';
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 21) return 'dinner';
  return 'snack';
}
const mealMillis = (m) => (m.lastAt && typeof m.lastAt.toDate === 'function') ? m.lastAt.toDate().getTime() : (typeof m.lastAt === 'number' ? m.lastAt : 0);
/* The last n distinct foods logged: the past two days first, then saved meals by when they were last used */
function recentFoods(n) {
  const out = [], seen = new Set();
  for (const e of state.recentEntries) {
    if (e.type !== 'food' || !e.note) continue;
    const key = e.note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const meal = findMeal(e.note);
    out.push({ name: e.note, parts: e.detail || (meal ? meal.parts : ''), portions: e.portions || (meal ? meal.portions : null) });
    if (out.length >= n) return out;
  }
  for (const m of state.meals.slice().sort((a, b) => mealMillis(b) - mealMillis(a))) {
    if (!mealMillis(m) || seen.has((m.name || '').toLowerCase())) continue;
    seen.add((m.name || '').toLowerCase());
    out.push(m);
    if (out.length >= n) break;
  }
  return out;
}
/* Saved meals most often logged in this slot, then the most used overall, then A to Z for meals never counted */
function usualMeals(slot, exclude, n) {
  const count = (m) => (m.slots && m.slots[slot]) || 0;
  return state.meals.filter((m) => !exclude.has((m.name || '').toLowerCase()))
    .sort((a, b) => count(b) - count(a) || (b.uses || 0) - (a.uses || 0) || (a.name || '').localeCompare(b.name || ''))
    .slice(0, n);
}

/* portions is the optional per-component map from the Food sheet (see openAdd);
   left alone when not passed, so editing a meal's name or parts never drops it */
function saveMeal(id, name, parts, portions, usedSlot, existing) {
  /* usedSlot (breakfast, lunch, dinner, snack) means the meal was just logged: count it,
     so the Food sheet can offer the right meals at the right time of day */
  const usage = usedSlot ? { lastAt: state.demo ? Date.now() : serverTimestamp(), uses: ((existing && existing.uses) || 0) + 1, slots: { ...((existing && existing.slots) || {}), [usedSlot]: (((existing && existing.slots) || {})[usedSlot] || 0) + 1 } } : {};
  if (state.demo) {
    const m = id ? state.meals.find((x) => x.id === id) : null;
    if (m) { m.name = name; m.parts = parts; if (portions) m.portions = portions; Object.assign(m, usage); }
    else state.meals.push({ id: fakeId('meal'), name, parts, portions: portions || null, addedBy: state.name, ...usage });
    return Promise.resolve();
  }
  const ref = id ? doc(db, 'meals', id) : doc(collection(db, 'meals'));
  const data = { name, parts, updatedAt: serverTimestamp(), ...usage };
  if (portions) data.portions = portions;
  if (!id) { data.addedBy = state.name; data.createdAt = serverTimestamp(); }
  return setDoc(ref, data, { merge: true }).catch((e) => { console.error(e); toast('Could not save the meal'); });
}

function deleteMeal(id) {
  if (state.demo) { state.meals = state.meals.filter((m) => m.id !== id); return Promise.resolve(); }
  return deleteDoc(doc(db, 'meals', id)).catch((e) => { console.error(e); toast('Could not remove the meal'); });
}

$('more-meals').addEventListener('click', openManageMeals);
$('more-settings').addEventListener('click', () => showTab('settings'));
$('settings-back').addEventListener('click', () => showTab('more'));

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
/* ---- Report ranges: the 7/14/30/90 day presets, or a custom From and To ----
   Appointments do not fall on neat boundaries, so a custom range lets a
   report run from the last appointment to the next one. The last custom
   range is kept in state for the session only, never written to Firestore.
   Both reports (Food diary, Notes for the team) share this wiring; `kind`
   is 'food' or 'notes' and matches the element ids and state keys. */
const CUSTOM_RANGE_MAX_DAYS = 180;

function reportRange(kind) {
  const to = todayStr();
  if (state[kind + 'RangeMode'] === 'custom' && state[kind + 'CustomFrom'] && state[kind + 'CustomTo']) {
    return { from: state[kind + 'CustomFrom'], to: state[kind + 'CustomTo'], custom: true };
  }
  return { from: addDays(to, -(state[kind + 'Range'] - 1)), to, custom: false };
}

/* The on-screen header: custom ranges read "From ... to ...", presets keep their existing wording */
function reportRangeLabel(kind, range) {
  return range.custom
    ? `From ${fmtDayNum(range.from)} to ${fmtDayNum(range.to)}`
    : `Last ${state[kind + 'Range']} days, from ${fmtDayNum(range.from)}`;
}

function wireReportRange(kind, render) {
  const view = $('view-' + kind);
  const box = $(kind + '-custom'), fromEl = $(kind + '-custom-from'), toEl = $(kind + '-custom-to'), msg = $(kind + '-custom-msg');
  const showMsg = (text) => { msg.textContent = text; msg.hidden = !text; };
  const apply = () => {
    const from = fromEl.value, to = toEl.value;
    if (!from || !to) { showMsg('Choose both a From and a To date.'); return; }
    if (to < from) { showMsg('The To date cannot be before the From date.'); return; }
    if (daysBetween(from, to) + 1 > CUSTOM_RANGE_MAX_DAYS) { showMsg(`Custom ranges are limited to ${CUSTOM_RANGE_MAX_DAYS} days. Pick a shorter period.`); return; }
    showMsg('');
    state[kind + 'CustomFrom'] = from;
    state[kind + 'CustomTo'] = to;
    render();
  };
  fromEl.addEventListener('change', apply);
  toEl.addEventListener('change', apply);
  view.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
    view.querySelectorAll('.seg').forEach((x) => x.classList.toggle('is-active', x === b));
    if (b.dataset.range === 'custom') {
      state[kind + 'RangeMode'] = 'custom';
      /* To defaults to today and From to 14 days earlier, unless a range was picked earlier this session */
      if (!state[kind + 'CustomTo']) { state[kind + 'CustomTo'] = todayStr(); state[kind + 'CustomFrom'] = addDays(todayStr(), -14); }
      fromEl.value = state[kind + 'CustomFrom']; toEl.value = state[kind + 'CustomTo'];
      fromEl.max = todayStr(); toEl.max = todayStr();
      box.hidden = false;
      showMsg('');
      render();
      return;
    }
    state[kind + 'RangeMode'] = 'preset';
    state[kind + 'Range'] = parseInt(b.dataset.range, 10);
    box.hidden = true;
    showMsg('');
    render();
  }));
}
wireReportRange('food', () => renderFoodDiary());
wireReportRange('notes', () => renderNotesReport());

function fmtMl(ml) {
  return ml >= 1000 ? (ml / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' L' : ml + ' ml';
}

/* Builds a simple text PDF (title, subtitle, then heading / sub / muted / text
   blocks) and hands it to the share sheet where available, so on the phone it
   can go straight to Files, Mail or AirDrop; otherwise it downloads. */
function buildPdfBlob(title, subtitle, blocks) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const M = 48, maxW = W - M * 2;
  let y = M;
  const footer = () => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(120);
    pdf.text(`Daybook · ${title} · page ${pdf.getNumberOfPages()}`, M, H - 24);
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
  /* Nutrition-group colours as PDF fill RGB (jsPDF wants 0-255 triples, not
     hex or CSS vars); the same groups and hues as the on-screen tag chips. */
  const GROUP_RGB = { veg: [46, 125, 79], protein: [156, 79, 156], carb: [192, 138, 21], dairy: [90, 102, 108], watch: [154, 78, 34] };
  /* Two-column table: left column wraps, right column is either plain text or
     an array of { label, group } tags, each drawn in its own colour and
     wrapped word by word so a long tag list still breaks onto new lines. */
  const table = (b) => {
    const widths = b.widths || [0.64, 0.36];
    const gap = 10, size = 10.5, lh = size * 1.35, pad = 4;
    const colW = widths.map((w) => maxW * w - gap / 2);
    const xs = [M, M + maxW * widths[0] + gap / 2];
    const wrapTags = (tags, width) => {
      const lines = []; let line = [], lineW = 0;
      tags.forEach((t, i) => {
        const text = t.label + (i < tags.length - 1 ? ', ' : '');
        const w = pdf.getTextWidth(text);
        if (lineW + w > width && line.length) { lines.push(line); line = []; lineW = 0; }
        line.push({ text, rgb: GROUP_RGB[t.group] || [0, 0, 0] });
        lineW += w;
      });
      if (line.length) lines.push(line);
      return lines;
    };
    const row = (cells, bold, colour) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
      const cellData = cells.map((c, i) => Array.isArray(c) ? { tags: wrapTags(c, colW[i]) } : { plain: pdf.splitTextToSize(String(c || ''), colW[i]) });
      const rh = Math.max(...cellData.map((c) => (c.tags || c.plain).length), 1) * lh + pad * 2;
      if (y + rh > H - 48) { footer(); pdf.addPage(); y = M; pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); }
      cellData.forEach((c, i) => {
        if (c.tags) {
          c.tags.forEach((line, k) => {
            let x = xs[i];
            line.forEach((run) => { pdf.setTextColor(...run.rgb); pdf.text(run.text, x, y + pad + size + k * lh); x += pdf.getTextWidth(run.text); });
          });
        } else {
          pdf.setTextColor(colour);
          c.plain.forEach((ln, k) => pdf.text(ln, xs[i], y + pad + size + k * lh));
        }
      });
      y += rh;
      pdf.setDrawColor(215); pdf.setLineWidth(0.5); pdf.line(M, y, M + maxW, y);
    };
    if (b.head) row(b.head, true, 90);
    b.rows.forEach((r) => row(r, false, 0));
    y += 6;
  };
  /* A day's nutrition-group mix as a solid pie (a white circle punched over
     the middle gives the same donut look as the on-screen chart), with a
     coloured-swatch legend to its right. */
  const wedge = (cx, cy, r, fromDeg, toDeg) => {
    const steps = Math.max(1, Math.ceil((toDeg - fromDeg) / 8));
    const pt = (deg) => { const rad = deg * Math.PI / 180; return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)]; };
    for (let i = 0; i < steps; i++) {
      const a0 = fromDeg + (toDeg - fromDeg) * i / steps, a1 = fromDeg + (toDeg - fromDeg) * (i + 1) / steps;
      const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
      pdf.triangle(cx, cy, x0, y0, x1, y1, 'F');
    }
  };
  const donut = (b) => {
    const r = 30, rowH = r * 2 + 10;
    if (y + rowH > H - 48) { footer(); pdf.addPage(); y = M; }
    const cx = M + r, cy = y + r;
    const total = NUTRI_GROUP_ORDER.reduce((s, g) => s + (b.groups[g] || 0), 0);
    let at = 0;
    NUTRI_GROUP_ORDER.forEach((g) => {
      if (!b.groups[g]) return;
      const from = at, to = at + (b.groups[g] / total) * 360;
      pdf.setFillColor(...GROUP_RGB[g]);
      wedge(cx, cy, r, from, to);
      at = to;
    });
    pdf.setFillColor(255, 255, 255);
    pdf.circle(cx, cy, r * 0.42, 'F');
    let ly = cy - r + 8;
    const lx = cx + r + 18;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5);
    NUTRI_GROUP_ORDER.forEach((g) => {
      if (!b.groups[g]) return;
      pdf.setFillColor(...GROUP_RGB[g]);
      pdf.rect(lx, ly - 8, 9, 9, 'F');
      pdf.setTextColor(0);
      pdf.text(`${NUTRI_GROUP_LABEL[g]} (${b.groups[g]})`, lx + 14, ly);
      ly += 16;
    });
    y = Math.max(cy + r, ly) + 10;
  };
  /* At-a-glance row: a coloured bar, the level word and topic in that colour, then the text */
  const FLAG_RGB = { red: [164, 38, 44], amber: [154, 91, 0], teal: [30, 95, 116], green: [46, 107, 69] };
  const flag = (b) => {
    const size = 11, lh = size * 1.35, x = M + 12, w = maxW - 12;
    const label = LEVEL_WORD[b.level] + ': ';
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(size);
    const labelW = pdf.getTextWidth(label);
    pdf.setFont('helvetica', 'normal');
    const first = pdf.splitTextToSize(b.text, Math.max(40, w - labelW));
    const rest = first.length > 1 ? pdf.splitTextToSize(first.slice(1).join(' '), w) : [];
    const lines = [first[0]].concat(rest);
    const rh = lines.length * lh + 8;
    if (y + rh > H - 48) { footer(); pdf.addPage(); y = M; }
    pdf.setFillColor(...FLAG_RGB[b.level]); pdf.rect(M, y + 4, 3, rh - 8, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(size); pdf.setTextColor(...FLAG_RGB[b.level]);
    pdf.text(label, x, y + 4 + size);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0);
    lines.forEach((ln, k) => pdf.text(ln, k === 0 ? x + labelW : x, y + 4 + size + k * lh));
    y += rh;
  };
  /* A question with a box to tick in the appointment, then who asked it and when */
  const question = (b) => {
    const size = 11.5, lh = size * 1.35, x = M + 22;
    const lines = pdf.splitTextToSize(`${b.n}. ${b.text}`, maxW - 22);
    const rh = (lines.length + 1) * lh + 6;
    if (y + rh + 66 > H - 48) { footer(); pdf.addPage(); y = M; }
    pdf.setDrawColor(120); pdf.setLineWidth(0.8); pdf.rect(M + 2, y + 3, 11, 11);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(size); pdf.setTextColor(0);
    lines.forEach((ln, k) => pdf.text(ln, x, y + size + k * lh));
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(110);
    pdf.text(`Asked by ${b.who}, ${fmtDayShort(b.day)}`, x, y + size + lines.length * lh);
    y += rh;
    /* Three faint lines to write the answer on in clinic */
    pdf.setDrawColor(205); pdf.setLineWidth(0.3);
    for (let k = 0; k < 3; k++) { y += 20; pdf.line(x, y, M + maxW, y); }
    y += 6;
  };
  /* A written note: who wrote it (bold), when and in what context, then the note itself */
  const note = (b) => {
    const size = 10.5, lh = size * 1.35;
    const head = `${b.who} · ${b.time}${b.context ? ' · ' + b.context : ''}`;
    const lines = pdf.splitTextToSize(b.text, maxW - 10);
    const rh = (lines.length + 1) * lh + 6;
    if (y + rh > H - 48) { footer(); pdf.addPage(); y = M; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(size); pdf.setTextColor(...FLAG_RGB.teal);
    pdf.text(head, M + 10, y + size);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0);
    lines.forEach((ln, k) => pdf.text(ln, M + 10, y + size + (k + 1) * lh));
    y += rh;
  };
  blocks.forEach((b) => {
    if (b.kind === 'flag') flag(b);
    else if (b.kind === 'question') question(b);
    else if (b.kind === 'note') note(b);
    else if (b.kind === 'heading') { y += 10; write(b.text, 14, 'bold', PDF_TEAL, 0); pdf.setDrawColor(200); pdf.setLineWidth(0.5); pdf.line(M, y + 1, M + maxW, y + 1); y += 8; }
    else if (b.kind === 'sub') { y += 4; write(b.text, 12, 'bold', 0, 2); }
    else if (b.kind === 'muted') write(b.text, 10.5, 'normal', 110, 3);
    else if (b.kind === 'table') table(b);
    else if (b.kind === 'donut') donut(b);
    else write(b.text, 11, 'normal', 0, 4);
  });
  footer();
  return pdf.output('blob');
}

async function savePdf(filename, title, subtitle, blocks) {
  /* On desktop Chrome/Edge, ask where to save (Desktop and all) straight away,
     before anything else, so the browser still counts this as a direct
     response to the tap; not supported on phones (or Safari, or Firefox),
     which fall through to the share sheet or a plain download below. */
  let saveHandle = null;
  if (window.showSaveFilePicker) {
    try {
      saveHandle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      saveHandle = null;
    }
  }
  try { await loadScript(CDN.jspdf); } catch (e) { toast('Saving a PDF needs a connection'); return; }
  const blob = buildPdfBlob(title, subtitle, blocks);
  if (saveHandle) {
    try {
      const writable = await saveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      toast('PDF saved');
    } catch (e) { console.error(e); toast('Could not save the file'); }
    return;
  }
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

/* Opens the PDF in a new tab to look at, without sending or downloading it.
   The tab is opened straight away, synchronously, before the PDF itself is
   built (which needs the jsPDF library to load first); filling it in only
   once that is ready, rather than opening the tab after the fact, is what
   stops browsers treating this as a blocked pop-up. */
function previewPdf(title, subtitle, blocks) {
  const win = window.open('', '_blank');
  (async () => {
    try { await loadScript(CDN.jspdf); }
    catch (e) { toast('Preview needs a connection'); if (win) win.close(); return; }
    const blob = buildPdfBlob(title, subtitle, blocks);
    const url = URL.createObjectURL(blob);
    if (win) win.location = url;
    else toast('Could not open the preview. Check pop-ups are allowed.');
  })();
}

/* Every entry from a day onwards; null if the read failed */
async function loadEntriesFrom(from) {
  if (state.demo) return state.recentEntries.filter((e) => e.day >= from);
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('day', '>=', from)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
  'corn on the cob': [[/^sweetcorn, kernels, boiled 'on the cob' in unsalted water$/i]],
  'corn': [[/^sweetcorn, kernels, boiled 'on the cob' in unsalted water$/i]],
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

/* Colour groups for the Food diary's donut chart and tag chips. Only three tags
   get their own hue (Fruit and veg, and the "Protein"/"Carbs" pairings below);
   any more than that stops being tellable apart at a glance (checked with the
   data-viz palette validator, all-pairs, both colour schemes). Dairy stays the
   plain neutral chip it always was; "watch" reuses the app's existing warm
   accent, since that is a status signal, not a new identity colour. */
const NUTRI_GROUP = {
  'Protein': 'protein', 'Good fats': 'protein',
  'Fibre': 'carb', 'Wholegrain': 'carb', 'Starchy carbs': 'carb',
  'Fruit and veg': 'veg',
  'Dairy': 'dairy',
  'High sugar': 'watch', 'High fat': 'watch', 'High sat fat': 'watch'
};
const NUTRI_GROUP_ORDER = ['veg', 'protein', 'carb', 'dairy', 'watch'];
const NUTRI_GROUP_LABEL = { veg: 'Fruit and veg', protein: 'Protein and good fats', carb: 'Carbs and fibre', dairy: 'Dairy', watch: 'Worth a look' };

/* Per day: how many tagged foods fall in each colour group (a food with several
   tags in the same group, e.g. Fibre and Wholegrain, only counts once there,
   same as the on-screen chip row it matches) */
function nutriGroupCounts(dayNutris) {
  const counts = { veg: 0, protein: 0, carb: 0, dairy: 0, watch: 0 };
  dayNutris.filter(Boolean).forEach((n) => {
    const groups = new Set(n.tags.map((t) => NUTRI_GROUP[t]));
    groups.forEach((g) => { counts[g]++; });
  });
  return counts;
}

/* The conic-gradient stops for the donut chart, in NUTRI_GROUP_ORDER, skipping
   empty groups; var(--nutri-*) so it stays on the design tokens like everything
   else, computed inline only because the split itself is real per-day data. */
function donutGradient(counts) {
  const total = NUTRI_GROUP_ORDER.reduce((s, g) => s + counts[g], 0);
  if (!total) return null;
  const colorVar = { veg: '--nutri-veg', protein: '--nutri-protein', carb: '--nutri-carb', dairy: '--text-muted', watch: '--warm' };
  let at = 0;
  const stops = [];
  NUTRI_GROUP_ORDER.forEach((g) => {
    if (!counts[g]) return;
    const from = at, to = at + (counts[g] / total) * 100;
    stops.push(`var(${colorVar[g]}) ${from}% ${to}%`);
    at = to;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

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

/* ---- Stage 2: optional calorie and macro estimates ----
   Gated throughout on profile/main.detailedNutrition (account-wide, the
   same shared document the exercise goals already live in). Off by
   default: nothing below runs, nothing is stored, and the app looks
   exactly as it did before this was added.

   Portion sizes are "typical portion, estimate" grams, Small/Medium/Large,
   chosen per CoFID group. A few groups do not map cleanly onto the
   requested categories, so the nearest is used: herbs and spices (group H)
   as Fats, oils and spreads; soft drinks, coffee and juice concentrate
   (group P) and alcoholic drinks (group Q) as Milk and milk-based drinks;
   a hand-added food with no CoFID group at all (today, only the whey
   protein powder in ADDED_FOODS) as Anything else. */

/* How much of the served portion was actually eaten, from the existing
   "how much" answer already collected on every food entry */
const FOOD_AMOUNT_SCALE = { 'A few mouthfuls': 0.25, 'About half': 0.5, 'Most of it': 0.75, 'All of it': 1 };
function amountScale(amount) { return FOOD_AMOUNT_SCALE[amount] != null ? FOOD_AMOUNT_SCALE[amount] : 0.5; }

/* Small / Medium / Large grams for a matched CoFID (or ADDED_FOODS) row, by food group */
function portionGroupFor(food) {
  const g = (food && food.g) || '', n = ((food && food.n) || '').toLowerCase();
  if (/^(AF|AG)/.test(g)) return { label: 'Bread and rolls', sizes: [36, 72, 108] };
  if (/^(AC|AD|AT)/.test(g) || /^DA/.test(g)) return { label: 'Rice, pasta, potatoes and other starchy, cooked weight', sizes: [120, 180, 250] };
  if (/^(AM|AN|AO|AP|AS)/.test(g)) return { label: 'Cakes, biscuits, confectionery and snacks', sizes: [30, 50, 80] };
  if (/^S/.test(g)) {
    return /sugar|jam|honey|preserve|marmalade|treacle|syrup/.test(n)
      ? { label: 'Sugars and preserves', sizes: [10, 20, 30] }
      : { label: 'Cakes, biscuits, confectionery and snacks', sizes: [30, 50, 80] };
  }
  if (/^A/.test(g)) return { label: 'Cereals and breakfast cereals', sizes: [30, 45, 60] };
  if (/^M/.test(g)) return { label: 'Meat, poultry and meat products', sizes: [80, 120, 180] };
  if (/^J/.test(g)) return { label: 'Fish and fish products', sizes: [80, 120, 170] };
  if (/^C/.test(g)) return { label: 'Eggs and egg dishes', sizes: [50, 100, 150] };
  if (/^BL/.test(g) || (/^B/.test(g) && /cheese/.test(n))) return { label: 'Cheese', sizes: [25, 40, 60] };
  if (/^(BN|BP|BR)/.test(g)) return { label: 'Yoghurt and dairy desserts', sizes: [100, 150, 200] };
  if (/^B/.test(g)) return { label: 'Milk and milk-based drinks', sizes: [150, 250, 400] };
  if (/^D/.test(g)) return { label: 'Vegetables and vegetable dishes', sizes: [50, 80, 120] };
  if (/^F/.test(g)) return { label: 'Fruit', sizes: [80, 120, 180] };
  if (/^G/.test(g)) return { label: 'Nuts and seeds', sizes: [25, 40, 50] };
  if (/^O/.test(g)) return { label: 'Fats, oils and spreads', sizes: [5, 10, 15] };
  if (/^H/.test(g)) return { label: 'Fats, oils and spreads (nearest match, herbs and spices)', sizes: [5, 10, 15] };
  if (/^WA/.test(g)) return { label: 'Soup', sizes: [200, 300, 400] };
  if (/^W/.test(g)) return { label: 'Sauces, gravies and dressings', sizes: [30, 50, 80] };
  if (/^[PQ]/.test(g)) return { label: 'Milk and milk-based drinks (nearest match, other drinks)', sizes: [150, 250, 400] };
  return { label: 'Anything else', sizes: [60, 120, 200] };
}
const PORTION_SIZE_INDEX = { S: 0, M: 1, L: 2 };
const PORTION_SIZE_NAME = { S: 'Small', M: 'Medium', L: 'Large' };

/* Grams for one component: its own group's Small/Medium/Large default, times how much of the meal was actually eaten */
function portionGrams(food, size, scale, qty) {
  if (qty && qty.n > 0) return qty.unit === 'piece' ? Math.round(qty.n * (qty.each || 0)) : Math.round(qty.n);
  const group = food ? portionGroupFor(food) : { label: 'Anything else', sizes: [60, 120, 200] };
  return Math.round(group.sizes[PORTION_SIZE_INDEX[size] ?? 1] * scale);
}

/* A component is either a matched CoFID/ADDED_FOODS row (its own food code) or
   an unmatched typed phrase (nothing else identifies it), so portions and
   manual overrides are keyed on whichever of those applies to it */
function macroComponentKey(food, phrase) { return food ? 'c:' + food.c : 'u:' + phrase; }

/* Typical weight of one piece, for foods people count rather than weigh: [grams each, one, many].
   Anything under 5 g a piece (nuts, grapes, berries) is weighed in grams instead, with quick chips.
   Estimates, not measurements. Multi-word keys are tried first. */
const PIECE_WEIGHTS = {
  'cherry tomato': [15, 'cherry tomato', 'cherry tomatoes'], 'new potato': [40, 'new potato', 'new potatoes'], 'fish finger': [28, 'fish finger', 'fish fingers'],
  'jaffa cake': [12, 'jaffa cake', 'jaffa cakes'], 'rich tea': [8, 'rich tea biscuit', 'rich tea biscuits'], 'rice cake': [9, 'rice cake', 'rice cakes'],
  'sausage roll': [60, 'sausage roll', 'sausage rolls'], 'pork pie': [140, 'pork pie', 'pork pies'], 'spring roll': [40, 'spring roll', 'spring rolls'],
  'chicken breast': [150, 'chicken breast', 'chicken breasts'], 'chicken thigh': [90, 'chicken thigh', 'chicken thighs'], 'fish cake': [90, 'fish cake', 'fish cakes'],
  'shredded wheat': [22, 'shredded wheat', 'shredded wheat'], 'ice cream': [60, 'scoop of ice cream', 'scoops of ice cream'], 'cheese slice': [25, 'slice of cheese', 'slices of cheese'],
  kiwi: [75, 'kiwi', 'kiwis'], banana: [120, 'banana', 'bananas'], apple: [150, 'apple', 'apples'], pear: [160, 'pear', 'pears'], orange: [160, 'orange', 'oranges'],
  satsuma: [70, 'satsuma', 'satsumas'], clementine: [70, 'clementine', 'clementines'], tangerine: [70, 'tangerine', 'tangerines'], mandarin: [70, 'mandarin', 'mandarins'],
  plum: [55, 'plum', 'plums'], peach: [150, 'peach', 'peaches'], nectarine: [140, 'nectarine', 'nectarines'], apricot: [40, 'apricot', 'apricots'],
  strawberry: [12, 'strawberry', 'strawberries'], cherry: [8, 'cherry', 'cherries'], date: [24, 'date', 'dates'], prune: [10, 'prune', 'prunes'], fig: [50, 'fig', 'figs'],
  grape: [5, 'grape', 'grapes'], raspberry: [4, 'raspberry', 'raspberries'], blueberry: [1.5, 'blueberry', 'blueberries'],
  egg: [50, 'egg', 'eggs'], toast: [36, 'slice of toast', 'slices of toast'], bread: [36, 'slice of bread', 'slices of bread'], crumpet: [40, 'crumpet', 'crumpets'],
  muffin: [60, 'muffin', 'muffins'], scone: [50, 'scone', 'scones'], cracker: [8, 'cracker', 'crackers'], biscuit: [12, 'biscuit', 'biscuits'], digestive: [15, 'digestive', 'digestives'],
  hobnob: [15, 'hobnob', 'hobnobs'], oatcake: [10, 'oatcake', 'oatcakes'], pitta: [60, 'pitta', 'pittas'], tortilla: [40, 'tortilla', 'tortillas'], wrap: [60, 'wrap', 'wraps'],
  roll: [60, 'roll', 'rolls'], bagel: [85, 'bagel', 'bagels'], croissant: [60, 'croissant', 'croissants'], pancake: [40, 'pancake', 'pancakes'], waffle: [35, 'waffle', 'waffles'],
  weetabix: [19, 'weetabix', 'weetabix'], sausage: [50, 'sausage', 'sausages'], bacon: [25, 'rasher of bacon', 'rashers of bacon'], nugget: [18, 'nugget', 'nuggets'],
  burger: [100, 'burger', 'burgers'], samosa: [60, 'samosa', 'samosas'], potato: [175, 'potato', 'potatoes'], tomato: [85, 'tomato', 'tomatoes'], carrot: [60, 'carrot', 'carrots'],
  yoghurt: [125, 'pot of yoghurt', 'pots of yoghurt'], yogurt: [125, 'pot of yogurt', 'pots of yogurt'], ham: [25, 'slice of ham', 'slices of ham'], crisps: [25, 'packet of crisps', 'packets of crisps'],
  almond: [1.2, 'almond', 'almonds'], walnut: [3, 'walnut', 'walnuts'], brazil: [5, 'brazil nut', 'brazil nuts'], cashew: [1.5, 'cashew', 'cashews'], peanut: [0.7, 'peanut', 'peanuts'],
  hazelnut: [1.3, 'hazelnut', 'hazelnuts'], pecan: [2, 'pecan', 'pecans'], pistachio: [0.7, 'pistachio', 'pistachios'], nut: [1.5, 'nut', 'nuts']
};
const PIECE_KEYS = Object.keys(PIECE_WEIGHTS).sort((a, b) => b.length - a.length);
const singular = (w) => w.replace(/ies$/, 'y').replace(/(ch|sh|s|x|z)es$/, '$1').replace(/oes$/, 'o').replace(/s$/, '');
/* The piece entry for a component, from the words typed only: the table food's own name would
   turn "Soup" (matched to "Soup, carrot and orange") into an orange */
function pieceInfo(phrase, food) {
  const texts = [phrase].filter(Boolean).map((t) => ' ' + t.toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean).map(singular).join(' ') + ' ');
  for (const t of texts) for (const k of PIECE_KEYS) if (t.includes(' ' + k.split(' ').map(singular).join(' ') + ' ')) { const [each, one, many] = PIECE_WEIGHTS[k]; return { key: k, each, one, many, tiny: each < 5 }; }
  return null;
}
/* What a component's quantity control should be before anyone touches it: pieces, grams, or the S/M/L sizes */
function defaultQty(phrase, food, text) {
  const p = pieceInfo(phrase, food);
  if (!p) return null;
  if (p.tiny) return { unit: 'g', n: 30, name: p.many };
  return { unit: 'piece', n: countInText(text || '', p.key) || 1, each: p.each, name: p.one, many: p.many };
}
/* "two eggs, wholemeal toast" -> 2 for the egg key; nothing found -> null */
function countInText(text, key) {
  const t = String(text || '').toLowerCase();
  const re = /(\d+(?:[.,]\d+)?|½|half an?|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x|×)?\s+([a-z][a-z ]{0,30})/g;
  let m;
  while ((m = re.exec(t))) {
    const words = m[2].trim().split(' ').map(singular);
    for (let i = 1; i <= Math.min(3, words.length); i++) { if (words.slice(0, i).join(' ') === key.split(' ').map(singular).join(' ')) { const w = m[1].replace(/^half an?$/, 'half'); const n = WORD_NUMBERS[w] != null ? WORD_NUMBERS[w] : parseFloat(w.replace(',', '.')); if (n > 0) return n; } }
  }
  return null;
}
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, '½': 0.5 };
/* "2 x kiwi", "2 kiwis", "kiwi x2", "two eggs", "half a banana" -> { name: "Kiwi", count: 2 }; anything else -> { name, count: null } */
function parseQuantityName(text) {
  let t = String(text || '').trim().replace(/\s+/g, ' ');
  let count = null;
  let m = t.match(/^(\d+(?:[.,]\d+)?|½|half an?|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x|×)?\s+(.+)$/i);
  if (m) { const w = m[1].toLowerCase().replace(/^half an?$/, 'half'); count = WORD_NUMBERS[w] != null ? WORD_NUMBERS[w] : parseFloat(w.replace(',', '.')); t = m[2]; }
  else if ((m = t.match(/^(.+?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)$/i))) { count = parseFloat(m[2].replace(',', '.')); t = m[1]; }
  if (count != null) {
    t = t.replace(/^(?:slices?|pieces?|rashers?|pots?|packets?|scoops?|bowls?|cups?) of /i, '');
    const words = t.split(' ');
    const last = words[words.length - 1];
    if (PIECE_WEIGHTS[singular(last.toLowerCase())] && !PIECE_WEIGHTS[last.toLowerCase()]) words[words.length - 1] = singular(last);
    t = words.join(' ');
  }
  t = t.trim();
  return { name: t ? t[0].toUpperCase() + t.slice(1) : '', count: count && count > 0 ? count : null };
}
const fmtQtyNumber = (n) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');
/* "2 kiwis · 30 g almonds" from an entry's stored quantities, for the timeline, the diary and the PDF */
function quantityText(entry) {
  const portions = entry && entry.portions;
  if (!portions) return '';
  return Object.values(portions).map((p) => p && p.qty).filter((q) => q && q.n > 0)
    .map((q) => q.unit === 'piece' ? `${fmtQtyNumber(q.n)} ${q.n === 1 ? q.name : (q.many || q.name)}` : `${fmtQtyNumber(q.n)} g ${q.name || ''}`.trim())
    .join(' · ');
}

function scaleMacro(per100, grams) {
  const f = (grams || 0) / 100;
  return { kcal: (per100.kcal || 0) * f, prot: (per100.prot || 0) * f, carb: (per100.carb || 0) * f, fat: (per100.fat || 0) * f };
}

/* Foods added by hand from a packet, kept in profile/main.customFoods (name
   plus per 100 g values), matched next time by the same name that was
   typed. Kept separate from ADDED_FOODS (scripts.js, code-only, curated)
   and from the CoFID matching used for tags: this is a personal shortcut
   for macros only, and never earns nutrition tags of its own. */
function customFoodByName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const list = (state.profile && state.profile.customFoods) || [];
  return list.find((f) => (f.name || '').trim().toLowerCase() === key) || null;
}

function saveCustomFood(name, per100) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return Promise.resolve();
  const entry = {
    name: name.trim(),
    kcal: Math.round((per100.kcal || 0) * 10) / 10,
    prot: Math.round((per100.prot || 0) * 10) / 10,
    carb: Math.round((per100.carb || 0) * 10) / 10,
    fat: Math.round((per100.fat || 0) * 10) / 10,
    addedBy: state.name
  };
  const current = ((state.profile && state.profile.customFoods) || []).slice();
  const i = current.findIndex((f) => (f.name || '').trim().toLowerCase() === key);
  if (i >= 0) current[i] = entry; else current.push(entry);
  if (state.demo) { state.profile = { ...state.profile, customFoods: current }; return Promise.resolve(); }
  return setDoc(doc(db, 'profile', 'main'), { customFoods: current }, { merge: true }).catch((e) => { console.error(e); toast('Could not save to My foods'); });
}

/* Macro figures for one component: a manual "from the packet" override
   always wins, then a saved custom food matched by name, then the CoFID or
   ADDED_FOODS row itself; null (excluded, counted separately) only when
   none of those have anything to go on. */
function componentMacros(phrase, food, portion, scale) {
  const size = (portion && portion.size) || 'M';
  const grams = portionGrams(food, size, scale, portion && portion.qty);
  if (portion && portion.override) {
    const ov = portion.override;
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const vals = { kcal: num(ov.kcal), prot: num(ov.prot), carb: num(ov.carb), fat: num(ov.fat) };
    if (vals.kcal == null && vals.prot == null && vals.carb == null && vals.fat == null) return null;
    const z = (v) => v || 0;
    const per100 = { kcal: z(vals.kcal), prot: z(vals.prot), carb: z(vals.carb), fat: z(vals.fat) };
    if (ov.per === '100g') return scaleMacro(per100, num(ov.grams) || grams);
    return per100; // stated per portion: already the totals for what was actually eaten
  }
  const custom = customFoodByName(phrase);
  if (custom) return scaleMacro({ kcal: custom.kcal || 0, prot: custom.prot || 0, carb: custom.carb || 0, fat: custom.fat || 0 }, grams);
  if (food) return scaleMacro({ kcal: food.kcal || 0, prot: food.prot || 0, carb: food.carb || 0, fat: food.fat || 0 }, grams);
  return null;
}

/* The comma, "and", "with" and "on" separated pieces of the text that matched
   nothing at all. The tag matcher joins the whole text into one phrase once
   commas are cleaned away, so one unknown ingredient beside known ones would
   otherwise vanish silently; for an estimate it has to be listed as not
   counted. Pieces the whole-text match already covered (a multi-word alias
   such as "toad in the hole") are left alone. */
function unmatchedChunks(index, text, matches) {
  const out = [];
  String(text || '').toLowerCase().split(/,|;|\/|&|\+|\s+(?:and|with|on|in|plus|or)\s+/).forEach((raw) => {
    const clean = foodClean(raw);
    if (!clean) return;
    const phrase = clean.split(' ').filter((w) => !FOOD_STOP.has(w) && !COOKING_WORDS.has(w) || ['peas', 'oats', 'beans', 'nuts', 'roast', 'whole'].includes(w)).join(' ').trim();
    if (!phrase || out.includes(phrase)) return;
    if (matches.some((m) => clean.includes(m.phrase) || m.phrase.includes(clean))) return;
    if (!matchFoodText(index, raw).matches.length) out.push(phrase);
  });
  return out;
}

/* Per entry: estimated totals from every component that has something to go
   on, plus which ones (matched or not) could not be counted. Sits beside
   entryNutrition() and reuses its same matches/unmatched, so the tag logic
   above is completely untouched by any of this. */
function entryMacros(index, entry) {
  const nutrition = entryNutrition(index, entry);
  const portions = entry.portions || {};
  const scale = amountScale(entry.amount);
  const totals = { kcal: 0, prot: 0, carb: 0, fat: 0 };
  const excluded = [];
  const components = [];
  const seen = new Set();
  const add = (food, phrase) => {
    const key = macroComponentKey(food, phrase);
    if (seen.has(key)) return;
    seen.add(key);
    components.push({ key, phrase, food });
  };
  nutrition.matches.forEach((m) => add(m.food, m.phrase));
  nutrition.unmatched.forEach((phrase) => add(null, phrase));
  unmatchedChunks(index, [entry.note, entry.detail].filter(Boolean).join(', '), nutrition.matches).forEach((phrase) => add(null, phrase));
  /* The same countable thing named twice ("scrambled egg on toast" plus "two eggs, wholemeal toast")
     is one component, not two: keep the first of each piece key, so nothing is counted double */
  const pieceSeen = new Set();
  const deduped = components.filter((c) => { const p = pieceInfo(c.phrase, c.food); if (!p) return true; if (pieceSeen.has(p.key)) return false; pieceSeen.add(p.key); return true; });
  components.length = 0; components.push(...deduped);
  let counted = 0;
  components.forEach((c) => {
    const macros = componentMacros(c.phrase, c.food, portions[c.key], scale);
    if (!macros) { excluded.push(c.phrase); return; }
    counted++;
    totals.kcal += macros.kcal; totals.prot += macros.prot; totals.carb += macros.carb; totals.fat += macros.fat;
  });
  return { any: counted > 0, totals, excluded, components };
}

/* "12 g protein, 24% of energy": the dietitian's per-meal percentage is protein grams times four over the calories */
function fmtMacroLine(totals) {
  const pct = totals.kcal > 0 ? Math.round((totals.prot * 4 / totals.kcal) * 100) : 0;
  return `${Math.round(totals.kcal)} kcal · ${Math.round(totals.prot)} g protein${pct ? ', ' + pct + '% of energy' : ''} · ${Math.round(totals.carb)} g carbs · ${Math.round(totals.fat)} g fat`;
}

/* The daily protein target from the dietitian, in grams (More > Settings > Food); 0 when none is set */
function proteinTarget() { const t = Number(state.profile && state.profile.proteinTarget); return t > 0 ? t : 0; }
function proteinTargetText(prot) {
  const t = proteinTarget();
  if (!t) return '';
  return prot >= t ? `protein target ${t} g met` : `protein ${Math.round(t - prot)} g under the ${t} g target`;
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
  const range = reportRange('food');
  const { from, to } = range;
  $('food-sub').textContent = reportRangeLabel('food', range);
  const loaded = await loadEntriesFrom(from);
  if (!loaded) return;
  const entries = loaded.filter((e) => e.day <= to);
  const index = await loadFoodTable();
  const macrosOn = detailedNutritionOn() && Boolean(index);
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
    /* Every day from the first logged one to the end of the range, so a day with nothing eaten still shows */
    for (let day = to; day >= logged[0]; day = addDays(day, -1)) {
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
      const groups = nutriGroupCounts(nutri);
      const gradient = donutGradient(groups);
      /* Estimated totals for the day and each entry, only with the Food setting on */
      const macros = macrosOn ? foods.map((e) => entryMacros(index, e)) : [];
      const dayLogged = loggedTotals(day);
      const dayTotal = dayLogged ? { totals: dayLogged, excluded: 0, logged: true } : (macrosOn ? dayMacros(foods) : null);
      const macroLine = dayTotal ? (dayTotal.logged ? (dayLogged.source === 'apple-health' ? 'From Apple Health ' : 'From your food app ') : 'Estimate ') + fmtMacroLine(dayTotal.totals) + (proteinTargetText(dayTotal.totals.prot) ? ' · ' + proteinTargetText(dayTotal.totals.prot) : '') + (dayTotal.excluded ? ` (${plural(dayTotal.excluded, 'item')} not counted)` : '') : '';
      const entryMacroText = (i) => (macros[i] && macros[i].any ? 'About ' + fmtMacroLine(macros[i].totals) : '');
      dayCount++;
      Object.keys(counts).forEach((t) => { daysWith[t] = (daysWith[t] || 0) + 1; });
      sections.push(h('section', { class: 'diary-day' },
        h('h3', { class: 'diary-title' }, fmtDayLong(day), h('small', { text: day === today ? 'Today' : fmtDayNum(day) })),
        h('p', { class: 'diary-sum', text: sum }),
        gradient ? h('div', { class: 'diary-donut-row' },
          h('div', { class: 'diary-donut', style: 'background: ' + gradient + ';', 'aria-hidden': 'true' }),
          h('div', { class: 'diary-legend' }, ...NUTRI_GROUP_ORDER.filter((g) => groups[g]).map((g) =>
            h('div', { class: 'row' }, h('span', { class: 'sw is-' + g }), NUTRI_GROUP_LABEL[g], h('span', { class: 'n', text: String(groups[g]) }))
          ))
        ) : null,
        tagLine ? h('p', { class: 'diary-tags', text: tagLine }) : null,
        macroLine ? h('p', { class: 'diary-macros', text: macroLine }) : null,
        foods.length ? h('ul', { class: 'timeline' }, ...foods.map((e, i) => diaryRow(e, nutri[i], entryMacroText(i)))) : null
      ));
      blocks.push({ kind: 'sub', text: `${fmtDayLong(day)} (${fmtDayNum(day)})` }, { kind: 'muted', text: sum + (tagLine ? ' · ' + tagLine : '') + (macroLine ? ' · ' + macroLine : '') });
      if (gradient) blocks.push({ kind: 'donut', groups });
      if (foods.length) blocks.push({ kind: 'table', head: ['What was eaten', 'Nutrition'], rows: foods.map((e, i) => [
        `${fmtTime(entryDate(e))}  ${e.note || 'Food'}${quantityText(e) ? ', ' + quantityText(e) : (e.amount ? ', ' + e.amount.toLowerCase() : '')}${e.detail ? ' (' + e.detail + ')' : ''}, by ${e.addedBy || 'unknown'}${entryMacroText(i) ? '. ' + entryMacroText(i) : ''}`,
        nutri[i] && nutri[i].tags.length ? nutri[i].tags.map((t) => ({ label: t, group: NUTRI_GROUP[t] })) : (nutri[i] && !nutri[i].matches.length ? 'Not in the food table' : '')
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
    blocks.unshift({ kind: 'muted', text: 'Days with: ' + FOOD_TAG_ORDER.map((t) => `${t} ${daysWith[t] || 0} of ${dayCount}`).join(' · ') + '. Tags follow UK food label rules per 100 g of each food named, from the McCance and Widdowson food table. Not portion sizes, not medical advice.' + (macrosOn ? ' Calorie and macro figures are estimates from typical portion sizes, scaled by how much was eaten, or entered from the packet.' : '') });
  } else { overview.hidden = true; overview.replaceChildren(); }
  $('food-days').replaceChildren(...sections);
  $('food-empty').hidden = sections.length > 0;
  state.foodPdf = { filename: 'care-log-food-diary-' + to + '.pdf', title: 'Food diary', subtitle: `${fmtDayNum(from)} to ${fmtDayNum(to)}, printed ${fmtDayNum(today)}`, blocks };
}

$('food-pdf').addEventListener('click', () => { if (state.foodPdf) savePdf(state.foodPdf.filename, state.foodPdf.title, state.foodPdf.subtitle, state.foodPdf.blocks); });

/* Day totals typed in from a food app, for anyone without the Apple Health feed (Android, or no phone link) */
$('food-totals').addEventListener('click', () => {
  const dayInput = h('input', { type: 'date', value: todayStr(), max: todayStr() });
  const num = (ph) => h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '1', placeholder: ph });
  const kcal = num('kcal'), prot = num('g'), carb = num('g'), fat = num('g');
  const fill = () => {
    const n = state.nutrition[dayInput.value];
    kcal.value = n && n.kcal ? String(Math.round(n.kcal)) : '';
    prot.value = n && n.prot ? String(Math.round(n.prot)) : '';
    carb.value = n && n.carb ? String(Math.round(n.carb)) : '';
    fat.value = n && n.fat ? String(Math.round(n.fat)) : '';
  };
  fill();
  dayInput.addEventListener('change', fill);
  const body = h('div', null,
    h('p', { class: 'hint', text: 'Copy the day\'s totals from MyFitnessPal, Nutracheck or whichever app you use. They replace the estimate for that day in the diary and in Notes for the team.' }),
    field('Day', dayInput),
    h('div', { class: 'field-row' }, field('Calories (kcal)', kcal), field('Protein (g)', prot)),
    h('div', { class: 'field-row' }, field('Carbs (g)', carb), field('Fat (g)', fat)),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const day = dayInput.value;
      const v = (i) => { const n = parseFloat(i.value); return isFinite(n) && n >= 0 ? Math.round(n) : 0; };
      const data = { day, kcal: v(kcal), prot: v(prot), carb: v(carb), fat: v(fat), source: 'manual', addedBy: state.name };
      if (!day || !data.kcal) { toast('Add at least the day\'s calories'); return; }
      closeSheet();
      if (state.demo) { state.nutrition[day] = data; renderFoodDiary(); toast('Day totals saved'); return; }
      try { await setDoc(doc(db, 'nutrition', day), { ...data, updatedAt: serverTimestamp() }, { merge: true }); toast('Day totals saved'); }
      catch (e) { console.error(e); toast('Could not save the totals'); }
    } }, 'Save'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Day totals from your food app', body);
});
$('food-preview').addEventListener('click', () => { if (state.foodPdf) previewPdf(state.foodPdf.title, state.foodPdf.subtitle, state.foodPdf.blocks); });

/* macroText is the entry's estimate line, or '' (the setting off, or nothing to go on) */
function diaryRow(e, nutri, macroText) {
  return h('li', { class: 'entry type-food' },
    h('span', { class: 'entry-time', text: fmtTime(entryDate(e)) }),
    h('div', { class: 'entry-main' },
      h('div', { class: 'entry-title', text: e.note || 'Food' }),
      h('div', { class: 'entry-sub', text: [quantityText(e) || e.amount, e.detail, 'by ' + (e.addedBy || 'unknown')].filter(Boolean).join(' · ') }),
      nutri && nutri.tags.length ? h('div', { class: 'tags' }, ...nutri.tags.map((t) => h('span', { class: 'tag is-' + NUTRI_GROUP[t], text: t }))) : null,
      macroText ? h('div', { class: 'macros', text: macroText }) : null,
      nutri && !nutri.matches.length ? h('div', { class: 'unmatched', text: 'Not in the food table yet' })
        : nutri && nutri.unmatched.length ? h('div', { class: 'unmatched', text: 'Not recognised: ' + nutri.unmatched.join(', ') }) : null
    ),
    state.readOnly ? null : h('button', { class: 'entry-menu', type: 'button', 'aria-label': 'Entry options', onclick: () => entryOptions(e) }, '⋯')
  );
}

/* ------------------------------------------------------------------ */
/* Notes for the team: every note collated by day, with mood, readings   */
/* and when-needed doses for context, plus simple checks on the vitals.  */
/* Sent to the person's AI app to be turned into questions for the oncologist/nurse.  */
/* ------------------------------------------------------------------ */

const NOTES_PROMPT = 'Please turn these care notes into a short, clear list of questions to ask my oncologist or specialist nurse at the next appointment. ' +
  'Group them by topic, put the most important first, and keep the wording plain. ' +
  'If anything here looks like it should be checked before the next appointment, say so clearly at the top. ' +
  'The "worth mentioning" items are simple threshold checks made by the app, not a diagnosis.';

$('notes-back').addEventListener('click', () => showTab(state.reportReturn || 'vitals'));
$('notes-print').addEventListener('click', () => window.print());
/* The range buttons (presets and Custom) are wired by wireReportRange('notes', ...) with the Food diary's */

$('notes-share').addEventListener('click', async () => {
  const text = state.notesText;
  if (!text) return;
  if (!navigator.share) {
    await copyText(text);
    toast('Sharing is not available here. Copied instead.');
    return;
  }
  try {
    await navigator.share({ title: 'Daybook notes', text });
  } catch (e) {
    if (e && e.name !== 'AbortError') { await copyText(text); toast('Could not share. Copied instead.'); }
  }
});

/* Suggest questions to ask: the notes go to the bridge, the reply comes back as a numbered list,
   and each line can be added to Questions for the team with one tap (a question entry, like
   typing it in). Nothing is added without that tap. */
$('notes-explain').addEventListener('click', async () => {
  if (!state.notesText || !explainAvailable()) return;
  const btn = $('notes-explain');
  const prompt = NOTES_PROMPT + '\n\n';
  const text = state.notesText.indexOf(prompt) >= 0 ? state.notesText.replace(prompt, '') : state.notesText;
  try {
    const reply = await withBusy(btn, 'Thinking, about half a minute', () => bridgeExplain({ kind: 'notes', text }));
    openSuggestedQuestions(reply.text);
  } catch (e) { console.warn(e); toast(e.message || 'Could not suggest questions'); }
});
function parseNumberedList(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line) => {
    const m = /^\s*(?:\d+[.)]|[-*\u2022])\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  });
  return out;
}
function openSuggestedQuestions(text) {
  const questions = parseNumberedList(text);
  const body = h('div', null, h('p', { class: 'hint', text: questions.length ? 'Suggested from your notes. Tap Add to put one on your list for the team; change the wording afterwards if you like.' : 'The reply did not come back as a list, so here it is as written.' }));
  if (!questions.length) body.append(h('p', { class: 'suggest-raw', text: text }));
  const list = h('div', { class: 'suggested' });
  questions.forEach((q) => {
    const add = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Add');
    const row = h('div', { class: 'suggest-row' }, h('p', { class: 'suggest-text', text: q }), add);
    add.addEventListener('click', async () => {
      add.disabled = true;
      await addEntry({ type: 'question', note: q, answered: false, at: new Date() });
      add.replaceChildren(icon('check'), ' Added');
      add.classList.add('is-added');
    });
    list.append(row);
  });
  body.append(list, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: async () => { await copyText(text); toast('Copied'); } }, 'Copy the list'),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { closeSheet(); renderNotesReport(); } }, 'Done'));
  openSheet('Questions to ask', body, () => { renderNotesReport(); });
}

$('notes-copy').addEventListener('click', async () => {
  if (!state.notesText) return;
  await copyText(state.notesText);
  toast('Copied. Paste it into your AI app.');
});

$('notes-pdf').addEventListener('click', () => { if (state.notesPdf) savePdf(state.notesPdf.filename, state.notesPdf.title, state.notesPdf.subtitle, state.notesPdf.blocks); });
$('notes-preview').addEventListener('click', () => { if (state.notesPdf) previewPdf(state.notesPdf.title, state.notesPdf.subtitle, state.notesPdf.blocks); });

/* The PDF is for people (the clinic, the folder), so it carries the report without the request to the AI app */
function notesPdfBlocks(report) {
  const blocks = [{ kind: 'heading', text: 'Questions for the team' }];
  if (report.questions.length) report.questions.forEach((q, i) => blocks.push({ kind: 'question', n: i + 1, text: q.text, who: q.who, day: q.day }));
  else blocks.push({ kind: 'muted', text: 'No open questions.' });
  if (report.answers.length) {
    blocks.push({ kind: 'sub', text: 'Answered' });
    report.answers.forEach((a) => {
      blocks.push({ kind: 'text', text: `Q${a.n}. ${a.text} (${a.who}, asked ${fmtDayShort(a.day)}, answered ${fmtDayShort(a.answeredDay)})` });
      if (a.answerText) blocks.push({ kind: 'text', text: 'Answer: ' + a.answerText });
      if (a.recordings) blocks.push({ kind: 'muted', text: plural(a.recordings, 'recording') + ' saved in Daybook.' });
    });
  }
  if (report.answered) blocks.push({ kind: 'muted', text: `${plural(report.answered, 'question')} marked answered in this period.` });
  blocks.push({ kind: 'heading', text: 'Summary' }, { kind: 'muted', text: report.rangeLabel + '. Simple checks on the readings made by the app, not medical advice. The detail for any one day is in the app.' });
  if (report.glance.length) report.glance.forEach((g) => blocks.push({ kind: 'flag', level: g.level, text: g.text }));
  else blocks.push({ kind: 'text', text: 'No readings logged in this period.' });
  blocks.push({ kind: 'heading', text: 'Letters and documents' });
  if (report.docs.length) report.docs.forEach((d) => {
    blocks.push({ kind: 'sub', text: `${fmtDayNum(d.docDate)} · ${d.title}${d.category === 'chemo' ? ' (treatment plan)' : ''}` });
    blocks.push({ kind: 'text', text: excerpt(docSummary(d), 400) || 'No explanation saved yet.' });
  });
  else blocks.push({ kind: 'text', text: 'None saved for this period.' });
  blocks.push({ kind: 'heading', text: 'Notes' });
  if (report.days.length) report.days.forEach((d) => {
    blocks.push({ kind: 'sub', text: `${fmtDayLong(d.day)} (${fmtDayNum(d.day)})` });
    d.notes.forEach((n) => blocks.push({ kind: 'note', who: n.who, time: n.time, context: n.context, text: n.text }));
  });
  else blocks.push({ kind: 'text', text: 'No written notes in this period.' });
  return blocks;
}

function excerpt(text, max) {
  const t = (text || '').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}
function listDays(days) { return days.map(fmtDayShort).join(', '); }
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

/* The four levels the report uses, on screen (pill and bar colours), in the
   PDF and in the text: red is worth checking, amber worth mentioning, teal is
   context, green is fine. */
const LEVEL_WORD = { red: 'Check', amber: 'Mention', teal: 'Context', green: 'Fine' };
const LEVEL_RANK = { red: 0, amber: 1, teal: 2, green: 3 };

/* The period summarised in a few plain sentences, worst first. Only topics
   worth checking or mentioning get a line of their own, with a trend where
   the period is long enough to compare its second half with its first; the
   topics with nothing of concern share one line, and the when-needed
   medicines share another. Thresholds are unchanged from the old flag list
   (temp 37.5/38.0, heart rate 100/120 or 50 and under, BP 140/90 and
   160/100 or systolic 90 and under, oxygen 93/90 and under, pain 5/7,
   sickness 6, appetite and energy 3 and under, short nights under 5 h,
   weight down 2 kg (red at 4), days under 1 L, days with nothing eaten,
   low-mood days, when-needed medicine use). */
function summaryRows(entries, from, to) {
  const rows = [];
  const fine = [];
  const once = [];
  const today = todayStr();
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  const when = (e) => fmtDayShort(e.day);
  /* An amber topic that happened once, with no worsening trend, is a one-off: those share a line at the end */
  const push = (level, topic, text, brief) => { if (level === 'amber' && brief) once.push({ topic, text, brief }); else rows.push({ level, topic, text }); };
  const daysWith = (pred) => Object.keys(byDay).filter((d) => byDay[d].some(pred)).length;
  const maxBy = (list, f) => list.reduce((a, b) => (f(b) > f(a) ? b : a));
  const minBy = (list, f) => list.reduce((a, b) => (f(b) < f(a) ? b : a));
  const avg = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const one = (n) => (Math.round(n * 10) / 10).toString();
  const mid = addDays(from, Math.floor(daysBetween(from, to) / 2));
  /* Second half of the period against the first, when both halves have enough scores */
  const trend = (scores, higherIsWorse) => {
    const a = scores.filter((s) => s.day <= mid).map((s) => s.v), b = scores.filter((s) => s.day > mid).map((s) => s.v);
    if (a.length < 3 || b.length < 3) return null;
    const d = avg(b) - avg(a);
    if (Math.abs(d) < 1) return { word: 'steady', a: avg(a), b: avg(b) };
    return { word: (higherIsWorse ? d > 0 : d < 0) ? 'worse' : 'better', a: avg(a), b: avg(b) };
  };

  const temps = entries.filter((e) => e.type === 'temp' && Number(e.value) > 0);
  if (temps.length) {
    const hi = maxBy(temps, (e) => Number(e.value));
    const tDays = daysWith((e) => e.type === 'temp');
    const highDays = daysWith((e) => e.type === 'temp' && Number(e.value) >= 38);
    const raisedDays = daysWith((e) => e.type === 'temp' && Number(e.value) >= 37.5);
    const peak = `peaking at ${Number(hi.value).toFixed(1)} °C on ${when(hi)}`;
    if (highDays) push('red', 'Temperature', `High temperature (38.0 or over) on ${plural(highDays, 'day')} of the ${tDays} with a reading, ${peak}.`);
    else if (raisedDays) push('amber', 'Temperature', `Temperature raised (37.5 to 37.9) on ${raisedDays} of the ${tDays} days with a reading, ${peak}, never reaching 38.0.`, raisedDays === 1 ? `temperature ${Number(hi.value).toFixed(1)} °C on ${when(hi)}` : null);
    else fine.push(`temperature (highest ${Number(hi.value).toFixed(1)} °C)`);
  }

  const hrs = entries.filter((e) => e.type === 'vitals' && Number(e.heartRate) > 0);
  if (hrs.length) {
    const hi = maxBy(hrs, (e) => Number(e.heartRate)), lo = minBy(hrs, (e) => Number(e.heartRate));
    const fast = hrs.filter((e) => e.heartRate >= 120).length, high = hrs.filter((e) => e.heartRate >= 100).length, slow = hrs.filter((e) => e.heartRate <= 50).length;
    const range = `readings ranged ${Math.round(lo.heartRate)} to ${Math.round(hi.heartRate)} bpm`;
    if (fast) push('red', 'Heart rate', `Heart rate 120 or over on ${plural(fast, 'reading')} of ${hrs.length}, highest ${Math.round(hi.heartRate)} on ${when(hi)}; ${range}.`);
    else if (high) push('amber', 'Heart rate', `Heart rate over 100 on ${plural(high, 'reading')} of ${hrs.length}, highest ${Math.round(hi.heartRate)} on ${when(hi)}; ${range}.`, high === 1 ? `heart rate ${Math.round(hi.heartRate)} bpm on ${when(hi)}` : null);
    else if (slow) push('amber', 'Heart rate', `Heart rate 50 or under on ${plural(slow, 'reading')} of ${hrs.length}, lowest ${Math.round(lo.heartRate)} on ${when(lo)}; ${range}.`, slow === 1 ? `heart rate ${Math.round(lo.heartRate)} bpm on ${when(lo)}` : null);
    else fine.push(`heart rate (${Math.round(lo.heartRate)} to ${Math.round(hi.heartRate)} bpm)`);
  }

  const bps = entries.filter((e) => e.type === 'vitals' && Number(e.systolic) > 0 && Number(e.diastolic) > 0);
  if (bps.length) {
    const bp = (e) => `${Math.round(e.systolic)}/${Math.round(e.diastolic)}`;
    const hi = maxBy(bps, (e) => Number(e.systolic)), lo = minBy(bps, (e) => Number(e.systolic));
    const range = `readings ranged ${bp(lo)} to ${bp(hi)}`;
    const red = bps.filter((e) => e.systolic >= 160 || e.diastolic >= 100);
    const amber = bps.filter((e) => e.systolic >= 140 || e.diastolic >= 90);
    const low = bps.filter((e) => e.systolic <= 90);
    /* The reading that crossed its line by the most, whichever number did the crossing */
    const worstOf = (list) => maxBy(list, (e) => Math.max(e.systolic - 140, (e.diastolic - 90) * 2));
    if (red.length) { const w = worstOf(red); push('red', 'Blood pressure', `Blood pressure ${bp(w)} on ${when(w)}${red.length > 1 ? ', and over the 160/100 line on ' + plural(red.length, 'reading') + ' in all' : ''}; ${range}.`); }
    else if (amber.length) { const w = worstOf(amber); push('amber', 'Blood pressure', `Blood pressure over the 140/90 line on ${plural(amber.length, 'reading')} of ${bps.length}, highest ${bp(w)} on ${when(w)}; ${range}.`, amber.length === 1 ? `blood pressure ${bp(w)} on ${when(w)}` : null); }
    else if (low.length) { const w = minBy(low, (e) => Number(e.systolic)); push('amber', 'Blood pressure', `Low blood pressure ${bp(w)} on ${when(w)}${low.length > 1 ? ' and on ' + (low.length - 1) + ' other ' + (low.length === 2 ? 'reading' : 'readings') : ''}; ${range}.`); }
    else fine.push(`blood pressure (${bp(lo)} to ${bp(hi)})`);
  }

  const oxs = entries.filter((e) => e.type === 'vitals' && Number(e.oxygen) > 0);
  if (oxs.length) {
    const lo = minBy(oxs, (e) => Number(e.oxygen));
    if (lo.oxygen <= 90) push('red', 'Oxygen', `Oxygen down to ${Math.round(lo.oxygen)}% on ${when(lo)} (${plural(oxs.length, 'reading')} in all).`);
    else if (lo.oxygen <= 93) push('amber', 'Oxygen', `Oxygen a little low, ${Math.round(lo.oxygen)}% on ${when(lo)} (${plural(oxs.length, 'reading')} in all).`, oxs.filter((e) => e.oxygen <= 93).length === 1 ? `oxygen ${Math.round(lo.oxygen)}% on ${when(lo)}` : null);
    else fine.push(`oxygen (lowest ${Math.round(lo.oxygen)}%)`);
  }

  const checkins = entries.filter(isPatientCheckin);
  const painScores = [];
  checkins.forEach((e) => { if (e.pain != null) painScores.push({ v: Number(e.pain), day: e.day }); if (e.worstPain != null) painScores.push({ v: Number(e.worstPain), day: e.day }); });
  entries.filter((e) => e.type === 'pain' && e.value != null).forEach((e) => painScores.push({ v: Number(e.value), day: e.day }));
  if (painScores.length) {
    const worst = maxBy(painScores, (s) => s.v);
    const highDays = new Set(painScores.filter((s) => s.v >= 5).map((s) => s.day)).size;
    const mean = avg(painScores.map((s) => s.v));
    const t = trend(painScores, true);
    if (worst.v >= 5) {
      let text = t && t.word === 'worse' ? `Pain has increased, from about ${one(t.a)}/10 in the first half of the period to ${one(t.b)}/10 in the second`
        : t && t.word === 'better' ? `Pain has eased, from about ${one(t.a)}/10 in the first half of the period to ${one(t.b)}/10 in the second`
        : `Pain about ${one(mean)}/10 through the period`;
      text += `; 5 or more on ${plural(highDays, 'day')}, worst ${worst.v}/10 on ${fmtDayShort(worst.day)}.`;
      push(worst.v >= 7 ? 'red' : 'amber', 'Pain', text);
    } else fine.push(`pain (about ${one(mean)}/10, worst ${worst.v}/10)`);
  }

  const evenings = checkins.filter((e) => e.slot === 'evening');
  const scale = (key, topic, bad, lowIsBad, phrases) => {
    const list = evenings.filter((e) => e[key] != null).map((e) => ({ v: Number(e[key]), day: e.day }));
    if (!list.length) return;
    const badOnes = list.filter((s) => (lowIsBad ? s.v <= bad : s.v >= bad));
    const mean = avg(list.map((s) => s.v));
    const t = trend(list, !lowIsBad);
    if (badOnes.length) {
      const worst = lowIsBad ? minBy(badOnes, (s) => s.v) : maxBy(badOnes, (s) => s.v);
      let text = `${phrases.bad} on ${badOnes.length} of ${plural(list.length, 'evening')}, ${lowIsBad ? 'lowest' : 'worst'} ${worst.v}/10 on ${fmtDayShort(worst.day)}`;
      if (t && t.word === 'worse') text += `, and ${phrases.worse} from about ${one(t.a)}/10 to ${one(t.b)}/10`;
      push('amber', topic, text + '.', badOnes.length === 1 && !(t && t.word === 'worse') ? `${topic.toLowerCase()} ${worst.v}/10 on ${fmtDayShort(worst.day)}` : null);
    } else if (t && t.word === 'worse') push('amber', topic, `${topic} ${phrases.worse} from about ${one(t.a)}/10 in the first half of the period to ${one(t.b)}/10 in the second.`);
    else fine.push(`${topic.toLowerCase()} (about ${one(mean)}/10)`);
  };
  scale('sickness', 'Sickness', 6, false, { bad: 'Sickness 6 or more', worse: 'getting worse' });
  scale('appetite', 'Appetite', 3, true, { bad: 'Little appetite (3 or under)', worse: 'has dropped' });
  scale('energy', 'Energy', 3, true, { bad: 'Energy very low (3 or under)', worse: 'has dropped' });

  const sleeps = entries.filter((e) => e.type === 'sleep' && Number(e.value) > 0);
  if (sleeps.length) {
    const mean = avg(sleeps.map((e) => Number(e.value)));
    const short = sleeps.filter((e) => Number(e.value) < 300);
    if (short.length) { const lo = minBy(short, (e) => Number(e.value)); push('amber', 'Sleep', `Short nights: under 5 hours on ${short.length} of ${plural(sleeps.length, 'night')}, shortest ${fmtHm(lo.value)} before ${when(lo)}; averaging ${fmtHm(mean)}.`, short.length === 1 ? `a short night (${fmtHm(lo.value)}) before ${when(lo)}` : null); }
    else fine.push(`sleep (${fmtHm(mean)} a night)`);
  }

  const weights = entries.filter((e) => e.type === 'weight' && Number(e.value) > 0).sort((a, b) => entryDate(a) - entryDate(b));
  if (weights.length >= 2) {
    const first = Number(weights[0].value), last = Number(weights[weights.length - 1].value), drop = first - last;
    if (drop >= 2) push(drop >= 4 ? 'red' : 'amber', 'Weight', `Weight down ${drop.toFixed(1)} kg, from ${first.toFixed(1)} kg on ${when(weights[0])} to ${last.toFixed(1)} kg on ${when(weights[weights.length - 1])}.`);
    else if (drop <= -2) fine.push(`weight (up ${(-drop).toFixed(1)} kg to ${last.toFixed(1)} kg)`);
    else fine.push(`weight (steady at about ${last.toFixed(1)} kg)`);
  } else if (weights.length === 1) fine.push(`weight (${Number(weights[0].value).toFixed(1)} kg, one reading)`);

  /* Intake: only days that were actually logged, and not today, which is still going */
  const loggedDays = Object.keys(byDay).filter((d) => d < today).sort();
  const drinkDays = loggedDays.filter((d) => byDay[d].some((e) => e.type === 'drink'));
  if (drinkDays.length) {
    const perDay = drinkDays.map((d) => byDay[d].filter((e) => e.type === 'drink').reduce((s, e) => s + (Number(e.value) || 0), 0));
    const low = perDay.filter((ml) => ml < 1000).length;
    const mean = fmtMl(Math.round(avg(perDay)));
    const lowDays = drinkDays.filter((d, i) => perDay[i] < 1000);
    if (low) push('amber', 'Drinks', `Under 1 litre of drinks on ${low} of the ${plural(drinkDays.length, 'logged day')}; averaging ${mean} a day.`, low === 1 ? `under 1 litre of drinks on ${fmtDayShort(lowDays[0])}` : null);
    else fine.push(`drinks (${mean} a day)`);
  }
  if (loggedDays.length) {
    const noFood = loggedDays.filter((d) => !byDay[d].some((e) => e.type === 'food') && !loggedTotals(d));
    /* Each eating day's totals: from the food app where logged, else the app's own estimate */
    const perDay = loggedDays.filter((d) => byDay[d].some((e) => e.type === 'food') || loggedTotals(d)).map((d) => {
      const l = loggedTotals(d);
      if (l) return { kcal: l.kcal, prot: l.prot, logged: true };
      const m = dayMacros(byDay[d].filter((e) => e.type === 'food'));
      return m ? { kcal: m.totals.kcal, prot: m.totals.prot, logged: false } : null;
    }).filter(Boolean);
    const macros = perDay.length > 0;
    const anyLogged = perDay.some((p) => p.logged);
    const est = macros ? `about ${Math.round(avg(perDay.map((p) => p.kcal)))} kcal and ${Math.round(avg(perDay.map((p) => p.prot)))} g protein a day${anyLogged ? (perDay.every((p) => p.logged) ? ' (from your food app)' : ' (from your food app where logged, estimated otherwise)') : ''}` : '';
    /* Against the dietitian's daily protein target, day by day, when one is set */
    const target = proteinTarget();
    let targetText = '', underDays = 0, targetDays = 0;
    if (macros && target) {
      targetDays = perDay.length;
      underDays = perDay.filter((p) => p.prot < target).length;
      targetText = `; against the ${target} g protein target, ${underDays ? 'under on ' + underDays + ' of ' + plural(targetDays, 'day') : 'met on every one of ' + plural(targetDays, 'day')}`;
    }
    if (noFood.length) push('amber', 'Eating', `Nothing eaten logged on ${plural(noFood.length, 'day')} of the ${loggedDays.length} logged (${listDays(noFood)})${est ? '; on the other days ' + est : ''}${targetText}.`, noFood.length === 1 && !underDays ? `nothing eaten logged on ${fmtDayShort(noFood[0])}` : null);
    else if (target && macros) push(underDays > targetDays / 2 ? 'amber' : 'green', 'Eating', `Eating: something every logged day, ${est}${targetText}.`);
    else fine.push(`eating (something every logged day${est ? ', ' + est : ''})`);
  }

  const moodDays = Object.keys(state.days).filter((d) => d >= from && d <= to && state.days[d].mood).sort();
  if (moodDays.length) {
    const low = moodDays.filter((d) => state.days[d].mood <= 2);
    if (low.length) push('amber', 'Mood', `Mood rough or low on ${plural(low.length, 'day')} of the ${moodDays.length} recorded: ${listDays(low)}.`, low.length === 1 ? `a low mood day on ${fmtDayShort(low[0])}` : null);
    else fine.push('mood');
  }

  if (once.length === 1) rows.push({ level: 'amber', topic: once[0].topic, text: once[0].text });
  else if (once.length > 1) rows.push({ level: 'amber', topic: 'One-offs', text: 'One-offs worth a mention: ' + once.map((o) => o.brief).join('; ') + '.' });

  if (fine.length) {
    const list = fine.length > 1 ? fine.slice(0, -1).join(', ') + ' and ' + fine[fine.length - 1] : fine[0];
    push('green', 'Nothing of concern', list.charAt(0).toUpperCase() + list.slice(1) + ': nothing of concern.');
  }

  const prn = [];
  let hitAny = false;
  activePrn().forEach((m) => {
    const perDay = {};
    entries.filter((e) => e.type === 'med' && e.medId === m.id).forEach((e) => { perDay[e.day] = (perDay[e.day] || 0) + 1; });
    const days = Object.keys(perDay);
    if (!days.length) return;
    const most = Math.max(...days.map((d) => perDay[d]));
    const hitMax = m.maxPerDay && most >= m.maxPerDay;
    if (hitMax) hitAny = true;
    prn.push(`${m.name} on ${days.length} of ${daysBetween(from, to) + 1} days${most > 1 ? ` (up to ${most} doses a day${hitMax ? ', the maximum' : ''})` : ''}`);
  });
  if (prn.length) push(hitAny ? 'amber' : 'teal', 'When-needed medicines', `When-needed medicines: ${prn.join('; ')}.`);

  return rows.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/* A document's explanation as the report shows it: the pasted "=== CARE LOG
   DOCUMENT ===" header (title and date lines) is dropped, the explanation itself kept */
function docSummary(d) {
  let t = (d.explanation || '').trim();
  if (/^=+\s*CARE LOG DOCUMENT/i.test(t)) { const i = t.indexOf('Explanation:'); if (i >= 0) t = t.slice(i + 'Explanation:'.length).trim(); }
  return t;
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

/* A day's estimated food totals when the Food setting is on and the table is
   loaded; null otherwise, so callers add nothing (used by the Food diary too) */
function dayMacros(foods) {
  if (!detailedNutritionOn() || !foodIndex || !foods.length) return null;
  const totals = { kcal: 0, prot: 0, carb: 0, fat: 0 };
  let any = false, excluded = 0;
  foods.forEach((e) => {
    const m = entryMacros(foodIndex, e);
    excluded += m.excluded.length;
    if (!m.any) return;
    any = true;
    totals.kcal += m.totals.kcal; totals.prot += m.totals.prot; totals.carb += m.totals.carb; totals.fat += m.totals.fat;
  });
  return any ? { totals, excluded } : null;
}

/* Only the check-in answers a clinician would want; wellbeing answers stay in the app */
const REPORT_CHECKIN_KEYS = [['symptoms', 'New or worse symptoms'], ['settled', 'Settled since yesterday']];
const REPORT_CARER_KEYS = [['noticed', 'What the carer noticed']];

/* Questions for the team: entries of type "question", open ones from any date
   (an unanswered question from before the range still needs asking) */
async function loadQuestions() {
  if (state.demo) return state.recentEntries.filter((e) => e.type === 'question');
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('type', '==', 'question')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); return []; }
}

/* from and to are the report's own range (inclusive), which need not end today */
function buildNotesReport(entries, questionsAll, from, to, rangeLabel) {
  const glance = summaryRows(entries, from, to);
  const open = questionsAll.filter((q) => !q.answered).sort((a, b) => entryDate(a) - entryDate(b));
  const questions = open.map((q) => ({ id: q.id, text: q.note, who: q.addedBy || 'unknown', day: q.day }));
  const answeredDayOf = (q) => (q.answeredAt && typeof q.answeredAt.toDate === 'function' ? dayStr(q.answeredAt.toDate()) : q.day);
  const answers = questionsAll.filter((q) => q.answered && (q.answerText || q.recordings) && answeredDayOf(q) >= from && answeredDayOf(q) <= to)
    .sort((a, b) => entryDate(a) - entryDate(b))
    .map((q) => ({ id: q.id, n: questionNumber(q.id), text: q.note, who: q.addedBy || 'unknown', day: q.day, answeredDay: answeredDayOf(q), answerText: q.answerText || '', recordings: q.recordings || 0 }));
  const answered = questionsAll.filter((q) => q.answered && !(q.answerText || q.recordings) && q.day >= from && q.day <= to).length;
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const list = (byDay[day] || []).slice().sort((a, b) => entryDate(a) - entryDate(b));
    const notes = list.filter((e) => e.type === 'note' || (e.note && ['temp', 'weight', 'vitals', 'med', 'pain'].includes(e.type)))
      .map((e) => ({ time: fmtTime(entryDate(e)), who: e.addedBy || 'unknown', text: e.note, context: e.type === 'note' ? '' : noteContext(e) }));
    list.filter((e) => e.type === 'checkin').forEach((e) => {
      const keys = e.slot === 'carer' ? REPORT_CARER_KEYS : REPORT_CHECKIN_KEYS;
      keys.forEach(([k, label]) => {
        if (e[k]) notes.push({ time: fmtTime(entryDate(e)), who: e.addedBy || 'unknown', text: label + ': ' + e[k], context: e.slot === 'carer' ? "carer's view" : e.slot + ' check-in' });
      });
    });
    notes.sort((a, b) => a.time.localeCompare(b.time));
    if (notes.length) days.push({ day, notes });
  }

  const docs = state.documents.filter((d) => d.category !== 'exemption' && d.docDate && d.docDate >= from && d.docDate <= to)
    .sort((a, b) => (a.docDate || '').localeCompare(b.docDate || ''));

  /* The range is the first line, so whoever reads it (an AI app included) knows the period before anything else */
  const lines = [`Daybook notes from ${fmtDayNum(from)} to ${fmtDayNum(to)}.`, '', NOTES_PROMPT, '', 'Questions for the team:'];
  if (questions.length) questions.forEach((q, i) => lines.push(`${i + 1}. ${q.text} (${q.who}, ${fmtDayShort(q.day)})`));
  else lines.push('- No open questions.');
  if (answers.length) {
    lines.push('', 'Answered:');
    answers.forEach((a) => {
      lines.push(`Q${a.n}. ${a.text} (${a.who}, asked ${fmtDayShort(a.day)}, answered ${fmtDayShort(a.answeredDay)})`);
      if (a.answerText) lines.push('Answer: ' + a.answerText);
      if (a.recordings) lines.push(plural(a.recordings, 'recording') + ' saved in Daybook.');
    });
  }
  lines.push('', 'Summary (simple checks by the app, not a diagnosis):');
  if (glance.length) glance.forEach((g) => lines.push(`- ${LEVEL_WORD[g.level]}: ${g.text}`));
  else lines.push('- No readings logged in this period.');
  lines.push('', 'Letters and documents in this period:');
  if (docs.length) docs.forEach((d) => {
    lines.push('', `${fmtDayNum(d.docDate)}: ${d.title}${d.category === 'chemo' ? ' (treatment plan)' : ''}`);
    lines.push(docSummary(d) || 'No explanation saved yet.');
  });
  else lines.push('- None saved for this period.');
  lines.push('', 'Notes (who wrote each one, then the note):');
  if (days.length) days.forEach((d) => {
    lines.push('', `${fmtDayLong(d.day)} (${fmtDayNum(d.day)})`);
    d.notes.forEach((n) => lines.push(`- ${n.who}, ${n.time}${n.context ? ' (' + n.context + ')' : ''}: ${n.text}`));
  });
  else lines.push('- No written notes in this period.');
  return { questions, answers, answered, glance, docs, days, rangeLabel, text: lines.join('\n') };
}

async function renderNotesReport() {
  const today = todayStr();
  const range = reportRange('notes');
  const { from, to } = range;
  const rangeLabel = reportRangeLabel('notes', range);
  $('notes-sub').textContent = rangeLabel;
  const [loaded, questionsAll] = await Promise.all([loadEntriesFrom(from), loadQuestions()]);
  if (!loaded) return;
  const entries = loaded.filter((e) => e.day <= to);
  if (detailedNutritionOn()) await loadFoodTable(); // so the Eating line can carry the food estimate
  const report = buildNotesReport(entries, questionsAll, from, to, rangeLabel);
  state.notesText = report.text;
  $('notes-explain').hidden = !explainAvailable();
  state.notesPdf = { filename: 'care-log-notes-' + to + '.pdf', title: 'Notes for the team', subtitle: `${fmtDayNum(from)} to ${fmtDayNum(to)}, printed ${fmtDayNum(today)}`, blocks: notesPdfBlocks(report) };

  $('notes-questions').replaceChildren(...report.questions.map((q, i) => h('div', { class: 'card question' },
    h('div', { class: 'question-text', text: `${i + 1}. ${q.text}` }),
    h('div', { class: 'docitem-sub', text: `${q.who} · ${fmtDayNum(q.day)}` }),
    state.readOnly ? null : h('div', { class: 'question-btns' },
      h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { const full = allQuestions().find((x) => x.id === q.id); if (full) openAnswerSheet(full); } }, 'Record or write the answer'),
      h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: async () => {
        await updateEntry(q.id, { answered: true });
        toast('Marked as answered', { label: 'Undo', onClick: async () => { await updateEntry(q.id, { answered: false }); renderNotesReport(); } });
        renderNotesReport();
      } }, 'Mark as answered'))
  )));
  report.answers.forEach((a) => $('notes-questions').append(h('div', { class: 'card question is-answered' },
    h('div', { class: 'question-text', text: `Q${a.n}. ${a.text}` }),
    h('div', { class: 'docitem-sub', text: `${a.who} · asked ${fmtDayNum(a.day)} · answered ${fmtDayNum(a.answeredDay)}` }),
    a.answerText ? h('p', { class: 'answer-text', text: a.answerText }) : null,
    a.recordings ? h('p', { class: 'muted', text: plural(a.recordings, 'recording') + ' saved in Daybook' }) : null,
    state.readOnly ? null : h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: () => { const full = allQuestions().find((x) => x.id === a.id); if (full) openAnswerSheet(full); } }, 'Open the answer')
  )));
  if (!report.questions.length) $('notes-questions').append(h('p', { class: 'muted', text: 'No open questions. Add one from Today with "Question for the team".' }));
  if (report.answered) $('notes-questions').append(h('p', { class: 'muted', text: `${plural(report.answered, 'question')} marked answered in this period.` }));

  $('notes-flags').replaceChildren(...report.glance.map((g) => h('div', { class: 'flag is-' + g.level },
    h('span', { class: 'pill pill-' + g.level, text: LEVEL_WORD[g.level] }),
    h('span', { class: 'flag-text', text: g.text })
  )));
  if (!report.glance.length) $('notes-flags').append(h('p', { class: 'muted', text: 'No readings logged in this period.' }));

  $('notes-docs').replaceChildren(...report.docs.map((d) => h('div', { class: 'card' },
    h('div', { class: 'docitem-title', text: d.title }),
    h('div', { class: 'docitem-sub', text: fmtDayNum(d.docDate) + (d.category === 'chemo' ? ' · Treatment plan' : '') }),
    h('p', { class: (docSummary(d) ? '' : 'muted'), text: excerpt(docSummary(d), 260) || 'No explanation saved yet.' }),
    h('button', { class: 'btn btn-link', type: 'button', onclick: () => { openDocs('notes'); openDocument(d.id); } }, 'Open the document')
  )));
  if (!report.docs.length) $('notes-docs').append(h('p', { class: 'muted', text: 'No letters or documents dated in this period.' }));

  const shown = report.days.slice().reverse();
  $('notes-days').replaceChildren(...shown.map((d) => h('section', { class: 'diary-day' },
    h('h3', { class: 'diary-title' }, fmtDayLong(d.day), h('small', { text: d.day === today ? 'Today' : fmtDayNum(d.day) })),
    h('ul', { class: 'timeline' }, ...d.notes.map((n) => h('li', { class: 'entry type-note' },
      h('span', { class: 'entry-time', text: n.time }),
      h('div', { class: 'entry-main' },
        h('div', { class: 'entry-sub' }, h('span', { class: 'note-who', text: n.who }), ' · ' + n.time + (n.context ? ' · ' + n.context : '')),
        h('div', { class: 'entry-title', text: n.text })
      )
    )))
  )));
  if (!report.days.length) $('notes-days').append(h('p', { class: 'muted', text: 'No written notes in this period.' }));
  $('notes-empty').hidden = true;
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
  ],
  /* The carer's view: the same scores from the outside, once a day, on the Chemo tab. Kept out of
     every patient statistic, chart and tile; shown only on the cycle chart (dashed) and, the text, in Notes for the team. */
  carer: [
    { key: 'energy', kind: 'slider', q: 'Energy today, as you see it', low: '1 wiped out', high: '10 plenty' },
    { key: 'sickness', kind: 'pain', q: 'Sickness today, as you see it', low: '1 none', high: '10 severe' },
    { key: 'appetite', kind: 'slider', q: 'Eating today, as you see it', low: '1 nothing', high: '10 normal' },
    { key: 'pain', kind: 'pain', q: 'Pain today, as you see it', low: '1 none', high: '10 worst' },
    { key: 'mood', kind: 'slider', q: 'Mood today, as you see it', low: '1 rough', high: '10 great' },
    { key: 'noticed', kind: 'text', q: 'What did you notice today?', ph: 'e.g. slept most of the afternoon, colour better than yesterday' }
  ]
};
const CHECKIN_LABELS = {
  sleep: 'Sleep', sleepHours: 'Hours slept', pain: 'Pain now', mood: 'Mood', symptoms: 'New or worse symptoms',
  lookingForward: 'Looking forward to', worstPain: 'Worst pain', sickness: 'Sickness', appetite: 'Appetite',
  energy: 'Energy', settled: 'Settled since yesterday', goodThing: 'One good thing', noticed: 'What you noticed'
};
/* A patient check-in, as opposed to the carer's view */
function isPatientCheckin(e) { return e.type === 'checkin' && e.slot !== 'carer'; }
function checkinTitle(slot) { return slot === 'carer' ? "Carer's view" : slotWord(slot) + ' check-in'; }
function checkinId(day, slot) { return day + '_' + slot; }
function findCheckin(day, slot) {
  const id = checkinId(day, slot);
  return state.dayEntries.find((e) => e.id === id) || state.recentEntries.find((e) => e.id === id) || null;
}
function dueSlot() { return new Date().getHours() < 15 ? 'morning' : 'evening'; }
function slotWord(slot) { return slot === 'morning' ? 'Morning' : slot === 'evening' ? 'Evening' : "Carer's view"; }

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
    row.disabled = state.readOnly;
    if (c) {
      row.classList.add('is-done');
      sub.replaceChildren(h('span', { class: 'checkin-done' }, icon('check'), 'Done ' + fmtTime(entryDate(c))), state.readOnly ? '' : ' · tap to change');
    } else if (isToday && dueSlot() === slot) { row.classList.add('is-due'); sub.textContent = state.readOnly ? 'Due now' : 'Due now, about a minute'; }
    else if (isToday && slot === 'morning') sub.textContent = state.readOnly ? 'Missed this morning' : 'Missed this morning, tap to fill in';
    else if (isToday) sub.textContent = 'Later today';
    else sub.textContent = state.readOnly ? 'Not filled in' : 'Not filled in, tap to add';
  });
  renderQuestionRow();
}
/* Open questions for the team: a live list, so the Today row can say how many are waiting */
function watchQuestions() {
  state.unsub.questions = onSnapshot(query(collection(db, 'entries'), where('type', '==', 'question')), (snap) => {
    state.questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCheckins();
  }, (e) => console.error(e));
}
function openQuestions() {
  const all = state.demo ? state.recentEntries.filter((e) => e.type === 'question') : (state.questions || []);
  return all.filter((q) => !q.answered);
}
function renderQuestionRow() {
  const row = $('question-now'), sub = $('question-sub');
  if (!row) return;
  const open = openQuestions();
  row.disabled = state.readOnly;
  sub.textContent = open.length
    ? `${open.length} waiting for the next appointment${state.readOnly ? '' : ', tap to add another'}`
    : (state.readOnly ? 'Nothing waiting' : 'Nothing waiting, tap to add one');
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
        wrap.append(h('p', { class: 'wiz-hint', text: 'Optional. Skip if there is nothing to say.' }), ta, speakButton(ta) || '');
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
  openSheet(checkinTitle(slot), body);
}

async function saveCheckin(slot, day, answers, existing) {
  const id = checkinId(day, slot);
  const today = todayStr();
  const at = existing ? entryDate(existing) : atFromInputs(day, day === today ? fmtTime(new Date()) : (slot === 'morning' ? '09:00' : slot === 'carer' ? '20:00' : '21:00'));
  const data = { type: 'checkin', slot, day, addedBy: state.name };
  CHECKIN_QUESTIONS[slot].forEach((q) => { data[q.key] = answers[q.key]; });
  if (slot === 'morning') data.sleepHours = answers.sleepHours;
  const mirror = {};
  if (slot !== 'carer' && data.mood != null) mirror.mood = Math.max(1, Math.min(5, Math.ceil(data.mood / 2)));
  if (slot === 'evening' && data.goodThing) mirror.good = data.goodThing;
  const label = checkinTitle(slot) + (existing ? ' updated' : ' saved');

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
    state.cycleFetched = 0;
    if (!$('view-chemo').hidden) renderChemo();
    toast(label);
  } catch (e) { console.error(e); toast('Could not save the check-in'); }
}

/* Extra pain readings during the day: ordinary timestamped entries, separate from the check-in scores */
$('question-now').addEventListener('click', () => openAdd('question'));


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
  const day = state.selectedDay;
  const sched = activeScheduled(day);
  const prn = activePrn();
  $('meds-scheduled').replaceChildren(...sched.map((m) => medCard(m, day)));
  if (!sched.length) $('meds-scheduled').append(h('p', { class: 'empty', 'data-art': 'pill', text: 'No scheduled medicines.' }));
  $('meds-prn').replaceChildren(...prn.map((m) => medCard(m, day)));
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

function medCard(m, day) {
  const isToday = day === todayStr();
  const count = countMedOnDay(m.id, day);
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
    status.append(dots, h('span', { class: 'med-last', text: `${Math.min(count, perDay)} of ${perDay}` + (isToday ? ' today' : '') }));
    if (count >= perDay) { card.classList.add('is-complete'); status.append(h('span', { class: 'pill pill-green', text: isToday ? 'Done for today' : 'All doses given' })); }
    if (m.courseEnd) status.append(h('span', { class: 'pill pill-teal', text: 'Course ends ' + fmtDayShort(m.courseEnd) }));
  } else {
    if (isToday) {
      const s = prnStatus(m);
      status.append(h('span', { class: 'pill pill-' + s.level, text: s.text }));
    }
    if (m.maxPerDay) status.append(h('span', { class: 'med-last', text: `${count} of ${m.maxPerDay}` + (isToday ? ' today' : '') }));
  }
  card.append(status);

  /* Every dose given that day, as tappable chips (tap one to see or delete it) */
  const dayEntriesSrc = day >= (state.recentFrom || '') ? state.recentEntries : state.dayEntries;
  const doses = dayEntriesSrc.filter((e) => e.type === 'med' && e.medId === m.id && e.day === day).sort((a, b) => entryDate(a) - entryDate(b));
  if (doses.length) {
    card.append(h('div', { class: 'med-times' },
      h('span', { class: 'med-times-label', text: isToday ? 'Today' : fmtDayShort(day) }),
      ...doses.map((e) => (state.viewer || state.readOnly)
        ? h('span', { class: 'med-time med-time-view', text: fmtTime(entryDate(e)) + ' · ' + (e.addedBy || '') })
        : h('button', { class: 'med-time', type: 'button', 'aria-label': `Dose at ${fmtTime(entryDate(e))}, tap for options`, onclick: () => entryOptions(e) },
          fmtTime(entryDate(e)) + ' · ' + (e.addedBy || '')))
    ));
  } else if (isToday && last) {
    status.append(h('span', { class: 'med-last', text: 'Last ' + fmtDayShort(last.day) + ' ' + fmtTime(entryDate(last)) + ' (' + (last.addedBy || '') + ')' }));
  } else if (!isToday) {
    status.append(h('span', { class: 'med-last', text: 'Not given this day' }));
  }

  card.append(h('div', { class: 'med-actions' },
    isToday ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => logMed(m) }, 'Log now') : null,
    h('button', { class: isToday ? 'btn btn-secondary' : 'btn btn-primary', type: 'button', onclick: () => logMedAtTime(m) }, isToday ? 'Other time' : 'Log a dose')
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
  const day = h('input', { type: 'date', value: state.selectedDay, max: todayStr() });
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

/* A medicine taken with food: the box in the editor, or, for medicines saved before it existed,
   "meal" in the how-and-when text (Creon's "With each meal") */
function medWithMeals(m) {
  if (!m) return false;
  if (m.withMeals === true || m.withMeals === false) return m.withMeals;
  return /\bmeal/i.test(m.how || '');
}
/* After a meal is saved: for each with-meals medicine not logged within 45 minutes of it, ask */
const MEAL_MED_WINDOW_MS = 45 * 60 * 1000;
function promptMealMeds(mealAt) {
  if (state.readOnly || state.viewer) return;
  const day = dayStr(mealAt);
  const due = state.medicines.filter((m) => m.active !== false && m.kind !== 'prn' && medWithMeals(m) && (!m.courseEnd || m.courseEnd >= day))
    .filter((m) => !state.recentEntries.some((e) => e.type === 'med' && e.medId === m.id && Math.abs(entryDate(e) - mealAt) <= MEAL_MED_WINDOW_MS));
  if (!due.length) return;
  const blocks = h('div', null);
  const finish = () => { if (!blocks.childElementCount) closeSheet(); };
  due.forEach((m) => {
    const block = h('div', { class: 'mealmed' },
      h('p', { class: 'wiz-q', text: `Did you take ${m.name} with this meal?` }),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
        block.remove(); finish();
        const id = await addEntry({ type: 'med', medId: m.id, medName: m.name, dose: m.dose || '', note: '', at: mealAt });
        toast(`${m.name} logged at ${fmtTime(mealAt)}`, { label: 'Undo', onClick: () => deleteEntry(id) });
      } }, `Yes, ${m.dose || 'taken'} at ${fmtTime(mealAt)}`),
      state.pushEnabled ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: async () => {
        block.remove(); finish();
        const at = new Date(Date.now() + 15 * 60 * 1000);
        if (state.demo) { toast('Reminders are not sent from the preview'); return; }
        try { await setDoc(doc(collection(db, 'reminders')), { at: Timestamp.fromDate(at), medId: m.id, medName: m.name, dose: m.dose || '', sent: false, addedBy: state.name, createdAt: serverTimestamp() }); toast(`Reminder set for ${fmtTime(at)}`); }
        catch (e) { console.error(e); toast('Could not set the reminder'); }
      } }, 'Remind me in 15 minutes') : null,
      h('button', { class: 'btn btn-link btn-block', type: 'button', onclick: () => { block.remove(); finish(); } }, 'Not this time')
    );
    blocks.append(block);
  });
  openSheet('With this meal', blocks);
}

/* ------------------------------------------------------------------ */
/* Reminders on this phone: a Web Push subscription the bridge sends to  */
/* ------------------------------------------------------------------ */

const PUSH = window.DAYBOOK_PUSH && window.DAYBOOK_PUSH.publicKey ? window.DAYBOOK_PUSH : null;

/* ---- Explain in Daybook: the bridge asks the AI service on the person's behalf ---- */
/* The bridge's address comes from config.js; without it the buttons stay hidden and the share
   sheet route is the only one. The call carries the signed-in person's Firebase ID token, which
   the bridge checks before spending anything (see worker/). Nothing is stored on the way. */
const BRIDGE = window.DAYBOOK_BRIDGE && window.DAYBOOK_BRIDGE.url ? window.DAYBOOK_BRIDGE : null;
function explainAvailable() { return !!BRIDGE && !!(auth && auth.currentUser); }
async function bridgeExplain(payload) {
  const user = auth && auth.currentUser;
  if (!BRIDGE || !user) throw new Error('Sign in to use Explain in Daybook');
  const idToken = await user.getIdToken();
  const r = await fetch(BRIDGE.url.replace(/\/$/, '') + '/explain', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(payload) });
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok || !data || !data.text) {
    const msg = data && data.message ? data.message : (r.status === 503 ? 'Explain in Daybook is not switched on yet.' : 'Could not reach Daybook\'s AI service. Try again in a moment, or use Send to my AI app.');
    const err = new Error(msg); err.code = data && data.error; throw err;
  }
  return data;
}
/* A button that shows its own progress while the reply comes back (about 20 to 60 seconds) */
async function withBusy(btn, busyText, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = busyText; btn.setAttribute('aria-busy', 'true');
  try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = label; btn.removeAttribute('aria-busy'); }
}
function pushSupported() {
  return Boolean(PUSH && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
}
function pushSubId(endpoint) {
  let h1 = 5381;
  for (let i = 0; i < endpoint.length; i++) h1 = ((h1 * 33) ^ endpoint.charCodeAt(i)) >>> 0;
  return 'p' + h1.toString(16) + endpoint.slice(-24).replace(/[^A-Za-z0-9]/g, '');
}
function urlBase64ToUint8Array(s) {
  const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
/* Reflects this phone's state in Settings: on, off, unsupported, or blocked */
async function syncReminders() {
  const group = $('settings-reminders-group'), box = $('settings-reminders'), hint = $('settings-reminders-hint');
  if (!group) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const demo = state.demo || state.demoLive;
  group.hidden = state.readOnly || state.viewer;
  if (demo) { box.checked = false; box.disabled = true; hint.textContent = 'Not available in the demo.'; state.pushEnabled = false; return; }
  if (!pushSupported()) { box.checked = false; box.disabled = true; hint.textContent = standalone ? 'This browser cannot show notifications.' : 'On iPhone, add Daybook to the Home Screen first (Share, then Add to Home Screen), then turn this on from there.'; state.pushEnabled = false; return; }
  box.disabled = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    state.pushEnabled = Boolean(sub);
    box.checked = Boolean(sub);
    hint.textContent = sub ? 'This phone gets a notification at each medicine\'s reminder times, and one nudge 30 minutes later if the dose is still not logged.' : (Notification.permission === 'denied' ? 'Notifications are blocked for Daybook in this phone\'s settings. Allow them there, then turn this on.' : 'A notification at each medicine\'s reminder times (set under Manage medicines), only on phones where this is on.');
  } catch (e) { console.warn(e); box.disabled = true; hint.textContent = 'Could not check notifications on this phone.'; }
}
async function setReminders(on) {
  const box = $('settings-reminders');
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (!on) {
      if (existing) { await deleteDoc(doc(db, 'pushSubs', pushSubId(existing.endpoint))).catch(() => {}); await existing.unsubscribe(); }
      toast('Reminders off on this phone');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { box.checked = false; toast('Notifications were not allowed'); await syncReminders(); return; }
      const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUSH.publicKey) });
      const j = sub.toJSON();
      await setDoc(doc(db, 'pushSubs', pushSubId(sub.endpoint)), { endpoint: sub.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, addedBy: state.name, uid: state.user ? state.user.uid : null, agent: navigator.userAgent.slice(0, 120), addedAt: serverTimestamp() }, { merge: true });
      toast('Reminders on for this phone');
    }
  } catch (e) { console.error(e); toast('Could not change reminders on this phone'); }
  await syncReminders();
}
$('settings-reminders').addEventListener('change', (ev) => setReminders(ev.target.checked));

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

  /* Reminder times (a push notification at each, from the bridge) and the with-meals prompt */
  const times = (m.times || []).slice().sort();
  const timeChips = h('div', { class: 'presets timechips' });
  const timeInputEl = h('input', { type: 'time' });
  const drawTimes = () => timeChips.replaceChildren(...times.map((t) => h('button', { class: 'preset is-active', type: 'button', 'aria-label': 'Remove ' + t, onclick: () => { times.splice(times.indexOf(t), 1); drawTimes(); } }, t + ' \u00d7')),
    ...(times.length ? [] : [h('span', { class: 'hint', text: 'No reminders yet' })]));
  drawTimes();
  const addTime = h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { const v = timeInputEl.value; if (!v) return; if (!times.includes(v)) times.push(v); times.sort(); timeInputEl.value = ''; drawTimes(); } }, 'Add time');
  const withMeals = h('input', { type: 'checkbox' });
  withMeals.checked = medWithMeals(m);
  const schedFields = h('div', null, field('Doses per day', perDay), field('Course ends (optional)', courseEnd),
    h('p', { class: 'fieldlabel', text: 'Reminder times (optional)' }), timeChips,
    h('div', { class: 'field-row timeadd' }, timeInputEl, addTime),
    h('p', { class: 'hint', text: 'A notification on each phone that has reminders on (More > Settings). Nothing is sent if the dose is already logged.' }),
    h('label', { class: 'check' }, withMeals, h('span', { text: 'Ask after every meal' })),
    h('p', { class: 'hint', text: 'After food is logged, Daybook asks whether this was taken with it.' }));
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
        data.times = times.slice();
        data.withMeals = withMeals.checked;
      } else {
        data.minGapHours = parseFloat(minGap.value) || null;
        data.maxPerDay = parseInt(maxPerDay.value, 10) || null;
        data.perDay = null; data.courseEnd = null;
        data.times = []; data.withMeals = false;
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

  const pn = latest((e) => (isPatientCheckin(e) && e.pain != null) || e.type === 'pain');
  if (pn) {
    countTo($('vt-pain-value'), Number(pn.type === 'pain' ? pn.value : pn.pain), { unit: '/10' });
    $('vt-pain-sub').textContent = whenLabel(pn) + (pn.type === 'pain' ? ' reading' : ' check-in');
  } else { clearCount($('vt-pain-value'), '--'); $('vt-pain-sub').textContent = 'none yet'; }

  const md = latest((e) => isPatientCheckin(e) && e.mood != null);
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
  const ciPain = entries.filter((e) => isPatientCheckin(e) && e.pain != null).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.pain) }));
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

  const ciMood = entries.filter((e) => isPatientCheckin(e) && e.mood != null).map((e) => ({ x: entryDate(e).getTime(), y: Number(e.mood) }));
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
  /* The canvas gets a text alternative: the card's own heading and note, plus the range of the
     plotted values, so a screen reader hears what the chart shows rather than "graphic". */
  const card = canvas.closest('.chart-card');
  const heading = card && card.querySelector('.section-title') ? card.querySelector('.section-title').textContent.trim() : key;
  const note = card && card.querySelector('.legend-note') ? card.querySelector('.legend-note').textContent.trim() : '';
  const values = [];
  for (const ds of (cfg.data && cfg.data.datasets) || []) for (const v of ds.data || []) { const n = v && typeof v === 'object' ? v.y : v; if (typeof n === 'number' && isFinite(n)) values.push(n); }
  const labels = (cfg.data && cfg.data.labels) || [];
  const span = labels.length ? `${labels[0]} to ${labels[labels.length - 1]}` : '';
  const range = values.length ? `Values from ${Math.min(...values)} to ${Math.max(...values)}, ${values.length} readings${span ? ', ' + span : ''}.` : 'No readings in this range.';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${heading} chart. ${range} ${note}`.trim());
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
    h('option', { value: 'chemo', text: 'Treatment plan (also shown on the Treatment tab)' }),
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
      h('div', { class: 'docitem-sub', text: [fmtDayNum(d.docDate || ''), d.category === 'chemo' ? 'Treatment plan' : d.category === 'exemption' ? 'Exemption certificate' : null, d.kind === 'text' ? 'Text' : (d.pageCount === 1 ? '1 page' : d.pageCount + ' pages'), d.explanation ? 'Explained' : 'No explanation yet'].filter(Boolean).join(' \u00B7 ') })
    ),
    h('span', { class: 'pill ' + (d.explanation ? 'pill-green' : 'pill-amber'), role: 'img', 'aria-label': d.explanation ? 'Explained' : 'No explanation yet' }, d.explanation ? icon('check') : '?')
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

/* One-screen add: choose photos or a PDF, give a title and date, paste the AI app's
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

  const explanation = h('textarea', { rows: '8', placeholder: 'Paste the explanation here, or use Paste summary above' });
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
  openSheet(category === 'chemo' ? 'Add the treatment plan' : category === 'exemption' ? 'Add exemption certificate' : 'Add document', body);
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
  state.currentDoc = { id, pages: [], loading: null };
  $('docs-list-wrap').hidden = true;
  $('doc-detail').hidden = false;
  $('doc-title').textContent = d.title;
  $('doc-meta').textContent = `${fmtDayNum(d.docDate || '')} · added by ${d.addedBy || ''}`;
  $('doc-explanation').value = d.explanation || '';
  $('doc-explanation').readOnly = state.readOnly;
  $('doc-explain').hidden = !explainAvailable();
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
  const current = state.currentDoc;
  current.loading = (async () => {
    try {
      const snap = await getDocs(query(collection(db, 'documents', id, 'pages'), orderBy('n')));
      if (state.currentDoc !== current) return;
      current.pages = snap.docs.map((p) => p.data());
      pagesEl.replaceChildren(...current.pages.map((p, i) => h('img', { src: 'data:image/jpeg;base64,' + p.data, alt: `Page ${i + 1}`, width: p.width, height: p.height, loading: 'lazy' })));
      if (!current.pages.length) pagesEl.append(h('p', { class: 'empty', 'data-art': 'doc', text: 'No pages found.' }));
    } catch (e) {
      console.error(e);
      if (state.currentDoc === current) pagesEl.replaceChildren(h('p', { class: 'error', text: 'Could not load the pages.' }));
    }
  })();
  await current.loading;
}

/* A page photo shrunk for the AI service: at most 1568 px on the long edge (the service scales
   larger images down anyway) and JPEG at 0.8, so five pages travel as about 1 MB rather than 5.
   Falls back to the stored page if the browser cannot decode it. */
function shrinkPage(b64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1568, scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', 0.8).split(',')[1];
        resolve(out && out.length < b64.length ? out : b64);
      } catch (e) { resolve(b64); }
    };
    img.onerror = () => resolve(b64);
    img.src = 'data:image/jpeg;base64,' + b64;
  });
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

/* ------------------------------------------------------------------ */
/* Recorded answers: the clinician answers a question straight into the phone */
/* ------------------------------------------------------------------ */
/* recordings/{id} { questionId, questionText, day, at, mime, ext, seconds, bytes, parts, addedBy, createdAt }
   with the audio as base64 chunks in recordings/{id}/parts/{n} { n, data }, so a five-minute answer
   fits Firestore's document limit without any file storage. The question entry keeps a count in
   recordings and, with a typed or spoken answer, answerText and answeredAt. */
const REC_MAX_SECONDS = 300;
const REC_PART_CHARS = 700000;
function allQuestions() { return state.demo ? state.recentEntries.filter((e) => e.type === 'question') : (state.questions || []); }
/* A question's number never changes: its place among every question ever asked, oldest first */
function questionNumber(id) {
  const list = allQuestions().slice().sort((a, b) => entryDate(a) - entryDate(b));
  const i = list.findIndex((q) => q.id === id);
  return i < 0 ? list.length + 1 : i + 1;
}
function recMime() {
  if (!window.MediaRecorder) return null;
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* next */ } }
  return '';
}
function recExt(mime) { return /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /webm/.test(mime) ? 'webm' : 'audio'; }
function blobToB64(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); }); }
function fmtSeconds(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + pad2(s % 60); }
function recordingFilename(q, rec) { const d = entryDate(rec); return `Daybook Q${questionNumber(q.id)} answer ${dayStr(d)} ${fmtTime(d).replace(':', '-')}.${rec.ext || recExt(rec.mime || '')}`; }
function canRecord() { return recMime() !== null && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
async function saveRecording(q, blob, mime, seconds) {
  const b64 = await blobToB64(blob);
  const parts = [];
  for (let i = 0; i < b64.length; i += REC_PART_CHARS) parts.push(b64.slice(i, i + REC_PART_CHARS));
  const now = new Date();
  const meta = { questionId: q.id, questionText: q.note || '', day: dayStr(now), mime, ext: recExt(mime), seconds: Math.round(seconds), bytes: blob.size, parts: parts.length, addedBy: state.name };
  if (state.demo) {
    const id = fakeId('rec');
    state.demoRecordings.push({ id, ...meta, at: demoTs(now), createdAt: demoTs(now), blob });
    return id;
  }
  const ref = doc(collection(db, 'recordings'));
  const batch = writeBatch(db);
  batch.set(ref, { ...meta, at: Timestamp.fromDate(now), createdAt: serverTimestamp() });
  parts.forEach((data, n) => batch.set(doc(db, 'recordings', ref.id, 'parts', String(n)), { n, data }));
  await batch.commit();
  return ref.id;
}
async function loadRecordings(questionId) {
  if (state.demo) return state.demoRecordings.filter((r) => r.questionId === questionId);
  const snap = await getDocs(query(collection(db, 'recordings'), where('questionId', '==', questionId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => entryDate(a) - entryDate(b));
}
async function recordingBlob(rec) {
  if (rec.blob) return rec.blob;
  const snap = await getDocs(query(collection(db, 'recordings', rec.id, 'parts'), orderBy('n')));
  return b64ToBlob(snap.docs.map((d) => d.data().data).join(''), rec.mime);
}
async function deleteRecording(rec) {
  if (state.demo) { state.demoRecordings = state.demoRecordings.filter((r) => r.id !== rec.id); return; }
  const snap = await getDocs(collection(db, 'recordings', rec.id, 'parts'));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'recordings', rec.id));
  await batch.commit();
}
/* Save or share the file: the share sheet where files can be shared (Files, Mail, an AI app), otherwise a download */
async function shareRecording(q, rec) {
  const blob = await recordingBlob(rec);
  const filename = recordingFilename(q, rec);
  const file = new File([blob], filename, { type: rec.mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Recording saved as ' + filename);
}
function stampNow() { const now = new Date(); return state.demo ? demoTs(now) : Timestamp.fromDate(now); }

/* The answer sheet: record the spoken answer, play it back, save or share the file, or write or
   speak the answer in words. Saving either marks the question answered. */
function openAnswerSheet(q) {
  const fresh = () => allQuestions().find((x) => x.id === q.id) || q;
  const list = h('div', { class: 'reclist' });
  const status = h('p', { class: 'hint rec-status', role: 'status' });
  const time = h('span', { class: 'rec-time mono', text: '' });
  const label = h('span', { class: 'recbtn-label', text: 'Record the answer' });
  const recBtn = h('button', { class: 'recbtn', type: 'button', 'aria-pressed': 'false' }, icon('mic'), label, time);
  let recorder = null, stream = null, chunks = [], startedAt = 0, ticker = null, busy = false;
  const setRecording = (on) => { recBtn.classList.toggle('is-recording', on); recBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); label.textContent = on ? 'Recording, tap to stop' : 'Record the answer'; if (!on) time.textContent = ''; };
  const stopStream = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } if (ticker) { clearInterval(ticker); ticker = null; } };
  async function refresh() {
    const recs = await loadRecordings(q.id);
    list.replaceChildren(...recs.map((rec, i) => {
      const player = h('div', { class: 'rec-player' });
      /* Delete asks inline (a confirm sheet would replace this sheet): the button becomes Yes, delete / Keep */
      const del = h('button', { class: 'btn btn-link btn-small', type: 'button' }, 'Delete');
      del.addEventListener('click', () => {
        const yes = h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async () => {
          yes.disabled = true;
          try {
            await deleteRecording(rec);
            const cur = fresh();
            await updateEntry(q.id, { recordings: Math.max(0, (cur.recordings || 1) - 1) });
            toast('Recording deleted');
          } catch (e) { console.error(e); toast('Could not delete'); }
          refresh();
        } }, 'Yes, delete for good');
        const keep = h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { yes.replaceWith(del); keep.remove(); } }, 'Keep');
        del.replaceWith(yes); yes.after(keep); yes.focus();
      });
      const play = h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => {
        if (player.firstChild) { player.replaceChildren(); play.textContent = 'Play'; return; }
        play.textContent = 'Loading';
        try { const blob = await recordingBlob(rec); const audio = h('audio', { controls: '', src: URL.createObjectURL(blob) }); audio.setAttribute('aria-label', 'Recording ' + (i + 1)); player.replaceChildren(audio); audio.play().catch(() => {}); play.textContent = 'Hide'; }
        catch (e) { console.error(e); play.textContent = 'Play'; toast('Could not load the recording'); }
      } }, 'Play');
      return h('div', { class: 'recrow' },
        h('div', { class: 'recrow-head' },
          h('div', { class: 'recrow-title', text: `Recording ${i + 1} · ${fmtDayShort(rec.day || dayStr(entryDate(rec)))} ${fmtTime(entryDate(rec))} · ${fmtSeconds(rec.seconds || 0)}` }),
          h('div', { class: 'recrow-btns' }, play,
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => shareRecording(fresh(), rec).catch((e) => { console.error(e); toast('Could not share the recording'); }) }, 'Save or share'),
            del)),
        player);
    }));
    if (!recs.length) list.append(h('p', { class: 'muted rec-none', text: 'No recording yet.' }));
  }
  async function start() {
    if (busy) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { toast('Daybook needs the microphone for this. Allow it in Settings and try again.'); return; }
    const mime = recMime();
    try { recorder = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 32000 }, mime ? { mimeType: mime } : {})); }
    catch (e) { try { recorder = new MediaRecorder(stream); } catch (e2) { toast('Recording is not available on this phone'); stopStream(); return; } }
    chunks = [];
    recorder.addEventListener('dataavailable', (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); });
    recorder.addEventListener('stop', finish);
    recorder.start(1000);
    startedAt = Date.now();
    setRecording(true);
    status.textContent = 'Recording. Up to five minutes; tap the button again to stop.';
    ticker = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      time.textContent = fmtSeconds(s);
      if (s >= REC_MAX_SECONDS) stop();
    }, 250);
  }
  function stop() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }
  async function finish() {
    const seconds = (Date.now() - startedAt) / 1000;
    const type = (recorder && recorder.mimeType) || recMime() || 'audio/webm';
    stopStream();
    setRecording(false);
    const blob = new Blob(chunks, { type });
    recorder = null;
    if (!blob.size || seconds < 1) { status.textContent = 'Nothing was recorded. Try again, a little longer.'; return; }
    busy = true;
    status.textContent = 'Saving the recording';
    try {
      await saveRecording(q, blob, type, seconds);
      const cur = fresh();
      await updateEntry(q.id, { answered: true, answeredAt: stampNow(), recordings: (cur.recordings || 0) + 1 });
      status.textContent = 'Saved. The question is marked as answered.';
      toast('Recording saved');
      await refresh();
      if (!$('view-notes').hidden) renderNotesReport();
    } catch (e) { console.error(e); status.textContent = 'Could not save the recording.'; toast('Could not save the recording'); }
    busy = false;
  }
  const consent = h('div', { class: 'consent', role: 'group', 'aria-label': 'Before recording', hidden: true },
    h('p', { class: 'consent-q', text: 'Has the person speaking agreed to be recorded?' }),
    h('p', { class: 'hint', text: 'Say something like: "Is it all right if I record your answer so we get it right?" Recording starts only when you tap Yes.' }),
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { consent.hidden = true; recBtn.hidden = false; start(); } }, 'Yes, start recording'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { consent.hidden = true; recBtn.hidden = false; } }, 'Not now')));
  recBtn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') { stop(); return; }
    recBtn.hidden = true;
    consent.hidden = false;
    consent.querySelector('button').focus();
  });

  const text = h('textarea', { rows: '4', placeholder: 'What they said, in your own words' });
  text.value = q.answerText || '';
  const saveBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
    const v = text.value.trim();
    const cur = fresh();
    if (!v && !(cur.recordings > 0)) { toast('Nothing to save yet. Record the answer or write it down.'); return; }
    saveBtn.disabled = true;
    try {
      await updateEntry(q.id, { answerText: v, answered: true, answeredAt: stampNow() });
      toast('Answer saved');
      closeSheet();
      if (!$('view-notes').hidden) renderNotesReport();
    } catch (e) { console.error(e); toast('Could not save'); saveBtn.disabled = false; }
  } }, 'Save answer');

  const body = h('div', null,
    h('p', { class: 'answer-q', text: 'Q' + questionNumber(q.id) + '. ' + (q.note || '') }),
    h('p', { class: 'hint', text: 'Hold the phone up, or hand it over, and tap the button. You will be asked to confirm the person has agreed to be recorded before it starts.' }),
    canRecord() ? recBtn : h('p', { class: 'hint hint-warn', text: 'Recording is not available in this browser. Writing or speaking the answer below still works.' }),
    canRecord() ? consent : null,
    status,
    list,
    h('p', { class: 'hint', text: 'Save or share puts the file in Files, Mail or your AI app, named with the question number, date and time.' }),
    field('Answer in words', text), speakButton(text) || '',
    saveBtn,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Close')
  );
  openSheet('Answer', body, () => { if (recorder && recorder.state === 'recording') stop(); else stopStream(); });
  refresh();
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
  const text = d.kind === 'text' ? promptFor(d) + '\n\n' + (d.text || '') : promptFor(d) + '\n\n(Attach the page photos in your AI app.)';
  await copyText(text);
  toast('Copied. Paste it into your AI app.');
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

/* Explain in Daybook: the letter (text or page photos) goes to the bridge, the reply lands in
   the explanation box and is saved, so one tap does the whole job; the box stays editable. */
$('doc-explain').addEventListener('click', async () => {
  const d = currentDocRecord();
  if (!d || !explainAvailable()) return;
  const btn = $('doc-explain');
  if ($('doc-explanation').value.trim() && !(await confirmSheet('Explain again', 'This will replace the explanation already saved for this document.', 'Explain again', false))) return;
  try {
    const reply = await withBusy(btn, 'Explaining, about half a minute', async () => {
      let pages = [];
      if (d.kind !== 'text') {
        if (state.currentDoc && state.currentDoc.loading) await state.currentDoc.loading;
        const stored = state.currentDoc ? state.currentDoc.pages.map((p) => p.data).filter(Boolean) : [];
        if (!stored.length) throw new Error('The pages have not loaded yet. Wait a moment and try again.');
        pages = [];
        for (const p of stored.slice(0, 8)) pages.push(await shrinkPage(p));
      } else if (!(d.text || '').trim()) throw new Error('This document has no text to explain.');
      return bridgeExplain({ kind: 'document', title: d.title, date: fmtDayNum(d.docDate || ''), text: d.kind === 'text' ? (d.text || '') : '', pages });
    });
    const text = reply.text + (reply.cut ? '\n\n(The explanation was cut short. Tap Explain in Daybook again for another go.)' : '') + '\n\n' + NOT_MEDICAL_ADVICE;
    $('doc-explanation').value = text;
    if (state.demo) { d.explanation = text; renderDocsList(); }
    else await updateDoc(doc(db, 'documents', d.id), { explanation: text, updatedAt: serverTimestamp() });
    toast('Explanation ready and saved. Read it below.');
    $('doc-explanation').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (e) { console.warn(e); toast(e.message || 'Could not explain this document'); }
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
/* Chemo plan: calendar, mood, the cycle and the carer's view              */
/* ------------------------------------------------------------------ */

function renderChemo() {
  renderChemoProgress();
  renderCalendar();
  renderCycleTile();
  renderCarerRow();
  renderCycleChart();
  renderChemoDocs();
}

/* ---- Treatment types. A session day is days/{day}.chemo (the field keeps its old name); its type is
   days/{day}.treatment, chemo when missing, so every session marked before v63 is unchanged. Chemo and
   immunotherapy sessions start a cycle; radiotherapy is usually daily for weeks, so a run of
   consecutive radiotherapy days counts from its first day; Other (surgery, a scan) never starts one. ---- */
const TREATMENTS = [
  { key: 'chemo', label: 'Chemo', letter: 'C', cycle: 'each' },
  { key: 'radio', label: 'Radiotherapy', letter: 'R', cycle: 'run' },
  { key: 'immuno', label: 'Immunotherapy', letter: 'I', cycle: 'each' },
  { key: 'other', label: 'Other', letter: 'O', cycle: 'never' }
];
function treatmentOf(info) { return TREATMENTS.find((t) => t.key === (info && info.treatment)) || TREATMENTS[0]; }
function chemoDays() { return Object.keys(state.days).filter((k) => state.days[k].chemo).sort(); }
/* The days that start a cycle, oldest first, each with its type */
function cycleStarts() {
  const days = chemoDays();
  const set = new Set(days);
  return days.filter((k) => {
    const t = treatmentOf(state.days[k]);
    if (t.cycle === 'each') return true;
    if (t.cycle === 'run') { const prev = addDays(k, -1); return !(set.has(prev) && treatmentOf(state.days[prev]).key === t.key); }
    return false;
  }).map((k) => ({ day: k, type: treatmentOf(state.days[k]) }));
}
function cycleFor(day) {
  const starts = cycleStarts().filter((s) => s.day <= day);
  if (!starts.length) return null;
  const s = starts[starts.length - 1];
  return { start: s.day, type: s.type, n: Math.round((parseDay(day) - parseDay(s.day)) / 864e5) };
}
function renderCycleTile() {
  const val = $('cycle-value'), sub = $('cycle-sub');
  if (!val) return;
  const today = todayStr(), c = cycleFor(today);
  if (!c) { val.textContent = '--'; sub.textContent = chemoDays().length ? 'No chemo or immunotherapy session yet' : 'No sessions marked yet'; return; }
  const name = c.type.label.toLowerCase();
  val.textContent = c.n === 0 ? c.type.label + ' day' : 'Day ' + c.n;
  let text = c.n === 0 ? (c.type.cycle === 'run' ? name + ' started today' : name + ' today') : 'after ' + name + (c.type.cycle === 'run' ? ' started on ' : ' on ') + fmtDayShort(c.start);
  const next = chemoDays().find((k) => k > today);
  if (next) { const gap = Math.round((parseDay(next) - parseDay(today)) / 864e5); text += ', next ' + treatmentOf(state.days[next]).label.toLowerCase() + ' ' + (gap === 1 ? 'tomorrow' : 'in ' + gap + ' days'); }
  sub.textContent = text;
}

/* The carer's row: today's carer's view, like the check-in rows on Today (the flow itself offers Yesterday) */
function renderCarerRow() {
  const row = $('checkin-carer'), sub = $('checkin-carer-sub');
  if (!row) return;
  const c = findCheckin(todayStr(), 'carer');
  row.classList.remove('is-due', 'is-done');
  row.disabled = state.readOnly;
  if (c) {
    row.classList.add('is-done');
    sub.replaceChildren(h('span', { class: 'checkin-done' }, icon('check'), 'Done ' + fmtTime(entryDate(c)) + (c.addedBy ? ' by ' + c.addedBy : '')));
  } else if (new Date().getHours() >= 15) { row.classList.add('is-due'); sub.textContent = state.readOnly ? 'Due this evening' : 'Due this evening, about a minute'; }
  else sub.textContent = state.readOnly ? 'Not filled in yet' : 'Later today, or tap to fill in yesterday';
}
$('checkin-carer').addEventListener('click', () => openCheckin('carer', todayStr()));

/* ---- By day after chemo: every check-in score averaged by its day in the cycle, across every cycle ---- */
const CYCLE_MEASURES = [
  { key: 'energy', label: 'Energy', highGood: true, slots: ['evening'], carer: true },
  { key: 'sickness', label: 'Sickness', highGood: false, slots: ['evening'], carer: true },
  { key: 'appetite', label: 'Appetite', highGood: true, slots: ['evening'], carer: true },
  { key: 'pain', label: 'Pain', highGood: false, slots: ['morning', 'evening'], carer: true },
  { key: 'mood', label: 'Mood', highGood: true, slots: ['morning', 'evening'], carer: true },
  { key: 'sleep', label: 'Sleep', highGood: true, slots: ['morning'], carer: false }
];
const CYCLE_MAX_DAY = 28;
const CYCLE_LOOKBACK_DAYS = 180;

/* Every check-in since the first session (at most 180 days back). One query by type, filtered by day
   here, so no composite index is needed and no other entry is read. Cached for a minute. */
async function cycleEntries() {
  const starts = chemoDays();
  if (!starts.length) return [];
  const floor = addDays(todayStr(), -CYCLE_LOOKBACK_DAYS);
  const from = starts[0] < floor ? floor : starts[0];
  if (state.demo) return state.recentEntries.filter((e) => e.type === 'checkin' && e.day >= from);
  if (state.cycleEntries && state.cycleFrom === from && Date.now() - state.cycleFetched < 60000) return state.cycleEntries;
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('type', '==', 'checkin')));
    state.cycleEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.day >= from);
    state.cycleFrom = from;
    state.cycleFetched = Date.now();
    return state.cycleEntries;
  } catch (e) { console.error(e); return null; }
}

function cycleSeries(entries, m) {
  const today = todayStr();
  const starts = cycleStarts().map((s) => s.day).filter((k) => k <= today);
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const sums = {}, carerSums = {}, cycles = new Set();
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : addDays(today, 1);
    for (let d = start, n = 0; d < end && d <= today && n <= CYCLE_MAX_DAY; d = addDays(d, 1), n++) {
      const list = byDay[d] || [];
      const pv = list.filter((e) => e.slot !== 'carer' && m.slots.includes(e.slot) && e[m.key] != null).map((e) => Number(e[m.key]));
      const cv = m.carer ? list.filter((e) => e.slot === 'carer' && e[m.key] != null).map((e) => Number(e[m.key])) : [];
      if (pv.length) { const s = sums[n] || (sums[n] = { sum: 0, n: 0 }); s.sum += mean(pv); s.n++; cycles.add(start); }
      if (cv.length) { const s = carerSums[n] || (carerSums[n] = { sum: 0, n: 0 }); s.sum += mean(cv); s.n++; cycles.add(start); }
    }
  });
  const maxDay = Math.max(-1, ...Object.keys(sums).map(Number), ...Object.keys(carerSums).map(Number));
  const labels = [], patient = [], carer = [];
  for (let n = 0; n <= maxDay; n++) {
    labels.push(n);
    patient.push(sums[n] ? Math.round((sums[n].sum / sums[n].n) * 10) / 10 : null);
    carer.push(carerSums[n] ? Math.round((carerSums[n].sum / carerSums[n].n) * 10) / 10 : null);
  }
  return { labels, patient, carer, cycles: cycles.size, carerAny: carer.some((v) => v != null) };
}

function cycleDayWord(d) { return d === 0 ? 'the session day' : 'day ' + d; }
function cycleSentence(m, s) {
  if (!s.cycles) return 'No check-ins since a session yet. The pattern appears after the first cycle.';
  const base = s.cycles === 1 ? 'Based on 1 cycle so far; the pattern gets clearer with each one.' : 'Based on ' + s.cycles + ' cycles.';
  const pts = s.patient.map((v, i) => (v == null ? null : { d: i, v })).filter(Boolean);
  if (pts.length < 2) return base;
  const lo = pts.reduce((a, b) => (b.v < a.v ? b : a)), hi = pts.reduce((a, b) => (b.v > a.v ? b : a));
  if (hi.v - lo.v < 1) return m.label + ' is much the same through the cycle. ' + base;
  const text = m.highGood
    ? m.label + ' is usually lowest on ' + cycleDayWord(lo.d) + ' and best on ' + cycleDayWord(hi.d) + '.'
    : m.label + ' is usually worst on ' + cycleDayWord(hi.d) + ' and easiest on ' + cycleDayWord(lo.d) + '.';
  return text + ' ' + base;
}

function renderCycleChips() {
  const box = $('cycle-measures');
  box.replaceChildren(...CYCLE_MEASURES.map((m) => h('button', {
    class: 'seg' + (m.key === state.cycleMeasure ? ' is-active' : ''), type: 'button', 'aria-pressed': m.key === state.cycleMeasure ? 'true' : 'false',
    onclick: () => { state.cycleMeasure = m.key; renderCycleChart(); }
  }, m.label)));
}

async function renderCycleChart() {
  if (!$('cycle-card') || $('view-chemo').hidden || state.viewer) return;
  renderCycleChips();
  const m = CYCLE_MEASURES.find((x) => x.key === state.cycleMeasure) || CYCLE_MEASURES[0];
  const entries = await cycleEntries();
  if (!entries) return;
  const s = cycleSeries(entries, m);
  $('cycle-note').textContent = cycleSentence(m, s);
  $('cycle-wrap').hidden = !s.cycles;
  if (!s.cycles) { if (state.charts.cycle) { state.charts.cycle.destroy(); delete state.charts.cycle; } return; }
  try { await loadScript(CDN.chart); } catch (e) { return; }
  const T = chartTheme();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const datasets = [lineSeries(T, T.teal, s.patient, { label: 'Check-ins', spanGaps: true })];
  if (s.carerAny) datasets.push({ label: "Carer's view", data: s.carer, borderColor: T.warm, borderWidth: 2.5, borderDash: [6, 4], borderCapStyle: 'round', tension: 0.3, cubicInterpolationMode: 'monotone', fill: false, spanGaps: true, pointRadius: 3, pointHoverRadius: 7, pointHitRadius: 12, pointBackgroundColor: T.warm, pointBorderColor: 'transparent' });
  makeChart('cycle', {
    type: 'line',
    data: { labels: s.labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, right: 10 } },
      interaction: { mode: 'index', intersect: false },
      animation: reduced ? false : drawIn(s.labels.length),
      scales: {
        x: Object.assign(xAxisBase(T), { ticks: Object.assign(xAxisBase(T).ticks, { maxTicksLimit: 8, callback: (v, i) => (i === 0 ? 'Session' : String(s.labels[i])) }), title: { display: true, text: 'Days after treatment', color: T.muted, font: { family: T.mono, size: 11 } } }),
        y: Object.assign(yAxisBase(T), { min: 0, max: 10, ticks: Object.assign(yAxisBase(T).ticks, { stepSize: 2, maxTicksLimit: 6 }) })
      },
      plugins: { legend: s.carerAny ? legendStyle(T) : { display: false }, tooltip: Object.assign(tooltipStyle(T), { callbacks: {
        title: (items) => items.length ? (items[0].dataIndex === 0 ? 'Session day' : 'Day ' + items[0].dataIndex + ' after treatment') : '',
        label: (i) => i.raw == null ? '' : i.dataset.label + ': ' + i.raw + '/10'
      } }) }
    }
  });
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
  if (!planned) text = 'Tap a day on the calendar to mark a treatment session.';
  else if (upcoming.length) {
    const next = upcoming[0];
    const gap = Math.round((parseDay(next) - parseDay(today)) / 864e5);
    const what = treatmentOf(state.days[next]).label.toLowerCase();
    text = next === today ? `Next session: ${what}, today.` : `Next session: ${what} on ${fmtDayLong(next)}, ${gap === 1 ? 'tomorrow' : 'in ' + gap + ' days'}.`;
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
    const type = treatmentOf(info);
    const label = [fmtDayLong(key), info.chemo ? type.label.toLowerCase() + (info.chemoDone ? ' session done' : ' session') : null, info.mood ? 'mood ' + MOODS[info.mood - 1].label : null].filter(Boolean).join(', ');
    cells.push(h('button', { class: cls.join(' '), type: 'button', 'aria-label': label, disabled: state.viewer, onclick: () => openDaySheet(key) },
      info.chemo ? h('span', { class: 'cal-type', 'aria-hidden': 'true', text: type.letter }) : null,
      h('span', { class: 'cal-num', text: String(d) }),
      info.mood ? moodMark(info.mood) : null
    ));
  }
  $('cal-grid').replaceChildren(...cells);
}

/* One sheet per calendar day: treatment session and its type, session done, mood, one good thing */
function openDaySheet(key) {
  const info = state.days[key] || {};

  if (state.readOnly) {
    const chemoStatus = info.chemo ? treatmentOf(info).label + (info.chemoDone ? ' session, done' : ' session planned') : 'No treatment session this day';
    const moodInfo = info.mood ? 'Mood that day: ' + MOODS[info.mood - 1].label.toLowerCase() + (info.good ? '. ' + info.good : '') : '';
    openSheet(fmtDayLong(key), h('div', null,
      h('p', { text: chemoStatus }),
      moodInfo ? h('p', { class: 'hint', text: moodInfo }) : null,
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Close')
    ));
    return;
  }

  const cbChemo = h('input', { type: 'checkbox' });
  cbChemo.checked = !!info.chemo;
  const cbDone = h('input', { type: 'checkbox' });
  cbDone.checked = !!info.chemoDone;
  const doneRow = h('label', { class: 'check' }, cbDone, h('span', { text: 'Session done' }));
  let treatment = treatmentOf(info).key;
  const typeRow = h('div', { class: 'wiz-day treat-chips', role: 'group', 'aria-label': 'Kind of treatment' });
  const drawTypes = () => typeRow.replaceChildren(...TREATMENTS.map((t) => h('button', { class: 'preset' + (t.key === treatment ? ' is-active' : ''), type: 'button', 'aria-pressed': t.key === treatment ? 'true' : 'false', onclick: () => { treatment = t.key; drawTypes(); } }, t.label)));
  drawTypes();
  const syncDone = () => { doneRow.hidden = !cbChemo.checked; typeRow.hidden = !cbChemo.checked; if (!cbChemo.checked) cbDone.checked = false; };
  cbChemo.addEventListener('change', syncDone);
  syncDone();

  const moodInfo = info.mood ? 'Mood that day: ' + MOODS[info.mood - 1].label.toLowerCase() + (info.good ? '. ' + info.good : '') : '';

  const body = h('div', null,
    h('label', { class: 'check' }, cbChemo, h('span', { text: 'Treatment session this day' })),
    typeRow,
    doneRow,
    h('p', { class: 'hint', text: (moodInfo ? moodInfo + ' ' : '') + 'Mood and one good thing come from the daily check-ins on Today.' }),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const wasDone = !!info.chemoDone;
      const data = { chemo: cbChemo.checked, chemoDone: cbChemo.checked && cbDone.checked, treatment, updatedBy: state.name, updatedAt: serverTimestamp() };
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
  $('ex-goals').replaceChildren(...GOAL_ROWS.map((row) => h('button', { class: 'goal' + (done[row.key] ? ' is-done' : ''), type: 'button', 'aria-pressed': done[row.key] ? 'true' : 'false', disabled: state.readOnly, onclick: () => toggleGoal(day, row.key) },
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

/* ---- Opener: the loading page. Shown on every cold start while the account check runs. The Mark 1
   Apps film plays through only on a phone's first visit (localStorage daybook.opener.seen); later
   starts show its last frame just for as long as loading takes, half a second at least so it never
   flashes. A tap, the Skip button, a decode error or 5.5 seconds ends the film; the page leaves once
   the app or the sign-in screen is ready, and after fifteen seconds regardless. Reduced motion: no film. ---- */
(function opener() {
  const el = $('opener'), video = $('opener-video'), skip = $('opener-skip');
  if (!el || !video) return;
  $('opener-version').textContent = 'Version ' + APP_VERSION;
  const KEY = 'daybook.opener.seen';
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; } catch (e) { seen = true; }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = Date.now(), minMs = 500;
  let appReady = false, filmDone = seen || reduced, gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* private mode: the film plays next time too */ }
    el.classList.add('is-leaving');
    setTimeout(() => { el.hidden = true; try { video.pause(); } catch (e) { /* ignore */ } }, 440);
  };
  const maybe = () => {
    if (!appReady || !filmDone || gone) return;
    const wait = minMs - (Date.now() - start);
    if (wait > 0) setTimeout(leave, wait); else leave();
  };
  const ready = () => ['app', 'signin', 'noconfig'].some((id) => { const s = $(id); return s && !s.hidden; });
  const check = () => { if (!appReady && ready()) { appReady = true; maybe(); } };
  new MutationObserver(check).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  check();
  const endFilm = () => { if (filmDone) return; filmDone = true; skip.hidden = true; maybe(); };
  if (!filmDone) {
    skip.hidden = false;
    skip.addEventListener('click', endFilm);
    el.addEventListener('click', endFilm);
    video.addEventListener('ended', endFilm);
    video.addEventListener('error', endFilm);
    setTimeout(endFilm, 5500);
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(endFilm);
  }
  setTimeout(leave, 15000);
})();

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
