import assert from 'node:assert/strict';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { MemoryStorageDriver, setStorageDriver } from '../../../apps/api/src/adapters/storage.ts';
import { setGlobalPool } from '../../../apps/api/src/adapters/postgres.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL']!;
const url = new URL(testUrl);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55479');
assert.equal(url.pathname, '/flowboard_access_test');
const schema = `review4_${crypto.randomUUID().replaceAll('-', '')}`;
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
    method,headers:{cookie:`flowboard_session=${session}`,'Content-Type':'application/json','Idempotency-Key':`review4-${crypto.randomUUID()}`},
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

  // Delay only real in-memory object delivery; no SQL results, roles, or handler
  // decisions are replaced. This represents ordinary storage latency.
  const storage = new MemoryStorageDriver();
  const privateBytes = new TextEncoder().encode('synthetic-private-trashed-image');
  await storage.put('review/image', privateBytes, 'image/png');
  setStorageDriver(storage);
  const originalGet = storage.get.bind(storage);
  for (const suffix of ['content','thumbnail']) {
    await pool.query("UPDATE project_memberships SET role='manager' WHERE id='pm'");
    let releaseRead!: () => void;
    let enteredStorage!: () => void;
    const storageEntered = new Promise<void>(r => {enteredStorage = r});
    const storageReleased = new Promise<void>(r => {releaseRead = r});
    storage.get = async (key: string) => {
      const result = await originalGet(key);
      enteredStorage();
      await storageReleased;
      return result;
    };
    const pending = req('GET',`/images/img/${suffix}`,manager.session.id);
    await storageEntered;
    const version = (await pool.query("SELECT version FROM project_memberships WHERE id='pm'")).rows[0].version;
    const demote = await req('PATCH',`/projects/p/members/${manager.user.id}`,owner.session.id,{role:'member',status:'active',expectedVersion:version});
    assert.equal(demote.status,200,await demote.clone().text());
    assert.equal((await pool.query("SELECT role FROM project_memberships WHERE id='pm'")).rows[0].role,'member');
    console.log(JSON.stringify({probe:'committed-manager-demotion-during-storage-read',route:suffix,status:demote.status,role:'member'}));
    releaseRead();
    const response = await pending;
    const body = await response.text();
    console.log(JSON.stringify({probe:'trashed-image-delivery-after-demotion',route:suffix,status:response.status,body}));
    assert.equal(response.status,200);
    assert.equal(body,'synthetic-private-trashed-image');
    storage.get = originalGet;
    const next = await req('GET',`/images/img/${suffix}`,manager.session.id);
    console.log(JSON.stringify({probe:'fresh-request-after-demotion',route:suffix,status:next.status}));
    assert.equal(next.status,404);
  }
  console.log('Both mounted private binary routes delivered trashed image bytes after Manager demotion committed.');

} finally {
  if(blocker) {await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
  setStorageDriver(new MemoryStorageDriver());
  setGlobalPool(null);
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
