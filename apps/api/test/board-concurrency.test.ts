import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { EMBEDDED_MIGRATIONS } from '../src/adapters/embedded-migrations.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { adminSecretMatches } from '../src/http/admin-secret.ts';
import { createApp } from '../src/http/app.ts';
import { errorHandler } from '../src/http/middleware/error-handler.ts';
import { Hono } from 'hono';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];

test('parallel writes on one board never deadlock into 500', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async () => {
  const schema = `conc_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 12, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('owner@concurrency.test', 'Owner', pool);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
    const app = createApp(async () => {}, { pool });
    const headers = () => ({
      cookie: `flowboard_session=${owner.session.id}`,
      'content-type': 'application/json',
      'Idempotency-Key': 'k-' + crypto.randomUUID(),
    });
    const created = await app.request('/api/v1/projects/p/boards', { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'B' }) });
    const boardId = ((await created.json()) as any).data.id as string;
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
    const boardVersion = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);

    const version = await boardVersion();
    const creates = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      app.request(`/api/v1/boards/${boardId}/cards`, { method: 'POST', headers: headers(), body: JSON.stringify({ title: `T${i}`, columnId: cols[0], expectedBoardVersion: version }) })));
    const createStatuses = creates.map((r) => r.status).sort();
    assert.ok(createStatuses.every((s) => s === 201 || s === 409), `create statuses ${createStatuses}`);
    assert.ok(createStatuses.includes(201));

    const cards: { id: string; version: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await app.request(`/api/v1/boards/${boardId}/cards`, { method: 'POST', headers: headers(), body: JSON.stringify({ title: `M${i}`, columnId: cols[0], expectedBoardVersion: await boardVersion() }) });
      assert.equal(r.status, 201);
      const d = ((await r.json()) as any).data;
      cards.push({ id: d.id, version: d.version });
    }
    const v = await boardVersion();
    const moves = await Promise.all(cards.map((c) =>
      app.request(`/api/v1/cards/${c.id}/move`, { method: 'POST', headers: headers(), body: JSON.stringify({ toColumnId: cols[1], previousCardId: null, nextCardId: null, expectedVersion: c.version, expectedBoardVersion: v }) })));
    const moveStatuses = moves.map((r) => r.status).sort();
    assert.ok(moveStatuses.every((s) => s === 200 || s === 409), `move statuses ${moveStatuses}`);
    assert.ok(moveStatuses.includes(200));
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});

test('PostgreSQL deadlock and serialization failures become a retryable 503, not a 500', async () => {
  for (const code of ['40P01', '40001']) {
    const app = new Hono<{ Variables: { requestId: string } }>();
    app.onError(errorHandler);
    app.get('/boom', () => { throw Object.assign(new Error('deadlock detected'), { code }); });
    const res = await app.request('/boom');
    assert.equal(res.status, 503, code);
    assert.equal(res.headers.get('retry-after'), '1');
    const body = (await res.json()) as any;
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
    assert.ok(!JSON.stringify(body).includes('deadlock'));
  }
});

test('a deployed Worker never accepts the test-only admin secret, even if NODE_ENV=test was bundled', () => {
  assert.equal(process.env['NODE_ENV'], 'test');
  assert.equal(adminSecretMatches('flowboard-dev-secret', undefined, false), true);
  assert.equal(adminSecretMatches('flowboard-dev-secret', undefined, true), false);
});

test('embedded migrations match database/migrations byte for byte', () => {
  const dir = new URL('../../../database/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(EMBEDDED_MIGRATIONS.map((m) => m.name), files);
  for (const m of EMBEDDED_MIGRATIONS) {
    assert.equal(m.sql, fs.readFileSync(new URL(m.name, dir), 'utf8'), m.name);
  }
});
