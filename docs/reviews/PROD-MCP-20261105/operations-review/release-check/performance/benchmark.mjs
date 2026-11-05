import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import inspector from 'node:inspector';
const here=new URL('.',import.meta.url),name=process.argv[2];
if(!['old','current','current-linear','current-trie'].includes(name))throw new Error('invalid target');
const start=performance.now(),cpu0=process.cpuUsage();
const {createApp}=await import(new URL(name+'-app.mjs',here));
const importCpu=process.cpuUsage(cpu0),importWall=performance.now()-start;
const pool={query(){throw new Error('Unexpected database call');}};
const env={APP_ORIGIN:'https://flowboard-app.pages.dev'};
const options={pool,storage:null,deadlineMs:25000};
const make=()=>createApp(async()=>{},options);
const count=300, rounds=5,results=[];
function percentile(a,p){return [...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1];}
for(const workload of ['construction','fresh-health','reused-health','fresh-session','reused-session','fresh-metadata','reused-metadata']){
 const reuse=workload.startsWith('reused'),route=workload.endsWith('session')?'/api/v1/session':workload.endsWith('metadata')?'/.well-known/oauth-authorization-server':'/health/live';
 const expected=route.includes('session')?401:route.includes('well-known')&&name==='old'?404:200;
 const common=make();if(reuse)await common.fetch(new Request('https://flowboard-app.pages.dev'+route),env);
 const timings=[],roundCpu=[];
 for(let r=0;r<rounds;r++){
  const c=process.cpuUsage();
  for(let i=0;i<count;i++){
   const t=performance.now();const app=reuse?common:make();
   if(workload!=='construction'){
    const response=await app.fetch(new Request('https://flowboard-app.pages.dev'+route),env);
    if(response.status!==expected)throw new Error('Unexpected synthetic status '+response.status+' for '+workload);
    await response.arrayBuffer();
   }
   timings.push(performance.now()-t);
  }
  const used=process.cpuUsage(c);roundCpu.push((used.user+used.system)/1000/count);
 }
 results.push({workload,iterations:count*rounds,p50WallMs:percentile(timings,.5),p95WallMs:percentile(timings,.95),p99WallMs:percentile(timings,.99),cpuMsPerOperationByRound:roundCpu});
}
const app=make();const routeCount=app.routes.length;
const session=new inspector.Session();session.connect();const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:100});await post('Profiler.start');
for(let i=0;i<1500;i++){const a=make();const response=await a.fetch(new Request('https://flowboard-app.pages.dev/health/live'),env);await response.arrayBuffer();}
const {profile}=await post('Profiler.stop');session.disconnect();
await fs.writeFile(new URL(name+'-fresh-health.cpuprofile',here),JSON.stringify(profile));
const result={target:name,node:process.version,source:name==='old'?'3a82b24':'40e51e1336a783a6b450806260ed6c5aa8ace0ea',routeEntries:routeCount,importWallMs:importWall,importCpuMs:(importCpu.user+importCpu.system)/1000,results,limits:'Node synthetic no-DB/router CPU; same installed Hono/Zod/pg, old contract source bundled. Not Workers metered CPU or hosted acceptance.'};
await fs.writeFile(new URL(name+'-benchmark.json',here),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
