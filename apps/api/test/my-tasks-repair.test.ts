import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { getMyTasks } from '../src/adapters/cards.ts';

async function fixture(t: Parameters<typeof lifecycleFixture>[0]) {
  const f = await lifecycleFixture(t);
  await f.pool.query("UPDATE columns SET category='done' WHERE id='col'");
  for (let i=0;i<9;i++) {
    await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,due_date,created_at,updated_at)
      VALUES($1,'ws','prj','brd',$2,$1,$3,$4,'active',CASE WHEN $5::int IS NULL THEN NULL ELSE CURRENT_DATE+$5::int END,NOW(),NOW())`,
    [`task_${i}`,i===0?'col':'col2',i%2?'low':'high',2000+i,i<3?-1:i<5?0:i<7?1:null]);
    await f.pool.query("INSERT INTO card_assignees(card_id,user_id,workspace_id,project_id,created_at) VALUES($1,$2,'ws','prj',NOW())",[`task_${i}`,f.actors.member!.user.id]);
  }
  return f;
}

test('My Tasks: both routes traverse tied/null dates with bounded pages and no duplication',async t=>{
  const f=await fixture(t);
  for(const base of ['/me/tasks','/workspaces/ws/my-tasks']) {
    const ids:string[]=[]; let cursor:string|null=null;
    for(let page=0;page<5;page++) {
      const response=await f.request('GET',`${base}?projectId=prj&limit=2${cursor?'&cursor='+encodeURIComponent(cursor):''}`,'member');
      assert.equal(response.status,200,await response.clone().text());
      const body=await response.json() as any;
      assert.equal(body.timezone,'UTC');assert.match(body.asOfDate,/^\d{4}-\d{2}-\d{2}$/);
      assert.ok(body.data.length<=2);ids.push(...body.data.map((c:any)=>c.id));
      assert.ok(Object.hasOwn(body,'nextCursor'),'pagination envelope is required');cursor=body.nextCursor;
      if(!cursor)break;
    }
    assert.deepEqual(ids,Array.from({length:9},(_,i)=>`task_${i}`));
  }
});

test('My Tasks: due-state and priority are SQL filters; done is never overdue',async t=>{
  const f=await fixture(t);
  for(const [due,expected] of [['overdue',['task_1','task_2']],['today',['task_3','task_4']],['upcoming',['task_5','task_6']],['none',['task_7','task_8']]] as const){
    const r=await f.request('GET',`/me/tasks?projectId=prj&due=${due}`,'member');assert.equal(r.status,200);
    assert.deepEqual((await r.json()as any).data.map((c:any)=>c.id),expected);
  }
  const r=await f.request('GET','/me/tasks?projectId=prj&due=today&priority=high','member');assert.deepEqual((await r.json()as any).data.map((c:any)=>c.id),['task_4']);
});

test('My Tasks: invalid queries, altered context and grant revocation fail closed',async t=>{
  const f=await fixture(t);
  for(const query of ['','projectId=prj&limit=2junk','projectId=prj&limit=101','projectId=prj&due=bogus','projectId=prj&cursor=garbage']){
    const r=await f.request('GET','/me/tasks?'+query,'member');assert.ok([400,409,422].includes(r.status),`${query} returned ${r.status}`);
  }
  const first=await f.request('GET','/me/tasks?projectId=prj&limit=2','member');const cursor=(await first.json()as any).nextCursor;assert.ok(cursor);
  for(const [actor,extra] of [['owner',''],['member','&due=today'],['member','&workspaceId=other']] as const){
    const r=await f.request('GET',`/me/tasks?projectId=prj&limit=2&cursor=${encodeURIComponent(cursor)}${extra}`,actor);assert.equal(r.status,409);
  }
  await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.member!.user.id]);
  const denied=await f.request('GET',`/me/tasks?projectId=prj&limit=2&cursor=${encodeURIComponent(cursor)}`,'member');assert.equal(denied.status,409);assert.equal((await denied.json()as any).data,undefined);
  const empty=await f.request('GET','/me/tasks?projectId=prj','member');assert.deepEqual((await empty.json()as any).data,[]);
});

test('My Tasks: archive lifecycle hides assignments and invalidates a prior cursor',async t=>{
  const f=await fixture(t);const first=await f.request('GET','/me/tasks?projectId=prj&limit=2','member');const cursor=(await first.json()as any).nextCursor;
  await f.pool.query("UPDATE boards SET archived=TRUE WHERE id='brd'");
  const stale=await f.request('GET',`/me/tasks?projectId=prj&limit=2&cursor=${encodeURIComponent(cursor)}`,'member');assert.equal(stale.status,409);
  const fresh=await f.request('GET','/me/tasks?projectId=prj','member');assert.deepEqual((await fresh.json()as any).data,[]);
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='prj'");assert.equal((await f.request('GET','/me/tasks?projectId=prj','member')).status,404);
});

test('My Tasks: shared project receives its workspace calendar date and timezone changes stale the cursor',async t=>{
  const f=await fixture(t);const first=await f.request('GET','/me/tasks?projectId=prj&limit=2','member');const cursor=(await first.json()as any).nextCursor;
  await f.pool.query("UPDATE workspaces SET timezone='Pacific/Kiritimati' WHERE id='ws'");
  const expected=(await f.pool.query("SELECT (NOW() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS day")).rows[0].day;
  const fresh=await f.request('GET','/me/tasks?projectId=prj','member');const data=await fresh.json()as any;
  assert.equal(data.asOfDate,expected);assert.equal(data.timezone,'Pacific/Kiritimati');
  assert.equal((await f.request('GET','/me/tasks?projectId=prj&limit=2&cursor='+encodeURIComponent(cursor),'member')).status,409);
});

test('My Tasks: query count stays constant when returned cards span more granted boards',async t=>{
  const f=await fixture(t);
  const measure=async()=>{
    const original=f.pool.query;let queries=0;
    f.pool.query=((...args:any[])=>{queries++;return (original as any).apply(f.pool,args);})as any;
    try{const result=await getMyTasks(f.pool,f.actors.member!.user.id,{projectId:'prj',limit:100});return{queries,cards:result.data.length};}
    finally{f.pool.query=original;}
  };
  const one=await measure();
  for(const id of ['second','third']){
    await f.pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)VALUES($1,'ws','prj',$1,NOW(),NOW())`,[id]);
    await f.pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)VALUES($1,'ws','prj',$2,$1,'#64748b','todo',0,NOW(),NOW())`,['col_'+id,id]);
    await f.pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)VALUES($1,'ws','prj',$2,$3,$1,'high',1000,'active',NOW(),NOW())`,['card_'+id,id,'col_'+id]);
    await f.pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES($1,'prj','ws',$2,$3)`,[id,f.actors.member!.user.id,f.actors.owner!.user.id]);
    await f.pool.query(`INSERT INTO card_assignees(card_id,user_id,workspace_id,project_id,created_at)VALUES($1,$2,'ws','prj',NOW())`,['card_'+id,f.actors.member!.user.id]);
  }
  const many=await measure();console.log(JSON.stringify({myTasksQueryCounts:{oneBoard:one.queries,threeBoards:many.queries}}));
  assert.equal(one.cards,9);assert.equal(many.cards,11);assert.equal(many.queries,one.queries,'Board authorization rechecks must be one bounded batch, not one query per board');
});

test('Workspace calendar: invalid timezone is422 with no version/state change; valid owner update preserves date-only deadlines',async t=>{
  const f=await fixture(t);const initial=(await f.pool.query("SELECT name,timezone,version FROM workspaces WHERE id='ws'")).rows[0];
  for(const timezone of ['Definitely/Not_A_Zone','Mars/Olympus','2026-11-03']){
    const r=await f.request('PATCH','/workspaces/ws','owner',{timezone,expectedVersion:initial.version});assert.equal(r.status,422,await r.clone().text());
    assert.deepEqual((await f.pool.query("SELECT name,timezone,version FROM workspaces WHERE id='ws'")).rows[0],initial);
  }
  assert.equal((await f.request('PATCH','/workspaces/ws','member',{timezone:'Asia/Kolkata',expectedVersion:initial.version})).status,403);
  const before=(await f.pool.query('SELECT id,due_date::text AS due FROM cards ORDER BY id')).rows;
  assert.equal((await f.request('PATCH','/workspaces/ws','owner',{timezone:'Asia/Kolkata',expectedVersion:initial.version})).status,200);
  assert.deepEqual((await f.pool.query('SELECT id,due_date::text AS due FROM cards ORDER BY id')).rows,before);
  assert.equal((await f.request('PATCH','/workspaces/ws','owner',{timezone:'UTC',expectedVersion:initial.version})).status,409);
});

test('Workspace calendar: invalid legacy timezone fails safely without silently substituting UTC',async t=>{
  const f=await fixture(t);await f.pool.query("UPDATE workspaces SET timezone='Definitely/Not_A_Zone' WHERE id='ws'");
  const r=await f.request('GET','/me/tasks?projectId=prj','member');assert.equal(r.status,503);
  const body=await r.json()as any;assert.equal(body.error.code,'CONFIG_ERROR');assert.equal(body.data,undefined);assert.equal(JSON.stringify(body).includes('Definitely'),false);
});
