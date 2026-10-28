import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { setGlobalPool } from '../../../apps/api/src/adapters/postgres.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL']!;
assert.ok(testUrl, 'FLOWBOARD_ACCESS_TEST_DATABASE_URL must be defined');
const url = new URL(testUrl);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55479');
assert.equal(url.pathname, '/flowboard_access_test');

const schema = `review8_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: testUrl, max: 2 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: testUrl, max: 10, options: `-c search_path=${schema}` });

try {
  await runMigrations(pool);

  // Setup actors
  const owner = await createDevUserAndSession('r8-owner@test.invalid', 'Owner', pool);
  const nextOwner = await createDevUserAndSession('r8-next@test.invalid', 'NextOwner', pool);
  const manager = await createDevUserAndSession('r8-manager@test.invalid', 'Manager', pool);
  const member = await createDevUserAndSession('r8-member@test.invalid', 'Member', pool);
  const outsider = await createDevUserAndSession('r8-outsider@test.invalid', 'Outsider', pool);

  await pool.query(
    `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
     VALUES ('w_r8', 'Review8 Workspace', 'UTC', $1, 1, NOW(), NOW())`,
    [owner.user.id],
  );

  await pool.query(
    `INSERT INTO projects (id, workspace_id, name, archived, version, created_at, updated_at)
     VALUES ('p_r8', 'w_r8', 'Review8 Project', FALSE, 1, NOW(), NOW())`,
  );

  await pool.query(
    `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
     VALUES 
       ('pm_mgr', 'p_r8', 'w_r8', $1, 'manager', 'active', 1, NOW(), NOW()),
       ('pm_mbr', 'p_r8', 'w_r8', $2, 'member', 'active', 1, NOW(), NOW())`,
    [manager.user.id, member.user.id],
  );

  const app = createApp(async () => {}, { pool, deadlineMs: 30000 });
  const req = (
    method: string,
    path: string,
    session: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    app.request(`http://localhost/api/v1${path}`, {
      method,
      headers: {
        cookie: `flowboard_session=${session}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': headers?.['Idempotency-Key'] ?? `r8-key-${crypto.randomUUID()}`,
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  console.log('--- Probing BAR7-01: Project create, archive, reopen authority after ownership transfer ---');

  // Verify owner can archive initially
  const archiveKey1 = `r8-arch-${crypto.randomUUID()}`;
  const initArch = await req('POST', '/projects/p_r8/archive', owner.session.id, {}, { 'Idempotency-Key': archiveKey1 });
  assert.equal(initArch.status, 200, 'Initial owner archive must succeed');

  // Reopen
  const reopenKey1 = `r8-reopen-${crypto.randomUUID()}`;
  const initReopen = await req('POST', '/projects/p_r8/reopen', owner.session.id, {}, { 'Idempotency-Key': reopenKey1 });
  assert.equal(initReopen.status, 200, 'Initial owner reopen must succeed');

  // Transfer workspace ownership to nextOwner
  const wsVersion = (await pool.query<{ version: number }>('SELECT version FROM workspaces WHERE id = $1', ['w_r8'])).rows[0]!.version;
  const transferRes = await req('POST', '/workspaces/w_r8/transfer-ownership', owner.session.id, {
    targetUserId: nextOwner.user.id,
    expectedVersion: wsVersion,
  });
  assert.equal(transferRes.status, 200, 'Ownership transfer must succeed');
  assert.equal(
    (await pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE id = $1', ['w_r8'])).rows[0]!.owner_id,
    nextOwner.user.id,
  );

  // 1. Former owner cannot create project
  const createByFormer = await req('POST', '/workspaces/w_r8/projects', owner.session.id, {
    name: 'Disallowed Project By Former Owner',
  });
  assert.equal(createByFormer.status, 404, 'Former owner cannot create projects (404 expected)');

  // 2. Former owner cannot archive project
  const archByFormer = await req('POST', '/projects/p_r8/archive', owner.session.id);
  assert.equal(archByFormer.status, 404, 'Former owner cannot archive project (404 expected)');

  // 3. Former owner cannot reopen project
  const reopenByFormer = await req('POST', '/projects/p_r8/reopen', owner.session.id);
  assert.equal(reopenByFormer.status, 404, 'Former owner cannot reopen project (404 expected)');

  console.log('BAR7-01 verified: Former owner denied 404 for project create, archive, reopen.');

  console.log('--- Probing BAR7-02: Manager cannot invite, resend, or revoke manager invitations ---');

  // Manager attempts to invite manager -> 403
  const mgrInviteMgr = await req('POST', '/projects/p_r8/invitations', manager.session.id, {
    email: 'forbidden-mgr@test.invalid',
    role: 'manager',
  });
  assert.equal(mgrInviteMgr.status, 403, 'Manager inviting manager must be 403 FORBIDDEN');

  // Current owner invites manager -> 201
  const ownerInvMgrRes = await req('POST', '/projects/p_r8/invitations', nextOwner.session.id, {
    email: 'valid-mgr@test.invalid',
    role: 'manager',
  });
  assert.equal(ownerInvMgrRes.status, 201, 'Owner inviting manager must succeed (201)');
  const ownerMgrInv = (await ownerInvMgrRes.json()).data;

  // Manager attempts to resend manager invitation -> 403
  const mgrResendMgr = await req('POST', `/projects/p_r8/invitations/${ownerMgrInv.id}/resend`, manager.session.id);
  assert.equal(mgrResendMgr.status, 403, 'Manager resending manager invitation must be 403 FORBIDDEN');

  // Manager attempts to revoke manager invitation -> 403
  const mgrRevokeMgr = await req('POST', `/projects/p_r8/invitations/${ownerMgrInv.id}/revoke`, manager.session.id);
  assert.equal(mgrRevokeMgr.status, 403, 'Manager revoking manager invitation must be 403 FORBIDDEN');

  // Owner can resend manager invitation -> 200
  const ownerResendMgr = await req('POST', `/projects/p_r8/invitations/${ownerMgrInv.id}/resend`, nextOwner.session.id);
  assert.equal(ownerResendMgr.status, 200, 'Owner can resend manager invitation');

  // Owner can revoke manager invitation -> 200
  const ownerRevokeMgr = await req('POST', `/projects/p_r8/invitations/${ownerMgrInv.id}/revoke`, nextOwner.session.id);
  assert.equal(ownerRevokeMgr.status, 200, 'Owner can revoke manager invitation');

  console.log('BAR7-02 verified: Manager cannot invite, resend, or revoke manager invitations (403).');

  console.log('--- Probing BAR7-03: Membership PATCH/DELETE and invitation receipts cannot be replayed after authority loss ---');

  // NextOwner creates an invitation with an explicit idempotency key
  const invKey = `r8-inv-replay-${crypto.randomUUID()}`;
  const invCreateRes = await req('POST', '/projects/p_r8/invitations', nextOwner.session.id, {
    email: 'replay-test@test.invalid',
    role: 'member',
  }, { 'Idempotency-Key': invKey });
  assert.equal(invCreateRes.status, 201);

  // Former owner attempts to replay invitation creation receipt with same key -> 404
  const formerInvReplay = await req('POST', '/projects/p_r8/invitations', owner.session.id, {
    email: 'replay-test@test.invalid',
    role: 'member',
  }, { 'Idempotency-Key': invKey });
  assert.equal(formerInvReplay.status, 404, 'Former owner cannot replay invitation creation receipt (404 expected)');

  // NextOwner modifies member role with an idempotency key
  const patchKey = `r8-patch-replay-${crypto.randomUUID()}`;
  const curMemVer = (await pool.query<{ version: number }>('SELECT version FROM project_memberships WHERE id = $1', ['pm_mbr'])).rows[0]!.version;
  const patchRes = await req('PATCH', `/projects/p_r8/members/${member.user.id}`, nextOwner.session.id, {
    role: 'viewer',
    status: 'active',
    expectedVersion: curMemVer,
  }, { 'Idempotency-Key': patchKey });
  assert.equal(patchRes.status, 200);

  // Former owner attempts to replay PATCH receipt -> 404
  const formerPatchReplay = await req('PATCH', `/projects/p_r8/members/${member.user.id}`, owner.session.id, {
    role: 'viewer',
    status: 'active',
    expectedVersion: curMemVer,
  }, { 'Idempotency-Key': patchKey });
  assert.equal(formerPatchReplay.status, 404, 'Former owner cannot replay PATCH receipt (404 expected)');

  // Revoked member attempts to replay PATCH receipt -> 404
  const outsiderPatchReplay = await req('PATCH', `/projects/p_r8/members/${member.user.id}`, outsider.session.id, {
    role: 'viewer',
    status: 'active',
    expectedVersion: curMemVer,
  }, { 'Idempotency-Key': patchKey });
  assert.equal(outsiderPatchReplay.status, 404, 'Outsider cannot replay PATCH receipt (404 expected)');

  // NextOwner deletes member with an idempotency key
  const deleteKey = `r8-delete-replay-${crypto.randomUUID()}`;
  const delRes = await req('DELETE', `/projects/p_r8/members/${member.user.id}`, nextOwner.session.id, undefined, { 'Idempotency-Key': deleteKey });
  assert.equal(delRes.status, 200);

  // Former owner attempts to replay DELETE receipt -> 404
  const formerDelReplay = await req('DELETE', `/projects/p_r8/members/${member.user.id}`, owner.session.id, undefined, { 'Idempotency-Key': deleteKey });
  assert.equal(formerDelReplay.status, 404, 'Former owner cannot replay DELETE receipt (404 expected)');

  console.log('BAR7-03 verified: Former owner and outsider denied replay of PATCH and DELETE receipts (404).');

  console.log('--- Probing BAR7-04: Invitation directory holds FOR SHARE OF w and returns 404 to former owner ---');

  // Former owner attempts to list invitations -> 404
  const listByFormer = await req('GET', '/projects/p_r8/invitations', owner.session.id);
  assert.equal(listByFormer.status, 404, 'Former owner cannot list invitations (404 expected)');

  // Outsider attempts to list invitations -> 404
  const listByOutsider = await req('GET', '/projects/p_r8/invitations', outsider.session.id);
  assert.equal(listByOutsider.status, 404, 'Outsider cannot list invitations (404 expected)');

  // Current owner can list invitations -> 200
  const listByOwner = await req('GET', '/projects/p_r8/invitations', nextOwner.session.id);
  assert.equal(listByOwner.status, 200, 'Current owner can list invitations (200 expected)');

  console.log('BAR7-04 verified: Invitation directory returns 404 to former owner and outsider.');

  console.log('--- Probing Invitation Accept Replay After Revocation ---');

  // NextOwner creates an invitation for outsider
  const inviteeEmail = 'invitee-probe@test.invalid';
  const invitee = await createDevUserAndSession(inviteeEmail, 'Invitee', pool);
  const invRes = await req('POST', '/projects/p_r8/invitations', nextOwner.session.id, {
    email: inviteeEmail,
    role: 'member',
  });
  assert.equal(invRes.status, 201);
  const invToken = (await invRes.json()).data.token;
  assert.ok(invToken);

  // Invitee accepts the invitation with an idempotency key -> 200
  const acceptKey = `r8-accept-key-${crypto.randomUUID()}`;
  const acceptRes = await req('POST', '/invitations/accept', invitee.session.id, {
    token: invToken,
  }, { 'Idempotency-Key': acceptKey });
  assert.equal(acceptRes.status, 200, 'First accept must succeed (200)');
  const acceptBody = await acceptRes.json();
  assert.equal(acceptBody.data.success, true);
  assert.equal(acceptBody.replayed, false);

  // Invitee replays accept receipt while active -> 200 replayed: true
  const activeReplay = await req('POST', '/invitations/accept', invitee.session.id, {
    token: invToken,
  }, { 'Idempotency-Key': acceptKey });
  assert.equal(activeReplay.status, 200, 'Replay while active succeeds (200)');
  assert.equal((await activeReplay.json()).replayed, true);

  // Now, owner removes invitee from the project (membership removed)
  const removeRes = await req('DELETE', `/projects/p_r8/members/${invitee.user.id}`, nextOwner.session.id);
  assert.equal(removeRes.status, 200, 'Owner removes invitee');

  // Verify invitee is indeed removed
  const getPrj = await req('GET', '/projects/p_r8', invitee.session.id);
  assert.equal(getPrj.status, 404, 'Invitee lost project access');

  // Invitee attempts to replay accept invitation receipt -> 404 NOT_FOUND!
  const revokedAcceptReplay = await req('POST', '/invitations/accept', invitee.session.id, {
    token: invToken,
  }, { 'Idempotency-Key': acceptKey });
  assert.equal(revokedAcceptReplay.status, 404, 'Replay of accept after membership revoked must return 404');
  const errJson = await revokedAcceptReplay.json();
  assert.equal(errJson.error.code, 'NOT_FOUND');
  console.log('Accept replay after revocation verified: returned 404 NOT_FOUND.');

  console.log('ALL ROUND 8 PROBE TESTS PASSED SUCCESSFULLY.');
} finally {
  setGlobalPool(null);
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
