import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import {
  verifyProjectAncestry,
  acquireWriteGrantLock,
  getEligibleAssignees,
  getEligibleMentionees,
  getHistoricalPersonDisplay,
  getProjectPeople,
  getProjectAccessSummary,
} from '../src/adapters/rbac.ts';
import { authMiddleware } from '../src/http/middleware/auth.ts';
import { requireProjectAncestry } from '../src/http/middleware/rbac.ts';
import type { PersonDisplay, ProjectAccessSummary } from '@flowboard/contracts';

test('RBAC Advanced Suite (RBAC-02, RBAC-03, RBAC-04, RBAC-05)', async (t) => {
  const pool = getPool();
  const app = createApp();

  // Test route for RBAC-02 middleware verification
  app.get(
    '/api/v1/workspaces/:wid/projects/:pid/cards/:cid/verify',
    authMiddleware,
    requireProjectAncestry('card', 'cid'),
    (c) => c.json({ data: { verified: true } }),
  );

  let ownerCookie = '';
  let managerCookie = '';
  let memberCookie = '';
  let viewerCookie = '';
  let siblingManagerCookie = '';
  let strangerCookie = '';

  let ownerUserId = '';
  let managerUserId = '';
  let memberUserId = '';
  let viewerUserId = '';
  let removedUserId = '';
  let siblingManagerUserId = '';
  let siblingMemberUserId = '';
  let strangerUserId = '';

  const wsMainId = 'ws_main_adv';
  const wsOtherId = 'ws_other_adv';
  const prjMainId = 'prj_main_adv';
  const prjSiblingId = 'prj_sibling_adv';
  const prjOtherId = 'prj_other_adv';

  const brdMainId = 'brd_main_01';
  const brdSiblingId = 'brd_sibling_01';
  const brdOtherId = 'brd_other_01';

  const colMainId = 'col_main_01';
  const colSiblingId = 'col_sibling_01';

  const cardMainId = 'card_main_01';
  const cardSiblingId = 'card_sibling_01';

  const commentMainId = 'cmt_main_01';
  const importMainId = 'imp_main_01';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE workspaces, users, sessions CASCADE;');

      // 1. Create users
      const owner = await createDevUserAndSession('alice.owner@flowboard.example', 'Alice Owner', pool);
      ownerCookie = `flowboard_session=${owner.session.id}`;
      ownerUserId = owner.user.id;

      const manager = await createDevUserAndSession('bob.manager@flowboard.example', 'Bob Manager', pool);
      managerCookie = `flowboard_session=${manager.session.id}`;
      managerUserId = manager.user.id;

      const member = await createDevUserAndSession('charlie.member@flowboard.example', 'Charlie Member', pool);
      memberCookie = `flowboard_session=${member.session.id}`;
      memberUserId = member.user.id;

      const viewer = await createDevUserAndSession('diana.viewer@flowboard.example', 'Diana Viewer', pool);
      viewerCookie = `flowboard_session=${viewer.session.id}`;
      viewerUserId = viewer.user.id;

      const removed = await createDevUserAndSession('zack.removed@flowboard.example', 'Zack Removed', pool);
      removedUserId = removed.user.id;

      const siblingManager = await createDevUserAndSession('sam.sibling@flowboard.example', 'Sam Sibling', pool);
      siblingManagerCookie = `flowboard_session=${siblingManager.session.id}`;
      siblingManagerUserId = siblingManager.user.id;

      const siblingMember = await createDevUserAndSession('sally.sibling@flowboard.example', 'Sally Sibling', pool);
      siblingMemberUserId = siblingMember.user.id;

      const stranger = await createDevUserAndSession('eve.stranger@flowboard.example', 'Eve Stranger', pool);
      strangerCookie = `flowboard_session=${stranger.session.id}`;
      strangerUserId = stranger.user.id;

      const now = new Date().toISOString();

      // 2. Insert workspaces
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5),
                ($6, $7, $8, $9, 1, $5, $5)`,
        [
          wsMainId, 'Main Workspace', 'UTC', ownerUserId, now,
          wsOtherId, 'Other Workspace', 'UTC', strangerUserId,
        ],
      );

      // 3. Insert projects
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, 1, $5, $5),
                ($6, $7, $8, $9, FALSE, 1, $10, $10),
                ($11, $12, $13, $14, FALSE, 1, $15, $15)`,
        [
          prjMainId, wsMainId, 'Alpha Project', 'Main project', now,
          prjSiblingId, wsMainId, 'Beta Project', 'Sibling project', now,
          prjOtherId, wsOtherId, 'Gamma Project', 'Other workspace project', now,
        ],
      );

      // 4. Insert memberships in prjMainId
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manager', 'active', 1, $5, $5),
                ($6, $2, $3, $7, 'member', 'active', 1, $5, $5),
                ($8, $2, $3, $9, 'viewer', 'active', 1, $5, $5),
                ($10, $2, $3, $11, 'member', 'removed', 1, $5, $5)`,
        [
          'pm_bob', prjMainId, wsMainId, managerUserId, now,
          'pm_charlie', memberUserId,
          'pm_diana', viewerUserId,
          'pm_zack', removedUserId,
        ],
      );

      // 5. Insert memberships in prjSiblingId
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manager', 'active', 1, $5, $5),
                ($6, $2, $3, $7, 'member', 'active', 1, $5, $5)`,
        [
          'pm_sam', prjSiblingId, wsMainId, siblingManagerUserId, now,
          'pm_sally', siblingMemberUserId,
        ],
      );

      // 6. Insert boards
      await client.query(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
         VALUES ($1, $2, $3, 'Main Board', 1, 1, FALSE, $4, $4),
                ($5, $2, $6, 'Sibling Board', 1, 1, FALSE, $4, $4),
                ($7, $8, $9, 'Other Board', 1, 1, FALSE, $4, $4)`,
        [
          brdMainId, wsMainId, prjMainId, now,
          brdSiblingId, prjSiblingId,
          brdOtherId, wsOtherId, prjOtherId,
        ],
      );

      // 7. Insert columns
      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'To Do', '#000000', 'todo', 1000, 1, $5, $5),
                ($6, $2, $7, $8, 'Sibling To Do', '#000000', 'todo', 1000, 1, $5, $5)`,
        [
          colMainId, wsMainId, prjMainId, brdMainId, now,
          colSiblingId, prjSiblingId, brdSiblingId,
        ],
      );

      // 8. Insert cards
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Main Card 1', 'medium', 1000, 1, 'active', $6, $6),
                ($7, $2, $8, $9, $10, 'Sibling Card 1', 'high', 1000, 1, 'active', $6, $6)`,
        [
          cardMainId, wsMainId, prjMainId, brdMainId, colMainId, now,
          cardSiblingId, prjSiblingId, brdSiblingId, colSiblingId,
        ],
      );

      // 9. Insert comments
      await client.query(
        `INSERT INTO comments (id, workspace_id, project_id, card_id, author_id, body, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Initial comment', 1, $6, $6)`,
        [commentMainId, wsMainId, prjMainId, cardMainId, memberUserId, now],
      );

      // 10. Insert card_imports
      await client.query(
        `INSERT INTO card_imports (id, workspace_id, project_id, board_id, default_column_id, uploader_id, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, 'ready', $7, $7)`,
        [importMainId, wsMainId, prjMainId, brdMainId, colMainId, managerUserId, now],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  // ==========================================================================
  // RBAC-02: Project Ancestry Enforcement Tests
  // ==========================================================================
  await t.test('RBAC-02: verifyProjectAncestry succeeds for valid project and resources', async () => {
    // Project alone
    const prjResult = await verifyProjectAncestry(pool, wsMainId, prjMainId);
    assert.equal(prjResult.projectId, prjMainId);
    assert.equal(prjResult.workspaceId, wsMainId);

    // Board resource
    const brdResult = await verifyProjectAncestry(pool, wsMainId, prjMainId, brdMainId);
    assert.equal(brdResult.resourceId, brdMainId);
    assert.equal(brdResult.resourceType, 'board');

    // Card resource
    const cardResult = await verifyProjectAncestry(pool, wsMainId, prjMainId, cardMainId);
    assert.equal(cardResult.resourceId, cardMainId);
    assert.equal(cardResult.resourceType, 'card');

    // Column resource
    const colResult = await verifyProjectAncestry(pool, wsMainId, prjMainId, colMainId);
    assert.equal(colResult.resourceId, colMainId);
    assert.equal(colResult.resourceType, 'column');

    // Comment resource
    const cmtResult = await verifyProjectAncestry(pool, wsMainId, prjMainId, commentMainId);
    assert.equal(cmtResult.resourceId, commentMainId);
    assert.equal(cmtResult.resourceType, 'comment');

    // Import resource
    const impResult = await verifyProjectAncestry(pool, wsMainId, prjMainId, importMainId);
    assert.equal(impResult.resourceId, importMainId);
    assert.equal(impResult.resourceType, 'import');
  });

  await t.test('RBAC-02: Guessing sibling project or resources returns consistent 404 NOT_FOUND without metadata leakage', async () => {
    // 1. Probing sibling project under wrong workspace
    await assert.rejects(
      async () => verifyProjectAncestry(pool, wsOtherId, prjMainId),
      (err: any) => {
        assert.equal(err.status, 404);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.message, 'Project not found.');
        return true;
      },
    );

    // 2. Probing sibling board from Beta Project while querying Alpha Project
    await assert.rejects(
      async () => verifyProjectAncestry(pool, wsMainId, prjMainId, brdSiblingId),
      (err: any) => {
        assert.equal(err.status, 404);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.message, 'Resource not found.');
        return true;
      },
    );

    // 3. Probing sibling card from Beta Project while querying Alpha Project
    await assert.rejects(
      async () => verifyProjectAncestry(pool, wsMainId, prjMainId, cardSiblingId),
      (err: any) => {
        assert.equal(err.status, 404);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.message, 'Resource not found.');
        return true;
      },
    );

    // 4. Probing board from another workspace entirely
    await assert.rejects(
      async () => verifyProjectAncestry(pool, wsMainId, prjMainId, brdOtherId),
      (err: any) => {
        assert.equal(err.status, 404);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.message, 'Resource not found.');
        return true;
      },
    );

    // 5. Completely nonexistent resource ID returns exact same 404
    await assert.rejects(
      async () => verifyProjectAncestry(pool, wsMainId, prjMainId, 'card_does_not_exist'),
      (err: any) => {
        assert.equal(err.status, 404);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.message, 'Resource not found.');
        return true;
      },
    );
  });

  await t.test('RBAC-02: requireProjectAncestry HTTP middleware enforces boundary', async () => {
    // Valid card under matching workspace and project -> 200
    const validRes = await app.request(
      `/api/v1/workspaces/${wsMainId}/projects/${prjMainId}/cards/${cardMainId}/verify`,
      {
        headers: { Cookie: memberCookie },
      },
    );
    assert.equal(validRes.status, 200);
    const validJson = await validRes.json();
    assert.equal(validJson.data.verified, true);

    // Sibling card probed under prjMainId -> 404 NOT_FOUND
    const siblingRes = await app.request(
      `/api/v1/workspaces/${wsMainId}/projects/${prjMainId}/cards/${cardSiblingId}/verify`,
      {
        headers: { Cookie: memberCookie },
      },
    );
    assert.equal(siblingRes.status, 404);
    const siblingJson = await siblingRes.json();
    assert.equal(siblingJson.error.code, 'NOT_FOUND');
  });

  // ==========================================================================
  // RBAC-03: Revocation Versus Writes Lock Protocol Tests
  // ==========================================================================
  await t.test('RBAC-03: acquireWriteGrantLock validates role hierarchy and removed status', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Workspace owner succeeds
      const ownerLock = await acquireWriteGrantLock(client, prjMainId, ownerUserId);
      assert.equal(ownerLock.role, 'owner');
      assert.equal(ownerLock.isOwner, true);

      // 2. Active manager succeeds
      const mgrLock = await acquireWriteGrantLock(client, prjMainId, managerUserId);
      assert.equal(mgrLock.role, 'manager');
      assert.equal(mgrLock.isOwner, false);

      // 3. Active member succeeds
      const memLock = await acquireWriteGrantLock(client, prjMainId, memberUserId);
      assert.equal(memLock.role, 'member');
      assert.equal(memLock.isOwner, false);

      // 4. Viewer is rejected with 403 FORBIDDEN
      await assert.rejects(
        async () => acquireWriteGrantLock(client, prjMainId, viewerUserId),
        (err: any) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, 'FORBIDDEN');
          assert.match(err.message, /Viewers cannot perform write operations/);
          return true;
        },
      );

      // 5. Removed member is rejected with 404 NOT_FOUND
      await assert.rejects(
        async () => acquireWriteGrantLock(client, prjMainId, removedUserId),
        (err: any) => {
          assert.equal(err.status, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );

      // 6. Sibling outsider is rejected with 404 NOT_FOUND
      await assert.rejects(
        async () => acquireWriteGrantLock(client, prjMainId, siblingManagerUserId),
        (err: any) => {
          assert.equal(err.status, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  await t.test('RBAC-03: Concurrency: In-flight write transaction aborts when concurrent role revocation wins', async () => {
    // We create a temporary test user in prjMainId
    const tempUser = await createDevUserAndSession('temp.writer@flowboard.example', 'Temp Writer', pool);
    const clientSetup = await pool.connect();
    try {
      await clientSetup.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_temp', $1, $2, $3, 'member', 'active', 1, NOW(), NOW())`,
        [prjMainId, wsMainId, tempUser.user.id],
      );
    } finally {
      clientSetup.release();
    }

    const clientWriter = await pool.connect();
    const clientRevoker = await pool.connect();

    try {
      // 1. Writer begins transaction
      await clientWriter.query('BEGIN');

      // 2. Revoker begins transaction and updates membership to 'removed'
      await clientRevoker.query('BEGIN');
      await clientRevoker.query(
        `UPDATE project_memberships SET status = 'removed', updated_at = NOW()
         WHERE project_id = $1 AND user_id = $2`,
        [prjMainId, tempUser.user.id],
      );

      // 3. Revoker commits revocation before writer acquires lock
      await clientRevoker.query('COMMIT');

      // 4. Writer attempts acquireWriteGrantLock -> must immediately detect status = 'removed' and abort
      await assert.rejects(
        async () => acquireWriteGrantLock(clientWriter, prjMainId, tempUser.user.id),
        (err: any) => {
          assert.equal(err.status, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );

      // Writer aborts transaction cleanly
      await clientWriter.query('ROLLBACK');
    } finally {
      clientWriter.release();
      clientRevoker.release();
    }
  });

  await t.test('RBAC-03: Concurrency: Writer holding grant lock blocks concurrent revocation until write commits', async () => {
    // Create another temporary active member
    const tempUser2 = await createDevUserAndSession('temp.writer2@flowboard.example', 'Temp Writer 2', pool);
    const clientSetup = await pool.connect();
    try {
      await clientSetup.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_temp2', $1, $2, $3, 'member', 'active', 1, NOW(), NOW())`,
        [prjMainId, wsMainId, tempUser2.user.id],
      );
    } finally {
      clientSetup.release();
    }

    const clientWriter = await pool.connect();
    const clientRevoker = await pool.connect();

    try {
      // 1. Writer begins transaction and acquires FOR SHARE lock
      await clientWriter.query('BEGIN');
      const grant = await acquireWriteGrantLock(clientWriter, prjMainId, tempUser2.user.id);
      assert.equal(grant.role, 'member');

      // 2. Revoker attempts UPDATE in background -> should be blocked by FOR SHARE lock
      let revokerFinished = false;
      await clientRevoker.query('BEGIN');
      const revocationPromise = clientRevoker
        .query(
          `UPDATE project_memberships SET status = 'removed', updated_at = NOW()
           WHERE project_id = $1 AND user_id = $2`,
          [prjMainId, tempUser2.user.id],
        )
        .then(() => {
          revokerFinished = true;
        });

      // Give revoker query a short pause to ensure it enters wait queue on row lock
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(revokerFinished, false, 'Revocation UPDATE should be blocked while writer holds SHARE lock');

      // 3. Writer completes write operation and COMMITS
      await clientWriter.query('COMMIT');

      // 4. Now revoker should unblock and complete
      await revocationPromise;
      assert.equal(revokerFinished, true, 'Revocation UPDATE should unblock and complete after writer commits');
      await clientRevoker.query('COMMIT');

      // 5. Subsequent grant lock attempt by revoked user immediately aborts
      const clientAfter = await pool.connect();
      try {
        await clientAfter.query('BEGIN');
        await assert.rejects(
          async () => acquireWriteGrantLock(clientAfter, prjMainId, tempUser2.user.id),
          (err: any) => {
            assert.equal(err.status, 404);
            return true;
          },
        );
        await clientAfter.query('ROLLBACK');
      } finally {
        clientAfter.release();
      }
    } finally {
      clientWriter.release();
      clientRevoker.release();
    }
  });

  await t.test('RBAC-03: Concurrency Probe 1: Mounted updateProjectSettings serializes with concurrent actor revocation', async () => {
    // 1. Create a dedicated project and manager
    const probeManager = await createDevUserAndSession('probe.manager@flowboard.example', 'Probe Manager', pool);
    const probeManagerCookie = `flowboard_session=${probeManager.session.id}`;
    const probeProjectId = 'prj_probe_concurrency_1';

    const clientSetup = await pool.connect();
    try {
      await clientSetup.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, 'Original Project Name', 'Before concurrent edit', FALSE, 1, NOW(), NOW())`,
        [probeProjectId, wsMainId],
      );
      await clientSetup.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_probe_mgr', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW())`,
        [probeProjectId, wsMainId, probeManager.user.id],
      );
    } finally {
      clientSetup.release();
    }

    // 2. Set up query interception on pool.connect to pause Connection 1 after acquiring the FOR SHARE grant lock
    let enteredSignal: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enteredSignal = resolve;
    });
    let releaseSignal: () => void = () => {};
    const release = new Promise<void>((resolve) => {
      releaseSignal = resolve;
    });

    const originalConnect = pool.connect.bind(pool);
    let armed = true;

    pool.connect = ((...args: any[]) => {
      if (typeof args[0] === 'function') {
        return (originalConnect as any)(...args);
      }
      return (async () => {
        const client = await (originalConnect as any)(...args);
        const originalQuery = client.query.bind(client);
        const originalRelease = client.release.bind(client);

        client.query = async (...qArgs: any[]) => {
          const queryText = typeof qArgs[0] === 'string' ? qArgs[0] : qArgs[0]?.text ?? '';
          const res = await (originalQuery as any)(...qArgs);

          // Intercept right after acquiring FOR SHARE lock on project_memberships
          if (armed && queryText.includes('FOR SHARE') && qArgs[1]?.[1] === probeManager.user.id) {
            armed = false;
            enteredSignal();
            await release;
          }
          return res;
        };

        client.release = (...rArgs: any[]) => {
          client.query = originalQuery;
          return originalRelease(...rArgs);
        };

        return client;
      })();
    }) as any;

    try {
      // 3. Connection 1: probeManager calls mounted PATCH /api/v1/projects/:projectId
      const updatePromise = app.request(`/api/v1/projects/${probeProjectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: probeManagerCookie,
          'Idempotency-Key': 'key_probe_concurrency_patch_01',
        },
        body: JSON.stringify({
          name: 'Updated By Probe Manager',
          expectedVersion: 1,
        }),
      });

      // Wait until Connection 1 has acquired FOR SHARE lock and is waiting on release
      await entered;

      // 4. Connection 2: Owner attempts to remove probeManager's membership via mounted DELETE
      // Because Connection 1 holds FOR SHARE lock, Connection 2's FOR UPDATE row lock MUST block
      let removalFinished = false;
      const removalPromise = Promise.resolve(
        app.request(`/api/v1/projects/${probeProjectId}/members/${probeManager.user.id}`, {
          method: 'DELETE',
          headers: {
            Cookie: ownerCookie,
            'Idempotency-Key': 'key_probe_concurrency_del_owner',
          },
        }),
      ).then((res) => {
        removalFinished = true;
        return res;
      });

      // Wait 50ms and assert that Connection 2 has NOT finished (it is blocked in PostgreSQL)
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(removalFinished, false, 'Owner removal DELETE must block while writer holds FOR SHARE grant lock');

      // 5. Release Connection 1 so update completes and commits
      releaseSignal();

      // Connection 1 finishes with 200 OK
      const updateRes = await updatePromise;
      assert.equal(updateRes.status, 200);
      const updateBody = await updateRes.json();
      assert.equal(updateBody.data.name, 'Updated By Probe Manager');

      // Now Connection 2 unblocks and finishes with 200 OK
      const removalRes = await removalPromise;
      assert.equal(removalRes.status, 200);
      assert.equal(removalFinished, true);

      // 6. Direct DB verification:
      // Project name is updated to 'Updated By Probe Manager'
      // Membership status is now 'removed'
      const clientVerify = await pool.connect();
      try {
        const prjCheck = await clientVerify.query<{ name: string; version: number }>(
          'SELECT name, version FROM projects WHERE id = $1',
          [probeProjectId],
        );
        assert.equal(prjCheck.rows[0]?.name, 'Updated By Probe Manager');
        assert.equal(prjCheck.rows[0]?.version, 2);

        const memCheck = await clientVerify.query<{ status: string }>(
          'SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2',
          [probeProjectId, probeManager.user.id],
        );
        assert.equal(memCheck.rows[0]?.status, 'removed');
      } finally {
        clientVerify.release();
      }

      // 7. Verify subsequent writes from probeManager are rejected with 404 NOT_FOUND
      const subsequentUpdate = await app.request(`/api/v1/projects/${probeProjectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: probeManagerCookie,
          'Idempotency-Key': 'key_probe_concurrency_patch_subsequent',
        },
        body: JSON.stringify({
          name: 'Stale Attempt After Removal',
          expectedVersion: 2,
        }),
      });
      assert.equal(subsequentUpdate.status, 404);
      const subBody = await subsequentUpdate.json();
      assert.equal(subBody.error.code, 'NOT_FOUND');
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test('RBAC-03: Concurrency Probe 2: Manager starts removeProjectMember while Owner concurrently promotes target; deletion rejected with 403 FORBIDDEN', async () => {
    // 1. Create a dedicated project, manager, and member target
    const probeManager2 = await createDevUserAndSession('probe.mgr2@flowboard.example', 'Probe Manager 2', pool);
    const probeManager2Cookie = `flowboard_session=${probeManager2.session.id}`;

    const probeTargetMember = await createDevUserAndSession('probe.target@flowboard.example', 'Probe Target Member', pool);
    const probeProjectId2 = 'prj_probe_concurrency_2';

    const clientSetup = await pool.connect();
    try {
      await clientSetup.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, 'Probe Target Project', 'Target role test', FALSE, 1, NOW(), NOW())`,
        [probeProjectId2, wsMainId],
      );
      await clientSetup.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_probe_mgr2', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
                ('pm_probe_target', $1, $2, $4, 'member', 'active', 1, NOW(), NOW())`,
        [probeProjectId2, wsMainId, probeManager2.user.id, probeTargetMember.user.id],
      );
    } finally {
      clientSetup.release();
    }

    // 2. Scenario 2A: Owner promotes member to manager and commits. Manager then calls DELETE -> rejected with 403
    const promoteRes = await app.request(`/api/v1/projects/${probeProjectId2}/members/${probeTargetMember.user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'key_probe_promote_target_mgr',
      },
      body: JSON.stringify({
        role: 'manager',
        status: 'active',
        expectedVersion: 1,
      }),
    });
    assert.equal(promoteRes.status, 200);

    const deleteAfterPromotionRes = await app.request(`/api/v1/projects/${probeProjectId2}/members/${probeTargetMember.user.id}`, {
      method: 'DELETE',
      headers: {
        Cookie: probeManager2Cookie,
        'Idempotency-Key': 'key_probe_del_after_prom_denied',
      },
    });
    assert.equal(deleteAfterPromotionRes.status, 403);
    const delBody = await deleteAfterPromotionRes.json();
    assert.equal(delBody.error.code, 'FORBIDDEN');
    assert.match(delBody.error.message, /Project managers cannot modify other managers/);

    // 3. Scenario 2B: Interleaved race condition test:
    // Reset target back to member
    let targetVersion = 3;
    const clientReset = await pool.connect();
    try {
      const resetRes = await clientReset.query<{ version: number }>(
        `UPDATE project_memberships SET role = 'member', status = 'active', version = version + 1 WHERE project_id = $1 AND user_id = $2 RETURNING version`,
        [probeProjectId2, probeTargetMember.user.id],
      );
      targetVersion = resetRes.rows[0]!.version;
    } finally {
      clientReset.release();
    }

    // Manager starts DELETE. We pause Manager's transaction right after acquiring their grant lock,
    // before acquiring the target row lock.
    let enteredSignal: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enteredSignal = resolve;
    });
    let releaseSignal: () => void = () => {};
    const release = new Promise<void>((resolve) => {
      releaseSignal = resolve;
    });

    const originalConnect = pool.connect.bind(pool);
    let armed = true;

    pool.connect = ((...args: any[]) => {
      if (typeof args[0] === 'function') {
        return (originalConnect as any)(...args);
      }
      return (async () => {
        const client = await (originalConnect as any)(...args);
        const originalQuery = client.query.bind(client);
        const originalRelease = client.release.bind(client);

        client.query = async (...qArgs: any[]) => {
          const queryText = typeof qArgs[0] === 'string' ? qArgs[0] : qArgs[0]?.text ?? '';
          const res = await (originalQuery as any)(...qArgs);

          // Pause right after acquiring FOR SHARE lock on manager's membership grant
          if (
            armed &&
            queryText.includes('FOR SHARE') &&
            qArgs[1]?.[1] === probeManager2.user.id
          ) {
            armed = false;
            enteredSignal();
            await release;
          }
          return res;
        };

        client.release = (...rArgs: any[]) => {
          client.query = originalQuery;
          return originalRelease(...rArgs);
        };

        return client;
      })();
    }) as any;

    try {
      // Manager starts DELETE on Connection 1
      const managerDeletePromise = app.request(`/api/v1/projects/${probeProjectId2}/members/${probeTargetMember.user.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: probeManager2Cookie,
          'Idempotency-Key': 'key_probe_del_target_race_mgr',
        },
      });

      // Wait until Manager has started DELETE and acquired their grant lock
      await entered;

      // In parallel on Connection 2, Owner promotes target to manager via mounted handler:
      const ownerPromoteRes = await app.request(
        `/api/v1/projects/${probeProjectId2}/members/${probeTargetMember.user.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: ownerCookie,
            'Idempotency-Key': 'key_probe_promote_target_race_owner',
          },
          body: JSON.stringify({
            role: 'manager',
            status: 'active',
            expectedVersion: targetVersion,
          }),
        },
      );
      assert.equal(ownerPromoteRes.status, 200);

      // Resume Manager's DELETE
      releaseSignal();

      // Manager's DELETE must fail with 403 FORBIDDEN (predicate role IN ('member', 'viewer') protects row)
      const managerDeleteRes = await managerDeletePromise;
      assert.equal(managerDeleteRes.status, 403);
      const resBody = await managerDeleteRes.json();
      assert.equal(resBody.error.code, 'FORBIDDEN');

      // Verify final target membership in database: role is 'manager', status is 'active' (NOT removed)
      const clientVerify = await pool.connect();
      try {
        const targetCheck = await clientVerify.query<{ role: string; status: string }>(
          'SELECT role, status FROM project_memberships WHERE project_id = $1 AND user_id = $2',
          [probeProjectId2, probeTargetMember.user.id],
        );
        assert.equal(targetCheck.rows[0]?.role, 'manager');
        assert.equal(targetCheck.rows[0]?.status, 'active');
      } finally {
        clientVerify.release();
      }
    } finally {
      pool.connect = originalConnect;
    }
  });

  // ==========================================================================
  // RBAC-04: Picker and Notification Privacy Tests
  // ==========================================================================
  await t.test('RBAC-04: getEligibleAssignees and getEligibleMentionees enforce role and sibling privacy', async () => {
    // 1. Assignees query: workspace owner + active manager + active member only (no viewers, no removed, no siblings)
    const assignees = await getEligibleAssignees(pool, prjMainId);
    const assigneeIds = assignees.map((a) => a.id);

    assert.ok(assigneeIds.includes(ownerUserId), 'Workspace owner must be an eligible assignee');
    assert.ok(assigneeIds.includes(managerUserId), 'Active manager must be an eligible assignee');
    assert.ok(assigneeIds.includes(memberUserId), 'Active member must be an eligible assignee');

    assert.ok(!assigneeIds.includes(viewerUserId), 'Viewer must NOT be an eligible assignee');
    assert.ok(!assigneeIds.includes(removedUserId), 'Removed user must NOT be an eligible assignee');
    assert.ok(!assigneeIds.includes(siblingManagerUserId), 'Sibling manager must NOT be in assignees');
    assert.ok(!assigneeIds.includes(siblingMemberUserId), 'Sibling member must NOT be in assignees');
    assert.ok(!assigneeIds.includes(strangerUserId), 'Stranger must NOT be in assignees');

    // 2. Mentionees query: workspace owner + manager + member + viewer (viewers can be mentioned, but not removed or siblings)
    const mentionees = await getEligibleMentionees(pool, prjMainId);
    const mentioneeIds = mentionees.map((m) => m.id);

    assert.ok(mentioneeIds.includes(ownerUserId));
    assert.ok(mentioneeIds.includes(managerUserId));
    assert.ok(mentioneeIds.includes(memberUserId));
    assert.ok(mentioneeIds.includes(viewerUserId), 'Viewer MUST be an eligible mentionee');

    assert.ok(!mentioneeIds.includes(removedUserId), 'Removed member must NOT be an eligible mentionee');
    assert.ok(!mentioneeIds.includes(siblingManagerUserId), 'Sibling project user must NOT be a mentionee');
    assert.ok(!mentioneeIds.includes(siblingMemberUserId), 'Sibling project user must NOT be a mentionee');

    // 3. Historical identity query flags removed status accurately
    const historicalZack = await getHistoricalPersonDisplay(pool, prjMainId, removedUserId);
    assert.ok(historicalZack);
    assert.equal(historicalZack.activeInProject, false);
    assert.equal(historicalZack.assignable, false);
    assert.equal(historicalZack.mentionable, false);

    // Historical identity for sibling user returns null
    const historicalSibling = await getHistoricalPersonDisplay(pool, prjMainId, siblingManagerUserId);
    assert.equal(historicalSibling, null);
  });

  await t.test('RBAC-04: HTTP GET /api/v1/projects/:projectId/people enforces privacy and purpose filtering', async () => {
    // 1. Member queries assignees
    const assigneeRes = await app.request(`/api/v1/projects/${prjMainId}/people?purpose=assignee`, {
      headers: { Cookie: memberCookie },
    });
    assert.equal(assigneeRes.status, 200);
    const assigneeJson = (await assigneeRes.json()) as { data: PersonDisplay[] };
    const assigneeIds = assigneeJson.data.map((p) => p.id);
    assert.ok(assigneeIds.includes(ownerUserId));
    assert.ok(assigneeIds.includes(managerUserId));
    assert.ok(assigneeIds.includes(memberUserId));
    assert.ok(!assigneeIds.includes(viewerUserId));

    // 2. Member queries mentionees
    const mentionRes = await app.request(`/api/v1/projects/${prjMainId}/people?purpose=mention`, {
      headers: { Cookie: memberCookie },
    });
    assert.equal(mentionRes.status, 200);
    const mentionJson = (await mentionRes.json()) as { data: PersonDisplay[] };
    const mentionIds = mentionJson.data.map((p) => p.id);
    assert.ok(mentionIds.includes(viewerUserId));

    // 3. Search query filters results
    const searchRes = await app.request(`/api/v1/projects/${prjMainId}/people?purpose=display&query=Charlie`, {
      headers: { Cookie: memberCookie },
    });
    assert.equal(searchRes.status, 200);
    const searchJson = (await searchRes.json()) as { data: PersonDisplay[] };
    assert.equal(searchJson.data.length, 1);
    assert.equal(searchJson.data[0]?.id, memberUserId);

    // 4. Sibling project member querying people returns 404 NOT_FOUND
    const siblingRes = await app.request(`/api/v1/projects/${prjMainId}/people`, {
      headers: { Cookie: siblingManagerCookie },
    });
    assert.equal(siblingRes.status, 404);
    const siblingJson = await siblingRes.json();
    assert.equal(siblingJson.error.code, 'NOT_FOUND');

    // 5. Outsider querying people returns 404 NOT_FOUND
    const strangerRes = await app.request(`/api/v1/projects/${prjMainId}/people`, {
      headers: { Cookie: strangerCookie },
    });
    assert.equal(strangerRes.status, 404);
  });

  // ==========================================================================
  // RBAC-05: Explicit board access disclosure tests
  // ==========================================================================
  await t.test('RBAC-05: GET /api/v1/projects/:projectId/access-summary discloses explicit board grants without hidden counts', async () => {
    // 1. Member requests access summary
    const res = await app.request(`/api/v1/projects/${prjMainId}/access-summary`, {
      headers: { Cookie: memberCookie },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: ProjectAccessSummary };

    assert.equal(json.data.projectId, prjMainId);
    assert.equal(json.data.workspaceId, wsMainId);

    // Discloses workspace owner inherited authority across all boards
    assert.equal(json.data.workspaceOwner.id, ownerUserId);
    assert.equal(json.data.workspaceOwner.role, 'owner');
    assert.equal(json.data.workspaceOwner.inherited, true);
    assert.match(json.data.workspaceOwner.disclosure, /Workspace owner holds full administrative authority across all boards/);

    // Actor details
    assert.equal(json.data.actor.id, memberUserId);
    assert.equal(json.data.actor.role, 'member');
    assert.equal(json.data.actor.inheritedFrom, 'project_membership');

    // A member with project access but no board grant must not learn how many
    // boards the project contains.
    assert.equal(json.data.boardInheritance.model, 'explicit_board_grants');
    assert.equal(json.data.boardInheritance.allBoardsInherit, false);
    assert.equal(json.data.boardInheritance.hasBoardOnlyExceptions, true);
    assert.equal(json.data.boardInheritance.boardCount, 0);
    assert.match(json.data.boardInheritance.disclosure, /Project membership alone does not grant board access/);

    // Member summary
    assert.equal(json.data.memberSummary.activeManagers, 1);
    assert.equal(json.data.memberSummary.activeMembers, 1);
    assert.equal(json.data.memberSummary.activeViewers, 1);
    assert.equal(json.data.memberSummary.totalActiveMembers, 3);
  });

  await t.test('RBAC-05: Workspace owner requests access summary -> actor role is owner inherited from workspace', async () => {
    const res = await app.request(`/api/v1/projects/${prjMainId}/access-summary`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: ProjectAccessSummary };

    assert.equal(json.data.actor.id, ownerUserId);
    assert.equal(json.data.actor.role, 'owner');
    assert.equal(json.data.actor.inheritedFrom, 'workspace_owner');
    assert.equal(json.data.boardInheritance.boardCount, 1);
  });

  await t.test('RBAC-05: Sibling project member or outsider access-summary returns 404 NOT_FOUND', async () => {
    const res = await app.request(`/api/v1/projects/${prjMainId}/access-summary`, {
      headers: { Cookie: siblingManagerCookie },
    });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error.code, 'NOT_FOUND');
  });

  await t.test('RBAC-05: Unauthenticated request returns 401 UNAUTHORIZED', async () => {
    const res = await app.request(`/api/v1/projects/${prjMainId}/access-summary`);
    assert.equal(res.status, 401);
  });
});
