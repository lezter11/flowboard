import assert from 'node:assert/strict';
import { insertWorkspaceForCookie } from './support/workspace-fixture.ts';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession, createSession } from '../src/adapters/session.ts';

import { processOutboxLease } from '../src/adapters/notifications.ts';

test('ACC-02, ACC-03, ACC-05, ACC-06, ACC-07, INV-02: Account Lifecycle & Administration Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  let owner: { cookie: string; user: { id: string; email: string; displayName: string } };
  let member: { cookie: string; user: { id: string; email: string; displayName: string } };
  let candidate: { cookie: string; user: { id: string; email: string; displayName: string } };
  let workspaceId = '';
  let projectId = '';
  let keyCounter = 0;

  function nextKey(prefix = 'acc-lifecycle'): string {
    keyCounter++;
    return `idem_${prefix}_${Date.now()}_${keyCounter.toString().padStart(6, '0')}`;
  }

  before(async () => {
    await runMigrations(pool);

    const devOwner = await createDevUserAndSession('workspace-owner@example.com', 'Initial Owner');
    owner = {
      cookie: `flowboard_session=${devOwner.session.id}`,
      user: devOwner.user,
    };

    const devMember = await createDevUserAndSession('workspace-member@example.com', 'Team Member');
    member = {
      cookie: `flowboard_session=${devMember.session.id}`,
      user: devMember.user,
    };

    const devCandidate = await createDevUserAndSession(`candidate-${Date.now()}@example.com`, 'Candidate Owner');
    candidate = {
      cookie: `flowboard_session=${devCandidate.session.id}`,
      user: devCandidate.user,
    };

    // 1. Create Workspace owned by owner
    // B-20: POST /api/v1/workspaces is retired; the fixture inserts the owner's workspace.
    workspaceId = (await insertWorkspaceForCookie(owner.cookie, { name: 'Lifecycle Corp Workspace' })).id;

    // 2. Create Project in Workspace
    const prjRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('prj-create'),
      },
      body: JSON.stringify({
        name: 'Project Delta',
        description: 'Testing lifecycle features',
      }),
    });
    assert.equal(prjRes.status, 201);
    const prjJson = (await prjRes.json()) as any;
    projectId = prjJson.data.id;

    // 3. Add member to Project
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'member', 'active', NOW(), NOW())`,
        ['pm_' + crypto.randomUUID(), projectId, workspaceId, member.user.id],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  await t.test('ACC-02: Sign out and expired session revocation', async () => {
    // 1. Create a dedicated session for logout testing
    const tempDev = await createDevUserAndSession('temp-logout@example.com', 'Temp Logout User');
    const tempCookie = `flowboard_session=${tempDev.session.id}`;

    // Verify session is valid
    const checkRes = await app.request('/api/v1/session', {
      headers: { 'Cookie': tempCookie },
    });
    assert.equal(checkRes.status, 200);

    // 2. Logout revokes server session in DB and clears cookie
    const logoutRes = await app.request('/api/v1/session/logout', {
      method: 'POST',
      headers: { 'Cookie': tempCookie },
    });
    assert.equal(logoutRes.status, 204);

    const setCookie = logoutRes.headers.get('set-cookie');
    assert.ok(setCookie, 'Expected Set-Cookie clearing header');
    assert.match(setCookie, /flowboard_session=;/);

    // 3. Subsequent request with revoked cookie returns 401 UNAUTHORIZED
    const afterLogoutRes = await app.request('/api/v1/session', {
      headers: { 'Cookie': tempCookie },
    });
    assert.equal(afterLogoutRes.status, 401);

    // 4. Create an already expired session in database
    const client = await pool.connect();
    let expiredSessionId = '';
    try {
      const expRes = await client.query<{ id: string }>(
        `INSERT INTO sessions (id, user_id, expires_at, created_at)
         VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '2 hours')
         RETURNING id`,
        [crypto.randomBytes(32).toString('hex'), tempDev.user.id],
      );
      expiredSessionId = expRes.rows[0]?.id || '';
    } finally {
      client.release();
    }

    // 5. Request with expired session returns 401 UNAUTHORIZED
    const expiredRes = await app.request('/api/v1/session', {
      headers: { 'Cookie': `flowboard_session=${expiredSessionId}` },
    });
    assert.equal(expiredRes.status, 401);
  });

  await t.test('ACC-03: Profile updates and historical identity preservation', async () => {
    // 1. Update user profile (name and avatarUrl)
    const patchRes = await app.request('/api/v1/session/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
      },
      body: JSON.stringify({ displayName: 'Member Renamed' }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as any;
    assert.equal(patchJson.data.displayName, 'Member Renamed');
    // Avatar is Google-owned (B-9): a profile PATCH cannot set it.
    assert.equal(patchJson.data.avatarUrl, null);

    // 2. Revoke member access (simulate departure)
    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE project_memberships SET status = 'removed' WHERE project_id = $1 AND user_id = $2",
        [projectId, member.user.id],
      );
    } finally {
      client.release();
    }

    // 3. Profile query by session reflects updated name and avatar
    const sessRes = await app.request('/api/v1/session', {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(sessRes.status, 200);
    const sessJson = (await sessRes.json()) as any;
    assert.equal(sessJson.data.actor.displayName, 'Member Renamed');
    assert.equal(sessJson.data.actor.avatarUrl, null);

    // Restore member membership for subsequent tests
    const restoreClient = await pool.connect();
    try {
      await restoreClient.query(
        "UPDATE project_memberships SET status = 'active' WHERE project_id = $1 AND user_id = $2",
        [projectId, member.user.id],
      );
    } finally {
      restoreClient.release();
    }
  });

  await t.test('ACC-05: Workspace preferences (name and timezone with OCC)', async () => {
    // 1. Non-owner attempting to update preferences returns 403 FORBIDDEN
    const nonOwnerRes = await app.request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
      },
      body: JSON.stringify({
        name: 'Hacked Workspace Name',
        expectedVersion: 1,
      }),
    });
    assert.equal(nonOwnerRes.status, 403);

    // 2. Stale version returns 409 STALE_VERSION
    const staleRes = await app.request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
      },
      body: JSON.stringify({
        name: 'New Name',
        expectedVersion: 999,
      }),
    });
    assert.equal(staleRes.status, 409);

    // 3. Workspace owner updates name and timezone successfully
    const okRes = await app.request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
      },
      body: JSON.stringify({
        name: 'Updated Workspace Alpha',
        timezone: 'America/New_York',
        expectedVersion: 1,
      }),
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as any;
    assert.equal(okJson.data.name, 'Updated Workspace Alpha');
    assert.equal(okJson.data.timezone, 'America/New_York');
    assert.equal(okJson.data.version, 2);
  });

  await t.test('ACC-06: Owned and invited context switcher', async () => {
    // 1. Owner session returns ownedWorkspaces containing workspaceId and accessibleProjects containing projectId
    const ownerSessRes = await app.request('/api/v1/session', {
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(ownerSessRes.status, 200);
    const ownerSessJson = (await ownerSessRes.json()) as any;
    const ownedIds = ownerSessJson.data.ownedWorkspaces.map((w: any) => w.id);
    assert.ok(ownedIds.includes(workspaceId), 'Owner sees owned workspace');

    // 2. Member session returns ownedWorkspaces = [] and accessibleProjects containing granted projectId
    const memberSessRes = await app.request('/api/v1/session', {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(memberSessRes.status, 200);
    const memberSessJson = (await memberSessRes.json()) as any;
    const memberOwnedIds = memberSessJson.data.ownedWorkspaces.map((w: any) => w.id);
    assert.ok(!memberOwnedIds.includes(workspaceId), 'Member does not own workspace');

    const memberProjectIds = memberSessJson.data.accessibleProjects.map((p: any) => p.id);
    assert.ok(memberProjectIds.includes(projectId), 'Member sees granted project');

    // 3. Stranger user not in workspace has zero workspaces and zero projects
    const strangerDev = await createDevUserAndSession(`stranger_${Date.now()}@example.com`, 'Stranger');
    const candSessRes = await app.request('/api/v1/session', {
      headers: { 'Cookie': `flowboard_session=${strangerDev.session.id}` },
    });
    assert.equal(candSessRes.status, 200);
    const candSessJson = (await candSessRes.json()) as any;
    assert.equal(candSessJson.data.ownedWorkspaces.length, 0);
    assert.equal(candSessJson.data.accessibleProjects.length, 0);
  });

  await t.test('ACC-07: Owner transfer atomic transition and idempotency', async () => {
    // B-20: the transfer route is retired. Owner, member and stranger all get 410 after authentication,
    // and nothing changes (edge-case review F-06).
    for (const [label, cookie] of [['owner', owner.cookie], ['member', member.cookie]] as const) {
      const retired = await app.request(`/api/v1/workspaces/${workspaceId}/transfer-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie, 'Idempotency-Key': nextKey(`retired-${label}`) },
        body: JSON.stringify({ targetUserId: candidate.user.id, expectedVersion: 2 }),
      });
      assert.equal(retired.status, 410, label);
      assert.equal(((await retired.json()) as any).error.code, 'TRANSFER_OWNERSHIP_RETIRED', label);
    }
    const ownerRowBefore = await getPool().query<{ owner_id: string; version: number }>(`SELECT owner_id, version FROM workspaces WHERE id = $1`, [workspaceId]);
    assert.equal(ownerRowBefore.rows[0]!.owner_id, owner.user.id, 'the retired route changed nothing');

    // The owner change itself is made directly, the way a future owner change would be, so the checks that
    // follow still cover a former owner.
    await getPool().query(`UPDATE workspaces SET owner_id = $2, version = version + 1, updated_at = NOW() WHERE id = $1`, [workspaceId, candidate.user.id]);

    // 5. Former owner attempting another owner action now receives 403 FORBIDDEN
    const formerOwnerRes = await app.request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
      },
      body: JSON.stringify({
        name: 'Former Owner Should Fail',
        expectedVersion: 3,
      }),
    });
    assert.equal(formerOwnerRes.status, 403);

    // 6. New owner has full authority
    const newOwnerRes = await app.request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': candidate.cookie,
      },
      body: JSON.stringify({
        name: 'Candidate Now In Charge',
        expectedVersion: 3,
      }),
    });
    assert.equal(newOwnerRes.status, 200);
  });

  await t.test('INV-02: Invitation delivery through the configured mailer', async () => {
    const sentMail: Array<{ to: string; subject: string; text: string; html: string }> = [];
    const recordingMailer = {
      appOrigin: 'https://flowboard.example',
      async send(message: { to: string; subject: string; text: string; html: string }) {
        sentMail.push(message);
        return { status: 'sent' as const, providerMessageId: 'test-message' };
      },
    };

    // 1. Create invitation to trigger outbox record
    const invRes = await app.request(`/api/v1/projects/${projectId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': candidate.cookie,
        'Idempotency-Key': nextKey('inv-delivery'),
      },
      body: JSON.stringify({
        email: 'invitee-delivery@example.com',
        role: 'member',
      }),
    });
    assert.equal(invRes.status, 201);
    const invJson = (await invRes.json()) as any;
    const invId = invJson.data.id;

    // 2. Process outbox lease
    // A large batch: other suites leave pending invitation rows in the shared database, drained oldest first.
    const procRes = await processOutboxLease(pool, { batchSize: 1000, maxRetries: 3, mailer: recordingMailer });
    assert.ok(procRes.delivered >= 1);

    // The mailer received the invitation, with the accept link built from the configured origin.
    const sent = sentMail.find((m) => m.to === 'invitee-delivery@example.com');
    assert.ok(sent, 'mailer received the invitation');
    assert.match(sent!.text, /https:\/\/flowboard\.example\/invitation\?token=[0-9a-f]{64}/);
    void invId;

    // 3. Verify no secret link is stored in outbox payload
    const client = await pool.connect();
    try {
      // The receipt keeps only the provider id (B-14), so the row is the newest delivered invitation.
      const outRes = await client.query<{ payload: any; status: string }>(
        `SELECT payload, status FROM outbox WHERE event_type = 'invitation.created' AND status = 'delivered' ORDER BY created_at DESC LIMIT 1`,
      );
      assert.ok(outRes.rows.length >= 1);
      const outRow = outRes.rows[0]!;
      assert.equal(outRow.status, 'delivered');
      const payloadStr = JSON.stringify(outRow.payload);
      assert.ok(!payloadStr.includes('token='), 'Must not contain token');
      assert.ok(!payloadStr.includes('secret'), 'Must not contain secret');
      assert.deepEqual(Object.keys(outRow.payload), ['providerMessageId'], 'the receipt holds only the provider id');
    } finally {
      client.release();
    }
  });
});
