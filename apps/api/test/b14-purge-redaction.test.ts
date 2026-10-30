import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { MemoryStorageDriver, setStorageDriver } from '../src/adapters/storage.ts';
import { purgeExpiredTrash } from '../src/services/trash-purge.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-14 (Codex C-02). The normal path is: comment with a mention, trash the card, purge it. This test
// proves the purge leaves no card title, description or comment text in notifications, activity or
// the outbox. It does not cover a hand-run DELETE FROM cards: operators must use purge (docs/API.md).
const url = localDatabaseUrl(process.env['DATABASE_URL']);

const TITLE = 'Quarterly Secret Title';
const DESCRIPTION = 'Private description text';
const COMMENT = 'Private comment words @Manager';

async function freshSchema() {
  const schema = `b14_purge_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

test('B-14: the trash-then-purge path leaves no card title, description or comment text in notifications, activity or the outbox', async () => {
  const db = await freshSchema();
  const { pool } = db;
  try {
    await runMigrations(pool);
    setStorageDriver(new MemoryStorageDriver());
    const app = createApp(async () => {}, { pool });

    const s = crypto.randomBytes(4).toString('hex');
    const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Owner', pool);
    const manager = await createDevUserAndSession(`manager.${s}@flowboard.example`, 'Manager', pool);
    const ws = `ws_${s}`;
    const project = `p_${s}`;
    const board = `b_${s}`;
    const column = `col_${s}`;
    const card = `card_${s}`;
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
    await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ($1,$2,$3,'B',now(),now())`, [board, ws, project]);
    await pool.query(
      `INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'To do','blue','todo',0,1,now(),now())`,
      [column, ws, project, board],
    );
    await pool.query(
      `INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,description,priority,position,state,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'medium',100,'active',1,now(),now())`,
      [card, ws, project, board, column, TITLE, DESCRIPTION],
    );
    // The card's creation activity carries the title, as the app writes it.
    await pool.query(
      `INSERT INTO activity_log (id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at)
       VALUES ($1, $2, $3, $4, $5, 'card_created', $6, now())`,
      [`act_${s}`, ws, project, card, owner.user.id, JSON.stringify({ title: TITLE, columnId: column })],
    );
    await pool.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'manager','active',now(),now())`,
      [`pm_${s}`, project, ws, manager.user.id],
    );
    await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`, [board, project, ws, manager.user.id, owner.user.id]);

    // 1. A mention. The comment writes a notification; the outbox drain writes the mention notification too.
    const mentionStart = COMMENT.indexOf('@Manager');
    const comment = await app.request(`http://localhost/api/v1/cards/${card}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), Cookie: `flowboard_session=${owner.session.id}` },
      body: JSON.stringify({ body: COMMENT, mentions: [{ userId: manager.user.id, start: mentionStart, end: COMMENT.length }] }),
    });
    assert.equal(comment.status, 201, await comment.clone().text());
    await processOutboxLease(pool, { batchSize: 50 });

    const beforePurge = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM notifications WHERE card_id = $1', [card]);
    assert.ok(Number(beforePurge.rows[0]!.n) >= 1, 'a mention notification exists before the purge');

    // 2. Trash, then purge once the restore window has passed.
    const trash = await app.request(`http://localhost/api/v1/cards/${card}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), Cookie: `flowboard_session=${owner.session.id}` },
      body: JSON.stringify({ expectedVersion: 1, expectedBoardVersion: 1 }),
    });
    assert.ok([200, 201].includes(trash.status), await trash.clone().text());
    const purge = await purgeExpiredTrash(pool, { asOfDate: new Date(Date.now() + 25 * 60 * 60 * 1000) });
    assert.ok(purge.purgedCardIds.includes(card), 'the trashed card was purged');
    await processOutboxLease(pool, { batchSize: 50 });

    // 3. Nothing private remains in any place a purged card's content could be copied to.
    const cardRow = await pool.query<{ state: string; title: string; description: string | null }>(
      'SELECT state, title, description FROM cards WHERE id = $1', [card],
    );
    assert.equal(cardRow.rows[0]!.state, 'purged');
    assert.equal(cardRow.rows[0]!.title, '[Purged card]');
    assert.equal(cardRow.rows[0]!.description, null);

    const notifications = await pool.query<{ title: string; body: string; link: string }>(
      'SELECT title, body, link FROM notifications WHERE card_id = $1', [card],
    );
    assert.ok(notifications.rows.length >= 1);
    for (const row of notifications.rows) {
      assert.equal(row.body, '[Card content purged]');
      assert.equal(row.link, '#');
      assert.equal(row.title, 'Notification');
    }

    const activity = await pool.query<{ safe_changes: unknown }>('SELECT safe_changes FROM activity_log WHERE card_id = $1', [card]);
    assert.ok(activity.rows.length >= 2, 'the creation and the purge tombstone are both recorded');
    for (const row of activity.rows) {
      const keys = Object.keys(row.safe_changes as object);
      assert.ok(keys.every((k) => k === 'cardId' || k === 'purged'), `only tombstone keys remain: ${keys.join(',')}`);
    }

    const outbox = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM outbox WHERE payload::text LIKE $1`, [`%${card}%`],
    );
    assert.ok(outbox.rows.length >= 1, 'the comment event is still in the outbox');

    const everything = JSON.stringify([
      ...notifications.rows,
      ...activity.rows.map((r) => r.safe_changes),
      ...outbox.rows.map((r) => r.payload),
      (await pool.query('SELECT body FROM comments WHERE card_id = $1', [card])).rows,
    ]);
    for (const secret of [TITLE, DESCRIPTION, 'Private comment words']) {
      assert.equal(everything.includes(secret), false, `no copy of "${secret}" remains`);
    }
  } finally {
    setStorageDriver(new MemoryStorageDriver());
    await db.close();
  }
});
