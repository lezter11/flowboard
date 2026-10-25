import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';

test('INV-01 & INV-03: Project Invitations Lifecycle Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const aliceUserId = 'usr_alice_inv_owner';
  const bobUserId = 'usr_bob_inv_manager';
  const charlieUserId = 'usr_charlie_inv_member';
  const daveUserId = 'usr_dave_inv_viewer';
  const eveUserId = 'usr_eve_inv_outsider';
  const frankUserId = 'usr_frank_inv_invitee';
  const graceUserId = 'usr_grace_inv_wrong';
  const malloryUserId = 'usr_mallory_inv_expired';

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';
  let daveCookie = '';
  let eveCookie = '';
  let frankCookie = '';
  let graceCookie = '';
  let malloryCookie = '';

  const workspaceId = 'ws_inv_lifecycle_test';
  const projectId = 'prj_inv_lifecycle_test';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        'TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships, project_invitations, outbox CASCADE;',
      );

      // Seed Users
      const users = [
        { id: aliceUserId, email: 'alice.inv@flowboard.example', name: 'Alice Owner' },
        { id: bobUserId, email: 'bob.manager@flowboard.example', name: 'Bob Manager' },
        { id: charlieUserId, email: 'charlie.member@flowboard.example', name: 'Charlie Member' },
        { id: daveUserId, email: 'dave.viewer@flowboard.example', name: 'Dave Viewer' },
        { id: eveUserId, email: 'eve.outsider@flowboard.example', name: 'Eve Outsider' },
        { id: frankUserId, email: 'frank.invitee@flowboard.example', name: 'Frank Invitee' },
        { id: graceUserId, email: 'grace.wrong@flowboard.example', name: 'Grace Mismatched' },
        { id: malloryUserId, email: 'mallory.expired@flowboard.example', name: 'Mallory Expired' },
      ];

      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
           VALUES ($1, $2, $3, null, NOW(), NOW())`,
          [u.id, u.email, u.name],
        );
      }

      // Create Sessions
      const sAlice = await createSession(aliceUserId, 24, client);
      aliceCookie = `flowboard_session=${sAlice.id}`;

      const sBob = await createSession(bobUserId, 24, client);
      bobCookie = `flowboard_session=${sBob.id}`;

      const sCharlie = await createSession(charlieUserId, 24, client);
      charlieCookie = `flowboard_session=${sCharlie.id}`;

      const sDave = await createSession(daveUserId, 24, client);
      daveCookie = `flowboard_session=${sDave.id}`;

      const sEve = await createSession(eveUserId, 24, client);
      eveCookie = `flowboard_session=${sEve.id}`;

      const sFrank = await createSession(frankUserId, 24, client);
      frankCookie = `flowboard_session=${sFrank.id}`;

      const sGrace = await createSession(graceUserId, 24, client);
      graceCookie = `flowboard_session=${sGrace.id}`;

      const sMallory = await createSession(malloryUserId, 24, client);
      malloryCookie = `flowboard_session=${sMallory.id}`;

      // Create Workspace owned by Alice
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, 'Inv Test Workspace', 'UTC', $2, 1, NOW(), NOW())`,
        [workspaceId, aliceUserId],
      );

      // Create Project
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, 'Inv Test Project', 'Testing Invitations', false, 1, NOW(), NOW())`,
        [projectId, workspaceId],
      );

      // Seed Project Memberships: Bob is Manager, Charlie is Member, Dave is Viewer
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES
           ('pm_bob_mgr', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
           ('pm_charlie_mem', $1, $2, $4, 'member', 'active', 1, NOW(), NOW()),
           ('pm_dave_view', $1, $2, $5, 'viewer', 'active', 1, NOW(), NOW())`,
        [projectId, workspaceId, bobUserId, charlieUserId, daveUserId],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  let frankRawToken = '';
  let frankInvitationId = '';

  await t.test(
    'Test 1: Workspace owner invites a manager -> succeeds, token_hash stored in DB, outbox record created',
    async () => {
      const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: aliceCookie,
          'Idempotency-Key': 'idem_key_owner_invite_001',
        },
        body: JSON.stringify({
          email: 'Frank.Invitee@flowboard.example',
          role: 'manager',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.replayed, false);
      assert.ok(json.data.id.startsWith('inv_'));
      assert.equal(json.data.email, 'frank.invitee@flowboard.example');
      assert.equal(json.data.role, 'manager');
      assert.equal(json.data.status, 'pending');
      assert.ok(json.data.expiresAt.endsWith('Z'));
      assert.ok(json.data.token);
      assert.equal(json.data.token.length, 64); // 32 bytes hex

      frankInvitationId = json.data.id;
      frankRawToken = json.data.token;

      // Verify DB project_invitations record
      const client = await pool.connect();
      try {
        const invRes = await client.query<{
          id: string;
          project_id: string;
          workspace_id: string;
          email: string;
          role: string;
          token_hash: string;
          invited_by: string;
          status: string;
          expires_at: Date;
        }>('SELECT * FROM project_invitations WHERE id = $1', [frankInvitationId]);

        assert.equal(invRes.rows.length, 1);
        const inv = invRes.rows[0]!;
        assert.equal(inv.project_id, projectId);
        assert.equal(inv.workspace_id, workspaceId);
        assert.equal(inv.email, 'frank.invitee@flowboard.example');
        assert.equal(inv.role, 'manager');
        assert.equal(inv.invited_by, aliceUserId);
        assert.equal(inv.status, 'pending');

        const expectedHash = crypto.createHash('sha256').update(frankRawToken).digest('hex');
        assert.equal(inv.token_hash, expectedHash);

        const expiresAtMs = new Date(inv.expires_at).getTime();
        const nowMs = Date.now();
        // 7 days +/- 1 minute
        assert.ok(expiresAtMs > nowMs + 6 * 24 * 3600 * 1000);
        assert.ok(expiresAtMs <= nowMs + 8 * 24 * 3600 * 1000);

        // Verify outbox record
        const outboxRes = await client.query<{
          id: string;
          workspace_id: string;
          project_id: string;
          event_type: string;
          payload: any;
          status: string;
        }>('SELECT * FROM outbox WHERE project_id = $1 AND event_type = $2', [
          projectId,
          'invitation.created',
        ]);

        assert.equal(outboxRes.rows.length, 1);
        const outbox = outboxRes.rows[0]!;
        assert.equal(outbox.workspace_id, workspaceId);
        assert.equal(outbox.status, 'pending');
        const payload = typeof outbox.payload === 'string' ? JSON.parse(outbox.payload) : outbox.payload;
        assert.equal(payload.invitationId, frankInvitationId);
        assert.equal(payload.email, 'frank.invitee@flowboard.example');
        assert.equal(payload.role, 'manager');
        assert.equal(payload.projectId, projectId);
        assert.equal(payload.workspaceId, workspaceId);
      } finally {
        client.release();
      }
    },
  );

  await t.test('Test 2: Project manager invites a member -> succeeds', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'idem_key_mgr_invite_001',
      },
      body: JSON.stringify({
        email: 'heidi.newmember@flowboard.example',
        role: 'member',
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.role, 'member');
    assert.equal(json.data.email, 'heidi.newmember@flowboard.example');
    assert.equal(json.data.status, 'pending');

    const client = await pool.connect();
    try {
      const invRes = await client.query<{ invited_by: string; role: string }>(
        'SELECT invited_by, role FROM project_invitations WHERE id = $1',
        [json.data.id],
      );
      assert.equal(invRes.rows[0]?.invited_by, bobUserId);
      assert.equal(invRes.rows[0]?.role, 'member');
    } finally {
      client.release();
    }
  });

  await t.test(
    'Test 3: Project manager attempts to invite another manager -> returns 403 FORBIDDEN',
    async () => {
      const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: bobCookie,
          'Idempotency-Key': 'idem_key_mgr_invite_mgr_001',
        },
        body: JSON.stringify({
          email: 'ivan.manager@flowboard.example',
          role: 'manager',
        }),
      });

      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error.code, 'FORBIDDEN');
      assert.match(json.error.message, /only workspace owners can invite managers/i);

      // Verify no DB record was written
      const client = await pool.connect();
      try {
        const invRes = await client.query(
          'SELECT id FROM project_invitations WHERE email = $1',
          ['ivan.manager@flowboard.example'],
        );
        assert.equal(invRes.rows.length, 0);
      } finally {
        client.release();
      }
    },
  );

  await t.test(
    'Test 4: Member/viewer attempts to invite someone -> returns 403 FORBIDDEN (or 404 for outsider)',
    async () => {
      // 4a. Member attempts to invite
      const resMember = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: charlieCookie,
          'Idempotency-Key': 'idem_key_mem_invite_001',
        },
        body: JSON.stringify({
          email: 'somebody@flowboard.example',
          role: 'viewer',
        }),
      });
      assert.equal(resMember.status, 403);
      const memberJson = await resMember.json();
      assert.equal(memberJson.error.code, 'FORBIDDEN');

      // 4b. Viewer attempts to invite
      const resViewer = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: daveCookie,
          'Idempotency-Key': 'idem_key_view_invite_001',
        },
        body: JSON.stringify({
          email: 'somebody@flowboard.example',
          role: 'viewer',
        }),
      });
      assert.equal(resViewer.status, 403);
      const viewerJson = await resViewer.json();
      assert.equal(viewerJson.error.code, 'FORBIDDEN');

      // 4c. Outsider attempts to invite (neither owner nor member)
      const resOutsider = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: eveCookie,
          'Idempotency-Key': 'idem_key_out_invite_001',
        },
        body: JSON.stringify({
          email: 'somebody@flowboard.example',
          role: 'viewer',
        }),
      });
      assert.equal(resOutsider.status, 404);
      const outsiderJson = await resOutsider.json();
      assert.equal(outsiderJson.error.code, 'NOT_FOUND');
    },
  );

  await t.test(
    'Test 5: Accept matching invitation -> updates status to accepted, inserts project_memberships row, user gains access',
    async () => {
      // Before accepting, Frank cannot access project
      const getPre = await app.request(`/api/v1/projects/${projectId}`, {
        method: 'GET',
        headers: { Cookie: frankCookie },
      });
      assert.equal(getPre.status, 404);

      // Frank accepts the invitation using raw token
      const res = await app.request('/api/v1/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: frankCookie,
        },
        body: JSON.stringify({
          token: frankRawToken,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.success, true);
      assert.equal(json.data.projectId, projectId);
      assert.equal(json.data.workspaceId, workspaceId);
      assert.equal(json.data.role, 'manager');

      // DB verification
      const client = await pool.connect();
      try {
        const invRes = await client.query<{ status: string }>(
          'SELECT status FROM project_invitations WHERE id = $1',
          [frankInvitationId],
        );
        assert.equal(invRes.rows[0]?.status, 'accepted');

        const memberRes = await client.query<{
          id: string;
          role: string;
          status: string;
          user_id: string;
          project_id: string;
        }>('SELECT * FROM project_memberships WHERE project_id = $1 AND user_id = $2', [
          projectId,
          frankUserId,
        ]);
        assert.equal(memberRes.rows.length, 1);
        assert.equal(memberRes.rows[0]?.role, 'manager');
        assert.equal(memberRes.rows[0]?.status, 'active');
      } finally {
        client.release();
      }

      // After accepting, Frank can now access the project
      const getPost = await app.request(`/api/v1/projects/${projectId}`, {
        method: 'GET',
        headers: { Cookie: frankCookie },
      });
      assert.equal(getPost.status, 200);
      const postJson = await getPost.json();
      assert.equal(postJson.data.id, projectId);

      // And Frank's session shows manager role for this project
      const sessionRes = await app.request('/api/v1/session', {
        method: 'GET',
        headers: { Cookie: frankCookie },
      });
      assert.equal(sessionRes.status, 200);
      const sessionJson = await sessionRes.json();
      const prj = sessionJson.data.accessibleProjects.find((p: any) => p.id === projectId);
      assert.ok(prj);
      assert.equal(prj.role, 'manager');
    },
  );

  await t.test(
    'Test 6: Accept with mismatched email (signed in as another user) -> returns 403 EMAIL_MISMATCH, no membership created',
    async () => {
      // Owner invites Laura
      const invRes = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: aliceCookie,
          'Idempotency-Key': 'idem_key_owner_invite_laura',
        },
        body: JSON.stringify({
          email: 'laura.invitee@flowboard.example',
          role: 'viewer',
        }),
      });
      assert.equal(invRes.status, 201);
      const invData = await invRes.json();
      const lauraRawToken = invData.data.token;

      // Grace (signed in as grace.wrong@flowboard.example) tries to accept Laura's token
      const acceptRes = await app.request('/api/v1/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: graceCookie,
        },
        body: JSON.stringify({
          token: lauraRawToken,
        }),
      });

      assert.equal(acceptRes.status, 403);
      const acceptJson = await acceptRes.json();
      assert.equal(acceptJson.error.code, 'EMAIL_MISMATCH');

      // Verify no membership was created for Grace
      const client = await pool.connect();
      try {
        const memberRes = await client.query(
          'SELECT id FROM project_memberships WHERE project_id = $1 AND user_id = $2',
          [projectId, graceUserId],
        );
        assert.equal(memberRes.rows.length, 0);

        // Invitation remains pending
        const invCheck = await client.query<{ status: string }>(
          'SELECT status FROM project_invitations WHERE id = $1',
          [invData.data.id],
        );
        assert.equal(invCheck.rows[0]?.status, 'pending');
      } finally {
        client.release();
      }
    },
  );

  await t.test('Test 7: Accept expired or already accepted token -> returns 400', async () => {
    // 7a. Already accepted token (Frank's token from Test 5)
    const resAlreadyAccepted = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: frankCookie,
      },
      body: JSON.stringify({
        token: frankRawToken,
      }),
    });
    assert.equal(resAlreadyAccepted.status, 400);
    const jsonAlready = await resAlreadyAccepted.json();
    assert.equal(jsonAlready.error.code, 'INVALID_INVITATION');

    // 7b. Expired token
    const client = await pool.connect();
    let malloryRawToken = '';
    let malloryInvId = '';
    try {
      const invRes = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: aliceCookie,
          'Idempotency-Key': 'idem_key_owner_invite_mallory',
        },
        body: JSON.stringify({
          email: 'mallory.expired@flowboard.example',
          role: 'viewer',
        }),
      });
      assert.equal(invRes.status, 201);
      const invJson = await invRes.json();
      malloryRawToken = invJson.data.token;
      malloryInvId = invJson.data.id;

      // Manually backdate expires_at to 1 hour ago
      await client.query(
        `UPDATE project_invitations SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
        [malloryInvId],
      );
    } finally {
      client.release();
    }

    const resExpired = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: malloryCookie,
      },
      body: JSON.stringify({
        token: malloryRawToken,
      }),
    });
    assert.equal(resExpired.status, 400);
    const jsonExpired = await resExpired.json();
    assert.equal(jsonExpired.error.code, 'INVITATION_EXPIRED');

    // Verify DB updated to expired
    const client2 = await pool.connect();
    try {
      const checkRes = await client2.query<{ status: string }>(
        'SELECT status FROM project_invitations WHERE id = $1',
        [malloryInvId],
      );
      assert.equal(checkRes.rows[0]?.status, 'expired');
    } finally {
      client2.release();
    }

    // 7c. Non-existent / unknown token
    const fakeToken = crypto.randomBytes(32).toString('hex');
    const resFake = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: frankCookie,
      },
      body: JSON.stringify({
        token: fakeToken,
      }),
    });
    assert.equal(resFake.status, 400);
    const jsonFake = await resFake.json();
    assert.equal(jsonFake.error.code, 'INVALID_INVITATION');
  });

  await t.test(
    'Test 8: Idempotency replay and conflict handling on invitation creation',
    async () => {
      // Replay identical request
      const resReplay = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: aliceCookie,
          'Idempotency-Key': 'idem_key_owner_invite_001',
        },
        body: JSON.stringify({
          email: 'Frank.Invitee@flowboard.example',
          role: 'manager',
        }),
      });

      assert.equal(resReplay.status, 201);
      const jsonReplay = await resReplay.json();
      assert.equal(jsonReplay.replayed, true);
      assert.equal(jsonReplay.data.id, frankInvitationId);

      // Conflict: same idempotency key with different payload
      const resConflict = await app.request(`/api/v1/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: aliceCookie,
          'Idempotency-Key': 'idem_key_owner_invite_001',
        },
        body: JSON.stringify({
          email: 'different.email@flowboard.example',
          role: 'viewer',
        }),
      });

      assert.equal(resConflict.status, 409);
      const jsonConflict = await resConflict.json();
      assert.equal(jsonConflict.error.code, 'IDEMPOTENCY_CONFLICT');
    },
  );
});
