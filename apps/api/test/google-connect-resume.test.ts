import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { googleAuthRoutes } from '../src/http/routes/google-auth.ts';

const app = new Hono();
app.route('/api/v1/auth', googleAuthRoutes);
const handle = 'a'.repeat(43);
const state = 'b'.repeat(48);
const next = `/connect?request=${handle}`;
const cookieFor = (target: string) => `flowboard_oauth_state=${state}.${Buffer.from(target).toString('base64url')}`;

test('Google denial retains a validated consent continuation only with matching OAuth state', async () => {
  const response = await app.request(`http://localhost/api/v1/auth/google/callback?error=access_denied&state=${state}`, { headers: { cookie: cookieFor(next) } });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location')!, 'http://localhost');
  assert.equal(location.pathname, '/signin');
  assert.equal(location.searchParams.get('state'), 'denied');
  assert.equal(location.searchParams.get('next'), next);
});

test('failed callback cannot reflect an unbound or offsite continuation', async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['wrong', next], [state, '//evil.test'], [state, `${next}&redirect_uri=evil`],
  ];
  for (const [queryState, target] of cases) {
    const response = await app.request(`http://localhost/api/v1/auth/google/callback?error=access_denied&state=${queryState}`, { headers: { cookie: cookieFor(target) } });
    assert.equal(new URL(response.headers.get('location')!, 'http://localhost').searchParams.has('next'), false);
  }
});
