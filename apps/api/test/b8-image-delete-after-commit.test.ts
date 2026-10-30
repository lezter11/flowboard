import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { MemoryStorageDriver, runWithStorageDriver, type StorageDriver } from '../src/adapters/storage.ts';
import { processPendingStorageDeletions } from '../src/services/trash-purge.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-8: image bytes are deleted only after the delete commits. A failed commit keeps the bytes; a
// failed storage delete leaves a retryable pending_storage_deletions row.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);

async function fixture() {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Owner', pool);
  const manager = await createDevUserAndSession(`manager.${s}@flowboard.example`, 'Manager', pool);
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  const board = `b_${s}`;
  const column = `c_${s}`;
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
    `INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'Task','none',1000,'active',1,now(),now())`,
    [card, ws, project, board, column],
  );
  await pool.query(
    `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'manager','active',1,now(),now())`,
    [`pm_${s}`, project, ws, manager.user.id],
  );
  await pool.query(
    `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`,
    [board, project, ws, manager.user.id, owner.user.id],
  );
  return { cookie: `flowboard_session=${manager.session.id}`, card, project, ws, owner: owner.user.id, manager: manager.user.id, s };
}

async function addImage(fx: Awaited<ReturnType<typeof fixture>>, imageId: string, storage: MemoryStorageDriver) {
  const key = `images/${fx.project}/${fx.card}/${imageId}/a.png`;
  await storage.put(key, new Uint8Array([1, 2, 3]), 'image/png');
  await pool.query(
    `INSERT INTO card_images (id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,storage_key,sha256,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'a.png',3,'image/png',$6,'abc',1,now(),now())`,
    [imageId, fx.ws, fx.project, fx.card, fx.manager, key],
  );
  return key;
}

function remove(app: ReturnType<typeof createApp>, fx: Awaited<ReturnType<typeof fixture>>, imageId: string) {
  return app.request(`http://localhost/api/v1/images/${imageId}`, {
    method: 'DELETE',
    headers: {
      cookie: fx.cookie,
      origin: 'http://localhost',
      'idempotency-key': `b8-del-${crypto.randomUUID()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expectedVersion: 1 }),
  });
}

async function pendingRow(key: string) {
  const res = await pool.query('SELECT attempts FROM pending_storage_deletions WHERE storage_key = $1', [key]);
  return res.rowCount ?? 0;
}

test('B-8 image delete: a failed commit keeps the row and the bytes', async () => {
  const fx = await fixture();
  const storage = new MemoryStorageDriver();
  const app = createApp(async () => {}, { pool, storage });
  const imageId = `b8fail_${fx.s}`;
  const key = await addImage(fx, imageId, storage);

  // A deferred trigger raises at COMMIT for this one row, so the delete's commit fails for real.
  await pool.query(`CREATE OR REPLACE FUNCTION b8_fail_commit() RETURNS trigger AS $$
    BEGIN
      IF OLD.id LIKE 'b8fail_%' THEN RAISE EXCEPTION 'b8 forced commit failure'; END IF;
      RETURN OLD;
    END $$ LANGUAGE plpgsql`);
  await pool.query(`CREATE CONSTRAINT TRIGGER b8_fail_commit_trg AFTER DELETE ON card_images
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION b8_fail_commit()`);
  try {
    const res = await remove(app, fx, imageId);
    assert.ok(res.status >= 500, `the failed commit is an error, got ${res.status}`);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS b8_fail_commit_trg ON card_images');
    await pool.query('DROP FUNCTION IF EXISTS b8_fail_commit()');
  }

  const row = await pool.query('SELECT 1 FROM card_images WHERE id = $1', [imageId]);
  assert.equal(row.rowCount, 1, 'the image row survives the failed commit');
  assert.ok(storage.size() >= 1, 'the bytes survive the failed commit');
  assert.equal(await storage.get(key) !== null, true);
  assert.equal(await pendingRow(key), 0, 'no pending deletion was kept for a rolled-back delete');
});

test('B-8 image delete: a storage failure after commit leaves a retryable pending row', async () => {
  const fx = await fixture();
  const working = new MemoryStorageDriver();
  const failing: StorageDriver = {
    put: (k, d, c) => working.put(k, d, c),
    get: (k) => working.get(k),
    delete: async () => {
      throw new Error('storage unavailable');
    },
  };
  const imageId = `b8store_${fx.s}`;
  const key = await addImage(fx, imageId, working);

  const failingApp = createApp(async () => {}, { pool, storage: failing });
  const res = await remove(failingApp, fx, imageId);
  assert.equal(res.status, 200, 'the image is deleted; the storage failure is not the caller\'s error');

  assert.equal((await pool.query('SELECT 1 FROM card_images WHERE id = $1', [imageId])).rowCount, 0);
  assert.equal(await working.get(key) !== null, true, 'the bytes are still there after the failed delete');
  assert.equal(await pendingRow(key), 1, 'a retryable pending row exists');

  // The purge job retries with a working driver: the bytes go and the pending row is cleared.
  await runWithStorageDriver(working, () => processPendingStorageDeletions(pool));
  assert.equal(await working.get(key), null, 'the retry removed the bytes');
  assert.equal(await pendingRow(key), 0, 'the pending row is cleared after a successful retry');
});

test('B-8 image delete: a successful delete removes the bytes at once and leaves no pending row', async () => {
  const fx = await fixture();
  const storage = new MemoryStorageDriver();
  const app = createApp(async () => {}, { pool, storage });
  const imageId = `b8ok_${fx.s}`;
  const key = await addImage(fx, imageId, storage);
  const res = await remove(app, fx, imageId);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(await storage.get(key), null);
  assert.equal(await pendingRow(key), 0);
});
