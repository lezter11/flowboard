import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { createApp } from '../src/http/app.ts';
import { DEFAULT_LIMITS } from '../src/services/limits.ts';

// Forced-interleaving tests through mounted routes (review R3 probes P1-P6). A helper connection
// holds the board row; two requests then queue behind it in a fixed order. When the helper commits,
// any lock-order inversion is broken by PostgreSQL with 40P01 and surfaces as a 503 or 500.
// Every case asserts that no response is a server error. Controls (P3, P5, P6) check the same
// harness on pairs that were already safe.

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
const ROUNDS = 6;

test('comment PATCH/DELETE, import commit and their controls never return a server error under forced interleaving', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async (t) => {
  const schema = `lo_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 16, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('owner@lockorder.test', 'Owner', pool);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
    const app = createApp(async () => {}, { pool, limits: { ...DEFAULT_LIMITS, boardsPerProjectTotal: 1000 } });
    const req = (method: string, path: string, body?: unknown) => app.request(path, {
      method,
      headers: {
        cookie: `flowboard_session=${owner.session.id}`,
        'content-type': 'application/json',
        'Idempotency-Key': 'k-' + crypto.randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const waitingCount = async () => Number((await pool.query(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`)).rows[0].n);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    async function setupRound() {
      // Each round is independent; keep old boards outside the active quota and reset only
      // this synthetic fixture's board-create windows before creating its next board.
      await pool.query(`UPDATE boards SET archived=true WHERE project_id='p' AND archived=false`);
      await pool.query(`DELETE FROM rate_limit_windows WHERE bucket IN ('board-create','board-create-hour')`);
      const boardId = ((await (await req('POST', '/api/v1/projects/p/boards', { name: 'B' })).json()) as any).data.id as string;
      const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
      const bv = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
      const card = ((await (await req('POST', `/api/v1/boards/${boardId}/cards`, { title: 'X', columnId: cols[0], expectedBoardVersion: await bv() })).json()) as any).data as { id: string; version: number };
      const comment = ((await (await req('POST', `/api/v1/cards/${card.id}/comments`, { body: 'first' })).json()) as any).data as { id: string; version: number };
      return { boardId, cols, bv, card, comment };
    }

    // Holds the board row; `first` queues before `second`; the helper then commits.
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
        return [a.status, b.status];
      } finally {
        helper.release();
      }
    }

    async function makeImport(boardId: string, defaultColumnId: string): Promise<string> {
      const id = 'imp_' + crypto.randomUUID();
      await pool.query(
        `INSERT INTO card_imports (id, workspace_id, project_id, board_id, default_column_id, uploader_id, version, state, preview_digest, expires_at, created_at, updated_at)
         VALUES ($1, 'w', 'p', $2, $3, $4, 1, 'ready', 'digest-x', NOW() + INTERVAL '1 day', NOW(), NOW())`,
        [id, boardId, defaultColumnId, owner.user.id],
      );
      return id;
    }

    const cases: Array<{ name: string; run: (s: Awaited<ReturnType<typeof setupRound>>, i: number) => Promise<number[]> }> = [
      { name: 'P1 move vs comment PATCH', run: async (s, i) => forced(s.boardId,
        async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() }),
        async () => req('PATCH', `/api/v1/comments/${s.comment.id}`, { body: `edited ${i}`, expectedVersion: s.comment.version })) },
      { name: 'P2 move vs comment DELETE', run: async (s) => forced(s.boardId,
        async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() }),
        async () => req('DELETE', `/api/v1/comments/${s.comment.id}`, { expectedVersion: s.comment.version })) },
      { name: 'P4 import commit vs the same import commit', run: async (s) => {
        const importId = await makeImport(s.boardId, s.cols[0]!);
        const body = { previewDigest: 'digest-x', defaultColumnId: s.cols[0], expectedVersion: 1 };
        return forced(s.boardId,
          async () => req('POST', `/api/v1/imports/${importId}/commit`, body),
          async () => req('POST', `/api/v1/imports/${importId}/commit`, body));
      } },
      { name: 'P3 control: move vs card create', run: async (s) => forced(s.boardId,
        async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() }),
        async () => req('POST', `/api/v1/boards/${s.boardId}/cards`, { title: 'Z', columnId: s.cols[0], expectedBoardVersion: await s.bv() })) },
      { name: 'P5 control: import commit vs card create', run: async (s) => {
        const importId = await makeImport(s.boardId, s.cols[0]!);
        return forced(s.boardId,
          async () => req('POST', `/api/v1/imports/${importId}/commit`, { previewDigest: 'digest-x', defaultColumnId: s.cols[0], expectedVersion: 1 }),
          async () => req('POST', `/api/v1/boards/${s.boardId}/cards`, { title: 'Q', columnId: s.cols[0], expectedBoardVersion: await s.bv() }));
      } },
      { name: 'P6 control: comment POST vs move', run: async (s, i) => forced(s.boardId,
        async () => req('POST', `/api/v1/cards/${s.card.id}/comments`, { body: `post ${i}` }),
        async () => req('POST', `/api/v1/cards/${s.card.id}/move`, { toColumnId: s.cols[1], previousCardId: null, nextCardId: null, expectedVersion: s.card.version, expectedBoardVersion: await s.bv() })) },
    ];

    for (const c of cases) {
      await t.test(c.name, async () => {
        for (let i = 0; i < ROUNDS; i++) {
          const s = await setupRound();
          const statuses = await c.run(s, i);
          for (const status of statuses) {
            assert.ok(status < 500, `round ${i}: ${c.name} returned ${status} (${statuses.join(',')})`);
          }
        }
      });
    }
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
