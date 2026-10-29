import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `probe_deadlock_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 16, options: `-c search_path=${schema}` });
const out: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deadlockCount = async (): Promise<number> => {
  const res = await admin.query<{ d: number }>(
    `SELECT COALESCE(sum(deadlocks), 0)::int AS d FROM pg_stat_database WHERE datname = current_database()`
  );
  return Number(res.rows[0]?.d ?? 0);
};

try {
  await runMigrations(pool);
  const deadlocksBefore = await deadlockCount();

  const owner = await createDevUserAndSession('owner@probe.test', 'Owner', pool);
  const manager = await createDevUserAndSession('manager@probe.test', 'Manager', pool);
  await pool.query(`INSERT INTO workspaces (id, name, timezone, owner_id, created_at, updated_at) VALUES ('w', 'W', 'UTC', $1, NOW(), NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id, workspace_id, name, created_at, updated_at) VALUES ('p', 'w', 'P', NOW(), NOW())`);
  await pool.query(
    `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
     VALUES ('pm1', 'p', 'w', $1, 'manager', 'active', 1, NOW(), NOW())`,
    [manager.user.id]
  );

  const app = createApp(async () => {}, { pool });
  const as = (session: { id: string }) => ({
    cookie: `flowboard_session=${session.id}`,
    'content-type': 'application/json',
    'Idempotency-Key': 'k-' + crypto.randomUUID(),
  });

  async function waitingCount(): Promise<number> {
    const r = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`
    );
    return r.rows[0]?.n ?? 0;
  }

  // Helper function to set up a fresh board and card for each test round
  async function setupBoardAndCard() {
    const bres = await app.request('/api/v1/projects/p/boards', {
      method: 'POST',
      headers: as(owner.session),
      body: JSON.stringify({ name: 'Probe Board' }),
    });
    const boardId = ((await bres.json()) as any).data.id as string;
    await app.request(`/api/v1/boards/${boardId}/grants/${manager.user.id}`, {
      method: 'PUT',
      headers: as(owner.session),
      body: JSON.stringify({ expectedAccessRevision: '1' }),
    });

    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map(
      (r) => r.id as string
    );
    const bv = async () =>
      Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);

    const cres = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: as(manager.session),
      body: JSON.stringify({ title: 'Card', columnId: cols[0], expectedBoardVersion: await bv() }),
    });
    const card = ((await cres.json()) as any).data as { id: string; version: number };

    const comres = await app.request(`/api/v1/cards/${card.id}/comments`, {
      method: 'POST',
      headers: as(manager.session),
      body: JSON.stringify({ body: 'initial comment' }),
    });
    const comment = ((await comres.json()) as any).data as { id: string; version: number };

    return { boardId, cols, bv, card, comment };
  }

  // Forced interleaving execution helper
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
      return { statuses: [a.status, b.status] };
    } finally {
      helper.release();
    }
  }

  console.log('Running Scenario 1: move then comment PATCH (10 rounds)...');
  const s1Results: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupBoardAndCard();
    const r = await forced(
      s.boardId,
      () =>
        app.request(`/api/v1/cards/${s.card.id}/move`, {
          method: 'POST',
          headers: as(manager.session),
          body: JSON.stringify({
            toColumnId: s.cols[1],
            previousCardId: null,
            nextCardId: null,
            expectedVersion: s.card.version,
            expectedBoardVersion: 1,
          }),
        }),
      () =>
        app.request(`/api/v1/comments/${s.comment.id}`, {
          method: 'PATCH',
          headers: as(manager.session),
          body: JSON.stringify({ body: `patched ${i}`, expectedVersion: s.comment.version }),
        })
    );
    s1Results.push(r.statuses);
  }

  console.log('Running Scenario 2: move then comment DELETE (10 rounds)...');
  const s2Results: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const s = await setupBoardAndCard();
    const r = await forced(
      s.boardId,
      () =>
        app.request(`/api/v1/cards/${s.card.id}/move`, {
          method: 'POST',
          headers: as(manager.session),
          body: JSON.stringify({
            toColumnId: s.cols[1],
            previousCardId: null,
            nextCardId: null,
            expectedVersion: s.card.version,
            expectedBoardVersion: 1,
          }),
        }),
      () =>
        app.request(`/api/v1/comments/${s.comment.id}`, {
          method: 'DELETE',
          headers: as(manager.session),
          body: JSON.stringify({ expectedVersion: s.comment.version }),
        })
    );
    s2Results.push(r.statuses);
  }

  const deadlocksAfter = await deadlockCount();
  const deadlockDelta = deadlocksAfter - deadlocksBefore;
  console.log(`Results: Deadlock delta = ${deadlockDelta}`);
  console.log(`Scenario 1 (Move + Comment PATCH) statuses:`, JSON.stringify(s1Results));
  console.log(`Scenario 2 (Move + Comment DELETE) statuses:`, JSON.stringify(s2Results));

  if (deadlockDelta > 0) {
    console.error(`FAILED: ${deadlockDelta} deadlocks detected!`);
    process.exit(1);
  } else {
    console.log('PASSED: Zero deadlocks detected across all forced interleavings.');
  }
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
