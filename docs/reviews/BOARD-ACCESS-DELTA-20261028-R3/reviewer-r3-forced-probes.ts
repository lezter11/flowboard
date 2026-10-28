// Reviewer R3 forced-interleaving probes (read-only against the repository; writes only to a
// throwaway schema on the isolated synthetic PostgreSQL). Each round holds the board row FOR UPDATE
// with a helper connection, queues two mounted-route requests behind it in a fixed order, then
// releases the helper. The first queued request then takes the board and needs the card (or import)
// row that the second request already holds, so PostgreSQL must break any cycle with 40P01.
// Run (from the worktree root, with the two synthetic URLs exported):
//   node docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/reviewer-r3-forced-probes.ts
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `r3force_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 16, options: `-c search_path=${schema}` });
const out: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deadlockCount = async (): Promise<number> => Number((await admin.query(
  `SELECT deadlocks::int AS d FROM pg_stat_database WHERE datname = current_database()`)).rows[0].d);
let deadlocksBefore = 0;
try {
  await runMigrations(pool);
  deadlocksBefore = await deadlockCount();
  const owner = await createDevUserAndSession('owner@r3force.test', 'Owner', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  const app = createApp(async () => {}, { pool });
  const req = (method: string, path: string, body?: unknown) => app.request(path, {
    method,
    headers: {
      cookie: `flowboard_session=${owner.session.id}`,
      'content-type': 'application/json',
      'Idempotency-Key': 'k-' + crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  async function waitingCount(): Promise<number> {
    const r = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`);
    return r.rows[0]!.n;
  }

  // Fresh board, one card and one comment per round so rounds do not share lock state.
  async function setupRound() {
    const bres = await req('POST', '/api/v1/projects/p/boards', { name: 'B' });
    const boardId = ((await bres.json()) as any).data.id as string;
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
    const bv = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
    const cres = await req('POST', `/api/v1/boards/${boardId}/cards`, { title: 'X', columnId: cols[0], expectedBoardVersion: await bv() });
    const card = ((await cres.json()) as any).data as { id: string; version: number };
    const comres = await req('POST', `/api/v1/cards/${card.id}/comments`, { body: 'first' });
    const comment = ((await comres.json()) as any).data as { id: string; version: number };
    return { boardId, cols, bv, card, comment };
  }

  // Helper holds the board row; `first` queues before `second`; then the helper commits.
  async function forced(boardId: string, first: () => Promise<Response>, second: () => Promise<Response>) {
    const helper = await pool.connect();
    try {
      await helper.query('BEGIN');
      await helper.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [boardId]);
      const firstP = first();
      for (let i = 0; i < 400 && (await waitingCount()) < 1; i++) await sleep(5);
      const secondP = second();
      for (let i = 0; i < 400 && (await waitingCount()) < 2; i++) await sleep(5);
      await helper.query('COMMIT');
      const [a, b] = await Promise.all([firstP, secondP]);
      const bodies = [await a.clone().text(), await b.clone().text()].map((t) => t.slice(0, 200));
      return { statuses: [a.status, b.status], bodies };
    } finally {
      helper.release();
    }
  }

  const isServerError = (s: number) => s >= 500;

  // P1: move first, comment PATCH second (card FOR SHARE taken before board in comments.ts:199).
  const p1: number[][] = [];
  const p1Bodies: string[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupRound();
    const r = await forced(
      s.boardId,
      async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() }),
      async () => req('PATCH', `/api/v1/comments/${s.comment.id}`, { body: `edited ${i}`, expectedVersion: s.comment.version }),
    );
    p1.push(r.statuses);
    if (r.statuses.some(isServerError)) p1Bodies.push(r.bodies);
  }
  out['P1_forced_move_then_comment_PATCH_statuses_move_patch_10_rounds'] = p1;
  out['P1_error_bodies'] = p1Bodies;

  // P2: move first, comment DELETE second.
  const p2: number[][] = [];
  const p2Bodies: string[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupRound();
    const r = await forced(
      s.boardId,
      async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() }),
      async () => req('DELETE', `/api/v1/comments/${s.comment.id}`, { expectedVersion: s.comment.version }),
    );
    p2.push(r.statuses);
    if (r.statuses.some(isServerError)) p2Bodies.push(r.bodies);
  }
  out['P2_forced_move_then_comment_DELETE_statuses_move_delete_10_rounds'] = p2;
  out['P2_error_bodies'] = p2Bodies;

  // P3: control, move first, move second (both board-first; expected no deadlock).
  const p3: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupRound();
    const r = await forced(
      s.boardId,
      async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() }),
      async () => req('POST', `/api/v1/boards/${s.boardId}/cards`, { title: 'Z', columnId: s.cols[0], expectedBoardVersion: await s.bv() }),
    );
    p3.push(r.statuses);
  }
  out['P3_control_forced_move_then_card_create_statuses_10_rounds'] = p3;

  // P4: import commit first, commit second, same import. Each commit takes the import row FOR SHARE
  // (routes/imports.ts:222), then the board FOR UPDATE, then the import row FOR UPDATE (imports.ts:684 and 808).
  // An import row needs no rows to reach those locks, so an empty ready session is enough for the lock probe.
  async function makeImport(boardId: string, defaultColumnId: string): Promise<string> {
    const id = 'imp_' + crypto.randomUUID();
    await pool.query(
      `INSERT INTO card_imports (id, workspace_id, project_id, board_id, default_column_id, uploader_id, version, state, preview_digest, expires_at, created_at, updated_at)
       VALUES ($1, 'w', 'p', $2, $3, $4, 1, 'ready', 'digest-x', NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [id, boardId, defaultColumnId, owner.user.id],
    );
    return id;
  }
  const p4: number[][] = [];
  const p4Bodies: string[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupRound();
    const importId = await makeImport(s.boardId, s.cols[0]!);
    const commitBody = { previewDigest: 'digest-x', defaultColumnId: s.cols[0], expectedVersion: 1 };
    const r = await forced(
      s.boardId,
      async () => req('POST', `/api/v1/imports/${importId}/commit`, commitBody),
      async () => req('POST', `/api/v1/imports/${importId}/commit`, commitBody),
    );
    p4.push(r.statuses);
    if (r.statuses.some(isServerError)) p4Bodies.push(r.bodies);
  }
  out['P4_forced_import_commit_then_commit_same_import_statuses_10_rounds'] = p4;
  out['P4_error_bodies'] = p4Bodies;

  // P5: import commit first, card create second (control for the import/board order).
  const p5: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupRound();
    const importId = await makeImport(s.boardId, s.cols[0]!);
    const commitBody = { previewDigest: 'digest-x', defaultColumnId: s.cols[0], expectedVersion: 1 };
    const r = await forced(
      s.boardId,
      async () => req('POST', `/api/v1/imports/${importId}/commit`, commitBody),
      async () => req('POST', `/api/v1/boards/${s.boardId}/cards`, { title: 'Q', columnId: s.cols[0], expectedBoardVersion: await s.bv() }),
    );
    p5.push(r.statuses);
  }
  out['P5_forced_import_commit_then_card_create_statuses_10_rounds'] = p5;

  // P6: a comment POST first, move second (post-fix board-first order). Expected: no 500 in any round.
  const p6: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupRound();
    const r = await forced(
      s.boardId,
      async () => req('POST', `/api/v1/cards/${s.card.id}/comments`, { body: `post ${i}` }),
      async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() }),
    );
    p6.push(r.statuses);
  }
  out['P6_forced_comment_POST_then_move_statuses_10_rounds'] = p6;
  out['pg_stat_database_deadlocks_delta_all_rounds'] = (await deadlockCount()) - deadlocksBefore;
} finally {
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
