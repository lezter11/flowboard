import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { setGlobalPool } from '../src/adapters/postgres.ts';
import { routeAuthFixture } from './support/route-auth-fixture.ts';

const origin = 'https://flowboard-router.example';
const requestId = 'router-boundary-123';

// These assertions protect the mounted security contract when selecting a router.
// They deliberately do not inspect the router constructor or reproduce its matcher.
test('mounted protocol, discovery and wildcard middleware preserve exact path boundaries without database work', async t => {
  // A real, lazy pool: these anonymous paths must never need a database connection.
  const pool = new pg.Pool({ connectionString: 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic', connectionTimeoutMillis: 100 });
  t.after(async () => { setGlobalPool(null); await pool.end(); });
  const app = createApp(async () => {}, {
    pool, mcpPublicOrigin: origin,
    rateLimiter: () => ({ limit: async () => ({ success: true }) }),
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  });
  const send = (path: string, method = 'GET', headers: Record<string, string> = {}) =>
    app.request(origin + path, { method, headers: { 'x-request-id': requestId, ...headers } });

  for (const [path, method] of [
    ['/api/v1/mcp', 'GET'], ['/api/v1/mcp', 'POST'], ['/api/v1/mcp', 'DELETE'],
    ['/api/v1/mcp', 'PATCH'], ['/api/v1/mcp', 'PUT'], ['/api/v1/%6dcp', 'GET'],
  ] as const) await t.test(`decoded exact MCP ${method} ${path} challenges OAuth`, async () => {
    const response = await send(path, method);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/v1/mcp"`);
    assert.equal(response.headers.get('x-request-id'), requestId);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
    const body = await response.json() as any;
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.error.code, -32000);
    assert.equal(Object.hasOwn(body, 'data'), false);
  });

  await t.test('HEAD keeps the protocol challenge with an empty response body', async () => {
    const response = await send('/api/v1/mcp', 'HEAD');
    assert.equal(response.status, 401);
    assert.equal(await response.text(), '');
    assert.match(response.headers.get('www-authenticate') ?? '', /resource_metadata=/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  });

  await t.test('exact MCP preflight retains its protocol policy', async () => {
    const response = await send('/api/v1/mcp', 'OPTIONS', {
      Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://claude.ai');
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
    const denied = await send('/api/v1/mcp', 'OPTIONS', { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'DELETE' });
    assert.equal(denied.status, 403);
  });

  for (const path of ['/api/v1/mcp/', '/api/v1/mcp//', '/api/v1/mcp%2F', '/api/v1/mcp/unknown', '/api/v1/mcp/%', '/api/v1/mcp/%ZZ']) await t.test(`MCP lookalike is not protocol: ${path}`, async () => {
    const response = await send(path);
    assert.equal(response.status, 404);
    assert.equal((await response.json() as any).error.code, 'NOT_FOUND');
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), requestId);
    if (path.startsWith('/api/v1/mcp/')) {
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('pragma'), 'no-cache');
    }
  });

  for (const path of ['/api/v1/mcp/connections', '/api/v1/mcp/authorization-requests/%', '/api/v1/mcp/authorization-requests/%ZZ']) await t.test(`MCP child keeps browser authentication: ${path}`, async () => {
    const response = await send(path);
    assert.equal(response.status, 401);
    assert.equal((await response.json() as any).error, 'login_required');
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp', '/.well-known/%6fauth-protected-resource']) await t.test(`resource discovery: ${path}`, async () => {
    const response = await send(path);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.resource, origin + '/api/v1/mcp');
    assert.deepEqual(body.authorization_servers, [origin]);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  for (const path of ['/.well-known/oauth-protected-resource/api/v1/mcp/', '/.well-known/oauth-authorization-server/']) await t.test(`discovery lookalike is absent: ${path}`, async () => {
    const response = await send(path);
    assert.equal(response.status, 404);
    assert.equal((await response.json() as any).error.code, 'NOT_FOUND');
  });

  // The global bearer boundary must run on unknown paths as well as mounted ones.
  for (const path of ['/health/live', '/health/live/', '/api/v1/unknown', '/api/v1/mcp/', '/api/v1/boards/%ZZ/columns/%2F/placement']) await t.test(`wildcard bearer denial: ${path}`, async () => {
    const response = await send(path, 'GET', { Authorization: 'Bearer malformed' });
    assert.equal(response.status, 401);
    assert.equal((await response.json() as any).error.code, 'UNAUTHORIZED');
    assert.equal(response.headers.get('x-request-id'), requestId);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('mounted nested board/column parameters preserve decoded ancestry and real PostgreSQL authorization', {
  skip: !process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'] && 'Set isolated identity-extra PostgreSQL URL',
  timeout: 120_000,
}, async t => {
  const f = await routeAuthFixture(t);
  const before = await f.fingerprint();
  const cases = [
    { actor: 'owner', board: 'brd', column: 'col', status: 200 },
    { actor: 'owner', board: '%62rd', column: '%63ol', status: 200 },
    { actor: 'owner', board: 'brd', column: 'foreign_col', status: 404 },
    { actor: 'owner', board: 'foreign_brd', column: 'col', status: 404 },
    { actor: 'foreign', board: '%62rd', column: '%63ol', status: 404 },
    { actor: 'grantless', board: '%62rd', column: '%63ol', status: 404 },
    { actor: 'owner', board: '%2562rd', column: 'col', status: 404 },
    { actor: 'owner', board: 'brd%2Fforeign_brd', column: 'col', status: 404 },
    { actor: 'owner', board: 'brd', column: '%', status: 404 },
    { actor: 'owner', board: 'brd', column: '%ZZ', status: 404 },
    { actor: 'owner', board: 'brd', column: '%E0%A4%A', status: 404 },
  ];
  for (const cell of cases) await t.test(`${cell.actor} / ${cell.board} / ${cell.column}`, async () => {
    const path = `/api/v1/boards/${cell.board}/columns/${cell.column}/placement?movingCardId=card&at=last`;
    const response = await f.app.request('http://localhost' + path, { headers: { Cookie: `flowboard_session=${f.actors[cell.actor]!.session.id}` } });
    assert.equal(response.status, cell.status);
    const body = await response.json() as any;
    if (cell.status === 200) {
      assert.equal(body.data.movingCardId, 'card');
      assert.equal(body.data.toColumnId, 'col');
    }
    else {
      assert.equal(body.error.code, 'NOT_FOUND');
      assert.equal(Object.hasOwn(body, 'data'), false);
      assert.equal(JSON.stringify(body).includes('PRIVATE_MATRIX'), false);
    }
    assert.deepEqual(await f.fingerprint(), before, 'Read-only routing/authorization must not mutate fixture state');
  });
  const trailing = await f.app.request('http://localhost/api/v1/boards/brd/columns/col/placement/?movingCardId=card&at=last', {
    headers: { Cookie: `flowboard_session=${f.actors.owner!.session.id}` },
  });
  assert.equal(trailing.status, 404);
  assert.equal((await trailing.json() as any).error.code, 'NOT_FOUND');
  assert.deepEqual(await f.fingerprint(), before);
});
