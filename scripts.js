/* Care Log
   Vanilla JS, Firebase v10 modular (Auth + Firestore only). No server, no paid services.
   See CLAUDE.md for the standards and the COST RULE. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, inMemoryPersistence, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const APP_VERSION = '114';
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

/* The four exercises Mark started with. Since v69 they are only the starting programme for an
   account that has never edited one (profile/main.programme is missing): the old exerciseGoals
   figures still feed the amounts, and the ids match the old done keys, so nothing ticked is lost. */
const GOAL_DEFAULTS = { pressups: 20, situps: 20, plankSeconds: 60, squats: 2 };

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

/* Weight is stored and reported in kg everywhere: the timeline, Notes for the team, its PDF, the copied
   text (what NHS teams record). One choice per phone, kg or stones and pounds, set from the small switch
   on the Weight chart or the one beside the weight box in Vitals (they share it), changes only those two
   places. Since v96; v95's Units card in Settings went, as more than people needed. */
const KG_PER_LB = 0.45359237;
const WEIGHT_PREF_KEY = 'daybook.weightUnit';
function weightPref() { try { return localStorage.getItem(WEIGHT_PREF_KEY) === 'stlb' ? 'stlb' : 'kg'; } catch (e) { return 'kg'; } }
function setWeightPref(u) { try { localStorage.setItem(WEIGHT_PREF_KEY, u); } catch (e) { /* private window: this session only */ } }
function fmtKg(kg) { return Number(kg).toFixed(1) + ' kg'; }
function fmtStLb(kg) { const lb = Math.round(Number(kg) / KG_PER_LB); return Math.floor(lb / 14) + ' st ' + (lb % 14) + ' lb'; }
function fmtTemp(c) { return Number(c).toFixed(1) + ' \u00B0C'; }
/* Temperature is degrees C, but a number from 90 to 110 can only be Fahrenheit, so it is converted, and said so */
const fToC = (f) => (f - 32) * 5 / 9;
function readTemp(el) {
  const r = readNum(el);
  if (!r.empty && r.value != null && r.value >= 90 && r.value <= 110) return { ...r, value: fToC(r.value), fromF: r.value };
  return r;
}
/* The kg | st and lb switch, used on the Weight chart and in the weight entry */
function weightSwitch(onChange) {
  const mk = (u, text, label) => h('button', { class: 'seg', type: 'button', 'aria-label': label, dataset: { u }, text, onclick: () => { setWeightPref(u); sync(); onChange(u); } });
  const wrap = h('div', { class: 'segmented unitswitch', role: 'group', 'aria-label': 'Weight in' }, mk('kg', 'kg', 'Kilograms'), mk('stlb', 'st and lb', 'Stones and pounds'));
  const sync = () => wrap.querySelectorAll('.seg').forEach((b) => { const on = b.dataset.u === weightPref(); b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  sync();
  wrap.sync = sync;
  return wrap;
}
/* The weight entry: the switch, one box in kg or two in stones and pounds, and under them the same weight in
   the other unit, so the kg that will be saved is always in view. read(): { empty } | { kg } | { kg: null, raw, el } */
function weightEntry(initialKg) {
  const box = () => h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off' });
  const kgBox = box(), stBox = box(), lbBox = box();
  const kgRow = field('Weight (kg)', kgBox);
  const stRow = h('div', { class: 'field-row' }, field('Weight: stones', stBox), field('and pounds', lbBox));
  const conv = h('p', { class: 'hint hint-small', 'aria-live': 'polite' });
  const readStLb = () => {
    const a = readNum(stBox), b = readNum(lbBox);
    if (a.empty && b.empty) return { empty: true, kg: null };
    if ((!a.empty && a.value == null) || (!b.empty && (b.value == null || b.value >= 14))) return { empty: false, kg: null, raw: (stBox.value + ' st ' + lbBox.value + ' lb').trim(), el: (!b.empty && (b.value == null || b.value >= 14)) ? lbBox : stBox };
    return { empty: false, kg: ((a.value || 0) * 14 + (b.value || 0)) * KG_PER_LB };
  };
  const readKg = () => { const r = readNum(kgBox); return r.empty ? { empty: true, kg: null } : r.value == null ? { empty: false, kg: null, raw: kgBox.value.trim(), el: kgBox } : { empty: false, kg: r.value }; };
  const read = () => (weightPref() === 'stlb' ? readStLb() : readKg());
  const setFromKg = (kg) => {
    if (kg == null) return;
    const lb = Math.round(kg / KG_PER_LB);
    kgBox.value = (Math.round(kg * 10) / 10).toFixed(1);
    stBox.value = String(Math.floor(lb / 14)); lbBox.value = String(lb % 14);
  };
  const showConv = () => {
    const r = read();
    conv.textContent = r.kg == null || r.kg < 20 || r.kg > 300 ? '' : weightPref() === 'stlb' ? '= ' + fmtKg(r.kg) + ', which is what is saved' : '= ' + fmtStLb(r.kg);
  };
  const showMode = () => { const st = weightPref() === 'stlb'; kgRow.hidden = st; stRow.hidden = !st; showConv(); };
  let lastMode = weightPref();
  const sw = weightSwitch(() => { const before = lastMode === 'stlb' ? readStLb() : readKg(); lastMode = weightPref(); if (!before.empty && before.kg != null) setFromKg(before.kg); showMode(); });
  [kgBox, stBox, lbBox].forEach((el) => el.addEventListener('input', showConv));
  if (initialKg != null) setFromKg(Number(initialKg));
  showMode();
  return {
    nodes: [h('div', { class: 'unitswitch-row' }, h('span', { class: 'fieldlabel', text: 'Weight in' }), sw), kgRow, stRow, conv],
    first: weightPref() === 'stlb' ? stBox : kgBox,
    read
  };
}
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
/* The on-screen keyboard. iPhone Safari lays the keyboard over the page rather than shrinking it, so a
   sheet anchored to the bottom ended up behind it and a check-in answer was typed blind (Mark, 5 October).
   The visual viewport is the part still visible: the sheet sits on its bottom edge and is no taller than
   it, and a focused field is scrolled to the middle of the sheet once the keyboard has risen. */
(function keepSheetAboveKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const st = $('sheet').style;
    st.setProperty('--kb', kb + 'px');
    st.setProperty('--vvh', Math.round(vv.height) + 'px');
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
  $('sheet').addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!el.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea')) return;
    setTimeout(() => { fit(); if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 320);
  });
})();
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

/* A number typed into a text box with a number keypad: a comma or a full stop for the decimal point,
   spaces and a trailing unit allowed ("80,6", " 80.6 kg"). { empty } when nothing was typed;
   value null when something was typed that is not a number. */
function readNum(el) {
  const raw = String(el.value || '').trim();
  if (!raw) return { empty: true, value: null };
  const cleaned = raw.replace(/\s+/g, '').replace(/(kg|lbs?|st|bpm|%|°[cf]|[cf])$/i, '').replace(',', '.');
  return { empty: false, value: /^\d+(\.\d+)?$/.test(cleaned) ? parseFloat(cleaned) : null };
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
/* One locked folder per household (since v75): every collection the app reads or writes sits under
   households/{state.household}/..., and firestore.rules lets only that household's members in.
   hcol('entries') and hdoc('entries', id) are the only way the app reaches its data; nothing else
   calls collection(db, ...) or doc(db, ...) except the users/{uid} pointer and members reads at sign-in. */
function hcol(name, ...rest) { return collection(db, 'households', state.household, name, ...rest); }
function hdoc(name, ...rest) { return doc(db, 'households', state.household, name, ...rest); }
/* The shared demo project keeps its example data in one fixed household */
const DEMO_HOUSEHOLD = 'demo';
/* The shared, usable demo: a second Firebase project of its own, with a guest sign-in whose
   details are public by design (window.DAYBOOK_DEMO in config.js). Without it, Guest is the
   in-memory preview. Nothing here can reach the real project: different app, different database. */
const DEMO = window.DAYBOOK_DEMO && window.DAYBOOK_DEMO.firebase && window.DAYBOOK_DEMO.firebase.apiKey ? window.DAYBOOK_DEMO : null;
/* The bridge's address (config.js); without it Explain, sign-up and invites stay hidden */
const BRIDGE = window.DAYBOOK_BRIDGE && window.DAYBOOK_BRIDGE.url ? window.DAYBOOK_BRIDGE : null;

/* Accounts are data, not code (since v44): users/{uid} in Firestore holds
   { name, role, relation }. role is "family" (full access), "readonly" (sees
   everything, writes nothing) or "viewer" (a narrow read-only slice);
   relation is "patient", "carer" or "". Records are written from the Actions
   tab ("Seed a user record") or in the console, never by the app, and the
   rules gate every collection on them, so no email address lives in the
   code or on the site. */
const ACCOUNT_CACHE_KEY = 'daybook.account.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Reads users/{uid} (which household this sign-in belongs to) and then that household's
   members/{uid} record (name, role, relation). Returns the account, or { missing: true } only when the server
   itself says there is no record, or { error: true } when it could not be checked
   (no signal, a timeout). A poor connection must never look like "not set up":
   until v52 any error here signed the person out. A copy of the last good record is
   kept on the phone so a weak signal at start-up still opens the app straight away. */
async function loadAccount(user) {
  if (state.demoLive) return { name: 'Guest', role: 'family', relation: '', household: DEMO_HOUSEHOLD };
  const cacheKey = ACCOUNT_CACHE_KEY + user.uid;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) { cached = null; }
  if (cached && !cached.household) cached = null; // a record cached before v75 names no household
  const delays = [0, 1500, 3000, 6000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt]);
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const fromServer = (x) => !x.metadata || !x.metadata.fromCache;
      if (snap.exists() && snap.data().household) {
        const household = snap.data().household;
        const mem = await getDoc(doc(db, 'households', household, 'members', user.uid));
        if (mem.exists()) {
          const d = mem.data();
          const account = { name: d.name || (user.email || '').split('@')[0] || 'Unknown', role: d.role || 'family', relation: d.relation || '', household };
          try { localStorage.setItem(cacheKey, JSON.stringify(account)); } catch (e) { /* storage full or blocked: nothing lost */ }
          return account;
        }
        if (fromServer(mem)) return { missing: true }; // the server answered: not a member of that household
      } else if (fromServer(snap)) {
        return { missing: true }; // the server answered: no record, or one not moved into a household yet
      }
      // "no record" from the local cache only means it was never fetched; treat as unknown
    } catch (e) { console.error(e); }
    if (cached && cached.name) return cached;
  }
  return { error: true };
}

const state = {
  user: null,
  account: null,
  household: null,
  pendingInvite: null,
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
  notesCharts: null, // the charts ticked for the Notes PDF this session (null: the defaults)
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

/* ---- Create an account, invites and the no-household screen (since v78) ----
   A sign-in is made by Firebase Auth from the app; the household records that decide access are
   made only by the bridge (/household, /join), which checks the ID token and the invite. */
const relationChips = (holder, initial) => {
  let value = initial || '';
  const draw = () => holder.replaceChildren(...[['patient', 'The patient'], ['carer', 'A carer'], ['', 'Family or friend']].map(([v, label]) =>
    h('button', { class: 'preset' + (value === v ? ' is-active' : ''), type: 'button', 'aria-pressed': value === v ? 'true' : 'false', onclick: () => { value = v; draw(); } }, label)));
  draw();
  return () => value;
};
const signupRelation = relationChips($('signup-relation'), 'patient');
const nohouseholdRelation = relationChips($('nohousehold-relation'), 'patient');
function showSignup() {
  $('signin').hidden = true; $('nohousehold').hidden = true;
  $('signup').hidden = false;
  $('signup-error').hidden = true;
  $('signup-code').value = state.pendingInvite || '';
  $('signup-intro').textContent = state.pendingInvite ? 'Create a sign-in to join the household you were invited to.' : 'Your own Daybook, for you and the people you invite.';
  $('signup-name').focus();
}
$('signup-button').addEventListener('click', showSignup);
$('signup-cancel').addEventListener('click', () => { $('signup').hidden = true; $('signin').hidden = false; });
$('signup-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('signup-submit'), err = $('signup-error');
  err.hidden = true; btn.disabled = true; btn.textContent = 'Creating';
  const name = $('signup-name').value.trim(), code = $('signup-code').value.trim();
  try {
    await setPersistence(auth, browserLocalPersistence);
    const cred = await createUserWithEmailAndPassword(auth, $('signup-email').value.trim(), $('signup-password').value);
    /* the sign-in exists now; the household is made by the bridge, and a failure there lands on the no-household screen, not in limbo */
    if (code) await bridgeCall('/join', { code, name });
    else await bridgeCall('/household', { name, relation: signupRelation() });
    state.pendingInvite = null;
    $('signup').hidden = true;
    $('signup-password').value = '';
    await enterApp(cred.user);
    toast(code ? 'You are in. Welcome to Daybook.' : 'Your Daybook is ready.');
  } catch (e) {
    console.error(e);
    if (auth.currentUser && !(e && e.code && String(e.code).startsWith('auth/'))) { $('signup').hidden = true; showNoHousehold(auth.currentUser, e.message); }
    else { err.textContent = friendlyAuthError(e); err.hidden = false; }
  } finally { btn.disabled = false; btn.textContent = 'Create my account'; }
});
$('forgot-button').addEventListener('click', async () => {
  const email = $('signin-email').value.trim(), err = $('signin-error');
  if (!email) { err.textContent = 'Type your email address first, then tap Forgotten your password.'; err.hidden = false; $('signin-email').focus(); return; }
  try { await sendPasswordResetEmail(auth, email); toast('If that address has a sign-in, a reset email is on its way.'); err.hidden = true; }
  catch (e) { err.textContent = friendlyAuthError(e); err.hidden = false; }
});
/* Signed in, in no household: make one, or join with a code */
function showNoHousehold(user, message) {
  $('app').hidden = true; $('signin').hidden = true; $('signup').hidden = true;
  $('nohousehold').hidden = false;
  $('nohousehold-who').textContent = (user && user.email ? user.email + ' is signed in, but' : 'This sign-in is') + ' not in a Daybook household yet. Create your own, or paste the invite code someone sent you.';
  if (!$('nohousehold-name').value) $('nohousehold-name').value = (user && user.displayName) || $('signup-name').value || '';
  $('nohousehold-code').value = state.pendingInvite || $('signup-code').value || '';
  const err = $('nohousehold-error');
  if (message) { err.textContent = message; err.hidden = false; } else err.hidden = true;
  if (!BRIDGE) { err.textContent = 'Daybook cannot set up households at the moment. Ask the person who runs it.'; err.hidden = false; }
}
$('nohousehold-code').addEventListener('input', () => { $('nohousehold-submit').textContent = $('nohousehold-code').value.trim() ? 'Join with this invite' : 'Create my own Daybook'; });
$('nohousehold-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('nohousehold-submit'), err = $('nohousehold-error');
  err.hidden = true; btn.disabled = true;
  const name = $('nohousehold-name').value.trim(), code = $('nohousehold-code').value.trim();
  try {
    if (code) await bridgeCall('/join', { code, name });
    else await bridgeCall('/household', { name, relation: nohouseholdRelation() });
    state.pendingInvite = null;
    $('nohousehold').hidden = true;
    await enterApp(auth.currentUser);
  } catch (e) { err.textContent = e.message; err.hidden = false; }
  finally { btn.disabled = false; }
});
$('nohousehold-signout').addEventListener('click', async () => { $('nohousehold').hidden = true; await signOut(auth); $('signin').hidden = false; });
/* ?invite=CODE in the address: remember it, say what it is for, and lead with Create an account */
/* Privacy, terms and About (since v90): the three documents are <template>s in index.html, shown in the
   sheet so they open from the sign-in screen as well as from Settings; ?page=privacy in the address opens
   one directly, which gives the store listings a link. The contact email comes from config.js
   (window.DAYBOOK_CONTACT.email) so no address is written into the page. */
const LEGAL_PAGES = { privacy: 'Privacy', terms: 'Terms of use', about: 'About Daybook' };
function openLegal(which) {
  const tpl = $('tpl-' + which);
  if (!tpl || !LEGAL_PAGES[which]) return;
  const wrap = h('div', { class: 'legal' });
  wrap.append(tpl.content.cloneNode(true));
  const email = (window.DAYBOOK_CONTACT && window.DAYBOOK_CONTACT.email) || '';
  for (const el of wrap.querySelectorAll('[data-contact]')) {
    if (email) el.replaceChildren('Contact: ', h('a', { href: 'mailto:' + email, text: email }), '.');
    else el.textContent = 'Contact: Mark Brown, Mark 1 Apps.';
  }
  for (const el of wrap.querySelectorAll('[data-version]')) el.textContent = 'Version ' + APP_VERSION;
  openSheet(LEGAL_PAGES[which], wrap);
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-page]');
  if (b && LEGAL_PAGES[b.dataset.page]) openLegal(b.dataset.page);
});
(function readPageLink() {
  const params = new URLSearchParams(location.search);
  const page = params.get('page');
  if (!page || !LEGAL_PAGES[page]) return;
  params.delete('page');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  openLegal(page);
})();

(async function readInviteLink() {
  const code = new URLSearchParams(location.search).get('invite');
  $('signup-button').hidden = !BRIDGE;
  if (!code || !BRIDGE) return;
  state.pendingInvite = code;
  history.replaceState(null, '', location.pathname + location.hash);
  const banner = $('invite-banner');
  banner.textContent = 'You have been invited to join a Daybook. Create an account, or sign in if you already have one.';
  banner.hidden = false;
  try {
    const r = await fetch(BRIDGE.url.replace(/\/$/, '') + '/invite-info?code=' + encodeURIComponent(code));
    const info = await r.json();
    if (info.valid) banner.textContent = `${info.from ? info.from + ' has' : 'You have been'} invited ${info.name ? info.name + ' ' : ''}to join ${info.householdName ? info.householdName + '\'s' : 'a'} Daybook${info.role === 'family' ? '' : info.role === 'viewer' ? ' (medicines and treatment only)' : ' (read only)'}. Create an account, or sign in if you already have one.`;
    else { banner.textContent = info.message || 'That invite link is not right.'; state.pendingInvite = null; }
  } catch (e) { /* the banner already says enough */ }
})();

function friendlyAuthError(e) {
  const code = (e && e.code) || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Email or password not recognised.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a few minutes and try again.';
  if (code.includes('network')) return 'No connection. Check the signal and try again.';
  if (code.includes('email-already-in-use')) return 'There is already a sign-in with that email. Sign in instead, or use Forgotten your password.';
  if (code.includes('weak-password')) return 'Choose a longer password, at least 8 characters.';
  if (code.includes('invalid-email')) return 'That email address does not look right.';
  if (code.includes('operation-not-allowed')) return 'Creating accounts is switched off at the moment.';
  return 'Could not sign in. ' + (e && e.message ? e.message : '');
}

onAuthStateChanged(auth, (user) => enterApp(user));

/* Runs on every sign-in state change, and again from the Sign in button when a
   signed-in person's account could not be checked the first time. */
async function enterApp(user) {
  const account = user ? await loadAccount(user) : null;
  if (user && account && account.missing) {
    /* Signed in, but in no household: join the one an invite link is for, or make one (since v78) */
    if (state.pendingInvite && BRIDGE) {
      const code = state.pendingInvite; state.pendingInvite = null;
      try { await bridgeCall('/join', { code }); return enterApp(user); }
      catch (e) { toast(e.message); }
    }
    showNoHousehold(user);
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
    state.household = account.household;
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
    state.household = null;
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
    state.household = DEMO_HOUSEHOLD;
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
  state.household = null;
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
    writes.slice(i, i + 400).forEach(([col, id, data]) => batch.set(hdoc(col, id), demoClean(data)));
    await batch.commit();
  }
}
/* A demo seeded before the carer's view existed gets the check-ins and sessions of the cycle chart added once */
async function topUpDemo() {
  const carer = await getDocs(query(hcol('entries'), where('slot', '==', 'carer'), limit(1)));
  if (!carer.empty) return;
  const fixture = buildDemoFixture();
  const writes = [];
  fixture.entries.filter((e) => e.type === 'checkin').forEach((e) => { const { id, ...data } = e; writes.push(['entries', id, data]); });
  Object.entries(fixture.days).forEach(([k, d]) => { if (d.chemo) writes.push(['days', k, d]); });
  await writeDemo(writes);
}
async function seedDemoIfEmpty() {
  const snap = await getDocs(hcol('medicines'));
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
    e(-2, '09:10', 'Mark', { type: 'bowel', none: false, bristol: 6, urgent: true }),
    e(-2, '13:40', 'Mark', { type: 'bowel', none: false, bristol: 7 }),
    e(-1, '08:30', 'Mark', { type: 'bowel', none: false, bristol: 4 }),
    e(0, '07:50', 'Mark', { type: 'bowel', none: false, bristol: 5, note: 'Better than yesterday' }),
    e(-2, '11:20', 'Mark', { type: 'symptom', what: 'Sickness', value: 6, note: 'Queasy after the tablets' }),
    e(-1, '10:30', 'Mark', { type: 'med', medId: null, medName: 'Sodium chloride 0.9%', dose: '1000 ml', route: 'drip', hospital: true, note: 'Over 4 hours' }),
    e(-1, '20:10', 'Mark', { type: 'symptom', what: 'Mouth', value: 3, note: 'Sore on the left' }),
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

  const doneAll = { pressups: true, situps: true, plank: true, squats: true, walk: true, ankle: true, heel: true };
  /* the example swim falls on yesterday's weekday and two others, so yesterday's Pool Swim ticks it and today is a rest day for it */
  const yDow = parseDay(day(-1)).getDay();
  const swimDays = [yDow, (yDow + 2) % 7, (yDow + 4) % 7];
  const exercise = {};
  exercise[day(-2)] = { day: day(-2), steps: 2100, done: doneAll, workouts: [{ name: 'Outdoor Walk', minutes: 32, km: 1.8, kcal: 120, start: '10:15' }] };
  exercise[day(-1)] = { day: day(-1), steps: 2800, done: doneAll, workouts: [{ name: 'Pool Swim', minutes: 35, km: 0.8, kcal: 210, start: '07:30' }, { name: 'Outdoor Walk', minutes: 41, km: 2.4, kcal: 150, start: '09:50' }] };
  exercise[day(0)] = { day: day(0), steps: 1200, done: { pressups: true, situps: true, plank: false, squats: false, ankle: true }, workouts: [{ name: 'Outdoor Walk', minutes: 18, km: 1.1, kcal: 70, start: '08:40' }] };
  exercise[day(-4)] = { day: day(-4), steps: 1600, done: { pressups: true, situps: false, plank: false, squats: true } };
  exercise[day(-6)] = { day: day(-6), steps: 900, done: {} };

  const profile = {
    calls: [{ label: 'Oncology ward (example)', role: 'Ward 7, 24 hours', number: '01234 567890' }, { label: 'Sam (example)', role: 'Oncology nurse specialist', number: '01234 567892', email: 'nurses@example.org' }, { label: 'Hospice at home (example)', number: '01234 567891' }],
    programme: { items: [
      { id: 'pressups', name: 'Press-ups', section: 'exercise', kind: 'reps', amount: 20 },
      { id: 'situps', name: 'Sit-ups', section: 'exercise', kind: 'reps', amount: 20 },
      { id: 'plank', name: 'Plank', section: 'exercise', kind: 'seconds', amount: 60 },
      { id: 'squats', name: 'Squats', section: 'exercise', kind: 'reps', amount: 2 },
      { id: 'walk', name: 'Walk', section: 'exercise', kind: 'minutes', amount: 20, days: [1, 3, 5], match: 'walk', note: 'Round the block, slower on chemo days' },
      { id: 'swim', name: 'Swim', section: 'exercise', kind: 'lengths', amount: 30, pool: 25, days: swimDays, match: 'swim', since: day(-1), note: 'Gentle breaststroke' },
      { id: 'ankle', name: 'Ankle pumps', section: 'physio', kind: 'sets', amount: 20, sets: 3, note: 'Lying down, both feet' },
      { id: 'heel', name: 'Heel slides', section: 'physio', kind: 'sets', amount: 10, sets: 2, note: 'Slow, stop at the first pull' }
    ] },
    physio: { from: 'Community physio (example)', given: day(-12), notes: 'Twice a day. Stop if pain goes above 5 out of 10.' }
  };

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
  /* a hook for the Playwright harness, preview only: nothing here can reach Firestore */
  window.daybookPreview = { state, addEntry, renderExercise, exerciseLogFor };
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
    const snap = await getDocs(hcol('medicines'));
    if (!snap.empty) return;
    const batch = writeBatch(db);
    SEED_MEDICINES.forEach((m, i) => {
      const { id, ...data } = m;
      batch.set(hdoc('medicines', id), { ...data, active: true, order: i + 1 });
    });
    await batch.commit();
  } catch (e) {
    console.warn('Seed skipped', e);
  }
}

function watchMedicines() {
  state.unsub.meds = onSnapshot(hcol('medicines'), (snap) => {
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
  const q = query(hcol('entries'), where('day', '>=', from));
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
  const q = query(hcol('entries'), where('day', '==', state.selectedDay));
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
  state.unsub.docs = onSnapshot(hcol('documents'), (snap) => {
    state.documents = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.docDate || '').localeCompare(a.docDate || ''));
    renderDocsList();
  }, (e) => console.error(e));
}

function watchProfile() {
  state.unsub.profile = onSnapshot(hdoc('profile', 'main'), (snap) => {
    state.profile = snap.exists() ? snap.data() : { calls: [] };
    renderCalls();
    renderExercise();
    syncSettings();
    renderMeds();
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
  syncHealthCard();
  syncHouseholdCard();
  const nudge = $('settings-stretch-nudge');
  if (nudge) { const on = !!(state.profile && state.profile.stretchNudge); if (nudge.checked !== on) nudge.checked = on; nudge.disabled = state.readOnly || state.demo; }
}
/* Gentle nudge at 10:00 (v83): one notification if nothing has been logged on the Exercise tab by then. Household-wide, sent by the bridge to the phones with reminders on. */
$('settings-stretch-nudge').addEventListener('change', async (ev) => {
  const on = ev.target.checked;
  if (state.demo) { state.profile = { ...state.profile, stretchNudge: on }; return; }
  try { await setDoc(hdoc('profile', 'main'), { stretchNudge: on }, { merge: true }); toast(on ? 'Nudge on, at 10:00' : 'Nudge off'); }
  catch (e) { console.error(e); ev.target.checked = !on; toast('Could not change this setting'); }
});

/* Household card (since v78): who is in, invite someone, and for the owner, remove someone */
async function syncHouseholdCard() {
  const card = $('settings-household');
  if (!card) return;
  const show = !!BRIDGE && !!state.household && !state.demo && !state.demoLive && !state.readOnly && !state.viewer;
  card.hidden = !show;
  if (!show) return;
  const list = $('settings-members');
  try {
    const house = await getDoc(doc(db, 'households', state.household));
    const owner = house.exists() ? house.data().owner : '';
    $('settings-household-name').textContent = (house.exists() && house.data().name) || 'Household';
    const snap = await getDocs(hcol('members'));
    const me = state.user ? state.user.uid : '';
    const roleWord = { family: 'family', readonly: 'read only', viewer: 'medicines and treatment only' };
    const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.uid === owner ? -1 : b.uid === owner ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    list.replaceChildren(...rows.map((m) => {
      const sub = [roleWord[m.role] || m.role, m.relation, m.uid === owner ? 'owner' : '', m.uid === me ? 'you' : ''].filter(Boolean).join(', ');
      const row = h('li', { class: 'member' }, h('div', { class: 'member-main' }, h('div', { class: 'member-name', text: m.name || 'Member' }), h('div', { class: 'member-sub', text: sub })));
      if (owner === me && m.uid !== me) {
        const del = h('button', { class: 'btn btn-link btn-small', type: 'button', 'aria-label': 'Remove ' + (m.name || 'this member') }, 'Remove');
        del.addEventListener('click', () => {
          const yes = h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async () => { yes.disabled = true; try { await bridgeCall('/member-remove', { uid: m.uid }); toast((m.name || 'They') + ' no longer has access'); } catch (e) { toast(e.message); } syncHouseholdCard(); } }, 'Yes, remove');
          const keep = h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { yes.replaceWith(del); keep.remove(); } }, 'Keep');
          del.replaceWith(yes); yes.after(keep); yes.focus();
        });
        row.append(del);
      }
      return row;
    }));
  } catch (e) { console.warn(e); list.replaceChildren(h('li', { class: 'muted', text: 'Could not load the members.' })); }
}
/* Invite someone: name, access, who they are; the bridge makes a one-use link to share */
function openInviteSheet() {
  const name = h('input', { type: 'text', placeholder: 'e.g. Sam', maxlength: '40' });
  let role = 'family', relation = '';
  const roleRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'What they can do' });
  const relRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Who they are' });
  const chip = (label, on, onclick) => h('button', { class: 'preset' + (on ? ' is-active' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick }, label);
  const roleHint = h('p', { class: 'hint' });
  const ROLE_HINTS = { family: 'Can add, change and delete everything, and invite others.', readonly: 'Sees everything, changes nothing.', viewer: 'Sees only medicines, the treatment plan and the trend charts.' };
  const drawRole = () => { roleRow.replaceChildren(chip('Family', role === 'family', () => { role = 'family'; drawRole(); }), chip('Read only', role === 'readonly', () => { role = 'readonly'; drawRole(); }), chip('Medicines and treatment only', role === 'viewer', () => { role = 'viewer'; drawRole(); })); roleHint.textContent = ROLE_HINTS[role]; };
  const drawRel = () => relRow.replaceChildren(chip('A carer', relation === 'carer', () => { relation = 'carer'; drawRel(); }), chip('Family or friend', relation === '', () => { relation = ''; drawRel(); }), chip('The patient', relation === 'patient', () => { relation = 'patient'; drawRel(); }));
  drawRole(); drawRel();
  const result = h('div', { class: 'invitebox' });
  const makeBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
    if (!name.value.trim()) { toast('Their first name, please'); name.focus(); return; }
    makeBtn.disabled = true;
    try {
      const inv = await bridgeCall('/invite', { name: name.value.trim(), role, relation });
      const link = h('p', { class: 'mono keybox', text: inv.url });
      const share = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
        const text = `${state.name} has invited you to join ${inv.householdName || 'their'} Daybook. Open this link, then create an account or sign in: ${inv.url}`;
        if (navigator.share) { try { await navigator.share({ title: 'Daybook invite', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
        try { await navigator.clipboard.writeText(text); toast('Invite copied. Paste it into a message.'); } catch (e) { toast('Press and hold the link to copy it'); }
      } }, 'Share the invite');
      result.replaceChildren(h('p', { text: 'Send this to ' + name.value.trim() + '. It works once and expires in 7 days.' }), link, share);
      makeBtn.hidden = true;
    } catch (e) { toast(e.message); makeBtn.disabled = false; }
  } }, 'Make the invite link');
  const body = h('div', null,
    field('Their first name', name),
    h('p', { class: 'hint', text: 'What they can do' }), roleRow, roleHint,
    h('p', { class: 'hint', text: 'Who they are' }), relRow,
    makeBtn, result,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Done'));
  openSheet('Invite someone', body);
}
$('settings-invite').addEventListener('click', openInviteSheet);

/* Apple Health card (since v75): the bridge address and this household's inbox key, read from
   households/{id}/private/health (family only, written by the household workflows), so the
   Health Auto Export automation can be set up without the Firebase console. */
function syncHealthCard() {
  const card = $('settings-health');
  if (!card) return;
  const show = !!BRIDGE && !!state.household && !state.demo && !state.demoLive && !state.readOnly && !state.viewer;
  card.hidden = !show;
  if (!show) return;
  $('settings-health-url').textContent = BRIDGE.url.replace(/\/$/, '') + '/health';
  $('settings-health-keytext').hidden = true;
  $('settings-health-hint').hidden = true;
  $('settings-health-key').textContent = 'Show the inbox key';
}
$('settings-health-key').addEventListener('click', async () => {
  const box = $('settings-health-keytext'), hint = $('settings-health-hint'), btn = $('settings-health-key');
  if (!box.hidden) { box.hidden = true; hint.hidden = true; btn.textContent = 'Show the inbox key'; return; }
  btn.disabled = true;
  try {
    const snap = await getDoc(hdoc('private', 'health'));
    const key = snap.exists() ? snap.data().key : '';
    box.textContent = key || 'No inbox key yet. Make one with the Household admin workflow (new-key) on the Actions tab.';
    box.hidden = false;
    hint.hidden = false;
    hint.textContent = key ? 'Press and hold to copy it into the automation\'s X-Care-Log-Key header. Anyone with this key can send readings into this household, so keep it to the phone that needs it.' : '';
    btn.textContent = 'Hide the inbox key';
  } catch (e) { console.error(e); toast('Could not read the inbox key'); }
  btn.disabled = false;
});

/* The same account-wide setting, switchable from Settings and from the top of the Food diary */
async function setDetailedNutrition(detailedNutrition, input) {
  if (state.demo) { state.profile = { ...state.profile, detailedNutrition }; syncSettings(); toast(detailedNutrition ? 'Estimates on' : 'Estimates off'); return; }
  try { await setDoc(hdoc('profile', 'main'), { detailedNutrition }, { merge: true }); toast(detailedNutrition ? 'Estimates on' : 'Estimates off'); }
  catch (e) { console.error(e); toast('Could not save the setting'); input.checked = !detailedNutrition; }
}
$('settings-nutrition').addEventListener('change', (ev) => setDetailedNutrition(ev.target.checked, ev.target));
$('settings-protein').addEventListener('change', async (ev) => {
  const n = Math.round(parseFloat(ev.target.value));
  const proteinTarget = n > 0 ? n : null;
  if (state.demo) { state.profile = { ...state.profile, proteinTarget }; syncSettings(); toast(proteinTarget ? 'Protein target saved' : 'Protein target cleared'); return; }
  try { await setDoc(hdoc('profile', 'main'), { proteinTarget }, { merge: true }); toast(proteinTarget ? 'Protein target saved' : 'Protein target cleared'); }
  catch (e) { console.error(e); toast('Could not save the target'); }
});
$('food-nutrition').addEventListener('change', (ev) => setDetailedNutrition(ev.target.checked, ev.target));

function watchDays() {
  state.unsub.days = onSnapshot(hcol('days'), (snap) => {
    const days = {};
    snap.docs.forEach((d) => { days[d.id] = d.data(); });
    state.days = days;
    renderChemo();
  }, (e) => console.error(e));
}

function watchExercise() {
  state.unsub.exercise = onSnapshot(hcol('exercise'), (snap) => {
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
  state.unsub.nutrition = onSnapshot(hcol('nutrition'), (snap) => {
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
  state.unsub.meals = onSnapshot(hcol('meals'), (snap) => {
    state.meals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }, (e) => console.error(e));
}

const lastExerciseWrite = new Map();   // "exId|who" -> { at, id }
async function addEntry(data) {
  const at = data.at instanceof Date ? data.at : new Date();
  /* safety net: the same exercise by the same person within seconds is one tap counted twice, so return the first id and write nothing */
  const dupKey = data.type === 'exercise' ? (data.exId || data.note) + '|' + state.name : null;
  if (dupKey) {
    const prev = lastExerciseWrite.get(dupKey);
    if (prev && Date.now() - prev.at < DUP_WINDOW_MS) return prev.id;
  }
  const remember = (id) => { if (dupKey) lastExerciseWrite.set(dupKey, { at: Date.now(), id }); return id; };
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
    return remember(id);
  }
  const ref = doc(hcol('entries'));
  setDoc(ref, entry).catch((e) => { console.error(e); toast('Could not save. It will retry when online.'); });
  return remember(ref.id);
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
    renderMeds();
    if (!$('view-vitals').hidden) renderVitals();
    return;
  }
  const patch = { ...fields, updatedAt: serverTimestamp() };
  if (at) patch.at = Timestamp.fromDate(at);
  await updateDoc(hdoc('entries', id), patch);
}

function deleteEntry(id) {
  if (state.demo) {
    state.recentEntries = state.recentEntries.filter((e) => e.id !== id);
    state.dayEntries = state.dayEntries.filter((e) => e.id !== id);
    renderToday();
    renderMeds();
    return Promise.resolve();
  }
  return deleteDoc(hdoc('entries', id));
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
  document.title = page ? 'Daybook: ' + page : 'My Medical Daybook';
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
  syncAnswerDocs();
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
$('day-label').addEventListener('click', () => openDayPicker(state.selectedDay, (d) => { state.selectedDay = d; refreshDay(); }, loggedDaysIn));

/* The Meds tab shares Today's selected day, so a day picked on either one shows
   its own medicine adherence for that day, not always "right now". */
$('meds-day-prev').addEventListener('click', () => { state.selectedDay = addDays(state.selectedDay, -1); refreshDay(); });
$('meds-day-next').addEventListener('click', () => {
  if (state.selectedDay >= todayStr()) return;
  state.selectedDay = addDays(state.selectedDay, 1); refreshDay();
});
$('meds-day-label').addEventListener('click', () => openDayPicker(state.selectedDay, (d) => { state.selectedDay = d; refreshDay(); }, loggedDaysIn));

/* Go to a day (since v95): tapping the date between the arrows opens a month calendar. Days with anything
   logged are tinted, today is ringed, the day on screen is filled, days after today cannot be chosen.
   The arrows still step a day at a time. marked(month) resolves to a Set of "YYYY-MM-DD". */
const loggedMonths = {};
async function loggedDaysIn(month) {
  const set = new Set(state.recentEntries.filter((e) => e.day && e.day.startsWith(month)).map((e) => e.day));
  if (state.demo || month >= (state.recentFrom || '').slice(0, 7)) return set;
  if (!loggedMonths[month]) {
    try {
      const snap = await getDocs(query(hcol('entries'), where('day', '>=', month + '-01'), where('day', '<=', month + '-31')));
      loggedMonths[month] = new Set(snap.docs.map((d) => d.data().day));
    } catch (e) { console.error(e); return set; }
  }
  loggedMonths[month].forEach((d) => set.add(d));
  return set;
}
function openDayPicker(current, onPick, marked) {
  const today = todayStr();
  let month = current.slice(0, 7);
  const title = h('button', { class: 'cal-title', type: 'button', 'aria-label': 'Go to this month' });
  const grid = h('div', { class: 'cal-grid' });
  const prev = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Previous month', text: '\u2039' });
  const next = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Next month', text: '\u203A' });
  let drawn = 0;
  const render = async () => {
    const mine = ++drawn;
    const [y, m] = month.split('-').map(Number);
    title.textContent = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    next.disabled = month >= today.slice(0, 7);
    const draw = (logged) => {
      const startDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
      const cells = [];
      for (let i = 0; i < startDow; i++) cells.push(h('div', { class: 'cal-cell is-empty' }));
      for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
        const key = `${y}-${pad2(m)}-${pad2(d)}`;
        const has = logged.has(key);
        const cls = ['cal-cell'];
        if (key === today) cls.push('is-today');
        if (has) cls.push('is-logged');
        if (key === current) cls.push('is-selected');
        cells.push(h('button', { class: cls.join(' '), type: 'button', disabled: key > today,
          'aria-label': fmtDayLong(key) + (has ? ', something logged' : '') + (key === current ? ', showing now' : ''),
          'aria-current': key === current ? 'date' : null,
          onclick: () => { closeSheet(); onPick(key); } }, h('span', { class: 'cal-num', text: String(d) })));
      }
      grid.replaceChildren(...cells);
    };
    draw(new Set());
    const logged = marked ? await marked(month) : new Set();
    if (mine === drawn) draw(logged);
  };
  prev.addEventListener('click', () => { month = shiftMonth(month, -1); render(); });
  next.addEventListener('click', () => { if (month < today.slice(0, 7)) { month = shiftMonth(month, 1); render(); } });
  title.addEventListener('click', () => { month = today.slice(0, 7); render(); });
  const dow = h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('span', { text: d })));
  const body = h('div', { class: 'cal daypicker' },
    h('div', { class: 'cal-head' }, prev, title, next), dow, grid,
    h('p', { class: 'cal-key' }, h('span', { class: 'key-dot key-done' }), 'Something logged'),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { closeSheet(); onPick(today); } }, 'Go to today'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel'));
  openSheet('Go to a day', body);
  render();
}

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
    case 'med': return [h('span', { text: e.medName || 'Medicine' }), e.hospital ? h('span', { class: 'pill pill-hosp', text: 'Given in hospital' }) : null];
    case 'temp': return [h('span', { class: 'val ' + tempClass(e.value), text: fmtTemp(e.value) })];
    case 'drink': return [h('span', { text: e.note || 'Drink' }), e.value ? h('span', { class: 'val', text: '  ' + e.value + ' ml' }) : null];
    case 'food': return [h('span', { text: e.note || 'Food' })];
    case 'sleep': return [h('span', { class: 'val', text: fmtHm(e.value) }), h('span', { text: ' asleep' })];
    case 'checkin': return [h('span', { text: checkinTitle(e.slot) })];
    case 'pain': return [h('span', { class: 'val', text: 'Pain ' + e.value + '/10' })];
    case 'symptom': return [h('span', { class: 'val', text: (e.what || 'Symptom') + ' ' + e.value + '/10' })];
    case 'bowel': {
      if (e.none) return [h('span', { text: 'No bowel movement' })];
      const ts = bowelTypes(e);
      return ts.length > 1
        ? [h('span', { class: 'val', text: 'Bowels: mixed' }), h('span', { text: ', types ' + joinAnd(ts.map(String)) })]
        : [h('span', { class: 'val', text: 'Bowels: type ' + ts[0] }), h('span', { text: ', ' + bristolName(ts[0]).toLowerCase() })];
    }
    case 'question': return [h('span', { text: e.note || 'Question' })];
    case 'exercise': return [h('span', { text: e.note || 'Exercise' })];
    case 'weight': return [h('span', { class: 'val', text: fmtKg(e.value) })];
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
  if (e.type === 'med' && e.hospital && e.route) bits.push(ROUTE_WORDS[e.route] || e.route);
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
  if (e.type === 'symptom') { bits.push('Symptom'); if (e.note) bits.push(e.note); }
  if (e.type === 'bowel') { const ts = bowelTypes(e); if (ts.length > 1) bits.push(ts.map((t) => bristolName(t)).join(', ')); const f = bowelFlagWords(e); if (f) bits.push(f); if (e.note) bits.push(e.note); }
  if (e.type === 'question') bits.push(e.answered ? 'Question for the team, answered' : 'Question for the team');
  if (e.type === 'question' && e.answerText) bits.push('Answer: ' + excerpt(e.answerText, 90));
  if (e.type === 'question' && e.recordings) bits.push(plural(e.recordings, 'recording'));
  if (e.type === 'weight' && e.note) bits.push(e.note);
  if (e.type === 'vitals' && e.note) bits.push(e.note);
  if (e.type === 'exercise') { const ex = exById(e.exId); bits.push('Exercise' + (ex ? ', ' + ex.target : '')); }
  bits.push('by ' + (e.addedBy || 'unknown'));
  return bits.join(' · ');
}

function sleepStages(e) {
  return [['awake', 'Awake'], ['rem', 'REM'], ['core', 'Core'], ['deep', 'Deep']]
    .filter(([k]) => e[k]).map(([k, label]) => label + ' ' + fmtHm(e[k])).join(' · ');
}

function renderEntry(e) {
  const d = entryDate(e);
  const cls = 'entry type-' + e.type + (e.type === 'temp' ? ' ' + tempClass(e.value) : '') + (e.hospital ? ' is-hospital' : '');
  /* a check-in is the same summary card as on Today: open it to read every answer, Edit to change them */
  if (e.type === 'checkin') {
    return h('li', { class: cls + ' has-card' },
      h('span', { class: 'entry-time', text: fmtTime(d) }),
      h('div', { class: 'entry-main' }, checkinCard(e, true)),
      state.readOnly ? null : h('button', { class: 'entry-menu', type: 'button', 'aria-label': 'Entry options', onclick: () => entryOptions(e) }, '⋯'));
  }
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
const EDITABLE_ENTRY_TYPES = ['food', 'drink', 'weight', 'note', 'question', 'bowel', 'symptom'];

function entryOptions(e) {
  const d = entryDate(e);
  const reading = e.type === 'temp' || e.type === 'vitals';
  const canEdit = EDITABLE_ENTRY_TYPES.includes(e.type) || (e.type === 'med' && e.hospital) || reading;
  const rows = readingRows(e);
  const body = h('div', null,
    rows.length ? null : h('p', null, h('strong', null, ...entryTitle(e).map((n) => n.cloneNode(true)))),
    rows.length ? h('dl', { class: 'readings' }, ...rows.flatMap(([k, v, lvl]) => [h('dt', { text: k }), h('dd', { class: lvl ? 'lvl-' + lvl : null, text: v })])) : null,
    h('p', { class: 'muted', text: `${fmtDayLong(e.day)} at ${fmtTime(d)}. ${entrySub(e)}` }),
    canEdit && !state.readOnly ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => (e.type === 'med' ? openHospitalDose(e) : openAdd(reading ? 'vitals' : e.type, e)) }, 'Edit') : null,
    e.type === 'checkin' ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { closeSheet(); openCheckin(e.slot, e.day); } }, 'Edit this check-in') : null,
    e.type === 'question' && !state.readOnly ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { closeSheet(); openAnswerSheet(e); } }, 'Record or write the answer') : null,
    e.type === 'question' ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: async () => {
      closeSheet();
      await updateEntry(e.id, e.answered ? { answered: false } : { answered: true, answeredAt: stampNow() });
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
  openSheet(ENTRY_SHEET_TITLES[e.type] || 'Entry', body);
}
const ENTRY_SHEET_TITLES = { temp: 'Temperature', vitals: 'Vitals', weight: 'Weight', med: 'Medicine', drink: 'Drink', food: 'Food', note: 'Note', sleep: 'Sleep', pain: 'Pain', bowel: 'Bowels', symptom: 'Symptom', question: 'Question for the team' };
/* One line per reading for the entry view, coloured with the same levels as Trends' tables */
function readingRows(e) {
  if (e.type === 'temp') return [['Temperature', fmtTemp(e.value), tempClass(e.value) === 'is-red' ? 'red' : tempClass(e.value) === 'is-amber' ? 'amber' : null]];
  if (e.type !== 'vitals') return [];
  const rows = [];
  if (e.heartRate) rows.push(['Heart rate', Math.round(e.heartRate) + ' bpm', e.heartRate >= 120 || e.heartRate <= 50 ? 'red' : e.heartRate >= 100 ? 'amber' : null]);
  if (e.systolic && e.diastolic) rows.push(['Blood pressure', Math.round(e.systolic) + '/' + Math.round(e.diastolic) + ' mmHg', e.systolic >= 160 || e.diastolic >= 100 || e.systolic <= 90 ? 'red' : e.systolic >= 140 || e.diastolic >= 90 ? 'amber' : null]);
  if (e.oxygen) rows.push(['Oxygen', Math.round(e.oxygen) + '%', e.oxygen <= 90 ? 'red' : e.oxygen <= 93 ? 'amber' : null]);
  return rows;
}

function renderTiles() {
  const entries = state.dayEntries;
  const temps = entries.filter((e) => e.type === 'temp');
  const tileT = $('tile-temp');
  tileT.classList.remove('is-red', 'is-amber', 'is-green');
  if (temps.length) {
    const t = temps[0];
    countTo($('tile-temp-value'), Number(t.value), { decimals: 1, unit: '\u00B0C' });
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

  const sched = activeScheduled(state.selectedDay).filter((m) => !m.hospital); // the nurses' doses are counted on their card, never owed
  const need = sched.reduce((s, m) => s + (m.perDay || 1), 0);
  const done = sched.reduce((s, m) => s + Math.min(m.perDay || 1, countMedOnDay(m.id, state.selectedDay)), 0);
  countTo($('tile-meds-value'), done, { format: (n) => Math.round(n) + ' of ' + need });
  const tileM = $('tile-meds');
  tileM.classList.toggle('is-green', need > 0 && done >= need);
  $('tile-meds-sub').textContent = need > 0 && done >= need ? 'all done' : 'doses taken';
}

/* Quick add */
document.querySelectorAll('.qa').forEach((b) => b.addEventListener('click', () => (b.dataset.add === 'medicine' ? openDoseSheet() : openAdd(b.dataset.add))));

/* Log a dose from Today (since v92): the when-needed medicines first with their status, then today's
   scheduled ones with the count so far; a tap logs it now through the same logMed() as the Meds tab
   (so a blocked when-needed one still asks first). Another time means the Meds tab. */
function openDoseSheet() {
  const today = todayStr();
  const row = (m, status) => {
    const pill = status ? h('span', { class: 'pill pill-' + status.level, text: status.text }) : null;
    return h('button', { class: 'pickrow doserow', type: 'button', onclick: async () => { closeSheet(); await logMed(m); } },
      h('span', { class: 'pickrow-main' }, h('span', { class: 'pickrow-title', text: m.name }), h('span', { class: 'pickrow-sub', text: m.dose + (m.purpose ? ' · ' + m.purpose : '') })),
      pill);
  };
  const prn = activePrn().filter((m) => !hospitalHidden(m));
  const sched = activeScheduled(today).filter((m) => !hospitalHidden(m));
  const body = h('div', null,
    h('p', { class: 'wiz-hint', text: 'Tap a medicine to log a dose now. For another time, use the Meds tab.' }),
    prn.length ? h('p', { class: 'fieldlabel', text: 'When needed' }) : null,
    prn.length ? h('div', { class: 'doserows' }, ...prn.map((m) => row(m, prnStatus(m)))) : null,
    sched.length ? h('p', { class: 'fieldlabel', text: 'Scheduled' }) : null,
    sched.length ? h('div', { class: 'doserows' }, ...sched.map((m) => { const n = countMedOnDay(m.id, today); if (m.hospital) return row(m, n ? { level: 'teal', text: n + ' given today' } : null); return row(m, m.perDay ? { level: n >= m.perDay ? 'green' : 'teal', text: n + ' of ' + m.perDay + ' today' } : null); })) : null,
    !prn.length && !sched.length ? h('p', { class: 'empty', 'data-art': 'pill', text: 'No medicines set up yet. Add them on the Meds tab.' }) : null,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => openHospitalDose(null) }, 'Given in hospital'),
    h('p', { class: 'hint', text: 'For a drip, an injection or anything the hospital gave that is not on your list.' }),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Log a dose', body);
}


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

/* Bowels (since v91). The Bristol Stool Chart, types 1 to 7, with the wording used on NHS charts;
   the extras are what the UKONS 24-hour triage tool and Macmillan ask about. Stored as
   { type: "bowel", none (bool), bristol (1 to 7 or null), blood, black, mucus, urgent, pain, night (bools), note }.
   Since v109 a movement can be several types at once (Mark: "made up of various types"): `types` holds
   every type ticked, lowest first, and `bristol` keeps the loosest of them, so anything that reads only
   `bristol` still errs towards the type that matters most. Read them through bowelTypes(). */
const BRISTOL = [
  { t: 1, name: 'Separate hard lumps', hint: 'Like nuts, hard to pass' },
  { t: 2, name: 'Lumpy sausage', hint: 'Sausage shaped but lumpy' },
  { t: 3, name: 'Cracked sausage', hint: 'Like a sausage with cracks on the surface' },
  { t: 4, name: 'Smooth and soft', hint: 'Like a sausage or snake, smooth and soft' },
  { t: 5, name: 'Soft blobs', hint: 'Soft blobs with clear edges, passed easily' },
  { t: 6, name: 'Mushy', hint: 'Fluffy pieces with ragged edges' },
  { t: 7, name: 'Watery', hint: 'Entirely liquid, no solid pieces' }
];
const BOWEL_FLAGS = [['blood', 'Blood (red)'], ['black', 'Black or tarry'], ['mucus', 'Mucus'], ['urgent', 'Urgent, or an accident'], ['pain', 'Pain or straining'], ['night', 'At night']];
function bristolName(t) { const b = BRISTOL.find((x) => x.t === Number(t)); return b ? b.name : ''; }
function bowelFlagWords(e) { return BOWEL_FLAGS.filter(([k]) => e[k]).map(([, label]) => label).join(' · '); }
function bowelTypes(e) {
  if (!e || e.type !== 'bowel' || e.none) return [];
  const list = Array.isArray(e.types) && e.types.length ? e.types : [e.bristol];
  return [...new Set(list.map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);
}
const isLoose = (e) => bowelTypes(e).some((t) => t >= 6);
const isHard = (e) => bowelTypes(e).some((t) => t <= 2);
/* hard and loose in the same movement, worth naming on its own in Notes for the team */
const isHardAndLoose = (e) => isLoose(e) && isHard(e);
const joinAnd = (xs) => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : (xs[0] || '');
/* "type 6, mushy" for one type; "mixed, types 2, 4 and 6" for several */
function bowelTypeText(e) {
  const ts = bowelTypes(e);
  if (!ts.length) return '';
  return ts.length === 1 ? 'type ' + ts[0] + ', ' + bristolName(ts[0]).toLowerCase() : 'mixed, types ' + joinAnd(ts.map(String));
}
/* Small line drawings of the seven types, in the icon style (stroke, currentColor) */
function bristolArt(t) {
  const d = {
    1: '<circle cx="10" cy="16" r="4"/><circle cx="22" cy="12" r="4"/><circle cx="34" cy="18" r="4"/><circle cx="48" cy="13" r="4"/>',
    2: '<path d="M8 16c0-5 4-6 8-6 3 0 3 4 6 4s3-4 6-4 3 4 6 4 3-4 6-4 3 4 6 4c4 0 7 1 7 2 0 5-4 6-8 6-3 0-3-4-6-4s-3 4-6 4-3-4-6-4-3 4-6 4-3-4-6-4c-4 0-7-1-7-2z"/>',
    3: '<rect x="6" y="9" width="52" height="14" rx="7"/><path d="M16 9v3M24 20v3M32 9v3M40 20v3M48 9v3"/>',
    4: '<path d="M6 20c6-10 14-12 22-8s16 2 30-6"/><path d="M6 24c6-10 14-12 22-8s16 2 30-6" opacity=".5"/>',
    5: '<path d="M8 20c0-4 3-7 8-7s8 3 8 7-3 5-8 5-8-1-8-5z"/><path d="M28 13c0-4 3-6 7-6s7 2 7 6-3 5-7 5-7-1-7-5z"/><path d="M46 22c0-4 2-6 6-6s6 2 6 6-2 4-6 4-6 0-6-4z"/>',
    6: '<path d="M8 18c1-5 4-7 7-5 2-3 6-3 7 0 3-2 6 0 5 4 2 2 1 5-2 5-2 3-6 3-8 1-3 2-7 1-8-2-2 0-3-2-1-3z"/><path d="M34 20c1-4 4-6 7-4 2-3 6-2 7 1 3-1 5 1 4 4 1 2 0 4-3 4-2 2-5 2-7 0-3 2-6 1-7-2-2 0-2-2-1-3z"/>',
    7: '<path d="M6 12c6-4 10 4 16 0s10 4 16 0 10 4 16 0"/><path d="M6 22c6-4 10 4 16 0s10 4 16 0 10 4 16 0"/>'
  }[t] || '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 32'); svg.setAttribute('class', 'bristol-art'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = d;
  return svg;
}

/* Symptom (since v92): a between-times symptom with a 1 to 10 score, the way the Pain tile works, for
   the things the evening check-in only asks about once a day. Stored { type "symptom", what, value, note }. */
const SYMPTOMS = ['Sickness', 'Mouth', 'Skin', 'Breathing', 'Dizziness', 'Tingling', 'Tiredness', 'Other'];

function openAdd(type, editEntry) {
  const day = editEntry ? editEntry.day : state.selectedDay;
  const time = timeInput(day);
  if (editEntry) time.value = fmtTime(entryDate(editEntry));
  const note = h('input', { type: 'text', placeholder: 'Optional note', value: (editEntry && editEntry.note) || '' });
  const body = h('div', null);
  let getData;
  let dateIn = null; // set by sheets that show their own Date box (Vitals), which then decides the day saved
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

  if (type === 'bowel') {
    /* The Bristol Stool Chart (the scale every nurse knows) as seven rows, one tap; the extras the
       24-hour triage lines ask about as tick chips; and a way to record a day with none, since
       constipation is an absence and cannot be flagged without it. */
    /* Several can be ticked: one movement can be hard lumps then mushy, say (v109). */
    const chosen = new Set(bowelTypes(editEntry));
    const rows = BRISTOL.map((b) => h('button', { class: 'bristol-row' + (chosen.has(b.t) ? ' is-on' : ''), type: 'button', 'aria-pressed': chosen.has(b.t) ? 'true' : 'false', dataset: { t: String(b.t) } },
      bristolArt(b.t), h('span', null, h('span', { class: 'bristol-name', text: 'Type ' + b.t + ': ' + b.name }), h('span', { class: 'bristol-hint', text: b.hint }))));
    const mark = () => rows.forEach((r) => { const on = chosen.has(Number(r.dataset.t)); r.classList.toggle('is-on', on); r.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    rows.forEach((r) => r.addEventListener('click', () => { const t = Number(r.dataset.t); if (chosen.has(t)) chosen.delete(t); else chosen.add(t); mark(); }));
    const flags = new Set(BOWEL_FLAGS.filter(([k]) => editEntry && editEntry[k]).map(([k]) => k));
    const flagBtns = BOWEL_FLAGS.map(([k, label]) => h('button', { class: 'preset' + (flags.has(k) ? ' is-active' : ''), type: 'button', text: label, 'aria-pressed': flags.has(k) ? 'true' : 'false',
      onclick: (ev) => { const b = ev.currentTarget; if (flags.has(k)) flags.delete(k); else flags.add(k); b.classList.toggle('is-active', flags.has(k)); b.setAttribute('aria-pressed', flags.has(k) ? 'true' : 'false'); } }));
    const bowelNote = h('textarea', { rows: '2', placeholder: 'Anything else (optional)' });
    if (editEntry && editEntry.note) bowelNote.value = editEntry.note;
    const hasNone = (d) => [...state.dayEntries, ...state.recentEntries].find((e) => e.type === 'bowel' && e.none && e.day === d);
    const hasReal = (d) => [...state.dayEntries, ...state.recentEntries].some((e) => e.type === 'bowel' && !e.none && e.day === d);
    const noneBtn = h('button', { class: 'btn btn-secondary btn-block btn-plain', type: 'button', text: 'No bowel movement ' + (day === todayStr() ? 'today' : 'this day'), onclick: async () => {
      if (hasReal(day)) { toast('One is already logged for ' + (day === todayStr() ? 'today' : fmtDayShort(day))); return; }
      if (hasNone(day)) { toast('Already recorded for ' + (day === todayStr() ? 'today' : fmtDayShort(day))); return; }
      closeSheet();
      const id = await addEntry({ type: 'bowel', none: true, bristol: null, note: '', at: atFromInputs(day, time.value) });
      toast('Recorded: no bowel movement', { label: 'Undo', onClick: () => deleteEntry(id) });
    } });
    body.append(
      h('p', { class: 'wiz-q', text: 'What was it like?' }),
      h('p', { class: 'wiz-hint', text: 'The Bristol Stool Chart, which the team uses. Tap the nearest. If it was a mix, tap every type in it.' }),
      h('div', { class: 'bristol', role: 'group', 'aria-label': 'Bristol stool type, tap every type in it' }, ...rows),
      h('p', { class: 'fieldlabel', text: 'Anything else? Tick what applies' }),
      h('div', { class: 'presets', role: 'group', 'aria-label': 'Anything else' }, ...flagBtns),
      field('Time', time),
      field('Note', bowelNote), speakButton(bowelNote) || '',
      editEntry ? '' : noneBtn
    );
    getData = () => {
      if (!chosen.size) { toast('Tap the type first'); return { hold: true }; }
      const types = [...chosen].sort((a, b) => a - b);
      const d = { type: 'bowel', none: false, types, bristol: types[types.length - 1], note: bowelNote.value.trim() };
      for (const [k] of BOWEL_FLAGS) d[k] = flags.has(k);
      /* a real movement replaces a "none" recorded earlier for the same day */
      const n = hasNone(day); if (n) deleteEntry(n.id);
      return d;
    };
  }

  if (type === 'symptom') {
    const known = editEntry && SYMPTOMS.includes(editEntry.what) ? editEntry.what : (editEntry ? 'Other' : '');
    const whatHidden = h('input', { type: 'hidden', value: known });
    const other = h('input', { type: 'text', placeholder: 'What is it?', maxlength: '40', value: editEntry && known === 'Other' ? editEntry.what : '' });
    const otherField = field('Which symptom', other);
    otherField.hidden = known !== 'Other';
    const chips = presets(SYMPTOMS, whatHidden, known);
    chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Which symptom');
    chips.addEventListener('click', () => { otherField.hidden = whatHidden.value !== 'Other'; if (!otherField.hidden) other.focus(); });
    const sl = sliderBlock({ kind: 'pain', q: 'How bad right now', low: '1 mild', high: '10 severe' }, editEntry ? editEntry.value : null);
    const symNote = h('textarea', { rows: '2', placeholder: 'What it is like, what helped (optional)' });
    if (editEntry && editEntry.note) symNote.value = editEntry.note;
    body.append(
      h('p', { class: 'wiz-q', text: 'Which symptom?' }), chips, otherField,
      h('p', { class: 'wiz-q', text: 'How bad right now?' }), ...sl.nodes,
      field('Time', time), field('Note', symNote), speakButton(symNote) || ''
    );
    getData = () => {
      const what = whatHidden.value === 'Other' ? other.value.trim() : whatHidden.value;
      if (!what) { toast('Tap the symptom first'); return { hold: true }; }
      const v = sl.value();
      if (v == null) { toast('Slide to a number first'); return { hold: true }; }
      return { type: 'symptom', what, value: v, note: symNote.value.trim() };
    };
  }

  if (type === 'weight') {
    const wIn = weightEntry(editEntry ? Number(editEntry.value) : null);
    body.append(...wIn.nodes, field('Time', time), field('Note', note));
    getData = () => {
      const w = wIn.read();
      if (w.empty || w.kg == null || w.kg < 20 || w.kg > 300) { toast('Could not read the weight. Type just the number.'); return { hold: true }; }
      return { type: 'weight', value: Math.round(w.kg * 10) / 10, note: note.value.trim() };
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
    /* A Date box, so a reading filled in later lands on the day it was taken, not on whichever day Today shows (Mark, 5 October) */
    dateIn = h('input', { type: 'date', value: day, max: todayStr(), required: true });
    const lastT = state.recentEntries.find((e) => e.type === 'temp');
    /* No placeholder numbers: a grey last reading inside the box looked like one already typed in, so weights went unsaved (Mark, 5 October). The last reading is a line under the box instead. */
    const temp = h('input', { class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Temperature in degrees' });
    const tHint = h('p', { class: 'hint' });
    const tUpdate = () => {
      const r = readTemp(temp);
      const v = r.value;
      tHint.textContent = v == null || isNaN(v) ? 'Leave blank if not taken.' + (lastT ? ' Last: ' + fmtTemp(lastT.value) + ', ' + whenLabel(lastT) + '.' : '')
        : (r.fromF != null ? r.fromF + ' \u00B0F is ' + fmtTemp(v) + '. ' : '') + tempWord(v);
      tHint.style.color = v == null || isNaN(v) ? '' : v >= 38 ? 'var(--red)' : v >= 37.5 ? 'var(--amber)' : 'var(--green)';
    };
    const tStep = (n) => {
      const base = readNum(temp).value;
      const v = base == null || isNaN(base) ? (lastT ? Number(lastT.value) : 37) : base;
      temp.value = (Math.round((v + n) * 10) / 10).toFixed(1);
      tUpdate();
    };
    temp.addEventListener('input', tUpdate);
    tUpdate();
    const hr = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off' });
    const sys = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off' });
    const dia = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off' });
    const o2 = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off' });
    const lastW = state.recentEntries.find((e) => e.type === 'weight');
    const wIn = weightEntry(null);
    /* Editing one saved reading (since v105): a temperature shows only the temperature box, a vitals entry only heart rate,
       blood pressure and oxygen, each filled in with what was saved; weight has its own edit sheet */
    const editing = editEntry && (editEntry.type === 'temp' || editEntry.type === 'vitals') ? editEntry.type : null;
    const tempBlock = h('div', null,
      h('span', { class: 'fieldlabel', text: 'Temperature (\u00B0C)' }),
      h('div', { class: 'bigvalue' },
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Down', onclick: () => tStep(-0.1) }, '\u2212'),
        temp, h('span', { class: 'unit', text: '\u00B0C' }),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Up', onclick: () => tStep(0.1) }, '+')
      ),
      tHint);
    const vitalsBlock = h('div', null,
      field('Heart rate (bpm)', hr),
      h('div', { class: 'field-row' }, field('Systolic', sys), field('Diastolic', dia)),
      field('Oxygen (%)', o2));
    const weightBlock = h('div', null, ...wIn.nodes,
      lastW ? h('p', { class: 'hint hint-small', text: 'Last: ' + fmtKg(lastW.value) + ' (' + fmtStLb(lastW.value) + '), ' + whenLabel(lastW) + '.' }) : '');
    if (editing === 'temp') { temp.value = Number(editEntry.value).toFixed(1); tUpdate(); }
    if (editing === 'vitals') {
      if (editEntry.heartRate) hr.value = String(editEntry.heartRate);
      if (editEntry.systolic) sys.value = String(editEntry.systolic);
      if (editEntry.diastolic) dia.value = String(editEntry.diastolic);
      if (editEntry.oxygen) o2.value = String(editEntry.oxygen);
    }
    tempBlock.hidden = editing === 'vitals';
    vitalsBlock.hidden = editing === 'temp';
    weightBlock.hidden = !!editing;
    body.append(
      h('p', { class: 'hint', text: editing ? 'Change what was saved, then Save changes. To remove the reading, use Delete in the entry menu instead.' : 'Fill in whichever readings you have. At least one is needed to save.' }),
      tempBlock, vitalsBlock, weightBlock,
      h('div', { class: 'field-row' }, field('Date', dateIn), field('Time', time)),
      field('Note', note)
    );
    getData = () => {
      const noteV = note.value.trim();
      /* Every box is read as typed. Anything typed that cannot be read, or is outside a believable range,
         stops the save and says which box, so a reading is never silently left out (Mark, 5 October:
         daily weights typed and "saved", but only two ever reached the database). */
      /* temperature in C (90 to 110 read as F and converted), weight in kg whichever boxes were used */
      const tRead = readTemp(temp);
      const w = wIn.read();
      const boxes = [
        { name: 'temperature', el: temp, lo: 30, hi: 45, ...tRead },
        ...[['heart rate', hr, 20, 250], ['systolic', sys, 50, 260], ['diastolic', dia, 20, 160], ['oxygen', o2, 50, 100]].map(([name, el, lo, hi]) => ({ name, el, lo, hi, ...readNum(el) })),
        { name: 'weight', el: w.el || wIn.first, lo: 20, hi: 300, empty: w.empty, value: w.kg, raw: w.raw }
      ];
      const bad = boxes.find((b) => !b.empty && (b.value == null || b.value < b.lo || b.value > b.hi));
      if (bad) {
        const shown = bad.raw || bad.el.value.trim();
        const like = bad.name === 'weight' ? (weightPref() === 'stlb' ? ', like 12 and 10' : ', like 80.6') : '';
        toast(`Could not read the ${bad.name} "${shown}". Type just the number${like}.`);
        bad.el.focus();
        return { hold: true };
      }
      const val = (name) => boxes.find((b) => b.name === name).value;
      if (editing === 'temp') {
        if (val('temperature') == null) { toast('Type the temperature, or use Delete to remove the reading'); temp.focus(); return { hold: true }; }
        return [{ type: 'temp', value: Math.round(val('temperature') * 10) / 10, note: noteV }];
      }
      if (editing === 'vitals') {
        if ((val('systolic') != null) !== (val('diastolic') != null)) { toast('Blood pressure needs both numbers, systolic and diastolic'); return { hold: true }; }
        const r = (n) => (val(n) != null ? Math.round(val(n)) : null);
        const one = { type: 'vitals', note: noteV, heartRate: r('heart rate'), systolic: r('systolic'), diastolic: r('diastolic'), oxygen: r('oxygen') };
        if (one.heartRate == null && one.systolic == null && one.oxygen == null) { toast('Type at least one reading, or use Delete to remove it'); hr.focus(); return { hold: true }; }
        return [one];
      }
      const out = [];
      if (val('temperature') != null) out.push({ type: 'temp', value: Math.round(val('temperature') * 10) / 10, note: noteV });
      const data = { type: 'vitals', note: noteV };
      let has = false;
      if (val('heart rate') != null) { data.heartRate = Math.round(val('heart rate')); has = true; }
      if ((val('systolic') != null) !== (val('diastolic') != null)) { toast('Blood pressure needs both numbers, systolic and diastolic'); return { hold: true }; }
      if (val('systolic') != null) { data.systolic = Math.round(val('systolic')); data.diastolic = Math.round(val('diastolic')); has = true; }
      if (val('oxygen') != null) { data.oxygen = Math.round(val('oxygen')); has = true; }
      if (has) out.push(data);
      if (val('weight') != null) out.push({ type: 'weight', value: Math.round(val('weight') * 10) / 10, note: noteV });
      return out.length ? out : null;
    };
  }

  const titles = { drink: 'Drink', food: 'Food', weight: 'Weight', note: 'Note', vitals: 'Vitals', sleep: 'Sleep', question: 'Question for the team', pain: 'Log pain', bowel: 'Bowels', symptom: 'Symptom' };
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Save');
  save.addEventListener('click', async () => {
    const data = getData();
    if (data && data.hold) return;
    if (!data) { toast('Please check the value'); return; }
    const saveDay = dateIn ? dateIn.value : day;
    if (!saveDay || saveDay > todayStr()) { toast('Please choose a date up to today'); return; }
    const at = atFromInputs(saveDay, time.value);
    const list = Array.isArray(data) ? data : [data];
    closeSheet();
    if (editId) {
      try { await updateEntry(editId, { ...list[0], at, ...(dateIn ? { day: saveDay } : {}) }); toast(titles[type] + ' updated'); }
      catch (e) { console.error(e); toast('Could not save'); }
      if (!$('view-food').hidden) renderFoodDiary();
      return;
    }
    const ids = [];
    for (const d of list) { d.at = at; ids.push(await addEntry(d)); }
    const whenSaved = saveDay === todayStr() ? '' : ' for ' + fmtDayShort(saveDay);
    const what = type === 'vitals' ? ': ' + savedVitalsText(list) : '';
    toast(titles[type] + ' saved' + whenSaved + what, { label: 'Undo', onClick: () => ids.forEach((id) => deleteEntry(id)) });
    if (!$('view-food').hidden) renderFoodDiary();
    if (type === 'food') promptMealMeds(at);
  });
  body.append(save, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel'));
  if (editId) save.textContent = 'Save changes';
  openSheet(editId && type === 'vitals' ? (editEntry.type === 'temp' ? 'Edit temperature' : 'Edit vitals') : titles[type], body);
}

/* "temperature 36.8 °C, oxygen 95%, weight 80.6 kg": every reading a Vitals save wrote, so a missing one shows at once */
function savedVitalsText(list) {
  const bits = [];
  for (const d of list) {
    if (d.type === 'temp') bits.push('temperature ' + fmtTemp(d.value));
    if (d.type === 'weight') bits.push('weight ' + fmtKg(d.value) + (weightPref() === 'stlb' ? ' (' + fmtStLb(d.value) + ')' : ''));
    if (d.type === 'vitals') {
      if (d.heartRate) bits.push('heart rate ' + d.heartRate);
      if (d.systolic) bits.push('blood pressure ' + d.systolic + '/' + d.diastolic);
      if (d.oxygen) bits.push('oxygen ' + d.oxygen + '%');
    }
  }
  return bits.join(', ');
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
  const ref = id ? hdoc('meals', id) : doc(hcol('meals'));
  const data = { name, parts, updatedAt: serverTimestamp(), ...usage };
  if (portions) data.portions = portions;
  if (!id) { data.addedBy = state.name; data.createdAt = serverTimestamp(); }
  return setDoc(ref, data, { merge: true }).catch((e) => { console.error(e); toast('Could not save the meal'); });
}

function deleteMeal(id) {
  if (state.demo) { state.meals = state.meals.filter((m) => m.id !== id); return Promise.resolve(); }
  return deleteDoc(hdoc('meals', id)).catch((e) => { console.error(e); toast('Could not remove the meal'); });
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
  /* A chart drawn as vectors (since v111): shaded threshold bands, a light grid, day labels, then
     bars (stacked) or lines with points, a legend when there is more than one series, and a note. */
  const chart = (b) => {
    const plotH = 120, legend = (b.series || []).filter((s) => s.label).length + (b.stacks || []).length > 1;
    const blockH = 20 + plotH + 16 + (legend ? 16 : 0) + (b.note ? 14 : 0) + 14;
    if (y + blockH > H - 48) { footer(); pdf.addPage(); y = M; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11.5); pdf.setTextColor(0);
    pdf.text(b.title, M, y + 11);
    const px = M + 42, pw = maxW - 42, py = y + 20, ph = plotH;
    const X = (f) => px + f * pw;
    const Y = (v) => py + ph - ((Math.min(Math.max(v, b.lo), b.hi) - b.lo) / (b.hi - b.lo)) * ph;
    (b.bands || []).forEach((band) => { pdf.setFillColor(...band.rgb); const t = Y(Math.min(band.hi, b.hi)), btm = Y(Math.max(band.lo, b.lo)); if (btm > t) pdf.rect(px, t, pw, btm - t, 'F'); });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setLineWidth(0.4);
    b.ticks.forEach((v) => { pdf.setDrawColor(222); pdf.line(px, Y(v), px + pw, Y(v)); pdf.setTextColor(110); pdf.text(b.fmt(v), px - 5, Y(v) + 3, { align: 'right' }); });
    pdf.setDrawColor(170); pdf.line(px, py + ph, px + pw, py + ph);
    const n = b.days.length, slot = pw / n, every = Math.ceil(n / 8);
    pdf.setTextColor(110);
    b.days.forEach((d, i) => { if (i % every === 0 || (i === n - 1 && (n - 1) % every >= every / 2)) pdf.text(d, X((i + 0.5) / n), py + ph + 11, { align: 'center' }); });
    if (b.stacks) {
      const bw = Math.min(slot * 0.62, 22);
      for (let i = 0; i < n; i++) {
        let cum = 0;
        b.stacks.forEach((st) => { const v = Number(st.values[i]) || 0; if (v <= 0) return; pdf.setFillColor(...st.rgb); const t = Y(cum + v), btm = Y(cum); pdf.rect(X((i + 0.5) / n) - bw / 2, t, bw, Math.max(0.5, btm - t), 'F'); cum += v; });
      }
    }
    (b.series || []).forEach((sr) => {
      const pts = sr.pts.slice().sort((a, c) => a.x - c.x);
      if (sr.line !== false && pts.length > 1) {
        pdf.setDrawColor(...sr.rgb); pdf.setLineWidth(1.4);
        for (let k = 1; k < pts.length; k++) pdf.line(X(pts[k - 1].x), Y(pts[k - 1].y), X(pts[k].x), Y(pts[k].y));
      }
      pts.forEach((pt) => {
        const rgb = pt.rgb || sr.rgb;
        if (sr.hollow) { pdf.setDrawColor(...rgb); pdf.setFillColor(255, 255, 255); pdf.setLineWidth(1.2); pdf.circle(X(pt.x), Y(pt.y), 2.6, 'FD'); }
        else { pdf.setFillColor(...rgb); pdf.circle(X(pt.x), Y(pt.y), 2.2, 'F'); }
      });
    });
    let ly = py + ph + 26;
    if (legend) {
      let lx = px;
      pdf.setFontSize(8.5); pdf.setTextColor(60);
      [...(b.series || []).filter((sr) => sr.label), ...(b.stacks || [])].forEach((it) => {
        pdf.setFillColor(...it.rgb);
        if (it.hollow) { pdf.setDrawColor(...it.rgb); pdf.setFillColor(255, 255, 255); pdf.circle(lx + 4, ly - 3, 3, 'FD'); } else pdf.rect(lx, ly - 7, 8, 8, 'F');
        pdf.text(it.label, lx + 12, ly);
        lx += 12 + pdf.getTextWidth(it.label) + 14;
      });
      ly += 14;
    }
    if (b.note) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(110); pdf.text(pdf.splitTextToSize(b.note, maxW)[0], M, ly); }
    y += blockH;
  };
  blocks.forEach((b) => {
    if (b.kind === 'flag') flag(b);
    else if (b.kind === 'chart') chart(b);
    else if (b.kind === 'question') question(b);
    else if (b.kind === 'note') note(b);
    else if (b.kind === 'heading') { if (b.keep && y + b.keep > H - 48) { footer(); pdf.addPage(); y = M; } y += 10; write(b.text, 14, 'bold', PDF_TEAL, 0); pdf.setDrawColor(200); pdf.setLineWidth(0.5); pdf.line(M, y + 1, M + maxW, y + 1); y += 8; }
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
    const snap = await getDocs(query(hcol('entries'), where('day', '>=', from)));
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
  return setDoc(hdoc('profile', 'main'), { customFoods: current }, { merge: true }).catch((e) => { console.error(e); toast('Could not save to My foods'); });
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
      try { await setDoc(hdoc('nutrition', day), { ...data, updatedAt: serverTimestamp() }, { merge: true }); toast('Day totals saved'); }
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

/* Send to the team (since v112): the notes PDF, with the charts ticked, handed to the phone's own
   Mail app (the share sheet) with a subject and a short covering message, for a contact from Who to
   contact who has an email address. Nothing goes through Daybook: the email is sent from the
   person's own account, so the hospital knows the sender and replies come straight back. The share
   sheet cannot fill in the recipient, so the address is copied for pasting into To. Where files
   cannot be shared (most desktops) the PDF is downloaded and a new email opens addressed and
   filled in, to attach it to. */
const TEAM_WORDS = /\b(ward|unit|team|clinic|department|hospice|surgery|centre|center|practice|office|desk|line)\b/i;
function greetingFor(c) { return TEAM_WORDS.test(c.label) ? 'Hello,' : 'Hello ' + String(c.label).split(/\s+/)[0] + ','; }
function sendableContacts() { return ((state.profile && state.profile.calls) || []).filter((c) => c.email && EMAIL_RE.test(c.email)); }
function openSendSheet() {
  const n = state.notesPdf;
  if (!n) return;
  loadScript(CDN.jspdf).catch(() => {}); // warmed now so the PDF is ready by the time Send is tapped
  const body = h('div');
  const range = `${fmtDayNum(n.from)} to ${fmtDayNum(n.to)}`;
  const pick = () => {
    const contacts = sendableContacts();
    body.replaceChildren(
      h('p', { class: 'wiz-q', text: 'Who to?' }),
      contacts.length
        ? h('div', { class: 'picklist' }, ...contacts.map((c) => h('button', { class: 'pickrow', type: 'button', onclick: () => compose(c) },
            h('span', { class: 'pickrow-main' }, h('span', { class: 'pickrow-title', text: c.label }), h('span', { class: 'pickrow-sub', text: [c.role, c.email].filter(Boolean).join(' · ') })),
            icon('chevron'))))
        : h('p', { class: 'empty', 'data-art': 'call', text: 'No contacts with an email address yet. Add your nurse or the team under Who to contact.' }),
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { closeSheet(); setTimeout(() => $('calls-edit').click(), 50); } }, contacts.length ? 'Add or change contacts' : 'Add a contact'),
      h('button', { class: 'btn btn-link btn-block', type: 'button', onclick: closeSheet }, 'Cancel'));
  };
  const compose = (c) => {
    const pdf = currentNotesPdf();
    const chartCount = pdf.blocks.filter((b) => b.kind === 'chart').length;
    const fname = `Daybook notes for the team ${n.to}.pdf`;
    let blob = null;
    (async () => { try { await loadScript(CDN.jspdf); blob = buildPdfBlob(pdf.title, pdf.subtitle, pdf.blocks); } catch (e) { console.error(e); } })();
    const subject = h('input', { type: 'text', id: 'send-subject', value: `Notes before our appointment, ${range}` });
    const note = h('textarea', { id: 'send-note', rows: '6' });
    note.value = `${greetingFor(c)}\n\nAhead of our next appointment, here are my notes from Daybook for ${range}: my questions first, then a summary of the period${chartCount ? ' and charts of the readings' : ''}. The PDF is attached.\n\nThank you,\n${state.name || ''}`.trim();
    const send = h('button', { class: 'btn btn-primary btn-block', type: 'button', id: 'send-go' }, 'Open in my Mail app');
    send.addEventListener('click', () => {
      if (!blob) { toast('Still making the PDF. Try again in a moment.'); return; }
      const file = new File([blob], fname, { type: 'application/pdf' });
      copyText(c.email); // copied inside the tap, before the share sheet, for pasting into To
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: subject.value.trim(), text: note.value.trim() })
          .then(() => { closeSheet(); toast(c.email + ' is copied. Paste it into To if your Mail app has not.'); })
          .catch((e) => { if (!e || e.name !== 'AbortError') toast('Could not open the share sheet'); });
        return;
      }
      const url = URL.createObjectURL(blob);
      const dl = h('a', { href: url, download: fname }); document.body.append(dl); dl.click(); dl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const mail = h('a', { href: 'mailto:' + encodeURIComponent(c.email) + '?subject=' + encodeURIComponent(subject.value.trim()) + '&body=' + encodeURIComponent(note.value.trim()) });
      document.body.append(mail); mail.click(); mail.remove();
      closeSheet();
      toast('The PDF is in your Downloads as "' + fname + '". Attach it to the email that has opened.');
    });
    body.replaceChildren(
      h('div', { class: 'sendto' },
        h('span', { class: 'sendto-label', text: 'To' }),
        h('span', { class: 'sendto-name', text: c.label + (c.role ? ', ' + c.role : '') }),
        h('span', { class: 'sendto-email', text: c.email }),
        h('button', { class: 'btn-inline sendto-copy', type: 'button', onclick: () => { copyText(c.email); toast('Address copied'); } }, 'Copy address')),
      field('Subject', subject),
      field('Message', note),
      h('p', { class: 'sendpdf' }, h('b', { text: `Attached: Notes for the team, ${range}, ${chartCount ? plural(chartCount, 'chart') : 'no charts'}.` }), ' Change the charts on the Notes screen before sending.'),
      h('p', { class: 'hint', text: 'Your Mail app opens with the PDF and this message, sent from your own email address. The address is copied as well, to paste into To if it is not filled in.' }),
      send,
      h('button', { class: 'btn btn-link btn-block', type: 'button', onclick: pick }, 'Choose someone else'));
    subject.focus();
  };
  pick();
  openSheet('Send to the team', body);
}
$('notes-send').addEventListener('click', openSendSheet);
$('notes-record').addEventListener('click', openAppointmentSheet);

$('notes-pdf').addEventListener('click', () => { const n = currentNotesPdf(); if (n) savePdf(n.filename, n.title, n.subtitle, n.blocks); });
$('notes-preview').addEventListener('click', () => { const n = currentNotesPdf(); if (n) previewPdf(n.title, n.subtitle, n.blocks); });

/* The PDF is for people (the clinic, the folder), so it carries the report without the request to the AI app */
/* Charts for Notes for the team (since v111): the Trends charts redrawn as vectors in the PDF, for
   the report's own range, so it reads like a report and needs no screenshots. Kilograms and degrees
   Celsius, like the rest of the report. Colours are fixed RGB for white paper (PDFs are always light). */
const PDF_RGB = { teal: [30, 95, 116], tealMid: [92, 150, 170], tealPale: [160, 196, 208], warm: [194, 112, 61], amber: [154, 91, 0], red: [164, 38, 44], grey: [176, 184, 188], amberBand: [251, 238, 214], redBand: [249, 224, 224] };
const REPORT_CHART_ORDER = ['temp', 'heart', 'bp', 'oxygen', 'weight', 'sleep', 'pain', 'mood', 'drink', 'bowel'];
const REPORT_CHART_NAME = { temp: 'Temperature', heart: 'Heart rate', bp: 'Blood pressure', oxygen: 'Oxygen', weight: 'Weight', sleep: 'Sleep', pain: 'Pain', mood: 'Mood', drink: 'Drinks', bowel: 'Bowels' };
const CHART_TOPIC_KEY = { Temperature: 'temp', 'Heart rate': 'heart', 'Blood pressure': 'bp', Oxygen: 'oxygen', Weight: 'weight', Sleep: 'sleep', Pain: 'pain', Mood: 'mood', Drinks: 'drink', Bowels: 'bowel' };
/* The charts ticked when nothing has been chosen: these four whenever they have readings, plus any flagged in the summary */
const REPORT_CHART_DEFAULTS = ['temp', 'sleep', 'pain', 'weight'];
function niceScale(lo, hi, maxTicks) {
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const rough = (hi - lo) / (maxTicks || 5);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo: a, hi: b, ticks };
}
function reportCharts(entries, from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const labels = days.map((d) => parseDay(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  const start = parseDay(from).getTime(), end = parseDay(addDays(to, 1)).getTime();
  const fx = (e) => (entryDate(e).getTime() - start) / (end - start);
  const out = [];
  const line = (key, title, series, o) => {
    const all = series.flatMap((s) => s.pts.map((p) => p.y));
    if (!all.length) return;
    /* a minimum span (weight: 4 kg) so a small wobble is not drawn as a cliff */
    let lo = Math.min(...all), hi = Math.max(...all);
    if (o.minSpan && hi - lo < o.minSpan) { const mid = (hi + lo) / 2; lo = mid - o.minSpan / 2; hi = mid + o.minSpan / 2; }
    const sc = o.fixed || niceScale(lo, hi, 5);
    out.push({ key, title, block: { kind: 'chart', title, days: labels, lo: sc.lo, hi: sc.hi, ticks: sc.ticks, fmt: o.fmt, series, bands: o.bands, note: o.note } });
  };
  const bars = (key, title, stacks, o) => {
    const totals = days.map((_, i) => stacks.reduce((t, s) => t + (Number(s.values[i]) || 0), 0));
    if (!totals.some((v) => v > 0)) return;
    const sc = niceScale(0, Math.max(o.min || 0, ...totals), 4);
    out.push({ key, title, block: { kind: 'chart', title, days: labels, lo: 0, hi: sc.hi, ticks: sc.ticks, fmt: o.fmt, stacks, note: o.note } });
  };
  const ticks = (a, b, step) => { const t = []; for (let v = a; v <= b; v += step) t.push(v); return t; };
  const temps = entries.filter((e) => e.type === 'temp' && Number(e.value) > 0);
  line('temp', 'Temperature (°C)', [{ rgb: PDF_RGB.teal, pts: temps.map((e) => { const v = Number(e.value); return { x: fx(e), y: v, rgb: v >= 38 ? PDF_RGB.red : v >= 37.5 ? PDF_RGB.amber : PDF_RGB.teal }; }) }],
    { fixed: { lo: 35, hi: 40, ticks: ticks(35, 40, 1) }, fmt: (v) => v.toFixed(1), bands: [{ lo: 37.5, hi: 38, rgb: PDF_RGB.amberBand }, { lo: 38, hi: 40, rgb: PDF_RGB.redBand }], note: 'Shaded: 37.5 to 37.9 °C amber, 38.0 °C and over red.' });
  const vit = entries.filter((e) => e.type === 'vitals');
  const hr = vit.filter((e) => Number(e.heartRate) > 0);
  const hrVals = hr.map((e) => Number(e.heartRate));
  line('heart', 'Heart rate (beats a minute)', [{ rgb: PDF_RGB.teal, pts: hr.map((e) => ({ x: fx(e), y: Number(e.heartRate) })) }],
    { fixed: hrVals.length ? niceScale(Math.min(50, ...hrVals), Math.max(110, ...hrVals), 5) : null, fmt: (v) => String(v), bands: [{ lo: 100, hi: 120, rgb: PDF_RGB.amberBand }, { lo: 120, hi: 250, rgb: PDF_RGB.redBand }], note: 'Shaded: 100 to 119 amber, 120 and over red.' });
  const bp = vit.filter((e) => Number(e.systolic) > 0 && Number(e.diastolic) > 0);
  line('bp', 'Blood pressure (mmHg)', [{ label: 'Systolic', rgb: PDF_RGB.teal, pts: bp.map((e) => ({ x: fx(e), y: Number(e.systolic) })) }, { label: 'Diastolic', rgb: PDF_RGB.warm, pts: bp.map((e) => ({ x: fx(e), y: Number(e.diastolic) })) }], { fmt: (v) => String(v) });
  const o2 = vit.filter((e) => Number(e.oxygen) > 0);
  line('oxygen', 'Oxygen (%)', [{ rgb: PDF_RGB.teal, pts: o2.map((e) => ({ x: fx(e), y: Number(e.oxygen) })) }],
    { fixed: { lo: 80, hi: 100, ticks: ticks(80, 100, 5) }, fmt: (v) => String(v), bands: [{ lo: 90, hi: 93, rgb: PDF_RGB.amberBand }, { lo: 80, hi: 90, rgb: PDF_RGB.redBand }], note: 'Shaded: 91 to 93% amber, 90% and under red.' });
  const wts = entries.filter((e) => e.type === 'weight' && Number(e.value) > 0);
  line('weight', 'Weight (kg)', [{ rgb: PDF_RGB.teal, pts: wts.map((e) => ({ x: fx(e), y: Number(e.value) })) }], { minSpan: 4, fmt: (v) => String(v) });
  const night = days.map((d) => entries.filter((e) => e.type === 'sleep' && e.day === d).pop() || null);
  const hrs = (m) => Math.round(Number(m || 0) / 6) / 10;
  bars('sleep', 'Sleep (hours asleep a night)', [
    { label: 'Deep', rgb: PDF_RGB.teal, values: night.map((e) => e ? hrs(e.deep) : 0) },
    { label: 'Core', rgb: PDF_RGB.tealMid, values: night.map((e) => e ? hrs(e.core) : 0) },
    { label: 'REM', rgb: PDF_RGB.tealPale, values: night.map((e) => e ? hrs(e.rem) : 0) },
    { label: 'Not broken down', rgb: PDF_RGB.grey, values: night.map((e) => e ? hrs(Math.max(0, (Number(e.value) || 0) - (Number(e.deep) || 0) - (Number(e.core) || 0) - (Number(e.rem) || 0))) : 0) }
  ].filter((st) => st.values.some((v) => v > 0)), { min: 8, fmt: (v) => v + ' h', note: 'Logged against the morning the night ended.' });
  const ten = { lo: 0, hi: 10, ticks: [0, 2, 4, 6, 8, 10] };
  const ci = entries.filter(isPatientCheckin);
  const spot = entries.filter((e) => e.type === 'pain');
  const painSeries = [{ label: 'Check-in', rgb: PDF_RGB.teal, pts: ci.filter((e) => e.pain != null).map((e) => ({ x: fx(e), y: Number(e.pain) })) }];
  if (spot.length) painSeries.push({ label: 'Extra reading', rgb: PDF_RGB.warm, hollow: true, line: false, pts: spot.map((e) => ({ x: fx(e), y: Number(e.value) })) });
  if (painSeries.some((s) => s.pts.length)) line('pain', 'Pain (0 to 10)', painSeries, { fixed: ten, fmt: (v) => String(v) });
  line('mood', 'Mood (0 to 10)', [{ rgb: PDF_RGB.teal, pts: ci.filter((e) => e.mood != null).map((e) => ({ x: fx(e), y: Number(e.mood) })) }], { fixed: ten, fmt: (v) => String(v) });
  bars('drink', 'Drinks (ml a day)', [{ label: 'Drinks', rgb: PDF_RGB.teal, values: days.map((d) => entries.filter((e) => e.type === 'drink' && e.day === d).reduce((t, e) => t + (Number(e.value) || 0), 0)) }], { min: 1000, fmt: (v) => String(v) });
  const bw = entries.filter((e) => e.type === 'bowel' && !e.none);
  bars('bowel', 'Bowel movements a day', [
    { label: 'Types 1 to 5', rgb: PDF_RGB.tealMid, values: days.map((d) => bw.filter((e) => e.day === d && !isLoose(e)).length) },
    { label: 'Loose, type 6 or 7', rgb: PDF_RGB.warm, values: days.map((d) => bw.filter((e) => e.day === d && isLoose(e)).length) }
  ], { min: 3, fmt: (v) => String(v) });
  return out.sort((a, b) => REPORT_CHART_ORDER.indexOf(a.key) - REPORT_CHART_ORDER.indexOf(b.key));
}
/* Which charts go in: the person's own ticks once they have touched them, otherwise the defaults
   above plus anything the summary flagged amber or red. */
function chosenReportCharts(charts, glance) {
  if (state.notesCharts) return charts.filter((c) => state.notesCharts.has(c.key));
  const flagged = new Set((glance || []).filter((g) => g.level === 'red' || g.level === 'amber').map((g) => CHART_TOPIC_KEY[g.topic]).filter(Boolean));
  return charts.filter((c) => flagged.has(c.key) || REPORT_CHART_DEFAULTS.includes(c.key));
}
function renderChartPicker(charts, glance) {
  const box = $('notes-charts-box');
  box.hidden = !charts.length;
  const on = new Set(chosenReportCharts(charts, glance).map((c) => c.key));
  $('notes-charts').replaceChildren(...charts.map((c) => h('button', { class: 'preset' + (on.has(c.key) ? ' is-active' : ''), type: 'button', 'aria-pressed': on.has(c.key) ? 'true' : 'false', text: REPORT_CHART_NAME[c.key],
    onclick: (ev) => {
      if (!state.notesCharts) state.notesCharts = new Set(on);
      const b = ev.currentTarget;
      if (state.notesCharts.has(c.key)) state.notesCharts.delete(c.key); else state.notesCharts.add(c.key);
      on.clear(); state.notesCharts.forEach((k) => on.add(k));
      b.classList.toggle('is-active', on.has(c.key)); b.setAttribute('aria-pressed', on.has(c.key) ? 'true' : 'false');
    } })));
}
/* The PDF as it stands now, with the charts ticked at this moment */
function currentNotesPdf() {
  const n = state.notesPdf;
  if (!n) return null;
  return { filename: n.filename, title: n.title, subtitle: n.subtitle, blocks: notesPdfBlocks(n.report, chosenReportCharts(n.charts, n.report.glance)) };
}

function notesPdfBlocks(report, charts) {
  const blocks = [{ kind: 'heading', text: 'Questions for the team' }];
  if (report.questions.length) report.questions.forEach((q) => blocks.push({ kind: 'question', n: q.n, text: q.text, who: q.who, day: q.day }));
  else blocks.push({ kind: 'muted', text: 'No open questions.' });
  /* Answered questions are not printed (v114): they are filed as "Questions answered" documents */
  blocks.push({ kind: 'heading', text: 'Summary' }, { kind: 'muted', text: report.rangeLabel + '. Highlights to talk about, from simple checks by the app; not medical advice. The detail for every day is in Daybook.' });
  if (report.glance.length) report.glance.forEach((g) => blocks.push({ kind: 'flag', level: g.level, text: g.short || g.text }));
  else blocks.push({ kind: 'text', text: 'No readings logged in this period.' });
  if (charts && charts.length) {
    blocks.push({ kind: 'heading', text: 'Charts', keep: 230 }, { kind: 'muted', text: 'Drawn by Daybook from the readings logged in this period.' });
    charts.forEach((c) => blocks.push(c.block));
  }
  /* Letters are not part of the report (v114): they are the team's own, and stay in the app */
  blocks.push({ kind: 'heading', text: 'Notes', keep: 90 });
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
  /* text is the full sentence (on screen under Details, and in the text for an AI app); short is the
     talking point the PDF and the screen lead with (v114: Mark found the full sentences too much for a note) */
  const push = (level, topic, text, brief, short) => { if (level === 'amber' && brief) once.push({ topic, text, brief, short: short || text }); else rows.push({ level, topic, text, short: short || text }); };
  const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times');
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
    if (highDays) push('red', 'Temperature', `High temperature (38.0 or over) on ${plural(highDays, 'day')} of the ${tDays} with a reading, ${peak}.`, null, `High temperature on ${plural(highDays, 'day')}, up to ${Number(hi.value).toFixed(1)} °C`);
    else if (raisedDays) push('amber', 'Temperature', `Temperature raised (37.5 to 37.9) on ${raisedDays} of the ${tDays} days with a reading, ${peak}, never reaching 38.0.`, raisedDays === 1 ? `temperature ${Number(hi.value).toFixed(1)} °C on ${when(hi)}` : null, `Raised temperature on ${plural(raisedDays, 'day')}, up to ${Number(hi.value).toFixed(1)} °C`);
    else fine.push(`temperature (highest ${Number(hi.value).toFixed(1)} °C)`);
  }

  const hrs = entries.filter((e) => e.type === 'vitals' && Number(e.heartRate) > 0);
  if (hrs.length) {
    const hi = maxBy(hrs, (e) => Number(e.heartRate)), lo = minBy(hrs, (e) => Number(e.heartRate));
    const fast = hrs.filter((e) => e.heartRate >= 120).length, high = hrs.filter((e) => e.heartRate >= 100).length, slow = hrs.filter((e) => e.heartRate <= 50).length;
    const range = `readings ranged ${Math.round(lo.heartRate)} to ${Math.round(hi.heartRate)} bpm`;
    if (fast) push('red', 'Heart rate', `Heart rate 120 or over on ${plural(fast, 'reading')} of ${hrs.length}, highest ${Math.round(hi.heartRate)} on ${when(hi)}; ${range}.`, null, `Heart rate 120 or over ${times(fast)}, up to ${Math.round(hi.heartRate)} bpm`);
    else if (high) push('amber', 'Heart rate', `Heart rate over 100 on ${plural(high, 'reading')} of ${hrs.length}, highest ${Math.round(hi.heartRate)} on ${when(hi)}; ${range}.`, high === 1 ? `heart rate ${Math.round(hi.heartRate)} bpm on ${when(hi)}` : null, `Heart rate over 100 ${times(high)}, up to ${Math.round(hi.heartRate)} bpm`);
    else if (slow) push('amber', 'Heart rate', `Heart rate 50 or under on ${plural(slow, 'reading')} of ${hrs.length}, lowest ${Math.round(lo.heartRate)} on ${when(lo)}; ${range}.`, slow === 1 ? `heart rate ${Math.round(lo.heartRate)} bpm on ${when(lo)}` : null, `Heart rate 50 or under ${times(slow)}, down to ${Math.round(lo.heartRate)} bpm`);
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
    if (red.length) { const w = worstOf(red); push('red', 'Blood pressure', `Blood pressure ${bp(w)} on ${when(w)}${red.length > 1 ? ', and over the 160/100 line on ' + plural(red.length, 'reading') + ' in all' : ''}; ${range}.`, null, `Blood pressure over 160/100 ${times(red.length)}, highest ${bp(w)}`); }
    else if (amber.length) { const w = worstOf(amber); push('amber', 'Blood pressure', `Blood pressure over the 140/90 line on ${plural(amber.length, 'reading')} of ${bps.length}, highest ${bp(w)} on ${when(w)}; ${range}.`, amber.length === 1 ? `blood pressure ${bp(w)} on ${when(w)}` : null, `Blood pressure over 140/90 ${times(amber.length)}, highest ${bp(w)}`); }
    else if (low.length) { const w = minBy(low, (e) => Number(e.systolic)); push('amber', 'Blood pressure', `Low blood pressure ${bp(w)} on ${when(w)}${low.length > 1 ? ' and on ' + (low.length - 1) + ' other ' + (low.length === 2 ? 'reading' : 'readings') : ''}; ${range}.`, null, `Low blood pressure ${times(low.length)}, down to ${bp(w)}`); }
    else fine.push(`blood pressure (${bp(lo)} to ${bp(hi)})`);
  }

  const oxs = entries.filter((e) => e.type === 'vitals' && Number(e.oxygen) > 0);
  if (oxs.length) {
    const lo = minBy(oxs, (e) => Number(e.oxygen));
    if (lo.oxygen <= 90) push('red', 'Oxygen', `Oxygen down to ${Math.round(lo.oxygen)}% on ${when(lo)} (${plural(oxs.length, 'reading')} in all).`, null, `Oxygen down to ${Math.round(lo.oxygen)}%`);
    else if (lo.oxygen <= 93) push('amber', 'Oxygen', `Oxygen a little low, ${Math.round(lo.oxygen)}% on ${when(lo)} (${plural(oxs.length, 'reading')} in all).`, oxs.filter((e) => e.oxygen <= 93).length === 1 ? `oxygen ${Math.round(lo.oxygen)}% on ${when(lo)}` : null, `Oxygen down to ${Math.round(lo.oxygen)}%`);
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
      const short = t && t.word === 'worse' ? `Pain rising, about ${one(t.a)} to ${one(t.b)}/10, worst ${worst.v}/10`
        : t && t.word === 'better' ? `Pain easing, about ${one(t.a)} to ${one(t.b)}/10, worst ${worst.v}/10`
        : `Pain about ${one(mean)}/10, worst ${worst.v}/10`;
      push(worst.v >= 7 ? 'red' : 'amber', 'Pain', text, null, short);
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
      push('amber', topic, text + '.', badOnes.length === 1 && !(t && t.word === 'worse') ? `${topic.toLowerCase()} ${worst.v}/10 on ${fmtDayShort(worst.day)}` : null, `${phrases.short} on ${plural(badOnes.length, 'evening')}${t && t.word === 'worse' ? ', ' + phrases.worse : ''}`);
    } else if (t && t.word === 'worse') push('amber', topic, `${topic} ${phrases.worse} from about ${one(t.a)}/10 in the first half of the period to ${one(t.b)}/10 in the second.`, null, `${topic} ${phrases.worse}`);
    else fine.push(`${topic.toLowerCase()} (about ${one(mean)}/10)`);
  };
  scale('sickness', 'Sickness', 6, false, { bad: 'Sickness 6 or more', short: 'Sickness 6 or more', worse: 'getting worse' });
  scale('appetite', 'Appetite', 3, true, { bad: 'Little appetite (3 or under)', short: 'Little appetite', worse: 'has dropped' });
  scale('energy', 'Energy', 3, true, { bad: 'Energy very low (3 or under)', short: 'Very low energy', worse: 'has dropped' });

  const sleeps = entries.filter((e) => e.type === 'sleep' && Number(e.value) > 0);
  if (sleeps.length) {
    const mean = avg(sleeps.map((e) => Number(e.value)));
    const short = sleeps.filter((e) => Number(e.value) < 300);
    if (short.length) { const lo = minBy(short, (e) => Number(e.value)); push('amber', 'Sleep', `Short nights: under 5 hours on ${short.length} of ${plural(sleeps.length, 'night')}, shortest ${fmtHm(lo.value)} before ${when(lo)}; averaging ${fmtHm(mean)}.`, short.length === 1 ? `a short night (${fmtHm(lo.value)}) before ${when(lo)}` : null, `Short nights (under 5 h): ${short.length} of ${sleeps.length}`); }
    else fine.push(`sleep (${fmtHm(mean)} a night)`);
  }

  const weights = entries.filter((e) => e.type === 'weight' && Number(e.value) > 0).sort((a, b) => entryDate(a) - entryDate(b));
  if (weights.length >= 2) {
    const first = Number(weights[0].value), last = Number(weights[weights.length - 1].value), drop = first - last;
    if (drop >= 2) push(drop >= 4 ? 'red' : 'amber', 'Weight', `Weight down ${drop.toFixed(1)} kg, from ${first.toFixed(1)} kg on ${when(weights[0])} to ${last.toFixed(1)} kg on ${when(weights[weights.length - 1])}.`, null, `Weight down ${drop.toFixed(1)} kg, now ${last.toFixed(1)} kg`);
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
    if (low) push('amber', 'Drinks', `Under 1 litre of drinks on ${low} of the ${plural(drinkDays.length, 'logged day')}; averaging ${mean} a day.`, low === 1 ? `under 1 litre of drinks on ${fmtDayShort(lowDays[0])}` : null, `Under 1 litre of drinks on ${plural(low, 'day')}`);
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
    if (noFood.length) push('amber', 'Eating', `Nothing eaten logged on ${plural(noFood.length, 'day')} of the ${loggedDays.length} logged (${listDays(noFood)})${est ? '; on the other days ' + est : ''}${targetText}.`, noFood.length === 1 && !underDays ? `nothing eaten logged on ${fmtDayShort(noFood[0])}` : null, `Nothing eaten logged on ${plural(noFood.length, 'day')}${underDays ? `; protein under target on ${underDays} of ${targetDays} days` : ''}`);
    else if (target && macros) push(underDays > targetDays / 2 ? 'amber' : 'green', 'Eating', `Eating: something every logged day, ${est}${targetText}.`, null, underDays ? `Protein under target on ${underDays} of ${targetDays} days` : 'Eating every day, protein target met');
    else fine.push(`eating (something every logged day${est ? ', ' + est : ''})`);
  }

  /* Symptoms logged between check-ins: worst per symptom; 7 or more red, 5 or 6 amber, like pain */
  const symptoms = entries.filter((e) => e.type === 'symptom' && e.value != null);
  if (symptoms.length) {
    const byWhat = {};
    symptoms.forEach((e) => { const k = String(e.what || 'Symptom'); (byWhat[k] = byWhat[k] || []).push(e); });
    const items = Object.keys(byWhat).map((k) => { const w = maxBy(byWhat[k], (e) => Number(e.value)); return { what: k, worst: Number(w.value), day: w.day, n: byWhat[k].length }; }).sort((a, b) => b.worst - a.worst);
    const worst = items[0];
    if (worst.worst >= 5) {
      const text = items.filter((i) => i.worst >= 5).map((i) => `${i.what.toLowerCase()} up to ${i.worst}/10 on ${fmtDayShort(i.day)}${i.n > 1 ? ' (' + plural(i.n, 'reading') + ')' : ''}`).join('; ');
      push(worst.worst >= 7 ? 'red' : 'amber', 'Symptoms', `Symptoms logged between check-ins: ${text}.`, worst.worst < 7 && symptoms.filter((e) => Number(e.value) >= 5).length === 1 ? `${worst.what.toLowerCase()} ${worst.worst}/10 on ${fmtDayShort(worst.day)}` : null,
        'Symptoms: ' + items.filter((i) => i.worst >= 5).map((i) => `${i.what.toLowerCase()} up to ${i.worst}/10`).join(', '));
    } else fine.push(`symptoms (${plural(symptoms.length, 'reading')}, none above ${worst.worst}/10)`);
  }

  /* Bowels: the UKONS triage lines. Loose means Bristol type 6 or 7. Red at 4 or more loose in a day
     (Macmillan: ring the team), any blood, or loose at night; amber at 1 to 3 loose a day or two days
     with none in a row; red at three days with none. "None" days only count where nothing else was logged. */
  const bowels = entries.filter((e) => e.type === 'bowel');
  if (bowels.length) {
    const real = bowels.filter((e) => !e.none);
    const looseByDay = {};
    real.filter(isLoose).forEach((e) => { looseByDay[e.day] = (looseByDay[e.day] || 0) + 1; });
    const looseDays = Object.keys(looseByDay).sort();
    const worstLoose = looseDays.length ? maxBy(looseDays, (d) => looseByDay[d]) : null;
    const bloodDays = Object.keys(byDay).filter((d) => byDay[d].some((e) => e.type === 'bowel' && (e.blood || e.black))).sort();
    const nightDays = Object.keys(byDay).filter((d) => byDay[d].some((e) => isLoose(e) && e.night)).sort();
    const noneDays = new Set(bowels.filter((e) => e.none).map((e) => e.day).filter((d) => !real.some((r) => r.day === d)));
    let run = 0, longest = 0, runEnd = null;
    for (let d = from; d <= to; d = addDays(d, 1)) { if (noneDays.has(d)) { run++; if (run > longest) { longest = run; runEnd = d; } } else run = 0; }
    const hardDays = daysWith((e) => isHard(e));
    const mixedDays = [...new Set(real.filter(isHardAndLoose).map((e) => e.day))].sort();
    const parts = [];
    if (looseDays.length) parts.push(`loose stools (type 6 or 7) on ${plural(looseDays.length, 'day')}, most ${looseByDay[worstLoose]} on ${fmtDayShort(worstLoose)}${looseByDay[worstLoose] >= 4 ? ' (4 or more in a day is the point to ring the team)' : ''}`);
    if (bloodDays.length) parts.push(`blood or black stools on ${listDays(bloodDays)}`);
    if (nightDays.length) parts.push(`loose at night on ${listDays(nightDays)}`);
    if (longest >= 2) parts.push(`no bowel movement for ${longest} days in a row to ${fmtDayShort(runEnd)}`);
    if (hardDays >= 3) parts.push(`hard stools (type 1 or 2) on ${plural(hardDays, 'day')}`);
    if (mixedDays.length) parts.push(`hard and loose in the same movement on ${listDays(mixedDays)}`);
    const shortParts = [];
    if (looseDays.length) shortParts.push(`loose on ${plural(looseDays.length, 'day')}${looseByDay[worstLoose] >= 4 ? ' (' + looseByDay[worstLoose] + ' in a day)' : ''}`);
    if (bloodDays.length) shortParts.push('blood or black stools');
    if (nightDays.length) shortParts.push('loose at night');
    if (longest >= 2) shortParts.push(`none for ${longest} days`);
    if (hardDays >= 3) shortParts.push(`hard on ${plural(hardDays, 'day')}`);
    if (mixedDays.length) shortParts.push('hard and loose together');
    const level = bloodDays.length || nightDays.length || (worstLoose && looseByDay[worstLoose] >= 4) || longest >= 3 ? 'red' : parts.length ? 'amber' : 'green';
    if (level === 'green') {
      const types = real.flatMap(bowelTypes);
      fine.push(`bowels (${plural(real.length, 'movement')}${types.length ? ', types ' + Math.min(...types) + ' to ' + Math.max(...types) : ''}${noneDays.size ? ', none on ' + plural(noneDays.size, 'day') : ''})`);
    } else {
      const text = parts.join('; ');
      push(level, 'Bowels', 'Bowels: ' + text + '.', level === 'amber' && parts.length === 1 && looseDays.length === 1 ? `loose stools on ${fmtDayShort(looseDays[0])}` : null, 'Bowels: ' + shortParts.join(', '));
    }
  }

  const moodDays = Object.keys(state.days).filter((d) => d >= from && d <= to && state.days[d].mood).sort();
  if (moodDays.length) {
    const low = moodDays.filter((d) => state.days[d].mood <= 2);
    if (low.length) push('amber', 'Mood', `Mood rough or low on ${plural(low.length, 'day')} of the ${moodDays.length} recorded: ${listDays(low)}.`, low.length === 1 ? `a low mood day on ${fmtDayShort(low[0])}` : null, `Mood low on ${plural(low.length, 'day')}`);
    else fine.push('mood');
  }

  if (once.length === 1) rows.push({ level: 'amber', topic: once[0].topic, text: once[0].text, short: once[0].short });
  else if (once.length > 1) { const t = 'One-offs worth a mention: ' + once.map((o) => o.brief).join('; ') + '.'; rows.push({ level: 'amber', topic: 'One-offs', text: t, short: 'One-offs: ' + joinAnd(once.map((o) => o.brief.replace(/ \(.*?\)/g, '').replace(/ (on|before) \d+ \w+$/, ''))) }); }

  if (fine.length) {
    const list = fine.length > 1 ? fine.slice(0, -1).join(', ') + ' and ' + fine[fine.length - 1] : fine[0];
    const names = fine.map((f) => f.split(' (')[0]);
    push('green', 'Nothing of concern', list.charAt(0).toUpperCase() + list.slice(1) + ': nothing of concern.', null, 'Steady: ' + joinAnd(names));
  }

  const prn = [], prnShort = [];
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
    prnShort.push(`${m.name} ${days.length === daysBetween(from, to) + 1 ? 'every day' : 'on ' + plural(days.length, 'day')}${hitMax ? ' (daily maximum reached)' : ''}`);
  });
  if (prn.length) push(hitAny ? 'amber' : 'teal', 'When-needed medicines', `When-needed medicines: ${prn.join('; ')}.`, null, 'When-needed medicines: ' + prnShort.join(', '));

  const hosp = entries.filter((e) => e.type === 'med' && e.hospital).sort((a, b) => entryDate(a) - entryDate(b));
  if (state.profile && state.profile.inHospital && state.profile.inHospitalSince && state.profile.inHospitalSince <= to) push('teal', 'In hospital', 'In hospital since ' + fmtDayShort(state.profile.inHospitalSince) + '.');
  if (hosp.length) {
    const groups = new Map();
    hosp.forEach((e) => {
      const text = [e.medName, e.dose, (ROUTE_WORDS[e.route] || '').toLowerCase()].filter(Boolean).join(' ') + ' on ' + fmtDayShort(e.day);
      groups.set(text, (groups.get(text) || 0) + 1);
    });
    push('teal', 'Given in hospital', 'Given in hospital: ' + [...groups].map(([text, n]) => text + (n > 1 ? ` (${n} times)` : '')).join('; ') + '.', null, 'Given in hospital: ' + [...new Set(hosp.map((e) => e.medName))].join(', '));
  }

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
    case 'symptom': return 'with ' + String(e.what || 'a symptom').toLowerCase() + ' ' + e.value + '/10';
    case 'bowel': return e.none ? 'with no bowel movement that day' : 'with bowels ' + bowelTypeText(e) + (bowelFlagWords(e) ? ', ' + bowelFlagWords(e).toLowerCase() : '');
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
    const snap = await getDocs(query(hcol('entries'), where('type', '==', 'question')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); return []; }
}

/* from and to are the report's own range (inclusive), which need not end today */
function buildNotesReport(entries, questionsAll, from, to, rangeLabel) {
  const glance = summaryRows(entries, from, to);
  const open = questionsAll.filter((q) => !q.answered).sort((a, b) => entryDate(a) - entryDate(b));
  const nums = questionNumbers(questionsAll);
  const questions = open.map((q) => ({ id: q.id, n: nums.get(q.id), text: q.note, who: q.addedBy || 'unknown', day: q.day }));
  const dayAnswered = (q) => answeredDayOf(q) || q.day;
  const answers = questionsAll.filter((q) => q.answered && dayAnswered(q) >= from && dayAnswered(q) <= to)
    .sort((a, b) => entryDate(a) - entryDate(b))
    .map((q) => ({ id: q.id, n: nums.get(q.id), text: q.note, who: q.addedBy || 'unknown', day: q.day, answeredDay: dayAnswered(q), answerText: q.answerText || '', recordings: q.recordings || 0 }));
  const answered = answers.length;
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const list = (byDay[day] || []).slice().sort((a, b) => entryDate(a) - entryDate(b));
    const notes = list.filter((e) => e.type === 'note' || (e.note && ['temp', 'weight', 'vitals', 'med', 'pain', 'bowel', 'symptom'].includes(e.type)))
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


  /* The range is the first line, so whoever reads it (an AI app included) knows the period before anything else */
  const lines = [`Daybook notes from ${fmtDayNum(from)} to ${fmtDayNum(to)}.`, '', NOTES_PROMPT, '', 'Questions for the team:'];
  if (questions.length) questions.forEach((q) => lines.push(`${q.n}. ${q.text} (${q.who}, ${fmtDayShort(q.day)})`));
  else lines.push('- No open questions.');
  lines.push('', 'Summary (simple checks by the app, not a diagnosis):');
  if (glance.length) glance.forEach((g) => lines.push(`- ${LEVEL_WORD[g.level]}: ${g.text}`));
  else lines.push('- No readings logged in this period.');
  lines.push('', 'Notes (who wrote each one, then the note):');
  if (days.length) days.forEach((d) => {
    lines.push('', `${fmtDayLong(d.day)} (${fmtDayNum(d.day)})`);
    d.notes.forEach((n) => lines.push(`- ${n.who}, ${n.time}${n.context ? ' (' + n.context + ')' : ''}: ${n.text}`));
  });
  else lines.push('- No written notes in this period.');
  return { questions, answers, answered, glance, days, rangeLabel, text: lines.join('\n') };
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
  const charts = reportCharts(entries, from, to);
  $('notes-record').hidden = $('notes-record-hint').hidden = state.readOnly || !canRecord();
  renderAppointmentList(from, to);
  state.notesPdf = { filename: 'care-log-notes-' + to + '.pdf', title: 'Notes for the team', subtitle: `${fmtDayNum(from)} to ${fmtDayNum(to)}, printed ${fmtDayNum(today)}`, report, charts, from, to };
  renderChartPicker(charts, report.glance);

  $('notes-questions').replaceChildren(...report.questions.map((q) => h('div', { class: 'card question' },
    h('div', { class: 'question-text', text: `${q.n}. ${q.text}` }),
    h('div', { class: 'docitem-sub', text: `${q.who} · ${fmtDayNum(q.day)}` }),
    state.readOnly ? null : h('div', { class: 'question-btns' },
      h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { const full = allQuestions().find((x) => x.id === q.id); if (full) openAnswerSheet(full); } }, 'Record or write the answer'),
      h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: async () => {
        await updateEntry(q.id, { answered: true, answeredAt: stampNow() });
        toast('Marked as answered', { label: 'Undo', onClick: async () => { await updateEntry(q.id, { answered: false }); renderNotesReport(); } });
        renderNotesReport();
      } }, 'Mark as answered'))
  )));
  if (!report.questions.length) $('notes-questions').append(h('p', { class: 'muted', text: 'No open questions. Add one from Today with "Question for the team".' }));
  /* Answered questions are filed, not listed (v114): one line and a way to the documents */
  syncAnswerDocs(questionsAll);
  if (report.answered) {
    const latest = report.answers.map((a) => a.answeredDay).sort().pop();
    $('notes-questions').append(h('div', { class: 'answered-line' },
      h('p', { class: 'muted', text: `${plural(report.answered, 'question')} answered in this period, kept under Letters, results and paperwork as "Questions answered".` }),
      h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: async () => { await syncAnswerDocs(questionsAll); openDocs('notes'); const d = state.documents.find((x) => x.id === 'answers-' + latest); if (d) openDocument(d.id); } }, 'Open the answers')));
  }

  /* The talking point first; the full sentence one tap away */
  $('notes-flags').replaceChildren(...report.glance.map((g) => h('div', { class: 'flag is-' + g.level },
    h('span', { class: 'pill pill-' + g.level, text: LEVEL_WORD[g.level] }),
    h('span', { class: 'flag-text' }, h('span', { class: 'flag-short', text: g.short || g.text }),
      g.short && g.short !== g.text ? h('details', { class: 'flag-more' }, h('summary', { text: 'Details' }), h('span', { text: g.text })) : '')
  )));
  if (!report.glance.length) $('notes-flags').append(h('p', { class: 'muted', text: 'No readings logged in this period.' }));


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

/* ---- The summary card for a check-in that has been submitted (since v82) ----
   One line when closed ("Morning check-in done 08:42, pain 3, mood 6"); open, it shows every answer as saved,
   who submitted it and when, and, if it was changed, who edited it and when. Edit reopens the form on its
   review screen. The same card is used on Today and in the timeline, and which cards are open is remembered
   (by id) so a live update from the other phone does not fold them shut. */
function tsDate(t) { return t && typeof t.toDate === 'function' ? t.toDate() : null; }
function whenText(d) { return d ? (dayStr(d) === todayStr() ? '' : fmtDayShort(dayStr(d)) + ' ') + fmtTime(d) : 'just now'; }
function checkinSubmittedAt(c) { return tsDate(c.createdAt) || entryDate(c); }
function checkinLine(c) {
  const bits = ['pain', 'mood'].filter((k) => c[k] != null).map((k) => k + ' ' + c[k]);
  return checkinTitle(c.slot) + ' done ' + fmtTime(checkinSubmittedAt(c)) + (bits.length ? ', ' + bits.join(', ') : '');
}
function checkinOpenSet() { if (!state.openCheckins) state.openCheckins = new Set(); return state.openCheckins; }
function checkinCard(c, inEntry) {
  const open = checkinOpenSet().has(c.id);
  const bodyId = 'cc-' + String(c.id).replace(/[^\w-]/g, '') + (inEntry ? '-t' : '-s');
  const rows = (CHECKIN_QUESTIONS[c.slot] || []).map((q) => {
    const v = c[q.key];
    let node;
    if (q.kind === 'text') node = h('dd', { class: 'cc-v' + (v ? '' : ' is-empty'), text: v ? v : 'Nothing added' });
    else {
      const empty = v == null;
      node = h('dd', { class: 'cc-v' + (empty ? ' is-empty' : ' is-num'), text: empty ? 'Skipped' : v + '/10' + (q.kind === 'sleep' && c.sleepHours != null ? ' \u00b7 ' + c.sleepHours + ' h' : '') });
    }
    return h('div', { class: 'cc-row' }, h('dt', { class: 'cc-k', text: CHECKIN_LABELS[q.key] || q.key }), node);
  });
  const meta = h('p', { class: 'cc-meta' },
    h('span', { text: 'Submitted by ' + (c.addedBy || 'someone') + ' at ' + whenText(checkinSubmittedAt(c)) }),
    c.editedBy || c.editedAt ? h('span', { text: 'Edited by ' + (c.editedBy || 'someone') + ' at ' + whenText(tsDate(c.editedAt)) }) : null);
  const body = h('div', { class: 'cc-body', id: bodyId, hidden: !open },
    h('dl', { class: 'cc-list' }, ...rows), meta,
    state.readOnly ? null : h('button', { class: 'btn btn-secondary cc-edit', type: 'button', onclick: () => openCheckin(c.slot, c.day) }, 'Edit'));
  const head = h('button', { class: 'cc-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': bodyId },
    h('span', { class: 'cc-check' }, icon('check')),
    h('span', { class: 'cc-line', text: checkinLine(c) }),
    h('span', { class: 'cc-chev' }, icon('chevron')));
  const card = h('div', { class: 'checkin-card' + (open ? ' is-open' : '') + (inEntry ? ' in-entry' : ''), 'data-ccid': c.id }, head, body);
  head.addEventListener('click', () => setCheckinOpen(c.id, head.getAttribute('aria-expanded') !== 'true'));
  return card;
}
/* Open or close every copy of one check-in's card on screen (Today and the timeline show the same one) */
function setCheckinOpen(id, now) {
  if (now) checkinOpenSet().add(id); else checkinOpenSet().delete(id);
  document.querySelectorAll('.checkin-card').forEach((card) => {
    if (card.getAttribute('data-ccid') !== id) return;
    card.classList.toggle('is-open', now);
    const head = card.querySelector('.cc-head'), body = card.querySelector('.cc-body');
    if (head) head.setAttribute('aria-expanded', now ? 'true' : 'false');
    if (body) body.hidden = !now;
  });
}

function renderCheckins() {
  const day = state.selectedDay, isToday = day === todayStr();
  ['morning', 'evening'].forEach((slot) => {
    const row = $('checkin-' + slot), sub = $('checkin-' + slot + '-sub'), holder = $('checkin-' + slot + '-card');
    const c = findCheckin(day, slot);
    row.classList.remove('is-due', 'is-done');
    row.disabled = state.readOnly;
    row.hidden = !!c;
    holder.hidden = !c;
    if (c) {
      holder.replaceChildren(checkinCard(c, false));
      return;
    }
    holder.replaceChildren();
    if (isToday && dueSlot() === slot) { row.classList.add('is-due'); sub.textContent = state.readOnly ? 'Due now' : 'Due now, about a minute'; }
    else if (isToday && slot === 'morning') sub.textContent = state.readOnly ? 'Missed this morning' : 'Missed this morning, tap to fill in';
    else if (isToday) sub.textContent = 'Later today';
    else sub.textContent = state.readOnly ? 'Not filled in' : 'Not filled in, tap to add';
  });
  renderQuestionRow();
}
/* Open questions for the team: a live list, so the Today row can say how many are waiting */
function watchQuestions() {
  state.unsub.questions = onSnapshot(query(hcol('entries'), where('type', '==', 'question')), (snap) => {
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

/* The check-in is a wellness check, not an exercise check (v83): the morning one ends with a signpost to the Exercise tab, never a tick list */
function checkinSteps(slot) { return CHECKIN_QUESTIONS[slot]; }
function openCheckin(slot, initialDay) {
  const today = todayStr();
  let day = initialDay > today ? today : initialDay;
  const qs = checkinSteps(slot);
  let answers = {}, existing = null, step = 0, dir = 1;

  const load = () => {
    existing = findCheckin(day, slot);
    answers = {};
    qs.forEach((q) => { answers[q.key] = existing && existing[q.key] !== undefined ? existing[q.key] : (q.kind === 'text' ? '' : null); });
    answers.sleepHours = existing && existing.sleepHours != null ? existing.sleepHours : null;
  };
  load();
  /* editing a saved check-in opens straight on the review screen: every answer is there, tap one to change it */
  if (existing) step = qs.length;

  const body = h('div', null);
  const cancelLink = () => existing ? h('button', { class: 'btn-link wiz-cancel', type: 'button', onclick: closeSheet }, 'Cancel') : null;

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
      wrap.append(h('div', { class: 'wiz-buttons' }, back, skip, next), cancelLink() || '');
    } else {
      const bar = h('div', { class: 'progress-bar' }, h('div'));
      bar.firstChild.style.width = '100%';
      wrap.append(h('div', { class: 'wiz-progress' }, h('span', { text: 'Review' }), bar));
      wrap.append(h('p', { class: 'wiz-q', text: fmtDayLong(day) + (day === today ? ', today' : '') }));
      wrap.append(h('p', { class: 'wiz-hint', text: 'Tap an answer to change it.' }));
      const list = h('ul', { class: 'wiz-summary' });
      qs.forEach((q, i) => {
        const v = answers[q.key];
        let skipped = q.kind === 'text' ? !v : v == null;
        let shown = skipped ? 'Skipped' : (q.kind === 'text' ? v : String(v) + (q.kind === 'sleep' && answers.sleepHours != null ? ' · ' + answers.sleepHours + ' h' : ''));
        list.append(h('li', null, h('button', { type: 'button', onclick: () => { dir = -1; step = i; render(); } },
          h('span', { class: 'k', text: CHECKIN_LABELS[q.key] }),
          h('span', { class: 'v' + (skipped ? ' is-skipped' : (q.kind === 'text' ? '' : ' is-num')), text: shown }))));
      });
      wrap.append(list);
      if (slot === 'morning' && !state.readOnly) wrap.append(h('p', { class: 'wiz-signpost', text: 'Gentle exercises and stretches are on the Exercise tab, for when you are up and ready. Optional.' }));
      const save = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
        save.disabled = true;
        await saveCheckin(slot, day, answers, existing);
        closeSheet();
      } }, existing ? 'Save changes' : 'Save check-in');
      wrap.append(save, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { dir = -1; step = qs.length - 1; render(); } }, 'Back'), cancelLink() || '');
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
  const data = { type: 'checkin', slot, day, addedBy: existing && existing.addedBy ? existing.addedBy : state.name };
  CHECKIN_QUESTIONS[slot].forEach((q) => { data[q.key] = answers[q.key]; });
  if (slot === 'morning') data.sleepHours = answers.sleepHours;
  if (existing) {
    /* nothing changed: no second write, and no "edited" stamp for a look and a tap on Save */
    const keys = CHECKIN_QUESTIONS[slot].map((q) => q.key).concat(slot === 'morning' ? ['sleepHours'] : []);
    const same = keys.every((k) => { const a = data[k] == null ? null : data[k], b = existing[k] == null ? null : existing[k]; return typeof a === 'string' || typeof b === 'string' ? String(a == null ? '' : a) === String(b == null ? '' : b) : a === b; });
    if (same) { toast('No changes to save'); return; }
    data.editedBy = state.name;
  }
  const mirror = {};
  if (slot !== 'carer' && data.mood != null) mirror.mood = Math.max(1, Math.min(5, Math.ceil(data.mood / 2)));
  if (slot === 'evening' && data.goodThing) mirror.good = data.goodThing;
  const label = checkinTitle(slot) + (existing ? ' updated' : ' saved');

  if (state.demo) {
    const now = new Date();
    const entry = { id, ...data, at: demoTs(at), createdAt: existing ? existing.createdAt : demoTs(now), updatedAt: demoTs(now), ...(existing ? { editedAt: demoTs(now) } : {}) };
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
    await setDoc(hdoc('entries', id), {
      ...data,
      at: Timestamp.fromDate(at),
      createdAt: existing && existing.createdAt ? existing.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(existing ? { editedAt: serverTimestamp() } : {})
    });
    if (Object.keys(mirror).length) await setDoc(hdoc('days', day), { ...mirror, updatedBy: state.name, updatedAt: serverTimestamp() }, { merge: true });
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

/* At home or in hospital (since v103): one switch for the household, in profile/main, so both phones agree.
   At home the medicines the nurses give, and the Given in hospital section on a day with nothing in it, stay
   out of the way; in hospital they show, and the bridge can pause medicine reminders. The viewer role cannot
   read the profile, so it always sees everything. */
function inHospital() { return Boolean(state.profile && state.profile.inHospital); }
function hospitalHidden(m) { return m.hospital && !inHospital() && !state.viewer; }
async function setPlace(patch) {
  if (state.demo) { state.profile = { ...state.profile, ...patch }; renderMeds(); return; }
  try { await setDoc(hdoc('profile', 'main'), patch, { merge: true }); }
  catch (e) { console.error(e); toast('Could not save that'); }
}
function renderPlace() {
  const box = $('meds-place');
  if (!box) return;
  box.hidden = state.viewer;
  if (state.viewer) return;
  const here = inHospital();
  const since = state.profile && state.profile.inHospitalSince;
  const pause = !(state.profile && state.profile.pauseRemindersInHospital === false);
  const seg = (label, on, value) => h('button', { class: 'seg' + (on ? ' is-active' : ''), type: 'button', 'aria-pressed': String(on), disabled: state.readOnly || undefined,
    onclick: () => { if (on) return; setPlace(value ? { inHospital: true, inHospitalSince: todayStr() } : { inHospital: false, inHospitalSince: null }); toast(value ? 'In hospital: hospital medicines are showing' : 'At home: hospital medicines are tucked away'); } }, label);
  const pauseBox = h('input', { type: 'checkbox', disabled: state.readOnly || undefined });
  pauseBox.checked = pause;
  pauseBox.addEventListener('change', () => setPlace({ pauseRemindersInHospital: pauseBox.checked }));
  box.replaceChildren(...[
    h('div', { class: 'segmented place-seg', role: 'group', 'aria-label': 'Where are you?' }, seg('At home', !here, false), seg('In hospital', here, true)),
    here ? h('p', { class: 'hint place-since', text: since ? 'In hospital since ' + fmtDayShort(since) + '.' : 'In hospital.' }) : null,
    here ? h('label', { class: 'check' }, pauseBox, h('span', { text: 'Pause medicine reminders while in hospital' })) : null,
    here ? h('p', { class: 'hint', text: 'The ward usually gives your medicines. A "Remind me in 15 minutes" you ask for still comes through.' }) : null].filter(Boolean));
}

function renderMeds() {
  const day = state.selectedDay;
  const sched = activeScheduled(day).filter((m) => !hospitalHidden(m));
  const prn = activePrn().filter((m) => !hospitalHidden(m));
  renderPlace();
  $('meds-scheduled').replaceChildren(...sched.map((m) => medCard(m, day)));
  if (!sched.length) $('meds-scheduled').append(h('p', { class: 'empty', 'data-art': 'pill', text: 'No scheduled medicines.' }));
  $('meds-prn').replaceChildren(...prn.map((m) => medCard(m, day)));
  if (!prn.length) $('meds-prn').append(h('p', { class: 'empty', 'data-art': 'pill', text: 'No when-needed medicines.' }));
  renderHospitalDoses();
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
  const card = h('div', { class: 'card med' + (m.hospital ? ' is-hospital' : '') });
  const head = h('div', { class: 'med-head' },
    h('div', null,
      h('div', { class: 'med-name', text: m.name }),
      m.hospital ? h('span', { class: 'pill pill-hosp med-hosp', text: 'Given in hospital' }) : null,
      h('div', { class: 'med-dose', text: [m.dose, m.hospital && m.route ? ROUTE_WORDS[m.route] : ''].filter(Boolean).join(' \u00b7 ') }),
      h('div', { class: 'med-how', text: m.how })
    ),
    m.purpose ? h('span', { class: 'med-purpose', text: m.purpose }) : null
  );
  card.append(head);

  const status = h('div', { class: 'med-status' });
  if (m.hospital) {
    /* given by the nurses as often as they decide (a second bag, a third): counted, never "1 of 1" */
    if (count) status.append(h('span', { class: 'med-last', text: `${count} given ` + (isToday ? 'today' : 'this day') }));
  } else if (m.kind === 'scheduled') {
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
  const hosp = m.hospital ? { hospital: true, route: m.route || null } : {};
  const id = await addEntry({ type: 'med', medId: m.id, medName: m.name, dose: m.dose, note: note || '', ...hosp, at: at || new Date() });
  toast(m.name + (m.hospital ? ' logged as given in hospital' : ' logged'), { label: 'Undo', onClick: () => deleteEntry(id) });
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
$('meds-hospital-add').addEventListener('click', () => openHospitalDose(null));

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
  const due = state.medicines.filter((m) => m.active !== false && m.kind !== 'prn' && !m.hospital && medWithMeals(m) && (!m.courseEnd || m.courseEnd >= day))
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
        try { await setDoc(doc(hcol('reminders')), { at: Timestamp.fromDate(at), medId: m.id, medName: m.name, dose: m.dose || '', sent: false, addedBy: state.name, createdAt: serverTimestamp() }); toast(`Reminder set for ${fmtTime(at)}`); }
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
function explainAvailable() { return !!BRIDGE && !!(auth && auth.currentUser); }
/* One signed-in call to the bridge: the person's Firebase ID token, JSON in, JSON out, errors in the bridge's own words */
async function bridgeCall(path, payload, fallbackMessage) {
  const user = auth && auth.currentUser;
  if (!BRIDGE || !user) throw new Error('Sign in first');
  const idToken = await user.getIdToken();
  let r;
  try { r = await fetch(BRIDGE.url.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(payload || {}) }); }
  catch (e) { throw new Error('No connection to Daybook. Check the signal and try again.'); }
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok || !data) {
    const err = new Error(data && data.message ? data.message : (fallbackMessage || 'Daybook could not do that just now. Try again in a moment.'));
    err.code = data && data.error; err.status = r.status; err.data = data; throw err;
  }
  return data;
}
async function bridgeExplain(payload) {
  const data = await bridgeCall('/explain', payload, 'Could not reach Daybook\'s AI service. Try again in a moment, or use Send to my AI app.');
  if (!data.text) throw new Error('Could not reach Daybook\'s AI service. Try again in a moment, or use Send to my AI app.');
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
  $('settings-private-row').hidden = true;
  if (demo) { box.checked = false; box.disabled = true; hint.textContent = 'Not available in the demo.'; state.pushEnabled = false; return; }
  if (!pushSupported()) { box.checked = false; box.disabled = true; hint.textContent = standalone ? 'This browser cannot show notifications.' : 'On iPhone, add Daybook to the Home Screen first (Share, then Add to Home Screen), then turn this on from there.'; state.pushEnabled = false; return; }
  box.disabled = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    state.pushEnabled = Boolean(sub);
    box.checked = Boolean(sub);
    await syncPrivate(sub);
    hint.textContent = sub ? 'This phone gets a notification at each medicine\'s reminder times, and one nudge 30 minutes later if the dose is still not logged.' : (Notification.permission === 'denied' ? 'Notifications are blocked for Daybook in this phone\'s settings. Allow them there, then turn this on.' : 'A notification at each medicine\'s reminder times (set under Manage medicines), only on phones where this is on.');
  } catch (e) { console.warn(e); box.disabled = true; hint.textContent = 'Could not check notifications on this phone.'; }
}
async function setReminders(on) {
  const box = $('settings-reminders');
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (!on) {
      if (existing) { await deleteDoc(hdoc('pushSubs', pushSubId(existing.endpoint))).catch(() => {}); await existing.unsubscribe(); }
      toast('Reminders off on this phone');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { box.checked = false; toast('Notifications were not allowed'); await syncReminders(); return; }
      const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUSH.publicKey) });
      const j = sub.toJSON();
      await setDoc(hdoc('pushSubs', pushSubId(sub.endpoint)), { endpoint: sub.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, private: $('settings-private').checked, addedBy: state.name, uid: state.user ? state.user.uid : null, agent: navigator.userAgent.slice(0, 120), addedAt: serverTimestamp() }, { merge: true });
      toast('Reminders on for this phone');
    }
  } catch (e) { console.error(e); toast('Could not change reminders on this phone'); }
  await syncReminders();
}
$('settings-reminders').addEventListener('change', (ev) => setReminders(ev.target.checked));

/* Private notifications (since v74), per phone and on unless switched off: the bridge sends this phone
   "A medicine is due" rather than the name and dose, so nothing personal shows on a locked screen.
   Stored as pushSubs/{id}.private; a phone saved before the setting existed counts as private. */
const PRIVATE_HINT_ON = 'The notification says "A medicine is due". Open Daybook to see which one.';
const PRIVATE_HINT_OFF = 'The notification names the medicine and dose, so anyone who can see this phone can read it.';
async function syncPrivate(sub) {
  const row = $('settings-private-row'), box = $('settings-private');
  row.hidden = !sub;
  if (!sub) return;
  let priv = true;
  try { const snap = await getDoc(hdoc('pushSubs', pushSubId(sub.endpoint))); if (snap.exists() && snap.data().private === false) priv = false; } catch (e) { console.warn(e); }
  box.checked = priv;
  $('settings-private-hint').textContent = priv ? PRIVATE_HINT_ON : PRIVATE_HINT_OFF;
}
$('settings-private').addEventListener('change', async (ev) => {
  const on = ev.target.checked;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await setDoc(hdoc('pushSubs', pushSubId(sub.endpoint)), { private: on }, { merge: true });
    $('settings-private-hint').textContent = on ? PRIVATE_HINT_ON : PRIVATE_HINT_OFF;
    toast(on ? 'Medicine names hidden on this phone' : 'Medicine names shown on this phone');
  } catch (e) { console.error(e); ev.target.checked = !on; toast('Could not change this setting'); }
});

/* Given in hospital (since v97): a drip, an injection or anything the hospital gave that is not on the
   medicines list, logged as an ordinary med entry with no medId, marked hospital: true and a route, so it
   shows on the timeline and the Meds tab with a "Given in hospital" pill and in Notes for the team, and
   never counts towards a listed medicine's doses. Read it from a photo fills the boxes through the bridge. */
const ROUTE_WORDS = { drip: 'Drip (IV)', injection: 'Injection', mouth: 'By mouth', skin: 'On the skin', inhaled: 'Inhaled', other: 'Other' };
function openHospitalDose(edit, prefill) {
  const p = prefill || {};
  const day = edit ? edit.day : state.selectedDay;
  const name = h('input', { type: 'text', value: (edit && edit.medName) || p.name || '', autocomplete: 'off' });
  const amount = h('input', { type: 'text', value: (edit && edit.dose) || p.amount || '', placeholder: 'e.g. 1000 ml', autocomplete: 'off' });
  const route = h('input', { type: 'hidden', value: (edit && edit.route) || p.route || 'drip' });
  const routes = presets(['drip', 'injection', 'mouth', 'other'].map((k) => ({ value: k, label: ROUTE_WORDS[k] })), route, route.value);
  routes.setAttribute('role', 'group'); routes.setAttribute('aria-label', 'How it was given');
  const dateIn = h('input', { type: 'date', value: day, max: todayStr() });
  const time = timeInput(day);
  if (edit) time.value = fmtTime(entryDate(edit));
  const note = h('textarea', { rows: '2', placeholder: 'e.g. over 4 hours, for dehydration (optional)' });
  note.value = (edit && edit.note) || p.note || '';
  const alsoList = h('input', { type: 'checkbox' });
  const body = h('div', null,
    explainAvailable() && !edit ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => readMedicinePhoto((data) => openHospitalDose(null, data), () => openHospitalDose(null, p)) }, 'Read it from a photo') : null,
    explainAvailable() && !edit ? h('p', { class: 'hint', text: 'A photo of the bag, box or label. The details fill in below for you to check.' }) : null,
    field('What was given', name), field('Amount', amount),
    h('p', { class: 'fieldlabel', text: 'How it was given' }), routes,
    h('div', { class: 'field-row' }, field('Date', dateIn), field('Time', time)),
    field('Note', note), speakButton(note) || '',
    edit ? null : h('label', { class: 'check' }, alsoList, h('span', { text: 'Also add it to my medicines list, to keep taking at home' })),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      if (!name.value.trim()) { toast('Please say what was given'); name.focus(); return; }
      if (!dateIn.value || dateIn.value > todayStr()) { toast('Please choose a date up to today'); return; }
      const data = { type: 'med', medId: (edit && edit.medId) || null, medName: name.value.trim(), dose: amount.value.trim(), route: route.value, hospital: true, note: note.value.trim() };
      const at = atFromInputs(dateIn.value, time.value);
      closeSheet();
      if (edit) {
        try { await updateEntry(edit.id, { ...data, at }); toast('Updated'); } catch (e) { console.error(e); toast('Could not save'); }
        return;
      }
      const id = await addEntry({ ...data, at });
      toast(data.medName + ' logged as given in hospital', { label: 'Undo', onClick: () => deleteEntry(id) });
      if (alsoList.checked) openEditMed(null, { name: data.medName, dose: data.dose, how: p.how || '', purpose: p.purpose || '', whenNeeded: p.whenNeeded, perDay: p.perDay, maxPerDay: p.maxPerDay, minGapHours: p.minGapHours });
    } }, edit ? 'Save changes' : 'Save'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Cancel'));
  openSheet('Given in hospital', body);
}

/* A photo of a bag, box, bottle or pharmacy label, read by Daybook's AI service into
   { name, amount, route, how, purpose, whenNeeded, perDay, maxPerDay, minGapHours }. Nothing is saved
   until the person checks the filled-in sheet and taps Save. */
function readMedicinePhoto(onRead, onCancel) {
  const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.remove();
    if (!files.length) return;
    const status = h('p', { class: 'hint', role: 'status', text: 'Reading the label, about half a minute' });
    openSheet('Reading the label', h('div', null, status, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { closeSheet(); onCancel(); } }, 'Cancel')));
    try {
      const read = await processFiles(files.slice(0, 1), (label) => { status.textContent = label; });
      status.textContent = 'Reading the label, about half a minute';
      const reply = await bridgeExplain({ kind: 'medicine', pages: read.pages.slice(0, 2).map((pg) => pg.data) });
      const data = parseMedReply(reply.text);
      if (!data.name) { toast('Could not read a medicine name in that photo. Fill it in by hand.'); onCancel(); return; }
      onRead(data);
    } catch (e) { console.warn(e); toast(e.message || 'Could not read the photo'); onCancel(); }
  });
  input.click();
}
function parseMedReply(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let d = {};
  try { d = JSON.parse(t); } catch (e) { d = {}; }
  const str = (v, n) => (v == null ? '' : String(v).trim().slice(0, n));
  const num = (v) => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : null; };
  return {
    name: str(d.name, 80), amount: str(d.amount, 40), how: str(d.how, 160), purpose: str(d.purpose, 80),
    route: ROUTE_WORDS[d.route] ? d.route : null, whenNeeded: d.whenNeeded === true,
    perDay: num(d.perDay), maxPerDay: num(d.maxPerDay), minGapHours: num(d.minGapHours)
  };
}

/* The Meds tab's Given in hospital list for the day on screen */
function renderHospitalDoses() {
  const box = $('meds-hospital');
  if (!box) return;
  const day = state.selectedDay;
  const src = day >= (state.recentFrom || '') ? state.recentEntries : state.dayEntries;
  const list = src.filter((e) => e.type === 'med' && e.hospital && e.day === day).sort((a, b) => entryDate(a) - entryDate(b));
  box.replaceChildren(...list.map((e) => h('div', { class: 'card hosprow' },
    h('p', { class: 'hosprow-name' }, h('span', { text: e.medName || 'Medicine' }), h('span', { class: 'pill pill-hosp', text: 'Given in hospital' })),
    h('p', { class: 'muted', text: [e.dose, ROUTE_WORDS[e.route] || e.route, fmtTime(entryDate(e)), e.note].filter(Boolean).join(' \u00b7 ') }))));
  if (!list.length) box.append(h('p', { class: 'muted', text: day === todayStr() ? 'Nothing logged as given in hospital today.' : 'Nothing logged as given in hospital this day.' }));
  const section = $('meds-hospital-section');
  if (section) section.hidden = !list.length && !inHospital() && !state.viewer;
}

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

function openEditMed(m, prefill) {
  const isNew = !m;
  const pf = prefill || {};
  m = m || { name: pf.name || '', dose: pf.amount || pf.dose || '', how: pf.how || '', purpose: pf.purpose || '',
    kind: pf.whenNeeded ? 'prn' : 'scheduled', perDay: pf.perDay || 1, maxPerDay: pf.maxPerDay || null, minGapHours: pf.minGapHours || null, active: true,
    hospital: pf.hospital === true || pf.route === 'drip', route: pf.route || null };
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
  /* Given by the hospital (since v101): the nurses give it, so its doses are marked as given in hospital
     and the bridge sends no reminder for it */
  const hospital = h('input', { type: 'checkbox' });
  hospital.checked = m.hospital === true;
  const routeIn = h('input', { type: 'hidden', value: m.route || 'drip' });
  const routeChips = presets(['drip', 'injection', 'mouth', 'other'].map((k) => ({ value: k, label: ROUTE_WORDS[k] })), routeIn, routeIn.value);
  routeChips.setAttribute('role', 'group'); routeChips.setAttribute('aria-label', 'How it is given');
  const hospFields = h('div', null, h('p', { class: 'fieldlabel', text: 'How it is given' }), routeChips);

  /* Reminder times (a push notification at each, from the bridge) and the with-meals prompt */
  const times = (m.times || []).slice().sort();
  const timeChips = h('div', { class: 'presets timechips' });
  const timeInputEl = h('input', { type: 'time', 'aria-label': 'Reminder time to add' });
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
  /* reminder times and the after-meal prompt do not apply to a medicine the nurses give */
  const remindBits = [...schedFields.children].slice(2);
  const sync = () => {
    schedFields.hidden = kind.value !== 'scheduled'; prnFields.hidden = kind.value !== 'prn';
    hospFields.hidden = !hospital.checked;
    remindBits.forEach((el) => { el.hidden = hospital.checked; });
    schedFields.children[0].hidden = hospital.checked; // doses per day: the nurses decide, each one is counted
  };
  kind.addEventListener('change', sync);
  hospital.addEventListener('change', sync);
  sync();

  const body = h('div', null,
    isNew && explainAvailable() ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => readMedicinePhoto((data) => openEditMed(null, data), () => openEditMed(null, pf)) }, 'Read it from a photo') : null,
    isNew && explainAvailable() ? h('p', { class: 'hint', text: 'A photo of the box or the pharmacy label. The details fill in below for you to check before adding.' }) : null,
    field('Name', name), field('Dose', dose), field('How and when', how), field('What it is for', purpose),
    h('label', { class: 'check' }, hospital, h('span', { text: 'Given by the hospital (hospital monitored)' })),
    h('p', { class: 'hint', text: 'Tick this for a drip, an injection or anything the nurses give. Its doses are marked as given in hospital, and Daybook sends no reminders for it.' }),
    hospFields,
    field('Type', kind), schedFields, prnFields,
    isNew ? null : h('label', { class: 'check' }, active, h('span', { text: 'Currently in use' })),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      if (!name.value.trim()) { toast('Please enter a name'); return; }
      const data = {
        name: name.value.trim(), dose: dose.value.trim(), how: how.value.trim(), purpose: purpose.value.trim(),
        kind: kind.value, active: active.checked,
        hospital: hospital.checked, route: hospital.checked ? routeIn.value : null,
        order: m.order || (Math.max(0, ...state.medicines.map((x) => x.order || 0)) + 1)
      };
      if (kind.value === 'scheduled') {
        data.perDay = hospital.checked ? null : Math.max(1, parseInt(perDay.value, 10) || 1);
        data.courseEnd = courseEnd.value || null;
        data.minGapHours = null; data.maxPerDay = null;
        data.times = hospital.checked ? [] : times.slice();
        data.withMeals = hospital.checked ? false : withMeals.checked;
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
      const ref = isNew ? doc(hcol('medicines')) : hdoc('medicines', m.id);
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

document.querySelectorAll('#view-vitals .seg[data-range]').forEach((b) => b.addEventListener('click', () => {
  state.trendRange = parseInt(b.dataset.range, 10);
  document.querySelectorAll('#view-vitals .seg[data-range]').forEach((x) => x.classList.toggle('is-active', x === b));
  renderVitals();
}));

/* ---- Chart or table (since v79): every Trends card can be flicked from the chart to a plain
   table of the same readings, newest first, date, time and value, with the same amber and red
   as the chart. The choice is remembered per card on this phone. The tables are built from the
   entries before Chart.js is fetched, so they work with no connection at all. ---- */
const CHART_TABLE_KEYS = ['temp', 'pain', 'mood', 'heart', 'bp', 'oxygen', 'weight', 'sleep', 'drink', 'bowel'];
const TABLE_VIEW_STORE = 'daybook.trends.tables';
function tableViews() {
  if (!state.tableViews) {
    state.tableViews = new Set();
    try { for (const k of JSON.parse(localStorage.getItem(TABLE_VIEW_STORE) || '[]')) state.tableViews.add(k); } catch (e) { /* no storage, no memory */ }
  }
  return state.tableViews;
}
/* The Weight chart's own kg | st and lb switch, under its heading: changes that chart and its table only */
function wireWeightSwitch() {
  const card = $('chart-weight') && $('chart-weight').closest('.chart-card');
  if (!card || card.querySelector('.unitswitch')) return;
  card.querySelector('.chart-head').insertAdjacentElement('afterend',
    h('div', { class: 'unitswitch-row' }, h('span', { class: 'fieldlabel', text: 'Show in' }), weightSwitch(() => renderVitals())));
}
function wireChartViews() {
  for (const key of CHART_TABLE_KEYS) {
    const canvas = $('chart-' + key);
    const card = canvas && canvas.closest('.chart-card');
    if (!card) continue;
    const title = card.querySelector('.section-title');
    const head = h('div', { class: 'chart-head' });
    title.replaceWith(head);
    head.appendChild(title);
    const toggle = h('div', { class: 'viewtoggle', role: 'group', 'aria-label': title.textContent.trim() + ', show as' },
      h('button', { class: 'vt', type: 'button', dataset: { view: 'chart' }, text: 'Chart', onclick: () => setChartView(key, 'chart') }),
      h('button', { class: 'vt', type: 'button', dataset: { view: 'table' }, text: 'Table', onclick: () => setChartView(key, 'table') }));
    head.appendChild(toggle);
    card.querySelector('.chart-wrap').insertAdjacentElement('afterend', h('div', { class: 'chart-table', id: 'table-' + key, hidden: true }));
    setChartView(key, tableViews().has(key) ? 'table' : 'chart', true);
  }
}
function setChartView(key, view, quiet) {
  const card = $('chart-' + key).closest('.chart-card');
  const table = view === 'table';
  card.querySelectorAll('.vt').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  card.querySelector('.chart-wrap').hidden = table;
  $('table-' + key).hidden = !table;
  if (!table && state.charts[key]) { try { state.charts[key].resize(); } catch (e) { /* not drawn yet */ } }
  if (quiet) return;
  const set = tableViews();
  if (table) set.add(key); else set.delete(key);
  try { localStorage.setItem(TABLE_VIEW_STORE, JSON.stringify([...set])); } catch (e) { /* fine without */ }
}
/* Levels follow Notes for the team: temperature 37.5 and 38.0; heart rate 100 and 120, or 50
   and under; blood pressure 140/90 and 160/100, or systolic 90 and under; oxygen 93 and 90 and
   under; pain 5 and 7; a night under 5 hours. Mood, weight and drinks carry no level. */
function tableLevel(key, e) {
  const v = Number(e.value);
  if (key === 'temp') return v >= 38 ? 'red' : v >= 37.5 ? 'amber' : '';
  if (key === 'heart') { const n = Number(e.heartRate); return n >= 120 || n <= 50 ? 'red' : n >= 100 ? 'amber' : ''; }
  if (key === 'bp') { const s = Number(e.systolic), d = Number(e.diastolic); return s >= 160 || d >= 100 || s <= 90 ? 'red' : s >= 140 || d >= 90 ? 'amber' : ''; }
  if (key === 'oxygen') { const n = Number(e.oxygen); return n <= 90 ? 'red' : n <= 93 ? 'amber' : ''; }
  if (key === 'pain') { const n = e.type === 'pain' ? v : Number(e.pain); return n >= 7 ? 'red' : n >= 5 ? 'amber' : ''; }
  if (key === 'sleep') return v > 0 && v < 300 ? 'amber' : '';
  if (key === 'bowel') return e.blood || e.black || (isLoose(e) && e.night) ? 'red' : isLoose(e) ? 'amber' : '';
  return '';
}
function renderChartTables(entries, from) {
  const inRange = entries.filter((e) => e.day >= from);
  const dayText = (s) => parseDay(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeText = (e) => fmtTime(entryDate(e));
  const sub = (t) => t ? h('small', { text: t }) : null;
  const rangeWord = `the last ${state.trendRange} days`;
  const drinkTotals = {};
  for (const e of inRange) if (e.type === 'drink') drinkTotals[e.day] = (drinkTotals[e.day] || 0) + (Number(e.value) || 0);
  /* each: the entries, the value column heading, the value cell (a string or nodes), the time cell */
  const specs = {
    temp: { rows: inRange.filter((e) => e.type === 'temp'), head: 'Temperature', cell: (e) => [fmtTemp(e.value), sub(e.note)] },
    pain: { rows: inRange.filter((e) => e.type === 'pain' || (isPatientCheckin(e) && e.pain != null)), head: 'Pain', cell: (e) => [(e.type === 'pain' ? Number(e.value) : Number(e.pain)) + '/10', sub(e.type === 'pain' ? (e.note ? 'Reading: ' + e.note : 'Reading') : checkinTitle(e.slot))] },
    mood: { rows: inRange.filter((e) => isPatientCheckin(e) && e.mood != null), head: 'Mood', cell: (e) => [Number(e.mood) + '/10', sub(checkinTitle(e.slot))] },
    heart: { rows: inRange.filter((e) => e.type === 'vitals' && e.heartRate), head: 'Heart rate', cell: (e) => [Math.round(Number(e.heartRate)) + ' bpm', sub(e.note)] },
    bp: { rows: inRange.filter((e) => e.type === 'vitals' && e.systolic && e.diastolic), head: 'Blood pressure', cell: (e) => [Math.round(Number(e.systolic)) + '/' + Math.round(Number(e.diastolic)) + ' mmHg', sub(e.note)] },
    oxygen: { rows: inRange.filter((e) => e.type === 'vitals' && e.oxygen), head: 'Oxygen', cell: (e) => [Math.round(Number(e.oxygen)) + '%', sub(e.note)] },
    weight: { rows: inRange.filter((e) => e.type === 'weight' && Number(e.value) > 0), head: 'Weight', cell: (e) => [weightPref() === 'stlb' ? fmtStLb(e.value) : fmtKg(e.value), sub(weightPref() === 'stlb' ? [fmtKg(e.value), e.note].filter(Boolean).join(' · ') : e.note)] },
    sleep: { rows: inRange.filter((e) => e.type === 'sleep'), head: 'Asleep', timeHead: 'Bed to up',
      time: (e) => e.bedAt && e.wokeAt ? e.bedAt + ' to ' + e.wokeAt : '--',
      cell: (e) => { const st = ['deep', 'core', 'rem'].filter((k) => Number(e[k]) > 0).map((k) => (k === 'rem' ? 'REM' : k[0].toUpperCase() + k.slice(1)) + ' ' + fmtHm(Number(e[k]))); if (Number(e.awake) > 0) st.push('awake ' + fmtHm(Number(e.awake))); return [fmtHm(Number(e.value) || 0), sub(st.join(' · '))]; } },
    drink: { rows: inRange.filter((e) => e.type === 'drink'), head: 'Amount', cell: (e) => [(Number(e.value) || 0) + ' ml', sub(e.note)], dayNote: (day) => 'Total ' + (drinkTotals[day] || 0) + ' ml' },
    bowel: { rows: inRange.filter((e) => e.type === 'bowel'), head: 'Bowels', cell: (e) => { if (e.none) return ['None']; const ts = bowelTypes(e); return [(ts.length > 1 ? 'Types ' : 'Type ') + ts.join(', '), sub([ts.map((t) => bristolName(t)).join(', '), bowelFlagWords(e), e.note].filter(Boolean).join(' · '))]; } }
  };
  for (const key of CHART_TABLE_KEYS) {
    const box = $('table-' + key);
    if (!box) continue;
    const s = specs[key];
    box.replaceChildren();
    if (!s.rows.length) { box.appendChild(h('p', { class: 'chart-table-empty', text: `No readings in ${rangeWord}.` })); continue; }
    const rows = s.rows.slice().sort((a, b) => entryDate(b) - entryDate(a));
    const tbody = h('tbody');
    let lastDay = null;
    for (const e of rows) {
      const first = e.day !== lastDay;
      lastDay = e.day;
      const level = tableLevel(key, e);
      const dateCell = h('td', { class: 'td-date' + (first ? '' : ' is-repeat'), text: dayText(e.day) });
      if (first && s.dayNote) dateCell.appendChild(h('small', { text: s.dayNote(e.day) }));
      const cell = h('td', { class: 'td-val' + (level ? ' lvl-' + level : '') });
      for (const part of s.cell(e)) { if (part == null) continue; if (typeof part === 'string') cell.appendChild(document.createTextNode(part)); else cell.appendChild(part); }
      tbody.appendChild(h('tr', null, dateCell, h('td', { class: 'td-time', text: s.time ? s.time(e) : timeText(e) }), cell));
    }
    box.appendChild(h('table', null,
      h('caption', { class: 'sr-only', text: `${s.head} readings, ${rangeWord}, newest first` }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Date' }), h('th', { scope: 'col', text: s.timeHead || 'Time' }), h('th', { scope: 'col', text: s.head }))),
      tbody));
  }
}
wireChartViews();
wireWeightSwitch();

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
  if (w) {
    countTo($('vt-weight-value'), Number(w.value), { decimals: 1, unit: 'kg' });
    $('vt-weight-sub').textContent = whenLabel(w);
  }
  else { clearCount($('vt-weight-value'), '--'); $('vt-weight-sub').textContent = 'none yet'; }
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

async function renderVitals() {
  document.querySelectorAll('#view-vitals .unitswitch').forEach((w) => w.sync && w.sync());
  const from = addDays(todayStr(), -(state.trendRange - 1));
  const entries = await loadEntriesFrom(from);
  if (!entries) return;
  entries.sort((a, b) => entryDate(a) - entryDate(b));
  renderVitalsLatest(entries);
  renderChartTables(entries, from);
  /* Latest readings and the tables are shown above regardless; only the charts need the library. */
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
      title: pointTitle, label: (item) => item.raw.y.toFixed(1) + ' \u00B0C'
    }, false, tPoints.length)
  });

  /* Drinks per day */
  const perDay = days.map((d) => entries.filter((e) => e.type === 'drink' && e.day === d).reduce((s, e) => s + (Number(e.value) || 0), 0));
  makeChart('drink', barChart(T, days.map(dayLabel), perDay, { unit: (v) => v + ' ml', reduced }));

  /* Bowel movements per day, stacked: types 1 to 5 in teal, loose (6 or 7) in warm */
  const bowelReal = entries.filter((e) => e.type === 'bowel' && !e.none);
  const firm = days.map((d) => bowelReal.filter((e) => e.day === d && !isLoose(e)).length);
  const loose = days.map((d) => bowelReal.filter((e) => e.day === d && isLoose(e)).length);
  const bar = (label, data, colour) => ({ label, data, backgroundColor: colour, borderRadius: 6, borderSkipped: 'bottom', maxBarThickness: 28, stack: 'bowel' });
  makeChart('bowel', {
    type: 'bar',
    data: { labels: days.map(dayLabel), datasets: [bar('Types 1 to 5', firm, hexAlpha(T.teal, 0.7)), bar('Loose, type 6 or 7', loose, T.warm)] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, right: 4 } },
      animation: reduced ? false : { duration: 700, easing: 'easeOutQuart' },
      scales: { x: Object.assign(xAxisBase(T), { stacked: true }), y: Object.assign(yAxisBase(T), { stacked: true, beginAtZero: true, suggestedMax: 4, ticks: Object.assign(yAxisBase(T).ticks, { precision: 0 }) }) },
      plugins: { legend: { display: false }, tooltip: Object.assign(tooltipStyle(T), { callbacks: { label: (i) => i.dataset.label + ': ' + i.raw } }) } }
  });

  /* Weight */
  const weights = entries.filter((e) => e.type === 'weight');
  const wUnit = weightPref(); // stones and pounds are plotted in pounds, labelled as stones and pounds
  const wPoints = weights.map((e) => (wUnit === 'kg' ? Number(e.value) : Number(e.value) / KG_PER_LB));
  const wTick = (v) => (wUnit === 'kg' ? v + ' kg' : Math.floor(Math.round(v) / 14) + ' st ' + (Math.round(v) % 14));
  makeChart('weight', {
    type: 'line',
    data: { labels: weights.map((e) => dayLabel(e.day)), datasets: [lineSeries(T, T.teal, wPoints, { label: 'Weight' })] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, right: 10 } },
      interaction: { mode: 'nearest', intersect: false },
      animation: reduced ? false : drawIn(wPoints.length),
      scales: { x: xAxisBase(T), y: Object.assign(yAxisBase(T), { grace: '15%', ticks: Object.assign(yAxisBase(T).ticks, { precision: 1, callback: wTick }) }) },
      plugins: { legend: { display: false }, tooltip: Object.assign(tooltipStyle(T), { callbacks: { label: (i) => (wUnit === 'kg' ? fmtKg(i.raw) : fmtStLb(Number(i.raw) * KG_PER_LB) + ' (' + fmtKg(Number(i.raw) * KG_PER_LB) + ')') } }) } }
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
        try { await updateDoc(hdoc('documents', d.id), { ...data, updatedAt: serverTimestamp() }); }
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
      h('div', { class: 'docitem-sub', text: d.category === 'answers' ? [fmtDayNum(d.docDate || ''), 'Kept by Daybook from your answered questions'].join(' \u00B7 ') : [fmtDayNum(d.docDate || ''), d.category === 'chemo' ? 'Treatment plan' : d.category === 'exemption' ? 'Exemption certificate' : null, d.kind === 'text' ? 'Text' : (d.pageCount === 1 ? '1 page' : d.pageCount + ' pages'), d.explanation ? 'Explained' : 'No explanation yet'].filter(Boolean).join(' \u00B7 ') })
    ),
    d.category === 'answers' ? h('span', { class: 'pill pill-teal', role: 'img', 'aria-label': 'Questions answered' }, icon('check'))
      : h('span', { class: 'pill ' + (d.explanation ? 'pill-green' : 'pill-amber'), role: 'img', 'aria-label': d.explanation ? 'Explained' : 'No explanation yet' }, d.explanation ? icon('check') : '?')
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
  const ref = doc(hcol('documents'));
  const batch = writeBatch(db);
  batch.set(ref, data);
  pages.forEach((p, i) => {
    batch.set(hdoc('documents', ref.id, 'pages', String(i + 1)), { n: i + 1, data: p.data, width: p.width, height: p.height });
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
  /* a Questions answered document is kept by Daybook: no explanation, no editing, no deleting here */
  const auto = d.category === 'answers';
  $('doc-explain-block').hidden = auto;
  $('doc-edit').hidden = auto;
  $('doc-delete').hidden = auto;
  $('doc-auto-hint').hidden = !auto;
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
      const snap = await getDocs(query(hcol('documents', id, 'pages'), orderBy('n')));
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
/* A question's number is its place among the questions that exist, oldest first, answered ones
   included: it stays put when one is answered and closes up when one is deleted. The list, the
   answer sheet, the PDF, the copied text and the recording file names all use it (v80; until then
   the list counted only the open ones and the sheet counted differently, so "2" opened "Q3"). */
function questionNumbers(list) {
  const map = new Map();
  list.slice().sort((a, b) => entryDate(a) - entryDate(b)).forEach((q, i) => map.set(q.id, i + 1));
  return map;
}
function questionNumber(id) {
  const nums = questionNumbers(allQuestions());
  return nums.get(id) || nums.size + 1;
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
  const ref = doc(hcol('recordings'));
  const batch = writeBatch(db);
  batch.set(ref, { ...meta, at: Timestamp.fromDate(now), createdAt: serverTimestamp() });
  parts.forEach((data, n) => batch.set(hdoc('recordings', ref.id, 'parts', String(n)), { n, data }));
  await batch.commit();
  return ref.id;
}
async function loadRecordings(questionId) {
  if (state.demo) return state.demoRecordings.filter((r) => r.questionId === questionId || (r.questionIds || []).includes(questionId)).sort((a, b) => entryDate(a) - entryDate(b));
  /* a question's own recordings, then any appointment recording with an answer marked for it
     (two single-field queries, no composite index) */
  const [own, appts] = await Promise.all([
    getDocs(query(hcol('recordings'), where('questionId', '==', questionId))),
    getDocs(query(hcol('recordings'), where('questionIds', 'array-contains', questionId)))]);
  const seen = new Map();
  [...own.docs, ...appts.docs].forEach((d) => seen.set(d.id, { id: d.id, ...d.data() }));
  return [...seen.values()].sort((a, b) => entryDate(a) - entryDate(b));
}

/* Recording the whole appointment (since v113): one recording, up to an hour, with a mark for each
   question as its answer starts. recordings/{id} { kind "appointment", questionId null, questionIds,
   marks [{ questionId, n, text, s (seconds in) }], day, at (when it started), mime, ext, seconds,
   bytes, parts, addedBy, createdAt }, the audio in parts like any recording. The parts go in batches
   of eight (a Firestore write may not exceed 10 MB) and the record itself last, so a half-finished
   upload never shows. */
const APPT_MAX_SECONDS = 3600;
const PARTS_PER_BATCH = 8;
async function saveAppointmentRecording(blob, mime, seconds, marks) {
  const b64 = await blobToB64(blob);
  const parts = [];
  for (let i = 0; i < b64.length; i += REC_PART_CHARS) parts.push(b64.slice(i, i + REC_PART_CHARS));
  const started = new Date(Date.now() - seconds * 1000);
  const meta = { kind: 'appointment', questionId: null, questionIds: [...new Set(marks.map((m) => m.questionId))], marks, questionText: '', day: dayStr(started), mime, ext: recExt(mime), seconds: Math.round(seconds), bytes: blob.size, parts: parts.length, addedBy: state.name };
  if (state.demo) {
    const id = fakeId('rec');
    state.demoRecordings.push({ id, ...meta, at: demoTs(started), createdAt: demoTs(started), blob });
    return id;
  }
  const ref = doc(hcol('recordings'));
  for (let i = 0; i < parts.length; i += PARTS_PER_BATCH) {
    const batch = writeBatch(db);
    parts.slice(i, i + PARTS_PER_BATCH).forEach((data, k) => batch.set(hdoc('recordings', ref.id, 'parts', String(i + k)), { n: i + k, data }));
    await batch.commit();
  }
  await setDoc(ref, { ...meta, at: Timestamp.fromDate(started), createdAt: serverTimestamp() });
  return ref.id;
}
async function loadAppointmentRecordings(from, to) {
  let list;
  if (state.demo) list = state.demoRecordings.filter((r) => r.kind === 'appointment');
  else {
    const snap = await getDocs(query(hcol('recordings'), where('kind', '==', 'appointment')));
    list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return list.filter((r) => r.day >= from && r.day <= to).sort((a, b) => entryDate(b) - entryDate(a));
}
function apptFilename(rec) { const d = entryDate(rec); return `Daybook appointment ${dayStr(d)} ${fmtTime(d).replace(':', '-')}.${rec.ext || recExt(rec.mime || '')}`; }
/* An audio player that starts at a given second (the mark for an answer) */
function playFrom(player, rec, seconds, label) {
  return recordingBlob(rec).then((blob) => {
    const audio = h('audio', { controls: '', src: URL.createObjectURL(blob) });
    audio.setAttribute('aria-label', label);
    player.replaceChildren(audio);
    const go = () => { try { if (seconds) audio.currentTime = seconds; } catch (e) { /* not seekable yet */ } audio.play().catch(() => {}); };
    if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
    return audio;
  });
}
/* Take the recording's marks off its questions' counts when it is deleted */
async function deleteAppointmentRecording(rec) {
  await deleteRecording(rec);
  for (const id of rec.questionIds || []) {
    const q = allQuestions().find((x) => x.id === id);
    if (q) await updateEntry(id, { recordings: Math.max(0, (q.recordings || 1) - 1) });
  }
}

/* The appointment sheet: consent first, then one recording with the open questions listed; a tap on
   a question marks where its answer starts (a second tap moves the mark to now). Stopping, or
   closing the sheet, saves it and marks each tapped question answered. The screen is kept awake,
   since a locked iPhone stops recording. */
function openAppointmentSheet() {
  const nums = questionNumbers(allQuestions());
  const open = allQuestions().filter((q) => !q.answered).sort((a, b) => nums.get(a.id) - nums.get(b.id));
  const marks = new Map();
  const status = h('p', { class: 'hint rec-status', role: 'status' });
  const time = h('span', { class: 'rec-time mono', text: '' });
  const label = h('span', { class: 'recbtn-label', text: 'Start recording' });
  const recBtn = h('button', { class: 'recbtn', type: 'button', 'aria-pressed': 'false' }, icon('mic'), label, time);
  let recorder = null, stream = null, chunks = [], startedAt = 0, ticker = null, wake = null, saved = false;
  const elapsed = () => (Date.now() - startedAt) / 1000;
  const keepAwake = async () => { try { if (navigator.wakeLock && !wake && recorder) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); };
  const rows = open.map((q) => {
    const mark = h('span', { class: 'apptq-mark', text: 'Tap when they start answering' });
    const row = h('button', { class: 'apptq-row', type: 'button', disabled: true, 'aria-pressed': 'false' },
      h('span', { class: 'apptq-n', text: 'Q' + nums.get(q.id) }),
      h('span', { class: 'apptq-main' }, h('span', { text: q.note || '' }), mark));
    row.addEventListener('click', () => {
      if (!recorder) return;
      const s = Math.max(0, Math.floor(elapsed()) - 2); // a couple of seconds back, so the start of the answer is not clipped
      marks.set(q.id, { questionId: q.id, n: nums.get(q.id), text: q.note || '', s });
      row.classList.add('is-marked'); row.setAttribute('aria-pressed', 'true');
      mark.textContent = 'Answer marked at ' + fmtSeconds(s) + '. Tap again to move it to now.';
    });
    return row;
  });
  const setRecording = (on) => {
    recBtn.classList.toggle('is-recording', on); recBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    label.textContent = on ? 'Recording, tap to stop and save' : 'Start recording';
    rows.forEach((r) => { r.disabled = !on; });
    if (!on) time.textContent = '';
  };
  const stopStream = () => {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (wake) { wake.release().catch(() => {}); wake = null; }
    document.removeEventListener('visibilitychange', onVisible);
  };
  async function start() {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast('Daybook needs the microphone for this. Allow it in Settings and try again.'); return; }
    const mime = recMime();
    try { recorder = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 32000 }, mime ? { mimeType: mime } : {})); }
    catch (e) { try { recorder = new MediaRecorder(stream); } catch (e2) { toast('Recording is not available on this phone'); stopStream(); return; } }
    chunks = [];
    recorder.addEventListener('dataavailable', (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); });
    recorder.addEventListener('stop', finish);
    recorder.start(1000);
    startedAt = Date.now();
    setRecording(true);
    keepAwake(); document.addEventListener('visibilitychange', onVisible);
    status.textContent = 'Recording. Keep Daybook open on the screen. Up to an hour.';
    ticker = setInterval(() => { const s = elapsed(); time.textContent = fmtSeconds(s); if (s >= APPT_MAX_SECONDS) stop(); }, 250);
  }
  function stop() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }
  async function finish() {
    const seconds = elapsed();
    const type = (recorder && recorder.mimeType) || recMime() || 'audio/webm';
    stopStream(); setRecording(false);
    const blob = new Blob(chunks, { type });
    recorder = null;
    if (!blob.size || seconds < 1) { status.textContent = 'Nothing was recorded.'; return; }
    status.textContent = 'Saving the recording. Keep Daybook open until it says saved.';
    try {
      const list = [...marks.values()].sort((a, b) => a.s - b.s);
      await saveAppointmentRecording(blob, type, seconds, list);
      for (const m of list) {
        const cur = allQuestions().find((x) => x.id === m.questionId) || {};
        await updateEntry(m.questionId, { answered: true, answeredAt: stampNow(), recordings: (cur.recordings || 0) + 1 });
      }
      saved = true;
      status.textContent = `Saved: ${fmtSeconds(seconds)}${list.length ? ', with ' + plural(list.length, 'answer') + ' marked' : ''}.`;
      toast('Appointment recording saved' + (list.length ? '. ' + plural(list.length, 'question') + ' marked as answered.' : ''));
      recBtn.hidden = true;
      if (!$('view-notes').hidden) renderNotesReport();
    } catch (e) { console.error(e); status.textContent = 'Could not save the recording.'; toast('Could not save the recording'); }
  }
  const consent = h('div', { class: 'consent', role: 'group', 'aria-label': 'Before recording' },
    h('p', { class: 'consent-q', text: 'Has everyone agreed to be recorded?' }),
    h('p', { class: 'hint', text: 'Ask at the start, before the questions. Recording starts only when you tap Yes.' }),
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { consent.hidden = true; recBtn.hidden = false; start(); } }, 'Yes, start recording'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: closeSheet }, 'Not now')));
  recBtn.hidden = true;
  recBtn.addEventListener('click', () => { if (recorder && recorder.state === 'recording') stop(); else if (!saved) start(); });
  const body = h('div', null,
    consent, recBtn, status,
    open.length ? h('p', { class: 'fieldlabel', text: 'Your questions' }) : h('p', { class: 'hint', text: 'No open questions. The recording still works; add questions on Today for next time.' }),
    open.length ? h('div', { class: 'apptq' }, ...rows) : '',
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, 'Close'));
  openSheet('Appointment', body, () => { if (recorder && recorder.state === 'recording') stop(); else stopStream(); });
}

async function renderAppointmentList(from, to) {
  const box = $('notes-appts');
  const nums = questionNumbers(allQuestions());
  let recs = [];
  try { recs = await loadAppointmentRecordings(from, to); } catch (e) { console.error(e); }
  box.replaceChildren(...recs.map((rec) => {
    const player = h('div', { class: 'rec-player' });
    const when = `${fmtDayShort(rec.day)} ${fmtTime(entryDate(rec))}`;
    const chips = (rec.marks || []).map((m) => h('button', { class: 'markchip', type: 'button', 'aria-label': `Play the answer to question ${nums.get(m.questionId) || m.n} from ${fmtSeconds(m.s)}`,
      onclick: () => playFrom(player, rec, m.s, 'Appointment ' + when).catch(() => toast('Could not load the recording')) }, `Q${nums.get(m.questionId) || m.n} ${fmtSeconds(m.s)}`));
    const del = h('button', { class: 'btn btn-link btn-small', type: 'button' }, 'Delete');
    del.addEventListener('click', () => {
      const yes = h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async () => {
        yes.disabled = true;
        try { await deleteAppointmentRecording(rec); toast('Recording deleted'); } catch (e) { console.error(e); toast('Could not delete'); }
        renderNotesReport();
      } }, 'Yes, delete for good');
      const keep = h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { yes.replaceWith(del); keep.remove(); } }, 'Keep');
      del.replaceWith(yes); yes.after(keep); yes.focus();
    });
    return h('div', { class: 'recrow apptrec' },
      h('div', { class: 'recrow-title', text: `Appointment · ${when} · ${fmtSeconds(rec.seconds || 0)}` }),
      chips.length ? h('div', { class: 'markchips', role: 'group', 'aria-label': 'Answers marked' }, ...chips) : '',
      h('div', { class: 'recrow-btns' },
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => playFrom(player, rec, 0, 'Appointment ' + when).catch(() => toast('Could not load the recording')) }, 'Play'),
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => {
          try {
            const blob = await recordingBlob(rec); const name = apptFilename(rec);
            const file = new File([blob], name, { type: rec.mime });
            if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
            const url = URL.createObjectURL(blob); const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('Recording saved as ' + name);
          } catch (e) { console.error(e); toast('Could not share the recording'); }
        } }, 'Save or share'),
        del),
      player);
  }));
}
async function recordingBlob(rec) {
  if (rec.blob) return rec.blob;
  const snap = await getDocs(query(hcol('recordings', rec.id, 'parts'), orderBy('n')));
  return b64ToBlob(snap.docs.map((d) => d.data().data).join(''), rec.mime);
}
async function deleteRecording(rec) {
  if (state.demo) { state.demoRecordings = state.demoRecordings.filter((r) => r.id !== rec.id); return; }
  const snap = await getDocs(hcol('recordings', rec.id, 'parts'));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(hdoc('recordings', rec.id));
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

/* Questions answered, filed as documents (since v114). Every day on which questions were answered
   gets one text document, documents/answers-{day} { title "Questions answered, 22 Sept to 5 Oct 2026"
   (from the first of them asked to the day answered), docDate the day answered, kind "text", category
   "answers", text (each question, who asked it and when, the answer or that a recording is saved),
   explanation "", pageCount 0, auto true, addedBy "Daybook" }. Rebuilt from the questions whenever
   Notes for the team or the documents list is drawn, written only when its text has changed, removed
   when none of that day's questions is still answered. They live under Letters, results and paperwork
   and are kept out of the report, which no longer prints answered questions. */
function answeredDayOf(q) {
  const t = q && q.answeredAt;
  if (!t) return null;
  const d = typeof t.toDate === 'function' ? t.toDate() : (t instanceof Date ? t : null);
  return d ? dayStr(d) : null;
}
function fmtDayRange(a, b) {
  if (!a || a >= b) return fmtDayNum(b);
  return (a.slice(0, 4) === b.slice(0, 4) ? fmtDayShort(a) : fmtDayNum(a)) + ' to ' + fmtDayNum(b);
}
function answerDocsFrom(questionsAll) {
  const nums = questionNumbers(questionsAll);
  const byDay = {};
  questionsAll.filter((q) => q.answered && answeredDayOf(q)).forEach((q) => { const d = answeredDayOf(q); (byDay[d] = byDay[d] || []).push(q); });
  return Object.keys(byDay).sort().map((day) => {
    const qs = byDay[day].sort((a, b) => nums.get(a.id) - nums.get(b.id));
    const first = qs.map((q) => q.day).filter(Boolean).sort()[0] || day;
    const lines = [`Questions answered on ${fmtDayLong(day)} ${day.slice(0, 4)}.`, `Asked between ${fmtDayRange(first, day).replace(' to ', ' and ')}.`];
    if (first >= day) lines[1] = `Asked on ${fmtDayNum(first)}.`;
    qs.forEach((q) => {
      lines.push('', `Q${nums.get(q.id)}. ${q.note || ''}`, `Asked by ${q.addedBy || 'unknown'} on ${fmtDayNum(q.day)}.`);
      if (q.answerText) lines.push('Answer: ' + q.answerText);
      if (q.recordings) lines.push(`${q.recordings === 1 ? 'A recording is' : plural(q.recordings, 'recording') + ' are'} saved in Daybook: open the question on Today, or Notes for the team, to play it.`);
      if (!q.answerText && !q.recordings) lines.push('Marked as answered. No answer written down.');
    });
    return { id: 'answers-' + day, day, title: 'Questions answered, ' + fmtDayRange(first, day), text: lines.join('\n') };
  });
}
let answerSync = null;
function syncAnswerDocs(questionsAll) {
  if (state.readOnly || state.viewer || !state.documents) return Promise.resolve();
  const run = async () => {
    const want = answerDocsFrom(questionsAll || await loadQuestions());
    const have = state.documents.filter((d) => d.category === 'answers');
    for (const w of want) {
      const cur = have.find((d) => d.id === w.id);
      if (cur && cur.text === w.text && cur.title === w.title) continue;
      const data = { title: w.title, docDate: w.day, kind: 'text', category: 'answers', text: w.text, explanation: '', pageCount: 0, auto: true, addedBy: 'Daybook' };
      if (state.demo) {
        state.documents = state.documents.filter((d) => d.id !== w.id).concat([{ id: w.id, ...data }]).sort((a, b) => (b.docDate || '').localeCompare(a.docDate || ''));
        renderDocsList();
      } else await setDoc(hdoc('documents', w.id), { ...data, updatedAt: serverTimestamp(), ...(cur ? {} : { addedAt: serverTimestamp() }) }, { merge: true });
    }
    for (const d of have) {
      if (want.some((w) => w.id === d.id)) continue;
      if (state.demo) { state.documents = state.documents.filter((x) => x.id !== d.id); renderDocsList(); }
      else await deleteDoc(hdoc('documents', d.id));
    }
  };
  answerSync = (answerSync || Promise.resolve()).then(run).catch((e) => console.error(e));
  return answerSync;
}

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
      if (rec.kind === 'appointment') {
        const m = (rec.marks || []).find((x) => x.questionId === q.id) || { s: 0 };
        return h('div', { class: 'recrow' },
          h('div', { class: 'recrow-head' },
            h('div', { class: 'recrow-title', text: `Appointment recording · ${fmtDayShort(rec.day)} ${fmtTime(entryDate(rec))} · answer from ${fmtSeconds(m.s)}` }),
            h('div', { class: 'recrow-btns' },
              h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => playFrom(player, rec, m.s, 'Appointment recording').catch(() => toast('Could not load the recording')) }, 'Play the answer'))),
          h('p', { class: 'hint', text: 'Saved, shared or deleted from Notes for the team.' }),
          player);
      }
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
    else await updateDoc(hdoc('documents', d.id), { explanation: text, updatedAt: serverTimestamp() });
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
    await updateDoc(hdoc('documents', d.id), { explanation: text, updatedAt: serverTimestamp() });
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
    const snap = await getDocs(hcol('documents', d.id, 'pages'));
    for (const p of snap.docs) await deleteDoc(p.ref);
    await deleteDoc(hdoc('documents', d.id));
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
    const snap = await getDocs(query(hcol('entries'), where('type', '==', 'checkin')));
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
        await setDoc(hdoc('days', key), data, { merge: true });
        if (data.chemoDone && !wasDone) { confetti(); toast('One more session done. Well done.'); }
        else toast('Saved');
      } catch (e) { console.error(e); toast('Could not save'); }
    } }, 'Save'),
    info.chemo ? h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: async () => {
      closeSheet();
      const data = { chemo: false, chemoDone: false, updatedBy: state.name, updatedAt: serverTimestamp() };
      if (state.demo) { state.days[key] = { ...state.days[key], chemo: false, chemoDone: false }; renderChemo(); toast('Session removed'); return; }
      try { await setDoc(hdoc('days', key), data, { merge: true }); toast('Session removed'); } catch (e) { console.error(e); toast('Could not clear'); }
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
/* Exercise: steps (Apple Health or by hand), the programme, physio, streak */
/* ------------------------------------------------------------------ */
/* profile/main.programme = { items: [{ id, name, section "exercise"|"physio", kind, amount, sets?, days?, note? }] }
   and profile/main.physio = { from, given, notes } (the plan's header). A day's ticks stay in
   exercise/{day}.done keyed by item id. Kinds: reps, seconds, minutes, sets (amount = reps per set),
   do (no count, just tick it), lengths (amount lengths of a pool metres pool) and distance (amount in dunit
   "km"|"m"); time is an optional target in minutes for lengths and distance. match ("walk"|"swim"|"run"|"cycle"|"any")
   ticks the item from Apple Health workouts that day, when they reach the target (itemHealth()); an item ticked that
   way and then unticked by hand is kept off in exercise/{day}.off[id]. days is a list of getDay() numbers, none meaning every day.
   since "YYYY-MM-DD" is the day an item was added in the app: before it the item is not due, so
   adding an exercise never turns past days into missed ones (the starting four carry no since). */
const PROGRAMME_KINDS = [
  { key: 'reps', label: 'Reps', unit: (it) => (Number(it.amount) === 1 ? '1 rep' : Number(it.amount) + ' reps') },
  { key: 'seconds', label: 'Seconds', unit: (it) => fmtSecondsWord(Number(it.amount)) },
  { key: 'minutes', label: 'Minutes', unit: (it) => fmtMinutesWord(Number(it.amount)) },
  { key: 'sets', label: 'Sets and reps', unit: (it) => (Number(it.sets) || 1) + ' sets of ' + Number(it.amount) },
  { key: 'lengths', label: 'Lengths', unit: (it) => Number(it.amount) + ' \u00d7 ' + poolLength(it) + ' m' + timeWord(it) },
  { key: 'distance', label: 'Distance', unit: (it) => fmtMetres(itemMetres(it)) + timeWord(it) },
  { key: 'do', label: 'Just tick it off', unit: () => 'once' }
];
function fmtMinutesWord(n) { return n === 1 ? '1 minute' : n + ' minutes'; }
function timeWord(it) { return Number(it.time) > 0 ? ' in ' + fmtMinutesWord(Number(it.time)) : ''; }
function poolLength(it) { return Number(it.pool) > 0 ? Number(it.pool) : 25; }
/* The distance an item asks for, in metres (0 for kinds that are not a distance) */
function itemMetres(it) {
  if (it.kind === 'lengths') return (Number(it.amount) || 0) * poolLength(it);
  if (it.kind === 'distance') return (Number(it.amount) || 0) * (it.dunit === 'm' ? 1 : 1000);
  return 0;
}
/* Distances read as people say them: 750 m, 1.2 km */
function fmtMetres(m) { return m < 1000 ? Math.round(m) + ' m' : (Math.round(m / 10) / 100) + ' km'; }
function fmtKm(km) { return fmtMetres((Number(km) || 0) * 1000); }

/* Apple Health workouts by activity, from the workout's own name ("Pool Swim", "Outdoor Walk", "Hiking") */
const WORKOUT_ACTIVITIES = [
  { key: 'walk', label: 'Walk', re: /walk|hik/i },
  { key: 'swim', label: 'Swim', re: /swim/i },
  { key: 'run', label: 'Run', re: /run|jog/i },
  { key: 'cycle', label: 'Cycle', re: /cycl|bik/i }
];
function workoutActivity(name) { const a = WORKOUT_ACTIVITIES.find((x) => x.re.test(String(name || ''))); return a ? a.key : null; }
/* What Apple Health recorded that day towards one item: the matching workouts added together, and whether they reach the target */
function itemHealth(item, rec) {
  if (!item.match) return null;
  const ws = (rec.workouts || []).filter((w) => item.match === 'any' || workoutActivity(w.name) === item.match);
  if (!ws.length) return null;
  const minutes = ws.reduce((t, w) => t + (Number(w.minutes) || 0), 0);
  const withKm = ws.filter((w) => Number(w.km) > 0);
  const metres = withKm.reduce((t, w) => t + Number(w.km) * 1000, 0);
  const bits = [];
  if (minutes) bits.push(minutes + ' min');
  if (withKm.length) bits.push(fmtMetres(metres));
  let met = true, short = '';
  if (item.kind === 'minutes') { met = minutes >= Number(item.amount); short = minutes + ' of ' + Number(item.amount) + ' min'; }
  else if (item.kind === 'lengths' || item.kind === 'distance') { const want = itemMetres(item); met = withKm.length > 0 && metres >= want; short = withKm.length ? fmtMetres(metres) + ' of ' + fmtMetres(want) : 'no distance recorded'; }
  return { met, text: met ? 'Apple Health: ' + bits.join(' \u00b7 ') : 'Apple Health so far: ' + short };
}
/* Ticked by hand, or reached through Apple Health and not unticked by hand */
function isItemDone(item, rec) {
  const d = rec.done || {};
  if (d[item.id] === true) return true;
  const hp = itemHealth(item, rec);
  return !!(hp && hp.met && !(rec.off || {})[item.id]);
}
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
function fmtSecondsWord(sec) { return sec >= 60 && sec % 60 === 0 ? (sec / 60) + (sec === 60 ? ' minute' : ' minutes') : sec + ' seconds'; }
function programmeKind(item) { return PROGRAMME_KINDS.find((k) => k.key === item.kind) || PROGRAMME_KINDS[0]; }
function itemTarget(item) { return item.targetText || programmeKind(item).unit(item); }
function itemDaysText(item) { return !item.days || !item.days.length || item.days.length === 7 ? 'every day' : WEEK_ORDER.filter((d) => item.days.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(', '); }
function defaultProgrammeItems() {
  const g = { ...GOAL_DEFAULTS, ...((state.profile && state.profile.exerciseGoals) || {}) };
  return [
    { id: 'pressups', name: 'Press-ups', section: 'exercise', kind: 'reps', amount: g.pressups },
    { id: 'situps', name: 'Sit-ups', section: 'exercise', kind: 'reps', amount: g.situps },
    { id: 'plank', name: 'Plank', section: 'exercise', kind: 'seconds', amount: g.plankSeconds },
    { id: 'squats', name: 'Squats', section: 'exercise', kind: 'reps', amount: g.squats }
  ];
}
function programmeItems() {
  const p = state.profile && state.profile.programme;
  return p && Array.isArray(p.items) ? p.items : defaultProgrammeItems();
}
function physioPlan() { return (state.profile && state.profile.physio) || {}; }
function itemDue(item, day) {
  if (item.since && day < item.since) return false;
  return !item.days || !item.days.length || item.days.includes(parseDay(day).getDay());
}
function exerciseFor(day) { return state.exercise[day] || {}; }
/* Every programme item due that day is ticked (the "All done for today" toast). There is no streak: it was not motivational. */
function allGoalsDone(day) {
  const due = countedItems().filter((it) => itemDue(it, day));
  if (!due.length) return false;
  const rec = exerciseFor(day);
  return due.every((it) => isItemDone(it, rec));
}
async function saveProgramme(items, physio) {
  const programme = { items: items.map((it) => ({ ...it, amount: Number(it.amount) || 0 })) };
  const patch = physio !== undefined ? { programme, physio } : { programme };
  if (state.demo) { state.profile = { ...state.profile, ...patch }; renderExercise(); return; }
  await setDoc(hdoc('profile', 'main'), patch, { merge: true });
}
function newItemId() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

$('ex-prev').addEventListener('click', () => { state.exerciseDay = addDays(state.exerciseDay, -1); renderExercise(); });
$('ex-next').addEventListener('click', () => { if (state.exerciseDay < todayStr()) { state.exerciseDay = addDays(state.exerciseDay, 1); renderExercise(); } });
$('ex-label').addEventListener('click', () => openDayPicker(state.exerciseDay, (d) => { state.exerciseDay = d; renderExercise(); },
  async (month) => new Set(Object.keys(state.exercise || {}).filter((d) => d.startsWith(month) && (exerciseFor(d).steps || Object.values(exerciseFor(d).done || {}).some(Boolean))))));

/* A programme item started from an Apple Health workout: a swim by its distance, anything else by its minutes, ticked from Health from then on */
function itemFromWorkout(w) {
  const activity = workoutActivity(w.name);
  const base = { id: newItemId(), name: w.name || 'Workout', section: 'exercise', match: activity || null };
  if (activity === 'swim' && Number(w.km) > 0) return { ...base, name: 'Swim', kind: 'distance', dunit: 'm', amount: Math.max(25, Math.round(Number(w.km) * 1000 / 25) * 25) };
  const name = activity ? WORKOUT_ACTIVITIES.find((a) => a.key === activity).label : base.name;
  return { ...base, name, kind: 'minutes', amount: Math.max(1, Math.round(w.minutes || 30)) };
}

/* ---- Gentle exercises (since v83): a library with body-area tags, an avoid filter and a picker ----
   Twenty-four exercises in three groups, each tagged with the body areas it uses. The picker (a sheet from the
   Exercise tab) opens on a warning box that is always shown, then the avoid tick boxes, a group drop-down and the
   group's exercises; Done logs the exercise as an `entries` document { type "exercise", exId, note (the name),
   group, tags, day, at, addedBy } so it carries the time and who did it, shows on Today's timeline and under the
   picker, and can be deleted like any entry. The avoid ticks live on this phone only (localStorage). Everything
   here is optional, there is no streak and no tally beyond "done today". */
const EX_TAGS = { arms: 'Arms', legs: 'Legs', spine: 'Spine', stand: 'Standing' };
const EX_TAG_ORDER = ['arms', 'legs', 'spine', 'stand'];
const EX_GROUPS = [['upper', 'Upper body'], ['lower', 'Lower body'], ['full', 'Full body']];
/* starter: the three in each group a poorly person could begin with, if their team agrees */
const EXERCISE_LIBRARY = [
  { id: 'neck-rot', group: 'upper', name: 'Neck rotation (seated)', tags: ['spine'], how: 'Turn your head slowly towards one shoulder, hold 5 seconds, return.', target: '3 each side', starter: true },
  { id: 'neck-stretch', group: 'upper', name: 'Neck stretch (seated)', tags: ['spine', 'arms'], how: 'Hold one shoulder down with the opposite hand, tilt your head to the other side. Hold 5 seconds.', target: '3 each side' },
  { id: 'shoulder-rolls', group: 'upper', name: 'Shoulder rolls (seated)', tags: ['arms'], how: 'Roll the shoulders slowly.', target: '10 backwards, then 10 forwards', starter: true },
  { id: 'chest-stretch', group: 'upper', name: 'Chest stretch (seated)', tags: ['arms', 'spine'], how: 'Arms out to the sides, shoulders back and down, gently push your chest forward and up.', target: 'Hold 5 to 10 seconds, 5 times' },
  { id: 'w-squeeze', group: 'upper', name: 'W squeeze (seated)', tags: ['arms', 'spine'], how: 'Arms out in a W shape, squeeze the shoulder blades back and down. If your arms will not go that high, rest them on the chair arms.', target: 'Hold 5 seconds, 5 times' },
  { id: 'upper-twist', group: 'upper', name: 'Upper body twist (seated)', tags: ['spine', 'arms'], how: 'Arms crossed reaching for your shoulders, turn the upper body to one side without moving your hips.', target: 'Hold 5 seconds, 5 each side' },
  { id: 'overhead-breathe', group: 'upper', name: 'Overhead reach and breathe (seated)', tags: ['arms'], how: 'Breathe in for 4 while raising your arms overhead, hold 8 seconds if you can, breathe out through pursed lips for 8 while lowering.', target: '3 times', starter: true },
  { id: 'bicep-curls', group: 'upper', name: 'Bicep curls (seated)', tags: ['arms'], how: 'Light weights or filled water bottles. Curl to the shoulder and lower slowly.', target: '5 each arm, up to 3 sets' },
  { id: 'wall-pressups', group: 'upper', name: 'Wall press-ups', tags: ['arms', 'stand'], how: 'Hands flat on the wall at chest height, bend the elbows slowly towards the wall and push back.', target: '5 to 10, up to 3 sets' },
  { id: 'ankle-pumps', group: 'lower', name: 'Ankle pumps (seated)', tags: ['legs'], how: 'Point your toes up, then down. Helps circulation.', target: '30 seconds', starter: true },
  { id: 'ankle-circles', group: 'lower', name: 'Ankle circles (seated)', tags: ['legs'], how: 'Lift one foot and circle it, then swap feet.', target: '5 circles each way, each foot', starter: true },
  { id: 'hip-marching', group: 'lower', name: 'Hip marching (seated)', tags: ['legs'], how: 'Lift one knee at a time without leaning back, place the foot down with control.', target: '5 each leg', starter: true },
  { id: 'knee-ext', group: 'lower', name: 'Knee extensions (seated)', tags: ['legs'], how: 'Straighten one leg, hold 1 second, bend and lower. Alternate legs.', target: '30 seconds' },
  { id: 'groin-stretch', group: 'lower', name: 'Seated groin stretch', tags: ['legs', 'arms'], how: 'Feet flat, knees apart, gently press the knees outwards against your hands. Stop if it pulls sharply.', target: 'Hold 3 seconds, 5 times' },
  { id: 'hamstring', group: 'lower', name: 'Seated hamstring stretch', tags: ['legs', 'spine'], how: 'One leg out straight with the heel on the floor, lean forward gently from the hips.', target: 'Hold 10 seconds each leg' },
  { id: 'toe-reach', group: 'lower', name: 'Seated toe reach', tags: ['legs', 'spine', 'arms'], how: 'Feet flat, slide your hands down your shins towards your toes as far as is comfortable.', target: 'Hold 10 seconds, 3 times' },
  { id: 'calf-raises', group: 'lower', name: 'Calf raises', tags: ['legs', 'stand'], how: 'Hold the chair back, lift both heels slowly, lower with control.', target: '5 times' },
  { id: 'side-leg', group: 'lower', name: 'Sideways leg lift', tags: ['legs', 'stand'], how: 'Hold the chair back, raise one leg to the side, keep your back and hips straight.', target: '5 each leg' },
  { id: 'mini-squats', group: 'lower', name: 'Mini squats', tags: ['legs', 'stand'], how: 'Hold the chair back, bend the knees slowly as far as is comfortable with your back straight, then stand squeezing your buttocks.', target: '5 times' },
  { id: 'sit-stand', group: 'full', name: 'Sit to stand', tags: ['legs'], how: 'Sit on the chair edge, lean slightly forward, stand using your legs not your arms, then sit slowly.', target: '5 times', starter: true },
  { id: 'side-bend', group: 'full', name: 'Seated side bend', tags: ['spine', 'arms'], how: 'Slide one hand down towards the floor, hold 2 seconds, return.', target: '3 each side' },
  { id: 'buttock-squeeze', group: 'full', name: 'Buttock squeezes (seated)', tags: ['legs'], how: 'Squeeze the buttocks together, hold 3 seconds, relax.', target: 'Repeat for 30 seconds', starter: true },
  { id: 'short-walk', group: 'full', name: 'Short walk', tags: ['legs', 'stand'], how: 'Indoors or in the garden, at a comfortable pace.', target: '2 to 5 minutes' },
  { id: 'breathing-488', group: 'full', name: '4-8-8 breathing (seated)', tags: [], how: 'In through the nose for 4, hold for 8, out through pursed lips for 8. Uses no arms, legs or spine, so it is never hidden by the filter.', target: '3 times', starter: true }
];
const EX_WARNING = {
  title: 'Check before you start',
  intro: 'Some exercises may need changing or skipping if you have any of the following. Ask your care team which ones are safe for you:',
  list: ['Blood clots', 'Broken bones', 'Weakened bones', 'Recent surgery on your spine, arms or legs'],
  rest: ['Each exercise is tagged with the body areas it uses. If your care team has told you to avoid an area, tick it below and those exercises will be hidden.',
    'You should feel no more than slight strain. Exercises must not cause pain. Tell your care team if you get new or increased pain.',
    'Stop straight away if you get chest pressure, dizziness or shortness of breath. If it does not settle after resting, call 999.']
};
const EX_AVOID_STORE = 'daybook.exercise.avoid';
function exAvoid() {
  if (!state.exAvoid) {
    state.exAvoid = new Set();
    try { for (const t of JSON.parse(localStorage.getItem(EX_AVOID_STORE) || '[]')) if (EX_TAGS[t]) state.exAvoid.add(t); } catch (e) { /* no storage */ }
  }
  return state.exAvoid;
}
function saveExAvoid() { try { localStorage.setItem(EX_AVOID_STORE, JSON.stringify([...exAvoid()])); } catch (e) { /* fine */ } }
function exHidden(ex) { const a = exAvoid(); return ex.tags.some((t) => a.has(t)); }
function exById(id) { return EXERCISE_LIBRARY.find((x) => x.id === id) || null; }
function tagPills(tags) {
  const wrap = h('span', { class: 'extags', role: 'group', 'aria-label': 'Body areas' });
  const list = EX_TAG_ORDER.filter((t) => tags.includes(t));
  if (!list.length) wrap.append(h('span', { class: 'extag is-none', text: 'No body area' }));
  list.forEach((t) => wrap.append(h('span', { class: 'extag is-' + t, text: EX_TAGS[t] })));
  return wrap;
}
/* The exercises logged on a day, newest first */
/* A second identical exercise entry (same exercise, same person) within this window is a double tap, not a second exercise */
const DUP_WINDOW_MS = 5000;
function exerciseLogFor(day) {
  const src = day === state.selectedDay && state.dayEntries.length ? state.dayEntries : state.recentEntries;
  const all = src.filter((e) => e.type === 'exercise' && e.day === day).sort((a, b) => entryDate(a) - entryDate(b));
  /* fold double taps: keep the first of a run of identical entries seconds apart, and note the strays for the clean-up */
  const kept = [], lastBy = new Map();
  all.forEach((e) => {
    const key = (e.exId || e.note) + '|' + (e.addedBy || '');
    const prev = lastBy.get(key);
    if (prev && entryDate(e) - entryDate(prev) < DUP_WINDOW_MS) { duplicateIds.add(e.id); return; }
    lastBy.set(key, e); kept.push(e);
  });
  return kept.reverse();
}
/* The strays exerciseLogFor() found (document ids). A family phone deletes them once, so they stop coming back from
   Firestore on every listener update; the display fold above covers the moment until then and read-only accounts. */
const duplicateIds = new Set();
const duplicatesCleaned = new Set();
function cleanDuplicateExercises() {
  if (state.readOnly || state.viewer) return;
  duplicateIds.forEach((id) => {
    if (duplicatesCleaned.has(id)) return;
    duplicatesCleaned.add(id);
    deleteEntry(id).then(() => console.info('Removed a duplicate exercise entry', id)).catch((e) => { console.error(e); duplicatesCleaned.delete(id); });
  });
  duplicateIds.clear();
}
function exWarningBox() {
  return h('div', { class: 'exwarn', role: 'region', 'aria-label': EX_WARNING.title },
    h('div', { class: 'exwarn-head' }, icon('warning', 'exwarn-icon'), h('h3', { class: 'exwarn-title', text: EX_WARNING.title })),
    h('p', { text: EX_WARNING.intro }),
    h('ul', null, ...EX_WARNING.list.map((t) => h('li', { text: t }))),
    ...EX_WARNING.rest.map((t) => h('p', { text: t })));
}
function openExercisePicker() {
  const avoid = exAvoid();
  const hiddenLine = h('p', { class: 'exhidden', role: 'status' });
  const filterBox = h('div', { class: 'exfilter' }, h('h3', { class: 'exfilter-title', text: "I've been told to avoid:" }));
  const ticks = h('div', { class: 'exfilter-ticks' });
  const rows = new Map();   // exercise id -> { row, box }
  const groupEmpty = new Map();
  /* the filter hides rows in place, so the list never rebuilds and the page never jumps */
  const applyFilter = () => {
    let hiddenCount = 0;
    EXERCISE_LIBRARY.forEach((ex) => { const hid = exHidden(ex); rows.get(ex.id).row.hidden = hid; if (hid) hiddenCount++; });
    EX_GROUPS.forEach(([k]) => { groupEmpty.get(k).hidden = EXERCISE_LIBRARY.some((x) => x.group === k && !exHidden(x)); });
    hiddenLine.textContent = 'Hidden exercises: ' + hiddenCount;
  };
  EX_TAG_ORDER.forEach((t) => {
    const box = h('input', { type: 'checkbox', id: 'exavoid-' + t });
    box.checked = avoid.has(t);
    box.addEventListener('change', () => { if (box.checked) avoid.add(t); else avoid.delete(t); saveExAvoid(); applyFilter(); });
    ticks.append(h('label', { class: 'check exfilter-check', for: 'exavoid-' + t }, box, h('span', { class: 'extag is-' + t, text: EX_TAGS[t] })));
  });
  filterBox.append(ticks, hiddenLine);
  /* one tick box per exercise: ticked means it is in the Gentle exercises list on the Exercise tab */
  const list = h('div', { class: 'exlist' });
  EX_GROUPS.forEach(([k, label]) => {
    list.append(h('h3', { class: 'exgroup-title', text: label }));
    const empty = h('p', { class: 'muted exempty', text: 'No exercises left in this group with your current filters.', hidden: true });
    groupEmpty.set(k, empty);
    EXERCISE_LIBRARY.filter((x) => x.group === k).sort((a, b) => (b.starter ? 1 : 0) - (a.starter ? 1 : 0)).forEach((ex) => {
      const box = h('input', { type: 'checkbox', id: 'plan-' + ex.id, disabled: state.readOnly });
      box.checked = inPlan(ex);
      box.addEventListener('change', async () => { box.disabled = true; const ok = await setInPlan(ex, box.checked); if (!ok) box.checked = !box.checked; box.disabled = state.readOnly; });
      const row = h('label', { class: 'exrow' + (ex.starter ? ' is-starter' : ''), for: box.id },
        h('span', { class: 'exrow-box' }, box),
        h('span', { class: 'exrow-main' },
          h('span', { class: 'exrow-name' }, ex.name, ex.starter ? h('span', { class: 'extag is-starter', text: 'Gentle start' }) : null),
          h('span', { class: 'exrow-how', text: ex.how }),
          h('span', { class: 'exrow-target', text: ex.target }),
          tagPills(ex.tags)));
      rows.set(ex.id, { row, box });
      list.append(row);
    });
    list.append(empty);
  });
  applyFilter();
  const body = h('div', { class: 'expicker' },
    exWarningBox(),
    filterBox,
    h('p', { class: 'hint', text: 'Tick the ones you want on the Exercise tab. All optional. If you are new to this, the three marked Gentle start in each group are a place to begin, if your care team agrees.' }),
    list,
    ownBox(),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: closeSheet }, 'Done'));
  openSheet('Gentle exercises', body);
  /* an exercise the list does not have (one a physio gave): a name here, then the usual sheet for how it is counted, into the Gentle exercises list */
  function ownBox() {
    if (state.readOnly) return null;
    const name = h('input', { type: 'text', placeholder: 'e.g. Heel slides', maxlength: '60', 'aria-label': 'Your own exercise' });
    const add = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => {
      const n = name.value.trim();
      if (!n) { toast('Give it a name'); name.focus(); return; }
      openItemSheet({ id: newItemId(), name: n, section: 'stretch', kind: 'reps', amount: 5 }, true, () => openExercisePicker());
    } }, 'Add');
    name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add.click(); } });
    return h('div', { class: 'exown' },
      h('p', { class: 'exfilter-title', text: 'Not in the list?' }),
      h('p', { class: 'hint', text: 'Add your own, for an exercise your physio or team gave you. It goes on the Exercise tab with its own reps or time.' }),
      h('div', { class: 'exown-row' }, name, add));
  }
}
const PROGRAMME_SECTIONS = [['exercise', 'Daily exercises'], ['stretch', 'Gentle exercises'], ['physio', 'Physio plan']];
/* Swipe a Gentle exercises row to the left to reveal Remove (touch only; Edit programme and the picker's tick boxes are the other ways) */
function swipeToRemove(wrap, item) {
  const behind = h('button', { class: 'swipe-remove', type: 'button', 'aria-label': 'Remove ' + item.name + ' from Gentle exercises', onclick: async () => {
    const items = programmeItems().map((it) => ({ ...it })).filter((it) => it.id !== item.id);
    try { await saveProgramme(items); renderExercise(); toast('Removed ' + item.name, { label: 'Undo', onClick: async () => { await saveProgramme(programmeItems().concat([item])); renderExercise(); } }); }
    catch (e) { console.error(e); toast('Could not save'); }
  } }, 'Remove');
  const shell = h('div', { class: 'swipe' }, behind, wrap);
  let x0 = null, dx = 0, open = false;
  const set = (d) => { wrap.style.transform = d ? 'translateX(' + d + 'px)' : ''; };
  wrap.addEventListener('touchstart', (ev) => { x0 = ev.touches[0].clientX; dx = 0; wrap.style.transition = 'none'; shell.classList.add('is-dragging'); }, { passive: true });
  wrap.addEventListener('touchmove', (ev) => { if (x0 == null) return; dx = Math.max(-104, Math.min(0, ev.touches[0].clientX - x0 + (open ? -96 : 0))); set(dx); }, { passive: true });
  wrap.addEventListener('touchend', () => { wrap.style.transition = ''; open = dx < -48; set(open ? -96 : 0); shell.classList.toggle('is-open', open); shell.classList.remove('is-dragging'); x0 = null; }, { passive: true });
  return shell;
}
function stretchItems() { return programmeItems().filter((it) => it.section === 'stretch'); }
/* The items that count towards "all done" today: everything except the optional stretches */
function countedItems() { return programmeItems().filter((it) => it.section !== 'stretch'); }
/* A library exercise as a programme item in the stretch section (the Gentle exercises list): kind and amount drive the
   timer (seconds or minutes when the target is purely a time), targetText keeps the library's own wording */
function libToItem(ex) {
  const t = ex.target;
  let kind = 'reps', amount = parseInt((t.match(/\d+/) || ['1'])[0], 10) || 1;
  const secs = t.match(/^(?:repeat for )?(\d+) seconds$/i), mins = t.match(/^(\d+)(?: to (\d+))? minutes$/i);
  if (secs) { kind = 'seconds'; amount = parseInt(secs[1], 10); }
  else if (mins) { kind = 'minutes'; amount = parseInt(mins[2] || mins[1], 10); }
  return { id: 'lib-' + ex.id, lib: ex.id, name: ex.name, section: 'stretch', kind, amount, targetText: t, note: ex.how, tags: ex.tags.slice(), since: todayStr() };
}
function inPlan(ex) { return programmeItems().some((it) => it.lib === ex.id); }
async function setInPlan(ex, on) {
  const items = programmeItems().map((it) => ({ ...it })).filter((it) => it.lib !== ex.id);
  if (on) items.push(libToItem(ex));
  try { await saveProgramme(items); toast(on ? ex.name + ' added to Gentle exercises' : ex.name + ' removed from Gentle exercises'); renderExercise(); return true; }
  catch (e) { console.error(e); toast('Could not save'); return false; }
}
/* Everything done on a day: the programme ticks (since v87 the old picker log no longer counts, as it is no longer shown here) */
function doneTodayCount(day) {
  const rec = exerciseFor(day);
  return programmeItems().filter((it) => itemDue(it, day) && isItemDone(it, rec)).length;
}

/* A countdown for anything counted in seconds or minutes: a plank for 1 minute, a stretch for 30 seconds.
   Three seconds to get ready, then the time the person set; a beep and vibration at the end where the phone
   allows them (an iPhone's silent switch mutes the beep), and the screen turns green either way. The clock
   runs from an end time, not from counting ticks, so a locked or busy phone still shows the right time. */
function timerSeconds(item) {
  const n = Number(item.amount) || 0;
  return item.kind === 'minutes' ? Math.round(n * 60) : item.kind === 'seconds' ? Math.round(n) : 0;
}
function fmtClock(sec) { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + pad2(sec % 60); }
function openTimerSheet(item, day) {
  const total = timerSeconds(item);
  const LEAD_MS = 3000;
  let phase = 'ready', endAt = 0, remainingMs = total * 1000, lastLead = 0, wake = null, audio = null;
  const ring = h('div', { class: 'timer-ring', 'aria-hidden': 'true' });
  const clock = h('div', { class: 'timer-clock', role: 'timer', 'aria-label': 'Time left' });
  const face = h('div', { class: 'timer-face' }, ring, clock);
  const status = h('p', { class: 'timer-state', role: 'status' });
  const controls = h('div', { class: 'timer-controls' });
  const wrapEl = h('div', { class: 'timer' },
    h('p', { class: 'timer-note', text: item.note || itemTarget(item) }), face, status, controls,
    h('p', { class: 'timer-hint', text: 'Keeps the screen awake while it runs. An iPhone\'s silent switch mutes the beep, so watch for the screen turning green.' }));

  const ensureAudio = () => {
    if (!audio) { try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); } catch (e) { audio = null; } }
    try { if (audio && audio.state === 'suspended') audio.resume(); } catch (e) { /* no sound */ }
  };
  const beep = (freq, ms, delay) => {
    if (!audio) return;
    try {
      const t = audio.currentTime + (delay || 0) / 1000;
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + ms / 1000 + 0.05);
    } catch (e) { /* silent */ }
  };
  const holdAwake = async () => {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; }
  };
  const letGo = () => { try { if (wake) wake.release(); } catch (e) { /* fine */ } wake = null; };
  const onVisible = () => { if (document.visibilityState === 'visible' && (phase === 'running' || phase === 'lead')) holdAwake(); };
  document.addEventListener('visibilitychange', onVisible);

  const btn = (label, cls, onclick) => h('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
  const start = () => { ensureAudio(); holdAwake(); phase = 'lead'; endAt = Date.now() + LEAD_MS; lastLead = 0; draw(); };
  const pause = () => { remainingMs = Math.max(0, endAt - Date.now()); phase = 'paused'; letGo(); draw(); };
  const resume = () => { ensureAudio(); holdAwake(); endAt = Date.now() + remainingMs; phase = 'running'; draw(); };
  const again = () => { phase = 'ready'; remainingMs = total * 1000; letGo(); draw(); };
  const finish = () => {
    phase = 'done'; remainingMs = 0; letGo();
    beep(880, 180, 0); beep(880, 180, 260); beep(1175, 450, 520);
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]); } catch (e) { /* not on this phone */ }
    draw();
  };
  const tickOff = async () => { await toggleGoal(day, item.id); closeSheet(); };

  function draw() {
    const rec = exerciseFor(day);
    const isDone = isItemDone(item, rec);
    let left = remainingMs, pct = 0, text = '', stateText = '';
    if (phase === 'ready') { left = total * 1000; text = fmtClock(total); stateText = 'Ready when you are'; }
    else if (phase === 'lead') { const l = Math.max(0, endAt - Date.now()); text = String(Math.max(1, Math.ceil(l / 1000))); stateText = 'Get ready'; }
    else if (phase === 'running') { left = Math.max(0, endAt - Date.now()); pct = 100 * (1 - left / (total * 1000)); text = fmtClock(left / 1000); stateText = 'Go'; }
    else if (phase === 'paused') { pct = 100 * (1 - remainingMs / (total * 1000)); text = fmtClock(remainingMs / 1000); stateText = 'Paused'; }
    else { pct = 100; text = '0:00'; stateText = 'Time. Well done.'; }
    ring.style.setProperty('--p', String(Math.round(pct * 10) / 10));
    clock.textContent = text;
    face.className = 'timer-face' + (phase === 'done' ? ' is-done' : phase === 'lead' ? ' is-lead' : '');
    if (status.dataset.s !== stateText) { status.textContent = stateText; status.dataset.s = stateText; }
    status.className = 'timer-state' + (phase === 'done' ? ' is-done' : '');
    if (phase === 'ready') controls.replaceChildren(btn('Start', 'btn-primary', start));
    else if (phase === 'lead') controls.replaceChildren(btn('Cancel', 'btn-secondary', again));
    else if (phase === 'running') controls.replaceChildren(btn('Pause', 'btn-secondary', pause));
    else if (phase === 'paused') controls.replaceChildren(btn('Resume', 'btn-primary', resume), btn('Start again', 'btn-secondary', again));
    else controls.replaceChildren(isDone ? btn('Done', 'btn-primary', closeSheet) : btn('Tick it off', 'btn-primary', tickOff), btn('Again', 'btn-secondary', again));
  }
  const loop = setInterval(() => {
    if (phase === 'lead') {
      const l = Math.ceil((endAt - Date.now()) / 1000);
      if (l !== lastLead && l > 0) { lastLead = l; beep(660, 90, 0); }
      if (Date.now() >= endAt) { phase = 'running'; endAt = Date.now() + total * 1000; beep(988, 220, 0); }
      draw();
    } else if (phase === 'running') {
      if (Date.now() >= endAt) finish(); else draw();
    }
  }, 200);
  draw();
  openSheet(item.name, wrapEl, () => { clearInterval(loop); letGo(); document.removeEventListener('visibilitychange', onVisible); try { if (audio) audio.close(); } catch (e) { /* fine */ } });
}

function goalRow(item, done, day) {
  const hp = itemHealth(item, exerciseFor(day));
  const target = itemTarget(item);
  const btn = h('button', { class: 'goal' + (done ? ' is-done' : ''), type: 'button', 'aria-pressed': done ? 'true' : 'false', disabled: state.readOnly, onclick: () => toggleGoal(day, item.id) },
    h('span', { class: 'goal-box' }, done ? icon('check') : null),
    h('span', { class: 'goal-main' }, h('span', { class: 'goal-label', text: item.name }), item.note ? h('span', { class: 'goal-note', text: item.note }) : null,
      hp ? h('span', { class: 'goal-health', text: hp.text }) : null,
      h('span', { class: 'sr-only', text: target }))
  );
  /* the side column is the same width on every row: the reps or time as a pill, and under it a Timer pill for anything counted in seconds or minutes, so rows line up */
  const side = h('div', { class: 'goal-side' }, h('span', { class: 'goal-target pill-target', text: target }));
  if (timerSeconds(item) && !state.readOnly) side.append(h('button', { class: 'btn btn-secondary timerbtn', type: 'button', 'aria-label': 'Start the ' + fmtSecondsWord(timerSeconds(item)) + ' timer for ' + item.name, onclick: () => openTimerSheet(item, day) }, 'Timer'));
  return h('div', { class: 'goal-wrap' }, btn, side);
}

function renderExercise() {
  const day = state.exerciseDay;
  const today = todayStr();
  const lbl = $('ex-label');
  lbl.replaceChildren(fmtDayLong(day), h('small', { text: day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : fmtDayNum(day) }));
  $('ex-next').style.visibility = day >= today ? 'hidden' : 'visible';

  const rec = exerciseFor(day);
  if (rec.steps) { countTo($('ex-steps-value'), Number(rec.steps), { format: (n) => Math.round(n).toLocaleString('en-GB') }); $('ex-steps-sub').textContent = 'steps'; }
  else { clearCount($('ex-steps-value'), '--'); $('ex-steps-sub').textContent = 'not logged'; }

  const doneN = doneTodayCount(day);
  countTo($('ex-done-value'), doneN);
  $('ex-done-sub').textContent = doneN === 1 ? 'exercise done' : 'exercises done';
  $('ex-done-tile').classList.toggle('is-green', doneN > 0);
  /* entries the v83/v84 picker logged are no longer listed here (they stay on Today's timeline); this pass only finds and removes any double-tap duplicates among them */
  exerciseLogFor(day);
  cleanDuplicateExercises();

  /* Workouts Apple Health already recorded that day (walks, swims, anything on the watch) */
  const workouts = Array.isArray(rec.workouts) ? rec.workouts : [];
  const items = programmeItems();
  $('ex-workouts').hidden = !workouts.length;
  $('ex-workouts-list').replaceChildren(...workouts.map((w) => {
    const bits = [];
    if (w.minutes) bits.push(w.minutes + ' min');
    if (w.km) bits.push(fmtKm(w.km));
    if (w.kcal) bits.push(w.kcal + ' kcal');
    if (w.start) bits.push(w.start);
    const activity = workoutActivity(w.name);
    /* a workout already counting towards something due that day says so, rather than offering to add it again */
    const counts = items.filter((it) => it.match && (it.match === 'any' || it.match === activity) && itemDue(it, day));
    return h('div', { class: 'workout' },
      h('div', { class: 'workout-main' }, h('div', { class: 'workout-name', text: w.name || 'Workout' }), h('div', { class: 'workout-sub', text: bits.join(' · ') })),
      counts.length
        ? h('div', { class: 'workout-counts', text: 'Counts towards ' + counts.map((it) => it.name).join(', ') })
        : h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => openItemSheet(itemFromWorkout(w), true, () => closeSheet()) }, 'Add to programme'));
  }));

  const renderSection = (section, listId, notId) => {
    const mine = items.filter((it) => it.section === section);
    const due = mine.filter((it) => itemDue(it, day));
    const off = mine.filter((it) => !itemDue(it, day));
    $(listId).replaceChildren(...due.map((it) => { const row = goalRow(it, isItemDone(it, rec), day); return section === 'stretch' && !state.readOnly ? swipeToRemove(row, it) : row; }));
    const not = $(notId);
    not.hidden = !off.length;
    not.textContent = off.length ? 'Not today: ' + off.map((it) => it.name + ' (' + itemDaysText(it) + ')').join(', ') : '';
    return mine.length;
  };
  const nSt = renderSection('stretch', 'ex-stretch', 'ex-stretch-not-today');
  $('ex-stretch-empty').hidden = nSt > 0;
  const nEx = renderSection('exercise', 'ex-goals', 'ex-not-today');
  $('ex-goals-empty').hidden = nEx > 0;
  const nPh = renderSection('physio', 'ex-physio', 'ex-physio-not-today');
  const plan = physioPlan();
  const header = [[plan.from ? 'From ' + plan.from : '', plan.given ? 'given ' + fmtDayNum(plan.given) : ''].filter(Boolean).join(', '), plan.notes || ''].filter(Boolean).join('. ');
  $('ex-physio-section').hidden = !(nPh > 0 || header);
  $('ex-physio-hint').hidden = !header;
  $('ex-physio-hint').textContent = header;
  renderStepsChart();
}

const goalTapAt = new Map();
async function toggleGoal(day, id) {
  /* a double tap would tick then untick; the second tap within 600 ms is ignored */
  const now = Date.now();
  if (now - (goalTapAt.get(id) || 0) < 600) return;
  goalTapAt.set(id, now);
  const rec = exerciseFor(day);
  const item = programmeItems().find((it) => it.id === id) || { id };
  const next = !isItemDone(item, rec);
  const done = { ...(rec.done || {}), [id]: next };
  /* unticking something Apple Health ticked keeps it off; ticking it again clears that */
  const off = { ...(rec.off || {}) };
  if (item.match) off[id] = !next;
  const wasAll = allGoalsDone(day);
  const after = { ...rec, done, off };
  const due = countedItems().filter((it) => itemDue(it, day));
  const nowAll = due.length > 0 && due.every((it) => isItemDone(it, after));
  if (state.demo) {
    state.exercise[day] = { ...after, day };
    renderExercise();
    if (nowAll && !wasAll) toast('All done for today. Nice work.');
    return;
  }
  try {
    await setDoc(hdoc('exercise', day), { day, done, off, addedBy: state.name, updatedAt: serverTimestamp() }, { merge: true });
    if (nowAll && !wasAll) toast('All done for today. Nice work.');
  } catch (e) { console.error(e); toast('Could not save'); }
}

$('ex-steps-edit').addEventListener('click', () => openStepsSheet(state.exerciseDay));
$('ex-pick').addEventListener('click', () => openExercisePicker());

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
      try { await setDoc(hdoc('exercise', targetDay), { day: targetDay, steps: v, addedBy: state.name, updatedAt: serverTimestamp() }, { merge: true }); }
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

/* ---- The programme editor: a list to add to, reorder and remove from, each change saved as it is made ---- */
$('ex-goals-edit').addEventListener('click', () => openProgrammeSheet());

function openProgrammeSheet() {
  const items = programmeItems().map((it) => ({ ...it }));
  const list = h('div', { class: 'proglist' });
  const persist = async (next, physio) => {
    try { await saveProgramme(next, physio); } catch (e) { console.error(e); toast('Could not save'); return false; }
    return true;
  };
  const move = async (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    if (await persist(items)) { draw(); renderExercise(); }
  };
  const remove = async (i) => {
    const gone = items.splice(i, 1)[0];
    if (await persist(items)) { toast('Removed ' + gone.name); draw(); renderExercise(); }
  };
  function draw() {
    const rows = [];
    for (const [section, sectionLabel] of PROGRAMME_SECTIONS) {
      const mine = items.map((it, i) => ({ it, i })).filter((x) => x.it.section === section);
      if (!mine.length) continue;
      rows.push(h('p', { class: 'prog-section', text: sectionLabel }));
      mine.forEach(({ it, i }, k) => {
        const del = h('button', { class: 'btn btn-link btn-small', type: 'button', 'aria-label': 'Remove ' + it.name }, 'Remove');
        del.addEventListener('click', () => {
          const yes = h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: () => remove(i) }, 'Yes, remove');
          const keep = h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { yes.replaceWith(del); keep.remove(); } }, 'Keep');
          del.replaceWith(yes); yes.after(keep); yes.focus();
        });
        rows.push(h('div', { class: 'progrow' },
          h('div', { class: 'progrow-main' }, h('div', { class: 'progrow-name', text: it.name }), h('div', { class: 'progrow-sub', text: itemTarget(it) + ', ' + itemDaysText(it) + (it.note ? '. ' + it.note : '') })),
          h('div', { class: 'progrow-btns' },
            h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Move ' + it.name + ' up', disabled: k === 0, onclick: () => move(i, -1) }, '\u2191'),
            h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Move ' + it.name + ' down', disabled: k === mine.length - 1, onclick: () => move(i, 1) }, '\u2193'),
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-label': 'Edit ' + it.name, onclick: () => openItemSheet(it, false, () => openProgrammeSheet()) }, 'Edit'),
            del)));
      });
    }
    /* the up and down arrows swap neighbours in the full list; inside a section the neighbour is the next of the same section */
    list.replaceChildren(...rows);
    if (!items.length) list.append(h('p', { class: 'muted', text: 'Nothing in the programme yet.' }));
  }
  draw();
  const plan = physioPlan();
  const body = h('div', null,
    h('p', { class: 'hint', text: 'Your own exercises, in your own amounts. Tick them off each day on the Exercise tab. Anything from a physio goes under Physio plan.' }),
    list,
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openItemSheet({ id: newItemId(), name: '', section: 'exercise', kind: 'reps', amount: 10 }, true, () => openProgrammeSheet()) }, 'Add exercise'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => openItemSheet({ id: newItemId(), name: '', section: 'physio', kind: 'sets', amount: 10, sets: 3 }, true, () => openProgrammeSheet()) }, 'Add physio exercise')),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => openItemSheet({ id: newItemId(), name: '', section: 'stretch', kind: 'seconds', amount: 30 }, true, () => openProgrammeSheet()) }, 'Add a stretch'),

    explainAvailable() ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => importPlanPhotos() }, 'Add from a photo or PDF of the plan') : null,
    explainAvailable() ? h('p', { class: 'hint', text: 'Photograph the exercise sheet or physio plan, or choose the PDF or Word file if it was emailed, and Daybook reads it into the list for you to check. The file goes to Daybook\'s AI service and is not kept.' }) : null,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => openPhysioDetailsSheet() }, (plan.from || plan.notes) ? 'Physio plan details' : 'Add physio plan details'),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: closeSheet }, 'Done')
  );
  openSheet('Programme', body);
}

/* One exercise: name, where it belongs, how it is counted, how much, which days, a note */
function openItemSheet(item, isNew, after) {
  const it = { ...item, days: Array.isArray(item.days) ? item.days.slice() : [] };
  if (it.dunit !== 'm') it.dunit = 'km';
  if (!('match' in item)) it.match = null;
  let matchTouched = !isNew || 'match' in item;
  const name = h('input', { type: 'text', placeholder: 'e.g. Lunges', value: it.name || '', maxlength: '60' });
  const amount = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: String(it.amount || '') });
  const sets = h('input', { type: 'number', inputmode: 'numeric', min: '1', value: String(it.sets || 3) });
  const pool = h('input', { type: 'number', inputmode: 'numeric', min: '1', value: String(poolLength(it)) });
  const time = h('input', { type: 'number', inputmode: 'numeric', min: '0', placeholder: 'Optional', value: Number(it.time) > 0 ? String(it.time) : '' });
  const poolField = field('Pool length in metres', pool);
  const timeField = field('Time to aim for, in minutes (optional)', time);
  const unitRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Distance in' });
  const matchRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tick it from Apple Health' });
  const matchHint = h('p', { class: 'hint', text: 'Tick it from Apple Health' });
  const note = h('textarea', { rows: '2', placeholder: 'e.g. hold for 10 seconds each side', maxlength: '200' });
  note.value = it.note || '';
  const setsField = field('Sets', sets);
  const amountField = field('How many', amount);
  const sectionRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Where it belongs' });
  const kindRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'How it is counted' });
  const dayRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Which days' });
  const chip = (label, on, onclick) => h('button', { class: 'preset' + (on ? ' is-active' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick }, label);
  const drawSection = () => sectionRow.replaceChildren(chip('Exercise', it.section !== 'physio' && it.section !== 'stretch', () => { it.section = 'exercise'; drawSection(); }), chip('Stretch', it.section === 'stretch', () => { it.section = 'stretch'; drawSection(); }), chip('Physio', it.section === 'physio', () => { it.section = 'physio'; drawSection(); }));
  const drawKind = () => {
    kindRow.replaceChildren(...PROGRAMME_KINDS.map((k) => chip(k.label, it.kind === k.key, () => { it.kind = k.key; drawKind(); })));
    setsField.hidden = it.kind !== 'sets';
    amountField.hidden = it.kind === 'do';
    poolField.hidden = it.kind !== 'lengths';
    unitRow.hidden = it.kind !== 'distance';
    timeField.hidden = !(it.kind === 'lengths' || it.kind === 'distance');
    amountField.querySelector('span').textContent = it.kind === 'sets' ? 'Reps in each set' : it.kind === 'seconds' ? 'Seconds' : it.kind === 'minutes' ? 'Minutes' : it.kind === 'lengths' ? 'How many lengths' : it.kind === 'distance' ? 'How far' : 'How many';
    unitRow.replaceChildren(chip('Kilometres', it.dunit === 'km', () => { it.dunit = 'km'; drawKind(); }), chip('Metres', it.dunit === 'm', () => { it.dunit = 'm'; drawKind(); }));
  };
  const drawMatch = () => matchRow.replaceChildren(chip('Off', !it.match, () => { it.match = null; matchTouched = true; drawMatch(); }),
    ...WORKOUT_ACTIVITIES.map((a) => chip(a.label, it.match === a.key, () => { it.match = a.key; matchTouched = true; drawMatch(); })),
    chip('Any workout', it.match === 'any', () => { it.match = 'any'; matchTouched = true; drawMatch(); }));
  /* a new item called "Swim" or "Evening walk" is ticked from matching workouts unless the person says otherwise */
  name.addEventListener('input', () => { if (!matchTouched) { it.match = workoutActivity(name.value); drawMatch(); } });
  if (isNew && !matchTouched && it.name) it.match = workoutActivity(it.name);
  const drawDays = () => {
    const every = !it.days.length;
    dayRow.replaceChildren(chip('Every day', every, () => { it.days = []; drawDays(); }),
      ...WEEK_ORDER.map((d) => chip(WEEKDAY_SHORT[d], it.days.includes(d), () => { it.days = it.days.includes(d) ? it.days.filter((x) => x !== d) : it.days.concat(d); if (it.days.length === 7) it.days = []; drawDays(); })));
  };
  drawSection(); drawKind(); drawDays(); drawMatch();
  const saveBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
    it.name = name.value.trim();
    const decimals = it.kind === 'distance' && it.dunit === 'km';
    it.amount = it.kind === 'do' ? 1 : Math.max(0, (decimals ? Math.round(parseFloat(amount.value) * 100) / 100 : parseInt(amount.value, 10)) || 0);
    it.sets = it.kind === 'sets' ? Math.max(1, parseInt(sets.value, 10) || 1) : null;
    it.note = note.value.trim();
    if (!it.name) { toast('Give it a name'); name.focus(); return; }
    if (it.kind !== 'do' && !it.amount) { toast('How many?'); amount.focus(); return; }
    const clean = { id: it.id, name: it.name, section: it.section === 'physio' || it.section === 'stretch' ? it.section : 'exercise', kind: it.kind, amount: it.amount, days: it.days };
    if (it.sets) clean.sets = it.sets;
    if (it.kind === 'lengths') clean.pool = Math.max(1, parseInt(pool.value, 10) || 25);
    if (it.kind === 'distance') clean.dunit = it.dunit;
    if ((it.kind === 'lengths' || it.kind === 'distance') && parseInt(time.value, 10) > 0) clean.time = parseInt(time.value, 10);
    if (it.match) clean.match = it.match;
    if (it.note) clean.note = it.note;
    if (isNew) clean.since = todayStr(); else if (it.since) clean.since = it.since;
    if (it.lib) { clean.lib = it.lib; if (it.tags) clean.tags = it.tags; }
    const items = programmeItems().map((x) => ({ ...x }));
    const i = items.findIndex((x) => x.id === it.id);
    if (i >= 0) items[i] = clean; else items.push(clean);
    saveBtn.disabled = true;
    try { await saveProgramme(items); toast(isNew ? 'Added ' + clean.name : 'Saved'); renderExercise(); if (after) after(); else closeSheet(); }
    catch (e) { console.error(e); toast('Could not save'); saveBtn.disabled = false; }
  } }, isNew ? 'Add' : 'Save');
  const body = h('div', null,
    field('Name', name), h('p', { class: 'hint', text: 'Where it belongs' }), sectionRow,
    h('p', { class: 'hint', text: 'How it is counted' }), kindRow, amountField, unitRow, setsField, poolField, timeField,
    h('p', { class: 'hint', text: 'Which days' }), dayRow,
    matchHint, matchRow, h('p', { class: 'hint hint-small', text: 'When a walk, swim, run or ride recorded on the phone or watch reaches the target, it ticks itself. You can still untick it.' }),
    field('Note (optional)', note),
    saveBtn,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { if (after) after(); else closeSheet(); } }, 'Cancel'));
  openSheet(isNew ? 'Add to the programme' : 'Edit exercise', body);
}

function openPhysioDetailsSheet() {
  const plan = physioPlan();
  const from = h('input', { type: 'text', placeholder: 'e.g. Community physio team, Jo', value: plan.from || '', maxlength: '80' });
  const given = h('input', { type: 'date', value: plan.given || '' });
  const notes = h('textarea', { rows: '3', placeholder: 'e.g. Twice a day. Stop if pain goes above 5 out of 10.', maxlength: '400' });
  notes.value = plan.notes || '';
  const body = h('div', null,
    field('Who gave the plan', from), field('When', given), field('Their instructions', notes), speakButton(notes) || '',
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const physio = { from: from.value.trim(), given: given.value || '', notes: notes.value.trim() };
      try { await saveProgramme(programmeItems(), physio); toast('Saved'); renderExercise(); openProgrammeSheet(); }
      catch (e) { console.error(e); toast('Could not save'); }
    } }, 'Save'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => openProgrammeSheet() }, 'Back'));
  openSheet('Physio plan details', body);
}

/* ---- Add from a photo, PDF or Word file: the plan is read by the AI service through the bridge, then checked here before anything is added ---- */
const PLAN_MAX_PAGES = 8; // the bridge's own page limit
function importPlanPhotos() {
  const input = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf,.docx,.txt', multiple: true, style: 'display:none' });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.remove();
    if (!files.length) return;
    const status = h('p', { class: 'hint', role: 'status', text: 'Reading the plan, about half a minute' });
    openSheet('Reading the plan', h('div', null, status, h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => openProgrammeSheet() }, 'Cancel')));
    try {
      /* the same reader the document screen uses: photos and PDF pages become page images, Word and text files become text */
      const read = await processFiles(files, (label) => { status.textContent = label; });
      status.textContent = 'Reading the plan, about half a minute';
      if (read.pages.length > PLAN_MAX_PAGES) throw new Error('That is more than ' + PLAN_MAX_PAGES + ' pages. Choose the pages with the exercises on.');
      const payload = read.kind === 'text' ? { kind: 'programme', text: read.text } : { kind: 'programme', pages: read.pages.map((p) => p.data) };
      const reply = await bridgeExplain(payload);
      const parsed = parsePlanReply(reply.text);
      if (!parsed.items.length) { toast('Could not find any exercises in that photo'); openProgrammeSheet(); return; }
      openPlanReviewSheet(parsed);
    } catch (e) { console.warn(e); toast(e.message || 'Could not read the plan'); openProgrammeSheet(); }
  });
  input.click();
}
function parsePlanReply(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let data = {};
  try { data = JSON.parse(t); } catch (e) { data = {}; }
  const kinds = PROGRAMME_KINDS.map((k) => k.key);
  const items = (Array.isArray(data.items) ? data.items : []).map((x) => ({
    id: newItemId(), name: String(x.name || '').trim().slice(0, 60),
    kind: kinds.includes(x.kind) ? x.kind : 'reps',
    amount: Math.max(0, (x.kind === 'distance' && x.unit !== 'm' ? Math.round(parseFloat(x.amount) * 100) / 100 : parseInt(x.amount, 10)) || 0) || 1,
    sets: x.kind === 'sets' ? Math.max(1, parseInt(x.sets, 10) || 1) : null,
    pool: x.kind === 'lengths' ? Math.max(1, parseInt(x.pool, 10) || 25) : null,
    dunit: x.kind === 'distance' ? (x.unit === 'm' ? 'm' : 'km') : null,
    time: (x.kind === 'lengths' || x.kind === 'distance') && parseInt(x.time, 10) > 0 ? parseInt(x.time, 10) : null,
    match: workoutActivity(x.name),
    days: Array.isArray(x.days) ? x.days.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6) : [],
    note: String(x.note || '').trim().slice(0, 200)
  })).filter((x) => x.name);
  return { items, physio: !!data.physio, from: String(data.from || '').trim(), given: /^\d{4}-\d{2}-\d{2}$/.test(String(data.given || '')) ? data.given : '', notes: String(data.notes || '').trim() };
}
function openPlanReviewSheet(parsed) {
  let section = parsed.physio ? 'physio' : 'exercise';
  const boxes = [];
  const rows = parsed.items.map((it) => {
    const cb = h('input', { type: 'checkbox' }); cb.checked = true; boxes.push(cb);
    return h('label', { class: 'review-row' }, cb, h('span', null, h('span', { class: 'progrow-name', text: it.name }), h('br'), h('span', { class: 'progrow-sub', text: itemTarget(it) + ', ' + itemDaysText(it) + (it.note ? '. ' + it.note : '') })));
  });
  const secRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Where these belong' });
  const chip = (label, on, onclick) => h('button', { class: 'preset' + (on ? ' is-active' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick }, label);
  const drawSec = () => secRow.replaceChildren(chip('Daily exercises', section === 'exercise', () => { section = 'exercise'; drawSec(); }), chip('Physio plan', section === 'physio', () => { section = 'physio'; drawSec(); }));
  drawSec();
  const addBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
    const chosen = parsed.items.filter((it, i) => boxes[i].checked).map((it) => { const c = { id: it.id, name: it.name, section, kind: it.kind, amount: it.amount, days: it.days, since: todayStr() }; for (const k of ['sets', 'pool', 'dunit', 'time', 'match', 'note']) if (it[k]) c[k] = it[k]; return c; });
    if (!chosen.length) { toast('Nothing ticked'); return; }
    addBtn.disabled = true;
    const items = programmeItems().map((x) => ({ ...x })).concat(chosen);
    let physio;
    if (section === 'physio' && (parsed.from || parsed.notes || parsed.given)) { const old = physioPlan(); physio = { from: parsed.from || old.from || '', given: parsed.given || old.given || '', notes: parsed.notes || old.notes || '' }; }
    try { await saveProgramme(items, physio); toast('Added ' + plural(chosen.length, 'exercise')); renderExercise(); openProgrammeSheet(); }
    catch (e) { console.error(e); toast('Could not save'); addBtn.disabled = false; }
  } }, 'Add the ticked ones');
  const body = h('div', null,
    h('p', { class: 'hint', text: 'Check what was read before adding. Untick anything wrong; you can edit names and amounts afterwards.' }),
    ...(parsed.from || parsed.notes ? [h('p', { class: 'hint', text: [parsed.from ? 'From ' + parsed.from : '', parsed.notes].filter(Boolean).join('. ') })] : []),
    secRow, h('div', { class: 'proglist' }, ...rows), addBtn,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => openProgrammeSheet() }, 'Back'));
  openSheet('Read from the photo', body);
}

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

/* Who to contact (since v110; "Who to call" until then). Still stored as profile/main.calls, now
   [{ label (the name), role?, number?, email? }]: a contact needs a name and a phone number or an
   email address. Email opens the phone's own Mail app (mailto), so nothing goes through Daybook. */
const telHref = (n) => 'tel:' + String(n || '').replace(/[^+\d]/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function renderCalls() {
  const wrap = $('calls');
  const calls = (state.profile && state.profile.calls) || [];
  wrap.replaceChildren(...calls.map((c) => h('div', { class: 'card callcard' },
    h('div', { class: 'call-info' },
      h('div', { class: 'call-label', text: c.label }),
      c.role ? h('div', { class: 'call-role', text: c.role }) : '',
      c.number ? h('div', { class: 'call-number', text: c.number }) : '',
      c.email ? h('div', { class: 'call-email', text: c.email }) : ''),
    h('div', { class: 'call-btns' },
      c.number ? h('a', { class: 'btn btn-primary', href: telHref(c.number), 'aria-label': 'Call ' + c.label }, 'Call') : '',
      c.email ? h('a', { class: 'btn btn-secondary', href: 'mailto:' + c.email, 'aria-label': 'Email ' + c.label }, 'Email') : '')
  )));
  if (!calls.length) wrap.append(h('p', { class: 'empty', 'data-art': 'call', text: 'No contacts saved yet. Add the ward, your nurse, the hospice or GP so they are one tap away.' }));
}

$('calls-edit').addEventListener('click', () => {
  const rows = h('div', { class: 'editlist' });
  const addRow = (c) => {
    const label = h('input', { type: 'text', value: (c && c.label) || '', placeholder: 'e.g. Sarah, or the ward', autocomplete: 'off' });
    const role = h('input', { type: 'text', value: (c && c.role) || '', placeholder: 'e.g. Oncology nurse specialist', autocomplete: 'off' });
    const number = h('input', { type: 'tel', value: (c && c.number) || '', placeholder: '01234 567890', autocomplete: 'off' });
    const email = h('input', { type: 'email', value: (c && c.email) || '', placeholder: 'name@nhs.net', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const row = h('div', { class: 'contactrow' },
      h('div', { class: 'contactrow-head' }, h('span', { class: 'contactrow-n' }),
        h('button', { class: 'btn-inline btn-remove', type: 'button', onclick: () => { row.remove(); number_(); } }, 'Remove')),
      field('Name', label), field('Role (optional)', role), field('Phone', number), field('Email', email));
    rows.append(row);
    number_();
  };
  /* "Contact 1", "Contact 2": a heading per block, so a long list stays readable */
  const number_ = () => rows.querySelectorAll('.contactrow').forEach((r, i) => { r.querySelector('.contactrow-n').textContent = 'Contact ' + (i + 1); });
  ((state.profile && state.profile.calls) || []).forEach(addRow);
  if (!rows.children.length) addRow(null);
  const body = h('div', null,
    h('p', { class: 'hint', text: 'A phone number, an email address, or both. Email opens your own Mail app.' }),
    rows,
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { addRow(null); const all = rows.querySelectorAll('.contactrow'); all[all.length - 1].querySelector('input').focus(); } }, 'Add another'),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
      const calls = [];
      for (const r of rows.querySelectorAll('.contactrow')) {
        const [l, ro, n, em] = [...r.querySelectorAll('input')];
        const c = { label: l.value.trim(), role: ro.value.trim(), number: n.value.trim(), email: em.value.trim() };
        if (!c.label && !c.role && !c.number && !c.email) continue;
        if (!c.label) { toast('Add a name for each contact'); l.focus(); return; }
        if (!c.number && !c.email) { toast('Add a phone number or an email for ' + c.label); n.focus(); return; }
        if (c.email && !EMAIL_RE.test(c.email)) { toast('Check the email address for ' + c.label); em.focus(); return; }
        calls.push(c);
      }
      closeSheet();
      if (state.demo) { state.profile = { ...state.profile, calls }; renderCalls(); toast('Contacts saved'); return; }
      try { await setDoc(hdoc('profile', 'main'), { calls }, { merge: true }); toast('Contacts saved'); }
      catch (e) { console.error(e); toast('Could not save'); }
    } }, 'Save'),
    h('button', { class: 'btn btn-link btn-block', type: 'button', onclick: closeSheet }, 'Cancel')
  );
  openSheet('Who to contact', body);
});

/* ------------------------------------------------------------------ */
/* Housekeeping                                                         */
/* ------------------------------------------------------------------ */

$('app-version').textContent = 'Version ' + APP_VERSION;

/* ---- Opener: the loading page, shown on every cold start while the account check runs. The Mark 1 Apps
   film plays every time (since v88; until then only on a phone's first visit, after which a still frame),
   from one second in (OPENER_START_S, the film's quiet lead-in), so about three seconds; a tap anywhere,
   the Skip button, a decode error or the OPENER_CAP_MS cap ends it. The page leaves once the film is done
   and the app or the sign-in screen is ready, and after fifteen seconds regardless. Reduced motion: the
   still frame for as long as loading takes, half a second at least so it never flashes. The harness sets
   localStorage daybook.opener.nofilm to skip the film so no test waits on it. ---- */
const OPENER_START_S = 1, OPENER_CAP_MS = 4500;
(function opener() {
  const el = $('opener'), video = $('opener-video'), skip = $('opener-skip');
  if (!el || !video) return;
  $('opener-version').textContent = 'Version ' + APP_VERSION;
  let noFilm = false;
  try { noFilm = localStorage.getItem('daybook.opener.nofilm') === '1'; } catch (e) { /* ignore */ }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = Date.now(), minMs = 500;
  let appReady = false, filmDone = noFilm || reduced, gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    el.classList.add('is-leaving');
    setTimeout(() => { el.hidden = true; try { video.pause(); } catch (e) { /* ignore */ } }, 440);
  };
  const maybe = () => {
    if (!appReady || !filmDone || gone) return;
    const wait = minMs - (Date.now() - start);
    if (wait > 0) setTimeout(leave, wait); else leave();
  };
  const ready = () => ['app', 'signin', 'noconfig', 'signup', 'nohousehold'].some((id) => { const s = $(id); return s && !s.hidden; });
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
    setTimeout(endFilm, OPENER_CAP_MS);
    /* skip the quiet lead-in: seek once the browser knows the file, then play */
    const begin = () => {
      try { if (video.currentTime < OPENER_START_S) video.currentTime = OPENER_START_S; } catch (e) { /* not seekable yet: play from the start */ }
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(endFilm);
    };
    if (video.readyState >= 1) begin(); else video.addEventListener('loadedmetadata', begin, { once: true });
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
