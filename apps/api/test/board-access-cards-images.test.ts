import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { setGlobalPool } from '../src/adapters/postgres.ts';
import { MemoryStorageDriver, setStorageDriver } from '../src/adapters/storage.ts';
import { searchProjectCards } from '../src/adapters/cards.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];

test('mounted card discovery and image routes require a current board grant', {
  skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.',
}, async () => {
  const url = new URL(testUrl!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/flowboard_access_test') {
    throw new Error('Use only the disposable local board-access database.');
  }
  const schema = `card_image_access_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 2 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 8, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('card-owner@test.invalid', 'Owner', pool);
    const manager = await createDevUserAndSession('card-manager@test.invalid', 'Manager', pool);
    const viewer = await createDevUserAndSession('card-viewer@test.invalid', 'Viewer', pool);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at)
      VALUES ('w','Workspace','UTC',$1,NOW(),NOW())`, [owner.user.id]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at)
      VALUES ('p','w','Project',NOW(),NOW())`);
    await pool.query(`INSERT INTO project_memberships
      (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
      VALUES ('m1','p','w',$1,'manager','active',NOW(),NOW()),
             ('m2','p','w',$2,'viewer','active',NOW(),NOW())`, [manager.user.id, viewer.user.id]);
    await pool.query(`INSERT INTO boards
      (id,workspace_id,project_id,name,structure_version,snapshot_version,archived,created_at,updated_at)
      VALUES ('b1','w','p','Granted',1,1,FALSE,NOW(),NOW()),
             ('b2','w','p','Hidden',1,1,FALSE,NOW(),NOW())`);
    await pool.query(`INSERT INTO columns
      (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
      VALUES ('col1','w','p','b1','To Do','blue','todo',0,1,NOW(),NOW()),
             ('col2','w','p','b2','Private','red','todo',0,1,NOW(),NOW())`);
    await pool.query(`INSERT INTO cards
      (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)
      VALUES ('card1','w','p','b1','col1','Visible task','medium',100,'active',NOW(),NOW()),
             ('card2','w','p','b2','col2','Hidden task','high',100,'active',NOW(),NOW())`);
    await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
      VALUES ('b1','p','w',$1,$2)`, [manager.user.id, owner.user.id]);
    await pool.query(`INSERT INTO card_assignees (card_id,user_id,workspace_id,project_id,created_at)
      VALUES ('card1',$1,'w','p',NOW()),('card2',$1,'w','p',NOW())`, [manager.user.id]);
    const bytes = new Uint8Array([1, 2, 3]);
    const storage = new MemoryStorageDriver();
    setStorageDriver(storage);
    await storage.put('synthetic/hidden', bytes, 'image/png');
    await storage.put('synthetic/visible', bytes, 'image/png');
    await pool.query(`INSERT INTO card_images
      (id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,storage_key,sha256,version,created_at,updated_at)
      VALUES ('img1','w','p','card1',$1,'a.png',3,'image/png','synthetic/visible','abc',1,NOW(),NOW()),
             ('img2','w','p','card2',$1,'b.png',3,'image/png','synthetic/hidden','abc',1,NOW(),NOW())`, [owner.user.id]);
    const app = createApp(async () => {}, { pool });
    setGlobalPool(pool);
    await searchProjectCards(pool, 'p', {}, manager.user.id);
    const req = (path: string, session: string) => app.request(`http://localhost/api/v1${path}`, {
      headers: { cookie: `flowboard_session=${session}` },
    });
    const mutation = (method: string, path: string, session: string, body?: unknown) =>
      app.request(`http://localhost/api/v1${path}`, {
        method,
        headers: {
          cookie: `flowboard_session=${session}`,
          'Idempotency-Key': `board-access-${crypto.randomUUID()}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    const search = await req('/projects/p/cards/search', manager.session.id);
    assert.equal(search.status, 200, await search.clone().text());
    const searchBody = await search.json() as any;
    assert.deepEqual(searchBody.data.map((card: any) => card.id), ['card1']);
    assert.equal(searchBody.activeCardCount, 1);
    assert.equal(searchBody.matchingCardCount, 1);
    const ownerSearch = await req('/projects/p/cards/search', owner.session.id);
    assert.equal((await ownerSearch.json() as any).activeCardCount, 2);
    const ownerFirstPage = await req('/projects/p/cards/search?limit=1', owner.session.id);
    const ownerFirst = await ownerFirstPage.json() as any;
    assert.equal(ownerFirst.data.length, 1);
    assert.equal(typeof ownerFirst.nextCursor, 'string');
    const ownerSecondPage = await req(`/projects/p/cards/search?limit=1&cursor=${encodeURIComponent(ownerFirst.nextCursor)}`, owner.session.id);
    const ownerSecond = await ownerSecondPage.json() as any;
    assert.equal(ownerSecond.data.length, 1);
    assert.notEqual(ownerSecond.data[0].id, ownerFirst.data[0].id);
    assert.equal(ownerSecond.nextCursor, null);
    assert.equal((await req(`/projects/p/cards/search?limit=1&cursor=${encodeURIComponent(ownerFirst.nextCursor)}`, manager.session.id)).status, 409);
    assert.equal((await req('/me/tasks', manager.session.id)).status, 400);
    const tasks = await req('/me/tasks?projectId=p', manager.session.id);
    assert.deepEqual((await tasks.json() as any).data.map((card: any) => card.id), ['card1']);
    assert.equal((await req('/cards/card2', manager.session.id)).status, 404);
    assert.equal((await req('/images/img2/content', manager.session.id)).status, 404);
    assert.equal((await req('/images/img2/thumbnail', manager.session.id)).status, 404);
    assert.equal((await req('/images/img1/content', manager.session.id)).status, 200);
    assert.equal((await req('/cards/card1/images', manager.session.id)).status, 200);
    assert.equal((await req('/cards/card1/images', viewer.session.id)).status, 404);

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4, 'ascii');
    ihdr.writeUInt32BE(1, 8);
    ihdr.writeUInt32BE(1, 12);
    ihdr[16] = 8;
    ihdr[17] = 2;
    const png = Buffer.concat([pngHeader, ihdr, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
    const stageBody = {
      filename: 'synthetic.png', byteLength: png.byteLength, contentType: 'image/png',
      sha256: crypto.createHash('sha256').update(png).digest('hex'),
    };
    assert.equal((await mutation('POST', '/cards/card2/image-uploads', manager.session.id, stageBody)).status, 404);
    const stage = await mutation('POST', '/cards/card1/image-uploads', manager.session.id, stageBody);
    assert.equal(stage.status, 201, await stage.clone().text());
    const uploadId = (await stage.json() as any).data.id as string;
    assert.equal((await req(`/image-uploads/${uploadId}`, manager.session.id)).status, 200);
    const content = await app.request(`http://localhost/api/v1/image-uploads/${uploadId}/content`, {
      method: 'PUT', headers: { cookie: `flowboard_session=${manager.session.id}`, 'content-type': 'image/png' },
      body: png,
    });
    assert.equal(content.status, 200, await content.clone().text());
    const finalize = await mutation('POST', `/image-uploads/${uploadId}/finalize`, manager.session.id);
    assert.equal(finalize.status, 200, await finalize.clone().text());
    const finalizedId = (await finalize.json() as any).data.id as string;
    assert.equal((await req(`/images/${finalizedId}/content`, manager.session.id)).status, 200);
    assert.equal((await mutation('DELETE', '/images/img2', manager.session.id, { expectedVersion: 1 })).status, 404);
    const secondStage = await mutation('POST', '/cards/card1/image-uploads', manager.session.id, stageBody);
    assert.equal(secondStage.status, 201);
    const pendingId = (await secondStage.json() as any).data.id as string;
    assert.equal((await mutation('DELETE', `/image-uploads/${pendingId}`, manager.session.id)).status, 200);
    const deleteFinalized = await mutation('DELETE', `/images/${finalizedId}`, manager.session.id, { expectedVersion: 1 });
    assert.equal(deleteFinalized.status, 200, await deleteFinalized.clone().text());

    await pool.query('DELETE FROM board_grants WHERE board_id = $1 AND user_id = $2', ['b1', manager.user.id]);
    assert.equal((await req('/images/img1/content', manager.session.id)).status, 404);
    assert.equal((await req('/cards/card1', manager.session.id)).status, 404);
    assert.deepEqual((await (await req('/me/tasks?projectId=p', manager.session.id)).json() as any).data, []);
    assert.equal((await req(`/image-uploads/${uploadId}`, manager.session.id)).status, 404);
    assert.equal((await mutation('POST', `/image-uploads/${uploadId}/finalize`, manager.session.id)).status, 404);
    assert.equal((await mutation('DELETE', `/image-uploads/${uploadId}`, manager.session.id)).status, 404);
    assert.equal((await mutation('PUT', `/image-uploads/${uploadId}/content`, manager.session.id)).status, 404);
  } finally {
    setGlobalPool(null);
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
