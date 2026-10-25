import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession, createSession } from '../src/adapters/session.ts';
import { resolveWorkspaceRole, resolveProjectRole } from '../src/adapters/rbac.ts';
import { authMiddleware } from '../src/http/middleware/auth.ts';
import { requireWorkspaceRole, requireProjectRole } from '../src/http/middleware/rbac.ts';

test('RBAC-01: Owner/Manager/Member/Viewer Matrix & Sibling Privacy Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  // Test routes to verify HTTP middleware behavior
  app.get(
    '/api/v1/workspaces/:wid/admin',
    authMiddleware,
    requireWorkspaceRole('owner'),
    (c) => c.json({ data: { role: c.get('workspaceRole') } }),
  );
  app.post(
    '/api/v1/projects/:pid/manage',
    authMiddleware,
    requireProjectRole('manager'),
    (c) => c.json({ data: { role: c.get('projectRole') } }),
  );
  app.post(
    '/api/v1/projects/:pid/write',
    authMiddleware,
    requireProjectRole('member'),
    (c) => c.json({ data: { role: c.get('projectRole') } }),
  );
  app.get(
    '/api/v1/projects/:pid/read',
    authMiddleware,
    requireProjectRole('viewer'),
    (c) => c.json({ data: { role: c.get('projectRole') } }),
  );

  let ownerCookie = '';
  let managerCookie = '';
  let memberCookie = '';
  let viewerCookie = '';
  let strangerCookie = '';

  let ownerUserId = '';
  let managerUserId = '';
  let memberUserId = '';
  let viewerUserId = '';
  let strangerUserId = '';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE workspaces, users, sessions CASCADE;');

      // 1. Create users & sessions
      const owner = await createDevUserAndSession('owner@flowboard.example', 'Alice Owner', pool);
      ownerCookie = `flowboard_session=${owner.session.id}`;
      ownerUserId = owner.user.id;

      const manager = await createDevUserAndSession('manager@flowboard.example', 'Bob Manager', pool);
      managerCookie = `flowboard_session=${manager.session.id}`;
      managerUserId = manager.user.id;

      const member = await createDevUserAndSession('member@flowboard.example', 'Charlie Member', pool);
      memberCookie = `flowboard_session=${member.session.id}`;
      memberUserId = member.user.id;

      const viewer = await createDevUserAndSession('viewer@flowboard.example', 'Diana Viewer', pool);
      viewerCookie = `flowboard_session=${viewer.session.id}`;
      viewerUserId = viewer.user.id;

      const stranger = await createDevUserAndSession('stranger@flowboard.example', 'Eve Stranger', pool);
      strangerCookie = `flowboard_session=${stranger.session.id}`;
      strangerUserId = stranger.user.id;

      const now = new Date().toISOString();

      // 2. Create workspace owned by Alice
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['ws_rbac', 'RBAC Workspace', 'UTC', ownerUserId, 1, now, now],
      );

      // 3. Create Project 1 and Project 2 (sibling) under ws_rbac
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8),
                ($9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          'prj_main', 'ws_rbac', 'Main Project', 'Project 1', false, 1, now, now,
          'prj_sibling', 'ws_rbac', 'Sibling Secret Project', 'Project 2', false, 1, now, now,
        ],
      );

      // 4. Create memberships in Project 1 (prj_main):
      //    Bob = manager, Charlie = member, Diana = viewer
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9),
                ($10, $11, $12, $13, $14, $15, $16, $17, $18),
                ($19, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [
          'pm_mgr', 'prj_main', 'ws_rbac', managerUserId, 'manager', 'active', 1, now, now,
          'pm_mem', 'prj_main', 'ws_rbac', memberUserId, 'member', 'active', 1, now, now,
          'pm_view', 'prj_main', 'ws_rbac', viewerUserId, 'viewer', 'active', 1, now, now,
        ],
      );

      // 5. Create membership in Project 2 (prj_sibling):
      //    Eve = manager
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        ['pm_stranger', 'prj_sibling', 'ws_rbac', strangerUserId, 'manager', 'active', 1, now, now],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  await t.test('1. Workspace Owner role resolution and workspace inheritance', async () => {
    // Direct adapter checks
    const wsRoleOwner = await resolveWorkspaceRole('ws_rbac', ownerUserId, pool);
    assert.equal(wsRoleOwner, 'owner');

    const wsRoleNonOwner = await resolveWorkspaceRole('ws_rbac', managerUserId, pool);
    assert.equal(wsRoleNonOwner, null);

    // Workspace owner inherits 'owner' role across all projects in their workspace
    const prj1OwnerRole = await resolveProjectRole('prj_main', ownerUserId, pool);
    assert.equal(prj1OwnerRole, 'owner');

    const prj2OwnerRole = await resolveProjectRole('prj_sibling', ownerUserId, pool);
    assert.equal(prj2OwnerRole, 'owner');

    // HTTP check: owner can access workspace admin
    const wsAdminRes = await app.request('/api/v1/workspaces/ws_rbac/admin', {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(wsAdminRes.status, 200);
    const wsAdminBody = await wsAdminRes.json();
    assert.equal(wsAdminBody.data.role, 'owner');

    // HTTP check: non-owner accessing workspace admin gets 404 NOT_FOUND (privacy)
    const wsAdminMgrRes = await app.request('/api/v1/workspaces/ws_rbac/admin', {
      headers: { Cookie: managerCookie },
    });
    assert.equal(wsAdminMgrRes.status, 404);
  });

  await t.test('2. Project Manager permissions in granted project', async () => {
    // Adapter check
    const mgrRole = await resolveProjectRole('prj_main', managerUserId, pool);
    assert.equal(mgrRole, 'manager');

    // Manager can perform manager actions
    const manageRes = await app.request('/api/v1/projects/prj_main/manage', {
      method: 'POST',
      headers: { Cookie: managerCookie },
    });
    assert.equal(manageRes.status, 200);
    assert.equal((await manageRes.json()).data.role, 'manager');

    // Manager can perform member actions
    const writeRes = await app.request('/api/v1/projects/prj_main/write', {
      method: 'POST',
      headers: { Cookie: managerCookie },
    });
    assert.equal(writeRes.status, 200);

    // Manager can perform viewer actions
    const readRes = await app.request('/api/v1/projects/prj_main/read', {
      headers: { Cookie: managerCookie },
    });
    assert.equal(readRes.status, 200);
  });

  await t.test('3. Project Member can write and read, but blocked (403 FORBIDDEN) from manager actions', async () => {
    // Adapter check
    const memRole = await resolveProjectRole('prj_main', memberUserId, pool);
    assert.equal(memRole, 'member');

    // Member attempting manager action receives 403 FORBIDDEN
    const manageRes = await app.request('/api/v1/projects/prj_main/manage', {
      method: 'POST',
      headers: { Cookie: memberCookie },
    });
    assert.equal(manageRes.status, 403);
    const manageBody = await manageRes.json();
    assert.equal(manageBody.error.code, 'FORBIDDEN');

    // Member can perform member write action
    const writeRes = await app.request('/api/v1/projects/prj_main/write', {
      method: 'POST',
      headers: { Cookie: memberCookie },
    });
    assert.equal(writeRes.status, 200);
    assert.equal((await writeRes.json()).data.role, 'member');

    // Member can perform viewer read action
    const readRes = await app.request('/api/v1/projects/prj_main/read', {
      headers: { Cookie: memberCookie },
    });
    assert.equal(readRes.status, 200);
  });

  await t.test('4. Project Viewer can read, but blocked (403 FORBIDDEN) from member and manager actions', async () => {
    // Adapter check
    const viewRole = await resolveProjectRole('prj_main', viewerUserId, pool);
    assert.equal(viewRole, 'viewer');

    // Viewer attempting manager action receives 403 FORBIDDEN
    const manageRes = await app.request('/api/v1/projects/prj_main/manage', {
      method: 'POST',
      headers: { Cookie: viewerCookie },
    });
    assert.equal(manageRes.status, 403);
    assert.equal((await manageRes.json()).error.code, 'FORBIDDEN');

    // Viewer attempting member write action receives 403 FORBIDDEN
    const writeRes = await app.request('/api/v1/projects/prj_main/write', {
      method: 'POST',
      headers: { Cookie: viewerCookie },
    });
    assert.equal(writeRes.status, 403);
    assert.equal((await writeRes.json()).error.code, 'FORBIDDEN');

    // Viewer can read
    const readRes = await app.request('/api/v1/projects/prj_main/read', {
      headers: { Cookie: viewerCookie },
    });
    assert.equal(readRes.status, 200);
    assert.equal((await readRes.json()).data.role, 'viewer');
  });

  await t.test('5. Sibling Project Privacy: user granted in Project 1 querying Project 2 gets 404 NOT_FOUND', async () => {
    // Bob is manager in Project 1 (prj_main), but has no grant in Project 2 (prj_sibling)
    const bobPrj2Role = await resolveProjectRole('prj_sibling', managerUserId, pool);
    assert.equal(bobPrj2Role, null);

    // Bob trying to read, write, or manage Project 2 must get 404 NOT_FOUND (never 403)
    // This strictly prevents metadata leakage: Bob cannot tell whether prj_sibling exists
    const manageRes = await app.request('/api/v1/projects/prj_sibling/manage', {
      method: 'POST',
      headers: { Cookie: managerCookie },
    });
    assert.equal(manageRes.status, 404);
    assert.equal((await manageRes.json()).error.code, 'NOT_FOUND');

    const writeRes = await app.request('/api/v1/projects/prj_sibling/write', {
      method: 'POST',
      headers: { Cookie: managerCookie },
    });
    assert.equal(writeRes.status, 404);
    assert.equal((await writeRes.json()).error.code, 'NOT_FOUND');

    const readRes = await app.request('/api/v1/projects/prj_sibling/read', {
      headers: { Cookie: managerCookie },
    });
    assert.equal(readRes.status, 404);
    assert.equal((await readRes.json()).error.code, 'NOT_FOUND');

    // Eve (granted only in prj_sibling) querying prj_main gets 404 NOT_FOUND
    const eveReadPrj1 = await app.request('/api/v1/projects/prj_main/read', {
      headers: { Cookie: strangerCookie },
    });
    assert.equal(eveReadPrj1.status, 404);
    assert.equal((await eveReadPrj1.json()).error.code, 'NOT_FOUND');
  });

  await t.test('6. Inactive / removed membership drops permissions immediately and returns 404 NOT_FOUND', async () => {
    const client = await pool.connect();
    try {
      // Mark Diana's membership as 'removed'
      await client.query(
        "UPDATE project_memberships SET status = 'removed' WHERE id = 'pm_view'",
      );
    } finally {
      client.release();
    }

    // Role resolution is immediately null
    const roleAfterRemoval = await resolveProjectRole('prj_main', viewerUserId, pool);
    assert.equal(roleAfterRemoval, null);

    // Diana's read attempt returns 404 NOT_FOUND
    const readRes = await app.request('/api/v1/projects/prj_main/read', {
      headers: { Cookie: viewerCookie },
    });
    assert.equal(readRes.status, 404);
    assert.equal((await readRes.json()).error.code, 'NOT_FOUND');
  });
});
