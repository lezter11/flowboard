import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import {createApp} from '../src/http/app.ts';
import {runMigrations} from '../src/adapters/migrations.ts';
import {createDevUserAndSession} from '../src/adapters/session.ts';
const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];
const mounted=(name:string,fn:(t:TestContext)=>Promise<void>)=>test(name,{skip:!uri&&'Set isolated identity-extra PostgreSQL URL'},fn);
async function fixture(t:TestContext){
  const url=new URL(uri!);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/flowboard_identity_extra_test');
  const schema='discussion_activity_'+crypto.randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:uri,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:uri,max:8,options:`-c search_path=${schema}`});
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});await runMigrations(pool);
  const actors:Record<string,Awaited<ReturnType<typeof createDevUserAndSession>>>={};
  for(const [role,name] of [['owner','Owner'],['member','Ada 🚀'],['viewer','Viewer'],['outsider','Outsider']])actors[role!]=await createDevUserAndSession(`discussion.${role}@flowboard.example`,name!,pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('ws','Discussion','UTC',$1,NOW(),NOW());`,[actors.owner!.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('prj','ws','Discussion',NOW(),NOW());`);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES('brd','ws','prj','Board',NOW(),NOW());`);
  for(const role of ['member','viewer']){
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES($1,'prj','ws',$2,$3,'active',NOW(),NOW())`,['pm_'+role,actors[role]!.user.id,role]);
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES('brd','prj','ws',$1,$2)`,[actors[role]!.user.id,actors.owner!.user.id]);
  }
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES('col','ws','prj','brd','Todo','#64748b','todo',0,NOW(),NOW());`);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES('card','ws','prj','brd','col','Discussion','medium',1000,'active',NOW(),NOW());`);
  const app=createApp(async()=>{},{pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const req=(path:string,method='GET',body?:unknown,role='owner')=>app.request('http://localhost/api/v1'+path,{method,headers:{cookie:`flowboard_session=${actors[role]!.session.id}`,origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const post=(body:string,start:number,end:number,userId=actors.member!.user.id)=>req('/cards/card/comments','POST',{body,mentions:[{userId,start,end}]});
  return{pool,actors,req,post};
}
mounted('COM03 rejects arbitrary text, partial tokens and surrogate splits atomically',async(t)=>{
  const f=await fixture(t);
  for(const [body,start,end] of [['hello there',0,5],['@Ada 🚀',0,6],['@Ada 🚀extra',0,7],['x@Ada 🚀',1,8]] as const){
    const r=await f.post(body,start,end);assert.equal(r.status,422,`${JSON.stringify([body,start,end])}: ${await r.clone().text()}`);
  }
  for(const table of ['comments','comment_mentions','notifications','activity_log','outbox','idempotency_receipts'])assert.equal(Number((await f.pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count),0,table);
});
mounted('COM03 selected UTF16 tokens, case, trim and historical renamed edits remain valid without renotifying',async(t)=>{
  const f=await fixture(t);
  const raw='  😀 @aDA 🚀  ',start=raw.indexOf('@');const r=await f.post(raw,start,start+'@aDA 🚀'.length);assert.equal(r.status,201,await r.clone().text());const c=(await r.json()as any).data;
  assert.equal(c.body,'😀 @aDA 🚀');assert.deepEqual(c.mentions,[{userId:f.actors.member!.user.id,start:3,end:10}]);
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) FROM notifications')).rows[0].count),1);
  await f.pool.query('UPDATE users SET display_name=$1 WHERE id=$2',['Renamed Person',f.actors.member!.user.id]);
  const editBody='Updated 😀 @aDA 🚀';const edit=await f.req('/comments/'+c.id,'PATCH',{body:editBody,mentions:[{userId:f.actors.member!.user.id,start:11,end:18}],expectedVersion:1});assert.equal(edit.status,200,await edit.clone().text());
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) FROM notifications')).rows[0].count),1);
  const invented=await f.post('@Ada 🚀',0,7);assert.equal(invented.status,422);
});
mounted('COM03 unknown and ungranted targets have same private failure and Viewer cannot write',async(t)=>{
  const f=await fixture(t);const failures=[];
  for(const userId of ['missing-user',f.actors.outsider!.user.id]){const r=await f.post('@Outsider',0,9,userId);assert.equal(r.status,422);const failure=await r.json()as any;delete failure.error.requestId;failures.push(failure);}
  assert.deepEqual(failures[0],failures[1]);assert.equal(JSON.stringify(failures).includes('@flowboard.example'),false);
  assert.equal((await f.req('/cards/card/comments','POST',{body:'Plain'},'viewer')).status,403);
});
mounted('AUD03/04 reject invalid dates, reversed ranges and malformed bounds as controlled422',async(t)=>{
  const f=await fixture(t);
  for(const scope of ['/projects/prj/activity','/workspaces/ws/activity'])for(const query of ['fromDate=garbage','fromDate=2026-02-30','toDate=2026-13-01','fromDate=2026-01-02&toDate=2026-01-01','fromDate=2026-01-01T25%3A00%3A00Z','limit=1x','limit=101','limit=0']){
    const r=await f.req(scope+'?'+query);assert.equal(r.status,422,scope+'?'+query+': '+await r.clone().text());
  }
});
mounted('AUD03/04 valid date filters precede pagination and cursors bind the filter',async(t)=>{
  const f=await fixture(t);
  for(const [id,date,action] of [['outside','2024-02-28T10:00:00Z','card_created'],['a','2024-02-29T10:00:00Z','card_updated'],['b','2024-02-29T11:00:00Z','card_updated'],['wrong_action','2024-02-29T12:00:00Z','card_created'],['after','2024-03-01T01:00:00Z','card_updated']])await f.pool.query(`INSERT INTO activity_log(id,workspace_id,project_id,board_id,card_id,actor_id,action,safe_changes,created_at,visibility_scope) VALUES($1,'ws','prj','brd','card',$2,$3,'{}',$4,'board')`,[id,f.actors.owner!.user.id,action,date]);
  for(const scope of ['/projects/prj/activity','/workspaces/ws/activity']){
    const query='?limit=1&fromDate=2024-02-29&toDate=2024-02-29T23%3A59%3A59Z&action=card_updated';
    const first=await f.req(scope+query);assert.equal(first.status,200,await first.clone().text());const b=await first.json()as any;assert.deepEqual(b.data.map((x:any)=>x.id),['b']);assert.ok(b.nextCursor);
    const second=await f.req(scope+query+'&cursor='+encodeURIComponent(b.nextCursor));assert.equal(second.status,200);const b2=await second.json()as any;assert.deepEqual(b2.data.map((x:any)=>x.id),['a']);assert.equal(b2.nextCursor,null);
    const changed=await f.req(scope+query.replace('card_updated','card_created')+'&cursor='+encodeURIComponent(b.nextCursor));assert.equal(changed.status,409);
  }
});
mounted('COM03 duplicate-name suffix is part of selection and edited invalid spans roll back',async(t)=>{
  const f=await fixture(t);
  const duplicate=await createDevUserAndSession('discussion.duplicate@flowboard.example','Ada 🚀',f.pool);
  await f.pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES('pm_duplicate','prj','ws',$1,'member','active',NOW(),NOW())`,[duplicate.user.id]);
  await f.pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES('brd','prj','ws',$1,$2)`,[duplicate.user.id,f.actors.owner!.user.id]);
  const people=await(await f.req('/projects/prj/people?boardId=brd&purpose=mention')).json()as any;
  const selected=people.data.find((p:any)=>p.id===duplicate.user.id);const token='@'+selected.displayName+(selected.nameSuffix>1?` (${selected.nameSuffix})`:'');
  const created=await f.post(token,0,token.length,duplicate.user.id);assert.equal(created.status,201,await created.clone().text());const c=(await created.json()as any).data;
  const before=await f.pool.query('SELECT version,body FROM comments WHERE id=$1',[c.id]);
  const bad=await f.req('/comments/'+c.id,'PATCH',{body:'arbitrary',mentions:[{userId:duplicate.user.id,start:0,end:9}],expectedVersion:1});assert.equal(bad.status,422);
  assert.deepEqual((await f.pool.query('SELECT version,body FROM comments WHERE id=$1',[c.id])).rows,before.rows);
  assert.equal(Number((await f.pool.query('SELECT COUNT(*) FROM notifications')).rows[0].count),1);
  if(selected.nameSuffix>1)assert.equal((await f.post('@'+selected.displayName,0,('@'+selected.displayName).length,duplicate.user.id)).status,422);
});
