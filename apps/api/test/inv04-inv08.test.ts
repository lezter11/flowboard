import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { invitationListResponseSchema, invitationSchema } from '@flowboard/contracts';

test('INV-04, INV-05 & INV-08: Invitations Lifecycle, Listing & Project Leave Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const workspaceId = 'ws_inv0408_test';
  const projectId = 'prj_inv0408_test';

  let aliceUserId = ''; // Owner
  let bobUserId = ''; // Project Manager
  let charlieUserId = ''; // Member
  let daveUserId = ''; // Viewer
  let eveUserId = ''; // Outsider
  let frankUserId = ''; // Invitee for manager invite
  let graceUserId = ''; // Invitee for member invite
  let heidiUserId = ''; // Invitee for expired test

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';
  let daveCookie = '';
  let eveCookie = '';
  let frankCookie = '';
  let graceCookie = '';
  let heidiCookie = '';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        'TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships, project_invitations, outbox CASCADE;',
      );

      // Create users & sessions
      const alice = await createDevUserAndSession('alice.owner@flowboard.example', 'Alice Owner', pool);
      aliceUserId = alice.user.id;
      aliceCookie = `flowboard_session=${alice.session.id}`;

      const bob = await createDevUserAndSession('bob.manager@flowboard.example', 'Bob Manager', pool);
      bobUserId = bob.user.id;
      bobCookie = `flowboard_session=${bob.session.id}`;

      const charlie = await createDevUserAndSession('charlie.member@flowboard.example', 'Charlie Member', pool);
      charlieUserId = charlie.user.id;
      charlieCookie = `flowboard_session=${charlie.session.id}`;

      const dave = await createDevUserAndSession('dave.viewer@flowboard.example', 'Dave Viewer', pool);
      daveUserId = dave.user.id;
      daveCookie = `flowboard_session=${dave.session.id}`;

      const eve = await createDevUserAndSession('eve.outsider@flowboard.example', 'Eve Outsider', pool);
      eveUserId = eve.user.id;
      eveCookie = `flowboard_session=${eve.session.id}`;

      const frank = await createDevUserAndSession('frank.mgrinvitee@flowboard.example', 'Frank Invitee', pool);
      frankUserId = frank.user.id;
      frankCookie = `flowboard_session=${frank.session.id}`;

      const grace = await createDevUserAndSession('grace.meminvitee@flowboard.example', 'Grace Invitee', pool);
      graceUserId = grace.user.id;
      graceCookie = `flowboard_session=${grace.session.id}`;

      const heidi = await createDevUserAndSession('heidi.expired@flowboard.example', 'Heidi Expired', pool);
      heidiUserId = heidi.user.id;
      heidiCookie = `flowboard_session=${heidi.session.id}`;

      // Create Workspace owned by Alice
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, 'Inv 04-08 Workspace', 'UTC', $2, 1, NOW(), NOW())`,
        [workspaceId, aliceUserId],
      );

      // Create Project
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, 'Inv 04-08 Project', 'Testing Resend, Revoke, List, Leave', false, 1, NOW(), NOW())`,
        [projectId, workspaceId],
      );

      // Seed Project Memberships: Bob is Manager, Charlie is Member, Dave is Viewer
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES
           ('pm_bob_mgr0408', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
           ('pm_charlie_mem0408', $1, $2, $4, 'member', 'active', 1, NOW(), NOW()),
           ('pm_dave_view0408', $1, $2, $5, 'viewer', 'active', 1, NOW(), NOW())`,
        [projectId, workspaceId, bobUserId, charlieUserId, daveUserId],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  let managerInvId = '';
  let managerRawToken = '';
  let memberInvId = '';
  let memberRawToken = '';

  // --------------------------------------------------------------------------
  // INV-04: Resend and Revoke Invitations
  // --------------------------------------------------------------------------

  await t.test('Setup: Create initial manager and member invitations', async () => {
    // 1. Owner invites Frank as manager
    const res1 = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_inv_create_mgr_01',
      },
      body: JSON.stringify({
        email: 'frank.mgrinvitee@flowboard.example',
        role: 'manager',
      }),
    });
    assert.equal(res1.status, 201);
    const json1 = await res1.json();
    managerInvId = json1.data.id;
    managerRawToken = json1.data.token;
    assert.ok(managerInvId);
    assert.ok(managerRawToken);

    // 2. Bob (PM) invites Grace as member
    const res2 = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_inv_create_mem_01',
      },
      body: JSON.stringify({
        email: 'grace.meminvitee@flowboard.example',
        role: 'member',
      }),
    });
    assert.equal(res2.status, 201);
    const json2 = await res2.json();
    memberInvId = json2.data.id;
    memberRawToken = json2.data.token;
    assert.ok(memberInvId);
    assert.ok(memberRawToken);
  });

  await t.test('INV-04: PM cannot resend manager invitation -> 403 FORBIDDEN', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations/${managerInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_resend_pm_mgr_denied',
      },
    });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error.code, 'FORBIDDEN');
  });

  await t.test('INV-04: Member / Viewer / Outsider cannot resend invitation -> 403 / 404', async () => {
    // Charlie (member) -> 403
    const resMem = await app.request(`/api/v1/projects/${projectId}/invitations/${memberInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: charlieCookie,
        'Idempotency-Key': 'key_resend_mem_denied',
      },
    });
    assert.equal(resMem.status, 403);

    // Dave (viewer) -> 403
    const resView = await app.request(`/api/v1/projects/${projectId}/invitations/${memberInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: daveCookie,
        'Idempotency-Key': 'key_resend_view_denied',
      },
    });
    assert.equal(resView.status, 403);

    // Eve (outsider) -> 404
    const resOut = await app.request(`/api/v1/projects/${projectId}/invitations/${memberInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: eveCookie,
        'Idempotency-Key': 'key_resend_out_denied',
      },
    });
    assert.equal(resOut.status, 404);
  });

  let newManagerRawToken = '';
  await t.test('INV-04: Owner resends manager invitation -> succeeds, rotates token, outbox event emitted', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations/${managerInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_resend_mgr_owner_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.replayed, false);
    const parsedInv = invitationSchema.parse(json.data);
    assert.equal(parsedInv.projectId, projectId);
    assert.equal(parsedInv.invitedBy, aliceUserId);
    assert.ok(parsedInv.createdAt);
    assert.ok(parsedInv.updatedAt);
    assert.equal(json.data.id, managerInvId);
    assert.equal(json.data.email, 'frank.mgrinvitee@flowboard.example');
    assert.equal(json.data.role, 'manager');
    assert.equal(json.data.status, 'pending');
    assert.ok(json.data.token);
    assert.notEqual(json.data.token, managerRawToken);
    newManagerRawToken = json.data.token;

    // Verify outbox record exists for invitation.created
    const outboxRes = await pool.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload FROM outbox WHERE payload->>'invitationId' = $1 ORDER BY created_at DESC LIMIT 1`,
      [managerInvId],
    );
    assert.equal(outboxRes.rows.length, 1);
    assert.ok(outboxRes.rows[0]);
    assert.equal(outboxRes.rows[0].event_type, 'invitation.created');
    assert.equal(outboxRes.rows[0].payload.invitationId, managerInvId);
  });

  await t.test('INV-04: Old rotated token cannot be accepted (400 INVALID_INVITATION)', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: frankCookie,
        'Idempotency-Key': 'key_accept_old_rotated_frank',
      },
      body: JSON.stringify({
        token: managerRawToken,
      }),
    });

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error.code, 'INVALID_INVITATION');
  });

  await t.test('INV-04: Idempotency replay on resend returns identical token and replayed=true', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations/${managerInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_resend_mgr_owner_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.replayed, true);
    assert.equal(json.data.token, newManagerRawToken);
  });

  await t.test('INV-04: PM resends member invitation -> succeeds', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations/${memberInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_resend_mem_pm_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.replayed, false);
    assert.equal(json.data.id, memberInvId);
    assert.equal(json.data.role, 'member');
    assert.notEqual(json.data.token, memberRawToken);
    memberRawToken = json.data.token;
  });

  await t.test('INV-04: PM cannot revoke manager invitation -> 403 FORBIDDEN', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations/${managerInvId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_revoke_pm_mgr_denied',
      },
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error.code, 'FORBIDDEN');
  });

  await t.test('INV-04: PM revokes member invitation -> succeeds', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations/${memberInvId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_revoke_pm_mem_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.replayed, false);
    assert.equal(json.data.success, true);
    assert.equal(json.data.id, memberInvId);
    assert.equal(json.data.status, 'revoked');

    // Verify DB status
    const dbRes = await pool.query<{ status: string }>('SELECT status FROM project_invitations WHERE id = $1', [
      memberInvId,
    ]);
    assert.ok(dbRes.rows[0]);
    assert.equal(dbRes.rows[0]!.status, 'revoked');
  });

  await t.test('INV-04: Revoked invitation token cannot be accepted -> 400 INVALID_INVITATION', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: graceCookie,
        'Idempotency-Key': 'key_accept_revoked_grace',
      },
      body: JSON.stringify({
        token: memberRawToken,
      }),
    });

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error.code, 'INVALID_INVITATION');
  });

  await t.test('INV-04: Revoked invitation cannot be revoked again or resent -> 400 INVALID_INVITATION', async () => {
    // Cannot revoke again
    const resRevokeAgain = await app.request(`/api/v1/projects/${projectId}/invitations/${memberInvId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_revoke_pm_mem_again',
      },
    });
    assert.equal(resRevokeAgain.status, 400);
    const jsonRevoke = await resRevokeAgain.json();
    assert.equal(jsonRevoke.error.code, 'INVALID_INVITATION');

    // Cannot resend revoked
    const resResendRevoked = await app.request(`/api/v1/projects/${projectId}/invitations/${memberInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_resend_pm_mem_revoked',
      },
    });
    assert.equal(resResendRevoked.status, 400);
    const jsonResend = await resResendRevoked.json();
    assert.equal(jsonResend.error.code, 'INVALID_INVITATION');
  });

  await t.test('INV-04: Newly rotated token can be accepted; accepted invite cannot be resent -> 400', async () => {
    // Frank accepts rotated manager token
    const resAccept = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: frankCookie,
        'Idempotency-Key': 'key_accept_new_mgr_frank',
      },
      body: JSON.stringify({
        token: newManagerRawToken,
      }),
    });
    assert.equal(resAccept.status, 200);

    // Resend on accepted invitation -> 400
    const resResendAccepted = await app.request(`/api/v1/projects/${projectId}/invitations/${managerInvId}/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_resend_accepted_mgr',
      },
    });
    assert.equal(resResendAccepted.status, 400);
    const jsonAccepted = await resResendAccepted.json();
    assert.equal(jsonAccepted.error.code, 'INVALID_INVITATION');
  });

  // --------------------------------------------------------------------------
  // INV-05: Pending Invitations List
  // --------------------------------------------------------------------------

  let expiredInvId = '';
  await t.test('Setup: Create an expired invitation for Heidi', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_create_heidi_expired',
      },
      body: JSON.stringify({
        email: 'heidi.expired@flowboard.example',
        role: 'viewer',
      }),
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    expiredInvId = json.data.id;

    // Backdate expires_at to 2 hours ago
    await pool.query(`UPDATE project_invitations SET expires_at = NOW() - INTERVAL '2 hours' WHERE id = $1`, [
      expiredInvId,
    ]);
  });

  await t.test('INV-05: Workspace owner lists invitations -> succeeds, matches schema, token_hash omitted', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'GET',
      headers: {
        Cookie: aliceCookie,
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();

    // Validate envelope and item schema using contract
    const parsed = invitationListResponseSchema.safeParse(json);
    assert.ok(parsed.success, `Schema validation failed: ${JSON.stringify(parsed.error?.issues)}`);

    // Verify list contains all created invitations
    assert.ok(json.data.length >= 3);

    // Verify token_hash is NEVER present on any item
    for (const item of json.data) {
      assert.equal((item as any).token_hash, undefined);
      assert.equal((item as any).tokenHash, undefined);
      assert.ok(item.id);
      assert.ok(item.email);
      assert.ok(item.role);
      assert.ok(item.status);
      assert.ok(item.expiresAt);
      assert.ok(item.createdAt);
      assert.ok(item.updatedAt);
      assert.ok(item.invitedBy);
    }

    // Verify Heidi's past-due pending invitation is mapped to 'expired'
    const heidiItem = json.data.find((it: any) => it.id === expiredInvId);
    assert.ok(heidiItem);
    assert.equal(heidiItem.status, 'expired');
  });

  await t.test('INV-05: Project Manager can list invitations', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'GET',
      headers: {
        Cookie: bobCookie,
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length >= 3);
  });

  await t.test('INV-05: Member / Viewer cannot list invitations -> 403 FORBIDDEN', async () => {
    // Charlie (member)
    const resMem = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'GET',
      headers: {
        Cookie: charlieCookie,
      },
    });
    assert.equal(resMem.status, 403);

    // Dave (viewer)
    const resView = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'GET',
      headers: {
        Cookie: daveCookie,
      },
    });
    assert.equal(resView.status, 403);
  });

  await t.test('INV-05: Outsider attempting to list invitations -> 404 NOT_FOUND', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'GET',
      headers: {
        Cookie: eveCookie,
      },
    });
    assert.equal(res.status, 404);
  });

  // --------------------------------------------------------------------------
  // INV-08: Leave a Project
  // --------------------------------------------------------------------------

  await t.test('INV-08: Workspace owner cannot leave their own project -> 403 FORBIDDEN', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_leave_owner_denied',
      },
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error.code, 'FORBIDDEN');
  });

  await t.test('INV-08: Outsider attempting to leave project -> 404 NOT_FOUND', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: eveCookie,
        'Idempotency-Key': 'key_leave_outsider_denied',
      },
    });

    assert.equal(res.status, 404);
  });

  await t.test('INV-08: Charlie (Member) leaves project -> status="removed", version incremented', async () => {
    // 1. Get current version before leave
    const prevRes = await pool.query<{ version: number; status: string }>(
      `SELECT version, status FROM project_memberships WHERE project_id = $1 AND user_id = $2`,
      [projectId, charlieUserId],
    );
    assert.ok(prevRes.rows[0]);
    assert.equal(prevRes.rows[0]!.status, 'active');
    const prevVersion = prevRes.rows[0]!.version;

    // 2. Charlie calls leave
    const res = await app.request(`/api/v1/projects/${projectId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: charlieCookie,
        'Idempotency-Key': 'key_leave_charlie_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.replayed, false);
    assert.equal(json.data.success, true);

    // 3. Verify DB state: status = 'removed' and version incremented
    const afterRes = await pool.query<{ version: number; status: string }>(
      `SELECT version, status FROM project_memberships WHERE project_id = $1 AND user_id = $2`,
      [projectId, charlieUserId],
    );
    assert.ok(afterRes.rows[0]);
    assert.equal(afterRes.rows[0]!.status, 'removed');
    assert.equal(afterRes.rows[0]!.version, prevVersion + 1);
  });

  await t.test('INV-08: Charlie subsequent access to project returns 404 NOT_FOUND', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'GET',
      headers: {
        Cookie: charlieCookie,
      },
    });
    assert.equal(res.status, 404);
  });

  await t.test('INV-08: Charlie leave request idempotency replay returns 200 replayed=true', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: charlieCookie,
        'Idempotency-Key': 'key_leave_charlie_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.replayed, true);
    assert.equal(json.data.success, true);
  });

  await t.test('INV-08: Dave (Viewer) leaves project -> succeeds', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: daveCookie,
        'Idempotency-Key': 'key_leave_dave_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.success, true);

    // Verify DB state
    const afterRes = await pool.query<{ status: string }>(
      `SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2`,
      [projectId, daveUserId],
    );
    assert.ok(afterRes.rows[0]);
    assert.equal(afterRes.rows[0]!.status, 'removed');
  });

  await t.test('INV-08: Bob (Manager) leaves project -> succeeds', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'key_leave_bob_ok',
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.success, true);

    // Verify DB state
    const afterRes = await pool.query<{ status: string }>(
      `SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2`,
      [projectId, bobUserId],
    );
    assert.ok(afterRes.rows[0]);
    assert.equal(afterRes.rows[0]!.status, 'removed');
  });

  // --------------------------------------------------------------------------
  // R2 & Security Finding 1 (CWE-863): Invitation Fencing & Revocation Regression Suite
  // --------------------------------------------------------------------------

  let oscarUserId = '';
  let oscarCookie = '';
  let oscarPendingInvId = '';
  let oscarOldToken = '';

  await t.test('Setup R2: Create user Oscar and seed pending invite + manager membership', async () => {
    const oscar = await createDevUserAndSession('oscar.manager@flowboard.example', 'Oscar Manager', pool);
    oscarUserId = oscar.user.id;
    oscarCookie = `flowboard_session=${oscar.session.id}`;

    // 1. Oscar has a pending invite for his own email (token generated)
    oscarOldToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(oscarOldToken).digest('hex');
    oscarPendingInvId = 'inv_oscar_backdoor_' + crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO project_invitations (
           id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, 'manager', $5, $6, 'pending', NOW() + INTERVAL '7 days', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes'
         )`,
        [oscarPendingInvId, projectId, workspaceId, 'oscar.manager@flowboard.example', tokenHash, aliceUserId],
      );

      // Oscar is also made an active manager
      await client.query(
        `INSERT INTO project_memberships (
           id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, 'manager', 'active', 1, NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes'
         )
         ON CONFLICT (project_id, user_id) DO UPDATE SET status = 'active', role = 'manager', updated_at = NOW()`,
        ['pm_oscar_mgr', projectId, workspaceId, oscarUserId],
      );
    } finally {
      client.release();
    }
  });

  await t.test('R2 - Step 1: Active manager cannot create self-invite or duplicate pending invite', async () => {
    // 1. Self-invite by active manager is rejected with 400 ALREADY_MEMBER
    const resSelf = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_oscar_self_denied',
      },
      body: JSON.stringify({
        email: 'oscar.manager@flowboard.example',
        role: 'member',
      }),
    });
    assert.equal(resSelf.status, 400);
    const jsonSelf = await resSelf.json();
    assert.equal(jsonSelf.error.code, 'ALREADY_MEMBER');

    // 2. Oscar creates a pending invite for teammate Trent
    const trentUser = await createDevUserAndSession('trent.teammate@flowboard.example', 'Trent Teammate', pool);
    const resTrent = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_oscar_invite_trent',
      },
      body: JSON.stringify({
        email: 'trent.teammate@flowboard.example',
        role: 'member',
      }),
    });
    assert.equal(resTrent.status, 201);

    // 3. Duplicate invitation to Trent while pending is rejected
    const resTrentDup = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_oscar_invite_trent_dup',
      },
      body: JSON.stringify({
        email: 'trent.teammate@flowboard.example',
        role: 'member',
      }),
    });
    assert.equal(resTrentDup.status, 400);
    const jsonTrentDup = await resTrentDup.json();
    assert.equal(jsonTrentDup.error.code, 'INVITATION_ALREADY_EXISTS');
  });

  await t.test('R2 - Steps 2 & 3: Owner removes Manager -> pending invitation is atomically marked revoked', async () => {
    // Owner deletes Oscar's membership
    const resRemove = await app.request(`/api/v1/projects/${projectId}/members/${oscarUserId}`, {
      method: 'DELETE',
      headers: {
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_remove_oscar_member',
      },
    });
    assert.equal(resRemove.status, 200);

    // Verify Oscar membership is status = 'removed'
    const memRes = await pool.query<{ status: string }>(
      'SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, oscarUserId],
    );
    assert.equal(memRes.rows[0]?.status, 'removed');

    // Verify Oscar's pending invitation is atomically marked 'revoked'
    const invRes = await pool.query<{ status: string }>(
      'SELECT status FROM project_invitations WHERE id = $1',
      [oscarPendingInvId],
    );
    assert.equal(invRes.rows[0]?.status, 'revoked');
  });

  await t.test('R2 - Step 4: Attacker presenting old revoked token fails -> 400 INVALID_INVITATION, access remains removed', async () => {
    const resAccept = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_accept_oscar_revoked_token',
      },
      body: JSON.stringify({
        token: oscarOldToken,
      }),
    });

    assert.equal(resAccept.status, 400);
    const jsonAccept = await resAccept.json();
    assert.equal(jsonAccept.error.code, 'INVALID_INVITATION');

    // Verify Oscar's membership remains 'removed'
    const memRes = await pool.query<{ status: string }>(
      'SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, oscarUserId],
    );
    assert.equal(memRes.rows[0]?.status, 'removed');

    // Verify Oscar cannot access the project
    const projRes = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'GET',
      headers: { Cookie: oscarCookie },
    });
    assert.equal(projRes.status, 404);
  });

  await t.test('R2 - Step 4b (Defense-in-depth): If invitation was pending but issued before removal, acceptance fails -> 400 INVITATION_SUPERSEDED', async () => {
    // Temporarily set the invitation back to 'pending', but with created_at <= Oscar's membership updated_at
    const memRes = await pool.query<{ updated_at: Date }>(
      'SELECT updated_at FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, oscarUserId],
    );
    const memberUpdatedAt = memRes.rows[0]!.updated_at;

    const priorDate = new Date(new Date(memberUpdatedAt).getTime() - 60000);
    await pool.query(
      `UPDATE project_invitations
       SET status = 'pending', created_at = $1, updated_at = NOW()
       WHERE id = $2`,
      [priorDate, oscarPendingInvId],
    );

    const resAccept = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_accept_oscar_superseded_token',
      },
      body: JSON.stringify({
        token: oscarOldToken,
      }),
    });

    assert.equal(resAccept.status, 400);
    const jsonAccept = await resAccept.json();
    assert.equal(jsonAccept.error.code, 'INVITATION_SUPERSEDED');
    assert.match(jsonAccept.error.message, /issued before project access was revoked/i);

    // Membership remains 'removed'
    const afterMemRes = await pool.query<{ status: string }>(
      'SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, oscarUserId],
    );
    assert.equal(afterMemRes.rows[0]?.status, 'removed');

    // Reset status back to 'revoked'
    await pool.query(
      `UPDATE project_invitations SET status = 'revoked', updated_at = NOW() WHERE id = $1`,
      [oscarPendingInvId],
    );
  });

  let oscarFreshToken = '';
  await t.test('R2 - Step 5: Owner issues fresh invitation to the deliberately removed user -> succeeds (201)', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'key_reinvite_oscar_fresh',
      },
      body: JSON.stringify({
        email: 'oscar.manager@flowboard.example',
        role: 'member',
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.email, 'oscar.manager@flowboard.example');
    assert.equal(json.data.role, 'member');
    assert.equal(json.data.status, 'pending');
    assert.ok(json.data.token);
    assert.notEqual(json.data.token, oscarOldToken);
    oscarFreshToken = json.data.token;
  });

  await t.test('R2 - Step 6: User accepts fresh invitation -> succeeds (200), membership reactivated to active', async () => {
    const resAccept = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_accept_oscar_fresh_token',
      },
      body: JSON.stringify({
        token: oscarFreshToken,
      }),
    });

    assert.equal(resAccept.status, 200);
    const jsonAccept = await resAccept.json();
    assert.equal(jsonAccept.data.success, true);
    assert.equal(jsonAccept.data.role, 'member');

    // Verify DB state: Oscar's membership is now 'active'
    const memRes = await pool.query<{ status: string; role: string }>(
      'SELECT status, role FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, oscarUserId],
    );
    assert.equal(memRes.rows[0]?.status, 'active');
    assert.equal(memRes.rows[0]?.role, 'member');

    // Verify Oscar can now access the project again
    const projRes = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'GET',
      headers: { Cookie: oscarCookie },
    });
    assert.equal(projRes.status, 200);
  });

  await t.test('R2 - Step 7: Member leaves project -> pending invitations for that email are atomically revoked', async () => {
    // Oscar has another pending invite (e.g. created for a viewer role)
    const extraToken = crypto.randomBytes(32).toString('hex');
    const extraHash = crypto.createHash('sha256').update(extraToken).digest('hex');
    const extraInvId = 'inv_oscar_leave_' + crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO project_invitations (
           id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, 'viewer', $5, $6, 'pending', NOW() + INTERVAL '7 days', NOW(), NOW()
         )`,
        [extraInvId, projectId, workspaceId, 'oscar.manager@flowboard.example', extraHash, aliceUserId],
      );
    } finally {
      client.release();
    }

    // Oscar leaves the project
    const resLeave = await app.request(`/api/v1/projects/${projectId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_oscar_final_leave',
      },
    });
    assert.equal(resLeave.status, 200);

    // Verify extra pending invitation was atomically marked revoked
    const checkInv = await pool.query<{ status: string }>(
      'SELECT status FROM project_invitations WHERE id = $1',
      [extraInvId],
    );
    assert.equal(checkInv.rows[0]?.status, 'revoked');

    // Attempting to accept revoked extraToken fails
    const resAccept = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: oscarCookie,
        'Idempotency-Key': 'key_accept_oscar_revoked_extra',
      },
      body: JSON.stringify({
        token: extraToken,
      }),
    });
    assert.equal(resAccept.status, 400);
  });
});
