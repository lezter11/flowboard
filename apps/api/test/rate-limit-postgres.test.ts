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

test('purge: removes only windows that have ended, and a repeat run deletes nothing for them', async () => {
  const pool = await setup();
  const key = freshKey();
  const now = Number((await pool.query<{ t: string }>("SELECT floor(extract(epoch FROM now()))::bigint AS t")).rows[0]!.t);
  await pool.query(
    'INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count) VALUES ($1, $2, $3, 1), ($1, $2, $4, 1)',
    ['auth', key, now - 600, now - 30],
  );
  const current = await consumeWindow(pool, 'auth', key, 60);
  assert.equal(current.count, 1);

  await purgeEndedWindows(pool, 60);
  const remaining = await pool.query<{ window_start: string }>(
    'SELECT window_start FROM rate_limit_windows WHERE client_key = $1 ORDER BY window_start',
    [key],
  );
  // The 600-second-old window ended and is gone; the 30-second-old window is still open and kept.
  assert.equal(remaining.rows.length, 2);
  assert.ok(Number(remaining.rows[0]!.window_start) > now - 600);

  await purgeEndedWindows(pool, 60);
  await purgeEndedWindows(pool, 60);
  const after = await pool.query('SELECT 1 FROM rate_limit_windows WHERE client_key = $1 AND window_start = $2', [key, now - 600]);
  assert.equal(after.rowCount, 0);
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
