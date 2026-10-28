// Reviewer R2 forced lock-order probe, COMMENT variant (comment POST locks the card FOR SHARE before the board) (read-only against the repository; writes only to a
// throwaway schema on the isolated synthetic PostgreSQL). A helper connection holds the board row
// FOR UPDATE. The move request queues on the board first, then the trash request queues on the same
// board while it already holds nothing but its card-row lock (trash locks card+board in one JOIN
// statement). When the helper commits, the move takes the board and then waits for the card that the
// trash holds: a cycle PostgreSQL must break with 40P01.
// Run: node docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/reviewer-r2-lock-order-forced-probe.ts
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `r2comment_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });
const out: Record<string, unknown> = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  await runMigrations(pool);
  const owner = await createDevUserAndSession('owner@r2comment.test', 'Owner', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  const app = createApp(async () => {}, { pool });
  const post = (path: string, body: unknown) => app.request(path, {
    method: 'POST',
    headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() },
    body: JSON.stringify(body),
  });

  async function waitingCount(): Promise<number> {
    const r = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`);
    return r.rows[0]!.n;
  }

  async function forcedRound(kind: 'trash' | 'move'): Promise<{ move: number; second: number; bodies: string[] }> {
    const bres = await post('/api/v1/projects/p/boards', { name: 'B' });
    const boardId = ((await bres.json()) as any).data.id as string;
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
    const bv = Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
    const cres = await post(`/api/v1/boards/${boardId}/cards`, { title: 'X', columnId: cols[0], expectedBoardVersion: bv });
    const card = ((await cres.json()) as any).data as { id: string; version: number };
    const bv2 = Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);

    const helper = await pool.connect();
    try {
      await helper.query('BEGIN');
      await helper.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [boardId]);
      const moveBody = { toColumnId: cols[1], previousCardId: null, nextCardId: null, expectedVersion: card.version, expectedBoardVersion: bv2 };
      const moveP = post(`/api/v1/cards/${card.id}/move`, moveBody);
      for (let i = 0; i < 400 && (await waitingCount()) < 1; i++) await sleep(5);
      const secondP = kind === 'trash'
        ? post(`/api/v1/cards/${card.id}/comments`, { body: 'hello from the comment race' })
        : post(`/api/v1/cards/${card.id}/move`, { ...moveBody, toColumnId: cols[0] });
      for (let i = 0; i < 400 && (await waitingCount()) < 2; i++) await sleep(5);
      await helper.query('COMMIT');
      const [m, s] = await Promise.all([moveP, secondP]);
      const bodies = [await m.text(), await s.text()].map((t) => t.slice(0, 160));
      return { move: m.status, second: s.status, bodies };
    } finally {
      helper.release();
    }
  }

  const trash: number[][] = [];
  const trashBodies: string[][] = [];
  for (let i = 0; i < 10; i++) {
    const r = await forcedRound('trash');
    trash.push([r.move, r.second]);
    if (r.move >= 500 || r.second >= 500) trashBodies.push(r.bodies);
  }
  out['P8_forced_move_then_comment_pairs_move_comment_10_rounds'] = trash;
  out['P8_forced_move_then_comment_error_bodies'] = trashBodies;

  const control: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const r = await forcedRound('move');
    control.push([r.move, r.second]);
  }
  out['P8_control_forced_move_then_move_pairs_10_rounds'] = control;
} finally {
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
