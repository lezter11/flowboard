import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { createPersonalAccessToken } from '../../../../apps/api/src/adapters/tokens.ts';
import { FlowboardClient } from '../../../../packages/mcp/src/client.ts';

const url=process.env.FLOWBOARD_MCP_TEST_DATABASE_URL;
assert.equal(new URL(url).host,'127.0.0.1:55923');
assert.equal(new URL(url).pathname,'/flowboard_mcp_probe');
const pool=new pg.Pool({connectionString:url,max:12,application_name:'independent-mcp-adversarial'});
const s=crypto.randomUUID().replaceAll('-',''), u=`ind_u_${s}`, w=`ind_w_${s}`, p=`ind_p_${s}`, b=`ind_b_${s}`, col=`ind_c_${s}`;
const results=[];
const app=createApp(async()=>{}, {pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
let token;
const request=async(method,path,body,key=crypto.randomUUID())=>{
 const r=await app.request(`http://localhost${path}`,{method,headers:{authorization:`Bearer ${token.token}`,'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,body:await r.json()};
};
const run=async(name,fn)=>{try{const details=await fn();results.push({name,status:'pass',details});console.log(`PASS ${name}`);}catch(e){results.push({name,status:'fail',errorType:e.name});console.log(`FAIL ${name} (${e.name})`);}};
try{
 await pool.query("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES($1,$2,'Independent synthetic owner',now(),now())",[u,`${u}@example.invalid`]);
 await pool.query("INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,'Independent workspace','UTC',$2,now(),now())",[w,u]);
 await pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$2,'Independent project',now(),now())",[p,w]);
 await pool.query("INSERT INTO boards(id,workspace_id,project_id,name,description,created_at,updated_at) VALUES($1,$2,$3,'Independent board','INDEPENDENT-SYNTHETIC-DESCRIPTION',now(),now())",[b,w,p]);
 await pool.query("INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES($1,$2,$3,$4,'Todo','#64748b','todo',0,now(),now())",[col,w,p,b]);
 token=await createPersonalAccessToken(pool,{userId:u,name:'Independent boards-only',scopes:['boards:read'],projectId:p});
 await run('boards-only listing omits descriptions',async()=>{
  const r=await request('GET',`/api/v1/projects/${p}/boards`);
  const item=r.body.data?.find(x=>x.id===b);
  const details={status:r.status,returnedKeys:Object.keys(item??{}),containsDescription:item?.description==='INDEPENDENT-SYNTHETIC-DESCRIPTION'};
  results.push({name:'board-listing-response-observation',status:'observation',details});
  assert.equal(r.status,200);assert.equal(Object.hasOwn(item,'description'),false);
  return details;
 });
 token=await createPersonalAccessToken(pool,{userId:u,name:'Independent writer',scopes:['boards:read','cards:create'],projectId:p});
 const version=async()=>Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1',[b])).rows[0].structure_version);
 await run('actual mounted stale-board recovery retains semantic identity',async()=>{
  const original=globalThis.fetch,keys=[],statuses=[];let inserted=false;
  globalThis.fetch=async(url,init)=>{
   if(init?.method==='POST'){
    keys.push(new Headers(init.headers).get('idempotency-key'));
    if(!inserted){inserted=true;await pool.query('UPDATE boards SET structure_version=structure_version+1 WHERE id=$1',[b]);}
   }
   const r=await app.request(new Request(url,init));if(init?.method==='POST')statuses.push(r.status);return r;
  };
  try{
   const r=await new FlowboardClient({apiUrl:'http://localhost',apiToken:token.token}).createCard({operationId:crypto.randomUUID(),boardId:b,column:col,title:'Independent actual stale retry'});
   assert.deepEqual(statuses,[409,201]);assert.equal(keys[0],keys[1]);assert.ok(r.id);
   const count=await pool.query('SELECT count(*)::int n FROM cards WHERE board_id=$1 AND title=$2',[b,'Independent actual stale retry']);assert.equal(count.rows[0].n,1);
   return {statuses,effects:count.rows[0].n};
  }finally{globalThis.fetch=original;}
 });
 await run('write-wins token lock makes revocation wait until effect commits',async()=>{
  const guard=await pool.connect(),revoker=await pool.connect(),key=crypto.randomUUID();
  let pending,revocation;
  try{
   const receiptKey=`pat:${crypto.createHash('sha256').update(JSON.stringify([token.tokenDetails.id,key])).digest('hex')}`;
   await guard.query('BEGIN');
   await guard.query('SELECT pg_advisory_xact_lock(hashtext($1))',[JSON.stringify([u,'project',p,receiptKey])]);
   pending=request('POST',`/api/v1/boards/${b}/cards`,{title:'Independent write-wins effect',columnId:col,expectedBoardVersion:await version()},key);
   let writePid;
   for(let i=0;i<100;i++){
    const r=await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name='independent-mcp-adversarial' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%'");
    if(r.rows.length){writePid=Number(r.rows[0].pid);break;}await new Promise(r=>setTimeout(r,20));
   }
   assert.ok(writePid,'write must be observed waiting after token lock');
   revocation=revoker.query('UPDATE personal_access_tokens SET revoked_at=clock_timestamp() WHERE id=$1',[token.tokenDetails.id]);
   let blocked=false;
   for(let i=0;i<100;i++){
    const r=await pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query ILIKE $2',[writePid,'%UPDATE personal_access_tokens%']);
    if(r.rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));
   }
   assert.ok(blocked,'revocation must be observed waiting behind protected write');
   await guard.query('COMMIT');assert.equal((await pending).status,201);await revocation;
   const retry=await request('POST',`/api/v1/boards/${b}/cards`,{title:'Independent write-wins effect',columnId:col,expectedBoardVersion:await version()},key);
   assert.equal(retry.status,401);
   const count=await pool.query('SELECT count(*)::int n FROM cards WHERE board_id=$1 AND title=$2',[b,'Independent write-wins effect']);assert.equal(count.rows[0].n,1);
   return {revocationBlocked:true,effects:1,afterRevokeStatus:retry.status};
  }finally{
   await guard.query('ROLLBACK').catch(()=>{});guard.release();if(pending)await pending.catch(()=>{});if(revocation)await revocation.catch(()=>{});revoker.release();
  }
 });
}finally{
 await pool.end();await fs.writeFile(new URL('./adversarial-results.json',import.meta.url),JSON.stringify({results},null,2)+'\n');
}
process.exitCode=results.some(r=>r.status==='fail')?1:0;
