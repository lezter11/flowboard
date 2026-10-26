import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { projectMemberSchema } from '@flowboard/contracts';

test('INV-06 & INV-07: Change Member Roles & Remove Project Access Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const workspaceId = 'ws_inv0607_test';
  const projectId = 'prj_inv0607_test';

  let aliceUserId = '';
  let bobUserId = '';
  let charlieUserId = '';
  let daveUserId = '';
  let eveUserId = '';
  let frankUserId = '';

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';
  let daveCookie = '';
  let eveCookie = '';
  let frankCookie = '';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships CASCADE;');

      // 1. Create users & sessions
      // Alice: Workspace Owner
      const alice = await createDevUserAndSession('alice.owner@flowboard.example', 'Alice Owner', pool);
      aliceUserId = alice.user.id;
      aliceCookie = `flowboard_session=${alice.session.id}`;

      // Bob: Project Manager 1
      const bob = await createDevUserAndSession('bob.manager1@flowboard.example', 'Bob Manager', pool);
      bobUserId = bob.user.id;
      bobCookie = `flowboard_session=${bob.session.id}`;

      // Charlie: Member
      const charlie = await createDevUserAndSession('charlie.member@flowboard.example', 'Charlie Member', pool);
      charlieUserId = charlie.user.id;
      charlieCookie = `flowboard_session=${charlie.session.id}`;

      // Dave: Project Manager 2 (peer manager)
      const dave = await createDevUserAndSession('dave.manager2@flowboard.example', 'Dave Manager', pool);
      daveUserId = dave.user.id;
      daveCookie = `flowboard_session=${dave.session.id}`;

      // Eve: Viewer
      const eve = await createDevUserAndSession('eve.viewer@flowboard.example', 'Eve Viewer', pool);
      eveUserId = eve.user.id;
      eveCookie = `flowboard_session=${eve.session.id}`;

      // Frank: Outsider (not a project member)
      const frank = await createDevUserAndSession('frank.outsider@flowboard.example', 'Frank Outsider', pool);
      frankUserId = frank.user.id;
      frankCookie = `flowboard_session=${frank.session.id}`;

      const now = new Date().toISOString();

      // 2. Create Workspace owned by Alice
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5)`,
        [workspaceId, 'Inv0607 Workspace', 'UTC', aliceUserId, now],
      );

      // 3. Create Project & Sibling Project
      const siblingProjectId = 'prj_inv0607_sibling';
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, 1, $5, $5),
                ($6, $2, $7, $8, FALSE, 1, $5, $5)`,
        [
          projectId, workspaceId, 'Inv0607 Project', 'Membership Testing Project', now,
          siblingProjectId, 'Inv0607 Sibling Project', 'Sibling Testing Project',
        ],
      );

      // 4. Seed memberships in Project & Sibling Project (Frank is manager in sibling project)
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manager', 'active', 1, $5, $5),
                ($6, $2, $3, $7, 'member', 'active', 1, $5, $5),
                ($8, $2, $3, $9, 'manager', 'active', 1, $5, $5),
                ($10, $2, $3, $11, 'viewer', 'active', 1, $5, $5),
                ($12, $13, $3, $14, 'manager', 'active', 1, $5, $5)`,
        [
          'pm_bob', projectId, workspaceId, bobUserId, now,
          'pm_charlie', charlieUserId,
          'pm_dave', daveUserId,
          'pm_eve', eveUserId,
          'pm_frank_sibling', siblingProjectId, frankUserId,
        ],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  let charlieCurrentVersion = 1;

  await t.test('Test 0: Missing or invalid Idempotency-Key on member mutations returns 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    // PATCH without key
    const patchRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({
        role: 'manager',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });
    assert.equal(patchRes.status, 400);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    // DELETE without key
    const deleteRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'DELETE',
      headers: { Cookie: aliceCookie },
    });
    assert.equal(deleteRes.status, 400);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  await t.test('Test 1: Workspace owner promotes a member to manager -> succeeds', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_mem_patch_owner_01',
      },
      body: JSON.stringify({
        role: 'manager',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.replayed, false);
    const member = projectMemberSchema.parse(body.data);
    assert.equal(member.role, 'manager');
    assert.equal(member.status, 'active');
    assert.equal(member.version, 2);
    assert.equal(member.userId, charlieUserId);
    assert.equal(member.projectId, projectId);

    charlieCurrentVersion = member.version;

    // Idempotency replay on PATCH member
    const replayRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_mem_patch_owner_01',
      },
      body: JSON.stringify({
        role: 'manager',
        status: 'active',
        expectedVersion: 1, // original payload
      }),
    });
    assert.equal(replayRes.status, 200);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.data.role, 'manager');

    // Workspace owner demotes Charlie back to member for subsequent tests
    const demoteRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_mem_patch_owner_02',
      },
      body: JSON.stringify({
        role: 'member',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });

    assert.equal(demoteRes.status, 200);
    const demoteBody = await demoteRes.json();
    const demotedMember = projectMemberSchema.parse(demoteBody.data);
    assert.equal(demotedMember.role, 'member');
    assert.equal(demotedMember.version, 3);
    charlieCurrentVersion = demotedMember.version;
  });

  await t.test('Test 2: Project manager attempts to promote a member to manager -> returns 403 FORBIDDEN', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_patch_pm_promote_denied',
      },
      body: JSON.stringify({
        role: 'manager',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.match(body.error.message, /Only workspace owners can appoint managers/);
  });

  await t.test('Test 3: Project manager modifies role between member and viewer -> succeeds', async () => {
    // 3a. Bob demotes Charlie (member) to viewer
    const toViewerRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_patch_pm_to_viewer',
      },
      body: JSON.stringify({
        role: 'viewer',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });

    assert.equal(toViewerRes.status, 200);
    const viewerBody = await toViewerRes.json();
    const viewerMember = projectMemberSchema.parse(viewerBody.data);
    assert.equal(viewerMember.role, 'viewer');
    assert.equal(viewerMember.version, charlieCurrentVersion + 1);
    charlieCurrentVersion = viewerMember.version;

    // 3b. Bob promotes Charlie (viewer) back to member
    const toMemberRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_patch_pm_to_member',
      },
      body: JSON.stringify({
        role: 'member',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });

    assert.equal(toMemberRes.status, 200);
    const memberBody = await toMemberRes.json();
    const memberObj = projectMemberSchema.parse(memberBody.data);
    assert.equal(memberObj.role, 'member');
    assert.equal(memberObj.version, charlieCurrentVersion + 1);
    charlieCurrentVersion = memberObj.version;
  });

  await t.test('Test 4: Project manager attempts to modify another manager -> returns 403 FORBIDDEN', async () => {
    // Bob attempts to demote Dave (peer manager) to member
    const res = await app.request(`/api/v1/projects/${projectId}/members/${daveUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_patch_pm_peer_denied',
      },
      body: JSON.stringify({
        role: 'member',
        status: 'active',
        expectedVersion: 1,
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.match(body.error.message, /Project managers cannot modify other managers/);
  });

  await t.test('Test 5: Project manager attempts to modify themselves -> returns 403 FORBIDDEN', async () => {
    // Bob attempts to modify his own membership
    const res = await app.request(`/api/v1/projects/${projectId}/members/${bobUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_patch_pm_self_denied',
      },
      body: JSON.stringify({
        role: 'viewer',
        status: 'active',
        expectedVersion: 1,
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.match(body.error.message, /Cannot modify own membership/);
  });

  await t.test('Test 6: Stale version in PATCH returns 409 STALE_VERSION', async () => {
    // Eve currently has version = 1 in database
    const res = await app.request(`/api/v1/projects/${projectId}/members/${eveUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_mem_patch_stale_ver',
      },
      body: JSON.stringify({
        role: 'member',
        status: 'active',
        expectedVersion: 999, // Stale / mismatched version
      }),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'STALE_VERSION');
    assert.match(body.error.message, /Member was concurrently updated/);
  });

  await t.test('Test 7: Immediate revocation: removing project access sets status="removed"; next request by that user to read the project returns 404 NOT_FOUND', async () => {
    // 7a. Verify Eve can read project before revocation
    const readBeforeRes = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'GET',
      headers: { Cookie: eveCookie },
    });
    assert.equal(readBeforeRes.status, 200);

    // 7b. Project manager Bob removes Eve's access via DELETE
    const deleteRes = await app.request(`/api/v1/projects/${projectId}/members/${eveUserId}`, {
      method: 'DELETE',
      headers: {
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_delete_pm_eve',
      },
    });
    assert.equal(deleteRes.status, 200);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.data.success, true);
    assert.equal(deleteBody.replayed, false);

    // Test Idempotency Replay on DELETE
    const replayDeleteRes = await app.request(`/api/v1/projects/${projectId}/members/${eveUserId}`, {
      method: 'DELETE',
      headers: {
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_delete_pm_eve',
      },
    });
    assert.equal(replayDeleteRes.status, 200);
    const replayDeleteBody = await replayDeleteRes.json();
    assert.equal(replayDeleteBody.replayed, true);
    assert.equal(replayDeleteBody.data.success, true);

    // 7c. Direct database check: status = 'removed' and version incremented
    const client = await pool.connect();
    try {
      const dbRes = await client.query<{ status: string; version: number }>(
        'SELECT status, version FROM project_memberships WHERE project_id = $1 AND user_id = $2',
        [projectId, eveUserId],
      );
      assert.equal(dbRes.rows[0]?.status, 'removed');
      assert.equal(dbRes.rows[0]?.version, 2);
    } finally {
      client.release();
    }

    // 7d. Immediate revocation check: Eve's subsequent request to read project returns 404 NOT_FOUND
    const readAfterRes = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'GET',
      headers: { Cookie: eveCookie },
    });
    assert.equal(readAfterRes.status, 404);
    const afterBody = await readAfterRes.json();
    assert.equal(afterBody.error.code, 'NOT_FOUND');
  });

  await t.test('Test 8: Project manager cannot DELETE another manager -> returns 403 FORBIDDEN', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/members/${daveUserId}`, {
      method: 'DELETE',
      headers: {
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_delete_pm_peer_denied',
      },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.match(body.error.message, /Project managers cannot modify other managers/);
  });

  await t.test('Test 9: Project manager cannot DELETE themselves -> returns 403 FORBIDDEN', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/members/${bobUserId}`, {
      method: 'DELETE',
      headers: {
        Cookie: bobCookie,
        'Idempotency-Key': 'key_mem_delete_pm_self_denied',
      },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.match(body.error.message, /Cannot modify own membership/);
  });

  await t.test('Test 10: Non-member outsider attempting to manage members returns 404 NOT_FOUND', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: frankCookie,
        'Idempotency-Key': 'key_mem_patch_outsider_denied',
      },
      body: JSON.stringify({
        role: 'viewer',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  await t.test('Test 11: Member attempting to manage members returns 403 FORBIDDEN', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/members/${daveUserId}`, {
      method: 'DELETE',
      headers: {
        Cookie: charlieCookie,
        'Idempotency-Key': 'key_mem_delete_member_denied',
      },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  await t.test('Test 12: Sibling project privacy: manager of sibling project attempting to manage members in another project receives 404 NOT_FOUND', async () => {
    // Frank is active manager in siblingProjectId under the same workspace, but not a member of projectId
    const patchRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: frankCookie,
        'Idempotency-Key': 'key_mem_patch_sibling_denied',
      },
      body: JSON.stringify({
        role: 'viewer',
        status: 'active',
        expectedVersion: charlieCurrentVersion,
      }),
    });
    assert.equal(patchRes.status, 404);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.error.code, 'NOT_FOUND');

    const deleteRes = await app.request(`/api/v1/projects/${projectId}/members/${charlieUserId}`, {
      method: 'DELETE',
      headers: {
        Cookie: frankCookie,
        'Idempotency-Key': 'key_mem_delete_sibling_denied',
      },
    });
    assert.equal(deleteRes.status, 404);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.error.code, 'NOT_FOUND');
  });
});
