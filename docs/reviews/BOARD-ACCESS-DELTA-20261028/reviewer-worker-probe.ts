// Independent delta-review Worker (workerd) probe. Read-only against the synthetic harness DB.
// Usage: NODE_ENV=<mode> DATABASE_URL=postgres://...@127.0.0.1:55492/flowboard_harness \
//   WRANGLER_SEND_METRICS=false node docs/reviews/BOARD-ACCESS-DELTA-20261028/reviewer-worker-probe.ts
// Compares behavior of the same Worker source bundled under different build-shell NODE_ENV values,
// because wrangler replaces `process.env.NODE_ENV` at bundle time.
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
const out: string[] = [];
const log = (s: string) => { out.push(s); console.log(`[NODE_ENV=${mode}] ${s}`); };
try {
  await harness.listen();
  const w = harness.getWorker('flowboard-api-test');
  const dl = async (secret?: string) => (await w.fetch('http://localhost/api/v1/session/dev-login', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-dev-secret': secret } : {}) },
    body: JSON.stringify({ email: `worker-probe-${Date.now()}@flowboard.example` }) })).status;
  log(`W1 dev-login no secret -> ${await dl()}`);
  log(`W2 dev-login with built-in test secret -> ${await dl('flowboard-dev-secret')}`);
  log(`W3 /system/status no secret -> ${(await w.fetch('http://localhost/api/v1/system/status')).status}`);
  log(`W4 /system/status with built-in test secret 'flowboard-dev-secret' -> ${(await w.fetch('http://localhost/api/v1/system/status', { headers: { 'x-dev-secret': 'flowboard-dev-secret' } })).status}`);
  const pre = await w.fetch('http://localhost/api/v1/session', { method: 'OPTIONS', headers: { Origin: 'https://evil.pages.dev', 'Access-Control-Request-Method': 'POST' } });
  log(`W5 CORS evil.pages.dev allow-origin -> ${pre.headers.get('access-control-allow-origin')}`);
  const cb = await w.fetch('http://localhost/api/v1/auth/google/callback?code=x&state=forged', { headers: { cookie: 'flowboard_oauth_state=other' } });
  log(`W6 google callback forged state -> ${cb.status}`);
} finally {
  await harness.close();
}
