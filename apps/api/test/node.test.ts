import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createDatabase, queryDatabase } from '../src/adapters/postgres.ts';
import { startNode } from '../src/runtime/node.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { rollbackProbe } from './rollback-probe.ts';

test('Node HTTP: liveness, real PostgreSQL readiness, missing product routes', async () => {
  const runtime = startNode(0);
  try {
    if (!runtime.server.listening) await once(runtime.server, 'listening');
    const address = runtime.server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    for (const [path, status] of [['/health/live', 'ok'], ['/health/ready', 'ready']]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { data: { status } });
    }
    const missing = await fetch(`${base}/api/v1/boards/not-implemented`);
    assert.equal(missing.status, 404);
    const body = await missing.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.requestId);
  } finally { await runtime.close(); }
});

test('Node pg/Kysely: real parameterized query, rollback and committed positive control', async () => {
  const db = createDatabase(localDatabaseUrl(process.env['DATABASE_URL']), 4);
  try {
    await queryDatabase(db);
    assert.deepEqual(await rollbackProbe(db), { seenInside: 1, afterRollback: 0, afterCommit: 1 });
  } finally { await db.destroy(); }
});

test('Node HTTP: refused local database returns safe 503; liveness stays independent', async () => {
  // Port 1 is not a listening database here; exercise an actual failed connection.
  const runtime = startNode(0,
    'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:1/flowboard_harness');
  try {
    if (!runtime.server.listening) await once(runtime.server, 'listening');
    const address = runtime.server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    const response = await fetch(`${base}/health/ready`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
    assert.ok(body.error.requestId);
    assert.doesNotMatch(JSON.stringify(body), /postgres:|flowboard_local_only|ECONNREFUSED|SELECT/i);
  } finally { await runtime.close(); }
});

test('local harness rejects nonlocal and non-harness database targets', () => {
  assert.throws(() => localDatabaseUrl('postgres://flowboard_harness:x@example.com/flowboard_harness'));
  assert.throws(() => localDatabaseUrl('postgres://flowboard_harness:x@localhost/production'));
  assert.throws(() => localDatabaseUrl('postgres://flowboard_harness:x@localhost/flowboard_harness?host=example.com'));
});
