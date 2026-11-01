/* The .com redirect (31 October 2026): mymedicaldaybook.com and www.mymedicaldaybook.com send every visitor
   to https://mymedicaldaybook.co.uk, and app.mymedicaldaybook.com to https://app.mymedicaldaybook.co.uk (1 November 2026),
   with the path and query kept, done by Cloudflare itself (a proxied
   placeholder record and one redirect rule). Run from the Actions tab ("The .com redirect").
   ACTION=check  says what is there now and changes nothing.
   ACTION=apply  adds what is missing; never touches email records (MX, TXT) or anything else on the zone.
   ACTION=test   asks the .com addresses and reports where they send you.
   The token is CLOUDFLARE_COM_TOKEN, limited to the .com zone; it is never printed. THIS REPOSITORY IS PUBLIC. */
const ZONE = 'mymedicaldaybook.com';
const TARGET = 'https://mymedicaldaybook.co.uk';
const RULE_DESC = 'Daybook .com to .co.uk';
const APP_DESC = 'Daybook app .com to .co.uk';
const APP_TARGET = 'https://app.mymedicaldaybook.co.uk';
const PLACEHOLDER = '192.0.2.1';
const action = (process.env.ACTION || 'check').trim();
const token = (process.env.CLOUDFLARE_COM_TOKEN || '').trim();
const API = 'https://api.cloudflare.com/client/v4';

async function cf(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && body.success !== false, body };
}
const errs = (r) => (r.body.errors || []).map((e) => e.code + ' ' + e.message).join('; ') || ('HTTP ' + r.status);

async function test() {
  for (const host of [ZONE, 'www.' + ZONE, 'app.' + ZONE]) {
    for (const scheme of ['https', 'http']) {
      const url = `${scheme}://${host}/beta.html?x=1`;
      try {
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        console.log(`${url} -> ${res.status} ${res.headers.get('location') || ''}`);
      } catch (e) { console.log(`${url} -> no answer yet (${e.cause?.code || e.message})`); }
    }
  }
}

if (action === 'test') { await test(); process.exit(0); }
if (!token) { console.log('No CLOUDFLARE_COM_TOKEN secret yet. Add it under Settings > Secrets and variables > Actions, then run again.'); process.exit(0); }

const v = await cf('/user/tokens/verify');
console.log('Token:', v.ok ? (v.body.result?.status || 'ok') : 'not accepted (' + errs(v) + ')');
if (!v.ok) process.exit(1);

const z = await cf('/zones?name=' + ZONE);
const zone = z.ok && z.body.result && z.body.result[0];
if (!zone) { console.log(`The token cannot see ${ZONE} (${errs(z)}). Check its Zone Resources names the .com.`); process.exit(1); }
console.log(`Zone ${ZONE}: status ${zone.status}, plan ${zone.plan?.name || '?'}`);
if (zone.status !== 'active') console.log('The zone is not active yet: Cloudflare is not answering for it, so nothing here will work until its nameservers point at Cloudflare.');

const recs = await cf(`/zones/${zone.id}/dns_records?per_page=100`);
if (!recs.ok) { console.log('Could not list DNS records (' + errs(recs) + '). The token needs Zone > DNS > Edit.'); process.exit(1); }
const all = recs.body.result || [];
console.log('DNS records now:');
for (const r of all) console.log(`  ${r.type.padEnd(6)} ${r.name.padEnd(28)} ${r.type === 'TXT' ? '(text)' : r.content}  ${r.proxied ? 'proxied' : 'DNS only'}`);
if (!all.length) console.log('  (none)');
const webTypes = ['A', 'AAAA', 'CNAME'];
const apex = all.filter((r) => r.name === ZONE && webTypes.includes(r.type));
const www = all.filter((r) => r.name === 'www.' + ZONE && webTypes.includes(r.type));
const app = all.filter((r) => r.name === 'app.' + ZONE && webTypes.includes(r.type));

const rs = await cf(`/zones/${zone.id}/rulesets/phases/http_request_dynamic_redirect/entrypoint`);
const rules = rs.ok ? (rs.body.result?.rules || []) : [];
if (!rs.ok && rs.status !== 404) { console.log('Could not read the redirect rules (' + errs(rs) + '). The token needs Zone > Single Redirect > Edit.'); process.exit(1); }
const ours = rules.find((r) => r.description === RULE_DESC);
console.log(`Redirect rules now: ${rules.length}${ours ? ', including ours' : ''}`);

if (action !== 'apply') process.exit(0);

let stop = false;
for (const [label, list] of [['the .com itself', apex], ['www', www], ['app', app]]) {
  const foreign = list.filter((r) => !(r.proxied && ((r.type === 'A' && r.content === PLACEHOLDER) || (r.type === 'CNAME' && r.content === ZONE))));
  if (foreign.length) { console.log(`Left alone: ${label} already points somewhere (${foreign.map((r) => r.type + ' ' + r.content).join(', ')}). Not changed; ask Claude.`); stop = true; }
}
if (stop) process.exit(1);

async function add(rec) {
  const r = await cf(`/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(rec) });
  console.log(`Added ${rec.type} ${rec.name}: ${r.ok ? 'yes' : 'no (' + errs(r) + ')'}`);
  if (!r.ok) process.exit(1);
}
if (!apex.length) await add({ type: 'A', name: ZONE, content: PLACEHOLDER, proxied: true, ttl: 1, comment: 'Placeholder: Cloudflare redirects to the .co.uk' });
else console.log('The .com record is already in place.');
if (!www.length) await add({ type: 'CNAME', name: 'www.' + ZONE, content: ZONE, proxied: true, ttl: 1, comment: 'Redirected to the .co.uk' });
else console.log('The www record is already in place.');
if (!app.length) await add({ type: 'CNAME', name: 'app.' + ZONE, content: ZONE, proxied: true, ttl: 1, comment: 'Redirected to the app on the .co.uk' });
else console.log('The app record is already in place.');

const wanted = [
  { description: RULE_DESC, enabled: true, action: 'redirect',
    expression: `(http.host eq "${ZONE}") or (http.host eq "www.${ZONE}")`,
    action_parameters: { from_value: { status_code: 301, preserve_query_string: true, target_url: { expression: `concat("${TARGET}", http.request.uri.path)` } } } },
  { description: APP_DESC, enabled: true, action: 'redirect',
    expression: `(http.host eq "app.${ZONE}")`,
    action_parameters: { from_value: { status_code: 301, preserve_query_string: true, target_url: { expression: `concat("${APP_TARGET}", http.request.uri.path)` } } } }
];
const missing = wanted.filter((w) => !rules.some((r) => r.description === w.description));
if (!missing.length) console.log('The redirect rules are already in place.');
else {
  const keep = rules.map(({ id, version, last_updated, ref, ...r }) => r);
  const put = await cf(`/zones/${zone.id}/rulesets/phases/http_request_dynamic_redirect/entrypoint`, { method: 'PUT', body: JSON.stringify({ rules: [...keep, ...missing] }) });
  console.log('Added the redirect rules (' + missing.map((m) => m.description).join(', ') + '): ' + (put.ok ? 'yes' : 'no (' + errs(put) + ')'));
  if (!put.ok) process.exit(1);
}
console.log('Done. The certificate can take up to 15 minutes; then run this again with test.');
