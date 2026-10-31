import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import type { ExecutionContext } from 'hono';
import { createApp } from '../src/http/app.ts';
import worker from '../src/runtime/worker.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { BREVO_SEND_URL } from '../src/services/mailer.ts';

// UAT follow-up: the immediate invitation send must run on the Worker's waitUntil. The Worker passed no
// ExecutionContext to Hono, so c.executionCtx threw and the send was skipped silently; the scheduled drain
// then sent the email minutes later. These tests pin the route -> waitUntil path and the reason-code logs.
// Brevo is faked with the global fetch. Nothing here calls the real provider.

const url = localDatabaseUrl(process.env['DATABASE_URL']);
const ORIGIN = 'https://flowboard.example';
const MAIL_ENV = { BREVO_API_KEY: 'test-key-not-real', MAIL_FROM_EMAIL: 'mail@flowboard.example', APP_ORIGIN: ORIGIN };

async function freshSchema() {
  const schema = `uat_send_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  // The Worker builds its own pool from the connection string, so the schema travels in the URL too.
  const sep = url.includes('?') ? '&' : '?';
  const schemaUrl = `${url}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
  return {
    pool,
    schemaUrl,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

async function fixture(pool: pg.Pool) {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Olive Owner', pool);
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'Launch',now(),now())`, [project, ws]);
  return { project, cookie: `flowboard_session=${owner.session.id}`, invitee: `invitee.${s}@flowboard.example` };
}

function inviteRequest(fx: Awaited<ReturnType<typeof fixture>>, email = fx.invitee) {
  return new Request(`http://localhost/api/v1/projects/${fx.project}/invitations`, {
    method: 'POST',
    headers: { cookie: fx.cookie, origin: 'http://localhost', 'idempotency-key': `uat-${crypto.randomUUID()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, role: 'member' }),
  });
}

/** A waitUntil that records each promise, so the test can wait for the background send to finish. */
function recordingContext() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    props: {},
  };
  return { pending, ctx: ctx as unknown as ExecutionContext };
}

/** Fakes Brevo on the global fetch. Other URLs pass through untouched. */
function fakeBrevo(t: { mock: { method: Function } }, status = 201) {
  const real = globalThis.fetch;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = String(input instanceof Request ? input.url : input);
    if (!target.startsWith(BREVO_SEND_URL)) return real(input as never, init);
    calls.push(target);
    return status === 201
      ? Response.json({ messageId: '<m-1@brevo>' }, { status: 201 })
      : new Response('{"code":"server_error"}', { status });
  });
  return calls;
}

function warnLines(t: { mock: { method: Function } }) {
  const mock = t.mock.method(console, 'warn', () => {}) as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } };
  return () => mock.mock.calls.map((c) => String(c.arguments[0]));
}

test('UAT: the invite route hands the immediate send to waitUntil, and the row is delivered before the drain runs', async (t) => {
  const db = await freshSchema();
  try {
    const fx = await fixture(db.pool);
    const app = createApp(async () => {}, { pool: db.pool });
    const calls = fakeBrevo(t);
    const { pending, ctx } = recordingContext();

    const res = await app.fetch(inviteRequest(fx), { ...MAIL_ENV, DATABASE_URL: db.schemaUrl }, ctx);
    assert.equal(res.status, 201, await res.clone().text());
    assert.equal(pending.length, 1, 'the route called waitUntil exactly once');

    await Promise.all(pending);
    assert.equal(calls.length, 1, 'one Brevo send, made from the waitUntil path');
    const row = await db.pool.query<{ status: string; payload: unknown }>(
      `SELECT status, payload FROM outbox WHERE event_type = 'invitation.created' AND project_id = $1`,
      [fx.project],
    );
    assert.equal(row.rows[0]!.status, 'delivered');
    assert.deepEqual(row.rows[0]!.payload, { providerMessageId: '<m-1@brevo>' });
  } finally {
    await db.close();
  }
});

test('UAT: the Worker passes its ExecutionContext to the app, so the immediate send starts on a real request', async (t) => {
  const db = await freshSchema();
  try {
    const fx = await fixture(db.pool);
    const calls = fakeBrevo(t);
    const { pending, ctx } = recordingContext();
    const env = { ...MAIL_ENV, DATABASE_URL: db.schemaUrl, FB_RL_WRITES: { limit: async () => ({ success: true }) } };

    const res = await worker.fetch(inviteRequest(fx), env as never, ctx);
    assert.equal(res.status, 201, await res.clone().text());
    assert.equal(pending.length, 1, 'worker.fetch passed the ExecutionContext through to the route');
    await Promise.all(pending);
    assert.equal(calls.length, 1);
  } finally {
    await db.close();
  }
});

test('UAT: with no ExecutionContext the invite still succeeds, and the skip is logged as a reason code only', async (t) => {
  const db = await freshSchema();
  try {
    const fx = await fixture(db.pool);
    const app = createApp(async () => {}, { pool: db.pool });
    const calls = fakeBrevo(t);
    const lines = warnLines(t);

    const res = await app.request(inviteRequest(fx), undefined, { ...MAIL_ENV, DATABASE_URL: db.schemaUrl } as never);
    assert.equal(res.status, 201, 'a missing ExecutionContext never fails the invite');
    assert.equal(calls.length, 0);
    const logged = lines();
    assert.ok(logged.some((l) => l.includes('skipped:no_execution_context')), `logged: ${logged.join(' | ')}`);
    for (const line of logged) {
      assert.equal(line.includes(fx.invitee), false, 'the log holds no address');
    }
  } finally {
    await db.close();
  }
});

test('UAT: each skip path logs its reason code, and nothing is sent', async (t) => {
  const db = await freshSchema();
  try {
    const fx = await fixture(db.pool);
    const app = createApp(async () => {}, { pool: db.pool });
    const calls = fakeBrevo(t);
    const lines = warnLines(t);

    const { pending, ctx } = recordingContext();
    const noKey = { MAIL_FROM_EMAIL: MAIL_ENV.MAIL_FROM_EMAIL, APP_ORIGIN: ORIGIN, DATABASE_URL: db.schemaUrl };
    await app.fetch(inviteRequest(fx, `first.${fx.invitee}`), noKey, ctx);
    assert.equal(pending.length, 0, 'no waitUntil without mail configuration');
    assert.ok(lines().some((l) => l.includes('skipped:mail_not_configured')));

    const { pending: p2, ctx: ctx2 } = recordingContext();
    await app.fetch(inviteRequest(fx, `second.${fx.invitee}`), { ...MAIL_ENV }, ctx2);
    assert.equal(p2.length, 0, 'no waitUntil without a connection string');
    assert.ok(lines().some((l) => l.includes('skipped:no_connection_string')));
    assert.equal(calls.length, 0);
  } finally {
    await db.close();
  }
});

test('UAT: a Brevo 500 is logged as a retry reason and the row stays pending for the drain', async (t) => {
  const db = await freshSchema();
  try {
    const fx = await fixture(db.pool);
    const app = createApp(async () => {}, { pool: db.pool });
    fakeBrevo(t, 500);
    const lines = warnLines(t);
    const { pending, ctx } = recordingContext();

    const res = await app.fetch(inviteRequest(fx), { ...MAIL_ENV, DATABASE_URL: db.schemaUrl }, ctx);
    assert.equal(res.status, 201);
    await Promise.all(pending);
    assert.ok(lines().some((l) => l.includes('retry:brevo_http_500')), `logged: ${lines().join(' | ')}`);

    const row = await db.pool.query<{ status: string; retry_count: number }>(
      `SELECT status, retry_count FROM outbox WHERE event_type = 'invitation.created' AND project_id = $1`,
      [fx.project],
    );
    assert.equal(row.rows[0]!.status, 'pending', 'a retryable failure is left for the scheduled drain');
  } finally {
    await db.close();
  }
});
