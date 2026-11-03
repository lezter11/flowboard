import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';

const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];
const policyTest=(name:string,fn:(t:TestContext)=>Promise<void>)=>test(name,{skip:!uri&&'Set isolated identity-extra database for People policy tests.'},fn);
async function fixture(t:TestContext){
  const target=new URL(uri!);assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname));assert.equal(target.pathname,'/flowboard_identity_extra_test');
  const schema=`people_policy_${crypto.randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool({connectionString:uri,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:uri,max:8,application_name:schema,options:`-c search_path=${schema}`});
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
  await runMigrations(pool);
  const actors:Record<string,Awaited<ReturnType<typeof createDevUserAndSession>>>={};
  for(const name of ['owner','manager','member','viewer','outsider'])actors[name]=await createDevUserAndSession(`policy.${name}@flowboard.example`,`Synthetic ${name}`,pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)VALUES('ws_policy','Policy','UTC',$1,NOW(),NOW()),('ws_foreign','Other','UTC',$2,NOW(),NOW())`,[actors.owner!.user.id,actors.outsider!.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)VALUES('project_policy','ws_policy','Policy',NOW(),NOW()),('project_foreign','ws_foreign','Other',NOW(),NOW())`);
  for(const role of ['manager','member','viewer'])await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)VALUES($1,'project_policy','ws_policy',$2,$3,'active',1,NOW(),NOW())`,[`pm_${role}`,actors[role]!.user.id,role]);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)VALUES('board_policy','ws_policy','project_policy','Board',NOW(),NOW())`);
  for(const role of ['manager','member','viewer'])await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES('board_policy','project_policy','ws_policy',$1,$2)`,[actors[role]!.user.id,actors.owner!.user.id]);
  const app=createApp(async()=>{},{pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const request=(actor:string,path='/projects/project_policy/members',method='GET',body?:unknown)=>app.request(`http://localhost/api/v1${path}`,{method,headers:{Cookie:`flowboard_session=${actors[actor]!.session.id}`,Origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{pool,schema,actors,request};
}
async function waitBlocked(pool:pg.Pool,schema:string){
  for(let i=0;i<200;i++){const result=await pool.query(`SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0`,[schema]);if(result.rows.length)return;await new Promise(r=>setTimeout(r,10));}
  assert.fail('Expected a distinct PostgreSQL connection blocked by the authorization read/write lock');
}
policyTest('People policy: only inherited Owner/current Manager read emails; Member/Viewer deny without directory data',async(t)=>{
  const f=await fixture(t);
  for(const role of ['owner','manager']){const r=await f.request(role);assert.equal(r.status,200);assert.ok((await r.json()as any).data.some((p:any)=>p.email==='policy.owner@flowboard.example'));}
  for(const role of ['member','viewer']){const r=await f.request(role);assert.equal(r.status,403);const b=await r.json()as any;assert.equal(b.data,undefined);assert.equal(JSON.stringify(b).includes('@flowboard.example'),false);}
  assert.equal((await f.request('outsider')).status,404);
  const {getProjectMembers}=await import('../src/adapters/projects.ts');
  await assert.rejects(getProjectMembers(f.pool,f.actors.member!.user,'project_policy'),(error:any)=>error.code==='FORBIDDEN');
  await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.manager!.user.id]);
  assert.equal((await f.request('manager')).status,200,'Project Manager directory administration does not require a board grant');
  await f.pool.query("UPDATE projects SET archived=TRUE WHERE id='project_policy'");
  assert.equal((await f.request('owner')).status,200);assert.equal((await f.request('manager')).status,200);
});
policyTest('People policy: Member/Viewer board-scoped pickers remain available and contain no emails',async(t)=>{
  const f=await fixture(t);
  for(const actor of ['member','viewer'])for(const purpose of ['assignee','mention']){
    const r=await f.request(actor,`/projects/project_policy/people?boardId=board_policy&purpose=${purpose}`);assert.equal(r.status,200,`${actor}/${purpose}`);
    const b=await r.json()as any;assert.ok(b.data.length>0);assert.ok(b.data.every((p:any)=>!Object.hasOwn(p,'email')));
  }
});
policyTest('People policy: default/display aliases never expose the project roster to Member/Viewer',async(t)=>{
  const f=await fixture(t);
  for(const granted of [true,false]){
    if(!granted)await f.pool.query('DELETE FROM board_grants');
    for(const actor of ['member','viewer'])for(const query of ['', '?purpose=display', '?purpose=display&query=Synthetic&limit=1', `?purpose=display&cursor=${f.actors.owner!.user.id}`, '?boardId=board_policy', '?purpose=display&boardId=board_policy']){
      const response=await f.request(actor,`/projects/project_policy/people${query}`);
      assert.equal(response.status,403,`${actor}/${granted}/${query}: ${response.status}`);
      const body=await response.json();assert.equal((body as any).data,undefined);
      for(const person of Object.values(f.actors)){assert.equal(JSON.stringify(body).includes(person.user.id),false);assert.equal(JSON.stringify(body).includes(person.user.displayName),false);}
    }
  }
  assert.equal((await f.request('outsider','/projects/project_policy/people')).status,404);
  await f.pool.query("UPDATE project_memberships SET status='removed' WHERE id='pm_member'");
  assert.equal((await f.request('member','/projects/project_policy/people?purpose=display')).status,404);
});
policyTest('People policy: display administrators retain search/page/archive reads without a board grant',async(t)=>{
  const f=await fixture(t);
  await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.manager!.user.id]);
  for(const archived of [false,true]){
    await f.pool.query("UPDATE projects SET archived=$1 WHERE id='project_policy'",[archived]);
    for(const actor of ['owner','manager']){
      const response=await f.request(actor,'/projects/project_policy/people?purpose=display&query=Synthetic&limit=1');assert.equal(response.status,200);
      const body=await response.json()as any;assert.equal(body.data.length,1);assert.ok(body.nextCursor);assert.ok(body.data.every((p:any)=>!Object.hasOwn(p,'email')));
      const next=await f.request(actor,`/projects/project_policy/people?cursor=${body.nextCursor}&limit=1`);assert.equal(next.status,200);assert.notEqual((await next.json()as any).data[0].id,body.data[0].id);
    }
  }
});
policyTest('People policy: direct display adapter requires a current directory administrator',async(t)=>{
  const f=await fixture(t),{getProjectPeople}=await import('../src/adapters/rbac.ts');
  await assert.rejects(getProjectPeople(f.pool,'project_policy'),(error:any)=>error.code==='UNAUTHORIZED');
  for(const actor of ['member','viewer'])await assert.rejects(getProjectPeople(f.pool,'project_policy','display',undefined,undefined,50,undefined,f.actors[actor]!.user.id),(error:any)=>error.code==='FORBIDDEN');
  await assert.rejects(getProjectPeople(f.pool,'project_policy','display',undefined,undefined,50,undefined,f.actors.outsider!.user.id),(error:any)=>error.code==='NOT_FOUND');
  for(const actor of ['owner','manager'])assert.equal((await getProjectPeople(f.pool,'project_policy','display',undefined,undefined,50,undefined,f.actors[actor]!.user.id)).data.length,4);
});
policyTest('People policy: default/display read waits for demotion and denies the newly demoted Manager',async(t)=>{
  const f=await fixture(t),blocker=await f.pool.connect();await blocker.query('BEGIN');
  await blocker.query("UPDATE project_memberships SET role='viewer',version=version+1 WHERE id='pm_manager'");
  const read=f.request('manager','/projects/project_policy/people?purpose=display');
  try{await waitBlocked(f.pool,f.schema);}finally{await blocker.query('COMMIT');blocker.release();}
  const response=await read;assert.equal(response.status,403);assert.equal((await response.json()as any).data,undefined);
});
policyTest('People policy: display assembly finishes before a concurrent Manager demotion',async(t)=>{
  const f=await fixture(t),connect=f.pool.connect.bind(f.pool);
  let entered!:()=>void,release!:()=>void;const atRead=new Promise<void>(r=>{entered=r;}),released=new Promise<void>(r=>{release=r;});let armed=true;
  f.pool.connect=((...args:any[])=>{if(typeof args[0]==='function')return(connect as any)(...args);return(async()=>{const client=await(connect as any)(...args),query=client.query.bind(client),giveBack=client.release.bind(client);
    client.query=async(...qs:any[])=>{if(armed&&String(qs[0]).includes('WITH project_context')){armed=false;entered();await released;}return query(...qs);};
    client.release=(...args:any[])=>{client.query=query;return giveBack(...args);};return client;})();})as any;
  const read=f.request('manager','/projects/project_policy/people');let demote:Promise<Response>|undefined;
  try{await Promise.race([atRead,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Display did not reach protected data query')),2000))]);
    demote=Promise.resolve(f.request('owner',`/projects/project_policy/members/${f.actors.manager!.user.id}`,'PATCH',{role:'viewer',status:'active',expectedVersion:1}));
    await waitBlocked(f.pool,f.schema);
  }finally{release();f.pool.connect=connect;}
  assert.equal((await read).status,200);assert.equal((await demote!).status,200);assert.equal((await f.request('manager','/projects/project_policy/people')).status,403);
});
policyTest('People policy: demotion winning membership lock prevents an in-flight directory disclosure',async(t)=>{
  const f=await fixture(t),blocker=await f.pool.connect();await blocker.query('BEGIN');
  await blocker.query("UPDATE project_memberships SET role='viewer',version=version+1 WHERE id='pm_manager'");
  const read=f.request('manager');
  try{await waitBlocked(f.pool,f.schema);}finally{await blocker.query('COMMIT');blocker.release();}
  const response=await read;assert.equal(response.status,403);const b=await response.json()as any;assert.equal(b.data,undefined);assert.equal(JSON.stringify(b).includes('policy.owner@'),false);
});
policyTest('People policy: authorized directory assembly serializes before concurrent Manager demotion',async(t)=>{
  const f=await fixture(t);
  const connect=f.pool.connect.bind(f.pool);let entered!:()=>void,release!:()=>void;
  const atRead=new Promise<void>(r=>{entered=r;}),released=new Promise<void>(r=>{release=r;});let armed=true;
  f.pool.connect=((...args:any[])=>{if(typeof args[0]==='function')return(connect as any)(...args);return(async()=>{const client=await(connect as any)(...args),query=client.query.bind(client),giveBack=client.release.bind(client);
    client.query=async(...qs:any[])=>{if(armed&&String(qs[0]).includes('pm.id AS membership_id')){armed=false;entered();await released;}return query(...qs);};
    client.release=(...args:any[])=>{client.query=query;return giveBack(...args);};return client;})();})as any;
  const read=f.request('manager');let demote:Promise<Response>|undefined;
  try{await Promise.race([atRead,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Directory did not reach protected data query')),2000))]);
    demote=Promise.resolve(f.request('owner',`/projects/project_policy/members/${f.actors.manager!.user.id}`,'PATCH',{role:'viewer',status:'active',expectedVersion:1}));
    await waitBlocked(f.pool,f.schema);
  }finally{release();f.pool.connect=connect;}
  assert.equal((await read).status,200);assert.equal((await demote!).status,200);assert.equal((await f.request('manager')).status,403);
});
