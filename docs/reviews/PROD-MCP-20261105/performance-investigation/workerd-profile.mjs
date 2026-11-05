// Local only: exact prepared Worker bytes, synthetic non-connecting pool, no external HTTP.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const candidate=process.argv[2]??'/private/tmp/flowboard-prod-release-40e51e1';
const artifact=process.argv[3]??candidate+'/apps/api/dist/worker/worker.js';
const count=Number(process.argv[4]??300),label=process.argv[5]??'current';
assert.ok(Number.isInteger(count)&&count>=1&&count<=2000);assert.match(label,/^[a-z0-9-]+$/);
const require=createRequire(candidate+'/package.json');const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=require('miniflare');
const out=fileURLToPath(new URL('./',import.meta.url));
const bytes=await fs.readFile(artifact);
const report={kind:'local-workerd-performance-investigation',label,artifact,artifactSha256:crypto.createHash('sha256').update(bytes).digest('hex'),startedAt:new Date().toISOString(),nodeVersion:process.version,count,externalHttpRequests:0,realDatabaseConnections:0,limits:['Inspector samples and processCPU are local simulator observations; not proof of hosted CPU allocation or production traffic root cause.','Synthetic health/session paths do not exercise database/authenticated tools.']};
let mf,ws,requests=new Map(),id=0;
function cpuSeconds(pid){const value=execFileSync('ps',['-p',String(pid),'-o','time='],{encoding:'utf8'}).trim();const parts=value.split(':').map(Number);return parts.reduce((n,p)=>n*60+p,0);}
async function rpc(method,params={}){const key=++id;const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(key);reject(new Error('Inspector timeout'));},10000);requests.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});ws.send(JSON.stringify({id:key,method,params}));return promise;}
try {
  mf=new Miniflare(convertV4MiniflareOptions({name:'flowboard-cpu-local',modules:true,scriptPath:artifact,compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],port:0,host:'127.0.0.1',inspectorPort:0,cf:false,log:new Log(LogLevel.ERROR),outboundService:()=>{report.externalHttpRequests++;throw new Error('External HTTP forbidden');},bindings:{DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:59998/synthetic',APP_ORIGIN:'https://flowboard-app.pages.dev',FRONTEND_URL:'https://flowboard-app.pages.dev',CORS_ORIGIN:'https://flowboard-app.pages.dev'}}));
  await mf.ready;
  const rows=execFileSync('ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/));
  const processRow=rows.find(parts=>Number(parts[1])===process.pid&&parts.slice(2).join(' ').includes('workerd'));assert.ok(processRow,'own workerd PID missing');const workerdPid=Number(processRow[0]);report.workerdPid=workerdPid;
  const inspector=await mf.getInspectorURL();inspector.protocol='http:';inspector.pathname='/json';const targets=await fetch(inspector).then(r=>r.json());const target=targets.find(t=>t.webSocketDebuggerUrl.includes('flowboard-cpu-local'))??targets[0];assert.ok(target);
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const waiter=requests.get(message.id);if(!waiter)return;requests.delete(message.id);if(message.error)waiter.reject(new Error('Inspector RPC '+message.error.code));else waiter.resolve(message.result);});
  try{await rpc('Profiler.enable');await rpc('Profiler.setSamplingInterval',{interval:100});report.inspectorProfilerSupported=true;}catch(error){report.inspectorProfilerSupported=false;report.inspectorFailureClass=error.name;}
  const batches=[];
  for(const endpoint of ['/health/live','/api/v1/session','/.well-known/oauth-authorization-server','/api/v1/mcp']) {
    const cpuBefore=cpuSeconds(workerdPid),started=performance.now(),wall=[];let failures=0;
    if(report.inspectorProfilerSupported)await rpc('Profiler.start');
    for(let i=0;i<count;i++){const start=performance.now();const response=await mf.dispatchFetch('https://flowboard-app.pages.dev'+endpoint);await response.arrayBuffer();wall.push(performance.now()-start);if(![200,401,404].includes(response.status))failures++;}
    let profile;if(report.inspectorProfilerSupported){profile=(await rpc('Profiler.stop')).profile;await fs.writeFile(path.join(out,label+'-'+endpoint.replace(/[^a-z0-9]/gi,'-')+'.cpuprofile'),JSON.stringify(profile));}
    const cpuDeltaMs=(cpuSeconds(workerdPid)-cpuBefore)*1000;wall.sort((a,b)=>a-b);batches.push({endpoint,requests:count,unexpectedStatuses:failures,totalWallMs:performance.now()-started,workerProcessCpuMs:cpuDeltaMs,workerProcessCpuMsPerRequest:cpuDeltaMs/count,wallP50Ms:wall[Math.floor(wall.length*.5)],wallP95Ms:wall[Math.floor(wall.length*.95)],samples:profile?.samples?.length});
  }
  report.batches=batches;report.status='completed';
}catch(error){report.status='failed';report.errorClass=error.name;report.safeMessage=String(error.message).slice(0,300);process.exitCode=1;}
finally{if(ws)ws.close();if(mf)await mf.dispose();report.cleanup=true;report.completedAt=new Date().toISOString();await fs.writeFile(path.join(out,label+'-workerd-profile.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
