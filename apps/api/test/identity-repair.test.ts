import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';
import { DEFAULT_LIMITS, type Limits } from '../src/services/limits.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import type { MailOutcome } from '../src/services/mailer.ts';

// Regression target: removing the quota/archive guards or terminal payload cleanup must fail these
// observable database/API assertions. Every schema and identity is synthetic and isolated per case.
const connectionString = localDatabaseUrl(process.env['DATABASE_URL']);
const origin = 'http://localhost';
type Actor = Awaited<ReturnType<typeof createDevUserAndSession>>;

async function fixture(t: TestContext, overrides: Partial<Limits> = {}) {
  const schema = `identity_repair_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString, max: 12, application_name: schema, options: `-c search_path=${schema}` });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  await runMigrations(pool);
  const actors: Record<string, Actor> = {};
  for (const name of ['owner', 'manager', 'peer', 'member', 'viewer', 'removedA', 'removedB', 'outsider']) {
    actors[name] = await createDevUserAndSession(`${name.toLowerCase()}@flowboard.example`, `Synthetic ${name}`, pool);
  }
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at)
    VALUES ('ws_identity','Identity fixture','UTC',$1,NOW(),NOW())`, [actors.owner!.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at)
    VALUES ('project_identity','ws_identity','Identity fixture',NOW(),NOW())`);
  for (const [name, role, status] of [
    ['owner', 'member', 'active'], ['manager', 'manager', 'active'], ['peer', 'manager', 'active'],
    ['member', 'member', 'active'], ['viewer', 'viewer', 'active'],
    ['removedA', 'member', 'removed'], ['removedB', 'member', 'removed'],
  ]) {
    await pool.query(`INSERT INTO project_memberships
      (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
      VALUES ($1,'project_identity','ws_identity',$2,$3,$4,1,NOW(),NOW())`,
    [`pm_${name}`, actors[name!]!.user.id, role, status]);
  }
  const app = createApp(async () => {}, {
    pool, limits: { ...DEFAULT_LIMITS, ...overrides },
    rateLimiter: () => ({ limit: async () => ({ success: true }) }),
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  });
  const headers = (name: string, key: string = crypto.randomUUID()) => ({
    cookie: `flowboard_session=${actors[name]!.session.id}`, origin,
    'content-type': 'application/json', 'idempotency-key': key,
  });
  const patch = (actor: string, target: string, body: { role: string; status: string; expectedVersion: number }, key?: string) =>
    app.request(`${origin}/api/v1/projects/project_identity/members/${actors[target]!.user.id}`, {
      method: 'PATCH', headers: headers(actor, key), body: JSON.stringify(body),
    });
  const remove = (actor: string, target: string, key?: string) =>
    app.request(`${origin}/api/v1/projects/project_identity/members/${actors[target]!.user.id}`, {
      method: 'DELETE', headers: headers(actor, key),
    });
  const state = async () => ({
    members: (await pool.query('SELECT id,role,status,version FROM project_memberships ORDER BY id')).rows,
    activity: (await pool.query('SELECT id,action FROM activity_log ORDER BY id')).rows,
    receipts: (await pool.query('SELECT id FROM idempotency_receipts ORDER BY id')).rows,
  });
  const pendingInvite = async (email: string) => {
    const id = `inv_${crypto.randomUUID()}`;
    await pool.query(`INSERT INTO project_invitations
      (id,project_id,workspace_id,email,role,token_hash,invited_by,status,expires_at,created_at,updated_at)
      VALUES ($1,'project_identity','ws_identity',$2,'member',$3,$4,'pending',NOW()+INTERVAL '1 day',NOW(),NOW())`,
    [id, email, crypto.randomBytes(32).toString('hex'), actors.owner!.user.id]);
    return id;
  };
  return { pool, app, actors, headers, patch, remove, state, pendingInvite, schema };
}

const activeMember = { role: 'member', status: 'active', expectedVersion: 1 };

test('identity repair: reactivation at active-seat cap is refused without member/activity/receipt writes', async (t) => {
  const f = await fixture(t, { membersPerProject: 4 });
  const before = await f.state();
  const response = await f.patch('owner', 'removedA', activeMember);
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json() as any).error.code, 'QUOTA_EXCEEDED');
  assert.deepEqual(await f.state(), before);
});

test('identity repair: reactivation respects pending invitation seat reservations and expired rows release them', async (t) => {
  const f = await fixture(t, { membersPerProject: 5 });
  const id = await f.pendingInvite('pending@flowboard.example');
  const before = await f.state();
  const denied = await f.patch('owner', 'removedA', activeMember);
  assert.equal(denied.status, 409, await denied.clone().text());
  assert.deepEqual(await f.state(), before);
  await f.pool.query("UPDATE project_invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [id]);
  assert.equal((await f.patch('owner', 'removedA', activeMember)).status, 200);
});

test('identity repair: archived role changes, reinstatement and role-change-with-removal are refused atomically', async (t) => {
  const f = await fixture(t);
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_identity'");
  const before = await f.state();
  for (const [target, body] of [
    ['member', { role: 'viewer', status: 'active', expectedVersion: 1 }],
    ['removedA', activeMember],
    ['member', { role: 'viewer', status: 'removed', expectedVersion: 1 }],
  ] as const) {
    const response = await f.patch('owner', target, body);
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal((await response.json() as any).error.code, 'READ_ONLY_CONTEXT');
    assert.deepEqual(await f.state(), before);
  }
});

test('identity repair: archived pure PATCH/DELETE removal and their replay remain allowed; leave stays possible', async (t) => {
  const f = await fixture(t);
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_identity'");
  const patchKey = crypto.randomUUID(), deleteKey = crypto.randomUUID();
  const body = { role: 'member', status: 'removed', expectedVersion: 1 };
  assert.equal((await f.patch('owner', 'member', body, patchKey)).status, 200);
  const afterPatch = await f.state();
  const replay = await f.patch('owner', 'member', body, patchKey);
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json() as any).replayed, true);
  assert.deepEqual(await f.state(), afterPatch);
  assert.equal((await f.remove('manager', 'viewer', deleteKey)).status, 200);
  const afterDelete = await f.state();
  assert.equal((await f.remove('manager', 'viewer', deleteKey)).status, 200);
  assert.deepEqual(await f.state(), afterDelete);
  const leave = await f.app.request(`${origin}/api/v1/projects/project_identity/leave`, {
    method: 'POST', headers: f.headers('peer'),
  });
  assert.equal(leave.status, 200, await leave.clone().text());
  assert.equal((await f.pool.query("SELECT status FROM project_memberships WHERE id='pm_peer'")).rows[0]!.status, 'removed');
});

test('identity repair: archived replay of an earlier role change fails without new side effects', async (t) => {
  const f = await fixture(t);
  const key = crypto.randomUUID(), body = { role: 'viewer', status: 'active', expectedVersion: 1 };
  assert.equal((await f.patch('owner', 'member', body, key)).status, 200);
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_identity'");
  const before = await f.state();
  const response = await f.patch('owner', 'member', body, key);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as any).error.code, 'READ_ONLY_CONTEXT');
  assert.deepEqual(await f.state(), before);
});

test('identity repair: PATCH removal revokes pending invitations and board grants like DELETE and replays once', async (t) => {
  const f = await fixture(t);
  const invitation = await f.pendingInvite(f.actors.member!.user.email!);
  await f.pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at)
    VALUES ('board_identity','ws_identity','project_identity','Board',NOW(),NOW())`);
  await f.pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
    VALUES ('board_identity','project_identity','ws_identity',$1,$2)`, [f.actors.member!.user.id, f.actors.owner!.user.id]);
  const key = crypto.randomUUID(), body = { role: 'member', status: 'removed', expectedVersion: 1 };
  assert.equal((await f.patch('owner', 'member', body, key)).status, 200);
  assert.equal((await f.pool.query('SELECT status FROM project_invitations WHERE id=$1', [invitation])).rows[0]!.status, 'revoked');
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM board_grants')).rows[0]!.n, 0);
  const after = await f.state();
  assert.equal(after.activity.filter((r) => r.action === 'member_removed').length, 1);
  assert.equal(after.activity.filter((r) => r.action === 'invitation_revoked').length, 1);
  assert.equal(after.receipts.length, 1);
  assert.equal((await f.patch('owner', 'member', body, key)).status, 200);
  assert.deepEqual(await f.state(), after);
});

test('identity repair: role matrix and replay protect self, peer Manager, Owner, and revoked actor', async (t) => {
  const f = await fixture(t);
  for (const [actor, target, role, expected] of [
    ['manager', 'manager', 'member', 403], ['manager', 'peer', 'member', 403],
    ['manager', 'owner', 'viewer', 403], ['manager', 'member', 'manager', 403],
    ['member', 'viewer', 'member', 403], ['viewer', 'member', 'member', 403],
    ['outsider', 'member', 'member', 404],
  ] as const) {
    const before = await f.state();
    assert.equal((await f.patch(actor, target, { ...activeMember, role })).status, expected, `${actor}->${target}`);
    assert.deepEqual(await f.state(), before);
  }
  const key = crypto.randomUUID(), body = { role: 'viewer', status: 'active', expectedVersion: 1 };
  assert.equal((await f.patch('manager', 'member', body, key)).status, 200);
  assert.equal((await f.remove('owner', 'manager')).status, 200);
  const afterRemoval = await f.state();
  assert.equal((await f.patch('manager', 'member', body, key)).status, 404);
  assert.deepEqual(await f.state(), afterRemoval);
});

async function waitForBlocked(pool: pg.Pool, applicationName: string, minimum: number) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ n: number; pids: number[] }>(`SELECT COUNT(*)::int AS n,
      COALESCE(array_agg(pid),ARRAY[]::int[]) AS pids FROM pg_stat_activity
      WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0`, [applicationName]);
    if (waiting.rows[0]!.n >= minimum) {
      assert.equal(new Set(waiting.rows[0]!.pids).size, waiting.rows[0]!.n, 'separate PostgreSQL backend connections');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Expected ${minimum} requests blocked on held PostgreSQL locks`);
}

test('identity repair: two reinstatements and an invitation compete for one seat on separate connections', async (t) => {
  const f = await fixture(t, { membersPerProject: 5 });
  const blocker = await f.pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['fb:quota:project:project_identity']);
  const jobs = [f.patch('owner', 'removedA', activeMember), f.patch('owner', 'removedB', activeMember),
    f.app.request(`${origin}/api/v1/projects/project_identity/invitations`, {
      method: 'POST', headers: f.headers('owner'), body: JSON.stringify({ email: 'new@flowboard.example', role: 'member' }),
    })];
  try { await waitForBlocked(f.pool, f.schema, 3); }
  finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const statuses = (await Promise.all(jobs)).map((r) => r.status);
  assert.equal(statuses.filter((s) => s < 300).length, 1, statuses.join(','));
  assert.equal(statuses.filter((s) => s === 409).length, 2, statuses.join(','));
  const count = await f.pool.query(`SELECT
    (SELECT COUNT(*) FROM project_memberships WHERE status='active' AND user_id<>$1) +
    (SELECT COUNT(*) FROM project_invitations WHERE status='pending' AND expires_at>NOW()) AS n`, [f.actors.owner!.user.id]);
  assert.equal(Number(count.rows[0]!.n), 5);
});

test('identity repair: a committed actor revocation wins against a mounted role write waiting on its grant', async (t) => {
  const f = await fixture(t);
  const blocker = await f.pool.connect();
  await blocker.query('BEGIN');
  await blocker.query("SELECT id FROM project_memberships WHERE id='pm_manager' FOR UPDATE");
  const write = f.patch('manager', 'member', { role: 'viewer', status: 'active', expectedVersion: 1 });
  try {
    await waitForBlocked(f.pool, f.schema, 1);
    await blocker.query("UPDATE project_memberships SET status='removed',version=version+1,updated_at=NOW() WHERE id='pm_manager'");
    await blocker.query('COMMIT');
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const response = await write;
  assert.equal(response.status, 404, await response.clone().text());
  assert.equal((await f.pool.query("SELECT role,version FROM project_memberships WHERE id='pm_member'")).rows[0]!.role, 'member');
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM idempotency_receipts')).rows[0]!.n, 0);
});

test('identity repair: failed activity insertion rolls back membership and receipt together', async (t) => {
  const f = await fixture(t);
  await f.pool.query(`CREATE FUNCTION refuse_member_activity() RETURNS TRIGGER AS $$
    BEGIN IF NEW.action='member_role_changed' THEN RAISE EXCEPTION 'synthetic activity failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER refuse_member_activity BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION refuse_member_activity()`);
  const before = await f.state();
  const response = await f.patch('owner', 'member', { role: 'viewer', status: 'active', expectedVersion: 1 });
  assert.equal(response.status, 500);
  assert.deepEqual(await f.state(), before);
});

test('identity repair: exhausted transient invitation delivery strips terminal token, recipient and mail fields', async (t) => {
  const f = await fixture(t);
  const payload = { token: 'synthetic-raw-invite-token', email: 'private@flowboard.example',
    invitationId: 'inv_outbox', projectId: 'project_identity', workspaceId: 'ws_identity', role: 'member',
    projectName: 'Private project name', inviterName: 'Private inviter', body: 'Private mail body',
    expiresAt: '2099-01-01T00:00:00.000Z' };
  await f.pool.query(`INSERT INTO outbox (id,workspace_id,project_id,event_type,payload,status,retry_count,next_retry_at,created_at)
    VALUES ('out_identity','ws_identity','project_identity','invitation.created',$1,'pending',4,NOW(),NOW())`, [JSON.stringify(payload)]);
  const result = await processOutboxLease(f.pool, { maxRetries: 5, mailer: {
    appOrigin: 'https://flowboard.example', send: async (): Promise<MailOutcome> => ({ status: 'retry', reason: 'network' }),
  } });
  assert.equal(result.failed, 1);
  const row = (await f.pool.query('SELECT status,retry_count,payload,settled_at FROM outbox WHERE id=\'out_identity\'')).rows[0]!;
  assert.equal(row.status, 'failed');
  assert.equal(row.retry_count, 5);
  assert.ok(row.settled_at instanceof Date);
  assert.deepEqual(row.payload, {});
  const replay = await processOutboxLease(f.pool, { mailer: { appOrigin: 'https://flowboard.example',
    send: async (): Promise<MailOutcome> => { assert.fail('a terminal failure must not be sent again'); },
  } });
  assert.equal(replay.processed, 0);
});


test('identity repair: mixed role/removal works while active but its replay cannot edit archived authority', async (t) => {
  const f = await fixture(t);
  const key = crypto.randomUUID(), body = { role: 'viewer', status: 'removed', expectedVersion: 1 };
  const applied = await f.patch('owner', 'member', body, key);
  assert.equal(applied.status, 200, await applied.clone().text());
  assert.equal((await applied.json() as any).data.role, 'viewer');
  const activeReplay = await f.patch('owner', 'member', body, key);
  assert.equal(activeReplay.status, 200);
  assert.equal((await activeReplay.json() as any).data.state, undefined, 'internal receipt classification stays private');
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_identity'");
  const before = await f.state();
  const archivedReplay = await f.patch('owner', 'member', body, key);
  assert.equal(archivedReplay.status, 409, await archivedReplay.clone().text());
  assert.equal((await archivedReplay.json() as any).error.code, 'READ_ONLY_CONTEXT');
  assert.deepEqual(await f.state(), before);
});

test('identity repair: legacy unclassified removal receipt replays while active and refuses ambiguous archived replay', async (t) => {
  const f = await fixture(t);
  const key = crypto.randomUUID(), body = { role: 'member', status: 'removed', expectedVersion: 1 };
  assert.equal((await f.patch('owner', 'member', body, key)).status, 200);
  await f.pool.query(`UPDATE idempotency_receipts SET response_body=jsonb_set(response_body,'{data}', (response_body->'data')-'state')
    WHERE idempotency_key=$1`, [key]);
  assert.equal((await f.patch('owner', 'member', body, key)).status, 200);
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_identity'");
  const before = await f.state();
  assert.equal((await f.patch('owner', 'member', body, key)).status, 409);
  assert.deepEqual(await f.state(), before);
});

test('identity repair: a reactivation receipt replays at the full cap without another seat or activity', async (t) => {
  const f = await fixture(t, { membersPerProject: 5 });
  const key = crypto.randomUUID();
  assert.equal((await f.patch('manager', 'removedA', activeMember, key)).status, 200);
  const before = await f.state();
  const replay = await f.patch('manager', 'removedA', activeMember, key);
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json() as any).replayed, true);
  assert.deepEqual(await f.state(), before);
  // Editing an already seated person does not consume an additional seat, even while at the cap.
  assert.equal((await f.patch('manager', 'removedA', { role: 'viewer', status: 'active', expectedVersion: 2 })).status, 200);
});

test('identity repair: archived access revocation retains actor and protected-target authority', async (t) => {
  const f = await fixture(t);
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_identity'");
  for (const [actor, target] of [['manager', 'peer'], ['manager', 'owner'], ['member', 'viewer'], ['viewer', 'member']] as const) {
    const before = await f.state();
    assert.equal((await f.remove(actor, target)).status, 403, `${actor}->${target}`);
    assert.deepEqual(await f.state(), before);
  }
});

test('identity repair: activity failure rolls PATCH removal and invitation cleanup back together', async (t) => {
  const f = await fixture(t);
  const invitation = await f.pendingInvite(f.actors.member!.user.email!);
  await f.pool.query(`CREATE FUNCTION refuse_removal_activity() RETURNS TRIGGER AS $$
    BEGIN IF NEW.action='member_removed' THEN RAISE EXCEPTION 'synthetic removal activity failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER refuse_removal_activity BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION refuse_removal_activity()`);
  const before = await f.state();
  const response = await f.patch('owner', 'member', { role: 'member', status: 'removed', expectedVersion: 1 });
  assert.equal(response.status, 500);
  assert.deepEqual(await f.state(), before);
  assert.equal((await f.pool.query('SELECT status FROM project_invitations WHERE id=$1', [invitation])).rows[0]!.status, 'pending');
});
