import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { imageFixture } from '../../../../apps/api/test/support/image-fixtures.ts';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { MemoryStorageDriver, runWithStorageDriver } from '../../../../apps/api/src/adapters/storage.ts';
import { SharpImageVerifier } from '../../../../apps/api/src/services/image-verifier-node.ts';
import { purgeExpiredTrash } from '../../../../apps/api/src/services/trash-purge.ts';

// This reviewer-authored probe uses real finalized PNG bytes, mounted HTTP
// handlers and separate PostgreSQL connections. Gates only schedule real locks.
for (const first of ['restore', 'purge'] as const) test(`independent finalized PNG restore/purge: ${first} first`, async t => {
  const f = await lifecycleFixture(t), storage = new MemoryStorageDriver();
  const app = createApp(async()=>{}, {pool:f.pool,storage,imageVerifier:new SharpImageVerifier(),rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const headers={cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/json'};
  const request=(method:string,path:string,body?:object,key=crypto.randomUUID())=>app.request('http://localhost/api/v1'+path,{method,headers:{...headers,'idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const png=imageFixture('png');
  const stage=await request('POST','/cards/card/image-uploads',{filename:'independent-race.png',byteLength:png.bytes.length,contentType:png.contentType,sha256:crypto.createHash('sha256').update(png.bytes).digest('hex')});
  assert.equal(stage.status,201);const upload=(await stage.json() as any).data;
  const put=await app.request(`http://localhost/api/v1/image-uploads/${upload.id}/content`,{method:'PUT',headers,body:new Uint8Array(png.bytes).buffer});assert.equal(put.status,200);
  const final=await request('POST',`/image-uploads/${upload.id}/finalize`);assert.equal(final.status,200);const image=(await final.json() as any).data;
  const comment=await f.post('Independent retained secret');
  const before=(await f.pool.query("SELECT version FROM cards WHERE id='card'")).rows[0].version;
  const deletion=await request('POST','/cards/card/delete',{expectedVersion:before,expectedBoardVersion:await f.version()});assert.equal(deletion.status,200);const deleted=(await deletion.json() as any).data;
  const restoreBody={expectedVersion:deleted.version,expectedBoardVersion:await f.version()}, restoreKey=crypto.randomUUID();
  const gate=crypto.randomInt(100000,1000000000), holder=await f.pool.connect();
  const pid=Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await holder.query('SELECT pg_advisory_lock($1)',[gate]);
  await f.pool.query(`CREATE FUNCTION reviewer_transition_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.state='trashed' AND NEW.state='${first==='restore'?'active':'purged'}' THEN PERFORM pg_advisory_xact_lock(${gate}); END IF; RETURN NEW; END $$`);
  await f.pool.query('CREATE TRIGGER reviewer_transition_gate BEFORE UPDATE OF state ON cards FOR EACH ROW EXECUTE FUNCTION reviewer_transition_gate()');
  const graph=async()=> (await f.pool.query('SELECT pid,pg_blocking_pids(pid) blockers,query FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() ORDER BY pid',[f.schema])).rows;
  const waitBlockedBy=async(blocker:number)=>{const deadline=Date.now()+4500;while(Date.now()<deadline){const rows=await graph();const match=rows.find(r=>r.blockers.includes(blocker));if(match)return Number(match.pid);await new Promise(r=>setTimeout(r,10));}assert.fail('Expected actual independent-connection lock wait missing');};
  const restore=()=>request('POST','/cards/card/restore',restoreBody,restoreKey);
  const purge=()=>runWithStorageDriver(storage,()=>purgeExpiredTrash(f.pool,{asOfDate:new Date(Date.now()+48*3600000)}));
  let restoring:Promise<Response>|undefined,purging:ReturnType<typeof purge>|undefined;
  try {
    if(first==='restore'){
      restoring=restore();const restorePid=await waitBlockedBy(pid);assert.notEqual(restorePid,pid);
      const skipped=await purge();assert.equal(skipped.purgedCardIds.includes('card'),false);
      t.diagnostic(JSON.stringify({first,holderPid:pid,restorePid,claim:skipped}));
      await holder.query('SELECT pg_advisory_unlock($1)',[gate]);assert.equal((await restoring).status,200);
    }else{
      purging=purge();const purgePid=await waitBlockedBy(pid);restoring=restore();const restorePid=await waitBlockedBy(purgePid);assert.notEqual(restorePid,purgePid);
      await holder.query('SELECT pg_advisory_unlock($1)',[gate]);await waitBlockedBy(restorePid);
      t.diagnostic(JSON.stringify({first,holderPid:pid,purgePid,restorePid,actualCycle:await graph()}));
      assert.equal((await purging).purgedCardIds.includes('card'),true);
      const lost=await restoring;assert.equal(lost.status,503,await lost.clone().text());assert.equal(lost.headers.get('retry-after'),'1');assert.equal((await lost.json() as any).error.code,'SERVICE_UNAVAILABLE');
      assert.equal((await f.pool.query('SELECT id FROM idempotency_receipts WHERE idempotency_key=$1',[restoreKey])).rowCount,0);
      const retry=await restore();assert.equal(retry.status,404);assert.equal((await retry.json() as any).error.code,'NOT_FOUND');
    }
    const winner=first==='restore';
    const card=(await f.pool.query("SELECT state,title FROM cards WHERE id='card'")).rows[0];assert.equal(card.state,winner?'active':'purged');assert.equal(card.title,winner?'Discussion':'[Purged card]');
    assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE card_id='card' AND action='card_restored'")).rowCount,winner?1:0);
    assert.equal((await f.pool.query("SELECT id FROM activity_log WHERE card_id='card' AND action='card_purged'")).rowCount,winner?0:1);
    const body=(await f.pool.query('SELECT body FROM comments WHERE id=$1',[comment.id])).rows[0].body;assert.equal(body.includes('Independent retained secret'),winner);
    assert.equal((await f.pool.query('SELECT id FROM card_images WHERE id=$1',[image.id])).rowCount,winner?1:0);
    const delivered=await request('GET',`/images/${image.id}/content`);assert.equal(delivered.status,winner?200:404);
    if(winner){assert.deepEqual(Buffer.from(await delivered.arrayBuffer()),png.bytes);assert.equal(storage.size(),1);}else{assert.equal(storage.size(),0);assert.equal((await f.pool.query('SELECT id FROM idempotency_receipts WHERE idempotency_key=$1',[restoreKey])).rowCount,0);}
    assert.equal((await purge()).purgedCardIds.includes('card'),false);
  } finally {
    await holder.query('SELECT pg_advisory_unlock_all()');holder.release();
    await restoring?.catch(()=>{});await purging?.catch(()=>{});
  }
});
