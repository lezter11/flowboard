import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {lifecycleFixture} from './support/lifecycle-fixture.ts';
import {canonicalJson,sha256} from '../src/adapters/idempotency.ts';

type Fixture=Awaited<ReturnType<typeof lifecycleFixture>>;
async function state(f:Fixture){
  return(await f.pool.query("SELECT archived,version,(SELECT COUNT(*)::int FROM idempotency_receipts) AS receipts,(SELECT COUNT(*)::int FROM activity_log) AS activity FROM projects WHERE id='prj'")).rows[0];
}
async function version(f:Fixture){return Number((await state(f)).version);}
const transition=async(f:Fixture,action:'archive'|'reopen',body?:object,key?:string,actor='owner')=>f.request('POST','/projects/prj/'+action,actor,body,key);

for(const action of ['archive','reopen']as const)test(`project lifecycle OCC: ${action} validates actual version after Owner authority`,async t=>{
  const f=await lifecycleFixture(t);const before=await state(f);
  for(const body of [undefined,{}, {expectedVersion:-1},{expectedVersion:1.5},{expectedVersion:'1'},{expectedVersion:null},{expectedVersion:1,unexpected:true}]){
    const response=await transition(f,action,body as object|undefined);assert.equal(response.status,422,await response.clone().text());assert.deepEqual(await state(f),before);
  }
  for(const actor of ['manager','member','viewer','outsider']){
    const response=await transition(f,action,undefined,undefined,actor);assert.equal(response.status,actor==='outsider'?404:403);assert.equal((await response.json()as any).data,undefined);
  }
  const invalid=await f.app.request('http://localhost/api/v1/projects/prj/'+action,{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/json','idempotency-key':crypto.randomUUID()},body:'{'});
  assert.equal(invalid.status,400);assert.deepEqual(await state(f),before);
});

test('project lifecycle OCC: stale archive/reopen never overwrites later opposite transitions',async t=>{
  const f=await lifecycleFixture(t);const initial=await version(f);
  assert.equal((await transition(f,'archive',{expectedVersion:initial})).status,200);
  const archivedVersion=await version(f);
  assert.equal((await transition(f,'reopen',{expectedVersion:archivedVersion})).status,200);
  const reopened=await state(f);
  const staleArchive=await transition(f,'archive',{expectedVersion:initial});assert.equal(staleArchive.status,409);assert.equal((await staleArchive.json()as any).error.code,'STALE_VERSION');assert.deepEqual(await state(f),reopened);
  assert.equal((await transition(f,'archive',{expectedVersion:reopened.version})).status,200);
  const archivedAgain=await state(f);
  const staleReopen=await transition(f,'reopen',{expectedVersion:archivedVersion});assert.equal(staleReopen.status,409);assert.equal((await staleReopen.json()as any).error.code,'STALE_VERSION');assert.deepEqual(await state(f),archivedAgain);
});

for(const action of ['archive','reopen']as const)test(`project lifecycle OCC: ${action} receipt binds original version and replays after later transitions`,async t=>{
  const f=await lifecycleFixture(t);
  if(action==='reopen')assert.equal((await transition(f,'archive',{expectedVersion:await version(f)})).status,200);
  const original={expectedVersion:await version(f)},key=crypto.randomUUID();
  const response=await transition(f,action,original,key);assert.equal(response.status,200);const committed=(await response.json()as any).data;
  const opposite=action==='archive'?'reopen':'archive';assert.equal((await transition(f,opposite,{expectedVersion:await version(f)})).status,200);
  const before=await state(f);
  const replay=await transition(f,action,original,key);assert.equal(replay.status,200);const receipt=await replay.json()as any;assert.equal(receipt.replayed,true);assert.equal(receipt.data.version,committed.version);assert.deepEqual(await state(f),before);
  const changed=await transition(f,action,{expectedVersion:before.version},key);assert.equal(changed.status,409);assert.equal((await changed.json()as any).error.code,'IDEMPOTENCY_CONFLICT');assert.deepEqual(await state(f),before);
  const persisted=(await f.pool.query('SELECT body_hash,response_body FROM idempotency_receipts WHERE idempotency_key=$1',[key])).rows[0];assert.equal(persisted.body_hash,sha256(canonicalJson(original)));assert.equal(persisted.response_body.data.name,undefined);
  // Current Owner authority is required even to retrieve a minimal historical receipt.
  await f.pool.query("UPDATE workspaces SET owner_id=$1 WHERE id='ws'",[f.actors.outsider!.user.id]);
  const denied=await transition(f,action,original,key);assert.equal(denied.status,404);assert.equal((await denied.json()as any).data,undefined);
});

test('project lifecycle OCC: stale reopen refuses before quota checks and preserves the cap',async t=>{
  const f=await lifecycleFixture(t);assert.equal((await transition(f,'archive',{expectedVersion:await version(f)})).status,200);
  await f.pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at) SELECT 'cap_'||g,'ws','Active cap '||g,NOW(),NOW() FROM generate_series(1,3)g");
  const before=await state(f),stale=await transition(f,'reopen',{expectedVersion:before.version-1});assert.equal(stale.status,409);assert.equal((await stale.json()as any).error.code,'STALE_VERSION');assert.deepEqual(await state(f),before);
  const quota=await transition(f,'reopen',{expectedVersion:before.version});assert.equal(quota.status,409);assert.equal((await quota.json()as any).error.code,'QUOTA_EXCEEDED');assert.deepEqual(await state(f),before);
});

for(const initiallyArchived of [false,true])test(`project lifecycle OCC: opposite concurrent writes serialize on distinct connections (${initiallyArchived?'archived':'active'})`,async t=>{
  const f=await lifecycleFixture(t);if(initiallyArchived)assert.equal((await transition(f,'archive',{expectedVersion:await version(f)})).status,200);
  const before=await state(f),blocker=await f.pool.connect();const pending:Array<Promise<Response>>=[];
  try{
    await blocker.query('BEGIN');const blockerPid=Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);await blocker.query("SELECT id FROM projects WHERE id='prj' FOR UPDATE");
    pending.push(transition(f,'archive',{expectedVersion:before.version}),transition(f,'reopen',{expectedVersion:before.version}));
    let observed:Array<{pid:number;blockers:number[]}>=[];const deadline=Date.now()+3000;
    while(Date.now()<deadline){
      const rows=await f.pool.query<{pid:number;blockers:number[]}>(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1 AND pid<>$2::int AND cardinality(pg_blocking_pids(pid))>0 AND wait_event_type='Lock'`,[f.schema,blockerPid]);observed=rows.rows;if(observed.length>=2)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(observed.length,2,'Both mounted transactions must be observed blocked on separate backend connections');const waiting=new Map(observed.map(row=>[row.pid,row.blockers]));const reachesBlocker=(pid:number,seen=new Set<number>()):boolean=>pid===blockerPid||(!seen.has(pid)&&Boolean(waiting.get(pid)?.some(parent=>reachesBlocker(parent,new Set([...seen,pid])))));assert.ok(observed.every(row=>reachesBlocker(row.pid)),'Both waits must be causally rooted at the held project lock');t.diagnostic(JSON.stringify({blockerPid,observed}));await blocker.query('COMMIT');
    const responses=await Promise.all(pending);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const refused=responses.find(r=>r.status===409)!;assert.equal((await refused.json()as any).error.code,'STALE_VERSION');
    const after=await state(f);assert.equal(after.version,before.version+1);assert.equal(after.receipts,before.receipts+1);assert.equal(after.activity,before.activity);
  }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await Promise.allSettled(pending);}
});


test('project lifecycle OCC: input arrival holds no Owner row lock and transaction rechecks changed authority',async t=>{
  const f=await lifecycleFixture(t),before=await state(f),input=JSON.stringify({expectedVersion:before.version});
  let controller!:ReadableStreamDefaultController<Uint8Array>;
  const stream=new ReadableStream<Uint8Array>({start(value){controller=value;}});
  const changer=await f.pool.connect();
  const pending=Promise.resolve(f.app.request('http://localhost/api/v1/projects/prj/archive',{
    method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/json','content-length':String(Buffer.byteLength(input)),'idempotency-key':crypto.randomUUID()},body:stream,duplex:'half',
  }as RequestInit));
  try{
    let observed=false;
    for(let attempt=0;attempt<200;attempt++){
      const rows=await changer.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='idle' AND query ILIKE 'SELECT w.owner_id, pm.role%' AND query NOT ILIKE '%FOR SHARE%'`,[f.schema]);
      if(rows.rowCount){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(observed,true,'Observe the real completed nonlocking Owner preflight while body remains pending');
    await changer.query('BEGIN');await changer.query("SET LOCAL lock_timeout='500ms'");
    await changer.query("UPDATE workspaces SET owner_id=$1 WHERE id='ws'",[f.actors.outsider!.user.id]);await changer.query('COMMIT');
    controller.enqueue(new TextEncoder().encode(input));controller.close();
    const response=await pending;assert.equal(response.status,404);assert.equal((await response.json()as any).data,undefined);assert.deepEqual(await state(f),before);
  }finally{await changer.query('ROLLBACK').catch(()=>{});changer.release();try{controller.close();}catch{}await pending.catch(()=>{});}
});
