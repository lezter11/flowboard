import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {lifecycleFixture} from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import {createApp} from '../../../../apps/api/src/http/app.ts';
import {MemoryStorageDriver,runWithStorageDriver} from '../../../../apps/api/src/adapters/storage.ts';
import {SharpImageVerifier} from '../../../../apps/api/src/services/image-verifier-node.ts';
import {imageFixture} from '../../../../apps/api/test/support/image-fixtures.ts';
import {purgeExpiredTrash,processPendingStorageDeletions} from '../../../../apps/api/src/services/trash-purge.ts';
async function setup(t:any){const f=await lifecycleFixture(t),storage=new MemoryStorageDriver();const app=createApp(async()=>{},{pool:f.pool,storage,imageVerifier:new SharpImageVerifier(),rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
 const headers=(actor='owner')=>({cookie:`flowboard_session=${f.actors[actor]!.session.id}`,origin:'http://localhost','content-type':'application/json','idempotency-key':crypto.randomUUID()});
 const call=(method:string,path:string,actor='owner',body?:object,key?:string)=>app.request('http://localhost/api/v1'+path,{method,headers:{...headers(actor),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const png=imageFixture('png');const stage=async(actor='owner')=>{const r=await call('POST','/cards/card/image-uploads',actor,{filename:'private-synthetic.png',byteLength:png.bytes.length,contentType:png.contentType,sha256:crypto.createHash('sha256').update(png.bytes).digest('hex')});assert.equal(r.status,201,await r.clone().text());return((await r.json())as any).data};
 const upload=async(id:string,actor='owner')=>app.request('http://localhost/api/v1/image-uploads/'+id+'/content',{method:'PUT',headers:headers(actor),body:new Uint8Array(png.bytes).buffer});
 const save=async(actor='owner')=>{const u=await stage(actor);assert.equal((await upload(u.id,actor)).status,200);const r=await call('POST',`/image-uploads/${u.id}/finalize`,actor);assert.equal(r.status,200);return {upload:u,image:((await r.json())as any).data}};
 return{...f,storage,app,headers,call,png,stage,upload,save};}

test('independent authority: private image fetch, uploader authority, sibling/revoked/session boundaries',async t=>{
 const f=await setup(t),saved=await f.save('member');
 for(const actor of ['owner','manager','member','viewer']){const r=await f.call('GET',`/images/${saved.image.id}/content`,actor);assert.equal(r.status,200);assert.match(r.headers.get('cache-control')!,/private.*no-store/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await r.arrayBuffer()),f.png.bytes)}
 assert.equal((await f.call('GET',`/images/${saved.image.id}/content`,'outsider')).status,404);
 const noSession=await f.app.request('http://localhost/api/v1/images/'+saved.image.id+'/content');assert.equal(noSession.status,401);
 assert.equal((await f.call('POST','/cards/card/image-uploads','viewer',{filename:'x.png',byteLength:1,contentType:'image/png',sha256:'a'.repeat(64)})).status,403);
 const other=await f.stage('owner');assert.equal((await f.upload(other.id,'member')).status,403);assert.equal((await f.upload(other.id,'manager')).status,200);
 await f.pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at)VALUES('sibling','ws','Sibling',NOW(),NOW())");
 await f.pool.query("INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES('sibling-membership','sibling','ws',$1,'manager','active',NOW(),NOW())",[f.actors.outsider!.user.id]);
 assert.equal((await f.call('GET',`/images/${saved.image.id}/content`,'outsider')).status,404);
 await f.pool.query("DELETE FROM board_grants WHERE user_id=$1 AND board_id='brd'",[f.actors.member!.user.id]);assert.equal((await f.call('GET',`/images/${saved.image.id}/content`,'member')).status,404);
 await f.pool.query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",[f.actors.viewer!.user.id]);assert.equal((await f.call('GET',`/images/${saved.image.id}/content`,'viewer')).status,401);
});

test('independent quota: parallel stage count stops at10 and refusal preserves saved fields',async t=>{
 const f=await setup(t);const input={filename:'bounded.png',byteLength:f.png.bytes.length,contentType:f.png.contentType,sha256:crypto.createHash('sha256').update(f.png.bytes).digest('hex')};
 const responses=await Promise.all(Array.from({length:11},()=>f.call('POST','/cards/card/image-uploads','member',input)));assert.deepEqual(responses.map(r=>r.status).sort((a,b)=>a-b),[...Array(10).fill(201),422]);
 assert.equal(Number((await f.pool.query('SELECT count(*) FROM card_image_uploads')).rows[0].count),10);assert.equal((await f.pool.query("SELECT title FROM cards WHERE id='card'")).rows[0].title,'Discussion');assert.equal(f.storage.size(),0);
});

test('independent trash/restore: preserved image/comment identity and cutoff, role gates, no in-trash writes',async t=>{
 const f=await setup(t),saved=await f.save('member'),pending=await f.stage('member'),comment=await f.post('Private restoration body');
 const deleteInput={expectedVersion:1,expectedBoardVersion:await f.version()};for(const actor of ['member','viewer'])assert.equal((await f.call('POST','/cards/card/delete',actor,deleteInput)).status,403);assert.equal((await f.call('POST','/cards/card/delete','outsider',deleteInput)).status,404);
 const deletion=await f.call('POST','/cards/card/delete','manager',deleteInput);assert.equal(deletion.status,200);const deleted=((await deletion.json())as any).data;assert.equal(Date.parse(deleted.restoreUntil)-Date.parse(deleted.deletedAt),86400000);
 for(const actor of ['member','viewer']){assert.equal((await f.call('GET','/projects/prj/trash',actor)).status,403);assert.equal((await f.call('GET',`/images/${saved.image.id}/content`,actor)).status,404)}
 assert.equal((await f.call('GET',`/images/${saved.image.id}/content`,'manager')).status,200);
 const mutations=[f.call('PATCH','/cards/card','member',{title:'Forbidden edit',expectedVersion:deleted.version}),f.call('POST','/cards/card/comments','member',{body:'Forbidden comment',mentions:[]}),f.call('POST','/cards/card/move','member',{toColumnId:'col',previousCardId:null,nextCardId:null,expectedVersion:deleted.version,expectedBoardVersion:await f.version()}),f.call('POST','/cards/card/image-uploads','member',{filename:'new.png',byteLength:1,contentType:'image/png',sha256:'a'.repeat(64)}),f.upload(pending.id,'member')];
 for(const [index,r] of (await Promise.all(mutations)).entries()){const observed=await r.clone().json();t.diagnostic(JSON.stringify({index,status:r.status,response:observed}));assert.equal(r.status,[404,400,404,409,409][index]);if(index===1)assert.equal(observed.error.code,'CARD_IS_TRASHED');}assert.equal(f.storage.size(),1);assert.equal((await f.pool.query("SELECT title FROM cards WHERE id='card'")).rows[0].title,'Discussion');
 const key=crypto.randomUUID(),restoreInput={expectedVersion:deleted.version,expectedBoardVersion:await f.version()},restore=await f.call('POST','/cards/card/restore','manager',restoreInput,key);assert.equal(restore.status,200);const restored=((await restore.json())as any).data;assert.equal(restored.id,'card');assert.equal(restored.restoreUntil,null);assert.equal((await f.pool.query('SELECT body FROM comments WHERE id=$1',[comment.id])).rows[0].body.includes('Private restoration body'),true);assert.equal((await f.pool.query('SELECT id FROM card_images')).rows[0].id,saved.image.id);assert.equal((await f.call('POST','/cards/card/restore','manager',{expectedVersion:deleted.version,expectedBoardVersion:deleteInput.expectedBoardVersion},key)).status,409,'changed original body is a conflict');
 const replay=await f.call('POST','/cards/card/restore','manager',restoreInput,key);assert.equal(replay.status,200);assert.equal(((await replay.json())as any).replayed,true);
 const bytes=await f.call('GET',`/images/${saved.image.id}/content`,'member');assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),f.png.bytes);
});

test('independent exact cutoff and purge: at cutoff410, retryable private cleanup, minimal receipts/events',async t=>{
 const f=await setup(t),saved=await f.save(),comment=await f.post('Unique private purge body');const r=await f.call('POST','/cards/card/delete','owner',{expectedVersion:1,expectedBoardVersion:await f.version()});assert.equal(r.status,200);const deleted=((await r.json())as any).data;
 const cutoff=Date.now();await f.pool.query("UPDATE cards SET restore_until=$1 WHERE id='card'",[new Date(cutoff)]);t.mock.timers.enable({apis:['Date'],now:cutoff});const refused=await f.call('POST','/cards/card/restore','owner',{expectedVersion:deleted.version,expectedBoardVersion:await f.version()});assert.equal(refused.status,410);assert.equal(((await refused.json())as any).error.code,'RESTORE_WINDOW_EXPIRED');t.mock.timers.reset();
 const remove=f.storage.delete.bind(f.storage);let fail=true;f.storage.delete=async key=>{if(fail)throw new Error('Synthetic private storage unavailable');await remove(key)};
 const purged=await runWithStorageDriver(f.storage,()=>purgeExpiredTrash(f.pool));assert.deepEqual(purged.purgedCardIds,['card']);assert.equal(f.storage.size(),1);assert.equal(Number((await f.pool.query('SELECT count(*) FROM pending_storage_deletions')).rows[0].count)>0,true);assert.equal((await f.pool.query('SELECT body FROM comments WHERE id=$1',[comment.id])).rows[0].body,'');
 const copies=JSON.stringify((await f.pool.query('SELECT response_body FROM idempotency_receipts')).rows)+JSON.stringify((await f.pool.query('SELECT safe_changes FROM activity_log')).rows)+JSON.stringify((await f.pool.query('SELECT payload FROM outbox')).rows);assert.equal(copies.includes('Unique private purge body'),false);assert.equal(copies.includes('Private restoration body'),false);assert.equal((await f.pool.query('SELECT count(*) FROM card_images')).rows[0].count,'0');
 fail=false;await f.pool.query('UPDATE pending_storage_deletions SET next_retry_at=NOW()');await runWithStorageDriver(f.storage,()=>processPendingStorageDeletions(f.pool));assert.equal(f.storage.size(),0);assert.equal((await f.pool.query('SELECT count(*) FROM pending_storage_deletions')).rows[0].count,'0');assert.equal((await f.call('GET',`/images/${saved.image.id}/content`)).status,404);
});

test('independent strict cutoff: one millisecond before server deadline restores same card',async t=>{const f=await setup(t);const r=await f.call('POST','/cards/card/delete','owner',{expectedVersion:1,expectedBoardVersion:await f.version()});assert.equal(r.status,200);const deleted=((await r.json())as any).data,cutoff=Date.now()+1000;await f.pool.query("UPDATE cards SET restore_until=$1 WHERE id='card'",[new Date(cutoff)]);t.mock.timers.enable({apis:['Date'],now:cutoff-1});const restored=await f.call('POST','/cards/card/restore','owner',{expectedVersion:deleted.version,expectedBoardVersion:await f.version()});assert.equal(restored.status,200);assert.equal(((await restored.json())as any).data.id,'card');t.mock.timers.reset()});
