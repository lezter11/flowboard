import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { editComment } from '../src/adapters/comments.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';

const secret='SYNTHETIC_REMOVED_PRIVATE_TEXT';
test('comment edit redacts exact notification copies and legacy outbox payload without creating new delivery intentions',async t=>{
 const f=await lifecycleFixture(t);const c=await f.post(secret);const other=await f.post('UNRELATED_COMMENT_STAYS');
 await f.pool.query(`UPDATE outbox SET payload=payload||jsonb_build_object('body',$2::text,'raw',jsonb_build_object('secret',$2::text)) WHERE payload->>'commentId'=$1`,[c.id,secret]);
 const before=(await f.pool.query(`SELECT (SELECT count(*) FROM notifications)::int notifications,(SELECT count(*) FROM outbox)::int jobs`)).rows[0];
 const r=await f.request('PATCH',`/comments/${c.id}`,'member',{body:'Corrected public wording',mentions:[],expectedVersion:1},'edit-retention-stable');assert.equal(r.status,200,await r.text());
 const row=(await f.pool.query(`SELECT body,title FROM notifications WHERE comment_id=$1`,[c.id])).rows[0];
 assert.ok(row);assert.equal(JSON.stringify(row).includes(secret),false);assert.equal(row.title,'Comment edited');
 assert.equal(row.body,'[Comment edited]');
 const payload=(await f.pool.query(`SELECT payload FROM outbox WHERE payload->>'commentId'=$1`,[c.id])).rows[0].payload;
 assert.equal(JSON.stringify(payload).includes(secret),false);assert.deepEqual(payload.mentions,[f.actors.manager!.user.id]);
 assert.ok((await f.pool.query(`SELECT body FROM notifications WHERE comment_id=$1`,[other.id])).rows[0].body.includes('UNRELATED_COMMENT_STAYS'));
 assert.deepEqual((await f.pool.query(`SELECT (SELECT count(*) FROM notifications)::int notifications,(SELECT count(*) FROM outbox)::int jobs`)).rows[0],before);
 const replay=await f.request('PATCH',`/comments/${c.id}`,'member',{body:'Corrected public wording',mentions:[],expectedVersion:1},'edit-retention-stable');assert.equal(replay.status,200,await replay.text());
 await processOutboxLease(f.pool);
 assert.equal(JSON.stringify((await f.pool.query(`SELECT body,title FROM notifications WHERE comment_id=$1`,[c.id])).rows).includes(secret),false);
 assert.deepEqual((await f.pool.query(`SELECT payload FROM outbox WHERE payload->>'commentId'=$1`,[c.id])).rows[0].payload.mentions,[f.actors.manager!.user.id]);
 const inbox=await f.request('GET','/notifications','manager');assert.equal(inbox.status,200);assert.equal((await inbox.text()).includes(secret),false);
});

test('failed comment edit rolls source and copied previews back together; a later committed edit sanitizes busy outbox on retry',async t=>{
 const f=await lifecycleFixture(t);const c=await f.post(secret);const writer=await f.pool.connect();
 try{
  await writer.query('BEGIN');await editComment(writer,c.id,{body:'Will roll back',mentions:[],expectedVersion:1},f.actors.member!.user.id);
  assert.equal(JSON.stringify((await writer.query('SELECT body FROM notifications WHERE comment_id=$1',[c.id])).rows).includes(secret),false);
  await writer.query('ROLLBACK');
 }finally{writer.release();}
 assert.equal((await f.pool.query('SELECT body FROM comments WHERE id=$1',[c.id])).rows[0].body.includes(secret),true);
 assert.equal((await f.pool.query('SELECT body FROM notifications WHERE comment_id=$1',[c.id])).rows[0].body.includes(secret),true);
 await f.pool.query(`UPDATE outbox SET payload=payload||jsonb_build_object('body',$2::text,'mentions',jsonb_build_array($3::text)) WHERE payload->>'commentId'=$1`,[c.id,secret,f.actors.manager!.user.id]);
 const holder=await f.pool.connect();try{
  await holder.query('BEGIN');await holder.query(`SELECT id FROM outbox WHERE payload->>'commentId'=$1 FOR UPDATE`,[c.id]);
  const r=await f.request('PATCH',`/comments/${c.id}`,'member',{body:'Committed wording',mentions:[],expectedVersion:1});assert.equal(r.status,200,await r.text());
  await holder.query('COMMIT');
 }finally{await holder.query('ROLLBACK');holder.release();}
 await processOutboxLease(f.pool);
 const payload=(await f.pool.query(`SELECT payload FROM outbox WHERE payload->>'commentId'=$1`,[c.id])).rows[0].payload;
 assert.equal(JSON.stringify(payload).includes(secret),false);assert.deepEqual(payload.mentions,[f.actors.manager!.user.id]);
 assert.equal(JSON.stringify((await f.pool.query('SELECT body,title FROM notifications WHERE comment_id=$1',[c.id])).rows).includes(secret),false);
});


test('an edit preserves the accepted creation delivery intent but never adds edited mention recipients',async t=>{
 const f=await lifecycleFixture(t);const c=await f.post(secret);
 // Reproduce a pending legacy/recovery delivery: accepted outbox exists, materialized delivery absent.
 await f.pool.query('DELETE FROM notifications WHERE comment_id=$1',[c.id]);
 const manager=f.actors.manager!.user;const viewer=f.actors.viewer!.user;
 const managerToken='@'+manager.displayName;const firstBody='Typo corrected '+managerToken;
 const first=await f.request('PATCH',`/comments/${c.id}`,'member',{body:firstBody,mentions:[{userId:manager.id,start:firstBody.indexOf(managerToken),end:firstBody.length}],expectedVersion:1});assert.equal(first.status,200,await first.text());
 const viewerToken='@'+viewer.displayName;const secondBody=firstBody+' '+viewerToken;
 const second=await f.request('PATCH',`/comments/${c.id}`,'member',{body:secondBody,mentions:[{userId:manager.id,start:secondBody.indexOf(managerToken),end:secondBody.indexOf(managerToken)+managerToken.length},{userId:viewer.id,start:secondBody.indexOf(viewerToken),end:secondBody.length}],expectedVersion:2});assert.equal(second.status,200,await second.text());
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM notifications WHERE comment_id=$1',[c.id])).rows[0].n,0,'edit itself never delivers');
 assert.equal((await f.pool.query(`SELECT count(*)::int n FROM outbox WHERE payload->>'commentId'=$1`,[c.id])).rows[0].n,1,'edit creates no second intention');
 await processOutboxLease(f.pool);await processOutboxLease(f.pool);
 const rows=(await f.pool.query('SELECT user_id,body FROM notifications WHERE comment_id=$1',[c.id])).rows;
 assert.deepEqual(rows.map(r=>r.user_id),[manager.id]);assert.equal(JSON.stringify(rows).includes(secret),false);
});

async function waitForBlocking(pool:import('pg').Pool,pid:number){
 for(let i=0;i<150;i++){const rows=(await pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rows;if(rows.length)return rows[0].pid as number;await new Promise(r=>setTimeout(r,10));}
 assert.fail('Actual separate PostgreSQL connection must wait on the held source/consumer');
}

test('edit wins source lock while actual consumer holds its outbox claim: no deadlock or old copied text after recovery',async t=>{
 const f=await lifecycleFixture(t);const c=await f.post(secret);await f.pool.query('DELETE FROM notifications');
 await f.pool.query(`UPDATE outbox SET payload=payload||jsonb_build_object('body',$2::text) WHERE payload->>'commentId'=$1`,[c.id,secret]);
 const writer=await f.pool.connect();try{
  await writer.query('BEGIN');
  // The mounted writer's established order: board, source card, then source comment.
  await writer.query(`SELECT id FROM boards WHERE id='brd' FOR UPDATE`);
  await writer.query(`SELECT id FROM cards WHERE id='card' FOR SHARE`);
  await writer.query('SELECT id FROM comments WHERE id=$1 FOR UPDATE',[c.id]);
  const pid=(await writer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  const consuming=processOutboxLease(f.pool);
  const consumerPid=await waitForBlocking(f.pool,pid);assert.notEqual(consumerPid,pid);
  await editComment(writer,c.id,{body:'Edited before recovery',mentions:[],expectedVersion:1},f.actors.member!.user.id);
  await writer.query('COMMIT');
  const result=await consuming;assert.equal(result.delivered,1);
  const notifications=(await f.pool.query('SELECT user_id,body FROM notifications WHERE comment_id=$1',[c.id])).rows;
  assert.deepEqual(notifications.map(r=>r.user_id),[f.actors.manager!.user.id]);assert.equal(JSON.stringify(notifications).includes(secret),false);
  assert.equal(JSON.stringify((await f.pool.query(`SELECT payload FROM outbox WHERE payload->>'commentId'=$1`,[c.id])).rows).includes(secret),false);
 }finally{await writer.query('ROLLBACK');writer.release();}
});

test('actual consumer wins source guard and commits once before waiting mounted comment edit redacts its preview',async t=>{
 const f=await lifecycleFixture(t);const c=await f.post(secret);await f.pool.query('DELETE FROM notifications');
 const fence=938475192;
 await f.pool.query(`CREATE FUNCTION edit_delivery_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${fence}); RETURN NEW; END $$; CREATE TRIGGER edit_delivery_fence BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION edit_delivery_fence()`);
 const holder=await f.pool.connect();try{
  await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock($1)',[fence]);const pid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  const consuming=processOutboxLease(f.pool);const consumerPid=await waitForBlocking(f.pool,pid);
  const edit=f.request('PATCH',`/comments/${c.id}`,'member',{body:'Edited after recovery',mentions:[],expectedVersion:1});
  const editPid=await waitForBlocking(f.pool,consumerPid);assert.notEqual(editPid,consumerPid);
  await holder.query('COMMIT');const result=await consuming;assert.equal(result.delivered,1);
  const response=await edit;assert.equal(response.status,200,await response.text());
  const rows=(await f.pool.query('SELECT body FROM notifications WHERE comment_id=$1',[c.id])).rows;assert.deepEqual(rows,[{body:'[Comment edited]'}]);
 }finally{await holder.query('ROLLBACK');holder.release();}
});
