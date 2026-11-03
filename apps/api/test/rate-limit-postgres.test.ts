import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { getPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { EMBEDDED_MIGRATIONS } from '../src/adapters/embedded-migrations.ts';
import { consumeWindow, postgresWindowCounter, purgeEndedWindows } from '../src/adapters/rate-limit-postgres.ts';

// Real PostgreSQL. Each test uses fresh random client keys, so runs never share counters.
// Keys must look like an IP address: anything else is the Worker's shared fallback key.
const freshKey = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;
const migrationPath = fileURLToPath(new URL('../../../database/migrations/0011_rate_limit_windows.sql', import.meta.url));

async function setup(): Promise<pg.Pool> {
  const pool = getPool();
  await runMigrations(pool);
  return pool;
}

test('exact: 30 parallel requests on one key with limit 10 give exactly 10 passes and 20 refusals', async () => {
  const pool = await setup();
  const key = freshKey();
  const counts = await Promise.all(Array.from({ length: 30 }, () => consumeWindow(pool, 'auth', key, 60)));
  const values = counts.map((c) => c.count).sort((a, b) => a - b);
  // Every request got its own number 1..30, so none was double-counted or lost.
  assert.deepEqual(values, Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(values.filter((n) => n <= 10).length, 10);
  assert.equal(values.filter((n) => n > 10).length, 20);
});

test('exact over HTTP: 30 parallel sign-in requests give exactly 10 non-429 responses', async () => {
  const pool = await setup();
  const app = createApp(async () => {}, { pool });
  const key = freshKey();
  const responses = await Promise.all(
    Array.from({ length: 30 }, () =>
      app.request('/api/v1/auth/google', { headers: { 'cf-connecting-ip': key }, redirect: 'manual' }),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 429).length, 20);
  assert.equal(responses.filter((r) => r.status !== 429).length, 10);
  const refused = responses.find((r) => r.status === 429);
  assert.ok(refused);
  const retry = Number(refused.headers.get('retry-after'));
  assert.ok(retry >= 1 && retry <= 60, `retry-after ${retry}`);
});

test('window: the counter returns the seconds left in the current window, between 1 and the window length', async () => {
  const pool = await setup();
  const result = await consumeWindow(pool, 'upload', freshKey(), 60);
  assert.equal(result.count, 1);
  assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 60);
});

test('window: a new window starts a fresh count after the old one ends', async () => {
  const pool = await setup();
  const key = freshKey();
  const first = await consumeWindow(pool, 'import', key, 2);
  const second = await consumeWindow(pool, 'import', key, 2);
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  // Wait until the database clock has moved past this window's end, then count again.
  await new Promise((resolve) => setTimeout(resolve, (first.retryAfterSeconds + 0.3) * 1000));
  const rolled = await consumeWindow(pool, 'import', key, 2);
  assert.equal(rolled.count, 1);
});

test('isolation: separate keys and separate buckets never share a count', async () => {
  const pool = await setup();
  const a = freshKey();
  const b = freshKey();
  for (let i = 0; i < 3; i += 1) await consumeWindow(pool, 'auth', a, 60);
  assert.equal((await consumeWindow(pool, 'auth', b, 60)).count, 1);
  assert.equal((await consumeWindow(pool, 'invite', a, 60)).count, 1);
  assert.equal((await consumeWindow(pool, 'auth', a, 60)).count, 4);
});

// Only this fresh schema's real migration0011 table participates in exact purge counts.
// A transaction makes PostgreSQL now() stable across seed/consume/purge; no wall-clock sleep,
// test clock replacement, or product SQL change is needed.
async function isolatedPurgeFixture(run: (client: pg.PoolClient, now: number) => Promise<void>): Promise<void> {
  const pool = await setup();
  const client = await pool.connect();
  const schema = 'rate_purge_' + crypto.randomUUID().replaceAll('-', '');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await client.query(readFileSync(migrationPath, 'utf8'));
    const now = Number((await client.query<{ t: string }>("SELECT floor(extract(epoch FROM now()))::bigint AS t")).rows[0]!.t);
    await run(client, now);
  } finally {
    // Rollback removes only the generated schema/table and restores the connection search path.
    await client.query('ROLLBACK');
    client.release();
  }
}

test('purge: removes only windows that have ended, and a repeat run deletes nothing for them', async () => {
  await isolatedPurgeFixture(async (client, now) => {
    const key = freshKey();
    const alignedCurrentStart = now - now % 60;
    // At second30 the old now-30 seed WAS the live counter row. Keep a distinct,
    // already-started open window even at that boundary (age31 instead of30).
    const openStart = now - 30 === alignedCurrentStart ? now - 31 : now - 30;
    assert.notEqual(openStart, alignedCurrentStart);
    assert.ok(openStart <= now && openStart + 60 > now);
    await client.query(
      'INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count) VALUES ($1, $2, $3, 1), ($1, $2, $4, 1)',
      ['auth', key, now - 600, openStart],
    );
    assert.equal((await consumeWindow(client, 'auth', key, 60)).count, 1);
    assert.equal(await purgeEndedWindows(client, 60), 1);
    const remaining = await client.query<{ window_start: string; request_count: number }>(
      'SELECT window_start, request_count FROM rate_limit_windows WHERE client_key = $1 ORDER BY window_start', [key],
    );
    assert.deepEqual(remaining.rows.map(row => Number(row.window_start)), [openStart, alignedCurrentStart].sort((a,b) => a-b));
    assert.ok(remaining.rows.every(row => Number(row.request_count) === 1));
    assert.equal(await purgeEndedWindows(client, 60), 0);
    assert.equal(await purgeEndedWindows(client, 60), 0);
    assert.equal((await client.query('SELECT 1 FROM rate_limit_windows WHERE client_key = $1 AND window_start = $2', [key, now - 600])).rowCount, 0);
  });
});

test('purge: exact end second is deleted while a window with one second remaining is retained', async () => {
  await isolatedPurgeFixture(async (client, now) => {
    const key = freshKey();
    await client.query(`INSERT INTO rate_limit_windows(bucket,client_key,window_start,request_count)
      VALUES('auth',$1,$2,1),('auth',$1,$3,1),('auth',$1,$4,1)`, [key,now-61,now-60,now-59]);
    assert.equal(await purgeEndedWindows(client,60),2);
    assert.deepEqual((await client.query('SELECT window_start FROM rate_limit_windows WHERE client_key=$1',[key])).rows.map(row=>Number(row.window_start)),[now-59]);
    assert.equal(await purgeEndedWindows(client,60),0);
  });
});

test('purge fixture: database-derived seconds0/29/30/59 keep the seeded open window distinct from the current counter', async () => {
  await isolatedPurgeFixture(async (client) => {
    const rows = (await client.query<{ second: number; now_s: string; aligned_start: string }>(`WITH minute AS (
      SELECT floor(extract(epoch FROM now()))::bigint/60*60 AS start
    ) SELECT second, (start+second)::text AS now_s,start::text AS aligned_start
      FROM minute CROSS JOIN (VALUES(0),(29),(30),(59)) AS boundary(second) ORDER BY second`)).rows;
    assert.deepEqual(rows.map(row=>row.second),[0,29,30,59]);
    for (const row of rows) {
      const now = Number(row.now_s), alignedStart = Number(row.aligned_start);
      const oldOpenStart = now-30;
      assert.equal(oldOpenStart === alignedStart,row.second === 30,'Pins the original fixture collision at second30');
      const openStart = oldOpenStart === alignedStart ? now-31 : oldOpenStart;
      assert.notEqual(openStart,alignedStart);assert.ok(openStart<=now && openStart+60>now);
    }
  });
});

test('migration 0011 is additive and idempotent', async () => {
  const pool = await setup();
  const sql = readFileSync(migrationPath, 'utf8');
  const executable = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(executable, /\b(DROP|DELETE|TRUNCATE|ALTER)\b/i);
  await pool.query(sql);
  await pool.query(sql);
  const embedded = EMBEDDED_MIGRATIONS.find((m) => m.version === '0011');
  assert.equal(embedded?.sql, sql, 'embedded 0011 must equal the file');
});

test('fail closed: a database error on a sensitive route returns 503 and never reaches the route', async () => {
  const pool = await setup();
  const broken = { query: async () => { throw new Error('database unavailable'); } } as unknown as pg.Pool;
  const app = createApp(async () => {}, { pool: broken });
  try {
    const res = await app.request('/api/v1/auth/google', { headers: { 'cf-connecting-ip': freshKey() }, redirect: 'manual' });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '1');
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'SERVICE_UNAVAILABLE');
  } finally {
    // createApp with a pool sets the process-wide pool; put the working one back for later tests.
    setGlobalPool(pool);
  }
});

test('health is never counted in the database', async () => {
  const pool = await setup();
  const key = freshKey();
  const app = createApp(async () => {}, { pool });
  await app.request('/health/live', { headers: { 'cf-connecting-ip': key } });
  const rows = await pool.query('SELECT 1 FROM rate_limit_windows WHERE client_key = $1', [key]);
  assert.equal(rows.rowCount, 0);
  assert.ok(postgresWindowCounter(pool));
});
