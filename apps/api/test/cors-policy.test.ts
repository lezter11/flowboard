import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';
import { getSessionCookieOptions } from '../src/adapters/session.ts';

// Anyone can register a *.pages.dev or *.workers.dev site, so those suffixes must not be
// trusted with credentialed CORS. Only localhost and explicitly configured origins are.
test('CORS: credentialed access is limited to localhost and CORS_ORIGIN', async () => {
  const app = createApp();
  const preflight = (origin: string) =>
    app.request('/api/v1/session', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });

  for (const origin of ['https://evil.pages.dev', 'https://evil.workers.dev', 'https://attacker.example']) {
    const res = await preflight(origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
  }
  const local = await preflight('http://localhost:3000');
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal(local.headers.get('access-control-allow-credentials'), 'true');
});

test('session cookies stay SameSite=Lax and are Secure off localhost', () => {
  assert.deepEqual(
    [getSessionCookieOptions('flowboard.example.com'), getSessionCookieOptions('localhost:8787')].map((o) => [o.sameSite, o.secure]),
    [['Lax', true], ['Lax', false]],
  );
});
