import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {createTestHarness} from 'wrangler';
import {serve} from '@hono/node-server';
import {startNode} from '../src/runtime/node.ts';
import {createApp} from '../src/http/app.ts';
import {runMigrations} from '../src/adapters/migrations.ts';
import {createDevUserAndSession} from '../src/adapters/session.ts';
import {DEFAULT_BODY_LIMIT_BYTES,IMPORT_BODY_LIMIT_BYTES,IMAGE_BODY_LIMIT_BYTES} from '../src/http/middleware/limits.ts';
const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];
const output=process.env['FLOWBOARD_RUNTIME_EVIDENCE_PATH'];
const samples:any={environment:{node:process.version,platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,totalMemoryBytes:os.totalmem()},measurements:[],checks:[]};
const safe=(text:string)=>assert.doesNotMatch(text,/synthetic_private_sql_sentinel|secret_table|flowboard_local_only|postgres(?:ql)?:\/\/|ECONNREFUSED|at \S+:\d+:\d+/i);
async function setup(t:TestContext){
  const target=new URL(uri!);assert.ok(['postgres:','postgresql:'].includes(target.protocol));assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname));assert.equal(target.pathname,'/flowboard_identity_extra_test');assert.ok(target.port&&!['55432','55479'].includes(target.port));assert.equal(target.username,'flowboard_harness');assert.equal(target.search,'');
  // The actual Node bootstrap permits only the primary local database. Keep all
  // setup, runtime and cleanup in one random schema there, without a DB bypass.
  target.pathname='/flowboard_harness';const primaryUri=target.toString();
  const schema='runtime_validation_'+crypto.randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:primaryUri,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:primaryUri,max:8,options:`-c search_path=${schema}`});
  const dir=await fs.mkdtemp('/private/tmp/flowboard-runtime-validation-');
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await fs.rm(dir,{recursive:true,force:true});if(output)await fs.writeFile(output,JSON.stringify(samples,null,2)+'\n');});
  await runMigrations(pool);await pool.query('CREATE TABLE runtime_probe_events(kind TEXT NOT NULL)');
  samples.environment.postgres=(await pool.query('SELECT version() AS version')).rows[0].version;
  const actors:Record<string,Awaited<ReturnType<typeof createDevUserAndSession>>>={};
  for(const role of ['owner','member','other'])actors[role]=await createDevUserAndSession(`runtime.${role}@flowboard.example`,`Runtime ${role}`,pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('ws','Runtime','UTC',$1,NOW(),NOW()),('foreign_ws','Other','UTC',$2,NOW(),NOW())`,[actors.owner!.user.id,actors.other!.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('prj','ws','Runtime',NOW(),NOW()),('foreign_prj','foreign_ws','PRIVATE_SIBLING_PROJECT',NOW(),NOW());`);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES('brd','ws','prj','Runtime',NOW(),NOW()),('foreign_brd','foreign_ws','foreign_prj','PRIVATE_SIBLING_BOARD',NOW(),NOW());`);
  await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES('pm','prj','ws',$1,'member','active',NOW(),NOW())`,[actors.member!.user.id]);
  await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES('brd','prj','ws',$1,$2)`,[actors.member!.user.id,actors.owner!.user.id]);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) SELECT 'col_'||g,'ws','prj','brd','Column '||g,'#64748b','todo',g,NOW(),NOW() FROM generate_series(0,4)g`);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,description,priority,position,state,due_date,created_at,updated_at) SELECT 'card_'||g,'ws','prj','brd','col_'||(g%5),RPAD('Representative task '||g,200,'t'),repeat('d',8000)||'PRIVATE_DESCRIPTION_TAIL','medium',g*1000,'active',CASE WHEN g%3=0 THEN NULL WHEN g%3=1 THEN DATE '2000-01-01' ELSE DATE '2099-01-01' END,NOW(),NOW() FROM generate_series(1,1000)g`);
  for(const role of ['owner','member'])await pool.query(`INSERT INTO card_assignees(card_id,user_id,workspace_id,project_id,created_at) SELECT id,$1,'ws','prj',NOW() FROM cards WHERE board_id='brd'`,[actors[role]!.user.id]);
  // Additional authorized empty boards permit a one-board versus five-board SQL-count comparison.
  for(let index=1;index<=4;index++){
    await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)VALUES($1,'ws','prj',$2,NOW(),NOW())`,['extra_'+index,'Extra '+index]);
    await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)VALUES($1,'ws','prj',$2,'Extra','#64748b','todo',0,NOW(),NOW())`,['extra_col_'+index,'extra_'+index]);
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES($1,'prj','ws',$2,$3)`,['extra_'+index,actors.member!.user.id,actors.owner!.user.id]);
  }
  const dbUrl=new URL(primaryUri);dbUrl.searchParams.set('options',`-c search_path=${schema}`);
  const headers=(role='owner',extra:Record<string,string>={})=>({cookie:`flowboard_session=${actors[role]!.session.id}`,origin:'http://localhost:4173','cf-connecting-ip':'127.0.0.1',...extra});
  return{pool,dir,dbUrl:dbUrl.toString(),headers};
}
type CapturedQuery = { text: string; values: unknown[] };
async function explainCaptured(pool:pg.Pool,mode:string,phase:string,captured:CapturedQuery[]){
  const hot=captured.filter(q=>/^\s*SELECT/i.test(q.text)&&/FROM cards c/.test(q.text));
  const plans=[];
  for(const query of hot.slice(0,3)){
    const plan=(await pool.query('EXPLAIN (FORMAT JSON) '+query.text,query.values)).rows[0]['QUERY PLAN'];
    // EXPLAIN embeds argument literals in Filters; strip every SQL quoted literal, not just known IDs.
    plans.push({sql:query.text.replace(/'[^']*'/g,"'<literal>'"),plan:JSON.parse(JSON.stringify(plan).replace(/'[^']*'/g,"'<literal>'"))});
  }
  const rechecks=captured.filter(q=>q.text.includes('AS allowed')).length;
  samples.checks.push({runtime:mode,kind:'sql_capture',phase,queryCount:captured.length,boardRechecks:rechecks,hotPlans:plans});
}
/** A single-connection HTTP control beside the original Fetch regressions.
 * Stop pumping after a response starts, but require the entire response to be
 * received. A reset, absent response or truncated body remains a test failure. */
async function nativeBodyRequest(url:string,init:RequestInit,agent:http.Agent):Promise<Response>{
  assert.ok(Buffer.isBuffer(init.body));
  const body=init.body;
  return new Promise<Response>((resolve,reject)=>{
    let responseStarted=false,settled=false,offset=0;
    const headers=Object.fromEntries(new Headers(init.headers).entries());
    headers['content-length']=String(body.byteLength);
    const request=http.request(url,{method:init.method,headers,agent},response=>{
      responseStarted=true;
      const chunks:Buffer[]=[];
      let received=0;
      response.on('data',(chunk:Buffer)=>{received+=chunk.length;if(received>1024*1024){request.destroy(new Error('Probe response exceeded1MiB'));return;}chunks.push(chunk);});
      response.once('error',reject);
      response.once('aborted',()=>reject(new Error('Incomplete HTTP response')));
      response.once('end',()=>{
        if(!response.complete)return reject(new Error('Truncated HTTP response'));
        settled=true;
        const status=response.statusCode!;
        const responseHeaders=new Headers();
        for(const [name,value]of Object.entries(response.headers))if(value!==undefined)responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);
        resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers:responseHeaders}));
        if(!request.writableFinished)request.destroy();
      });
    });
    request.once('error',error=>{if(!settled)reject(error);});
    request.setTimeout(10000,()=>request.destroy(new Error('Native body probe timed out')));
    function pump(){
      if(responseStarted||request.destroyed)return;
      while(offset<body.length){
        const next=Math.min(offset+64*1024,body.length),chunk=body.subarray(offset,next);offset=next;
        if(!request.write(chunk)){request.once('drain',pump);return;}
      }
      request.end();
    }
    request.flushHeaders();
    setImmediate(pump);
  });
}
async function startNodeIsolated(dbUrl:string){
  const target=new URL(dbUrl);
  assert.ok(['postgres:','postgresql:'].includes(target.protocol));
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname));
  assert.ok(target.port&&!['55432','55479'].includes(target.port));
  assert.equal(target.username,'flowboard_harness');assert.equal(target.pathname,'/flowboard_harness');
  assert.deepEqual([...target.searchParams.keys()],['options']);
  const schema=target.searchParams.get('options')?.match(/^-c search_path=(runtime_validation_[a-f0-9]{32})$/)?.[1];
  assert.ok(schema,'Only this test’s random schema may be selected');
  target.search='';
  const runtime=startNode(0,target.toString());
  const transport:Array<{path:string;length:number;socket:number;status?:number;ended?:boolean}>=[];
  runtime.server.on('request',(request:http.IncomingMessage,response:http.ServerResponse)=>{const record={path:request.url??'',length:Number(request.headers['content-length']??0),socket:request.socket.remotePort??0};transport.push(record);response.once('finish',()=>Object.assign(record,{status:response.statusCode,ended:request.readableEnded}));});
  let captured:CapturedQuery[]=[];
  runtime.pool.options.onConnect=async(client)=>{await client.query(`SET search_path TO "${schema}"`);};
  runtime.pool.on('connect',(client)=>{const original=client.query.bind(client);(client as any).query=(...args:any[])=>{const text=typeof args[0]==='string'?args[0]:args[0]?.text;if(typeof text==='string')captured.push({text,values:Array.isArray(args[1])?args[1]:args[0]?.values??[]});return(original as any)(...args);};});
  if(!runtime.server.listening)await once(runtime.server,'listening');const address=runtime.server.address();assert.ok(address&&typeof address!=='string');
  const localUrl=(url:string)=>`http://127.0.0.1:${address.port}${new URL(url).pathname}${new URL(url).search}`;
  return{origin:`http://127.0.0.1:${address.port}`,transport:()=>transport,queries:async()=>captured,fetch:(url:string,init?:RequestInit)=>{captured=[];return fetch(localUrl(url),init);},close:()=>runtime.close()};
}
test('FND04/UX05 actual Node and workerd protocol, caps,1000-card samples and SQL deadline validation',{skip:!uri&&'Set isolated identity-extra URL',timeout:90000},async(t)=>{
  const f=await setup(t);
  samples.environment.installedPackages={};
  for(const name of ['hono','@hono/node-server','pg','wrangler','zod','typescript']){const metadata=JSON.parse(await fs.readFile(new URL('../../../node_modules/'+name+'/package.json',import.meta.url),'utf8'));samples.environment.installedPackages[name]=metadata.version;}
  samples.environment.declaredApiPackages=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
  for(const mode of ['node','worker']as const){
    await f.pool.query('DELETE FROM rate_limit_windows');
    const started=performance.now();let run:{queries:()=>Promise<CapturedQuery[]>;fetch:(url:string,init?:RequestInit)=>Promise<Response>;origin?:string;transport?:()=>Array<{path:string;length:number;socket:number;status?:number;ended?:boolean}>;close:()=>Promise<unknown>};
    if(mode==='node')run=await startNodeIsolated(f.dbUrl);
    else{
      const configPath=path.join(f.dir,'wrangler.json');await fs.writeFile(configPath,JSON.stringify({name:'flowboard-runtime-validation',main:fileURLToPath(new URL('./runtime-protocol-probe.ts',import.meta.url)),compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat'],ratelimits:[{name:'FB_RL_WRITES',namespace_id:'9921',simple:{limit:1000,period:60}}],vars:{DATABASE_URL:f.dbUrl,CURSOR_SECRET:'synthetic-runtime-cursor-secret-20261103'}}));
      const harness=createTestHarness({workers:[{configPath}]});await harness.listen();const worker=harness.getWorker('flowboard-runtime-validation');run={queries:async()=>await(await worker.fetch('http://localhost/__runtime_probe/sql')).json()as CapturedQuery[],fetch:(url,init)=>worker.fetch(url,init as Parameters<typeof worker.fetch>[1]) as unknown as Promise<Response>,close:()=>harness.close()};
    }
    samples.measurements.push({runtime:mode,phase:'startup',elapsedMs:performance.now()-started});
    try{
      await t.test(`${mode}:1000-card first and warm snapshots are correct/bounded and isolated`,async()=>{
        for(let i=0;i<6;i++){
          const before=performance.now();const response=await run.fetch('http://localhost/api/v1/boards/brd',{headers:f.headers('member')});const text=await response.text();
          samples.measurements.push({runtime:mode,phase:i===0?'first_after_runtime_start':'warm',sample:i,elapsedMs:performance.now()-before,status:response.status,bytes:Buffer.byteLength(text),serverTiming:response.headers.get('server-timing')});
          assert.equal(response.status,200,text);const body=JSON.parse(text);assert.equal(body.data.totals.activeCardCount,1000);assert.equal(body.data.columns.length,5);assert.equal(body.data.columns.flatMap((c:any)=>c.cards).length,50);
          for(const col of body.data.columns){assert.equal(col.activeCardCount,200);assert.equal(col.cards.length,10);assert.ok(col.nextCursor);assert.ok(col.cards.every((c:any)=>c.assigneeIds.length===2));}
          assert.equal(text.includes('PRIVATE_DESCRIPTION_TAIL'),false);assert.equal(text.includes('@flowboard.example'),false);assert.equal(text.includes('PRIVATE_SIBLING'),false);
          if(i===0)await explainCaptured(f.pool,mode,'snapshot1000',await run.queries());
        }
        const sibling=await run.fetch('http://localhost/api/v1/boards/foreign_brd',{headers:f.headers('member')});assert.equal(sibling.status,404);assert.equal((await sibling.text()).includes('PRIVATE_SIBLING'),false);
      });
      await t.test(`${mode}:MyTasks1000-row cursor walk, tied/NULL dates, filters and actual query growth`,async()=>{
        const ids:string[]=[];let cursor:string|null=null;let pages=0;
        do{
          const started=performance.now(),r=await run.fetch('http://localhost/api/v1/me/tasks?projectId=prj&limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{headers:f.headers('member')});const text=await r.text();assert.equal(r.status,200,text);const b=JSON.parse(text);
          samples.measurements.push({runtime:mode,phase:'my_tasks_page',sample:pages,elapsedMs:performance.now()-started,bytes:Buffer.byteLength(text),rows:b.data.length});
          assert.ok(b.data.length<=100);ids.push(...b.data.map((c:any)=>c.id));cursor=b.nextCursor;pages++;
          if(pages===1)await explainCaptured(f.pool,mode,'my_tasks_1_returned_board',await run.queries());
          assert.ok(pages<=11,'cursor must terminate');
        }while(cursor);
        const expected=(await f.pool.query(`SELECT id FROM cards WHERE board_id='brd' ORDER BY due_date ASC NULLS LAST,id ASC`)).rows.map(r=>r.id);
        assert.deepEqual(ids,expected);assert.equal(new Set(ids).size,1000);assert.equal(pages,10);
        const filtered=await run.fetch('http://localhost/api/v1/me/tasks?projectId=prj&limit=100&due=none',{headers:f.headers('member')});const body=await filtered.json()as any;assert.equal(filtered.status,200);assert.equal(body.data.length,100);assert.ok(body.data.every((c:any)=>c.dueDate===null));assert.ok(body.nextCursor);
        const search=await run.fetch('http://localhost/api/v1/projects/prj/cards/search?limit=100&due=none&titleQuery=Representative',{headers:f.headers('member')});const searchText=await search.text();assert.equal(search.status,200,searchText);const sb=JSON.parse(searchText);assert.equal(sb.data.length,100);assert.ok(sb.data.every((c:any)=>c.dueDate===null));assert.equal(sb.matchingCardCount,333);assert.ok(sb.nextCursor);await explainCaptured(f.pool,mode,'search_filter1000',await run.queries());
        const snapshot=await run.fetch('http://localhost/api/v1/boards/brd?due=none&cardLimitPerColumn=15',{headers:f.headers('member')});const snap=await snapshot.json()as any;assert.equal(snapshot.status,200);assert.equal(snap.data.totals.activeCardCount,1000);assert.equal(snap.data.totals.matchingCardCount,333);assert.equal(snap.data.columns.flatMap((c:any)=>c.cards).length,75);
        try{
          await f.pool.query(`UPDATE cards SET board_id='extra_'||(substring(id FROM 6)::int%5),column_id='extra_col_'||(substring(id FROM 6)::int%5) WHERE substring(id FROM 6)::int%5>0`);
          const r=await run.fetch('http://localhost/api/v1/me/tasks?projectId=prj&limit=100',{headers:f.headers('member')});assert.equal(r.status,200,await r.clone().text());await r.arrayBuffer();await explainCaptured(f.pool,mode,'my_tasks_5_returned_boards',await run.queries());
        }finally{await f.pool.query(`UPDATE cards SET board_id='brd',column_id='col_'||(substring(id FROM 6)::int%5)`);}
      });
      await t.test(`${mode}:health,correlation,timing,HEAD,OPTIONS and safe malformed errors`,async()=>{
        for(const [route,status]of [['/health/live',200],['/health/ready',200],['/api/v1/session',401],['/api/v1/missing',404]]as const){const r=await run.fetch('http://localhost'+route,{headers:{'x-request-id':'runtime_probe_request_123'}});assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-request-id'),'runtime_probe_request_123');assert.match(r.headers.get('server-timing')??'',/app;dur=\d/);const text=await r.text();safe(text);if(status>=400)assert.equal(JSON.parse(text).error.requestId,'runtime_probe_request_123');}
        const invalid=await run.fetch('http://localhost/health/live',{headers:{'x-request-id':'bad id'}});assert.match(invalid.headers.get('x-request-id')??'',/^[a-f0-9-]{36}$/);
        const head=await run.fetch('http://localhost/health/live',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
        const options=await run.fetch('http://localhost/api/v1/boards/brd',{method:'OPTIONS',headers:{Origin:'http://localhost:4173','Access-Control-Request-Method':'GET'}});assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),'http://localhost:4173');assert.equal(await options.text(),'');
        const untrusted=await run.fetch('http://localhost/api/v1/boards/brd',{method:'OPTIONS',headers:{Origin:'https://untrusted.example','Access-Control-Request-Method':'GET'}});assert.equal(untrusted.headers.get('access-control-allow-origin'),null);assert.equal(await untrusted.text(),'');
        const malformed=await run.fetch('http://localhost/api/v1/boards/brd/cards',{method:'POST',headers:f.headers('owner',{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}),body:'{'});assert.equal(malformed.status,400);safe(await malformed.text());
      });
      if(mode==='worker')await t.test('worker:test-only shared middleware masks faults and records genuine SQL continuation',async()=>{
        const fault=await run.fetch('http://localhost/__runtime_probe/fault');assert.equal(fault.status,500);safe(await fault.text());
        const started=performance.now(),r=await run.fetch('http://localhost/__runtime_probe/slow');assert.equal(r.status,504);safe(await r.text());const elapsed=performance.now()-started;
        const completed=Number((await f.pool.query("SELECT COUNT(*)FROM runtime_probe_events WHERE kind='worker_slow_completed'")).rows[0].count);
        samples.checks.push({runtime:'workerd_test_only_app',kind:'http_deadline_pg_sleep',configuredDeadlineMs:50,elapsedMs:elapsed,status:r.status,underlyingWriteCompleted:completed===1,poolEndWaitsForOutstandingQuery:true});assert.equal(completed,1);
      });
      await t.test(`${mode}:actual wire body-cap boundaries`,async()=>{
        const cases=[['POST','/api/v1/boards/brd/cards',DEFAULT_BODY_LIMIT_BYTES],['POST','/api/v1/boards/absent/imports',IMPORT_BODY_LIMIT_BYTES],['PUT','/api/v1/image-uploads/absent/content',IMAGE_BODY_LIMIT_BYTES]]as const;
        for(const [method,route,cap]of cases)for(const delta of [0,1]){
          let r:Response;try{r=await run.fetch('http://localhost'+route,{method,headers:f.headers('owner',{'Content-Type':'application/octet-stream','Idempotency-Key':crypto.randomUUID()}),body:Buffer.alloc(cap+delta,0x41)});}catch(error){samples.checks.push({runtime:mode,kind:'body_cap_transport_failure',route,bytes:cap+delta,errorClass:(error as Error).name,causeCode:(error as any).cause?.code});throw error;}const text=await r.text();samples.checks.push({runtime:mode,kind:'body_cap',route,bytes:cap+delta,status:r.status});if(delta===1){assert.equal(r.status,413,text);assert.equal(JSON.parse(text).error.code,'PAYLOAD_TOO_LARGE');}else assert.notEqual(r.status,413,text);safe(text);
        }
        const anonymous=await run.fetch('http://localhost/api/v1/boards/brd/imports',{method:'POST',headers:{'Content-Type':'application/octet-stream','cf-connecting-ip':'127.0.0.1'},body:Buffer.alloc(DEFAULT_BODY_LIMIT_BYTES+1)});assert.equal(anonymous.status,413);
      });
      if(mode==='node')await t.test('node:single keepalive connection survives an early413 then a legitimate upload',async()=>{
        // Separate protocol groups own separate limiter windows; this is not a rate-limit proof.
        await f.pool.query('DELETE FROM rate_limit_windows');
        const agent=new http.Agent({keepAlive:true,maxSockets:1});
        const headers=f.headers('owner',{'Content-Type':'application/octet-stream','Idempotency-Key':crypto.randomUUID()});
        try{
          const firstIndex=run.transport!().length;
          for(let i=0;i<2;i++){
            const normal=await nativeBodyRequest(run.origin!+'/health/live',{method:'GET',headers,body:Buffer.alloc(0)},agent);
            assert.equal(normal.status,200);assert.equal((await normal.json()as any).data.status,'ok');
          }
          const normalRecords=run.transport!().slice(firstIndex);
          assert.equal(normalRecords.length,2);assert.equal(normalRecords[0]!.socket,normalRecords[1]!.socket,'Healthy requests must retain normal keepalive reuse');
          const oversized=await nativeBodyRequest(run.origin!+'/api/v1/boards/brd/cards',{method:'POST',headers,body:Buffer.alloc(DEFAULT_BODY_LIMIT_BYTES+1,65)},agent);
          assert.equal(oversized.status,413);assert.equal((await oversized.json()as any).error.code,'PAYLOAD_TOO_LARGE');assert.equal(oversized.headers.get('connection'),'close');
          const refused=run.transport!().at(-1)!;assert.equal(refused.ended,true,'Bounded refusal is drained before the final response');
          const subsequent=await nativeBodyRequest(run.origin!+'/api/v1/boards/absent/imports',{method:'POST',headers,body:Buffer.alloc(IMPORT_BODY_LIMIT_BYTES,65)},agent);
          assert.equal(subsequent.status,400);assert.equal((await subsequent.json()as any).error.code,'MISSING_DEFAULT_COLUMN');
          assert.notEqual(run.transport!().at(-1)!.socket,refused.socket,'An early refused connection must not be reused');
          samples.checks.push({runtime:'node',kind:'early413_keepalive_recovery',status:413,nextStatus:400,normalConnectionReused:true,refusedConnectionClosed:true});
        }finally{agent.destroy();}
      });
      if(mode==='node')await t.test('node:early401 and role403 retain complete private error responses and allow the next upload',async()=>{
        await f.pool.query('DELETE FROM rate_limit_windows');
        const agent=new http.Agent({keepAlive:true,maxSockets:1});
        const before=(await f.pool.query('SELECT (SELECT COUNT(*)FROM cards)::int AS cards,(SELECT COUNT(*)FROM activity_log)::int AS activity,(SELECT COUNT(*)FROM outbox)::int AS outbox,(SELECT COUNT(*)FROM idempotency_receipts)::int AS receipts')).rows[0];
        try{
          for(const [status,route,code]of [[401,'/api/v1/boards/brd/cards','UNAUTHORIZED'],[403,'/api/v1/projects/prj/leave','FORBIDDEN']]as const){
            const headers=f.headers('owner',{'Content-Type':'application/octet-stream','Idempotency-Key':crypto.randomUUID(),...(status===401?{cookie:'flowboard_session=invalid_synthetic_session'}:{})});
            const refused=await nativeBodyRequest(run.origin!+route,{method:'POST',headers,body:Buffer.alloc(DEFAULT_BODY_LIMIT_BYTES,65)},agent);
            const text=await refused.text();assert.equal(refused.status,status,text);const body=JSON.parse(text);assert.equal(body.error.code,code);assert.equal(body.data,undefined);safe(text);
            assert.equal(refused.headers.get('connection'),'close');assert.equal(run.transport!().at(-1)!.ended,true);
            const next=await nativeBodyRequest(run.origin!+'/api/v1/boards/absent/imports',{method:'POST',headers:f.headers('owner',{'Content-Type':'application/octet-stream','Idempotency-Key':crypto.randomUUID()}),body:Buffer.alloc(IMPORT_BODY_LIMIT_BYTES,65)},agent);
            assert.equal(next.status,400);assert.equal((await next.json()as any).error.code,'MISSING_DEFAULT_COLUMN');
            samples.checks.push({runtime:'node',kind:'early_private_error_recovery',status,nextStatus:400,hasData:false});
          }
          assert.deepEqual((await f.pool.query('SELECT (SELECT COUNT(*)FROM cards)::int AS cards,(SELECT COUNT(*)FROM activity_log)::int AS activity,(SELECT COUNT(*)FROM outbox)::int AS outbox,(SELECT COUNT(*)FROM idempotency_receipts)::int AS receipts')).rows[0],before);
        }finally{agent.destroy();}
      });
      if(mode==='node')await t.test('node:an incomplete refused upload times out without blocking healthy requests',async()=>{
        const started=performance.now();
        let upload!:http.ClientRequest;
        const pending=new Promise<{status:number;body:string}>((resolve,reject)=>{
          upload=http.request(run.origin!+'/api/v1/boards/brd/cards',{method:'POST',agent:false,headers:{...f.headers('owner',{'Content-Type':'application/octet-stream','Idempotency-Key':crypto.randomUUID()}),'Content-Length':String(DEFAULT_BODY_LIMIT_BYTES+1)}},response=>{
            let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;});response.once('error',reject);response.once('end',()=>{if(!response.complete)return reject(new Error('Slow upload refusal truncated'));resolve({status:response.statusCode!,body:text});upload.destroy();});
          });
          upload.once('error',reject);upload.setTimeout(5000,()=>upload.destroy(new Error('Slow upload probe timed out')));upload.flushHeaders();
        });
        try{
          const healthy=await run.fetch('http://localhost/health/live');assert.equal(healthy.status,200);await healthy.text();
          const response=await pending;assert.equal(response.status,413);assert.equal(JSON.parse(response.body).error.code,'PAYLOAD_TOO_LARGE');
          const elapsed=performance.now()-started;assert.ok(elapsed<2500,`Bounded1s refusal exceeded wall allowance: ${elapsed}`);
          const recovered=await run.fetch('http://localhost/health/live');assert.equal(recovered.status,200);await recovered.text();
          samples.checks.push({runtime:'node',kind:'incomplete_refusal_body',status:413,elapsedMs:elapsed,subsequentHealth:200});
        }finally{upload.destroy();await pending.catch(()=>{});}
      });
      await t.test(`${mode}:real SQL lock deadline has safe retryable response and atomic rollback`,async()=>{
        const baseline=(await f.pool.query('SELECT (SELECT COUNT(*)FROM activity_log)::int AS activity,(SELECT COUNT(*)FROM outbox)::int AS outbox')).rows[0];
        const blocker=await f.pool.connect();await blocker.query('BEGIN');await blocker.query("SELECT id FROM boards WHERE id='brd' FOR UPDATE");
        const key=crypto.randomUUID(),before=performance.now(),expectedBoardVersion=Number((await f.pool.query("SELECT structure_version FROM boards WHERE id='brd'")).rows[0].structure_version);let response:Response;
        try{response=await run.fetch('http://localhost/api/v1/boards/brd/cards',{method:'POST',headers:f.headers('owner',{'Content-Type':'application/json','Idempotency-Key':key}),body:JSON.stringify({title:'deadline_attempt_'+mode,columnId:'col_0',expectedBoardVersion})});}finally{await blocker.query('ROLLBACK');blocker.release();}
        const text=await response.text();samples.checks.push({runtime:mode,kind:'sql_lock_timeout',elapsedMs:performance.now()-before,status:response.status,body:JSON.parse(text)});safe(text);
        const effects=await f.pool.query(`SELECT (SELECT COUNT(*)FROM cards WHERE title=$1)::int AS cards,(SELECT COUNT(*)FROM idempotency_receipts WHERE idempotency_key=$2)::int AS receipts,(SELECT COUNT(*)FROM activity_log)::int AS activity,(SELECT COUNT(*)FROM outbox)::int AS outbox`,['deadline_attempt_'+mode,key]);assert.deepEqual(effects.rows[0],{cards:0,receipts:0,...baseline});
        assert.ok([503,504].includes(response.status),`SQL timeout must be a controlled retryable response, got ${response.status}: ${text}`);assert.equal(response.headers.get('retry-after'),'1');
        const control=await run.fetch('http://localhost/api/v1/boards/brd/cards',{method:'POST',headers:f.headers('owner',{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}),body:JSON.stringify({title:'after_deadline_control',columnId:'col_0',expectedBoardVersion})});assert.equal(control.status,201,await control.clone().text());const controlId=(await control.json()as any).data.id;await f.pool.query('DELETE FROM cards WHERE id=$1',[controlId]);
      });
    }finally{await run.close();}
  }
});
test('FND04 genuine PostgreSQL slow query records HTTP deadline without assuming cancellation',{skip:!uri,timeout:10000},async(t)=>{
  const f=await setup(t);const app=createApp(async()=>{},{pool:f.pool,deadlineMs:30});
  app.get('/__runtime_probe/slow',async(c)=>{await f.pool.query('SELECT pg_sleep(0.15)');await f.pool.query("INSERT INTO runtime_probe_events(kind)VALUES('node_slow_completed')");return c.json({data:'done'});});
  const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});t.after(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));if(!server.listening)await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  const before=performance.now(),r=await fetch(`http://127.0.0.1:${address.port}/__runtime_probe/slow`);assert.equal(r.status,504);safe(await r.text());const elapsed=performance.now()-before;
  for(let i=0;i<100;i++){if(Number((await f.pool.query("SELECT COUNT(*)FROM runtime_probe_events WHERE kind='node_slow_completed'")).rows[0].count)>0)break;await new Promise(resolve=>setTimeout(resolve,10));}
  const completed=Number((await f.pool.query("SELECT COUNT(*)FROM runtime_probe_events WHERE kind='node_slow_completed'")).rows[0].count);
  samples.checks.push({runtime:'node_test_only_app',kind:'http_deadline_pg_sleep',elapsedMs:elapsed,status:504,underlyingWriteCompleted:completed===1});
  assert.equal(completed,1,'Observed continuation is recorded honestly; a504 does not prove cancellation');
});

test('FND04 actual unavailable-DB and Worker missing-binding health/privacy controls',{skip:!uri,timeout:30000},async(t)=>{
  const f=await setup(t);const refused=new URL(f.dbUrl);refused.port='1';
  const node=await startNodeIsolated(refused.toString());
  try{assert.equal((await node.fetch('http://localhost/health/live')).status,200);const ready=await node.fetch('http://localhost/health/ready');assert.equal(ready.status,503);safe(await ready.text());}finally{await node.close();}
  const configs=[];
  for(const [name,vars]of [['missing',{}],['refused',{DATABASE_URL:refused.toString()}]]as const){const configPath=path.join(f.dir,'worker-'+name+'.json');await fs.writeFile(configPath,JSON.stringify({name:'runtime-'+name,main:fileURLToPath(new URL('../src/runtime/worker.ts',import.meta.url)),compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat'],vars}));configs.push({configPath});}
  const harness=createTestHarness({workers:configs});
  try{await harness.listen();const missing=await harness.getWorker('runtime-missing').fetch('http://localhost/health/live');assert.equal(missing.status,500);const b=await missing.json()as any;assert.equal(b.error.code,'CONFIG_ERROR');assert.equal(b.error.requestId,undefined);samples.checks.push({runtime:'workerd',kind:'bootstrap_missing_binding',status:500,hasRequestId:false,note:'Current pre-middleware shape; not a general request-ID guarantee'});
    const down=harness.getWorker('runtime-refused');assert.equal((await down.fetch('http://localhost/health/live')).status,200);const ready=await down.fetch('http://localhost/health/ready');assert.equal(ready.status,503);safe(await ready.text());
  }finally{await harness.close();}
});
