import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import crypto from 'node:crypto';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool, setGlobalPool } from '../src/adapters/postgres.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createSession } from '../src/adapters/session.ts';
import { createPersonalAccessToken } from '../src/adapters/tokens.ts';
import { verifyHostedAccessToken, disconnectHostedConnection } from '../src/adapters/hosted-oauth.ts';
import { dispatchHostedMcpRequest, readHostedMcpContext } from '../src/http/hosted-mcp-context.ts';

const origin = 'https://flowboard.example';
const root = '/api/v1/mcp';
const callback = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'a'.repeat(64);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
getPool(); // Existing guard refuses non-isolated or remote DATABASE_URL.
const schema = `hosted_mcp_mounted_${process.pid}`;
const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1, options: `-c search_path=${schema}` });
setGlobalPool(pool);
const app = createApp(undefined, { pool, mcpPublicOrigin: origin });
const cookies: Record<string, string> = {};
const json = (response: { json(): Promise<unknown> }): Promise<any> => response.json();
const api = (path: string, init?: RequestInit) => app.request(`${origin}${path}`, init);

async function issue(actor = 'owner', scope = 'projects:read boards:read cards:read cards:create offline_access') {
  const registered = await api(`${root}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Synthetic mounted client', redirect_uris: [callback] }) });
  assert.equal(registered.status, 201, `register ${registered.status}`);
  const clientId = (await json(registered)).client_id as string;
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', resource: `${origin}${root}`,
    code_challenge: challenge, code_challenge_method: 'S256', scope });
  const start = await api(`${root}/oauth/authorize?${query}`);
  assert.equal(start.status, 302);
  const requestId = new URL(start.headers.get('location')!).searchParams.get('request')!;
  const binding = start.headers.get('set-cookie')!.split(';')[0];
  const headers = { cookie: `${cookies[actor]}; ${binding}`, origin, 'content-type': 'application/json' };
  const view = await api(`${root}/authorization-requests/${requestId}`, { headers });
  assert.equal(view.status, 200);
  const decision = await api(`${root}/authorization-requests/${requestId}/decision`, { method: 'POST', headers,
    body: JSON.stringify({ decision: 'allow', projectId: 'mcp_project_a', csrfToken: (await json(view)).data.csrfToken }) });
  assert.equal(decision.status, 200);
  const code = new URL((await json(decision)).data.redirectUrl).searchParams.get('code')!;
  const exchanged = await api(`${root}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: callback,
      resource: `${origin}${root}`, code_verifier: verifier }) });
  assert.equal(exchanged.status, 200);
  return { clientId, ...await json(exchanged) } as { clientId: string; access_token: string; refresh_token: string };
}

async function mcp(token: string | undefined, method: string, args?: unknown, extra: Record<string, string> = {}) {
  return api(root, { method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json',
    'mcp-protocol-version': '2025-11-25', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: args === undefined ? method : 'tools/call',
      ...(args === undefined ? {} : { params: { name: method, arguments: args } }) }) });
}
async function tool(token: string, name: string, args: unknown) {
  const response = await mcp(token, name, args);
  assert.equal(response.status, 200);
  return (await json(response)).result;
}

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await runMigrations(pool);
  await pool.query(`INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES
    ('mcp_owner','mcp-owner@example.test','Owner',now(),now()),('mcp_member','mcp-member@example.test','Member',now(),now()),
    ('mcp_viewer','mcp-viewer@example.test','Viewer',now(),now())`);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('mcp_ws','MCP workspace','UTC','mcp_owner',now(),now())`);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES
    ('mcp_project_a','mcp_ws','Authorized project',now(),now()),('mcp_project_b','mcp_ws','Secret sibling',now(),now())`);
  for (const role of ['member', 'viewer']) {
    await pool.query(`INSERT INTO project_memberships(id,workspace_id,project_id,user_id,role,status,version,created_at,updated_at)
      VALUES($1,'mcp_ws','mcp_project_a',$2,$3,'active',1,now(),now())`, [`mcp_pm_${role}`, `mcp_${role}`, role]);
  }
  for (const suffix of ['a', 'b', 'hidden']) {
    await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,structure_version,snapshot_version,created_at,updated_at)
      VALUES($1,'mcp_ws',$2,$3,1,1,now(),now())`, [`mcp_board_${suffix}`, suffix === 'b' ? 'mcp_project_b' : 'mcp_project_a', `Board ${suffix}`]);
    await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
      VALUES($1,'mcp_ws',$2,$3,'Todo','#3b82f6','todo',0,1,now(),now())`, [`mcp_column_${suffix}`, suffix === 'b' ? 'mcp_project_b' : 'mcp_project_a', `mcp_board_${suffix}`]);
  }
  for (const role of ['member', 'viewer']) {
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)
      VALUES('mcp_board_a','mcp_project_a','mcp_ws',$1,'mcp_owner')`, [`mcp_${role}`]);
  }
  for (const actor of ['owner', 'member', 'viewer']) cookies[actor] = `flowboard_session=${(await createSession(`mcp_${actor}`, 24, pool)).id}`;
});
after(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await closePool(); });
beforeEach(async () => { await pool.query('DELETE FROM rate_limit_windows'); });

test('mounted discovery and exact protocol CORS do not use cookie credentials or forged origins', async () => {
  for (const path of ['/.well-known/oauth-protected-resource/api/v1/mcp', '/.well-known/oauth-protected-resource']) {
    const response = await api(path);
    assert.equal(response.status, 200);
    const metadata = await json(response);
    assert.equal(metadata.resource, `${origin}${root}`);
    assert.deepEqual(metadata.authorization_servers, [origin]);
  }
  const server = await json(await api('/.well-known/oauth-authorization-server'));
  assert.equal(server.issuer, origin);
  for (const extra of [{}, { cookie: cookies['owner']! }, { authorization: 'Bearer flw_pat_' + 'a'.repeat(64) },
    { 'x-user-id': 'mcp_owner', 'x-auth-type': 'token', 'x-mcp-principal': 'mcp_owner' }]) {
    const refused = await mcp(undefined, 'tools/list', undefined, extra);
    assert.equal(refused.status, 401);
    assert.match(refused.headers.get('www-authenticate')!, /resource_metadata=/);
    assert.equal(refused.headers.get('set-cookie'), null);
  }
  assert.equal((await mcp(undefined, 'tools/list', undefined, { origin: 'https://attacker.example' })).status, 403);
  const preflight = await api(root, { method: 'OPTIONS', headers: { origin: 'https://claude.ai',
    'access-control-request-method': 'POST', 'access-control-request-headers': 'Authorization, Content-Type, MCP-Protocol-Version, Accept' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://claude.ai');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  assert.match(preflight.headers.get('access-control-allow-headers')!, /MCP-Protocol-Version/);
});

test('full mounted OAuth flow and max-one-connection dispatcher enforce scopes, roles and selected project', { timeout: 15000 }, async () => {
  const owner = await issue();
  const initialized = await mcp(owner.access_token, 'initialize'); // Invalid params fail safely, not a pool deadlock.
  assert.equal(initialized.status, 200);
  const listed = await tool(owner.access_token, 'flowboard_list_projects', {});
  assert.notEqual(listed.isError, true);
  assert.deepEqual(JSON.parse(listed.content[0].text).data.map((project: any) => project.id), ['mcp_project_a']);
  for (const name of ['flowboard_list_boards', 'flowboard_search_cards']) {
    const denied = await tool(owner.access_token, name, { projectId: 'mcp_project_b', query: 'secret' });
    assert.equal(denied.isError, true);
  }
  for (const path of ['/api/v1/projects', '/api/v1/session', `${root}/connections`, '/api/v1/boards/mcp_board_a/metadata']) {
    assert.equal((await api(path, { headers: { authorization: `Bearer ${owner.access_token}`, cookie: cookies['owner']! } })).status, 401, path);
  }
  assert.equal((await api(root)).status, 401);
  assert.equal((await api(root, { headers: { authorization: `Bearer ${owner.access_token}` } })).status, 405);
  const member = await issue('member');
  const boards = await tool(member.access_token, 'flowboard_list_boards', { projectId: 'mcp_project_a' });
  assert.deepEqual(JSON.parse(boards.content[0].text).map((board: any) => board.id), ['mcp_board_a']);
  assert.equal((await tool(member.access_token, 'flowboard_get_board_columns', { boardId: 'mcp_board_hidden' })).isError, true);
  const viewer = await issue('viewer');
  assert.equal((await tool(viewer.access_token, 'flowboard_create_card', { operationId: crypto.randomUUID(), boardId: 'mcp_board_a', column: 'mcp_column_a', title: 'Viewer denied' })).isError, true);
  const narrow = await issue('owner', 'projects:read offline_access');
  assert.equal((await tool(narrow.access_token, 'flowboard_get_board_columns', { boardId: 'mcp_board_a' })).isError, true);
});

test('create replay survives access refresh, preserves provenance and fails after disconnect', async () => {
  const grant = await issue();
  const args = { operationId: crypto.randomUUID(), boardId: 'mcp_board_a', column: 'mcp_column_a', title: 'One logical card' };
  const first = await tool(grant.access_token, 'flowboard_create_card', args);
  assert.notEqual(first.isError, true);
  const created = JSON.parse(first.content[0].text);
  const refreshed = await api(`${root}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: grant.clientId, refresh_token: grant.refresh_token, resource: `${origin}${root}` }) });
  assert.equal(refreshed.status, 200);
  const secondToken = (await json(refreshed)).access_token;
  const replay = JSON.parse((await tool(secondToken, 'flowboard_create_card', args)).content[0].text);
  assert.equal(replay.id, created.id);
  assert.equal(replay.replayed, true);
  assert.equal((await tool(secondToken, 'flowboard_create_card', { ...args, title: 'Changed' })).isError, true);
  const events = await pool.query(`SELECT safe_changes->'source' AS source FROM activity_log WHERE card_id=$1 AND action='card_created'`, [created.id]);
  assert.equal(events.rows.length, 1);
  const principal = await verifyHostedAccessToken(pool, secondToken, `${origin}${root}`);
  assert.equal(events.rows[0].source.type, 'mcp_oauth');
  assert.equal(events.rows[0].source.credentialId, principal!.connectionId);
  assert.equal(JSON.stringify(events.rows).includes(grant.access_token), false);
  await disconnectHostedConnection(pool, 'mcp_owner', principal!.connectionId);
  assert.equal((await mcp(secondToken, 'tools/list')).status, 401);
  assert.equal((await pool.query('SELECT count(*)::int n FROM cards WHERE id=$1', [created.id])).rows[0].n, 1);
});

test('an issued OAuth grant cannot outlive current board access, project membership or writable lifecycle', async () => {
  const member = await issue('member');
  const restore = async () => {
    await pool.query("UPDATE project_memberships SET status='active' WHERE id='mcp_pm_member'");
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)
      VALUES('mcp_board_a','mcp_project_a','mcp_ws','mcp_member','mcp_owner') ON CONFLICT DO NOTHING`);
    await pool.query("UPDATE projects SET archived=false WHERE id='mcp_project_a'");
  };
  try {
    await pool.query("DELETE FROM board_grants WHERE board_id='mcp_board_a' AND user_id='mcp_member'");
    assert.equal((await tool(member.access_token, 'flowboard_get_board_columns', { boardId: 'mcp_board_a' })).isError, true);
    await restore();
    await pool.query("UPDATE project_memberships SET status='removed' WHERE id='mcp_pm_member'");
    assert.equal((await tool(member.access_token, 'flowboard_search_cards', { projectId: 'mcp_project_a', query: 'card' })).isError, true);
    await restore();
    await pool.query("UPDATE projects SET archived=true WHERE id='mcp_project_a'");
    assert.equal((await tool(member.access_token, 'flowboard_create_card', { operationId: crypto.randomUUID(), boardId: 'mcp_board_a', column: 'mcp_column_a', title: 'Archived write denied' })).isError, true);
    assert.equal((await pool.query("SELECT count(*)::int n FROM cards WHERE title='Archived write denied'")).rows[0].n, 0);
  } finally { await restore(); }
});

test('private request identity is absent on clones and external identity headers cannot bypass policy', async () => {
  const grant = await issue();
  const principal = (await verifyHostedAccessToken(pool, grant.access_token, `${origin}${root}`))!;
  let marked = false;
  const result = await dispatchHostedMcpRequest(async request => {
    marked = readHostedMcpContext(request)?.pool === pool;
    assert.equal(readHostedMcpContext(request.clone()), undefined);
    assert.equal(request.headers.has('authorization'), false);
    assert.equal(request.headers.has('cookie'), false);
    return app.fetch(request);
  }, new Request(`${origin}/api/v1/projects`, { headers: { authorization: `Bearer ${grant.access_token}`, cookie: cookies['owner']! } }), principal, pool);
  assert.equal(marked, true);
  assert.equal(result.status, 200);
  const denied = await dispatchHostedMcpRequest(async request => app.fetch(request), new Request(`${origin}/api/v1/session`), principal, pool);
  assert.equal(denied.status, 403);
  const pat = await createPersonalAccessToken(pool, { userId: 'mcp_owner', name: 'Synthetic legacy PAT', scopes: ['projects:read'], projectId: 'mcp_project_a' });
  assert.equal((await api('/api/v1/projects', { headers: { authorization: `Bearer ${pat.token}` } })).status, 200);
});

test('mounted MCP owns streamed128KiB cap and a slow-body deadline before ordinary middleware buffering', async () => {
  const grant = await issue();
  let produced = 0;
  let cancelled = false;
  const large = new ReadableStream<Uint8Array>({
    pull(controller) { produced += 4096; controller.enqueue(new Uint8Array(4096).fill(32)); },
    cancel() { cancelled = true; },
  });
  const response = await api(root, { method: 'POST', headers: { authorization: `Bearer ${grant.access_token}`,
    accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: large, duplex: 'half' } as RequestInit);
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(produced <= 140 * 1024, 'ordinary1MiB buffer must never read this protocol body');
  let lifetime: Promise<void> | undefined;
  let slowCancelled = false;
  const bounded = createApp(undefined, { pool, mcpPublicOrigin: origin, deadlineMs: 30, onMcpWorkLifetime(work) { lifetime = work; } });
  const slow = await bounded.request(`${origin}${root}`, { method: 'POST', headers: { authorization: `Bearer ${grant.access_token}`,
    accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: new ReadableStream({ cancel() { slowCancelled = true; } }), duplex: 'half' } as RequestInit);
  assert.equal(slow.status, 504);
  await lifetime;
  assert.equal(slowCancelled, true);
});

test('deadline during queued verification still cancels the already-aborted body and settles lifetime', async () => {
  const grant = await issue();
  let lifetime: Promise<void> | undefined;
  let cancelled = false;
  const bounded = createApp(undefined, { pool, mcpPublicOrigin: origin, deadlineMs: 30, onMcpWorkLifetime(work) { lifetime = work; } });
  const blocker = await pool.connect();
  let released = false;
  try {
    const response = await bounded.request(`${origin}${root}`, { method: 'POST', headers: { authorization: `Bearer ${grant.access_token}`,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' } as RequestInit);
    assert.equal(response.status, 504);
    assert.ok(lifetime);
    blocker.release(); released = true;
    await Promise.race([lifetime, new Promise((_, reject) => setTimeout(() => reject(new Error('MCP lifetime did not settle after verification resumed')), 1000))]);
    assert.equal(cancelled, true);
  } finally { if (!released) blocker.release(); }
});

test('oversize MCP refusal and actual work lifetime settle despite an uncooperative source cancellation', async () => {
  const grant = await issue();
  for (const mode of ['declared', 'streamed']) {
    let lifetime: Promise<void> | undefined;
    let cancelled = false;
    const bounded = createApp(undefined, { pool, mcpPublicOrigin: origin, deadlineMs: 5000, onMcpWorkLifetime(work) { lifetime = work; } });
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(131073)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        bounded.request(`${origin}${root}`, { method: 'POST', headers: { authorization: `Bearer ${grant.access_token}`,
          accept: 'application/json, text/event-stream', 'content-type': 'application/json',
          ...(mode === 'declared' ? { 'content-length': '131073' } : {}),
        }, body, duplex: 'half' } as RequestInit),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000); }),
      ]);
      assert.ok(response, `${mode}: HTTP refusal must not await cancellation`);
      assert.equal(response.status, 413, mode);
      assert.equal(cancelled, true);
      assert.ok(lifetime);
      let settled = false;
      await Promise.race([lifetime.then(() => { settled = true; }), new Promise(resolve => setTimeout(resolve, 50))]);
      assert.equal(settled, true, `${mode}: Worker pool lifetime must finish after refusal`);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
});

test('mounted connection-based protocol/create limits fail closed without consuming another connection allowance', async () => {
  const grant = await issue();
  const principal = (await verifyHostedAccessToken(pool, grant.access_token, `${origin}${root}`))!;
  await pool.query(`INSERT INTO rate_limit_windows(bucket,client_key,window_start,request_count)
    SELECT 'mcp-protocol',$1,floor(extract(epoch FROM now()))::bigint/60*60,120`, [principal.connectionId]);
  const refused = await mcp(grant.access_token, 'tools/list');
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get('retry-after')) > 0);
  const fresh = await issue();
  assert.equal((await mcp(fresh.access_token, 'tools/list')).status, 200);
  await pool.query(`DELETE FROM rate_limit_windows WHERE bucket='mcp-protocol' AND client_key=$1`, [principal.connectionId]);
  await pool.query(`INSERT INTO rate_limit_windows(bucket,client_key,window_start,request_count)
    SELECT 'mcp-create',$1,floor(extract(epoch FROM now()))::bigint/60*60,30`, [principal.connectionId]);
  const denied = await tool(grant.access_token, 'flowboard_create_card', { operationId: crypto.randomUUID(), boardId: 'mcp_board_a', column: 'mcp_column_a', title: 'Rate denied' });
  assert.equal(denied.isError, true);
  assert.equal((await pool.query("SELECT count(*)::int n FROM cards WHERE title='Rate denied'")).rows[0].n, 0);
});

test('actual mounted create and disconnect serialize in both lock orders on separate PostgreSQL connections', { timeout: 15000 }, async () => {
  const observer = new pg.Client({ connectionString: process.env['DATABASE_URL'], options: `-c search_path=${schema}` });
  const revoker = new pg.Client({ connectionString: process.env['DATABASE_URL'], options: `-c search_path=${schema}` });
  await observer.connect(); await revoker.connect();
  const key = 710042;
  const waitFor = async (check: () => Promise<boolean>) => {
    const until = Date.now() + 2000;
    while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.fail('Expected separate-connection lock wait was not observed');
  };
  try {
    await pool.query(`CREATE FUNCTION mcp_hold_create() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.title='Create wins credential race' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER mcp_hold_create BEFORE INSERT ON cards FOR EACH ROW EXECUTE FUNCTION mcp_hold_create()`);
    const first = await issue();
    const principal = (await verifyHostedAccessToken(pool, first.access_token, `${origin}${root}`))!;
    await observer.query('SELECT pg_advisory_lock($1)', [key]);
    const creation = tool(first.access_token, 'flowboard_create_card', { operationId: crypto.randomUUID(), boardId: 'mcp_board_a', column: 'mcp_column_a', title: 'Create wins credential race' });
    await waitFor(async () => (await observer.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1::oid AND NOT granted) waiting`, [key])).rows[0].waiting);
    let disconnected = false;
    const disconnect = disconnectHostedConnection(revoker, 'mcp_owner', principal.connectionId).then(() => { disconnected = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(disconnected, false, 'disconnect must wait for the in-flight credential SHARE lock');
    await observer.query('SELECT pg_advisory_unlock($1)', [key]);
    assert.notEqual((await creation).isError, true);
    await disconnect;
    assert.equal((await mcp(first.access_token, 'tools/list')).status, 401);

    const second = await issue();
    const other = (await verifyHostedAccessToken(pool, second.access_token, `${origin}${root}`))!;
    const poolPid = (await pool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const revokerPid = (await revoker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await revoker.query('BEGIN');
    await disconnectHostedConnection(revoker, 'mcp_owner', other.connectionId);
    const refused = tool(second.access_token, 'flowboard_create_card', { operationId: crypto.randomUUID(), boardId: 'mcp_board_a', column: 'mcp_column_a', title: 'Disconnect wins credential race' });
    await waitFor(async () => (await observer.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) waiting', [revokerPid, poolPid])).rows[0].waiting);
    await revoker.query('COMMIT');
    assert.equal((await refused).isError, true);
    assert.equal((await pool.query("SELECT count(*)::int n FROM cards WHERE title='Disconnect wins credential race'")).rows[0].n, 0);
  } finally {
    await observer.query('SELECT pg_advisory_unlock_all()').catch(() => {});
    await revoker.query('ROLLBACK').catch(() => {});
    await observer.end(); await revoker.end();
    await pool.query('DROP TRIGGER IF EXISTS mcp_hold_create ON cards');
    await pool.query('DROP FUNCTION IF EXISTS mcp_hold_create()');
  }
});

test('actual production Worker uses Node-issued OAuth and a single request connection for create/replay', { timeout: 60000 }, async t => {
  const grant = await issue();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-hosted-mcp-mounted-'));
  const selected = new URL(process.env['DATABASE_URL']!);
  selected.searchParams.set('options', `-c search_path=${schema}`);
  const configPath = path.join(dir, 'wrangler.json');
  await fs.writeFile(configPath, JSON.stringify({ name: 'flowboard-hosted-mcp-mounted-worker',
    main: fileURLToPath(new URL('../src/runtime/worker.ts', import.meta.url)), compatibility_date: '2026-10-19',
    compatibility_flags: ['nodejs_compat'], dev: { host: new URL(origin).host, upstream_protocol: 'https' },
    vars: { DATABASE_URL: selected.toString(), APP_ORIGIN: origin } }), { mode: 0o600 });
  const harness = createTestHarness({ workers: [{ configPath }] });
  try {
    await harness.listen();
    const worker = harness.getWorker('flowboard-hosted-mcp-mounted-worker');
    const args = { operationId: crypto.randomUUID(), boardId: 'mcp_board_a', column: 'mcp_column_a', title: 'Actual Worker create' };
    const send = () => worker.fetch(`${origin}${root}`, { method: 'POST', headers: { host: new URL(origin).host, authorization: `Bearer ${grant.access_token}`,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'flowboard_create_card', arguments: args } }) });
    const createdResponse = await send();
    const created = await json(createdResponse);
    assert.ok(created.result, JSON.stringify({ status: createdResponse.status, code: created.error?.code, message: created.error?.message }));
    assert.notEqual(created.result?.isError, true, created.result?.content?.[0]?.text ?? 'Missing Worker tool result');
    const first = JSON.parse(created.result.content[0].text);
    const replayed = await json(await send());
    assert.notEqual(replayed.result?.isError, true);
    const second = JSON.parse(replayed.result.content[0].text);
    assert.equal(first.id, second.id);
    assert.equal(second.replayed, true);
    assert.equal((await pool.query('SELECT count(*)::int n FROM cards WHERE id=$1', [first.id])).rows[0].n, 1);
    t.diagnostic('Actual production Worker + single request-scoped pg pool + isolated PostgreSQL schema; no hosted deployment claim.');
  } finally { await harness.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
