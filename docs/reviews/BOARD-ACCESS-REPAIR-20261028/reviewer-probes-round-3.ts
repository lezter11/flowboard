import assert from 'node:assert/strict';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { setGlobalPool } from '../../../apps/api/src/adapters/postgres.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL']!;
const url = new URL(testUrl);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55479');
assert.equal(url.pathname, '/flowboard_access_test');
const schema = `review3_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({connectionString:testUrl,max:2});
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({connectionString:testUrl,max:8,options:`-c search_path=${schema}`});
let blocker: pg.PoolClient | undefined;
try {
  await runMigrations(pool);
  const owner = await createDevUserAndSession('review-owner@test.invalid','Owner',pool);
  const nextOwner = await createDevUserAndSession('review-next-owner@test.invalid','Next Owner',pool);
  const manager = await createDevUserAndSession('review-manager@test.invalid','Manager',pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','Review','UTC',$1,NOW(),NOW())`,[owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','Review Project',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('pm','p','w',$1,'manager','active',NOW(),NOW())`,[manager.user.id]);
  await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ('b','w','p','Private Board Name',NOW(),NOW())`);
  await pool.query(`INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)
    VALUES ('col','w','p','b','To Do','blue','todo',0,NOW(),NOW())`);
  await pool.query(`INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,deleted_at,deleted_by,restore_until,created_at,updated_at)
    VALUES ('card','w','p','b','col','Trashed private card','medium',100,'trashed',NOW(),$1,NOW()+INTERVAL '24 hours',NOW(),NOW())`,[owner.user.id]);
  await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
    VALUES ('b','p','w',$1,$2)`,[manager.user.id,owner.user.id]);
  await pool.query(`INSERT INTO card_images (id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,storage_key,sha256,created_at,updated_at)
    VALUES ('img','w','p','card',$1,'private-trash-image.png',3,'image/png','review/image','abc',NOW(),NOW())`,[owner.user.id]);
  const app = createApp(async()=>{}, {pool,deadlineMs:30000});
  const req = (method:string,path:string,session:string,body?:unknown)=> app.request(`http://localhost/api/v1${path}`,{
    method,headers:{cookie:`flowboard_session=${session}`,'Content-Type':'application/json','Idempotency-Key':`review3-${crypto.randomUUID()}`},
    ...(body ? {body:JSON.stringify(body)} : {})
  });
  async function waitForBlocked(fragment:string) {
    for(let i=0;i<200;i++) {
      const rows=await pool.query(`SELECT pid FROM pg_stat_activity WHERE state='active' AND query LIKE $1 AND cardinality(pg_blocking_pids(pid))>0`,[`%${fragment}%`]);
      if(rows.rowCount) return;
      await new Promise(r=>setTimeout(r,10));
    }
    throw new Error(`Reader did not reach blocked ${fragment}`);
  }

  // No mocked database: a real relation lock pauses the mounted image list after
  // its Manager check, while a second mounted request commits a role demotion.
  blocker=await pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE card_images IN ACCESS EXCLUSIVE MODE');
  const imagesPending=req('GET','/cards/card/images',manager.session.id);
  await waitForBlocked('SELECT * FROM card_images');
  const version=(await pool.query(`SELECT version FROM project_memberships WHERE id='pm'`)).rows[0].version;
  const demote=await req('PATCH',`/projects/p/members/${manager.user.id}`,owner.session.id,{role:'member',status:'active',expectedVersion:version});
  assert.equal(demote.status,200,await demote.text());
  assert.equal((await pool.query(`SELECT role FROM project_memberships WHERE id='pm'`)).rows[0].role,'member');
  await blocker.query('COMMIT');
  blocker.release();blocker=undefined;
  const imagesResponse=await imagesPending;
  const imagesBody=await imagesResponse.text();
  console.log(JSON.stringify({probe:'trashed-image-list-after-committed-manager-demotion',status:imagesResponse.status,body:imagesBody}));
  assert.equal(imagesResponse.status,200);
  assert.ok(imagesBody.includes('private-trash-image.png'));
  const imagesNext=await req('GET','/cards/card/images',manager.session.id);
  console.log(JSON.stringify({probe:'fresh-image-list-after-demotion',status:imagesNext.status}));
  assert.equal(imagesNext.status,404);

  // A real relation lock pauses the board-list data query after resolveProjectRole.
  // Ownership transfer commits before the board list reads/returns private data.
  blocker=await pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE boards IN ACCESS EXCLUSIVE MODE');
  const boardsPending=req('GET','/projects/p/boards',owner.session.id);
  await waitForBlocked('FROM boards');
  const wsVersion=(await pool.query(`SELECT version FROM workspaces WHERE id='w'`)).rows[0].version;
  const transfer=await req('POST','/workspaces/w/transfer-ownership',owner.session.id,{targetUserId:nextOwner.user.id,expectedVersion:wsVersion});
  assert.equal(transfer.status,200,await transfer.text());
  assert.equal((await pool.query(`SELECT owner_id FROM workspaces WHERE id='w'`)).rows[0].owner_id,nextOwner.user.id);
  await blocker.query('COMMIT');
  blocker.release();blocker=undefined;
  const boardsResponse=await boardsPending;
  const boardsBody=await boardsResponse.text();
  console.log(JSON.stringify({probe:'board-list-after-committed-ownership-transfer',status:boardsResponse.status,body:boardsBody}));
  assert.equal(boardsResponse.status,200);
  assert.ok(boardsBody.includes('Private Board Name'));
  const boardsNext=await req('GET','/projects/p/boards',owner.session.id);
  console.log(JSON.stringify({probe:'fresh-board-list-after-transfer',status:boardsNext.status}));
  assert.equal(boardsNext.status,404);
  console.log('Both authorization races reproduced against mounted handlers and real separate PostgreSQL connections.');
} finally {
  if(blocker) {await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
  setGlobalPool(null);
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
