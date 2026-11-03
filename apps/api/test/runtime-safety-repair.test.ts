import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test,{type TestContext} from 'node:test';
import pg from 'pg';
import {createApp} from '../src/http/app.ts';
import {runMigrations} from '../src/adapters/migrations.ts';
import {createDevUserAndSession} from '../src/adapters/session.ts';
import {DEFAULT_LIMITS} from '../src/services/limits.ts';
import {processOutboxLease} from '../src/adapters/notifications.ts';
const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];
const safety=(name:string,fn:(t:TestContext)=>Promise<void>)=>test(name,{skip:!uri&&'Set isolated identity-extra PostgreSQL URL'},fn);
const sentinel='synthetic_private_sql_sentinel postgres://private_user:private_password@private_host/db SELECT private_column';
async function fixture(t:TestContext){
  const u=new URL(uri!);assert.equal(u.hostname,'127.0.0.1');assert.ok(['postgres:','postgresql:'].includes(u.protocol));assert.ok(u.port&&!['55432','55479'].includes(u.port));assert.equal(u.username,'flowboard_harness');assert.equal(u.search,'');assert.equal(u.pathname,'/flowboard_identity_extra_test');
  const schema='runtime_safety_'+crypto.randomUUID().replaceAll('-','');const admin=new pg.Pool({connectionString:uri,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:uri,max:8,application_name:schema,options:`-c search_path=${schema}`});
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});await runMigrations(pool);
  const owner=await createDevUserAndSession('safety.owner@flowboard.example','Safety Owner',pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)VALUES('ws','Safety','UTC',$1,NOW(),NOW())`,[owner.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)VALUES('prj','ws','Safety',NOW(),NOW())`);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)VALUES('brd','ws','prj','Safety',NOW(),NOW())`);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)VALUES('col','ws','prj','brd','Todo','#64748b','todo',0,NOW(),NOW())`);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)VALUES('card','ws','prj','brd','col','Safety','medium',1000,'active',NOW(),NOW())`);
  await pool.query(`INSERT INTO users(id,email,display_name,created_at,updated_at)SELECT 'eligible_'||g,'eligible.'||g||'@flowboard.example',CASE WHEN g=150 THEN 'ZZ Selected' ELSE 'Person '||lpad(g::text,3,'0')END,NOW(),NOW()FROM generate_series(1,150)g`);
  await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)SELECT 'pm_'||g,'prj','ws','eligible_'||g,'member','active',NOW(),NOW()FROM generate_series(1,150)g`);
  await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)SELECT 'brd','prj','ws','eligible_'||g,$1 FROM generate_series(1,150)g`,[owner.user.id]);
  const app=createApp(async()=>{},{pool,limits:{...DEFAULT_LIMITS,membersPerProject:200},rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const req=(path:string,method='GET',body?:unknown)=>app.request('http://localhost/api/v1'+path,{method,headers:{cookie:`flowboard_session=${owner.session.id}`,origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const post=()=>req('/cards/card/comments','POST',{body:'Hello @ZZ Selected',mentions:[{userId:'eligible_150',start:6,end:18}]});
  const remove=()=>req('/projects/prj/members/eligible_150','DELETE');
  return{pool,schema,app,req,post,remove};
}
async function waitBlocked(pool:pg.Pool,schema:string){for(let i=0;i<200;i++){if((await pool.query('SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0',[schema])).rows.length)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Expected actual distinct PostgreSQL connection blocked on protected row');}
function pauseQuery(pool:pg.Pool,predicate:(text:string)=>boolean){
  const connect=pool.connect.bind(pool);let entered!:()=>void,release!:()=>void;const at=new Promise<void>(r=>{entered=r;}),released=new Promise<void>(r=>{release=r;});let armed=true;
  pool.connect=((...args:any[])=>{if(typeof args[0]==='function')return(connect as any)(...args);return(async()=>{const client=await(connect as any)(...args),query=client.query.bind(client),giveBack=client.release.bind(client);client.query=async(...q:any[])=>{if(armed&&predicate(String(q[0]))){armed=false;entered();await released;}return query(...q);};client.release=(...args:any[])=>{client.query=query;return giveBack(...args);};return client;})();})as any;
  return{at:Promise.race([at,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Expected protected query barrier')),2500))]),release:()=>{release();pool.connect=connect;}};
}
safety('runtime safety: searchable eligible mention beyond100 is accepted, inaccessible identities remain private',async(t)=>{
  const f=await fixture(t);const picker=await f.req('/projects/prj/people?boardId=brd&purpose=mention&query=ZZ%20Selected');assert.equal(picker.status,200);assert.equal((await picker.json()as any).data[0].id,'eligible_150');
  const r=await f.post();assert.equal(r.status,201,await r.clone().text());assert.equal(Number((await f.pool.query('SELECT COUNT(*)FROM notifications')).rows[0].count),1);
});
safety('runtime safety: committed target revocation wins before comment board lock and cannot notify',async(t)=>{
  const f=await fixture(t),barrier=pauseQuery(f.pool,text=>text.includes('FOR UPDATE OF b'));const pending=Promise.resolve(f.post());
  try{await barrier.at;assert.equal((await f.remove()).status,200);}finally{barrier.release();}
  const r=await pending;assert.equal(r.status,422,await r.clone().text());assert.equal(Number((await f.pool.query('SELECT COUNT(*)FROM comments')).rows[0].count),0);assert.equal(Number((await f.pool.query('SELECT COUNT(*)FROM notifications')).rows[0].count),0);
});
safety('runtime safety: comment winning board lock commits before removal; delayed consumer cannot renotify removed target',async(t)=>{
  const f=await fixture(t),barrier=pauseQuery(f.pool,text=>text.includes('FROM idempotency_receipts'));const pending=Promise.resolve(f.post());let removal:Promise<Response>|undefined;
  try{await barrier.at;removal=Promise.resolve(f.remove());await waitBlocked(f.pool,f.schema);}finally{barrier.release();}
  assert.equal((await pending).status,201);assert.equal((await removal!).status,200);
  await f.pool.query('DELETE FROM notifications');await processOutboxLease(f.pool);
  assert.equal(Number((await f.pool.query('SELECT COUNT(*)FROM notifications')).rows[0].count),0);assert.equal((await f.pool.query("SELECT status FROM project_memberships WHERE user_id='eligible_150'")).rows[0].status,'removed');
});
safety('runtime safety: admin migration exception masks internal details and unauthorized calls remain403',async(t)=>{
  const f=await fixture(t);assert.equal((await f.req('/system/migrate','POST')).status,403);
  const connect=f.pool.connect.bind(f.pool);f.pool.connect=(async()=>{throw new Error(sentinel);})as any;let response:Response;
  try{response=await f.app.request('http://localhost/api/v1/system/migrate',{method:'POST',headers:{'x-dev-secret':'flowboard-dev-secret'}});}finally{f.pool.connect=connect;}
  assert.equal(response.status,500);const text=await response.text();assert.doesNotMatch(text,/synthetic_private_sql_sentinel|private_password|private_host|SELECT private_column/);assert.equal(JSON.parse(text).error.code,'MIGRATION_FAILED');assert.equal(JSON.parse(text).error.requestId,response.headers.get('x-request-id'));
});
safety('runtime safety: unexpected library503/504 error messages/details are masked',async(t)=>{
  const f=await fixture(t);
  for(const status of [503,504])f.app.get('/__runtime_library_'+status,()=>{throw Object.assign(new Error(sentinel),{status,code:sentinel,details:{internal:sentinel}});});
  for(const status of [503,504]){const r=await f.app.request('http://localhost/__runtime_library_'+status);assert.equal(r.status,status);const text=await r.text();assert.doesNotMatch(text,/synthetic_private_sql_sentinel|private_password|private_host|SELECT private_column/);assert.equal(JSON.parse(text).error.details,undefined);}
});
safety('runtime safety: selected lookup is independent of page window and refuses grantless/removed targets',async(t)=>{
  const f=await fixture(t);const {getEligibleMentionees}=await import('../src/adapters/rbac.ts');
  const ids=Array.from({length:20},(_,i)=>'eligible_'+(131+i));const selected=await getEligibleMentionees(f.pool,'prj',undefined,'brd',ids);assert.equal(selected.length,20);assert.ok(selected.some(p=>p.id==='eligible_150'));assert.ok(selected.every(p=>!Object.hasOwn(p,'email')));
  await f.pool.query("DELETE FROM board_grants WHERE user_id='eligible_150'");const noGrant=await f.post();assert.equal(noGrant.status,422);
  await f.pool.query("UPDATE project_memberships SET status='removed' WHERE user_id='eligible_150'");const removed=await f.post();assert.equal(removed.status,422);const b1=await noGrant.json()as any,b2=await removed.json()as any;delete b1.error.requestId;delete b2.error.requestId;assert.deepEqual(b1,b2);
});
