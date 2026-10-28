// Round-2 reviewer probe: adversarial Origin/Referer/CSRF cases against the mounted Node app.
// Usage: NODE_ENV=test DATABASE_URL=postgres://...@127.0.0.1:55492/flowboard_harness node docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/reviewer-origin-probe.ts
// Allowed requests reach authMiddleware and get 401 (synthetic cookie); rejected ones get 403 FORBIDDEN first.
import assert from 'node:assert/strict';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { closePool } from '../../../apps/api/src/adapters/postgres.ts';

const db = new URL(process.env['DATABASE_URL']!);
assert.equal(db.hostname, '127.0.0.1');
assert.equal(db.port, '55492');
process.env['CORS_ORIGIN'] = 'https://flowboard-app.pages.dev';
const app = createApp();
const SITE = 'https://flowboard-app.pages.dev';
let fails = 0;
async function probe(id: string, expect: 'reject' | 'allow', url: string, headers: Record<string, string>, method = 'POST') {
  const res = await app.request(url, { method, headers });
  const text = await res.text();
  const rejected = res.status === 403 && text.includes('"FORBIDDEN"') && text.includes('Cross-site');
  const ok = expect === 'reject' ? rejected : !rejected;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: expect ${expect}; got ${res.status} ${text.slice(0, 90)}`);
}
const P = `${SITE}/api/v1/notifications/mark-all-read`;
const C = { cookie: 'flowboard_session=synthetic-not-a-session' };
try {
  await probe('O1 attacker origin', 'reject', P, { ...C, origin: 'https://evil.example' });
  await probe('O2 Origin null', 'reject', P, { ...C, origin: 'null' });
  await probe('O3 Referer-only attacker', 'reject', P, { ...C, referer: 'https://evil.example/x' });
  await probe('O4 empty Origin + attacker Referer', 'reject', P, { ...C, origin: '', referer: 'https://evil.example/x' });
  await probe('O5 suffix trick', 'reject', P, { ...C, origin: 'https://flowboard-app.pages.dev.evil.com' });
  await probe('O6 prefix trick', 'reject', P, { ...C, origin: 'https://evil-flowboard-app.pages.dev' });
  await probe('O7 subdomain of site', 'reject', P, { ...C, origin: 'https://x.flowboard-app.pages.dev' });
  await probe('O8 http scheme downgrade', 'reject', P, { ...C, origin: 'http://flowboard-app.pages.dev' });
  await probe('O9 port variant', 'reject', P, { ...C, origin: 'https://flowboard-app.pages.dev:8443' });
  await probe('O10 two Origin values joined', 'reject', P, { ...C, origin: 'https://evil.example, https://flowboard-app.pages.dev' });
  await probe('O11 userinfo trick', 'reject', P, { ...C, origin: 'https://flowboard-app.pages.dev@evil.example' });
  await probe('O12 garbage origin', 'reject', P, { ...C, origin: 'not a url' });
  await probe('O13 Sec-Fetch-Site same-site, no Origin/Referer', 'reject', P, { ...C, 'sec-fetch-site': 'same-site' });
  await probe('O14 legacy cookie name + attacker origin', 'reject', P, { cookie: 'session=x', origin: 'https://evil.example' });
  await probe('O15 cookie after other cookies, no space', 'reject', P, { cookie: 'a=1;flowboard_session=x', origin: 'https://evil.example' });
  await probe('O16 attacker origin on logout', 'reject', `${SITE}/api/v1/session/logout`, { ...C, origin: 'https://evil.example' });
  await probe('O17 attacker origin on PATCH profile', 'reject', `${SITE}/api/v1/session/profile`, { ...C, origin: 'https://evil.example', 'content-type': 'application/json' }, 'PATCH');
  await probe('O18 attacker origin on DELETE member', 'reject', `${SITE}/api/v1/projects/p/members/u`, { ...C, origin: 'https://evil.example' }, 'DELETE');
  await probe('O19 attacker origin on PUT grant', 'reject', `${SITE}/api/v1/boards/b/grants/u`, { ...C, origin: 'https://evil.example' }, 'PUT');
  await probe('O20 uppercase site origin (normalised)', 'allow', P, { ...C, origin: 'HTTPS://FLOWBOARD-APP.PAGES.DEV' });
  await probe('O21 same-origin', 'allow', P, { ...C, origin: SITE });
  await probe('O22 same-origin referer only', 'allow', P, { ...C, referer: `${SITE}/boards/b1?x=1` });
  await probe('O23 configured CORS_ORIGIN from other host URL (API_ORIGIN fallback shape)', 'allow', 'https://flowboard-api.example.workers.dev/api/v1/notifications/mark-all-read', { ...C, origin: SITE });
  await probe('O24 localhost any port (trusted by design, also in production config)', 'allow', P, { ...C, origin: 'http://localhost:9999' });
  await probe('O25 no headers (non-browser client)', 'allow', P, { ...C });
  await probe('O26 GET with attacker origin not checked', 'allow', `${SITE}/api/v1/session`, { ...C, origin: 'https://evil.example' }, 'GET');
  await probe('O27 OAuth callback GET not checked', 'allow', `${SITE}/api/v1/auth/google/callback?code=x&state=y`, { origin: 'https://evil.example' }, 'GET');
  await probe('O28 cookie-less POST (login/dev-login) not checked', 'allow', `${SITE}/api/v1/session/dev-login`, { origin: 'https://evil.example', 'content-type': 'application/json' });
  // Bypass candidate: a cookie header the regex does not see but Hono's parser accepts.
  // First run expected a bypass here; Fetch Headers strip leading whitespace, so it is rejected (candidate rejected).
  await probe('O29 leading-space cookie (not browser-producible)', 'reject', P, { cookie: ' flowboard_session=x', origin: 'https://evil.example' });
  await probe('O30 Origin header present with trusted value but cross-site Sec-Fetch-Site', 'allow', P, { ...C, origin: SITE, 'sec-fetch-site': 'cross-site' });
} finally {
  await closePool();
}
console.log(`SUMMARY fails=${fails}`);
process.exitCode = fails ? 1 : 0;
