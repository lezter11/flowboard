import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { consumeInvitationScopeLimits } from '../src/adapters/rate-limit-postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// FB-AUD-05 regression, mounted over PostgreSQL. Each invitation attempt also counts per inviter
// and per project, so rotating client addresses does not multiply the allowance.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });

async function fixture() {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Owner', pool);
  const m1 = await createDevUserAndSession(`m1.${s}@flowboard.example`, 'Manager one', pool);
  const m2 = await createDevUserAndSession(`m2.${s}@flowboard.example`, 'Manager two', pool);
  const stranger = await createDevUserAndSession(`stranger.${s}@flowboard.example`, 'Stranger', pool);
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
  for (const [label, userId] of [['m1', m1.user.id], ['m2', m2.user.id]] as const) {
    await pool.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'manager','active',1,now(),now())`,
      [`pm_${label}_${s}`, project, ws, userId],
    );
  }
  return { project, s, owner, m1, m2, stranger };
}

let ipCounter = 0;
function invite(
  project: string,
  session: { id: string },
  idem = crypto.randomUUID(),
  ip = `203.0.113.${(ipCounter = (ipCounter + 1) % 250) + 1}`,
  email = `guest.${crypto.randomUUID().slice(0, 8)}@flowboard.example`,
) {
  return app.request(`http://localhost/api/v1/projects/${project}/invitations`, {
    method: 'POST',
    headers: {
      cookie: `flowboard_session=${session.id}`,
      origin: 'http://localhost',
      'idempotency-key': `b7-invite-${idem}`,
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify({ email, role: 'member' }),
  });
}

async function count(bucket: string, key: string): Promise<number> {
  const res = await pool.query<{ request_count: number }>(
    `SELECT COALESCE(SUM(request_count), 0)::int AS request_count FROM rate_limit_windows WHERE bucket = $1 AND client_key = $2`,
    [bucket, key],
  );
  return res.rows[0]!.request_count;
}

test('B-7 invitations: per inviter and per project limits hold across rotating client addresses', async (t) => {
  const fx = await fixture();

  await t.test('an inviter gets 20 a minute, then 429 with a retry hint, whatever the client address', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await invite(fx.project, fx.m1.session);
      assert.equal(res.status, 201, await res.clone().text());
    }
    const refused = await invite(fx.project, fx.m1.session);
    assert.equal(refused.status, 429);
    const body = (await refused.json()) as any;
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.ok(body.error.details.retryAfterSeconds >= 1);
  });

  await t.test('a second manager shares the project allowance: 30 a minute in total', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await invite(fx.project, fx.m2.session)).status, 201);
    }
    const refused = await invite(fx.project, fx.m2.session);
    assert.equal(refused.status, 429);
    assert.equal(((await refused.json()) as any).error.code, 'RATE_LIMITED');
  });

  await t.test('refused attempts roll back: the counters stay at the allowance, not above it', async () => {
    const window = await pool.query<{ n: number }>(
      `SELECT COALESCE(SUM(request_count), 0)::int AS n FROM rate_limit_windows WHERE bucket = 'invite-project' AND client_key = $1`,
      [fx.project],
    );
    assert.equal(window.rows[0]!.n, 30);
    assert.equal(await count('invite-inviter', fx.m1.user.id), 20);
  });

  await t.test('an idempotent replay does not spend the allowance', async () => {
    // A fresh project: the shared fixture's project allowance is already spent by the subtests above.
    const fresh = await fixture();
    const key = crypto.randomUUID();
    const email = `replay.${key.slice(0, 8)}@flowboard.example`;
    const before = await count('invite-inviter', fresh.owner.user.id);
    assert.equal((await invite(fresh.project, fresh.owner.session, key, undefined, email)).status, 201);
    const replay = await invite(fresh.project, fresh.owner.session, key, undefined, email);
    assert.equal(replay.status, 201);
    assert.equal(((await replay.json()) as any).replayed, true);
    assert.equal(await count('invite-inviter', fresh.owner.user.id), before + 1);
  });

  await t.test('an outsider cannot spend the project allowance', async () => {
    const before = await count('invite-project', fx.project);
    const res = await invite(fx.project, fx.stranger.session);
    assert.equal(res.status, 404);
    assert.equal(await count('invite-project', fx.project), before);
  });

  await t.test('the hourly ceiling applies even when the minute window is empty', async () => {
    const fresh = await fixture();
    const hourStart = Math.floor(Date.now() / 1000 / 3600) * 3600;
    await pool.query(
      `INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count)
       VALUES ('invite-inviter-hour', $1, $2, 200)
       ON CONFLICT (bucket, client_key, window_start) DO UPDATE SET request_count = 200`,
      [fresh.m1.user.id, hourStart],
    );
    const res = await invite(fresh.project, fresh.m1.session);
    assert.equal(res.status, 429);
  });
});

test('B-7 invitations: a failing counter refuses the attempt with 503 (fail closed)', async () => {
  const broken = {
    query: async () => {
      throw new Error('connection lost');
    },
  } as unknown as pg.ClientBase;
  await assert.rejects(consumeInvitationScopeLimits(broken, 'usr_any', 'prj_any'), (err: any) => {
    assert.equal(err.status, 503);
    assert.equal(err.code, 'SERVICE_UNAVAILABLE');
    return true;
  });
});
