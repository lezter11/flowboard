// Reviewer R2 lock-order probe (read-only against the repository). Writes only to a throwaway
// schema on the isolated synthetic PostgreSQL. Compares a move racing a trash of the SAME card
// (move: board FOR UPDATE then card FOR UPDATE; trash: card+board FOR UPDATE in one JOIN statement)
// against a move racing a move of the same card (control).
// Run: node docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/reviewer-r2-lock-order-probe.ts
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `r2lock_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });
const out: Record<string, unknown> = {};

try {
  await runMigrations(pool);
  const owner = await createDevUserAndSession('owner@r2lock.test', 'Owner', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  const app = createApp(async () => {}, { pool });
  const post = (path: string, body: unknown) => app.request(path, {
    method: 'POST',
    headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() },
    body: JSON.stringify(body),
  });

  const counts = (label: string, statuses: number[]) => {
    const tally: Record<string, number> = {};
    for (const s of statuses) tally[String(s)] = (tally[String(s)] ?? 0) + 1;
    out[label] = tally;
  };

  async function round(kind: 'move-vs-trash' | 'move-vs-move') {
    const bres = await post('/api/v1/projects/p/boards', { name: 'B' });
    const boardId = ((await bres.json()) as any).data.id as string;
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
    const bv = Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
    const cres = await post(`/api/v1/boards/${boardId}/cards`, { title: 'X', columnId: cols[0], expectedBoardVersion: bv });
    const card = ((await cres.json()) as any).data as { id: string; version: number };
    const bv2 = Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
    const moveBody = { toColumnId: cols[1], previousCardId: null, nextCardId: null, expectedVersion: card.version, expectedBoardVersion: bv2 };
    const second = kind === 'move-vs-trash'
      ? post(`/api/v1/cards/${card.id}/delete`, { expectedVersion: card.version, expectedBoardVersion: bv2 })
      : post(`/api/v1/cards/${card.id}/move`, { ...moveBody, toColumnId: cols[0] });
    const [a, b] = await Promise.all([post(`/api/v1/cards/${card.id}/move`, moveBody), second]);
    return [a.status, b.status];
  }

  const started = Date.now();
  const trashStatuses: number[] = [];
  const moveStatuses: number[] = [];
  for (let i = 0; i < 20; i++) {
    const [m, t] = await round('move-vs-trash');
    moveStatuses.push(m);
    trashStatuses.push(t);
  }
  counts('P6_move_vs_trash_move_statuses_20_rounds', moveStatuses);
  counts('P6_move_vs_trash_trash_statuses_20_rounds', trashStatuses);

  const controlStatuses: number[] = [];
  for (let i = 0; i < 20; i++) {
    const [a, b] = await round('move-vs-move');
    controlStatuses.push(a, b);
  }
  counts('P6_control_move_vs_move_statuses_20_rounds', controlStatuses);
  out['elapsed_ms'] = Date.now() - started;
} finally {
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
