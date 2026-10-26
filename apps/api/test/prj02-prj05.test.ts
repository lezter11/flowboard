import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import {
  projectListResponseSchema,
  projectDirectoryResponseSchema,
  projectSchema,
} from '@flowboard/contracts';

test('PRJ-02, PRJ-03 & PRJ-05: Project Navigation, Settings & People Directory Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const aliceUserId = 'usr_alice_owner_prj';
  const bobUserId = 'usr_bob_pm_prj';
  const charlieUserId = 'usr_charlie_member_prj';
  const dianaUserId = 'usr_diana_viewer_prj';
  const eveUserId = 'usr_eve_sibling_prj';
  const frankUserId = 'usr_frank_outsider_prj';

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';
  let dianaCookie = '';
  let eveCookie = '';
  let frankCookie = '';

  const workspace1Id = 'ws_main_prj02_05';
  const workspace2Id = 'ws_second_prj02_05';

  const projectAlphaId = 'prj_alpha_02_05';
  const projectBetaId = 'prj_beta_02_05';
  const projectGammaId = 'prj_gamma_02_05';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        'TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships CASCADE;',
      );

      // Seed Users
      const users = [
        { id: aliceUserId, email: 'alice@flowboard.example', name: 'Alice Owner' },
        { id: bobUserId, email: 'bob@flowboard.example', name: 'Bob Manager' },
        { id: charlieUserId, email: 'charlie@flowboard.example', name: 'Charlie Member' },
        { id: dianaUserId, email: 'diana@flowboard.example', name: 'Diana Viewer' },
        { id: eveUserId, email: 'eve@flowboard.example', name: 'Eve Sibling' },
        { id: frankUserId, email: 'frank@flowboard.example', name: 'Frank Outsider' },
      ];

      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [u.id, u.email, u.name, null],
        );
      }

      // Create Sessions
      const sAlice = await createSession(aliceUserId, 24, client);
      aliceCookie = `flowboard_session=${sAlice.id}`;

      const sBob = await createSession(bobUserId, 24, client);
      bobCookie = `flowboard_session=${sBob.id}`;

      const sCharlie = await createSession(charlieUserId, 24, client);
      charlieCookie = `flowboard_session=${sCharlie.id}`;

      const sDiana = await createSession(dianaUserId, 24, client);
      dianaCookie = `flowboard_session=${sDiana.id}`;

      const sEve = await createSession(eveUserId, 24, client);
      eveCookie = `flowboard_session=${sEve.id}`;

      const sFrank = await createSession(frankUserId, 24, client);
      frankCookie = `flowboard_session=${sFrank.id}`;

      // Create Workspaces (Alice owns both)
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())`,
        [workspace1Id, 'Primary Workspace', 'UTC', aliceUserId],
      );

      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())`,
        [workspace2Id, 'Secondary Workspace', 'UTC', aliceUserId],
      );

      // Create Projects
      // Alpha & Beta in Workspace 1
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, 1, NOW(), NOW())`,
        [projectAlphaId, workspace1Id, 'Project Alpha', 'Engineering primary project'],
      );

      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, 1, NOW(), NOW())`,
        [projectBetaId, workspace1Id, 'Project Beta', 'Engineering sibling project'],
      );

      // Gamma in Workspace 2
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, 1, NOW(), NOW())`,
        [projectGammaId, workspace2Id, 'Project Gamma', 'Design cross-workspace project'],
      );

      // Seed Project Memberships:
      // Project Alpha: Bob (manager), Charlie (member), Diana (viewer).
      // Note: Alice is NOT inserted here to verify she is included automatically via workspace ownership.
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manager', 'active', 1, NOW(), NOW())`,
        ['pm_bob_alpha', projectAlphaId, workspace1Id, bobUserId],
      );

      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'member', 'active', 1, NOW(), NOW())`,
        ['pm_charlie_alpha', projectAlphaId, workspace1Id, charlieUserId],
      );

      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'viewer', 'active', 1, NOW(), NOW())`,
        ['pm_diana_alpha', projectAlphaId, workspace1Id, dianaUserId],
      );

      // Project Beta: Eve (manager)
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manager', 'active', 1, NOW(), NOW())`,
        ['pm_eve_beta', projectBetaId, workspace1Id, eveUserId],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  // =========================================================================
  // PRJ-02: Project list and navigation
  // =========================================================================

  await t.test('PRJ-02.1: Workspace Owner sees all projects in workspace, paginated', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspace1Id}/projects`, {
      headers: { Cookie: aliceCookie },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const parsed = projectListResponseSchema.parse(body);

    assert.equal(parsed.data.length, 2);
    const names = parsed.data.map((p) => p.name).sort();
    assert.deepEqual(names, ['Project Alpha', 'Project Beta']);
    assert.equal(parsed.nextCursor, null);
  });

  await t.test('PRJ-02.2: Cursor pagination for workspace projects', async () => {
    // Request page size of 1
    const resPage1 = await app.request(`/api/v1/workspaces/${workspace1Id}/projects?limit=1`, {
      headers: { Cookie: aliceCookie },
    });

    assert.equal(resPage1.status, 200);
    const body1 = await resPage1.json();
    const parsed1 = projectListResponseSchema.parse(body1);

    assert.equal(parsed1.data.length, 1);
    assert.equal(parsed1.data[0]?.name, 'Project Alpha');
    assert.ok(parsed1.nextCursor !== null, 'nextCursor must be present for paginated results');

    // Fetch page 2 using nextCursor
    const resPage2 = await app.request(
      `/api/v1/workspaces/${workspace1Id}/projects?limit=1&cursor=${encodeURIComponent(parsed1.nextCursor!)}`,
      {
        headers: { Cookie: aliceCookie },
      },
    );

    assert.equal(resPage2.status, 200);
    const body2 = await resPage2.json();
    const parsed2 = projectListResponseSchema.parse(body2);

    assert.equal(parsed2.data.length, 1);
    assert.equal(parsed2.data[0]?.name, 'Project Beta');
    assert.equal(parsed2.nextCursor, null);
  });

  await t.test('PRJ-02.3: Project Manager / Member sees only granted projects; sibling projects are hidden', async () => {
    // Bob is manager in Alpha only
    const bobRes = await app.request(`/api/v1/workspaces/${workspace1Id}/projects`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(bobRes.status, 200);
    const bobBody = await bobRes.json();
    const bobParsed = projectListResponseSchema.parse(bobBody);

    assert.equal(bobParsed.data.length, 1);
    assert.equal(bobParsed.data[0]?.id, projectAlphaId);
    assert.equal(bobParsed.data[0]?.name, 'Project Alpha');

    // Charlie is member in Alpha only
    const charlieRes = await app.request(`/api/v1/workspaces/${workspace1Id}/projects`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(charlieRes.status, 200);
    const charlieBody = await charlieRes.json();
    const charlieParsed = projectListResponseSchema.parse(charlieBody);

    assert.equal(charlieParsed.data.length, 1);
    assert.equal(charlieParsed.data[0]?.id, projectAlphaId);

    // Eve is manager in Beta only
    const eveRes = await app.request(`/api/v1/workspaces/${workspace1Id}/projects`, {
      headers: { Cookie: eveCookie },
    });
    assert.equal(eveRes.status, 200);
    const eveBody = await eveRes.json();
    const eveParsed = projectListResponseSchema.parse(eveBody);

    assert.equal(eveParsed.data.length, 1);
    assert.equal(eveParsed.data[0]?.id, projectBetaId);
    assert.equal(eveParsed.data[0]?.name, 'Project Beta');
  });

  await t.test('PRJ-02.4: Outsider querying workspace projects gets 404 NOT_FOUND (sibling privacy)', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspace1Id}/projects`, {
      headers: { Cookie: frankCookie },
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  await t.test('PRJ-02.5: GET /api/v1/projects lists accessible projects across all workspaces for current session', async () => {
    // Alice owns Workspace 1 (Alpha, Beta) and Workspace 2 (Gamma)
    const aliceRes = await app.request('/api/v1/projects', {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(aliceRes.status, 200);
    const aliceBody = await aliceRes.json();
    const aliceParsed = projectListResponseSchema.parse(aliceBody);

    assert.equal(aliceParsed.data.length, 3);
    const names = aliceParsed.data.map((p) => p.name).sort();
    assert.deepEqual(names, ['Project Alpha', 'Project Beta', 'Project Gamma']);

    // Bob only has access to Project Alpha
    const bobRes = await app.request('/api/v1/projects', {
      headers: { Cookie: bobCookie },
    });
    assert.equal(bobRes.status, 200);
    const bobBody = await bobRes.json();
    const bobParsed = projectListResponseSchema.parse(bobBody);

    assert.equal(bobParsed.data.length, 1);
    assert.equal(bobParsed.data[0]?.id, projectAlphaId);

    // Frank (outsider) has no accessible projects -> returns empty list 200 OK
    const frankRes = await app.request('/api/v1/projects', {
      headers: { Cookie: frankCookie },
    });
    assert.equal(frankRes.status, 200);
    const frankBody = await frankRes.json();
    const frankParsed = projectListResponseSchema.parse(frankBody);

    assert.equal(frankParsed.data.length, 0);
    assert.equal(frankParsed.nextCursor, null);
  });

  // =========================================================================
  // PRJ-03: Project settings
  // =========================================================================

  let currentAlphaVersion = 1;

  await t.test('PRJ-03.1: Workspace Owner updates project name and description with OCC', async () => {
    const res = await app.request(`/api/v1/projects/${projectAlphaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({
        name: 'Project Alpha Renamed',
        description: 'Updated by owner',
        expectedVersion: currentAlphaVersion,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const project = projectSchema.parse(body.data);

    assert.equal(project.name, 'Project Alpha Renamed');
    assert.equal(project.description, 'Updated by owner');
    assert.equal(project.version, currentAlphaVersion + 1);

    currentAlphaVersion = project.version;

    // Verify database row
    const client = await pool.connect();
    try {
      const q = await client.query('SELECT name, description, version FROM projects WHERE id = $1', [
        projectAlphaId,
      ]);
      assert.equal(q.rows[0].name, 'Project Alpha Renamed');
      assert.equal(q.rows[0].version, currentAlphaVersion);
    } finally {
      client.release();
    }
  });

  await t.test('PRJ-03.2: Project Manager updates project description with OCC', async () => {
    const res = await app.request(`/api/v1/projects/${projectAlphaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        description: 'Updated by project manager Bob',
        expectedVersion: currentAlphaVersion,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const project = projectSchema.parse(body.data);

    assert.equal(project.name, 'Project Alpha Renamed'); // Unchanged
    assert.equal(project.description, 'Updated by project manager Bob');
    assert.equal(project.version, currentAlphaVersion + 1);

    currentAlphaVersion = project.version;
  });

  await t.test('PRJ-03.3: Member & Viewer cannot update project settings -> 403 FORBIDDEN', async () => {
    // Charlie (member)
    const charlieRes = await app.request(`/api/v1/projects/${projectAlphaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({
        name: 'Hacked by Member',
        expectedVersion: currentAlphaVersion,
      }),
    });

    assert.equal(charlieRes.status, 403);
    const charlieBody = await charlieRes.json();
    assert.equal(charlieBody.error.code, 'FORBIDDEN');

    // Diana (viewer)
    const dianaRes = await app.request(`/api/v1/projects/${projectAlphaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: dianaCookie,
      },
      body: JSON.stringify({
        name: 'Hacked by Viewer',
        expectedVersion: currentAlphaVersion,
      }),
    });

    assert.equal(dianaRes.status, 403);
    const dianaBody = await dianaRes.json();
    assert.equal(dianaBody.error.code, 'FORBIDDEN');
  });

  await t.test('PRJ-03.4: Sibling PM & Outsider get 404 NOT_FOUND on project settings', async () => {
    // Eve is PM in Beta, but outsider to Alpha
    const eveRes = await app.request(`/api/v1/projects/${projectAlphaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: eveCookie,
      },
      body: JSON.stringify({
        name: 'Sibling Attempt',
        expectedVersion: currentAlphaVersion,
      }),
    });

    assert.equal(eveRes.status, 404);
    const eveBody = await eveRes.json();
    assert.equal(eveBody.error.code, 'NOT_FOUND');

    // Frank is an outsider
    const frankRes = await app.request(`/api/v1/projects/${projectAlphaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: frankCookie,
      },
      body: JSON.stringify({
        name: 'Outsider Attempt',
        expectedVersion: currentAlphaVersion,
      }),
    });

    assert.equal(frankRes.status, 404);
    const frankBody = await frankRes.json();
    assert.equal(frankBody.error.code, 'NOT_FOUND');
  });

  await t.test('PRJ-03.5: Stale expectedVersion rejected with 409 STALE_VERSION', async () => {
    const res = await app.request(`/api/v1/projects/${projectAlphaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        name: 'Stale update',
        expectedVersion: currentAlphaVersion - 1, // Stale version
      }),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'STALE_VERSION');
    assert.match(body.error.message, /Stale project version/);
  });

  // =========================================================================
  // PRJ-05: Project people directory
  // =========================================================================

  await t.test('PRJ-05.1: Owner sees project members directory including workspace owner and active members', async () => {
    const res = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: aliceCookie },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const parsed = projectDirectoryResponseSchema.parse(body);

    assert.equal(parsed.data.length, 4);

    // Verify Workspace Owner (Alice) is included with role 'owner'
    const aliceMember = parsed.data.find((m) => m.id === aliceUserId);
    assert.ok(aliceMember, 'Alice must be present in directory');
    assert.equal(aliceMember.name, 'Alice Owner');
    assert.equal(aliceMember.email, 'alice@flowboard.example');
    assert.equal(aliceMember.role, 'owner');
    assert.equal(aliceMember.status, 'active');

    // Verify Bob (manager)
    const bobMember = parsed.data.find((m) => m.id === bobUserId);
    assert.ok(bobMember, 'Bob must be present in directory');
    assert.equal(bobMember.name, 'Bob Manager');
    assert.equal(bobMember.role, 'manager');
    assert.equal(bobMember.status, 'active');

    // Verify Charlie (member)
    const charlieMember = parsed.data.find((m) => m.id === charlieUserId);
    assert.ok(charlieMember, 'Charlie must be present in directory');
    assert.equal(charlieMember.name, 'Charlie Member');
    assert.equal(charlieMember.role, 'member');

    // Verify Diana (viewer)
    const dianaMember = parsed.data.find((m) => m.id === dianaUserId);
    assert.ok(dianaMember, 'Diana must be present in directory');
    assert.equal(dianaMember.name, 'Diana Viewer');
    assert.equal(dianaMember.role, 'viewer');

    // Sibling privacy check: Eve (from Project Beta) is NEVER in Alpha's directory!
    const eveMember = parsed.data.find((m) => m.id === eveUserId);
    assert.equal(eveMember, undefined, 'Sibling project member Eve must NOT be returned');
  });

  await t.test('PRJ-05.2: Project Manager, Member, and Viewer can all view the project directory', async () => {
    // Bob (PM)
    const bobRes = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(bobRes.status, 200);
    const bobBody = await bobRes.json();
    assert.equal(bobBody.data.length, 4);

    // Charlie (Member)
    const charlieRes = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(charlieRes.status, 200);
    const charlieBody = await charlieRes.json();
    assert.equal(charlieBody.data.length, 4);

    // Diana (Viewer)
    const dianaRes = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: dianaCookie },
    });
    assert.equal(dianaRes.status, 200);
    const dianaBody = await dianaRes.json();
    assert.equal(dianaBody.data.length, 4);
  });

  await t.test('PRJ-05.3: Sibling project member & outsider get 404 NOT_FOUND on members directory', async () => {
    // Eve (member of Beta, not Alpha)
    const eveRes = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: eveCookie },
    });
    assert.equal(eveRes.status, 404);
    const eveBody = await eveRes.json();
    assert.equal(eveBody.error.code, 'NOT_FOUND');

    // Frank (outsider)
    const frankRes = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: frankCookie },
    });
    assert.equal(frankRes.status, 404);
    const frankBody = await frankRes.json();
    assert.equal(frankBody.error.code, 'NOT_FOUND');
  });

  await t.test('PRJ-05.4: Removed project member is excluded from directory and cannot access it', async () => {
    // Soft remove Charlie from Project Alpha
    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE project_memberships SET status = 'removed', version = version + 1 WHERE id = 'pm_charlie_alpha'",
      );
    } finally {
      client.release();
    }

    // Alice queries directory: Charlie is no longer present
    const aliceRes = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(aliceRes.status, 200);
    const aliceBody = await aliceRes.json();
    assert.equal(aliceBody.data.length, 3);
    const charlieFound = aliceBody.data.find((m: any) => m.id === charlieUserId);
    assert.equal(charlieFound, undefined, 'Removed member Charlie must not be returned');

    // Charlie's subsequent request to view directory returns 404 NOT_FOUND
    const charlieRes = await app.request(`/api/v1/projects/${projectAlphaId}/members`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(charlieRes.status, 404);
  });
});
