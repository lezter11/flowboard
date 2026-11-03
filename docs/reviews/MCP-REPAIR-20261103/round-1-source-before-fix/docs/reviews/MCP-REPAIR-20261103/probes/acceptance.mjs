// Synthetic mounted-handler probes. No hosted requests and no persisted bearer values.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createTestHarness } from 'wrangler';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createSession } from '../../../../apps/api/src/adapters/session.ts';
import { createPersonalAccessToken, revokePersonalAccessToken } from '../../../../apps/api/src/adapters/tokens.ts';
import { redactCardActivity } from '../../../../apps/api/src/adapters/activity.ts';
import { FlowboardClient } from '../../../../packages/mcp/src/client.ts';
import { onRequest as proxyRequest } from '../../../../apps/web/functions/api/[[path]].ts';

const connectionString = process.env.FLOWBOARD_MCP_TEST_DATABASE_URL;
assert.ok(connectionString, 'An explicitly disposable probe database is required.');
const address = new URL(connectionString);
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.port, '55923');
assert.equal(address.username, 'flowboard_harness');
assert.equal(address.pathname, '/flowboard_mcp_probe');
const pool = new pg.Pool({ connectionString, max: 12, application_name: 'flowboard-mcp-repair-probes' });
const suffix = crypto.randomUUID().replaceAll('-', '');
const owner = `probe_owner_${suffix}`, member = `probe_member_${suffix}`, stranger = `probe_other_${suffix}`;
const ws = `probe_ws_${suffix}`, a = `probe_a_${suffix}`, b = `probe_b_${suffix}`;
const ba = `probe_ba_${suffix}`, bb = `probe_bb_${suffix}`, ca = `probe_ca_${suffix}`, cb = `probe_cb_${suffix}`;
const cardA = `probe_card_a_${suffix}`, privateCard = `probe_card_b_${suffix}`;
const results = [];
let tokenCount = 0;
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'fail' });
    // Never serialize a Request, token object, DB row or arbitrary assertion value.
    console.error(`FAIL ${name} (${error?.name ?? 'Error'})`);
    throw error;
  }
}
try {
  await runMigrations(pool);
  await pool.query(`INSERT INTO users(id,email,display_name,created_at,updated_at)
    VALUES($1,$2,'Synthetic Owner',now(),now()),($3,$4,'Synthetic Member',now(),now()),($5,$6,'Other',now(),now())`,
  [owner, `${owner}@example.invalid`, member, `${member}@example.invalid`, stranger, `${stranger}@example.invalid`]);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)
    VALUES($1,'Probe workspace','UTC',$2,now(),now())`, [ws, owner]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)
    VALUES($1,$3,'ZZ scoped project',now(),now()),($2,$3,'AA private project',now(),now())`, [a, b, ws]);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)
    VALUES($1,$3,$4,'Board A',now(),now()),($2,$3,$5,'Board B',now(),now())`, [ba, bb, ws, a, b]);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)
    VALUES($1,$3,$4,$6,'Todo','#64748b','todo',0,now(),now()),($2,$3,$5,$7,'Todo','#64748b','todo',0,now(),now())`, [ca, cb, ws, a, b, ba, bb]);
  for (const [id, p, board, column, title] of [
    [cardA, a, ba, ca, 'needle compliance alert'],
    [`probe_nonmatch_${suffix}`, a, ba, ca, 'unrelated private item'],
    [privateCard, b, bb, cb, 'secret project B card'],
  ]) {
    await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,description,priority,position,state,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic description','medium',1000,'active',now(),now())`, [id, ws, p, board, column, title]);
  }
  const session = await createSession(owner, 24, pool);
  const memberSession = await createSession(member, 24, pool);
  const app = createApp(async () => {}, { pool,
    rateLimiter: () => ({ limit: async () => ({ success: true }) }),
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  });
  async function request(method, path, token, body, key = crypto.randomUUID(), cookie) {
    const headers = { 'content-type': 'application/json', origin: 'http://localhost', 'idempotency-key': key };
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = `flowboard_session=${cookie}`;
    const response = await app.request(`http://localhost${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const mint = (name, scopes, projectId = a, userId = owner) => {
    tokenCount++;
    return createPersonalAccessToken(pool, { userId, name, scopes, projectId, expiresInDays: 1 });
  };
  let ownerMint;
  await check('MCP-05 Owner without membership can mint a restricted token through session route', async () => {
    const memberships = await pool.query('SELECT 1 FROM project_memberships WHERE user_id=$1', [owner]);
    assert.equal(memberships.rowCount, 0);
    ownerMint = await request('POST', '/api/v1/tokens', null,
      { name: 'Owner route probe', projectId: a, scopes: ['cards:read'] }, undefined, session.id);
    assert.equal(ownerMint.status, 201);
    assert.ok(ownerMint.body.data?.token);
    assert.ok(ownerMint.body.data.tokenDetails.expiresAt);
  });
  const readA = await mint('Read A', ['cards:read']);
  const boardsA = await mint('Boards A', ['boards:read']);
  const projectsA = await mint('Projects A', ['projects:read']);
  const createA = await mint('Create A', ['cards:create', 'boards:read']);
  const second = await mint('Second credential', ['cards:create', 'boards:read']);
  await check('MCP-01 session/account/credential administration denied to PAT', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/v1/session'], ['PATCH', '/api/v1/session/profile', { displayName: 'Changed' }],
      ['GET', '/api/v1/tokens'], ['DELETE', `/api/v1/tokens/${second.tokenDetails.id}`],
      ['POST', '/api/v1/tokens', { name: 'Child', scopes: ['cards:create'] }],
    ]) {
      const result = await request(method, path, readA.token, body);
      assert.equal(result.status, 403, `${method} ${path.split('/').slice(0, 4).join('/')}`);
      assert.equal(result.body.data, undefined);
    }
  });
  await check('MCP-01 cross-project read/write denied and private card unchanged', async () => {
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const r = await request(method, `/api/v1/cards/${privateCard}`, readA.token,
        method === 'GET' ? undefined : { title: 'Unauthorized', expectedVersion: 1 });
      assert.ok([403, 404].includes(r.status));
      assert.equal(r.body.data, undefined);
    }
    const actual = await pool.query('SELECT title FROM cards WHERE id=$1', [privateCard]);
    assert.equal(actual.rows[0].title, 'secret project B card');
  });
  await check('MCP-01 invalid bearer cannot fall back to a valid cookie', async () => {
    const r = await request('GET', `/api/v1/cards/${cardA}`, 'flw_pat_invalid', undefined, undefined, session.id);
    assert.equal(r.status, 401);
    assert.equal(r.body.data, undefined);
  });
  await check('MCP-02 boards:read cannot retrieve full card snapshots', async () => {
    assert.equal((await request('GET', `/api/v1/boards/${ba}`, boardsA.token)).status, 403);
    const r = await request('GET', `/api/v1/boards/${ba}/metadata`, boardsA.token);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['columns', 'id', 'name', 'structureVersion']);
    assert.equal(r.body.data.columns.length, 1);
    assert.deepEqual(Object.keys(r.body.data.columns[0]).sort(), ['category', 'id', 'name', 'position']);
    assert.ok(!JSON.stringify(r.body).includes('private item'));
  });
  await check('MCP-03 project filter precedes pagination, with no foreign cursor', async () => {
    const r = await request('GET', '/api/v1/projects?limit=1', projectsA.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.data[0].id, a);
    assert.equal(r.body.nextCursor, null);
    assert.ok(!JSON.stringify(r.body).includes('AA private'));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => app.request(new Request(url, init));
  try {
    await check('MCP-02 client columns tool explicitly excludes card properties', async () => {
      const client = new FlowboardClient({ apiUrl: 'http://localhost', apiToken: boardsA.token });
      const board = await client.getBoard(ba);
      assert.equal(board.columns.length, 1);
      assert.deepEqual(Object.keys(board.columns[0]).sort(), ['category', 'id', 'name', 'position']);
    });
    await check('MCP-06 actual MCP search filters matches through mounted route', async () => {
      const client = new FlowboardClient({ apiUrl: 'http://localhost', apiToken: readA.token });
      const page = await client.searchCards(a, 'needle');
      assert.equal(page.data.length, 1);
      assert.equal(page.data[0].id, cardA);
    });
  } finally { globalThis.fetch = originalFetch; }
  const boardVersion = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [ba])).rows[0].structure_version);
  const cardCount = async (title) => Number((await pool.query('SELECT count(*)::int AS n FROM cards WHERE board_id=$1 AND title=$2', [ba, title])).rows[0].n);
  let savedCard;
  const operationId = crypto.randomUUID();
  await check('Invalid year-zero calendar dates fail before PostgreSQL writes', async () => {
    const r = await request('POST', `/api/v1/boards/${ba}/cards`, createA.token,
      { title: 'Invalid calendar operation', columnId: ca, dueDate: '0000-01-01', expectedBoardVersion: await boardVersion() });
    assert.equal(r.status, 422);
    assert.equal(await cardCount('Invalid calendar operation'), 0);
  });
  await check('MCP-04 committed response lost, fresh client retry creates exactly one card', async () => {
    let lose = true, sawFailure = false;
    globalThis.fetch = async (url, init) => {
      const response = await app.request(new Request(url, init));
      if (init?.method === 'POST' && response.status === 201 && lose) {
        lose = false;
        throw new TypeError('Synthetic response dropped after commit');
      }
      return response;
    };
    const input = { operationId, boardId: ba, column: ca, title: 'Lost response operation' };
    try {
      try { await new FlowboardClient({ apiUrl: 'http://localhost', apiToken: createA.token }).createCard(input); }
      catch { sawFailure = true; }
      savedCard = await new FlowboardClient({ apiUrl: 'http://localhost', apiToken: createA.token }).createCard(input);
      assert.ok(sawFailure);
      assert.equal(await cardCount(input.title), 1);
      assert.ok(savedCard.id);
    } finally { globalThis.fetch = originalFetch; }
  });
  await check('MCP-04 changed semantic input conflicts with the original operation', async () => {
    const r = await request('POST', `/api/v1/boards/${ba}/cards`, createA.token,
      { title: 'Altered operation', columnId: ca, expectedBoardVersion: await boardVersion() }, operationId);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await cardCount('Altered operation'), 0);
  });
  await check('MCP-04 parallel identical requests on separate connections have one effect', async () => {
    const key = crypto.randomUUID(), title = 'Concurrent same operation';
    const body = { title, columnId: ca, expectedBoardVersion: await boardVersion() };
    const both = await Promise.all([request('POST', `/api/v1/boards/${ba}/cards`, createA.token, body, key),
      request('POST', `/api/v1/boards/${ba}/cards`, createA.token, body, key)]);
    assert.deepEqual(both.map((r) => r.status), [201, 201]);
    assert.equal(both[0].body.data.id, both[1].body.data.id);
    assert.equal(await cardCount(title), 1);
  });
  await check('MCP-04 identical caller keys under different credentials are distinct operations', async () => {
    const key = crypto.randomUUID(), title = 'Separate credentials operation';
    for (const token of [createA.token, second.token]) {
      const r = await request('POST', `/api/v1/boards/${ba}/cards`, token,
        { title, columnId: ca, expectedBoardVersion: await boardVersion() }, key);
      assert.equal(r.status, 201);
    }
    assert.equal(await cardCount(title), 2);
  });
  await check('MCP-08 atomic activity identifies human, safe credential and hashed operation', async () => {
    const r = await pool.query('SELECT actor_id,safe_changes FROM activity_log WHERE card_id=$1 AND action=$2', [savedCard.id, 'card_created']);
    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].actor_id, owner);
    assert.deepEqual(r.rows[0].safe_changes.source, {
      type: 'personal_access_token', credentialId: createA.tokenDetails.id,
      operationIdHash: crypto.createHash('sha256').update(operationId).digest('hex'),
    });
    const receipts = await pool.query('SELECT idempotency_key,response_body FROM idempotency_receipts WHERE actor_id=$1', [owner]);
    assert.ok(!JSON.stringify(r.rows).includes(createA.token));
    assert.ok(!JSON.stringify(receipts.rows).includes(createA.token));
    assert.ok(!JSON.stringify(receipts.rows).includes(operationId));
  });
  await check('MCP-08 privacy redaction preserves safe machine provenance', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await redactCardActivity(client, savedCard.id);
      const r = await client.query('SELECT safe_changes FROM activity_log WHERE card_id=$1', [savedCard.id]);
      assert.equal(r.rows[0].safe_changes.source.credentialId, createA.tokenDetails.id);
      assert.equal(r.rows[0].safe_changes.title, undefined);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
  await check('Session card creation retains a distinguishable human origin', async () => {
    const r = await request('POST', `/api/v1/boards/${ba}/cards`, null,
      { title: 'Human operation', columnId: ca, expectedBoardVersion: await boardVersion() }, undefined, session.id);
    assert.equal(r.status, 201);
    const a = await pool.query('SELECT safe_changes FROM activity_log WHERE card_id=$1', [r.body.data.id]);
    assert.deepEqual(a.rows[0].safe_changes.source, { type: 'session' });
  });
  await pool.query(`INSERT INTO project_memberships(id,workspace_id,project_id,user_id,role,status,created_at,updated_at)
    VALUES($1,$2,$3,$4,'member','active',now(),now())`, [`probe_pm_${suffix}`, ws, a, member]);
  await pool.query('INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES($1,$2,$3,$4,$5)', [ba, a, ws, member, owner]);
  const memberToken = await mint('Member current grant', ['cards:create', 'boards:read'], a, member);
  const memberKey = crypto.randomUUID();
  await check('Current board grant checked both initially and before receipt replay', async () => {
    const body = { title: 'Member operation', columnId: ca, expectedBoardVersion: await boardVersion() };
    assert.equal((await request('POST', `/api/v1/boards/${ba}/cards`, memberToken.token, body, memberKey)).status, 201);
    await pool.query('DELETE FROM board_grants WHERE board_id=$1 AND user_id=$2', [ba, member]);
    assert.equal((await request('GET', `/api/v1/boards/${ba}/metadata`, memberToken.token)).status, 404);
    const replay = await request('POST', `/api/v1/boards/${ba}/cards`, memberToken.token, body, memberKey);
    assert.equal(replay.status, 404);
    assert.equal(replay.body.data, undefined);
  });
  await check('Removed member and outsider cannot issue scoped credentials', async () => {
    await pool.query("UPDATE project_memberships SET status='removed' WHERE user_id=$1 AND project_id=$2", [member, a]);
    const removed = await request('POST', '/api/v1/tokens', null,
      { name: 'Removed', projectId: a, scopes: ['cards:read'] }, undefined, memberSession.id);
    assert.ok([403, 404].includes(removed.status));
    const outsiderSession = await createSession(stranger, 24, pool);
    const outsider = await request('POST', '/api/v1/tokens', null,
      { name: 'Outsider', projectId: a, scopes: ['cards:read'] }, undefined, outsiderSession.id);
    assert.ok([403, 404].includes(outsider.status));
  });
  await check('Expired credential and subsequent revoked-credential replay are denied', async () => {
    const expired = await mint('Expired', ['boards:read']);
    await pool.query("UPDATE personal_access_tokens SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.tokenDetails.id]);
    assert.equal((await request('GET', `/api/v1/boards/${ba}/metadata`, expired.token)).status, 401);
    await revokePersonalAccessToken(pool, createA.tokenDetails.id, owner);
    const r = await request('POST', `/api/v1/boards/${ba}/cards`, createA.token,
      { title: 'Lost response operation', columnId: ca, expectedBoardVersion: await boardVersion() }, operationId);
    assert.equal(r.status, 401);
    assert.equal(r.body.data, undefined);
  });
  await check('Revoke-versus-create: committed revocation wins while write waits on real token row lock', async () => {
    const token = await mint('Revocation race', ['cards:create']);
    const revoker = await pool.connect();
    let pending;
    try {
      await revoker.query('BEGIN');
      const pid = Number((await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await revoker.query('UPDATE personal_access_tokens SET revoked_at=clock_timestamp() WHERE id=$1', [token.tokenDetails.id]);
      const body = { title: 'Must not survive revocation', columnId: ca, expectedBoardVersion: await boardVersion() };
      pending = request('POST', `/api/v1/boards/${ba}/cards`, token.token, body);
      let observed = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const blocked = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
          AND wait_event_type='Lock' AND query ILIKE '%personal_access_tokens%' AND query ILIKE '%FOR SHARE%'`, [pid]);
        if (blocked.rowCount) { observed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await revoker.query('COMMIT');
      assert.ok(observed, 'No token row-lock interleaving observed; this is not a race pass.');
      assert.equal((await pending).status, 401);
      assert.equal(await cardCount(body.title), 0);
    } finally {
      await revoker.query('ROLLBACK').catch(() => {});
      revoker.release();
      if (pending) await pending.catch(() => {});
    }
  });
  await check('MCP through the actual Pages proxy preserves bearer capability and no-store response', async () => {
    const response = await proxyRequest({
      request: new Request(`http://localhost/api/v1/boards/${ba}/metadata`, { headers: { authorization: `Bearer ${boardsA.token}` } }),
      env: { API: { fetch: (request) => app.request(request) } },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = (await response.json()).data;
    assert.deepEqual(Object.keys(data).sort(), ['columns', 'id', 'name', 'structureVersion']);
    const denied = await proxyRequest({
      request: new Request('http://localhost/api/v1/session', { headers: { authorization: `Bearer ${boardsA.token}` } }),
      env: { API: { fetch: (request) => app.request(request) } },
    });
    assert.equal(denied.status, 403);
  });
  await check('Real local workerd: PAT metadata/create/lost-response replay and session denial', async () => {
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = connectionString;
    const harness = createTestHarness({ workers: [{ configPath: fileURLToPath(new URL('../../../../apps/api/test/wrangler.jsonc', import.meta.url)) }] });
    try {
      await harness.listen();
      const worker = harness.getWorker('flowboard-api-test');
      let drop = true, failed = false;
      globalThis.fetch = async (url, init) => {
        const response = await worker.fetch(String(url), init);
        if (init?.method === 'POST' && response.status === 201 && drop) {
          drop = false;
          throw new TypeError('Synthetic response loss after workerd commit');
        }
        return response;
      };
      const input = { operationId: crypto.randomUUID(), boardId: ba, column: ca, title: 'Local workerd logical operation' };
      try { await new FlowboardClient({ apiUrl: 'http://localhost', apiToken: second.token }).createCard(input); }
      catch { failed = true; }
      const replay = await new FlowboardClient({ apiUrl: 'http://localhost', apiToken: second.token }).createCard(input);
      assert.ok(failed);
      assert.equal(replay.replayed, true);
      assert.equal(await cardCount(input.title), 1);
      const activity = await pool.query('SELECT actor_id,safe_changes FROM activity_log WHERE card_id=$1', [replay.id]);
      assert.equal(activity.rows[0].actor_id, owner);
      assert.equal(activity.rows[0].safe_changes.source.credentialId, second.tokenDetails.id);
      assert.equal((await worker.fetch('http://localhost/api/v1/session', { headers: { authorization: `Bearer ${second.token}` } })).status, 403);
      assert.equal((await worker.fetch(`http://localhost/api/v1/boards/${ba}`, { headers: { authorization: `Bearer ${second.token}` } })).status, 403);
    } finally {
      globalThis.fetch = originalFetch;
      await harness.close();
    }
  });
  console.log(`Acceptance probes: ${results.length}/${results.length} groups passed; synthetic tokens created=${tokenCount + 1}; no hosted calls.`);
} finally {
  await pool.end();
  const report = process.env.FLOWBOARD_PROBE_REPORT ?? new URL('../raw/acceptance-results.json', import.meta.url);
  await fs.writeFile(report, `${JSON.stringify({ results, passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length, environment: 'Disposable PostgreSQL17.11, localhost55923, flowboard_mcp_probe' }, null, 2)}\n`);
}
