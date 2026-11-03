import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createSession } from '../src/adapters/session.ts';
import { createPersonalAccessToken, MAX_ACTIVE_PERSONAL_ACCESS_TOKENS } from '../src/adapters/tokens.ts';
import { PERSONAL_ACCESS_TOKEN_ROUTES, matchPersonalAccessTokenRoute } from '../src/http/middleware/token-policy.ts';
import type { TokenScope } from '@flowboard/contracts';

test('PAT capability boundary through every mounted route', async (t) => {
  const pool = getPool();
  const app = createApp();
  await runMigrations(pool);
  await pool.query('TRUNCATE workspaces, users, sessions, personal_access_tokens CASCADE');
  const userIds = ['owner', 'member', 'viewer', 'removed', 'outsider'];
  for (const name of userIds) {
    await pool.query(`INSERT INTO users(id,email,display_name,created_at,updated_at)
      VALUES($1,$2,$3,NOW(),NOW())`, [`pat_${name}`, `${name}@token.example`, name]);
  }
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,version,created_at,updated_at)
    VALUES('pat_ws','Token boundary workspace','UTC','pat_owner',1,NOW(),NOW())`);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,version,created_at,updated_at)
    VALUES('pat_project_a','pat_ws','ZZ authorized',1,NOW(),NOW()),
          ('pat_project_b','pat_ws','AA confidential',1,NOW(),NOW())`);
  for (const [name, role, status] of [['member', 'member', 'active'], ['viewer', 'viewer', 'active'], ['removed', 'member', 'removed']]) {
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
      VALUES($1,'pat_project_a','pat_ws',$2,$3,$4,1,NOW(),NOW())`, [`pat_pm_${name}`, `pat_${name}`, role, status]);
  }
  for (const suffix of ['a', 'b']) {
    await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,structure_version,snapshot_version,created_at,updated_at)
      VALUES($1,'pat_ws',$2,$3,1,1,NOW(),NOW())`, [`pat_board_${suffix}`, `pat_project_${suffix}`, `Board ${suffix}`]);
    await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
      VALUES($1,'pat_ws',$2,$3,'Todo','#3b82f6','todo',0,1,NOW(),NOW())`, [`pat_column_${suffix}`, `pat_project_${suffix}`, `pat_board_${suffix}`]);
  }
  for (const name of ['member', 'viewer']) {
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)
      VALUES('pat_board_a','pat_project_a','pat_ws',$1,'pat_owner')`, [`pat_${name}`]);
  }
  await pool.query("UPDATE boards SET description='METADATA-DESCRIPTION-SENTINEL' WHERE id='pat_board_a'");
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,description,priority,position,state,created_at,updated_at)
    VALUES('pat_metadata_card','pat_ws','pat_project_a','pat_board_a','pat_column_a',
      'METADATA-CARD-SENTINEL','METADATA-CARD-DESCRIPTION-SENTINEL','none',1000,'active',NOW(),NOW())`);
  const cookies = new Map<string, string>();
  for (const name of userIds) {
    const session = await createSession(`pat_${name}`, 24, pool);
    cookies.set(name, `flowboard_session=${session.id}`);
  }
  const allScopes: TokenScope[] = ['projects:read', 'boards:read', 'cards:read', 'cards:create'];
  async function mint(name: string, scopes: TokenScope[], projectId = 'pat_project_a') {
    const res = await app.request('/api/v1/tokens', {
      method: 'POST', headers: { Cookie: cookies.get(name)!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Boundary test credential', scopes, projectId }),
    });
    assert.equal(res.status, 201, `mint ${name}: status only ${res.status}`);
    return (await res.json()).data as { token: string; tokenDetails: { id: string; expiresAt: string } };
  }
  const full = await mint('owner', allScopes);
  const metadata = await mint('owner', ['boards:read']);
  const projects = await mint('owner', ['projects:read']);
  const cards = await mint('owner', ['cards:read']);
  const request = (path: string, token: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'Idempotency-Key': 'pat-boundary-unique-operation',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  try {
    await t.test('real Owner issuance without membership, finite default expiry, no secret persistence', async () => {
      const count = await pool.query(`SELECT count(*)::int AS n FROM project_memberships WHERE user_id='pat_owner'`);
      assert.equal(count.rows[0].n, 0);
      const remainingDays = (Date.parse(full.tokenDetails.expiresAt) - Date.now()) / 86_400_000;
      assert.ok(remainingDays > 29 && remainingDays <= 30);
      const listed = await app.request('/api/v1/tokens', { headers: { Cookie: cookies.get('owner')! } });
      assert.equal(listed.status, 200);
      const output = JSON.stringify(await listed.json());
      assert.equal(output.includes(full.token), false);
      const stored = await pool.query(`SELECT row_to_json(pat)::text AS serialized FROM personal_access_tokens pat`);
      assert.equal(stored.rows.some((row) => row.serialized.includes(full.token)), false);
    });

    await t.test('generated route inventory: every route outside the six capabilities rejects PAT', async () => {
      const routes = [...new Map(app.routes.filter((route) => route.method !== 'ALL' && route.method !== 'OPTIONS')
        .map((route) => [`${route.method} ${route.path}`, route])).values()];
      const registered = new Set(routes.map((route) => `${route.method} ${route.path}`));
      for (const policy of PERSONAL_ACCESS_TOKEN_ROUTES) assert.ok(registered.has(`${policy.method} ${policy.path}`), 'allowlist entry must be mounted');
      let checked = 0;
      for (const route of routes) {
        if (PERSONAL_ACCESS_TOKEN_ROUTES.some((policy) => policy.method === route.method && policy.path === route.path)) continue;
        const path = route.path.replace(/:[A-Za-z]+/g, 'pat_target');
        const response = await request(path, full.token, route.method, ['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.method) ? {} : undefined);
        assert.equal(response.status, 403, `unexpected authorization for ${route.method} ${route.path}`);
        assert.equal((await response.json()).data, undefined, `data on denied ${route.method} ${route.path}`);
        checked++;
      }
      assert.ok(checked >= 80, 'inventory unexpectedly small');
      t.diagnostic(`Generated ${checked} negative method/path cases from ${routes.length} mounted routes; six explicit PAT capabilities.`);
    });

    await t.test('metadata contains only allowlisted fields; full snapshot always denied', async () => {
      const response = await request('/api/v1/boards/pat_board_a/metadata', metadata.token);
      assert.equal(response.status, 200);
      const { data } = await response.json();
      assert.deepEqual(Object.keys(data).sort(), ['columns', 'id', 'name', 'structureVersion']);
      assert.deepEqual(Object.keys(data.columns[0]).sort(), ['category', 'id', 'name', 'position']);
      for (const token of [metadata.token, full.token]) {
        const denied = await request('/api/v1/boards/pat_board_a', token);
        assert.equal(denied.status, 403);
      }
      assert.equal((await request('/api/v1/boards/pat_board_a/metadata', cards.token)).status, 403);
    });

    await t.test('boards-only direct listing omits descriptions and snapshot data while session response retains details', async () => {
      const response = await request('/api/v1/projects/pat_project_a/boards', metadata.token);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.data.length, 1);
      assert.deepEqual(Object.keys(body.data[0]).sort(), ['id', 'name', 'structureVersion']);
      assert.equal(JSON.stringify(body).includes('SENTINEL'), false);
      const sessionResponse = await app.request('/api/v1/projects/pat_project_a/boards', { headers: { Cookie: cookies.get('owner')! } });
      assert.equal(sessionResponse.status, 200);
      assert.equal((await sessionResponse.json()).data[0].description, 'METADATA-DESCRIPTION-SENTINEL');
    });

    await t.test('project filtering happens before pagination and foreign cursors are refused', async () => {
      const response = await request('/api/v1/projects?limit=1', projects.token);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(result.data.map((p: { id: string }) => p.id), ['pat_project_a']);
      assert.equal(result.nextCursor, null);
      assert.equal(JSON.stringify(result).includes('confidential'), false);
      const foreignCursor = Buffer.from(JSON.stringify({ name: 'AA confidential', id: 'pat_project_b' })).toString('base64url');
      const denied = await request(`/api/v1/projects?limit=1&cursor=${foreignCursor}`, projects.token);
      assert.equal(denied.status, 400);
      assert.equal((await denied.json()).error.code, 'INVALID_CURSOR');
    });

    await t.test('project restrictions apply to metadata, board listing, card reads/search/create', async () => {
      const create = await request('/api/v1/boards/pat_board_b/cards', full.token, 'POST', {
        title: 'Foreign card', columnId: 'pat_column_b', expectedBoardVersion: 1,
      });
      assert.equal(create.status, 403);
      for (const path of ['/api/v1/boards/pat_board_b/metadata', '/api/v1/projects/pat_project_b/boards', '/api/v1/projects/pat_project_b/cards/search?query=secret']) {
        assert.equal((await request(path, full.token)).status, 403, path);
      }
      // A session creates the foreign card; the same human's restricted PAT still cannot read it.
      const sessionCreate = await app.request('/api/v1/boards/pat_board_b/cards', {
        method: 'POST', headers: { Cookie: cookies.get('owner')!, 'Content-Type': 'application/json', 'Idempotency-Key': 'session-foreign-card' },
        body: JSON.stringify({ title: 'Sibling secret', columnId: 'pat_column_b', expectedBoardVersion: 1 }),
      });
      assert.equal(sessionCreate.status, 201);
      const foreignId = (await sessionCreate.json()).data.id;
      assert.equal((await request(`/api/v1/cards/${foreignId}`, full.token)).status, 403);
      const sessionRead = await app.request(`/api/v1/cards/${foreignId}`, { headers: { Cookie: cookies.get('owner')! } });
      assert.equal(sessionRead.status, 200);
    });

    await t.test('missing scope, malformed bearer and invalid token never inherit a cookie', async () => {
      for (const authorization of ['Bearer invalid', `Bearer flw_pat_${'0'.repeat(64)}`, 'Basic invalid']) {
        for (const path of ['/api/v1/session', '/api/v1/projects', '/health/live', '/api/v1/boards/pat_board_a']) {
          const response = await app.request(path, { headers: { Authorization: authorization, Cookie: cookies.get('owner')! } });
          assert.equal(response.status, 401, `bad bearer fallback at ${path}`);
          assert.equal(response.headers.get('Cache-Control'), 'no-store');
        }
      }
      for (const [path, token, method] of [
        ['/api/v1/projects', metadata.token, 'GET'],
        ['/api/v1/projects/pat_project_a/boards', projects.token, 'GET'],
        ['/api/v1/projects/pat_project_a/cards/search?query=needle', metadata.token, 'GET'],
        ['/api/v1/boards/pat_board_a/cards', cards.token, 'POST'],
      ]) assert.equal((await request(path!, token!, method!, method === 'POST' ? {} : undefined)).status, 403);
      for (const path of ['/api/v1/boards/pat_board_a%2fmetadata/metadata', '/api/v1/boards/pat_board_a%5ccards/metadata', '/api/v1/boards/pat_board_a/metadata/extra']) {
        assert.equal((await request(path, full.token)).status, 403);
      }
      assert.equal(matchPersonalAccessTokenRoute('GET', '/api/v1/boards/pat_board_a%2fmetadata/metadata'), null);
    });

    await t.test('current underlying membership and board grants remain authoritative', async () => {
      const member = await mint('member', allScopes);
      assert.equal((await request('/api/v1/boards/pat_board_a/metadata', member.token)).status, 200);
      await pool.query(`DELETE FROM board_grants WHERE user_id='pat_member' AND board_id='pat_board_a'`);
      assert.equal((await request('/api/v1/boards/pat_board_a/metadata', member.token)).status, 404);
      await pool.query(`UPDATE project_memberships SET status='removed' WHERE user_id='pat_member'`);
      assert.equal((await request('/api/v1/projects/pat_project_a/boards', member.token)).status, 404);
      const nowHidden = await request('/api/v1/projects', member.token);
      assert.equal(nowHidden.status, 200);
      assert.deepEqual((await nowHidden.json()).data, []);
      for (const name of ['member', 'removed', 'outsider']) {
        const rejected = await app.request('/api/v1/tokens', {
          method: 'POST', headers: { Cookie: cookies.get(name)!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Rejected', scopes: ['cards:read'], projectId: 'pat_project_a' }),
        });
        assert.equal(rejected.status, 404, name);
      }
      const viewer = await mint('viewer', allScopes);
      assert.equal((await request('/api/v1/boards/pat_board_a/metadata', viewer.token)).status, 200);
      const deniedWrite = await request('/api/v1/boards/pat_board_a/cards', viewer.token, 'POST', {
        title: 'Viewer unauthorized', columnId: 'pat_column_a', expectedBoardVersion: 1,
      });
      assert.equal(deniedWrite.status, 403);
    });

    await t.test('expired/revoked tokens fail without cookie fallback and cannot manage peers', async () => {
      const temporary = await mint('owner', ['projects:read']);
      await pool.query(`UPDATE personal_access_tokens SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [temporary.tokenDetails.id]);
      assert.equal((await request('/api/v1/projects', temporary.token)).status, 401);
      for (const method of ['GET', 'POST', 'DELETE']) {
        const path = method === 'DELETE' ? `/api/v1/tokens/${projects.tokenDetails.id}` : '/api/v1/tokens';
        assert.equal((await request(path, full.token, method, method === 'POST' ? {} : undefined)).status, 403);
      }
      const revoked = await app.request(`/api/v1/tokens/${temporary.tokenDetails.id}`, { method: 'DELETE', headers: { Cookie: cookies.get('owner')! } });
      assert.equal(revoked.status, 200);
      assert.equal((await request('/api/v1/projects', temporary.token)).status, 401);
    });

    await t.test('parallel issuance cannot exceed the active credential cap; expired/revoked slots free capacity', async () => {
      const responses = await Promise.all(Array.from({ length: MAX_ACTIVE_PERSONAL_ACCESS_TOKENS + 3 }, () => app.request('/api/v1/tokens', {
        method: 'POST', headers: { Cookie: cookies.get('owner')!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Concurrent cap probe', scopes: ['projects:read'], projectId: 'pat_project_a' }),
      })));
      assert.ok(responses.some((response) => response.status === 409));
      assert.ok(responses.every((response) => [201, 409].includes(response.status)), 'only create/cap outcomes');
      const count = await pool.query(`SELECT count(*)::int AS n FROM personal_access_tokens
        WHERE user_id='pat_owner' AND revoked_at IS NULL AND expires_at>NOW()`);
      assert.equal(count.rows[0].n, MAX_ACTIVE_PERSONAL_ACCESS_TOKENS);
      const listed = await app.request('/api/v1/tokens', { headers: { Cookie: cookies.get('owner')! } });
      assert.equal((await listed.json()).data.length, MAX_ACTIVE_PERSONAL_ACCESS_TOKENS);
      await pool.query(`UPDATE personal_access_tokens SET revoked_at=NOW() WHERE id=$1`, [projects.tokenDetails.id]);
      const replacement = await createPersonalAccessToken(pool, { userId: 'pat_owner', name: 'Replacement', scopes: ['projects:read'], projectId: 'pat_project_a' });
      assert.ok(replacement.tokenDetails.id);
    });
  } finally {
    await closePool();
  }
});
