import {versionedProjectLifecycleBody} from './support/board-lifecycle-fixture.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { acceptInvitation } from '../src/adapters/invitations.ts';
import { deliverInvitationNow } from '../src/adapters/invitation-delivery.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';
import { invitationListResponseSchema } from '@flowboard/contracts';

const extraUrl = process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];
const secret = 'synthetic-invitation-cursor-key-only-20261103';
const origin = 'http://localhost';
const extraTest = (name: string, fn: (t: TestContext) => Promise<void>) =>
  test(name, { skip: !extraUrl && 'Set FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL to the isolated local identity database.' }, fn);

async function fixture(t: TestContext) {
  const parsed = new URL(extraUrl!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/flowboard_identity_extra_test');
  assert.equal(parsed.username, 'flowboard_harness');
  const schema = `invite_repair_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: extraUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: extraUrl, max: 12, application_name: schema, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
  await runMigrations(pool);
  const actors: Record<string, Awaited<ReturnType<typeof createDevUserAndSession>>> = {};
  for (const name of ['owner', 'manager', 'member', 'viewer', 'invitee', 'outsider']) {
    actors[name] = await createDevUserAndSession(`${name}@flowboard.example`, `Synthetic ${name}`, pool);
  }
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)
    VALUES ('ws_invite','Invitations','UTC',$1,NOW(),NOW())`, [actors.owner!.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)
    VALUES ('project_invite','ws_invite','Invitations',NOW(),NOW()),('project_other','ws_invite','Other',NOW(),NOW())`);
  for (const [name, role] of [['manager', 'manager'], ['member', 'member'], ['viewer', 'viewer']]) {
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
      VALUES($1,'project_invite','ws_invite',$2,$3,'active',1,NOW(),NOW())`, [`pm_${name}`, actors[name!]!.user.id, role]);
  }
  const app = createApp(async () => {}, { pool,
    rateLimiter: () => ({ limit: async () => ({ success: true }) }),
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  });
  const headers = (actor: string, key: string = crypto.randomUUID()) => ({ cookie: `flowboard_session=${actors[actor]!.session.id}`,
    origin, 'content-type': 'application/json', 'idempotency-key': key });
  const request = async (path: string, actor = 'owner', method = 'GET', body?: unknown, key?: string) => {
    const commandKey=key??crypto.randomUUID();
    const input=await versionedProjectLifecycleBody(pool,'/api/v1'+path,body,commandKey);
    return app.request(`${origin}/api/v1${path}`, { method, headers: headers(actor, commandKey), ...(input === undefined ? {} : { body: JSON.stringify(input) }) }, { CURSOR_SECRET: secret } as never);
  };
  let serial = 0;
  async function invitation(options: { status?: string; email?: string; role?: string; createdAt?: string; expired?: boolean; projectId?: string } = {}) {
    const id = `inv_${String(++serial).padStart(5, '0')}`;
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO project_invitations(id,project_id,workspace_id,email,role,token_hash,invited_by,status,expires_at,created_at,updated_at)
      VALUES($1,$2,'ws_invite',$3,$4,$5,$6,$7,CASE WHEN $8 THEN NOW()-INTERVAL '1 day' ELSE NOW()+INTERVAL '1 day' END,
      COALESCE($9::timestamptz,NOW()),NOW())`, [id, options.projectId ?? 'project_invite', options.email ?? actors.invitee!.user.email,
      options.role ?? 'member', crypto.createHash('sha256').update(token).digest('hex'), actors.owner!.user.id,
      options.status ?? 'pending', options.expired ?? false, options.createdAt ?? null]);
    return { id, token };
  }
  const accept = (token: string, key?: string) => request('/invitations/accept', 'invitee', 'POST', { token }, key);
  const archive = () => request('/projects/project_invite/archive', 'owner', 'POST');
  return { pool, schema, actors, app, request, invitation, accept, archive };
}

async function waitBlocked(pool: pg.Pool, applicationName: string, n: number) {
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    const result = await pool.query<{ pids: number[] }>(`SELECT COALESCE(array_agg(pid),ARRAY[]::int[]) AS pids
      FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0`, [applicationName]);
    const pids = result.rows[0]!.pids;
    if (pids.length >= n) { assert.equal(new Set(pids).size, pids.length); return; }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`Expected ${n} distinct database connections blocked on held locks`);
}

extraTest('invitation repair: expired direct adapter call never commits caller-owned work', async (t) => {
  const f = await fixture(t), invitation = await f.invitation({ expired: true });
  const client = await f.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE projects SET description='caller transaction marker' WHERE id='project_invite'");
    await assert.rejects(acceptInvitation(client, f.actors.invitee!.user, invitation.token), (error: any) => error.code === 'INVITATION_EXPIRED');
    await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.equal((await f.pool.query("SELECT description FROM projects WHERE id='project_invite'")).rows[0]!.description, null);
});

extraTest('invitation repair: accepted receipt is denied after archive or access removal', async (t) => {
  const f = await fixture(t), invitation = await f.invitation(), key = crypto.randomUUID();
  assert.equal((await f.accept(invitation.token, key)).status, 200);
  assert.equal((await f.archive()).status, 200);
  const archived = await f.accept(invitation.token, key);
  assert.equal(archived.status, 409, await archived.clone().text());
  assert.equal((await archived.json() as any).error.code, 'READ_ONLY_CONTEXT');
  await f.pool.query("UPDATE projects SET archived=FALSE WHERE id='project_invite'");
  await f.pool.query("UPDATE project_memberships SET status='removed' WHERE user_id=$1", [f.actors.invitee!.user.id]);
  assert.equal((await f.accept(invitation.token, key)).status, 404);
});

extraTest('invitation repair: archive winning its row lock makes concurrent acceptance fail without effects', async (t) => {
  const f = await fixture(t), invitation = await f.invitation(), blocker = await f.pool.connect();
  await blocker.query('BEGIN');
  await blocker.query("UPDATE projects SET archived=TRUE,version=version+1 WHERE id='project_invite'");
  const accept = f.accept(invitation.token);
  try { await waitBlocked(f.pool, f.schema, 1); }
  finally { await blocker.query('COMMIT'); blocker.release(); }
  const response = await accept;
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM project_memberships WHERE user_id=$1', [f.actors.invitee!.user.id])).rows[0]!.n, 0);
  assert.equal((await f.pool.query("SELECT status FROM project_invitations WHERE id=$1", [invitation.id])).rows[0]!.status, 'pending');
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM activity_log')).rows[0]!.n, 0);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS n FROM idempotency_receipts')).rows[0]!.n, 0);
});

extraTest('invitation repair: acceptance winning lifecycle lock commits before concurrent archive', async (t) => {
  const f = await fixture(t), invitation = await f.invitation(), blocker = await f.pool.connect();
  const barrier = `accept-barrier:${f.schema}`;
  await f.pool.query(`CREATE FUNCTION pause_invite_activity() RETURNS TRIGGER AS $$
    BEGIN IF NEW.action='invitation_accepted' THEN PERFORM pg_advisory_xact_lock(hashtext('${barrier}')); END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql; CREATE TRIGGER pause_invite_activity BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION pause_invite_activity()`);
  await blocker.query('SELECT pg_advisory_lock(hashtext($1))', [barrier]);
  const accept = f.accept(invitation.token);
  let archive: Promise<Response> | undefined;
  try {
    await waitBlocked(f.pool, f.schema, 1);
    archive = Promise.resolve(f.archive());
    await waitBlocked(f.pool, f.schema, 2);
  } finally { await blocker.query('SELECT pg_advisory_unlock(hashtext($1))', [barrier]); blocker.release(); }
  assert.equal((await accept).status, 200);
  assert.equal((await archive!).status, 200);
  assert.equal((await f.pool.query("SELECT archived FROM projects WHERE id='project_invite'")).rows[0]!.archived, true);
  assert.equal((await f.pool.query('SELECT status FROM project_memberships WHERE user_id=$1', [f.actors.invitee!.user.id])).rows[0]!.status, 'active');
});

extraTest('invitation repair: leave waits for quota before touching grant or receipt; archived leave replays safely', async (t) => {
  const f = await fixture(t), blocker = await f.pool.connect();
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_invite'");
  await blocker.query('BEGIN');
  await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['fb:quota:project:project_invite']);
  const key = crypto.randomUUID();
  const leave = f.request('/projects/project_invite/leave', 'member', 'POST', undefined, key);
  try { await waitBlocked(f.pool, f.schema, 1); }
  finally { await blocker.query('ROLLBACK'); blocker.release(); }
  assert.equal((await leave).status, 200);
  assert.equal((await f.request('/projects/project_invite/leave', 'member', 'POST', undefined, key)).status, 200);
  assert.equal((await f.request('/projects/project_invite/leave', 'owner', 'POST')).status, 403);
  assert.equal((await f.request('/projects/project_invite/leave', 'outsider', 'POST')).status, 404);
  assert.equal((await f.pool.query("SELECT COUNT(*)::int AS n FROM activity_log WHERE action='member_left'")).rows[0]!.n, 1);
});

extraTest('invitation repair: invitation history defaults50, caps100 and keysets timestamp ties without duplicates', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 105; i++) await f.invitation({ status: 'revoked', createdAt: '2026-01-01T00:00:00.123456Z' });
  const first = await f.request('/projects/project_invite/invitations');
  const page = await first.json() as any;
  assert.equal(page.data.length, 50);
  invitationListResponseSchema.parse(page);
  assert.equal(typeof page.nextCursor, 'string');
  const second = await (await f.request(`/projects/project_invite/invitations?cursor=${encodeURIComponent(page.nextCursor)}`)).json() as any;
  const third = await (await f.request(`/projects/project_invite/invitations?cursor=${encodeURIComponent(second.nextCursor)}`)).json() as any;
  assert.equal(second.data.length, 50); assert.equal(third.data.length, 5); assert.equal(third.nextCursor, null);
  assert.equal(new Set([...page.data, ...second.data, ...third.data].map((r: any) => r.id)).size, 105);
  const max = await (await f.request('/projects/project_invite/invitations?limit=100')).json() as any;
  assert.equal(max.data.length, 100);
  assert.equal((await f.request('/projects/project_invite/invitations?limit=101')).status, 422);
});

extraTest('invitation repair: cursor scope, tamper, role revision and lifecycle changes are rejected after authorization', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) await f.invitation({ status: 'revoked' });
  const first = await (await f.request('/projects/project_invite/invitations?limit=1&status=revoked')).json() as any;
  assert.equal(typeof first.nextCursor, 'string');
  const cursor = encodeURIComponent(first.nextCursor);
  assert.equal((await f.request(`/projects/project_invite/invitations?limit=1&status=pending&cursor=${cursor}`)).status, 409);
  assert.equal((await f.request(`/projects/project_invite/invitations?limit=1&status=revoked&cursor=${cursor}`, 'manager')).status, 409);
  assert.equal((await f.request(`/projects/project_other/invitations?limit=1&status=revoked&cursor=${cursor}`)).status, 409);
  const tampered = first.nextCursor.slice(0, -1) + (first.nextCursor.endsWith('A') ? 'B' : 'A');
  assert.equal((await f.request(`/projects/project_invite/invitations?cursor=${encodeURIComponent(tampered)}`)).status, 409);
  for (const role of ['member', 'viewer']) assert.equal((await f.request('/projects/project_invite/invitations', role)).status, 403);
  assert.equal((await f.request(`/projects/project_invite/invitations?cursor=${cursor}`, 'outsider')).status, 404);
  const managerPage = await (await f.request('/projects/project_invite/invitations?limit=1', 'manager')).json() as any;
  await f.pool.query("UPDATE project_memberships SET version=version+1 WHERE id='pm_manager'");
  assert.equal((await f.request(`/projects/project_invite/invitations?limit=1&cursor=${encodeURIComponent(managerPage.nextCursor)}`, 'manager')).status, 409);
  await f.pool.query("UPDATE projects SET archived=TRUE,version=version+1 WHERE id='project_invite'");
  assert.equal((await f.request(`/projects/project_invite/invitations?limit=1&status=revoked&cursor=${cursor}`)).status, 409);
});

extraTest('invitation repair: list exposes only safe latest delivery status and role-aware retry hint', async (t) => {
  const f = await fixture(t);
  const outcomes = ['pending', 'retrying', 'delivered', 'failed', 'unknown'] as const;
  const ids: Record<string, string> = {};
  for (const status of outcomes) {
    const invitation = await f.invitation(); ids[status] = invitation.id;
    if (status === 'unknown') continue;
    await f.pool.query(`INSERT INTO outbox(id,project_id,workspace_id,event_type,payload,status,retry_count,next_retry_at,created_at)
      VALUES($1,'project_invite','ws_invite','invitation.created',$2,$3,$4,NOW(),NOW())`, [`out_${status}`,
      JSON.stringify({ invitationId: invitation.id, token: 'must-not-leak', email: 'private@flowboard.example', body: 'must-not-leak', providerMessageId: 'provider-private' }),
      status === 'retrying' ? 'pending' : status, status === 'retrying' ? 1 : 0]);
  }
  const managerInvite = await f.invitation({ role: 'manager' });
  await f.pool.query(`INSERT INTO outbox(id,project_id,workspace_id,event_type,payload,status,retry_count,next_retry_at,created_at)
    VALUES('out_manager','project_invite','ws_invite','invitation.created',$1,'failed',5,NOW(),NOW())`, [JSON.stringify({ invitationId: managerInvite.id })]);
  const response = await (await f.request('/projects/project_invite/invitations')).json() as any;
  invitationListResponseSchema.parse(response);
  for (const status of outcomes) {
    const row = response.data.find((r: any) => r.id === ids[status]);
    assert.deepEqual(row.delivery, { status, canRetry: status === 'failed' });
    assert.deepEqual(Object.keys(row.delivery).sort(), ['canRetry', 'status']);
  }
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(response).includes('provider-private'), false);
  const managerResponse = await (await f.request('/projects/project_invite/invitations', 'manager')).json() as any;
  assert.equal(managerResponse.data.find((r: any) => r.id === managerInvite.id).delivery.canRetry, false);
  await f.pool.query("UPDATE projects SET archived=TRUE,version=version+1 WHERE id='project_invite'");
  const archived = await (await f.request('/projects/project_invite/invitations')).json() as any;
  assert.ok(archived.data.every((r: any) => r.delivery.canRetry === false));
});

extraTest('invitation repair: terminal delivered, permanent failure and exhausted retries retain only safe invitation association', async (t) => {
  const f = await fixture(t);
  for (const [status, outcome] of [['delivered', { status: 'sent', providerMessageId: 'provider_opaque' }], ['failed', { status: 'permanent', reason: 'http400' }], ['exhausted', { status: 'retry', reason: 'network' }]] as const) {
    const invitation = await f.invitation();
    await f.pool.query(`INSERT INTO outbox(id,project_id,workspace_id,event_type,payload,status,retry_count,next_retry_at,created_at)
      VALUES($1,'project_invite','ws_invite','invitation.created',$2,'pending',4,NOW(),NOW())`, [`out_${status}`,
      JSON.stringify({ invitationId: invitation.id, email: 'recipient@flowboard.example', token: 'synthetic-token', role: 'member', projectName: 'Private project', body: 'Private body' })]);
    const mailer = { appOrigin: 'https://flowboard.example', send: async () => outcome };
    if (status === 'exhausted') await processOutboxLease(f.pool, { mailer, maxRetries: 5 });
    else await deliverInvitationNow(f.pool, `out_${status}`, mailer);
    const row = (await f.pool.query('SELECT payload FROM outbox WHERE id=$1', [`out_${status}`])).rows[0]!;
    assert.deepEqual(row.payload, status === 'delivered' ? { invitationId: invitation.id, providerMessageId: 'provider_opaque' } : { invitationId: invitation.id });
  }
});

extraTest('invitation repair: migration0022 indexes are present/idempotent and list makes one bounded history/delivery query', async (t) => {
  const f = await fixture(t);
  const { readFile, writeFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../../../database/migrations/0022_invitation_history_indexes.sql', import.meta.url), 'utf8');
  await f.pool.query(sql); await f.pool.query(sql);
  const indexes = (await f.pool.query("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname IN ('idx_project_invitations_history','idx_outbox_invitation_delivery')", [f.schema])).rows;
  assert.equal(indexes.length, 2);
  for (let i = 0; i < 105; i++) {
    const invitation = await f.invitation({ status: 'revoked' });
    await f.pool.query(`INSERT INTO outbox(id,project_id,workspace_id,event_type,payload,status,retry_count,next_retry_at,created_at)
      VALUES($1,'project_invite','ws_invite','invitation.created',$2,'delivered',0,NOW(),NOW())`,
      [`out_plan_${invitation.id}`, JSON.stringify({ invitationId: invitation.id })]);
  }
  const captured: Array<{ text: string; values: unknown[] }> = [];
  const originalConnect = f.pool.connect.bind(f.pool);
  f.pool.connect = ((...args: any[]) => {
    if (typeof args[0] === 'function') return (originalConnect as any)(...args);
    return (async () => {
      const client = await (originalConnect as any)(...args);
      const query = client.query.bind(client), release = client.release.bind(client);
      client.query = async (...queryArgs: any[]) => {
        const text = typeof queryArgs[0] === 'string' ? queryArgs[0] : queryArgs[0]?.text ?? '';
        if (/FROM (?:project_invitations|outbox)/i.test(text)) captured.push({ text, values: queryArgs[1] });
        return query(...queryArgs);
      };
      client.release = (...releaseArgs: any[]) => { client.query = query; return release(...releaseArgs); };
      return client;
    })();
  }) as any;
  let response: Response;
  try { response = await f.request('/projects/project_invite/invitations?limit=100'); }
  finally { f.pool.connect = originalConnect; }
  assert.equal(response!.status, 200);
  assert.equal((await response!.json() as any).data.length, 100);
  assert.equal(captured.length, 1, 'one bounded history/delivery SQL statement, no per-invitation app query');
  const plan = await f.pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured[0]!.text}`, captured[0]!.values);
  if (process.env['FLOWBOARD_INVITATION_PLAN_PATH']) await writeFile(process.env['FLOWBOARD_INVITATION_PLAN_PATH'], JSON.stringify({
    environment: 'Synthetic105-row fresh schema, PostgreSQL local only; not production benchmark',
    historyDeliveryStatementCount: captured.length, pageLimit: 100, sql: captured[0]!.text, plan: plan.rows[0],
  }, null, 2) + '\n');
});

extraTest('invitation repair: terminal receipt never retains forged or foreign-project invitation association', async (t) => {
  const f = await fixture(t), foreign = await f.invitation({ projectId: 'project_other' });
  await f.pool.query(`INSERT INTO outbox(id,project_id,workspace_id,event_type,payload,status,retry_count,next_retry_at,created_at)
    VALUES('out_foreign','project_invite','ws_invite','invitation.created',$1,'pending',0,NOW(),NOW())`, [JSON.stringify({
    invitationId: foreign.id, token: 'synthetic-token', email: 'synthetic@flowboard.example', body: 'Private content',
  })]);
  await deliverInvitationNow(f.pool, 'out_foreign', { appOrigin: 'https://flowboard.example', send: async () => ({ status: 'permanent', reason: 'http400' }) });
  assert.deepEqual((await f.pool.query("SELECT payload FROM outbox WHERE id='out_foreign'")).rows[0]!.payload, {});
});


extraTest('invitation repair: expiry filter and latest delivery attempt produce current retry eligibility', async (t) => {
  const f = await fixture(t);
  const expired = await f.invitation({ expired: true });
  const active = await f.invitation();
  await f.pool.query(`INSERT INTO outbox(id,project_id,workspace_id,event_type,payload,status,retry_count,next_retry_at,created_at)
    VALUES('out_expired','project_invite','ws_invite','invitation.created',$1,'failed',5,NOW(),NOW()),
          ('out_old','project_invite','ws_invite','invitation.created',$2,'failed',5,NOW(),NOW()-INTERVAL '1 hour'),
          ('out_new','project_invite','ws_invite','invitation.created',$2,'pending',0,NOW(),NOW())`,
    [JSON.stringify({ invitationId: expired.id }), JSON.stringify({ invitationId: active.id })]);
  const expiredPage = await (await f.request('/projects/project_invite/invitations?status=expired')).json() as any;
  assert.equal(expiredPage.data.length, 1);
  assert.equal(expiredPage.data[0].id, expired.id);
  assert.deepEqual(expiredPage.data[0].delivery, { status: 'failed', canRetry: false });
  const pendingPage = await (await f.request('/projects/project_invite/invitations?status=pending')).json() as any;
  assert.equal(pendingPage.data.length, 1);
  assert.equal(pendingPage.data[0].id, active.id);
  assert.deepEqual(pendingPage.data[0].delivery, { status: 'pending', canRetry: false });
});
