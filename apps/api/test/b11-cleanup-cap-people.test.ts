import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { cleanupOrphanUploads } from '../src/adapters/images.ts';
import { MemoryStorageDriver, runWithStorageDriver, type StorageDriver } from '../src/adapters/storage.ts';
import { processPendingStorageDeletions } from '../src/services/trash-purge.ts';
import { runIsolated } from '../src/runtime/worker.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-11: orphan upload cleanup (isolated scheduled job), the per-card image cap under concurrency,
// and the mention people lookup.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);

async function fixture(extra: { imageCount?: number } = {}) {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Owner', pool);
  const manager = await createDevUserAndSession(`manager.${s}@flowboard.example`, 'Manager', pool);
  const viewer = await createDevUserAndSession(`viewer.${s}@flowboard.example`, 'Viewer', pool);
  const noGrant = await createDevUserAndSession(`nogrant.${s}@flowboard.example`, 'NoGrant', pool);
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  const board = `b_${s}`;
  const col = `c_${s}`;
  const card = `card_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
  await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ($1,$2,$3,'B',now(),now())`, [board, ws, project]);
  await pool.query(`INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'To do','blue','todo',0,1,now(),now())`, [col, ws, project, board]);
  await pool.query(`INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,version,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'Task','none',1000,'active',1,now(),now())`, [card, ws, project, board, col]);
  const member = (label: string, uid: string, role: string) => pool.query(
    `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'active',1,now(),now())`, [`pm_${label}_${s}`, project, ws, uid, role]);
  await member('manager', manager.user.id, 'manager');
  await member('viewer', viewer.user.id, 'viewer');
  await member('nogrant', noGrant.user.id, 'member');
  await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5),($1,$2,$3,$6,$5)`,
    [board, project, ws, manager.user.id, owner.user.id, viewer.user.id]);
  for (let i = 0; i < (extra.imageCount ?? 0); i++) {
    await pool.query(
      `INSERT INTO card_images (id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,storage_key,sha256,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'a.png',3,'image/png',$6,'abc',1,now(),now())`,
      [`img_${s}_${i}`, ws, project, card, manager.user.id, `images/${project}/${card}/img_${s}_${i}/a.png`],
    );
  }
  return { s, ws, project, board, card, col, owner, manager, viewer, noGrant, cookie: (u: { session: { id: string } }) => `flowboard_session=${u.session.id}` };
}

async function stagedUploadWith(client: pg.PoolClient, fx: Awaited<ReturnType<typeof fixture>>) {
  const id = `upl_${crypto.randomUUID()}`;
  await client.query(
    `INSERT INTO card_image_uploads (id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,sha256,state,expires_at,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'inflight.png',3,'image/png','abc','awaiting_content',now() + interval '1 hour',1,now(),now())`,
    [id, fx.ws, fx.project, fx.card, fx.manager.user.id],
  );
  return id;
}

async function stagedUpload(fx: Awaited<ReturnType<typeof fixture>>, state: string, expiresSql: string, id = `upl_${crypto.randomUUID()}`) {
  await pool.query(
    `INSERT INTO card_image_uploads (id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,sha256,state,expires_at,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'s.png',3,'image/png','abc',$6,${expiresSql},1,now(),now())`,
    [id, fx.ws, fx.project, fx.card, fx.manager.user.id, state],
  );
  return id;
}

test('B-11 orphan uploads: expired staging bytes are removed once, and a failed delete is retried', async (t) => {
  const fx = await fixture();
  const expired = await stagedUpload(fx, 'awaiting_content', `now() - interval '1 hour'`);
  const live = await stagedUpload(fx, 'awaiting_content', `now() + interval '1 hour'`);
  const storage = new MemoryStorageDriver();
  await storage.put(`staging/${expired}/s.png`, new Uint8Array([1]), 'image/png');
  await storage.put(`staging/${live}/s.png`, new Uint8Array([2]), 'image/png');

  await t.test('the sweep removes the expired staged bytes and leaves a live upload alone', async () => {
    const res = await runWithStorageDriver(storage, () => cleanupOrphanUploads(pool));
    assert.ok(res.cleanedCount >= 1);
    assert.equal(await storage.get(`staging/${expired}/s.png`), null);
    assert.ok(await storage.get(`staging/${live}/s.png`), 'the live upload keeps its bytes');
    const row = await pool.query<{ state: string; staging_cleaned: boolean }>('SELECT state, staging_cleaned FROM card_image_uploads WHERE id = $1', [expired]);
    assert.equal(row.rows[0]!.state, 'expired');
    assert.equal(row.rows[0]!.staging_cleaned, true);
  });

  await t.test('a second sweep does not revisit a settled row', async () => {
    const again = await runWithStorageDriver(storage, () => cleanupOrphanUploads(pool));
    const mine = await pool.query('SELECT 1 FROM card_image_uploads WHERE id = $1 AND staging_cleaned = FALSE', [expired]);
    assert.equal(mine.rowCount, 0);
    assert.ok(again.cleanedCount >= 0);
  });

  await t.test('a failing delete stays queued and is retried by the pending-deletion job', async () => {
    const failing = await stagedUpload(fx, 'expired', `now() - interval '1 hour'`);
    const working = new MemoryStorageDriver();
    await working.put(`staging/${failing}/s.png`, new Uint8Array([3]), 'image/png');
    const broken: StorageDriver = { put: (k, d, c) => working.put(k, d, c), get: (k) => working.get(k), delete: async () => { throw new Error('down'); } };
    await runWithStorageDriver(broken, () => cleanupOrphanUploads(pool));
    const queued = await pool.query('SELECT 1 FROM pending_storage_deletions WHERE storage_key = $1', [`staging/${failing}/s.png`]);
    assert.equal(queued.rowCount, 1, 'the key is queued for retry');
    await runWithStorageDriver(working, () => processPendingStorageDeletions(pool));
    assert.equal(await working.get(`staging/${failing}/s.png`), null, 'the retry removed the bytes');
  });
});

test('B-11 scheduled jobs: one failing job does not stop the others, and the failure is still reported', async () => {
  const ran: string[] = [];
  await assert.rejects(runIsolated([
    { name: 'first', run: async () => { ran.push('first'); throw new Error('boom'); } },
    { name: 'second', run: async () => { ran.push('second'); } },
    { name: 'third', run: async () => { ran.push('third'); throw new Error('also'); } },
  ]), /boom/);
  assert.deepEqual(ran, ['first', 'second', 'third']);
});

test('B-11 image cap: staged uploads count, expired ones do not, and two concurrent stages cannot both pass', async (t) => {
  await t.test('nine images plus one live staged upload refuse a further stage', async () => {
    const fx = await fixture({ imageCount: 9 });
    await stagedUpload(fx, 'awaiting_content', `now() + interval '1 hour'`);
    const app = createApp(async () => {}, { pool, storage: new MemoryStorageDriver() });
    const res = await app.request(`http://localhost/api/v1/cards/${fx.card}/image-uploads`, {
      method: 'POST',
      headers: { cookie: fx.cookie(fx.manager), origin: 'http://localhost', 'idempotency-key': `cap-${crypto.randomUUID()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'x.png', byteLength: 3, contentType: 'image/png', sha256: 'a'.repeat(64) }),
    });
    assert.equal(res.status, 422);
    assert.equal(((await res.json()) as any).error.code, 'IMAGE_LIMIT_EXCEEDED');
  });

  await t.test('an expired staged upload does not count toward the cap', async () => {
    const fx = await fixture({ imageCount: 9 });
    await stagedUpload(fx, 'awaiting_content', `now() - interval '1 hour'`);
    const app = createApp(async () => {}, { pool, storage: new MemoryStorageDriver() });
    const res = await app.request(`http://localhost/api/v1/cards/${fx.card}/image-uploads`, {
      method: 'POST',
      headers: { cookie: fx.cookie(fx.manager), origin: 'http://localhost', 'idempotency-key': `cap-${crypto.randomUUID()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'x.png', byteLength: 3, contentType: 'image/png', sha256: 'a'.repeat(64) }),
    });
    assert.equal(res.status, 201, await res.clone().text());
  });

  await t.test('a stage waits for an in-flight stage on the same card, then counts its staged upload', async () => {
    const fx = await fixture({ imageCount: 9 });
    const app = createApp(async () => {}, { pool, storage: new MemoryStorageDriver() });
    // The in-flight stage: it holds the card row lock and has an uncommitted staged upload.
    const inFlight = await pool.connect();
    let inFlightId = '';
    try {
      await inFlight.query('BEGIN');
      await inFlight.query('SELECT id FROM cards WHERE id = $1 FOR UPDATE', [fx.card]);
      inFlightId = await stagedUploadWith(inFlight, fx);
      // The second stage starts while the lock is held.
      const second = app.request(`http://localhost/api/v1/cards/${fx.card}/image-uploads`, {
        method: 'POST',
        headers: { cookie: fx.cookie(fx.manager), origin: 'http://localhost', 'idempotency-key': `race-${crypto.randomUUID()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ filename: 'second.png', byteLength: 3, contentType: 'image/png', sha256: 'b'.repeat(64) }),
      });
      let settled = false;
      Promise.resolve(second).then(() => { settled = true; }, () => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(settled, false, 'the second stage waits for the card lock');
      await inFlight.query('COMMIT');
      const res = await second;
      assert.equal(res.status, 422, await res.clone().text());
      assert.equal(((await res.json()) as any).error.code, 'IMAGE_LIMIT_EXCEEDED');
    } finally {
      await inFlight.query('ROLLBACK').catch(() => {});
      inFlight.release();
    }
    assert.ok(inFlightId);
    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM card_image_uploads WHERE card_id = $1 AND expires_at > now() AND state = 'awaiting_content'`, [fx.card]);
    assert.equal(count.rows[0]!.n, '1', 'only the in-flight upload exists');
  });
});

test('B-11 mention people: only people who can read the card\'s board', async (t) => {
  const fx = await fixture();
  const app = createApp(async () => {}, { pool });
  const get = (query: string, who = fx.manager) => app.request(`http://localhost/api/v1/projects/${fx.project}/people?${query}`, {
    headers: { cookie: fx.cookie(who) },
  });
  const ids = async (query: string, who = fx.manager) => {
    const res = await get(query, who);
    assert.equal(res.status, 200, await res.clone().text());
    return ((await res.json()) as any).data.map((p: any) => p.id as string);
  };

  await t.test('by card: the viewer with a board grant and the manager are listed; the member without a grant is not', async () => {
    const list = await ids(`purpose=mention&cardId=${fx.card}`);
    assert.ok(list.includes(fx.viewer.user.id));
    assert.ok(list.includes(fx.manager.user.id));
    assert.ok(!list.includes(fx.noGrant.user.id));
  });

  await t.test('by board: the same answer', async () => {
    const byBoard = await ids(`purpose=mention&boardId=${fx.board}`);
    const byCard = await ids(`purpose=mention&cardId=${fx.card}`);
    assert.deepEqual(byBoard.sort(), byCard.sort());
  });

  await t.test('with neither card nor board, mention lists nobody (backward compatible, no leak)', async () => {
    assert.deepEqual(await ids('purpose=mention'), []);
  });

  await t.test('a member without the board grant cannot list mentionees for the card (404, no list)', async () => {
    const res = await get(`purpose=mention&cardId=${fx.card}`, fx.noGrant);
    assert.equal(res.status, 404);
  });

  await t.test('an unknown card and an unreadable card give the same 404', async () => {
    const missing = await get('purpose=mention&cardId=card_missing_xyz', fx.noGrant);
    const unreadable = await get(`purpose=mention&cardId=${fx.card}`, fx.noGrant);
    assert.equal(missing.status, 404);
    assert.equal(unreadable.status, 404);
    assert.equal(((await missing.json()) as any).error.message, ((await unreadable.json()) as any).error.message);
  });

  await t.test('the display purpose is unchanged: project members are still listed', async () => {
    const list = await ids('purpose=display');
    assert.ok(list.includes(fx.noGrant.user.id));
  });

  await t.test('no email field is returned to anyone', async () => {
    const res = await get(`purpose=mention&cardId=${fx.card}`, fx.viewer);
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(await res.json()).includes('@flowboard.example'));
  });
});
