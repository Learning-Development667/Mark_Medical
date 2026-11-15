/* v461: Daybook's company usage page (usage.html). Mark: "I don't want to have to add Len to my medical data just so he can see
   the app usage. This needs to be a separate function." A company member signs in with their own Daybook sign-in (no care circle
   needed) and, if their confirmed email is on the company access list the operator keeps on the Usage page, sees the nightly
   counts: the same numbers as the app's Usage page, never the feedback, names or anything anyone wrote. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const day = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const KINDS = { document: 'Explain a letter or result', report: 'Notes for the team summary', weekly: 'Weekly notes summary (older app)', mood: 'Mood and wellbeing brief', pain: 'Pain report brief', programme: 'Exercise plan from a photo', medicine: 'Medicine from a photo', flare: 'Flare plan from a photo', sessions: 'Sessions from a photo', notes: 'Suggested questions', results: 'Results from a photo', label: 'Food label from a photo' };

const auth = getAuth(initializeApp(window.CARE_LOG_CONFIG.firebase));
const BRIDGE = window.DAYBOOK_BRIDGE.url.replace(/\/$/, '');
const msg = (t) => { $('u-msg').textContent = t || ''; };

async function call(path, payload) {
  const tok = await auth.currentUser.getIdToken(true);
  const r = await fetch(BRIDGE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(payload || {}) });
  let d = null; try { d = await r.json(); } catch (e) { d = null; }
  if (!r.ok || !d) { const e = new Error((d && d.message) || 'Daybook could not do that just now.'); e.data = d; throw e; }
  return d;
}

const tile = (label, value, sub, tone) => h('div', { class: 'tile ' + (tone || 'is-teal') }, h('span', { class: 'tile-label', text: label }), h('span', { class: 'tile-value', text: String(value) }), h('span', { class: 'tile-sub', text: sub }));
function render(u) {
  const body = $('u-body');
  if (!u || !u.totals) { body.replaceChildren(h('p', { class: 'hint', text: 'Nothing counted yet. The count runs every night at about 03:30.' })); return; }
  const t = u.totals;
  const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '0%');
  const built = u.built ? new Date(u.built) : null;
  const kinds = Object.entries(t.kinds || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const hist = Object.entries(u.history || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const maxA = Math.max(1, ...hist.map(([, v]) => Number(v.active7 || 0)));
  const list = (pairs) => h('dl', { class: 'usage-list' }, ...pairs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })]));
  body.replaceChildren(
    h('p', { class: 'muted', text: built ? 'Counted ' + built.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' at ' + built.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ', for the week to ' + day(u.day) + '.' : '' }),
    h('div', { class: 'status', role: 'group', 'aria-label': 'Usage at a glance' }, h('div', { class: 'tiles tiles-2' },
      tile('Care circles', t.circles, t.new30 + ' new in 30 days'),
      tile('Logged this week', t.active7, pct(t.active7, t.circles) + ' of circles', t.circles && t.active7 / t.circles >= 0.5 ? 'is-green' : 'is-amber'),
      tile('People', t.members, 'in ' + plural(t.circles, 'circle')),
      tile('Check-ins done', pct(t.checkins7, t.checkinSlots), t.checkins7 + ' of ' + t.checkinSlots),
      tile('Assistant this month', t.aiCalls, 'by ' + plural(t.aiCircles, 'circle')),
      tile('Reports sent', t.sent, 'by email, all time'))),
    h('div', { class: 'card usage-card' }, h('h2', { class: 'card-title', text: 'Features used' }),
      list([...(kinds.length ? kinds.map(([k, n]) => [KINDS[k] || k, n]) : [['Daybook Assistant', 'Not used this month']]),
        ['Phones with reminders on', t.phones], ['Set-up completed', t.setup + ' of ' + t.circles],
        ['Set up for cancer treatment', t.packCancer], ["Set up for Crohn's or colitis", t.packIbd], ['Set up for something else', t.packGeneral || 0]])),
    h('div', { class: 'card usage-card' }, h('h2', { class: 'card-title', text: 'Day by day' }),
      h('p', { class: 'hint', text: 'Circles that logged something in the week before each night\'s count.' }),
      h('div', { class: 'usage-bars', role: 'img', 'aria-label': 'Circles that logged something, over the last ' + hist.length + ' nights' },
        ...hist.map(([d, v]) => h('span', { class: 'usage-bar', style: 'height:' + Math.max(4, Math.round(Number(v.active7 || 0) / maxA * 100)) + '%' }))),
      hist.length ? h('p', { class: 'muted', text: day(hist[0][0]) + ': ' + hist[0][1].active7 + ' of ' + hist[0][1].circles + '. ' + day(hist[hist.length - 1][0]) + ': ' + hist[hist.length - 1][1].active7 + ' of ' + hist[hist.length - 1][1].circles + '.' }) : null));
}

async function load(user) {
  $('u-signin').hidden = true; $('u-out').hidden = false; $('u-verify').hidden = true;
  $('u-who').textContent = 'Signed in as ' + user.email + '.';
  $('u-body').replaceChildren(h('p', { class: 'hint', text: 'Fetching the counts' }));
  try { const d = await call('/usage', { what: 'read' }); render(d.usage); }
  catch (e) {
    $('u-body').replaceChildren(h('p', { class: 'hint', text: e.message }));
    $('u-verify').hidden = !(e.data && e.data.unverified);
  }
}
onAuthStateChanged(auth, (user) => {
  if (user) { load(user); return; }
  $('u-out').hidden = true; $('u-signin').hidden = false;
});
$('u-signin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('u-email').value.trim(), pw = $('u-password').value;
  if (!email || !pw) { msg('Put in your email and password.'); return; }
  msg('Signing in');
  try { await signInWithEmailAndPassword(auth, email, pw); msg(''); }
  catch (e) { msg('That email and password did not match a Daybook sign-in.'); }
});
$('u-create').addEventListener('click', async () => {
  const email = $('u-email').value.trim(), pw = $('u-password').value;
  if (!email || pw.length < 10) { msg('Put in your email and a password of at least 10 characters, then press Make my sign-in.'); return; }
  try { await createUserWithEmailAndPassword(auth, email, pw); msg(''); }
  catch (e) { msg(e && e.code === 'auth/email-already-in-use' ? 'There is already a sign-in for that email. Use Sign in.' : 'Could not make the sign-in. Try a longer password.'); }
});
$('u-forgot').addEventListener('click', async () => {
  const email = $('u-email').value.trim();
  if (!email) { msg('Put in your email first.'); return; }
  try { await sendPasswordResetEmail(auth, email); } catch (e) { /* the same words either way */ }
  msg('If there is a sign-in for that email, a link to reset the password is on its way.');
});
$('u-verify').addEventListener('click', async () => {
  try { await call('/verify-email', {}); $('u-body').replaceChildren(h('p', { class: 'hint', text: 'A link is on its way to ' + auth.currentUser.email + '. Open it, then come back and reload this page.' })); $('u-verify').hidden = true; }
  catch (e) { $('u-body').replaceChildren(h('p', { class: 'hint', text: e.message })); }
});
$('u-signout').addEventListener('click', () => signOut(auth));
