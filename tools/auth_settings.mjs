/* Sign-in settings (v491, Mark, 26 November 2026: hundreds of "Reset your password for care-log-3d05a" emails reached
   support@mymedicaldaybook.co.uk). Run from the Actions tab, "Sign-in settings" workflow.
   ACTION=check            reads the sign-in settings (email enumeration protection, the password reset email's sender and
                           subject) and the company addresses' sign-ins: whether each exists, when it was made and last used,
                           whether it is switched off, and whether it belongs to a care circle. Changes nothing.
   ACTION=tidy             turns email enumeration protection on (Google then sends a reset only to an address that has a
                           sign-in, and says the same either way) and gives Google's own reset email Daybook's name and words,
                           for the old phone builds that still ask Google for it.
   ACTION=disable-support  switches off the sign-in on support@ (kept, not deleted; ACTION=enable-support switches it on
                           again). A switched-off sign-in gets no reset emails, so the flood stops.
   THE REPOSITORY IS PUBLIC and so is this log: it prints the company's own public addresses, dates, states and counts
   only; a sign-in's id is masked. */
import { createSign } from 'node:crypto';
import { loadServiceAccount, connect, fieldString } from './lib/firestore_rest.mjs';

const action = (process.env.ACTION || 'check').trim();
const sa = loadServiceAccount('FIREBASE_SERVICE_ACCOUNT');
const PID = sa.project_id;
const COMPANY = ['support@mymedicaldaybook.co.uk', 'info@mark1apps.co.uk', 'reporting@mymedicaldaybook.co.uk'];
const hidden = (s) => (s ? String(s).slice(0, 2) + '***' : '');
const when = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : 'never');

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function cloudToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256'); signer.update(head + '.' + claims);
  const jwt = head + '.' + claims + '.' + signer.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  if (!r.ok) throw new Error('Could not get a token: ' + r.status);
  return (await r.json()).access_token;
}
const token = await cloudToken();
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-goog-user-project': PID }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch (e) { data = null; }
  if (!r.ok) throw new Error(method + ' ' + url.split('?')[0].replace(/^https:\/\/[^/]+/, '') + ': ' + r.status + ' ' + ((data && data.error && data.error.message) || text.slice(0, 200)));
  return data || {};
}
const CONFIG = 'https://identitytoolkit.googleapis.com/admin/v2/projects/' + PID + '/config';

async function showConfig() {
  const c = await call('GET', CONFIG);
  const privacy = !!(c.emailPrivacyConfig && c.emailPrivacyConfig.enableImprovedEmailPrivacy);
  console.log('Email enumeration protection: ' + (privacy ? 'on' : 'OFF'));
  const t = c.notification && c.notification.sendEmail && c.notification.sendEmail.resetPasswordTemplate;
  console.log('Google reset email: sender "' + ((t && t.senderDisplayName) || '(default)') + '", subject "' + ((t && t.subject) || '(default, names the project)') + '", customised: ' + !!(t && t.customized));
  const signIn = c.signIn || {};
  console.log('Email and password sign-in: ' + (signIn.email && signIn.email.enabled ? 'on' : 'off'));
  return c;
}
async function lookup(email) {
  const d = await call('POST', 'https://identitytoolkit.googleapis.com/v1/projects/' + PID + '/accounts:lookup', { email: [email] });
  return (d.users && d.users[0]) || null;
}
async function showAddresses() {
  const fs = await connect(sa);
  for (const email of COMPANY) {
    const u = await lookup(email);
    if (!u) { console.log(email + ': no sign-in'); continue; }
    const ptr = await fs.get('users/' + u.localId);
    const hid = ptr ? fieldString(ptr, 'household') : '';
    let circle = 'no care circle';
    if (hid) {
      const m = await fs.get('households/' + hid + '/members/' + u.localId);
      const entries = await fs.list('households/' + hid + '/entries', { namesOnly: true, pageSize: 300 });
      const members = await fs.list('households/' + hid + '/members', { namesOnly: true });
      circle = 'care circle ' + hidden(hid) + ' (' + (m ? 'member, ' + fieldString(m, 'role') : 'pointer only, not a member') + '; ' + members.length + ' members, ' + entries.length + ' entries)';
    }
    const providers = (u.providerUserInfo || []).map((p) => p.providerId).join(', ') || 'none';
    console.log(email + ': sign-in ' + hidden(u.localId) + ', made ' + when(u.createdAt) + ', last signed in ' + when(u.lastLoginAt) + ', email confirmed ' + !!u.emailVerified + ', switched off ' + !!u.disabled + ', by ' + providers + ', ' + circle);
  }
}
async function setDisabled(email, disabled) {
  const u = await lookup(email);
  if (!u) { console.log(email + ': no sign-in, nothing to do'); return; }
  await call('POST', 'https://identitytoolkit.googleapis.com/v1/projects/' + PID + '/accounts:update', { localId: u.localId, disableUser: disabled });
  console.log(email + ': sign-in ' + hidden(u.localId) + ' is now ' + (disabled ? 'switched off (kept; run enable-support to switch it on)' : 'switched on'));
}

const RESET_BODY = '<p>Hello,</p><p>Someone asked to reset the Daybook password for %EMAIL%. To choose a new one, open this link:</p>' +
  '<p><a href="%LINK%">Choose a new password</a></p><p>If it was not you, ignore this email: your password stays as it is.</p>' +
  '<p>Daybook<br>support@mymedicaldaybook.co.uk</p>';

if (action === 'check') {
  await showConfig(); await showAddresses();
} else if (action === 'tidy') {
  await call('PATCH', CONFIG + '?updateMask=emailPrivacyConfig.enableImprovedEmailPrivacy', { emailPrivacyConfig: { enableImprovedEmailPrivacy: true } });
  console.log('Turned email enumeration protection on');
  try {
    await call('PATCH', CONFIG + '?updateMask=notification.sendEmail.resetPasswordTemplate', { notification: { sendEmail: { resetPasswordTemplate: {
      senderDisplayName: 'Daybook', subject: 'Reset your Daybook password', body: RESET_BODY, bodyFormat: 'HTML', replyTo: 'support@mymedicaldaybook.co.uk' } } } });
    console.log('Google reset email now says Daybook');
  } catch (e) { console.log('Could not change Google reset email: ' + e.message); }
  await showConfig();
} else if (action === 'disable-support' || action === 'enable-support') {
  await setDisabled('support@mymedicaldaybook.co.uk', action === 'disable-support');
  await showAddresses();
} else {
  console.error('ACTION must be check, tidy, disable-support or enable-support'); process.exit(1);
}
