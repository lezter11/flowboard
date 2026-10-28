// Reviewer reproduction for finding DR1-01: parallel card creates on one board return 500.
// Usage: NODE_ENV=test FLOWBOARD_ACCESS_TEST_DATABASE_URL=... node docs/reviews/BOARD-ACCESS-DELTA-20261028/reviewer-race-repro.ts [same|fresh]
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
const url = process.env.FLOWBOARD_ACCESS_TEST_DATABASE_URL!;
const schema = `delta_par_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });
try {
  await runMigrations(pool);
  const o = await createDevUserAndSession('o@test.invalid', 'O', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [o.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  const app = createApp(async () => {}, { pool });
  const r = await app.request('/api/v1/projects/p/boards', { method: 'POST', headers: { cookie: `flowboard_session=${o.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() }, body: JSON.stringify({ name: 'B' }) });
  const b = ((await r.json()) as any).data;
  const col = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position LIMIT 1', [b.id])).rows[0].id;
  const ver = Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [b.id])).rows[0].structure_version);
  const mode = process.argv[2] ?? 'same';
  const H = () => ({ cookie: `flowboard_session=${o.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() });
  const bv = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [b.id])).rows[0].structure_version);
  if (mode === 'move') {
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [b.id])).rows.map((r) => r.id);
    const ids: { id: string; version: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await app.request(`/api/v1/boards/${b.id}/cards`, { method: 'POST', headers: H(), body: JSON.stringify({ title: 'M' + i, columnId: cols[0], expectedBoardVersion: await bv() }) });
      const d = ((await r.json()) as any).data; ids.push({ id: d.id, version: d.version });
    }
    const v = await bv();
    const res = await Promise.all(ids.map((c) => app.request(`/api/v1/cards/${c.id}/move`, { method: 'POST', headers: H(), body: JSON.stringify({ toColumnId: cols[1], previousCardId: null, nextCardId: null, expectedVersion: c.version, expectedBoardVersion: v }) })));
    for (const x of res) console.log('MOVE-RESULT', x.status, (await x.text()).slice(0, 160));
    process.exit(0);
  }
  const res = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
    const v = mode === 'same' ? ver : Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [b.id])).rows[0].structure_version);
    return app.request(`/api/v1/boards/${b.id}/cards`, { method: 'POST', headers: { cookie: `flowboard_session=${o.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() }, body: JSON.stringify({ title: 'T' + i, columnId: col, expectedBoardVersion: v }) });
  }));
  for (const x of res) console.log('RESULT', x.status, (await x.text()).slice(0, 200));
  // sequential stale version
  const stale = await app.request(`/api/v1/boards/${b.id}/cards`, { method: 'POST', headers: { cookie: `flowboard_session=${o.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() }, body: JSON.stringify({ title: 'S', columnId: col, expectedBoardVersion: ver }) });
  console.log('SEQUENTIAL-STALE', stale.status, (await stale.text()).slice(0, 300));
} finally { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
