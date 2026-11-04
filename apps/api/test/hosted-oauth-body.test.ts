import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { getPool, setGlobalPool, closePool } from '../src/adapters/postgres.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createSession, hashSessionToken } from '../src/adapters/session.ts';
import { startHostedAuthorization, describeHostedAuthorization, decideHostedAuthorization, hashHostedSecret } from '../src/adapters/hosted-oauth.ts';
import { isHostedOAuthBodyRequest } from '../src/http/middleware/hosted-oauth-body.ts';

getPool();
const schema = `hosted_oauth_body_${process.pid}`;
const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 4, options: `-c search_path=${schema}` });
const origin = 'https://flowboard.example';
const root = '/api/v1/mcp';
const callback = 'https://claude.ai/api/mcp/auth_callback';
let sessionHash = '';
before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await runMigrations(pool);
  await pool.query("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('body_owner','body@example.test','Body owner',now(),now())");
  await pool.query("INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('body_ws','Body','UTC','body_owner',now(),now())");
  await pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('body_project','body_ws','Body project',now(),now())");
  sessionHash = hashSessionToken((await createSession('body_owner', 24, pool)).id);
});
after(async () => { setGlobalPool(null); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); await closePool(); });
function mounted(selectedPool = pool, onLifetime?: (work: Promise<void>) => void) {
  return createApp(async () => {}, {
    pool: selectedPool, deadlineMs: 40, mcpPublicOrigin: origin,
    rateLimiter: () => undefined,
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
    onMcpWorkLifetime: work => onLifetime?.(work),
  });
}
async function bounded<T>(work: Promise<T> | T, timeoutMs = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Mounted OAuth request did not settle.')), timeoutMs); });
  try { return await Promise.race([work, timeout]); } finally { if (timer !== undefined) clearTimeout(timer); }
}
function unfinished(text: string, uncooperativeCancel = false) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { source = controller; controller.enqueue(new TextEncoder().encode(text)); },
    cancel() { cancelled = true; return uncooperativeCancel ? new Promise<void>(() => {}) : undefined; },
  });
  return { stream, cancelled: () => cancelled, close: () => { try { source.close(); } catch { /* Already cancelled. */ } } };
}
const endpoints = [
  [`${root}/oauth/register`, 'application/json'],
  [`${root}/oauth/token`, 'application/x-www-form-urlencoded'],
  [`${root}/oauth/revoke`, 'application/x-www-form-urlencoded'],
  [`${root}/authorization-requests/${'a'.repeat(43)}/decision`, 'application/json'],
] as const;
for (const [path, contentType] of endpoints) {
  test(`mounted OAuth guard refuses an unfinished 17KiB body on ${path}`, async () => {
    const input = unfinished(' '.repeat(17_000), true);
    let lifetime: Promise<void> | undefined;
    try {
      const request = new Request(origin + path, { method: 'POST', headers: { 'content-type': contentType }, body: input.stream, duplex: 'half' } as RequestInit);
      const response = await bounded(mounted(pool, work => { lifetime = work; }).fetch(request));
      assert.equal(response.status, 413); assert.deepEqual(await response.json(), { error: 'invalid_request' });
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(input.cancelled(), true);
      assert.ok(lifetime); await bounded(lifetime);
    } finally { input.close(); }
  });
  test(`mounted OAuth guard aborts a stalled under-limit body on ${path}`, async () => {
    const input = unfinished(contentType === 'application/json' ? '{' : 'grant_type=');
    let lifetime: Promise<void> | undefined;
    try {
      const request = new Request(origin + path, { method: 'POST', headers: { 'content-type': contentType }, body: input.stream, duplex: 'half' } as RequestInit);
      const response = await bounded(mounted(pool, work => { lifetime = work; }).fetch(request));
      assert.equal(response.status, 504); assert.deepEqual(await response.json(), { error: 'temporarily_unavailable' });
      assert.equal(input.cancelled(), true); assert.ok(lifetime); await bounded(lifetime);
    } finally { input.close(); }
  });
}
test('mounted OAuth guard settles an already-aborted unfinished body without later dispatch', async () => {
  const input = unfinished('{'); const abort = new AbortController(); abort.abort();
  const before = Number((await pool.query('SELECT count(*) FROM mcp_oauth_clients')).rows[0].count);
  try {
    const request = new Request(origin + root + '/oauth/register', { method: 'POST', signal: abort.signal, headers: { 'content-type': 'application/json' }, body: input.stream, duplex: 'half' } as RequestInit);
    const response = await bounded(mounted().fetch(request)); assert.equal(response.status, 400); assert.equal(input.cancelled(), true);
    assert.equal(Number((await pool.query('SELECT count(*) FROM mcp_oauth_clients')).rows[0].count), before);
  } finally { input.close(); }
});
test('mounted OAuth guard accepts an exact 16KiB UTF-8 JSON body and cached route parsing runs once', async () => {
  const base = { redirect_uris: [callback], client_name: 'Boundary client', padding: '' };
  const available = 16 * 1024 - new TextEncoder().encode(JSON.stringify(base)).byteLength;
  base.padding = 'é'.repeat(Math.floor(available / 2)) + (available % 2 ? 'x' : '');
  const bytes = new TextEncoder().encode(JSON.stringify(base)); assert.equal(bytes.byteLength, 16 * 1024);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let at = 0; at < bytes.length; at += 151) controller.enqueue(bytes.slice(at, at + 151)); controller.close(); } });
  const response = await bounded(mounted().fetch(new Request(origin + root + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)));
  assert.equal(response.status, 201); assert.equal((await response.json() as { client_name: string }).client_name, 'Boundary client');
});
test('mounted OAuth guard preserves form semantics and missing-session consent refusal', async () => {
  const revoke = await bounded(mounted().request(origin + root + '/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'unknown', token: 'unknown' }) }));
  assert.equal(revoke.status, 200);
  const token = await bounded(mounted().request(origin + root + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'unknown', resource: origin + root, redirect_uri: callback, code_verifier: 'a'.repeat(64), code: 'a'.repeat(43) }) }));
  assert.equal(token.status, 400); assert.deepEqual(await token.json(), { error: 'invalid_grant' });
  const decision = await bounded(mounted().request(origin + endpoints[3][0], { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ decision: 'deny', csrfToken: 'a'.repeat(43) }) }));
  assert.equal(decision.status, 401); assert.deepEqual(await decision.json(), { error: 'login_required' });
});
test('guard matcher excludes unrelated API paths and unsupported OAuth methods', () => {
  assert.equal(isHostedOAuthBodyRequest('POST', root + '/oauth/token/extra'), false);
  assert.equal(isHostedOAuthBodyRequest('POST', '/api/v1/tokens'), false);
  assert.equal(isHostedOAuthBodyRequest('GET', root + '/oauth/token'), false);
  assert.equal(isHostedOAuthBodyRequest('POST', root), false);
});
test('mounted code exchange retains actual work past its HTTP deadline until the real transaction commits', async () => {
  const verifier = 'b'.repeat(64), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const pending = await startHostedAuthorization(pool, { clientId: 'mcp_client_body', clientName: 'Body client', redirectUri: callback, resource: origin + root, scopes: ['cards:read', 'offline_access'], state: null, codeChallenge: challenge });
  const input = { requestId: pending.requestId, binding: pending.browserBinding, userId: 'body_owner', sessionHash };
  const view = await describeHostedAuthorization(pool, input);
  const redirect = await decideHostedAuthorization(pool, { ...input, csrfToken: view.csrfToken, decision: 'allow', projectId: 'body_project', issuer: origin });
  const code = new URL(redirect).searchParams.get('code')!;
  const connectionId = (await pool.query('SELECT connection_id FROM mcp_oauth_authorization_codes WHERE code_hash=$1', [hashHostedSecret(code)])).rows[0].connection_id;
  const held = await pool.connect(); await held.query('BEGIN'); await held.query('SELECT id FROM mcp_oauth_connections WHERE id=$1 FOR UPDATE', [connectionId]);
  const requestPool = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1, options: `-c search_path=${schema}` });
  let lifetime: Promise<void> | undefined, settled = false;
  try {
    const app = mounted(requestPool, work => { lifetime = work; void work.then(() => { settled = true; }); });
    const response = await bounded(app.request(origin + root + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'mcp_client_body', resource: origin + root, redirect_uri: callback, code_verifier: verifier, code }) }));
    assert.equal(response.status, 504); assert.ok(lifetime); assert.equal(settled, false);
    await held.query('COMMIT'); await bounded(lifetime);
    assert.equal(settled, true);
    assert.equal((await pool.query('SELECT id FROM mcp_oauth_access_tokens WHERE connection_id=$1', [connectionId])).rowCount, 1);
    assert.ok((await pool.query('SELECT consumed_at FROM mcp_oauth_authorization_codes WHERE code_hash=$1', [hashHostedSecret(code)])).rows[0].consumed_at);
  } finally { await held.query('ROLLBACK').catch(() => {}); held.release(); await requestPool.end(); setGlobalPool(pool); }
});
