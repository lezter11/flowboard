import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type pg from 'pg';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { imageFixture } from './support/image-fixtures.ts';
import { createApp } from '../src/http/app.ts';
import { MemoryStorageDriver, runWithStorageDriver } from '../src/adapters/storage.ts';
import { SharpImageVerifier } from '../src/services/image-verifier-node.ts';
import { cleanupOrphanUploads } from '../src/adapters/images.ts';
import { processPendingStorageDeletions } from '../src/services/trash-purge.ts';
import { runMigrations } from '../src/adapters/migrations.ts';

async function setup(t: TestContext) {
  const f = await lifecycleFixture(t);
  const storage = new MemoryStorageDriver();
  const app = createApp(async () => {}, { pool:f.pool, storage, imageVerifier:new SharpImageVerifier(),
    rateLimiter:()=>({limit:async()=>({success:true})}),
    windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})}),
  });
  const headers = {cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/json'};
  const call = (method:string,path:string,body?:object,key=crypto.randomUUID())=>app.request('http://localhost/api/v1'+path,{method,headers:{...headers,'idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const png=imageFixture('png');
  const stage=await call('POST','/cards/card/image-uploads',{filename:'atomic.png',byteLength:png.bytes.length,contentType:png.contentType,sha256:crypto.createHash('sha256').update(png.bytes).digest('hex')});
  assert.equal(stage.status,201);const id=((await stage.json())as any).data.id as string;
  const put=await app.request('http://localhost/api/v1/image-uploads/'+id+'/content',{method:'PUT',headers,body:new Uint8Array(png.bytes).buffer});assert.equal(put.status,200);
  const key=(await f.pool.query('SELECT staging_storage_key FROM card_image_uploads WHERE id=$1',[id])).rows[0].staging_storage_key as string;
  const sweep=()=>runWithStorageDriver(storage,async()=>{await cleanupOrphanUploads(f.pool);await processPendingStorageDeletions(f.pool);});
  return {...f,storage,app,headers,call,png,id,key,sweep};
}

async function failingFinalize(f:Awaited<ReturnType<typeof setup>>,key=crypto.randomUUID()){
  await f.pool.query(`CREATE FUNCTION reject_image_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic image commit failure'; END $$ LANGUAGE plpgsql`);
  await f.pool.query(`CREATE CONSTRAINT TRIGGER reject_image_commit_trigger AFTER INSERT ON card_images DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_image_commit()`);
  const failed=await f.call('POST',`/image-uploads/${f.id}/finalize`,undefined,key);assert.equal(failed.status,500);
  await f.pool.query('DROP TRIGGER reject_image_commit_trigger ON card_images');
  return key;
}

test('Image promotion: commit failure preserves one known object and original command retry',async t=>{
  const f=await setup(t),key=await failingFinalize(f);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM card_images')).rows[0].n,0);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM pending_storage_deletions')).rows[0].n,0);
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].state,'content_received');
  assert.ok(await f.storage.get(f.key),'rollback must not delete the retry input');assert.equal(f.storage.size(),1);
  const retry=await f.call('POST',`/image-uploads/${f.id}/finalize`,undefined,key);assert.equal(retry.status,200,await retry.clone().text());
  const image=((await retry.json())as any).data;
  assert.equal((await f.pool.query('SELECT storage_key FROM card_images WHERE id=$1',[image.id])).rows[0].storage_key,f.key);
  assert.equal(f.storage.size(),1,'database promotion creates no second storage object');
  const bytes=await f.app.request('http://localhost/api/v1/images/'+image.id+'/content',{headers:f.headers});assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),f.png.bytes);
});

test('Image promotion: abandoned failed finalization expires without an untracked object',async t=>{
  const f=await setup(t);await failingFinalize(f);
  await f.pool.query("UPDATE card_image_uploads SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[f.id]);await f.sweep();
  assert.equal(f.storage.size(),0);assert.equal((await f.pool.query('SELECT count(*)::int n FROM pending_storage_deletions')).rows[0].n,0);
});

test('Image cleanup: expired staging lifetime cannot expire a finalized receipt or delete its referenced object',async t=>{
  const f=await setup(t),key=crypto.randomUUID();
  const final=await f.call('POST',`/image-uploads/${f.id}/finalize`,undefined,key);assert.equal(final.status,200);const image=((await final.json())as any).data;
  await f.pool.query("UPDATE card_image_uploads SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[f.id]);await f.sweep();
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].state,'finalized');
  assert.ok(await f.storage.get(f.key));assert.equal(f.storage.size(),1);
  const replay=await f.call('POST',`/image-uploads/${f.id}/finalize`,undefined,key);assert.equal(replay.status,200,await replay.clone().text());assert.equal(((await replay.json())as any).replayed,true);
  assert.equal((await f.call('DELETE',`/image-uploads/${f.id}`)).status,409);
  assert.equal((await f.call('DELETE','/images/'+image.id,{expectedVersion:image.version})).status,200);await f.sweep();assert.equal(f.storage.size(),0);
});

test('Image cleanup: legacy distinct staging key is removed while permanent key and terminal state survive',async t=>{
  const f=await setup(t);const final=await f.call('POST',`/image-uploads/${f.id}/finalize`);assert.equal(final.status,200);const image=((await final.json())as any).data;
  const legacyKey='images/legacy/'+crypto.randomUUID();await f.storage.put(legacyKey,f.png.bytes,f.png.contentType);await f.storage.put(f.key,f.png.bytes,f.png.contentType);
  await f.pool.query('UPDATE card_images SET storage_key=$2 WHERE id=$1',[image.id,legacyKey]);await f.pool.query("UPDATE card_image_uploads SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[f.id]);await f.sweep();
  assert.equal(await f.storage.get(f.key),null);assert.ok(await f.storage.get(legacyKey));assert.equal(f.storage.size(),1);
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].state,'finalized');
});

test('Image cancellation: deferred commit failure preserves bytes and permits finalize',async t=>{
  const f=await setup(t);
  await f.pool.query(`CREATE FUNCTION reject_cancel_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic cancel commit failure'; END $$ LANGUAGE plpgsql`);
  await f.pool.query(`CREATE CONSTRAINT TRIGGER reject_cancel_commit_trigger AFTER UPDATE ON card_image_uploads DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.state='cancelled') EXECUTE FUNCTION reject_cancel_commit()`);
  assert.equal((await f.call('DELETE',`/image-uploads/${f.id}`)).status,500);
  await f.pool.query('DROP TRIGGER reject_cancel_commit_trigger ON card_image_uploads');assert.ok(await f.storage.get(f.key));
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].state,'content_received');
  assert.equal((await f.call('POST',`/image-uploads/${f.id}/finalize`)).status,200);
});

test('Image cancellation: committed failure to delete retains durable cleanup key',async t=>{
  const f=await setup(t),remove=f.storage.delete.bind(f.storage);let refuse=true;
  f.storage.delete=async key=>{if(refuse)throw new Error('synthetic unavailable storage');await remove(key);};
  const cancelled=await f.call('DELETE',`/image-uploads/${f.id}`);assert.equal(cancelled.status,200);
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].state,'cancelled');
  assert.deepEqual((await f.pool.query('SELECT storage_key FROM pending_storage_deletions')).rows.map(r=>r.storage_key),[f.key]);assert.ok(await f.storage.get(f.key));
  refuse=false;await f.sweep();assert.equal(f.storage.size(),0);assert.equal((await f.pool.query('SELECT count(*)::int n FROM pending_storage_deletions')).rows[0].n,0);
});

test('Image migration: legacy finalized references repair terminal state exactly once',async t=>{
  const f=await setup(t),key=crypto.randomUUID();const final=await f.call('POST',`/image-uploads/${f.id}/finalize`,undefined,key);assert.equal(final.status,200);
  await f.pool.query("UPDATE card_image_uploads SET state='expired',staging_cleaned=TRUE,expires_at=NOW()-INTERVAL '1 day' WHERE id=$1",[f.id]);
  const before=(await f.pool.query('SELECT version FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].version;
  // This random schema simulates an upgrade from the prior migration ledger.
  await f.pool.query("DELETE FROM schema_migrations WHERE version='0026'");await runMigrations(f.pool);
  const fixed=(await f.pool.query('SELECT state,version FROM card_image_uploads WHERE id=$1',[f.id])).rows[0];assert.equal(fixed.state,'finalized');assert.equal(fixed.version,before+1);
  await runMigrations(f.pool);assert.deepEqual((await f.pool.query('SELECT state,version FROM card_image_uploads WHERE id=$1',[f.id])).rows[0],fixed);
  const replay=await f.call('POST',`/image-uploads/${f.id}/finalize`,undefined,key);assert.equal(replay.status,200);assert.ok(await f.storage.get(f.key));
});

test('Image cleanup: a finalize commit after the claim snapshot cannot delete its live object',async t=>{
  const f=await setup(t),blocker=await f.pool.connect();
  const commitGate=crypto.randomInt(100_000,1_000_000_000),projectionGate=crypto.randomInt(1_000_000_001,2_000_000_000);
  let pendingFinalize:Promise<Response>|undefined,pendingCleanup:Promise<unknown>|undefined;
  try{
    await blocker.query('SELECT pg_advisory_lock($1),pg_advisory_lock($2)',[commitGate,projectionGate]);
    await f.pool.query(`CREATE FUNCTION hold_final_commit() RETURNS trigger AS $$ BEGIN PERFORM pg_advisory_xact_lock(${commitGate}); RETURN NEW; END $$ LANGUAGE plpgsql`);
    await f.pool.query(`CREATE CONSTRAINT TRIGGER hold_final_commit_trigger AFTER INSERT ON card_images DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hold_final_commit()`);
    await f.pool.query(`CREATE FUNCTION hold_cleanup_id(value text) RETURNS text AS $$ BEGIN PERFORM pg_advisory_xact_lock(${projectionGate}); RETURN value; END $$ LANGUAGE plpgsql VOLATILE`);
    await f.pool.query("UPDATE card_image_uploads SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE id=$1",[f.id]);
    const waitFor=async(check:()=>Promise<boolean>)=>{const until=Date.now()+5000;while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Actual database scheduling barrier was not observed');};
    const blocked=(gate:number)=>async()=>Number((await f.pool.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND granted=FALSE",[gate])).rows[0].count)>0;
    pendingFinalize=Promise.resolve(f.call('POST',`/image-uploads/${f.id}/finalize`));await waitFor(blocked(commitGate));
    await waitFor(async()=>Boolean((await f.pool.query('SELECT expires_at<=clock_timestamp() due FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].due));
    let instrumented=false;
    // Scheduling-only identity projection exposes a real pre-LockRows snapshot.
    // No predicate, reference answer, query result or DB operation is mocked.
    const claimPool={query:f.pool.query.bind(f.pool),connect:async()=>{const client=await f.pool.connect();return{query:async(sql:string,args?:unknown[])=>{
      if(sql.includes('FROM card_image_uploads u')&&sql.includes('FOR UPDATE OF u SKIP LOCKED')){assert.ok(sql.includes('SELECT u.id,'));instrumented=true;sql=sql.replace('SELECT u.id,','SELECT hold_cleanup_id(u.id) AS id,');}
      return client.query(sql,args);
    },release:()=>client.release()};}} as unknown as pg.Pool;
    pendingCleanup=runWithStorageDriver(f.storage,()=>cleanupOrphanUploads(claimPool));await waitFor(blocked(projectionGate));
    await blocker.query('SELECT pg_advisory_unlock($1)',[commitGate]);const final=await pendingFinalize;assert.equal(final.status,200,await final.clone().text());
    await blocker.query('SELECT pg_advisory_unlock($1)',[projectionGate]);await pendingCleanup;assert.equal(instrumented,true);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM card_images')).rows[0].n,1);assert.ok(await f.storage.get(f.key),'live image bytes survive the stale claim snapshot');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM pending_storage_deletions')).rows[0].n,0);
  }finally{
    await blocker.query('SELECT pg_advisory_unlock_all()');blocker.release();await pendingFinalize?.catch(()=>{});await pendingCleanup?.catch(()=>{});
  }
});
