// Round-2 reviewer Worker (workerd) probe. Read-only against the synthetic harness DB except dev-login attempts (which must be refused).
// Usage: NODE_ENV=<mode> DATABASE_URL=postgres://...@127.0.0.1:55492/flowboard_harness \
//   WRANGLER_SEND_METRICS=false node docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/reviewer-worker-probe.ts
// The same Worker source is bundled under the caller's build-shell NODE_ENV (wrangler replaces
// process.env.NODE_ENV at bundle time), so running it with NODE_ENV=test reproduces round-1 DR1-02.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

const dbUrl = process.env['DATABASE_URL'];
assert.ok(dbUrl);
const u = new URL(dbUrl);
assert.equal(u.hostname, '127.0.0.1');
assert.equal(u.port, '55492');
process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'] = dbUrl;
const configPath = fileURLToPath(new URL('../../../apps/api/test/wrangler.jsonc', import.meta.url));
const mode = process.env['NODE_ENV'] ?? '(unset)';
const harness = createTestHarness({ workers: [{ configPath }] });
const log = (s: string) => console.log(`[NODE_ENV=${mode}] ${s}`);
try {
  await harness.listen();
  const w = harness.getWorker('flowboard-api-test');
  const dl = async (secret?: string) => (await w.fetch('http://localhost/api/v1/session/dev-login', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-dev-secret': secret } : {}) },
    body: JSON.stringify({ email: `r2-worker-probe-${Date.now()}@flowboard.example` }) })).status;
  log(`W1 dev-login no secret -> ${await dl()}`);
  log(`W2 dev-login with built-in test secret -> ${await dl('flowboard-dev-secret')}`);
  log(`W3 /system/status no secret -> ${(await w.fetch('http://localhost/api/v1/system/status')).status}`);
  log(`W4 /system/status with built-in test secret -> ${(await w.fetch('http://localhost/api/v1/system/status', { headers: { 'x-dev-secret': 'flowboard-dev-secret' } })).status}`);
  log(`W4b /system/migrate with built-in test secret -> ${(await w.fetch('http://localhost/api/v1/system/migrate', { method: 'POST', headers: { 'x-dev-secret': 'flowboard-dev-secret' } })).status}`);
  const pre = await w.fetch('http://localhost/api/v1/session', { method: 'OPTIONS', headers: { Origin: 'https://evil.pages.dev', 'Access-Control-Request-Method': 'POST' } });
  log(`W5 CORS evil.pages.dev allow-origin -> ${pre.headers.get('access-control-allow-origin')}`);
  const cb = await w.fetch('http://localhost/api/v1/auth/google/callback?code=x&state=forged', { headers: { cookie: 'flowboard_oauth_state=other' } });
  log(`W6 google callback forged state -> ${cb.status}`);
  const post = (url: string, headers: Record<string, string>) => w.fetch(url, { method: 'POST', headers: { cookie: 'flowboard_session=synthetic-not-a-session', ...headers } });
  const body = async (r: Response) => { const t = await r.text(); return `${r.status} ${t.slice(0, 110)}`; };
  log(`W7 cookie POST, Origin evil -> ${await body(await post('https://flowboard-app.pages.dev/api/v1/notifications/mark-all-read', { origin: 'https://evil.example' }))}`);
  log(`W8 cookie POST via service binding URL, Origin = Pages host -> ${await body(await post('https://flowboard-app.pages.dev/api/v1/notifications/mark-all-read', { origin: 'https://flowboard-app.pages.dev' }))}`);
  log(`W9 cookie POST via API_ORIGIN fallback (worker host URL), Origin = Pages host, no CORS_ORIGIN in test config -> ${await body(await post('https://flowboard-api.example.workers.dev/api/v1/notifications/mark-all-read', { origin: 'https://flowboard-app.pages.dev' }))}`);
  log(`W10 cookie POST, Sec-Fetch-Site cross-site, no Origin/Referer -> ${await body(await post('https://flowboard-app.pages.dev/api/v1/notifications/mark-all-read', { 'sec-fetch-site': 'cross-site' }))}`);
  log(`W11 legacy session cookie, Origin evil -> ${(await w.fetch('https://flowboard-app.pages.dev/api/v1/session/logout', { method: 'POST', headers: { cookie: 'session=x', origin: 'https://evil.example' } })).status}`);
} finally {
  await harness.close();
}
