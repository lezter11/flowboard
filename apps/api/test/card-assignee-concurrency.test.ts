import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';

async function waitFor(pool:pg.Pool,sql:string,args:unknown[],label:string){
 for(let i=0;i<150;i++){const rows=(await pool.query(sql,args)).rows;if(rows.length)return rows;await new Promise(r=>setTimeout(r,10));}
 assert.fail(label);
}
for(const operation of ['create','update'] as const)for(const change of ['demotion','revocation'] as const)for(const first of ['assignment','eligibility'] as const)test(`${operation} assignment serializes ${change}: ${first} wins first`,async t=>{
 const f=await lifecycleFixture(t);const uid=f.actors.member!.user.id;const fence=837451928;
 const trigger=first==='assignment'
  ?'CREATE TRIGGER recipient_fence BEFORE INSERT ON card_assignees FOR EACH ROW EXECUTE FUNCTION recipient_fence()'
  :change==='demotion'
   ?'CREATE TRIGGER recipient_fence BEFORE UPDATE ON project_memberships FOR EACH ROW EXECUTE FUNCTION recipient_fence()'
   :'CREATE TRIGGER recipient_fence BEFORE DELETE ON board_grants FOR EACH ROW EXECUTE FUNCTION recipient_fence()';
 await f.pool.query(`CREATE FUNCTION recipient_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${fence}); IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$; ${trigger}`);
 const holder=await f.pool.connect();await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock($1)',[fence]);let released=false;
 t.after(async()=>{if(!released){await holder.query('ROLLBACK');holder.release();}});
 const assign=()=>operation==='create'
  ?f.request('POST','/boards/brd/cards','owner',{title:'Race-created card',columnId:'col',assigneeIds:[uid],expectedBoardVersion:1})
  :f.request('PATCH','/cards/card','owner',{assigneeIds:[uid],expectedVersion:1});
 const mutate=()=>change==='demotion'
  ?f.request('PATCH','/projects/prj/members/'+uid,'owner',{role:'viewer',status:'active',expectedVersion:1})
  :f.request('DELETE','/boards/brd/grants/'+uid,'owner',{expectedAccessRevision:'1'});
 // Freeze the first mounted handler at its actual database mutation, after all its access locks.
 const firstPending=first==='assignment'?assign():mutate();
 const queryPart=first==='assignment'?'%INSERT INTO card_assignees%':change==='demotion'?'%UPDATE project_memberships%':'%DELETE FROM board_grants%';
 let secondPending:Promise<Response>|undefined;
 try{
  const [writer]=await waitFor(f.pool,`SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory' AND query LIKE $2`,[f.schema,queryPart],'first mounted writer reaches its trigger fence');
  secondPending=Promise.resolve(first==='assignment'?mutate():assign());
  const blockers=await waitFor(f.pool,`WITH RECURSIVE waits AS (
    SELECT pid,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE application_name=$1 AND pid<>$2 AND wait_event_type='Lock'
  ), chain AS (SELECT pid,unnest(blockers) blocker FROM waits UNION SELECT c.pid,unnest(pg_blocking_pids(c.blocker)) FROM chain c)
  SELECT DISTINCT pid FROM chain WHERE blocker=$2`,[f.schema,writer.pid],'opposite mounted writer must wait on the first writer, not pass eligibility unchecked');
  assert.equal(blockers.length,1);assert.notEqual(blockers[0].pid,writer.pid);
 }finally{await holder.query('COMMIT');holder.release();released=true;}
 const a=await firstPending;const b=await secondPending!;
 assert.equal(a.status,first==='assignment'&&operation==='create'?201:200,await a.clone().text());
 assert.equal(b.status,first==='assignment'?200:422,await b.clone().text());
 const assigned=(await f.pool.query(`SELECT user_id FROM card_assignees`)).rows;
 assert.equal(assigned.length,first==='assignment'?1:0);
 if(first==='eligibility'){
  const body=await b.json() as any;assert.equal(body.error.code,'ASSIGNEE_NOT_ELIGIBLE');
  assert.equal(body.error.details.reasons[0].reason,change==='demotion'?'viewer':'no_board_access');
 }
});

test('create locks selected recipients; title-only edit preserves historical assignees and exact replay survives recipient demotion',async t=>{
 const f=await lifecycleFixture(t);const uid=f.actors.member!.user.id;
 const c=await f.request('POST','/boards/brd/cards','owner',{title:'Assigned',columnId:'col',assigneeIds:[uid],expectedBoardVersion:await f.version()},'assigned-create-stable-key');assert.equal(c.status,201,await c.clone().text());
 const card=(await c.json() as any).data;
 const demote=await f.request('PATCH','/projects/prj/members/'+uid,'owner',{role:'viewer',status:'active',expectedVersion:1});assert.equal(demote.status,200);
 const edit=await f.request('PATCH','/cards/'+card.id,'owner',{title:'Historical assignment preserved',expectedVersion:1});assert.equal(edit.status,200,await edit.clone().text());assert.deepEqual((await edit.json() as any).data.assigneeIds,[uid]);
 const replay=await f.request('POST','/boards/brd/cards','owner',{title:'Assigned',columnId:'col',assigneeIds:[uid],expectedBoardVersion:1},'assigned-create-stable-key');assert.equal(replay.status,201,await replay.text());
 const denied=await f.request('POST','/boards/brd/cards','owner',{title:'New assignment denied',columnId:'col',assigneeIds:[uid],expectedBoardVersion:await f.version()});assert.equal(denied.status,422,await denied.text());
});


test('assignment replay still reauthorizes a demoted actor and never discloses the saved card',async t=>{
 const f=await lifecycleFixture(t);const body={title:'PRIVATE_REPLAY_TITLE',columnId:'col',assigneeIds:[f.actors.owner!.user.id],expectedBoardVersion:await f.version()};const key='member-assignment-replay-key';
 const created=await f.request('POST','/boards/brd/cards','member',body,key);assert.equal(created.status,201,await created.text());
 assert.equal((await f.request('PATCH','/projects/prj/members/'+f.actors.member!.user.id,'owner',{role:'viewer',status:'active',expectedVersion:1})).status,200);
 const replay=await f.request('POST','/boards/brd/cards','member',body,key);assert.equal(replay.status,403);assert.equal((await replay.text()).includes(body.title),false);
});
