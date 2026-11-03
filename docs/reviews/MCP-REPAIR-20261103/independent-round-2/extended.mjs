import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { createPersonalAccessToken } from '../../../../apps/api/src/adapters/tokens.ts';
import { PERSONAL_ACCESS_TOKEN_ROUTES } from '../../../../apps/api/src/http/middleware/token-policy.ts';

const url=process.env.FLOWBOARD_MCP_TEST_DATABASE_URL;
assert.equal(new URL(url).host,'127.0.0.1:55923');
assert.equal(new URL(url).pathname,'/flowboard_mcp_probe');
const pool=new pg.Pool({connectionString:url,max:12,application_name:'independent-round2-extended'});
const s=crypto.randomUUID().replaceAll('-',''), owner=`r2o_${s}`, manager=`r2m_${s}`, w=`r2w_${s}`, p=`r2p_${s}`, b=`r2b_${s}`, col=`r2c_${s}`;
const results=[];
const app=createApp(async()=>{}, {pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
let token;
const req=async(method,path,body,key=crypto.randomUUID())=>{
 const r=await app.request(`http://localhost${path}`,{method,headers:{authorization:`Bearer ${token.token}`,'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,body:await r.json()};
};
const run=async(name,fn)=>{try{results.push({name,status:'pass',details:await fn()});console.log(`PASS ${name}`);}catch(e){results.push({name,status:'fail',errorType:e.name});console.log(`FAIL ${name} (${e.name})`);}};
try{
 for(const u of [owner,manager]) await pool.query("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES($1,$2,'Independent synthetic person',now(),now())",[u,`${u}@example.invalid`]);
 await pool.query("INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,'Independent workspace','UTC',$2,now(),now())",[w,owner]);
 await pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$2,'Independent project',now(),now())",[p,w]);
 await pool.query("INSERT INTO boards(id,workspace_id,project_id,name,description,created_at,updated_at) VALUES($1,$2,$3,'Independent board','ROUND2-DESCRIPTION-SENTINEL',now(),now())",[b,w,p]);
 await pool.query("INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES($1,$2,$3,$4,'Todo','#64748b','todo',0,now(),now())",[col,w,p,b]);
 await pool.query("INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES($1,$2,$3,$4,'manager','active',now(),now())",[`r2pm_${s}`,p,w,manager]);
 await pool.query('INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES($1,$2,$3,$4,$5)',[b,p,w,manager,owner]);
 token=await createPersonalAccessToken(pool,{userId:manager,name:'Independent manager',scopes:['projects:read','boards:read','cards:read','cards:create'],projectId:p});
 await run('independent inventory denies every mounted non-capability operation',async()=>{
  const routes=[...new Map(app.routes.filter(r=>!['ALL','OPTIONS'].includes(r.method)).map(r=>[`${r.method} ${r.path}`,r])).values()];
  const registered=new Set(routes.map(r=>`${r.method} ${r.path}`));
  for(const allow of PERSONAL_ACCESS_TOKEN_ROUTES) assert.ok(registered.has(`${allow.method} ${allow.path}`));
  let denied=0;
  for(const r of routes){
   if(PERSONAL_ACCESS_TOKEN_ROUTES.some(a=>a.method===r.method&&a.path===r.path))continue;
   const out=await req(r.method,r.path.replace(/:[A-Za-z]+/g,'r2_target'),['POST','PUT','PATCH','DELETE'].includes(r.method)?{}:undefined);
   assert.equal(out.status,403);assert.equal(out.body.data,undefined);denied++;
  }
  assert.ok(denied>=80);return {mounted:routes.length,denied,allowed:PERSONAL_ACCESS_TOKEN_ROUTES.length};
 });
 const key=crypto.randomUUID();
 const body={title:'  Independent normalized create  ',columnId:col,expectedBoardVersion:1};
 let original;
 await run('manager create and normalized default/revision replay share one effect',async()=>{
  original=await req('POST',`/api/v1/boards/${b}/cards`,body,key);assert.equal(original.status,201);
  const replay=await req('POST',`/api/v1/boards/${b}/cards`,{...body,title:body.title.trim(),description:'',priority:'none',dueDate:null,assigneeIds:[],expectedBoardVersion:98765},key);
  assert.equal(replay.status,201);assert.equal(replay.body.replayed,true);assert.equal(replay.body.data.id,original.body.data.id);
  const counts=await pool.query('SELECT count(*)::int n FROM cards WHERE board_id=$1',[b]);assert.equal(counts.rows[0].n,1);
  return {initial:original.status,replay:replay.status,effects:1};
 });
 await run('current manager demotion to viewer denies receipt replay and fresh write',async()=>{
  await pool.query("UPDATE project_memberships SET role='viewer' WHERE user_id=$1 AND project_id=$2",[manager,p]);
  const replay=await req('POST',`/api/v1/boards/${b}/cards`,body,key);assert.equal(replay.status,403);assert.equal(replay.body.data,undefined);
  const fresh=await req('POST',`/api/v1/boards/${b}/cards`,body);assert.equal(fresh.status,403);
  assert.equal((await req('GET',`/api/v1/boards/${b}/metadata`)).status,200);
  return {replay:replay.status,fresh:fresh.status,metadata:200};
 });
 await run('encoded separators, appended paths and wrong methods do not widen capabilities',async()=>{
  for(const path of [`/api/v1/boards/${b}%2fmetadata/metadata`,`/api/v1/boards/${b}%5ccards/metadata`,`/api/v1/boards/${b}/metadata/extra`,`/api/v1/projects/${p}%00/boards`])assert.equal((await req('GET',path)).status,403);
  assert.equal((await req('PATCH',`/api/v1/cards/${original.body.data.id}`,{})).status,403);
  return {malformedDenied:4,mutationDenied:1};
 });
}finally{
 await pool.end();await fs.writeFile(new URL('./extended-results.json',import.meta.url),JSON.stringify({results},null,2)+'\n');
}
process.exitCode=results.some(r=>r.status==='fail')?1:0;
