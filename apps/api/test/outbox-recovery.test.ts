import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';

test('Outbox: a real SQL poison error retries/quarantines without aborting independent accepted work',async t=>{
  const f=await lifecycleFixture(t);
  const poison=await f.post('SQL poison source');
  const healthy=await f.post('Healthy notification source');
  await f.pool.query(`CREATE FUNCTION poison_notification() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.comment_id='${poison.id}' THEN RAISE EXCEPTION 'Synthetic poison check' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER poison_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION poison_notification()`);
  // Initial synchronous delivery may have created the notifications. Replay the
  // actual accepted outbox intents after deleting only this synthetic fixture's copies.
  await f.pool.query('DELETE FROM notifications');
  await f.pool.query("UPDATE outbox SET status='pending',retry_count=0,next_retry_at=NOW(),settled_at=NULL WHERE event_type='comment.created'");
  await f.pool.query("UPDATE outbox SET payload=payload||jsonb_build_object('body','Synthetic legacy private comment copy','recipientEmail','private@example.invalid') WHERE payload->>'commentId'=$1",[poison.id]);
  const first=await processOutboxLease(f.pool,{batchSize:50,maxRetries:2});
  assert.equal(first.retried,1);assert.equal(first.delivered,1);
  const sanitized=(await f.pool.query("SELECT payload FROM outbox WHERE payload->>'commentId'=$1",[poison.id])).rows[0].payload;
  assert.equal(Object.hasOwn(sanitized,'body'),false,'Retry rollback must not resurrect legacy copied body');assert.equal(Object.hasOwn(sanitized,'recipientEmail'),false);
  assert.equal((await f.pool.query('SELECT id FROM notifications WHERE comment_id=$1',[healthy.id])).rowCount,1);
  assert.equal((await f.pool.query('SELECT id FROM notifications WHERE comment_id=$1',[poison.id])).rowCount,0);
  await f.pool.query("UPDATE outbox SET next_retry_at=NOW() WHERE status='pending'");
  const second=await processOutboxLease(f.pool,{batchSize:50,maxRetries:2});assert.equal(second.failed,1);
  const row=(await f.pool.query("SELECT status,retry_count FROM outbox WHERE payload->>'commentId'=$1",[poison.id])).rows[0];assert.equal(row.status,'failed');assert.equal(row.retry_count,2);
});

test('Outbox: transaction rollback/restart and concurrent consumers produce one logical notification',async t=>{
  const f=await lifecycleFixture(t);const source=await f.post('Restarted source');
  await f.pool.query('DELETE FROM notifications');
  await f.pool.query("UPDATE outbox SET status='pending',retry_count=0,next_retry_at=NOW(),settled_at=NULL");
  const client=await f.pool.connect();await client.query('BEGIN');
  await client.query("SELECT id FROM outbox WHERE status='pending' FOR UPDATE");
  assert.equal((await processOutboxLease(f.pool)).processed,0,'A separate consumer skips the held transaction fence');
  await client.query('ROLLBACK');client.release();
  const results=await Promise.all([processOutboxLease(f.pool),processOutboxLease(f.pool)]);
  assert.equal(results.reduce((sum,r)=>sum+r.delivered,0),1);
  assert.equal((await f.pool.query('SELECT id FROM notifications WHERE comment_id=$1',[source.id])).rowCount,1);
  assert.equal((await processOutboxLease(f.pool)).processed,0);
});
